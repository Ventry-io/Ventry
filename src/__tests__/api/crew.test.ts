import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { crewAssignmentSchema, crewUpdateSchema } from "@/types/schemas/crew";
import { DEFAULT_BADGE_TEMPLATE, getBadgeElementValue } from "@/lib/badges/badge";

const p = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  event: { findUnique: vi.fn() },
  adminOrganizationMembership: { findUnique: vi.fn() },
  adminOrganization: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  crewDepartment: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
}));
const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma/prisma", () => ({ prisma: p }));
vi.mock("@/app/api/auth/auth", () => ({ auth: { api: { getSession: session } } }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/admin")>()),
  checkAdminAuth: vi.fn().mockResolvedValue({ authorized: true, adminId: "reader" }),
}));
import { checkAdminAuth, checkEventAdminAuth } from "@/lib/auth/admin";
import { GET, PATCH } from "@/app/api/admin/organizations/[id]/crew/route";

const params = { params: Promise.resolve({ id: "org" }) };
const request = (body?: unknown) =>
  new NextRequest(
    "https://local.dev:3443/api/admin/organizations/org/crew",
    body ? { method: "PATCH", body: JSON.stringify(body) } : {},
  );
const member = (accessLevel = "READ", adminId = "reader") => ({
  accessLevel,
  adminId,
  organization: { ownerId: "owner" },
});
const resourceUpdate = {
  action: "resources",
  updatedAt: "2026-10-01T12:00:00.000Z",
  resources: [
    { id: "link", title: "Shift schedule", url: "https://docs.google.com/spreadsheets/example" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAdminAuth).mockResolvedValue({ authorized: true, adminId: "reader" });
  p.adminOrganizationMembership.findUnique.mockResolvedValue(member());
  session.mockResolvedValue({ user: { id: "user" } });
  p.user.findUnique.mockResolvedValue({
    id: "user",
    email: "reader@example.com",
    isAdmin: true,
    adminProfile: {
      id: "reader",
      organizationMemberships: [
        {
          organizationId: "org",
          permissions: ["EVENT_APPROVAL"],
          accessLevel: "READ",
          organization: { ownerId: "owner" },
        },
      ],
    },
  });
  p.event.findUnique.mockResolvedValue({ ownerId: "owner", organizationId: "org" });
});

describe("crew permissions", () => {
  it("allows viewing but blocks a reader's event mutation even with extra permissions", async () => {
    expect((await checkEventAdminAuth(1)).authorized).toBe(true);
    expect((await checkEventAdminAuth(1, "EVENT_APPROVAL", undefined, true)).authorized).toBe(
      false,
    );
  });
  it("allows a writer, still enforces sensitive permissions", async () => {
    const user = await p.user.findUnique();
    user.adminProfile.organizationMemberships[0].accessLevel = "WRITE";
    expect((await checkEventAdminAuth(1, undefined, undefined, true)).authorized).toBe(true);
    expect((await checkEventAdminAuth(1, "STRIPE_FINANCES", undefined, true)).authorized).toBe(
      false,
    );
  });
  it("allows the organization owner without specialty permissions", async () => {
    const user = await p.user.findUnique();
    user.adminProfile.organizationMemberships[0].organization.ownerId = "reader";
    expect((await checkEventAdminAuth(1, "STRIPE_FINANCES", undefined, true)).authorized).toBe(
      true,
    );
  });
  it("rejects access to another organization's event", async () => {
    p.event.findUnique.mockResolvedValue({ ownerId: "outsider", organizationId: "another-org" });
    expect((await checkEventAdminAuth(1)).authorized).toBe(false);
  });
  it("never gives non-admin users crew access", async () => {
    p.user.findUnique.mockResolvedValue({ isAdmin: false, adminProfile: null });
    expect((await checkEventAdminAuth(1)).authorized).toBe(false);
  });
});

