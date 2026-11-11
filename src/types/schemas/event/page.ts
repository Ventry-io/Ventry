import { z } from "zod";

function luminance(hex: string) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export const PageImageUrlSchema = z.url().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}, "Use an HTTPS image URL");

export const PageBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().max(100), type: z.literal("text"), title: z.string().max(200), text: z.string().max(10000) }).strict(),
  z.object({ id: z.string().max(100), type: z.literal("image"), url: PageImageUrlSchema, alt: z.string().min(1).max(300) }).strict(),
  z.object({ id: z.string().max(100), type: z.literal("telegram"), channel: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/, "Use a public channel username, without @ or a URL"), posts: z.array(z.number().int().positive().max(2147483647)).min(1).max(10) }).strict(),
  z.object({ id: z.string().max(100), type: z.enum(["about", "location", "attendees"]) }).strict(),
]);

export const EventPageSchema = z.object({
  font: z.enum(["sans-serif", "serif", "monospace"]).default("sans-serif"),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
  foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#202020"),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#1565c0"),
  headerUrl: PageImageUrlSchema.optional(),
  headerPosterUrl: PageImageUrlSchema.optional(),
  blocks: z.array(PageBlockSchema).max(30).default([
    { id: "about", type: "about" }, { id: "location", type: "location" }, { id: "attendees", type: "attendees" },
  ]),
}).strict().superRefine((page, ctx) => {
  const background = luminance(page.background);
  for (const key of ["foreground", "accent"] as const) {
    const color = luminance(page[key]);
    if ((Math.max(background, color) + 0.05) / (Math.min(background, color) + 0.05) < 4.5) {
      ctx.addIssue({ code: "custom", path: [key], message: "Choose text and link colors with at least 4.5:1 contrast against the background" });
    }
  }
  if (new Set(page.blocks.map(block => block.id)).size !== page.blocks.length) {
    ctx.addIssue({ code: "custom", path: ["blocks"], message: "Each element needs a unique ID" });
  }
});

export type EventPage = z.infer<typeof EventPageSchema>;
export type PageBlock = z.infer<typeof PageBlockSchema>;

export function normalizeEventPage(value: unknown): EventPage {
  const parsed = EventPageSchema.safeParse(value);
  return parsed.success ? parsed.data : EventPageSchema.parse({});
}
