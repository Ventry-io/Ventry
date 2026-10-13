import { z } from "zod";

export const crewAssignmentSchema = z.object({
  accessLevel: z.enum(["READ", "WRITE"]).default("READ"),
  departmentId: z.string().min(1).nullable().default(null),
  role: z.string().trim().max(80).nullable().default(null),
});

export const crewResourceSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(100),
    url: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine(
        (value) => ["https:", "http:"].includes(new URL(value).protocol),
        "Use an http or https link",
      ),
  })
  .strict();

export const crewUpdateSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("department"),
      id: z.string().min(1).optional(),
      name: z.string().trim().min(1).max(80),
      planning: z.string().trim().max(10000),
    })
    .strict(),
  z.object({ action: z.literal("deleteDepartment"), id: z.string().min(1) }).strict(),
  // ponytail: 100 shared links; use a resource table for larger hubs or per-link permissions.
  z
    .object({
      action: z.literal("resources"),
      updatedAt: z.iso.datetime(),
      resources: z
        .array(crewResourceSchema)
        .max(100)
        .refine(
          (links) => new Set(links.map((link) => link.id)).size === links.length,
          "Link IDs must be unique",
        ),
    })
    .strict(),
]);

export type CrewAssignment = z.infer<typeof crewAssignmentSchema>;
export type CrewResource = z.infer<typeof crewResourceSchema>;
export type CrewDepartment = { id: string; name: string; planning: string };
