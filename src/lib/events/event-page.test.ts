import { describe, expect, it } from "vitest";
import { ticketPriceLabel } from "./pricing";
import { withEventScope } from "./admin-context";
import { EventPageSchema, normalizeEventPage } from "@/types/schemas/event/page";
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
  const page = {
    font: "serif", foreground: "#ffffff", background: "#202020", accent: "#88bbff",
    headerUrl: "https://example.com/header.gif", headerPosterUrl: "https://example.com/header.jpg",
    blocks: [{ id: "news", type: "telegram", channel: "event_news", posts: [12, 15] }, { id: "text", type: "text", title: "Meeting point", text: "Meet at the main entrance." }],
  };
  it("retains block order and customization through serialization", () => {
    const parsed = EventPageSchema.parse(page);
    expect(EventPageSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(adminUpdateEventSchema.parse({ pageDesign: page }).pageDesign).toEqual(parsed);
    expect(adminUpdateEventSchema.parse({ name: "New name" })).not.toHaveProperty("pageDesign");
  });
  it.each([
    { headerUrl: "javascript:alert(1)" }, { headerUrl: "http://example.com/image.jpg" },
    { headerUrl: "not a URL" },
    { headerUrl: "https://user:password@example.com/image.jpg" },
    { background: "red" }, { foreground: "#eeeeee", background: "#ffffff" },
    { blocks: [{ id: "private", type: "telegram", channel: "+private_invite", posts: [1] }] },
    { blocks: [{ id: "private", type: "telegram", channel: "https://t.me/c/123", posts: [1] }] },
    { blocks: [{ id: "bad", type: "telegram", channel: "event_news", posts: [0] }] },
    { blocks: [{ id: "bad", type: "image", url: "https://example.com/x.jpg", alt: "" }] },
    { blocks: [{ id: "same", type: "about" }, { id: "same", type: "location" }] },
    { blocks: [{ id: "bad", type: "html", html: "<script>alert(1)</script>" }] },
  ])("rejects unsafe or inaccessible configuration: %j", invalid => {
    expect(EventPageSchema.safeParse({ ...page, ...invalid }).success).toBe(false);
  });
  it("uses existing content when no design is configured", () => {
    expect(normalizeEventPage(null).blocks.map(block => block.type)).toEqual(["about", "location", "attendees"]);
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
