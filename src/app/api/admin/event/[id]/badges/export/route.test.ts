import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { loadBadgeAttendeesByIds, renderPrintableBadgesHtml } from "@/lib/badges/server";
import { DEFAULT_BADGE_TEMPLATE } from "@/lib/badges/badge";

vi.mock("@/lib/auth/event-admin", () => ({ checkEventAdminAuth: vi.fn() }));
vi.mock("@/lib/badges/server", () => ({
  loadBadgeAttendeesByIds: vi.fn(), renderPrintableBadgesHtml: vi.fn(), renderBadgePng: vi.fn(), BadgeImageError: class extends Error {},
}));

const context = { params: Promise.resolve({ id: "7" }) };
const body = { template: DEFAULT_BADGE_TEMPLATE, attendeeIds: ["registration-1"], additionalTemplates: [{ ...DEFAULT_BADGE_TEMPLATE, name: "Back" }] };
const request = (input = body) => new NextRequest("http://localhost/api/admin/event/7/badges/export", { method: "POST", body: JSON.stringify(input) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkEventAdminAuth).mockResolvedValue({ authorized: true, adminId: "admin-1" });
  vi.mocked(loadBadgeAttendeesByIds).mockResolvedValue([]);
  vi.mocked(renderPrintableBadgesHtml).mockReturnValue("<html>queue</html>");
});

it("checks event access before loading attendee data", async () => {
  vi.mocked(checkEventAdminAuth).mockResolvedValue({ authorized: false, error: "Forbidden" });
  expect((await POST(request(), context)).status).toBe(403);
  expect(loadBadgeAttendeesByIds).not.toHaveBeenCalled();
});

it("passes ordered designs to the renderer using attendees scoped to the route event", async () => {
  const attendees = [{ registrationId: "registration-1" }] as Awaited<ReturnType<typeof loadBadgeAttendeesByIds>>;
  vi.mocked(loadBadgeAttendeesByIds).mockResolvedValue(attendees);
  const response = await POST(request(), context);
  expect(response.status).toBe(200);
  expect(loadBadgeAttendeesByIds).toHaveBeenCalledWith(7, ["registration-1"]);
  expect(renderPrintableBadgesHtml).toHaveBeenCalledWith(body.template, attendees, 7, "sheet", body.additionalTemplates);
});

it("rejects invalid rule paths before querying attendees", async () => {
  const response = await POST(request({ ...body, template: {
    ...body.template, elements: [{ ...body.template.elements[0], conditions: [{ field: "__proto__.role", operator: "equals", value: "Sponsor" }] }],
  } }), context);
  expect(response.status).toBe(422);
  expect(loadBadgeAttendeesByIds).not.toHaveBeenCalled();
});
