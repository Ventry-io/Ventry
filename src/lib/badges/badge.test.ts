import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BADGE_TEMPLATE, attendeeInitials, fitBadgeText, getBadgeElementValue, getBadgePhotoUrl, type BadgeAttendee } from "./badge";
import { badgeTemplateInputSchema } from "@/types/schemas/badge";

vi.mock("@/lib/user/profilePicture", () => ({
  refreshSignedUrls: vi.fn(async pictures => pictures),
}));

vi.mock("@/lib/prisma/prisma", () => ({
  prisma: {
    registration: {
      findMany: vi.fn(),
    },
  },
}));

const attendee: BadgeAttendee = {
  id: "reg-1",
  registrationId: "reg-1",
  ticketId: 42,
  status: "CONFIRMED",
  displayName: "Ada Lovelace",
  legalName: "Augusta Ada King",
  email: "ada@example.com",
  photoUrl: "https://cdn.example.com/ada.jpg",
  ticketTier: "Weekend Pass",
  eventName: "Ventry Con",
  customFieldData: {
    handle: "ada",
    helper: true,
  },
};

describe("badge templates", () => {
  it("validates the default badge template", () => {
    expect(badgeTemplateInputSchema.safeParse(DEFAULT_BADGE_TEMPLATE).success).toBe(true);
  });

  it("validates shape elements with optional custom CSS", () => {
    const result = badgeTemplateInputSchema.safeParse({
      ...DEFAULT_BADGE_TEMPLATE,
      elements: [
        ...DEFAULT_BADGE_TEMPLATE.elements,
        {
          id: "accent",
          type: "rectangle",
          label: "Accent",
          x: 5,
          y: 80,
          width: 90,
          height: 4,
          fontSize: 8,
          fontWeight: "600",
          color: "#2563eb",
          align: "left",
          shape: "square",
          backgroundColor: "#2563eb",
          borderColor: "#1d4ed8",
          borderWidth: 1,
          customCss: "opacity:0.7;",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("resolves attendee-backed field values", () => {
    expect(getBadgeElementValue({ ...DEFAULT_BADGE_TEMPLATE.elements[1], type: "displayName" }, attendee, 7)).toBe("Ada Lovelace");
    expect(getBadgeElementValue({ ...DEFAULT_BADGE_TEMPLATE.elements[2], type: "ticketId" }, attendee, 7)).toBe("#42");
    expect(getBadgeElementValue({ ...DEFAULT_BADGE_TEMPLATE.elements[3], type: "ticketTier" }, attendee, 7)).toBe("Weekend Pass");
  });

  it("resolves custom fields and QR payloads", () => {
    expect(
      getBadgeElementValue(
        {
          ...DEFAULT_BADGE_TEMPLATE.elements[1],
          type: "customField",
          customFieldId: "handle",
        },
        attendee,
        7,
      ),
    ).toBe("ada");

    expect(getBadgeElementValue({ ...DEFAULT_BADGE_TEMPLATE.elements[4], type: "qrCode" }, attendee, 7)).toBe("ventry:ticket:v1:7:42");
  });

  it("builds initials from display names", () => {
    expect(attendeeInitials("Ada Lovelace")).toBe("AL");
    expect(attendeeInitials("")).toBe("?");
  });

  it("assigns fallback photos only when attendees have no profile photo", () => {
    const template = {
      ...DEFAULT_BADGE_TEMPLATE,
      background: {
        ...DEFAULT_BADGE_TEMPLATE.background,
        fallbackPhotoUrls: [
          "https://cdn.example.com/fallback-1.jpg",
          "https://cdn.example.com/fallback-2.jpg",
        ],
      },
    };
    const attendeeWithoutPhoto = { ...attendee, photoUrl: null };

    expect(getBadgePhotoUrl(template, attendee)).toBe("https://cdn.example.com/ada.jpg");
    expect(getBadgePhotoUrl(template, attendeeWithoutPhoto)).toMatch(/^https:\/\/cdn\.example\.com\/fallback-[12]\.jpg$/);
    expect(getBadgePhotoUrl(template, attendeeWithoutPhoto)).toBe(getBadgePhotoUrl(template, attendeeWithoutPhoto));
  });

  it("reduces long text to fit inside its badge element", () => {
    const element = {
      ...DEFAULT_BADGE_TEMPLATE.elements[1],
      width: 20,
      height: 8,
      fontSize: 18,
    };
    const fitted = fitBadgeText(DEFAULT_BADGE_TEMPLATE, element, "Ada Lovelace-Who-Has-A-Very-Long-Badge-Name");

    expect(fitted.fontSize).toBeLessThan(18);
    expect(fitted.lines.length).toBeGreaterThan(1);
  });

  it("renders printable QR fields as SVG instead of raw payload text", async () => {
    process.env.DATABASE_URL ||= "prisma://localhost/?api_key=test";
    const { renderPrintableBadgesHtml } = await import("./server");
    const html = renderPrintableBadgesHtml(DEFAULT_BADGE_TEMPLATE, [attendee], 7, "sheet");

    expect(html).toContain("<svg");
    expect(html).not.toContain(">ventry:ticket:v1:7:42<");
  });

  it("renders printable backgrounds as positioned images", async () => {
    process.env.DATABASE_URL ||= "prisma://localhost/?api_key=test";
    const { renderPrintableBadgesHtml } = await import("./server");
    const html = renderPrintableBadgesHtml(
      {
        ...DEFAULT_BADGE_TEMPLATE,
        background: {
          color: "#ffffff",
          imageUrl: "https://cdn.example.com/badge-bg.jpg",
          fit: "cover",
          positionX: 25,
          positionY: 75,
          fallbackPhotoUrls: [],
        },
      },
      [attendee],
      7,
      "sheet",
    );

    expect(html).toContain('class="badge-bg"');
    expect(html).toContain("object-position:25% 75%");
  });

  it("renders fallback photos for attendees without profile photos", async () => {
    process.env.DATABASE_URL ||= "prisma://localhost/?api_key=test";
    const { renderPrintableBadgesHtml } = await import("./server");
    const html = renderPrintableBadgesHtml(
      {
        ...DEFAULT_BADGE_TEMPLATE,
        background: {
          ...DEFAULT_BADGE_TEMPLATE.background,
          fallbackPhotoUrls: ["https://cdn.example.com/fallback.jpg"],
        },
      },
      [{ ...attendee, photoUrl: null }],
      7,
      "sheet",
    );

    expect(html).toContain('src="https://cdn.example.com/fallback.jpg"');
    expect(html).not.toContain(">AL<");
  });

  it("renders printable long text with a fitted font size", async () => {
    process.env.DATABASE_URL ||= "prisma://localhost/?api_key=test";
    const { renderPrintableBadgesHtml } = await import("./server");
    const html = renderPrintableBadgesHtml(
      {
        ...DEFAULT_BADGE_TEMPLATE,
        elements: [
          {
            ...DEFAULT_BADGE_TEMPLATE.elements[1],
            width: 20,
            height: 8,
            fontSize: 18,
          },
        ],
      },
      [{ ...attendee, displayName: "Ada Lovelace-Who-Has-A-Very-Long-Badge-Name" }],
      7,
      "sheet",
    );

    expect(html).toContain("font-size:6px");
  });

  it("renders printable shape elements with custom CSS", async () => {
    process.env.DATABASE_URL ||= "prisma://localhost/?api_key=test";
    const { renderPrintableBadgesHtml } = await import("./server");
    const html = renderPrintableBadgesHtml(
      {
        ...DEFAULT_BADGE_TEMPLATE,
        elements: [
          {
            id: "line",
            type: "line",
            label: "Line",
            x: 5,
            y: 90,
            width: 90,
            height: 2,
            fontSize: 8,
            fontWeight: "600",
            color: "#2563eb",
            align: "left",
            shape: "square",
            backgroundColor: "#2563eb",
            borderColor: "#1d4ed8",
            borderWidth: 0,
            customCss: "opacity:0.6;",
          },
        ],
      },
      [attendee],
      7,
      "sheet",
    );

    expect(html).toContain("border-radius:999px");
    expect(html).toContain("opacity:0.6;");
  });
});
