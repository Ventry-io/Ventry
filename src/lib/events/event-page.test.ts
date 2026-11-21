import { describe, expect, it } from "vitest";
import { ticketPriceLabel } from "./pricing";
import { withEventScope } from "./admin-context";
import { EventPageSchema, normalizeEventPage } from "@/types/schemas/event/page";
import { applyTemplate, PAGE_TEMPLATES } from "./page-templates";
import { adminCreateEventSchema, adminUpdateEventSchema } from "@/types/schemas/event/admin";
import { ProductSchema } from "@/types/schemas/event/base";

describe("ticket prices", () => {
  it.each([
    [[], null],
    [[{ type: "ADDON", price: 0 }], null],
    [[{ type: "TICKET", price: null }], null],
    [[{ type: "TICKET" }], null],
    [[{ type: "TICKET", price: Number.NaN }], null],
    [[{ type: "TICKET", price: 0 }, { type: "ACCOMMODATION", price: 100 }], "Das Event ist free"],
    [[{ type: "TICKET", price: 0 }, { type: "TICKET", price: 10 }], "0,00 € – 10,00 €"],
    [[{ type: "TICKET", price: 10 }], "10,00 €"],
  ])("formats only known admission prices: %j", (products, label) => {
    expect(ticketPriceLabel(products)).toBe(label);
  });
  it("supports English", () => expect(ticketPriceLabel([{ type: "TICKET", price: 0 }], "en")).toBe("This event is free"));
  it.each([null, undefined, "", " ", false, []])("does not coerce missing or invalid ticket prices to zero: %j", price => {
    expect(ProductSchema.safeParse({ name: "Admission", type: "TICKET", price }).success).toBe(false);
  });
});

