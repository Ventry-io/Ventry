import { z } from "zod";

const note = z.string().trim().max(1000);
const requiredNote = note.min(1, "Add an audit note");
const id = z.string().trim().min(1).max(100);

export const roomInviteSchema = z.object({
  username: z.string().trim().min(1).max(255),
}).strict();

export const roomInvitationActionSchema = z.object({
  action: z.enum(["accept", "reject", "revoke"]),
  /** Accept only: the invitee confirms giving up their own room booking. */
  releaseOwnRoom: z.boolean().optional(),
}).strict();

export const roomSettingsSchema = z.object({
  roomGroupCutoffAt: z.coerce.date().nullable(),
}).strict();

export const createRoomsSchema = z.object({
  hotelId: id,
  productId: id,
  references: z.array(z.string().trim().min(1).max(100)).min(1).max(500)
    .refine((references) => new Set(references).size === references.length, "Room references must be unique"),
  availableFrom: z.coerce.date().nullable().optional(),
  availableUntil: z.coerce.date().nullable().optional(),
}).strict().refine(
  (data) => !data.availableFrom || !data.availableUntil || data.availableFrom < data.availableUntil,
  { message: "Availability end must be after its start", path: ["availableUntil"] },
);

export const roomGroupsActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), registrationIds: z.array(id).min(1).max(20), note: note.nullable().optional() }).strict(),
  z.object({ action: z.literal("remind") }).strict(),
]);

export const roomGroupActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), roomId: id, note: note.nullable().optional() }).strict(),
  z.object({ action: z.literal("unassign"), note: note.nullable().optional() }).strict(),
  z.object({ action: z.literal("split"), registrationIds: z.array(id).min(1).max(20), note: requiredNote }).strict(),
  z.object({ action: z.literal("merge"), sourceGroupId: id, note: requiredNote }).strict(),
  z.object({ action: z.literal("remove"), registrationId: id, note: requiredNote }).strict(),
]);
