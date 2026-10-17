import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BADGE_TEMPLATE, attendeeInitials, fitBadgeText, getBadgeElementValue, getBadgePhotoUrl, matchesBadgeConditions, normalizeBadgeTemplate, resolveBadgeTemplate, type BadgeAttendee } from "./badge";
import { badgeConditionSchema, badgeExportSchema, badgeTemplateInputSchema } from "@/types/schemas/badge";
import { prisma } from "@/lib/prisma/prisma";

vi.mock("@/lib/user/profilePicture", () => ({
  refreshSignedUrls: vi.fn(async pictures => pictures),
}));

vi.mock("@/lib/prisma/prisma", () => ({
  prisma: {
    registration: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
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

describe("badge crew schema compatibility", () => {
  const findMany = prisma.registration.findMany as unknown as ReturnType<typeof vi.fn>;
  const queryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;
  const registration = {
    id: "reg-1", ticketId: 42, status: "CONFIRMED", createdAt: new Date(),
    customFieldData: {}, preferences: {}, checkedInAt: null, checkInCount: 0,
    event: { name: "Test", organizationId: "org-1", startDate: new Date(), endDate: new Date() },
    user: { id: "user-1", name: "Ada", email: "ada@example.com", image: null, legalName: null, isAdmin: true, profilePictures: [] },
    registrationItems: [],
  };

  it.each(["role", "departmentId"])("loads event-scoped assignments when the old %s column is absent", async column => {
    const { loadBadgeAttendees } = await import("./server");
    findMany.mockReset().mockRejectedValueOnce(Object.assign(new Error(`The column AdminOrganizationMembership.${column} does not exist`), { code: "P2022" }))
      .mockResolvedValueOnce([registration]);
    queryRaw.mockReset().mockResolvedValueOnce([{ registrationId: "reg-1", role: "Lead", department: "Operations" }]);
    const attendees = await loadBadgeAttendees(8, { status: "CONFIRMED" });
    expect(attendees[0]).toMatchObject({ crewRole: "Lead", crewDepartment: "Operations" });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { eventId: 8, status: "CONFIRMED" },
      include: expect.objectContaining({ user: { select: expect.objectContaining({ adminProfile: false }) } }),
    }));
    const [sql, eventId] = queryRaw.mock.calls[0];
    expect(sql.join("?")).toContain('e."organizationId" = m."organizationId"');
    expect(sql.join("?")).toContain('WHERE a."eventId" = ?');
    expect(eventId).toBe(8);
  });

  it("keeps organization-scoped crew working on the original schema", async () => {
    const { loadBadgeAttendees } = await import("./server");
    findMany.mockReset().mockResolvedValueOnce([{ ...registration, user: {
      ...registration.user, adminProfile: { organizationMemberships: [
        { organizationId: "other-org", role: "Wrong role", department: null },
        { organizationId: "org-1", role: "Helper", department: { name: "Support" } },
      ] },
    } }]);
    queryRaw.mockReset();
    expect((await loadBadgeAttendees(8, { status: "CONFIRMED" }))[0]).toMatchObject({ crewRole: "Helper", crewDepartment: "Support" });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("propagates unrelated database errors", async () => {
    const { loadBadgeAttendees } = await import("./server");
    const error = Object.assign(new Error("The column user.username does not exist"), { code: "P2022" });
    findMany.mockReset().mockRejectedValueOnce(error);
    queryRaw.mockReset();
    await expect(loadBadgeAttendees(8, { status: "CONFIRMED" })).rejects.toBe(error);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("badge templates", () => {
  it("matches nested database fields, custom answers, booleans, and numeric comparisons", () => {
    const sample = { ...attendee, data: { user: { country: "DE", isAdmin: false }, products: [{ name: "Sponsor" }] } };
    expect(matchesBadgeConditions([
      { field: "user.country", operator: "equals", value: "DE" },
      { field: "user.isAdmin", operator: "equals", value: "false" },
      { field: "products.0.name", operator: "contains", value: "Sponsor" },
      { field: "customFieldData.helper", operator: "equals", value: "true" },
      { field: "ticketId", operator: "greaterThan", value: "40" },
    ], sample)).toBe(true);
    expect(matchesBadgeConditions([{ field: "ticketId", operator: "lessThan", value: "40" }], sample)).toBe(false);
    expect(matchesBadgeConditions([{ field: "missing", operator: "notEquals", value: "x" }], sample)).toBe(false);
    expect(matchesBadgeConditions([{ field: "missing", operator: "isEmpty", value: "" }], sample)).toBe(true);
    expect(matchesBadgeConditions([{ field: "customFieldData.helper", operator: "isNotEmpty", value: "" }], sample)).toBe(true);
    expect(matchesBadgeConditions([{ field: "email", operator: "greaterThan", value: "0" }], sample)).toBe(false);
    expect(matchesBadgeConditions([{ field: "constructor.name", operator: "equals", value: "Object" }], sample)).toBe(false);
    expect(badgeConditionSchema.safeParse({ field: "__proto__.name", operator: "equals", value: "" }).success).toBe(false);
  });

  it("uses the first matching background and filters layers without changing the saved design", () => {
    const conditions = [{ field: "customFieldData.helper", operator: "equals" as const, value: "true" }];
    const template = {
      ...DEFAULT_BADGE_TEMPLATE,
      background: { ...DEFAULT_BADGE_TEMPLATE.background, rules: [
        { id: "helper", conditions, color: "#fef3c7", imageUrl: null },
        { id: "later", conditions, color: "#000000" },
      ] },
      elements: [
        { ...DEFAULT_BADGE_TEMPLATE.elements[0], type: "image" as const, imageUrl: "https://cdn.example.com/helper.jpg", conditions },
        { ...DEFAULT_BADGE_TEMPLATE.elements[1], conditions: [{ ...conditions[0], value: "false" }] },
      ],
    };
    const parsed = badgeTemplateInputSchema.parse(template);
    const resolved = resolveBadgeTemplate(parsed, attendee);
    expect(resolved.background.color).toBe("#fef3c7");
    expect(resolved.background.imageUrl).toBeNull();
    expect(resolved.elements).toHaveLength(1);
    expect(resolveBadgeTemplate(parsed, { ...attendee, customFieldData: {} }).background.color).toBe(DEFAULT_BADGE_TEMPLATE.background.color);
    expect(parsed.elements).toHaveLength(2);
    const normalized = normalizeBadgeTemplate({ ...parsed, id: "design", eventId: 7 });
    expect(normalized.background.rules).toEqual(parsed.background.rules);
    expect(normalized.elements).toEqual(parsed.elements);
  });

  it("prints multiple designs per attendee in queue order with conditional images", async () => {
    const { renderPrintableBadgesHtml } = await import("./server");
    const template = {
      ...DEFAULT_BADGE_TEMPLATE,
      elements: [{ ...DEFAULT_BADGE_TEMPLATE.elements[1], type: "staticText" as const, staticText: "FRONT" }],
    };
    const back = { ...template, elements: [{ ...template.elements[0], staticText: "BACK" }] };
    const html = renderPrintableBadgesHtml(template, [attendee, { ...attendee, ticketId: 43 }], 7, "single", [back, back]);
    expect(html.match(/class="badge"/g)).toHaveLength(6);
    expect([...html.matchAll(/>(FRONT|BACK)<\/div>/g)].map(match => match[1])).toEqual(["FRONT", "BACK", "BACK", "FRONT", "BACK", "BACK"]);
    expect(html).toContain("break-after:page");
    expect(badgeExportSchema.safeParse({ template, attendeeIds: [attendee.id], additionalTemplates: Array(10).fill(back) }).success).toBe(false);
    const image = { ...template.elements[0], type: "image" as const, imageUrl: 'https://cdn.example.com/helper.jpg', conditions: [{ field: "customFieldData.helper", operator: "equals" as const, value: "true" }] };
    const matching = renderPrintableBadgesHtml({ ...template, elements: [image] }, [attendee], 7, "sheet");
    const other = renderPrintableBadgesHtml({ ...template, elements: [image] }, [{ ...attendee, customFieldData: {} }], 7, "sheet");
    expect(matching).toContain('src="https://cdn.example.com/helper.jpg"');
    expect(other).not.toContain("helper.jpg");
  });

  it("renders conditional uploaded images in PNG and rejects arbitrary server fetches", async () => {
    const sharp = (await import("sharp")).default;
    const { renderBadgePng, BadgeImageError } = await import("./server");
    const previousUrl = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = "https://storage.example.com";
    const source = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const fetchMock = vi.fn(async () => new Response(source));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const template = {
        ...DEFAULT_BADGE_TEMPLATE, widthMm: 20, heightMm: 20,
        background: { ...DEFAULT_BADGE_TEMPLATE.background, rules: [{ id: "red", conditions: [{ field: "ticketId", operator: "equals" as const, value: "42" }], imageUrl: "https://storage.example.com/storage/v1/object/public/banners/red.png" }] },
        elements: [],
      };
      const png = await renderBadgePng(template, attendee, 7);
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(Math.round(20 * 4 * 3.78));
      expect([...data.subarray(0, 3)]).toEqual([255, 0, 0]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(renderBadgePng({ ...template, background: { ...template.background, rules: [], imageUrl: "http://127.0.0.1/private" } }, attendee, 7)).rejects.toBeInstanceOf(BadgeImageError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      if (previousUrl === undefined) Reflect.deleteProperty(process.env, "SUPABASE_URL");
      else process.env.SUPABASE_URL = previousUrl;
    }
  });

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
