import { z } from "zod";

function luminance(hex: string) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** HTTPS only, no credentials, and no characters that could break out of a CSS url("…"). */
export const PageImageUrlSchema = z.url().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !/["'()\\\s<>]/.test(value);
  } catch { return false; }
}, "Use an HTTPS image URL");

const LinkUrlSchema = z.string().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" && !url.username && !url.password) || url.protocol === "mailto:";
  } catch { return false; }
}, "Use an https:// or mailto: link");

export const PageSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens").max(60);
const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const IdSchema = z.string().min(1).max(100);
const common = { id: IdSchema, cssClass: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, "Use a lowercase CSS class name").optional() };

export const LinkTargetSchema = z.union([z.object({ page: PageSlugSchema }).strict(), z.object({ url: LinkUrlSchema }).strict()]);
export const PageLinkSchema = z.object({ id: IdSchema, label: z.string().min(1).max(80), target: LinkTargetSchema }).strict();
const GalleryImageSchema = z.object({ url: PageImageUrlSchema, posterUrl: PageImageUrlSchema.optional(), alt: z.string().min(1, "Describe every image").max(300) }).strict();

export const LINK_ICONS = ["link", "website", "instagram", "youtube", "x", "facebook", "telegram", "email", "shop", "music", "art"] as const;

export const TELEGRAM_CHANNEL = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

const leafBlocks = [
  z.object({ ...common, type: z.literal("heading"), text: z.string().min(1).max(200), level: z.union([z.literal(2), z.literal(3)]).default(2), align: z.enum(["left", "center"]).default("left") }).strict(),
  z.object({ ...common, type: z.literal("text"), title: z.string().max(200), text: z.string().max(10000) }).strict(),
  z.object({ ...common, type: z.literal("image"), url: PageImageUrlSchema, posterUrl: PageImageUrlSchema.optional(), alt: z.string().min(1, "Describe the image").max(300), caption: z.string().max(300).optional() }).strict(),
  z.object({ ...common, type: z.literal("gallery"), images: z.array(GalleryImageSchema).min(1).max(24), columns: z.number().int().min(2).max(4).default(3) }).strict(),
  z.object({ ...common, type: z.literal("button"), label: z.string().min(1).max(80), target: LinkTargetSchema, variant: z.enum(["contained", "outlined"]).default("contained") }).strict(),
  z.object({
    ...common, type: z.literal("link"), display: z.enum(["text", "icon", "image"]).default("text"),
    label: z.string().min(1, "Every link needs a text, also used by screen readers").max(120), target: LinkTargetSchema,
    icon: z.enum(LINK_ICONS).default("link"), imageUrl: PageImageUrlSchema.optional(), posterUrl: PageImageUrlSchema.optional(),
    align: z.enum(["left", "center"]).default("left"),
  }).strict(),
  z.object({ ...common, type: z.literal("linkMenu"), label: z.string().min(1).max(80), links: z.array(PageLinkSchema).min(1).max(15) }).strict(),
  z.object({ ...common, type: z.literal("accordion"), items: z.array(z.object({ id: IdSchema, title: z.string().min(1).max(200), text: z.string().max(5000) }).strict()).min(1).max(30) }).strict(),
  z.object({ ...common, type: z.literal("divider") }).strict(),
  z.object({ ...common, type: z.literal("spacer"), size: z.enum(["sm", "md", "lg"]).default("md") }).strict(),
  z.object({ ...common, type: z.literal("telegram"), channel: z.string().regex(TELEGRAM_CHANNEL, "Use a public channel username, without @ or a URL"), limit: z.number().int().min(3).max(20).default(5), pinned: z.array(z.number().int().positive().max(2147483647)).max(10).default([]) }).strict(),
  z.object({ ...common, type: z.enum(["about", "location", "attendees"]) }).strict(),
] as const;

export const LeafBlockSchema = z.discriminatedUnion("type", [...leafBlocks]);
const SectionSchema = z.object({
  ...common, type: z.literal("section"),
  columns: z.array(z.array(LeafBlockSchema).max(20)).min(1).max(3),
  background: ColorSchema.optional(), foreground: ColorSchema.optional(),
  backgroundImage: PageImageUrlSchema.optional(), padding: z.enum(["sm", "md", "lg"]).default("md"),
}).strict();
export const PageBlockSchema = z.discriminatedUnion("type", [...leafBlocks, SectionSchema]);

export const PageSchema = z.object({ id: IdSchema, slug: PageSlugSchema, title: z.string().min(1).max(80), blocks: z.array(PageBlockSchema).max(60) }).strict();
export const NavItemSchema = z.object({ id: IdSchema, label: z.string().min(1).max(80), target: LinkTargetSchema.optional(), children: z.array(PageLinkSchema).max(15).default([]) }).strict()
  .refine(item => item.target || item.children.length, "A menu item needs a link or dropdown entries");

export const PAGE_FONTS = {
  "sans-serif": "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  monospace: "ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace",
  rounded: "ui-rounded, 'SF Pro Rounded', Nunito, 'Varela Round', system-ui, sans-serif",
  humanist: "Optima, Candara, 'Noto Sans', 'Gill Sans', sans-serif",
  geometric: "Avenir, Montserrat, Corbel, 'URW Gothic', 'Century Gothic', sans-serif",
  slab: "Rockwell, 'Roboto Slab', 'Courier New', 'DejaVu Serif', serif",
  handwritten: "'Segoe Print', 'Bradley Hand', Chilanka, 'Comic Sans MS', cursive",
} as const;