describe("event pages", () => {
  const theme = { font: "serif", foreground: "#ffffff", background: "#202020", accent: "#88bbff", headerUrl: "https://example.com/header.gif", headerPosterUrl: "https://example.com/header.jpg" };
  const page = {
    version: 2, theme,
    nav: [{ id: "n1", label: "Info", children: [{ id: "n2", label: "Artists", target: { page: "artists" } }, { id: "n3", label: "Shop", target: { url: "https://shop.example.com" } }] }],
    pages: [
      { id: "home", slug: "home", title: "Home", blocks: [{ id: "news", type: "telegram", channel: "event_news", pinned: [12] }, { id: "text", type: "text", title: "Meeting point", text: "Meet at the main entrance." }] },
      { id: "artists", slug: "artists", title: "Artists", blocks: [{ id: "grid", type: "section", columns: [[{ id: "g", type: "gallery", images: [{ url: "https://example.com/a.png", alt: "Art" }] }], [{ id: "faq", type: "accordion", items: [{ id: "q", title: "Q", text: "A" }] }]] }] },
    ],
  };
  const withPage = (blocks: unknown[]) => ({ ...page, pages: [{ id: "home", slug: "home", title: "Home", blocks }] , nav: [] });
  it("retains pages, menu and customization through serialization", () => {
    const parsed = EventPageSchema.parse(page);
    expect(EventPageSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    // The page is only written through the draft/publish route, never through event settings.
    expect(adminUpdateEventSchema.safeParse({ pageDesign: page }).success).toBe(false);
  });
  it("upgrades version 1 designs to the first page", () => {
    const upgraded = EventPageSchema.parse({ ...theme, blocks: [{ id: "news", type: "telegram", channel: "event_news", posts: [12, 15] }, { id: "about", type: "about" }] });
    expect(upgraded.theme).toMatchObject(theme);
    expect(upgraded.pages).toHaveLength(1);
    expect(upgraded.pages[0].blocks).toEqual([{ id: "news", type: "telegram", channel: "event_news", pinned: [12, 15], limit: 5 }, { id: "about", type: "about" }]);
  });
  it.each([
    ["javascript header", { ...page, theme: { ...theme, headerUrl: "javascript:alert(1)" } }],
    ["http header", { ...page, theme: { ...theme, headerUrl: "http://example.com/image.jpg" } }],
    ["credentials in URL", { ...page, theme: { ...theme, headerUrl: "https://user:password@example.com/image.jpg" } }],
    ["quote in URL", { ...page, theme: { ...theme, headerUrl: "https://example.com/a\")%20x.jpg" } }],
    ["named color", { ...page, theme: { ...theme, background: "red" } }],
    ["low contrast", { ...page, theme: { ...theme, foreground: "#eeeeee", background: "#ffffff" } }],
    ["private channel", withPage([{ id: "p", type: "telegram", channel: "+private_invite" }])],
    ["channel URL", withPage([{ id: "p", type: "telegram", channel: "https://t.me/c/123" }])],
    ["image without alt", withPage([{ id: "bad", type: "image", url: "https://example.com/x.jpg", alt: "" }])],
    ["duplicate ids", withPage([{ id: "same", type: "about" }, { id: "s", type: "section", columns: [[{ id: "same", type: "divider" }]] }])],
    ["html block", withPage([{ id: "bad", type: "html", html: "<script>alert(1)</script>" }])],
    ["nested section", withPage([{ id: "a", type: "section", columns: [[{ id: "b", type: "section", columns: [[]] }]] }])],
    ["javascript link", withPage([{ id: "b", type: "button", label: "Go", target: { url: "javascript:alert(1)" } }])],
    ["link to missing page", withPage([{ id: "b", type: "button", label: "Go", target: { page: "nowhere" } }])],
    ["duplicate slugs", { ...page, pages: [page.pages[0], { ...page.pages[1], slug: "home" }] }],
    ["bad slug", { ...page, pages: [page.pages[0], { ...page.pages[1], slug: "Artists Page" }] }],
    ["low-contrast section", withPage([{ id: "s", type: "section", background: "#202020", foreground: "#303030", columns: [[]] }])],
    ["bad css class", withPage([{ id: "a", type: "about", cssClass: "x\" {}" }])],
  ])("rejects unsafe or inaccessible configuration: %s", (_name, invalid) => {
    expect(EventPageSchema.safeParse(invalid).success).toBe(false);
  });
  it("uses existing content when no design is configured", () => {
    for (const value of [null, {}, "broken"]) {
      expect(normalizeEventPage(value).pages[0].blocks.map(block => block.type)).toEqual(["about", "location", "attendees"]);
    }
  });
  it("ships templates that pass validation and keep uploaded media", () => {
    expect(PAGE_TEMPLATES.map(template => template.id)).toEqual(["classic", "convention", "artist-showcase", "walk"]);
    const current = normalizeEventPage({ ...theme });
    const applied = applyTemplate(current, PAGE_TEMPLATES[1]);
    expect(EventPageSchema.safeParse(applied).success).toBe(true);
    expect(applied.theme.headerUrl).toBe(theme.headerUrl);
    expect(applied.pages.map(p => p.slug)).toEqual(["home", "program", "venue", "travel", "faq"]);
    applied.pages[0].title = "Changed";
    expect(PAGE_TEMPLATES[1].design.pages[0].title).toBe("Home");
  });
  it("publishes a meeting without tickets or payment configuration", () => {
    const event = adminCreateEventSchema.parse({ name: "Park meeting", description: "Meet at the entrance", startDate: "2027-05-01T12:00:00Z", endDate: "2027-05-01T14:00:00Z", status: "PUBLISHED", location: { name: "Park", address: "Main entrance", city: "Berlin", country: "DE" } });
    expect(event.products).toEqual([]);
    expect(event.status).toBe("PUBLISHED");
    expect(event.requiresHotel).toBe(false);
  });
});

describe("admin event context", () => {
  const permissions = { OR: [{ ownerId: "admin" }, { organizationId: "organization" }] };
  it("intersects selection with permission filters", () => {
    expect(withEventScope(permissions, "42")).toEqual({ AND: [permissions, { id: 42 }] });
    expect(withEventScope(permissions, "43")).toEqual({ AND: [permissions, { id: 43 }] });
  });
  it.each(["", "invalid", "-1", "1.5", "1 OR 1=1", "9007199254740992"])("fails closed for invalid selection %s", id => {
    expect(withEventScope(permissions, id)).toEqual({ AND: [permissions, { id: -1 }] });
  });
});
