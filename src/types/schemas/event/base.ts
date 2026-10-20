import { z } from "zod";
import { StayPolicySchema, type StayPolicy } from "./accommodation";

const EventIdSchema = z.uuid();
type EventId = z.infer<typeof EventIdSchema>;


// ---- Location ------------------------------------------------------------------------

const LocationSchema = z.object({
    name: z.string().min(1, "Venue name is required"),
    address: z.string().min(1, "Address is required"),
    city: z.string().min(1, "City is required"),
    state: z.string().min(1, "State is required"),
    country: z.string().min(1, "Country is required"),
    postalCode: z.string().min(1, "Postal code is required"),
}).strict();
type Location = z.infer<typeof LocationSchema>;


// ---- Product ------------------------------------------------------------------------

/**
 * Product, which can be associated with an event ( Merch, Tickets, etc. )
 */
const ProductTypeSchema = z.enum(["TICKET", "ACCOMMODATION", "ADDON"]);
const ProductSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1, "Product name is required"),
  description: z.string().nullable().optional(),
  price: z.coerce.number().nonnegative("Price cannot be negative"),
  type: ProductTypeSchema,
  capacity: z.coerce.number().int().positive().nullable().optional(),
  order: z.coerce.number().int().default(0)
}).passthrough();
type Product = z.infer<typeof ProductSchema>;

// ---- Shared Cross-field refinement -----------------------------------------------

/**
 * Cross-Field-Check: endDate must be past startDate (only when both are present)
 * @internal Only as helper for Event-Base
 */
export const checkDateOrder = (data: { startDate?: Date; endDate?: Date }, cxt: z.RefinementCtx) => {
  if(data.startDate && data.endDate && data.startDate > data.endDate) {
    cxt.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start date must be before end date",
      path: ["startDate"],
    });
  }
}

export const checkCapacityLimits = (
  data: { maxRegistrations?: number | null; products?: Array<Pick<Product, "type" | "capacity">> },
  cxt: z.RefinementCtx,
) => {
  const maxRegistrations = data.maxRegistrations;
  if (maxRegistrations && data.products) {
    data.products.forEach((p, index) => {
      if (p.type === 'TICKET' && p.capacity && p.capacity > maxRegistrations) {
        cxt.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Ticket capacity (${p.capacity}) cannot exceed total event capacity (${maxRegistrations})`,
          path: ["products", index, "capacity"],
        });
      }
    });
  }
}

const CustomFieldType = z.enum(["text", "number", "boolean", "select"]);
const CustomFieldSchema = z.object({
  id: z.string(),
  label: z.string().min(1, "Label is required"),
  type: CustomFieldType,
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(), // For 'select' type
}).strict();

const ScheduleItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, "Session title is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
}).strict();

/**
 * Base schema of an event, only the client-delivered, stable fields
 * Used as base for Admin-Create/Update
 */
export const EventBaseObject = z.object({
  name: z.string().min(1, "Event name is required"),
  description: z.string().min(1, "Description is required"),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  location: LocationSchema,
  imageUrl: z.url().nullable().optional(),
  products: z.array(ProductSchema).default([]),

  /** Scheduled time for automatic status change to PUBLISHED */
  publishAt: z.coerce.date().nullable().optional(),
  /** When users can start registering */
  registrationOpensAt: z.coerce.date().nullable().optional(),
  /** Capacity limit */
  maxRegistrations: z.coerce.number().int().positive().nullable().optional(),
  /** Force user to select a room (ACCOMMODATION product) */
  requiresHotel: z.boolean().default(false),
  /** Require organizer approval before payment can be made */
  requireApproval: z.boolean().default(false),
  /** Allow a ticket to be accepted only once at check-in */
  scanOnce: z.boolean().default(false),
  /** Enable the event community feed */
  communityEnabled: z.boolean().default(false),
  /** Keep posting/reactions open after the event end date */
  communityOpenAfterEnd: z.boolean().default(true),
  /** New posts require moderation before they appear publicly */
  communityModerated: z.boolean().default(true),
  /** Also require moderation for comments (only active when communityModerated is true) */
  communityModerateComments: z.boolean().default(false),
  /** Restrict community writes to active attendees */
  communityAttendeesOnly: z.boolean().default(true),
  /** Fixed deadline for all payments */
  paymentDeadline: z.coerce.date().nullable().optional(),

  /** Hotel/Stay-Policy: Main-Days + Early/Late-Options */
  stayPolicy: StayPolicySchema,

  /** Custom admin-defined fields for registration */
  customFields: z.array(CustomFieldSchema).default([]),

  /** Optional schedule/agenda items for the event */
  schedule: z.array(ScheduleItemSchema).default([])
});

export const EventBaseSchema = EventBaseObject.superRefine(checkDateOrder).superRefine(checkCapacityLimits).strict();
type EventBase = z.infer<typeof EventBaseSchema>;


/**
 * Entire Event-Entity incl. serverside fields (DB)
 * @usage
 *   - Server-Output for client (Read-Model)
 *   - Internal Domain-validation for persistence
 */
const EventEntitySchema = EventBaseObject.extend({
  id: EventIdSchema,
  status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]).default("DRAFT"),
  ownerId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date()
}).strict();
type EventEntity = z.infer<typeof EventEntitySchema>;

/**
 * Base of attendee-preferences/requests
 * @usage
 *   - Changed by users (e.g. Sponsor-Request or Hotel-Request)
 *   - Can be viewed/changed by admins
 */
const ParticipationBaseSchema = z.object({
  needsHotel: z.boolean().default(false),
  wantsEarlyArrival: z.boolean().default(false),
  wantsLateDeparture: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
  /** Values for custom fields defined in the event */
  customFieldsData: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({})
}).strict();
type ParticipationBase = z.infer<typeof ParticipationBaseSchema>;


const EventCreateBaseSchema = EventBaseSchema.superRefine((data, ctx) => {
  if(data.endDate <= new Date()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End date must be in the future",
      path: ["endDate"],
    });
  }
});

export {
    EventCreateBaseSchema,
    EventIdSchema,
    EventEntitySchema,
    LocationSchema,
    ProductSchema,
    ParticipationBaseSchema,
}

export type {
  EventBase,
  EventEntity,
  EventId,
  Location,
  Product,
  ParticipationBase,
  StayPolicy
}
