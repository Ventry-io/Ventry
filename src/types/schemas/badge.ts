import { z } from "zod";

export const BADGE_FIELD_KEYS = [
  "photo",
  "displayName",
  "legalName",
  "ticketId",
  "ticketTier",
  "crewDepartment",
  "crewRole",
  "eventName",
  "qrCode",
  "customField",
  "staticText",
  "rectangle",
  "ellipse",
  "line",
] as const;

export const badgeFieldKeySchema = z.enum(BADGE_FIELD_KEYS);

export const badgeBackgroundSchema = z
  .object({
    color: z.string().min(1).default("#ffffff"),
    imageUrl: z.string().url().nullable().optional(),
    fit: z.enum(["cover", "contain", "stretch"]).default("cover"),
    positionX: z.number().min(0).max(100).default(50),
    positionY: z.number().min(0).max(100).default(50),
    fallbackPhotoUrls: z.array(z.string().url()).max(30).default([]),
  })
  .strict();

export const badgeElementSchema = z
  .object({
    id: z.string().min(1),
    type: badgeFieldKeySchema,
    label: z.string().min(1).max(80),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    width: z.number().min(1).max(100),
    height: z.number().min(1).max(100),
    fontSize: z.number().min(6).max(72).default(14),
    fontWeight: z.enum(["400", "600", "700"]).default("600"),
    color: z.string().min(1).default("#111827"),
    align: z.enum(["left", "center", "right"]).default("left"),
    staticText: z.string().max(200).optional(),
    customFieldId: z.string().max(120).optional(),
    shape: z.enum(["square", "circle"]).default("square"),
    backgroundColor: z.string().min(1).optional(),
    borderColor: z.string().min(1).optional(),
    borderWidth: z.number().min(0).max(20).optional(),
    customCss: z.string().max(2000).optional(),
  })
  .strict();

export const badgeTemplateInputSchema = z
  .object({
    name: z.string().min(1, "Template name is required").max(80),
    isDefault: z.boolean().default(false),
    widthMm: z.number().min(20).max(300).default(85),
    heightMm: z.number().min(20).max(300).default(55),
    background: badgeBackgroundSchema.default({ color: "#ffffff", fit: "cover", positionX: 50, positionY: 50, fallbackPhotoUrls: [] }),
    elements: z.array(badgeElementSchema).max(40).default([]),
  })
  .strict();

export const badgeTemplatePatchSchema = z
  .object({
    name: z.string().min(1, "Template name is required").max(80).optional(),
    isDefault: z.boolean().optional(),
    widthMm: z.number().min(20).max(300).optional(),
    heightMm: z.number().min(20).max(300).optional(),
    background: badgeBackgroundSchema.optional(),
    elements: z.array(badgeElementSchema).max(40).optional(),
  })
  .strict();

export const badgeAttendeeQuerySchema = z
  .object({
    status: z.enum(["ALL", "PENDING", "APPROVED", "CONFIRMED", "WAITLISTED"]).default("CONFIRMED"),
    ticketTier: z.string().optional(),
    search: z.string().optional(),
  })
  .strict();

export const badgeExportSchema = z
  .object({
    template: badgeTemplateInputSchema,
    attendeeIds: z.array(z.string()).min(1).max(250),
    format: z.enum(["html", "png"]).default("html"),
    pageMode: z.enum(["sheet", "single"]).default("sheet"),
  })
  .strict();

export type BadgeFieldKey = z.infer<typeof badgeFieldKeySchema>;
export type BadgeBackground = z.infer<typeof badgeBackgroundSchema>;
export type BadgeElement = z.infer<typeof badgeElementSchema>;
export type BadgeTemplateInput = z.infer<typeof badgeTemplateInputSchema>;
export type BadgeAttendeeQuery = z.infer<typeof badgeAttendeeQuerySchema>;
export type BadgeExportInput = z.infer<typeof badgeExportSchema>;
