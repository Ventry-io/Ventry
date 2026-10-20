import { z } from "zod";

/**
 * Hotel/Stay policy of the event.
 * Policies are now scoped per hotel so the registration flow can calculate
 * early/late fees from the selected room price while still allowing overrides.
 */
const StayFeeModeSchema = z.enum(["AUTO", "CUSTOM"]);

const HotelStayPolicySchema = z.object({
  main: z.object({
    /** First regular Check-in date */
    checkIn: z.coerce.date(),
    /** Regular Check-out date */
    checkOut: z.coerce.date(),
  }).strict(),

  earlyArrival: z.object({
    /** Does event allow early arrival? */
    enabled: z.boolean().default(false),
    /** Optional early check-in date */
    from: z.coerce.date().optional(),
    /** Auto = use the selected room price; Custom = explicit fee */
    pricingMode: StayFeeModeSchema.default("AUTO"),
    /** costs per extra-night (if relevant) */
    feePerNight: z.coerce.number().nonnegative().optional(),
  }).strict(),

  lateDeparture: z.object({
    /** Is late-departure allowed?  */
    enabled: z.boolean().default(false),
    /** Optional late check-out date */
    until: z.coerce.date().optional(),
    /** Auto = use the selected room price; Custom = explicit fee */
    pricingMode: StayFeeModeSchema.default("AUTO"),
    /** costs per extra-night (if relevant) */
    feePerNight: z.coerce.number().nonnegative().optional(),
  }).strict()
})
.superRefine((data, ctx) => {
  // Main order
  if(data.main.checkOut <= data.main.checkIn) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["main", "checkOut"],
      message: "Main check-out date must be after check-in date"
    })
  }

  // Early arrival
  if(data.earlyArrival.enabled) {
    if(!data.earlyArrival.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["earlyArrival", "from"],
        message: "Early arrival 'from' must be specified when enabled"
      });
    } else if(data.earlyArrival.from >= data.main.checkIn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["earlyArrival", "from"],
        message: "Early arrival 'from' must be before main check-in date"
      });
    }
  }

  // Late departure
  if(data.lateDeparture.enabled) {
    if(!data.lateDeparture.until) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lateDeparture", "until"],
        message: "Late departure 'until' must be specified when enabled"
      });
    } else if(data.lateDeparture.until <= data.main.checkOut) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lateDeparture", "until"],
        message: "Late departure 'until' must be after main check-out date"
      });
    }
  }
}).strict();

const HotelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Hotel name is required"),
  isPrimary: z.boolean().default(false),
  roomTypeProductIds: z.array(z.string().min(1)).default([]),
  stayPolicy: HotelStayPolicySchema,
}).strict();

export const StayPolicySchema = z.object({
  version: z.literal(2).default(2),
  mainLocationIsAccommodation: z.boolean().default(false),
  allowOverflowHotels: z.boolean().default(false),
  samePolicyAcrossHotels: z.boolean().default(false),
  hotels: z.array(HotelSchema).default([]),
}).superRefine((data, ctx) => {
  if ((data.mainLocationIsAccommodation || data.allowOverflowHotels) && data.hotels.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["hotels"],
      message: "Add at least one hotel when accommodation is enabled.",
    });
  }

  if (data.hotels.length > 0) {
    const primaryHotelCount = data.hotels.filter(hotel => hotel.isPrimary).length;
    if (primaryHotelCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hotels"],
        message: "Exactly one hotel must be marked as primary.",
      });
    }
  }

  data.hotels.forEach((hotel, index) => {
    if (hotel.roomTypeProductIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hotels", index, "roomTypeProductIds"],
        message: "Add at least one room type for each hotel.",
      });
    }
  });
}).strict();
export type StayPolicy = z.infer<typeof StayPolicySchema>;