export const PageThemeSchema = z.object({
  font: z.enum(Object.keys(PAGE_FONTS) as [keyof typeof PAGE_FONTS, ...(keyof typeof PAGE_FONTS)[]]).default("sans-serif"),
  customFontUrl: PageImageUrlSchema.optional(),
  background: ColorSchema.default("#ffffff"),
  foreground: ColorSchema.default("#202020"),
  accent: ColorSchema.default("#1565c0"),
  headerUrl: PageImageUrlSchema.optional(),
  headerPosterUrl: PageImageUrlSchema.optional(),
  backgroundImage: PageImageUrlSchema.optional(),
  customCss: z.string().max(20_000, "Custom CSS is limited to 20 KB").default(""),
}).strict();

const DEFAULT_BLOCKS = [{ id: "about", type: "about" }, { id: "location", type: "location" }, { id: "attendees", type: "attendees" }];

/** v1 stored theme fields and blocks at the top level; v2 nests them in theme and pages[0]. */
function upgrade(value: unknown) {
  if (!value || typeof value !== "object" || "version" in value || "pages" in value) return value;
  const { blocks, font, background, foreground, accent, headerUrl, headerPosterUrl } = value as Record<string, unknown>;
  return {
    version: 2,
    theme: Object.fromEntries(Object.entries({ font, background, foreground, accent, headerUrl, headerPosterUrl }).filter(([, v]) => v !== undefined)),
    nav: [],
    pages: [{
      id: "home", slug: "home", title: "Home",
      blocks: Array.isArray(blocks) ? blocks.map(block => block?.type === "telegram" && Array.isArray(block.posts)
        ? { id: block.id, type: "telegram", channel: block.channel, pinned: block.posts } : block) : DEFAULT_BLOCKS,
    }],
  };
}

type Leaf = z.infer<typeof LeafBlockSchema>;
/** Top-level blocks plus the children of every section. */
export function allBlocks(blocks: z.infer<typeof PageBlockSchema>[]): z.infer<typeof PageBlockSchema>[] {
  return blocks.flatMap(block => block.type === "section" ? [block, ...block.columns.flat()] : [block]);
}

const EventPageObject = z.object({
  version: z.literal(2).default(2),
  theme: PageThemeSchema.default(PageThemeSchema.parse({})),
  nav: z.array(NavItemSchema).max(12).default([]),
  pages: z.array(PageSchema).min(1).max(20).default([{ id: "home", slug: "home", title: "Home", blocks: DEFAULT_BLOCKS as never }]),
}).strict().superRefine((page, ctx) => {
  const { theme } = page;
  for (const key of ["foreground", "accent"] as const) {
    if (contrastRatio(theme.background, theme[key]) < 4.5) {
      ctx.addIssue({ code: "custom", path: ["theme", key], message: "Choose text and link colors with at least 4.5:1 contrast against the background" });
    }
  }
  const slugs = new Set(page.pages.map(p => p.slug));
  if (slugs.size !== page.pages.length) ctx.addIssue({ code: "custom", path: ["pages"], message: "Each page needs a unique address" });
  const ids = new Set<string>();
  const targets = [...page.nav.flatMap(item => [item.target, ...item.children.map(child => child.target)])];
  page.pages.forEach((p, pageIndex) => {
    for (const block of p.blocks) {
      if (block.type === "section" && block.background && contrastRatio(block.background, block.foreground || theme.foreground) < 4.5) {
        ctx.addIssue({ code: "custom", path: ["pages", pageIndex, "blocks"], message: "Section text needs at least 4.5:1 contrast against its background" });
      }
    }
    for (const block of allBlocks(p.blocks)) {
      if (ids.has(block.id)) ctx.addIssue({ code: "custom", path: ["pages", pageIndex, "blocks"], message: "Each element needs a unique ID" });
      ids.add(block.id);
      if (block.type === "button" || block.type === "link") targets.push(block.target);
      if (block.type === "link" && block.display === "image" && !block.imageUrl) {
        ctx.addIssue({ code: "custom", path: ["pages", pageIndex, "blocks"], message: "An image link needs an image" });
      }
      if (block.type === "linkMenu") targets.push(...block.links.map(link => link.target));
    }
  });
  for (const target of targets) {
    if (target && "page" in target && !slugs.has(target.page)) {
      ctx.addIssue({ code: "custom", path: ["nav"], message: `A link points to the missing page "${target.page}"` });
    }
  }
  if (JSON.stringify(page).length > 200_000) ctx.addIssue({ code: "custom", path: [], message: "The page design is too large (max 200 KB)" });
});

export const EventPageSchema = z.preprocess(upgrade, EventPageObject);

export type EventPage = z.infer<typeof EventPageObject>;
export type PageTheme = EventPage["theme"];
export type SitePage = z.infer<typeof PageSchema>;
export type PageBlock = z.infer<typeof PageBlockSchema>;
export type LeafBlock = Leaf;
export type LinkTarget = z.infer<typeof LinkTargetSchema>;
export type NavItem = z.infer<typeof NavItemSchema>;

export function normalizeEventPage(value: unknown): EventPage {
  const parsed = EventPageSchema.safeParse(value);
  return parsed.success ? parsed.data : EventPageSchema.parse({});
}

export function linkHref(eventId: number, target: LinkTarget, homeSlug: string) {
  if ("url" in target) return target.url;
  return target.page === homeSlug ? `/events/${eventId}` : `/events/${eventId}/p/${target.page}`;
}