describe("crew hub", () => {
  it("readers can see planning, with canWrite=false", async () => {
    p.adminOrganization.findUniqueOrThrow.mockResolvedValue({ departments: [], crewResources: [] });
    const res = await GET(request(), params);
    expect(res.status).toBe(200);
    expect((await res.json()).canWrite).toBe(false);
  });
  it("blocks outsiders and reader writes", async () => {
    expect((await PATCH(request(resourceUpdate), params)).status).toBe(403);
    expect(p.adminOrganization.updateMany).not.toHaveBeenCalled();
    p.adminOrganizationMembership.findUnique.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(403);
  });
  it("writers can share links, rejects stale updates without overwriting", async () => {
    p.adminOrganizationMembership.findUnique.mockResolvedValue(member("WRITE"));
    p.adminOrganization.updateMany.mockResolvedValue({ count: 1 });
    expect((await PATCH(request(resourceUpdate), params)).status).toBe(200);
    expect(p.adminOrganization.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org", updatedAt: new Date(resourceUpdate.updatedAt) },
      }),
    );
    p.adminOrganization.updateMany.mockResolvedValue({ count: 0 });
    expect((await PATCH(request(resourceUpdate), params)).status).toBe(409);
  });
  it("writers cannot add, rename or delete departments", async () => {
    p.adminOrganizationMembership.findUnique.mockResolvedValue(member("WRITE"));
    expect(
      (await PATCH(request({ action: "department", name: "Stage", planning: "" }), params)).status,
    ).toBe(403);
    expect((await PATCH(request({ action: "deleteDepartment", id: "dept" }), params)).status).toBe(
      403,
    );
    p.crewDepartment.findFirst.mockResolvedValue({ id: "dept", name: "Operations" });
    expect(
      (
        await PATCH(
          request({ action: "department", id: "dept", name: "Stage", planning: "" }),
          params,
        )
      ).status,
    ).toBe(403);
  });
  it("writers can update planning but cannot change another crew's department", async () => {
    p.adminOrganizationMembership.findUnique.mockResolvedValue(member("WRITE"));
    p.crewDepartment.findFirst.mockResolvedValue({ id: "dept", name: "Stage" });
    expect(
      (
        await PATCH(
          request({ action: "department", id: "dept", name: "Stage", planning: "Setup at 09:00" }),
          params,
        )
      ).status,
    ).toBe(200);
    p.crewDepartment.findFirst.mockResolvedValue(null);
    expect(
      (
        await PATCH(
          request({ action: "department", id: "other", name: "Stage", planning: "" }),
          params,
        )
      ).status,
    ).toBe(404);
    expect(p.crewDepartment.update).toHaveBeenCalledTimes(1);
  });
  it("returns a helpful duplicate department error", async () => {
    p.adminOrganizationMembership.findUnique.mockResolvedValue(member("WRITE", "owner"));
    p.crewDepartment.create.mockRejectedValue({ code: "P2002" });
    expect(
      (await PATCH(request({ action: "department", name: "Stage", planning: "" }), params)).status,
    ).toBe(409);
  });
  it("validates malformed JSON and unsafe document URLs", async () => {
    p.adminOrganizationMembership.findUnique.mockResolvedValue(member("WRITE"));
    const res = await PATCH(
      new NextRequest("https://local.dev:3443", { method: "PATCH", body: "{" }),
      params,
    );
    expect(res.status).toBe(400);
    for (const url of ["javascript:alert(1)", "data:text/html,test", "ftp://example.com/file"]) {
      expect(
        crewUpdateSchema.safeParse({
          ...resourceUpdate,
          resources: [{ ...resourceUpdate.resources[0], url }],
        }).success,
      ).toBe(false);
    }
    expect(crewAssignmentSchema.parse({}).accessLevel).toBe("READ");
  });
  it("badge fields use crew labels, remain blank for non-crew attendees", () => {
    const element = DEFAULT_BADGE_TEMPLATE.elements[1];
    const attendee = {
      id: "reg",
      registrationId: "reg",
      ticketId: 1,
      status: "CONFIRMED" as const,
      displayName: "Alex",
      legalName: null,
      email: "alex@example.com",
      photoUrl: null,
      ticketTier: null,
      eventName: "Event",
      customFieldData: {},
      crewDepartment: "Stage",
      crewRole: "Stage manager",
    };
    expect(getBadgeElementValue({ ...element, type: "crewDepartment" }, attendee, 1)).toBe("Stage");
    expect(getBadgeElementValue({ ...element, type: "crewRole" }, attendee, 1)).toBe(
      "Stage manager",
    );
    expect(
      getBadgeElementValue({ ...element, type: "crewRole" }, { ...attendee, crewRole: null }, 1),
    ).toBe("");
  });
});
