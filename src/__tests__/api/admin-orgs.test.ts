import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Provide enum values at module load time so z.nativeEnum() resolves correctly.
// Prisma's generated client.ts uses @prisma/client/runtime which has issues in
// jsdom; providing enums directly avoids that initialization path.
vi.mock("@/generated/prisma", () => ({
  AdminType: { INDIVIDUAL: "INDIVIDUAL", ORGANIZATION: "ORGANIZATION" } as const,
  AdminOrgPermission: {
    COMMUNITY: "COMMUNITY",
    SUPPORT_TICKETS: "SUPPORT_TICKETS",
    EVENT_APPROVAL: "EVENT_APPROVAL",
    STRIPE_FINANCES: "STRIPE_FINANCES",
  } as const,
  AdminInvitationStatus: {
    PENDING: "PENDING",
    ACCEPTED: "ACCEPTED",
    DECLINED: "DECLINED",
    EXPIRED: "EXPIRED",
  } as const,
}));

import { AdminInvitationStatus, AdminOrgPermission, AdminType } from "@/generated/prisma";

// --- Prisma mock ---
vi.mock("@/lib/prisma/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    admin: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    adminOrganization: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    adminOrganizationMembership: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    adminInvitation: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    event: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const getSessionMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => getSessionMock() }));

const authApiMock = vi.fn();
vi.mock("@/app/api/auth/auth", () => ({ auth: { api: { getSession: () => authApiMock() } } }));
vi.mock("@/lib/next/prerender", () => ({ rethrowIfExpectedPrerenderInterruption: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));

import { prisma } from "@/lib/prisma/prisma";
import { checkEventAdminAuth } from "@/lib/auth/admin";
import { POST as registerAdminPost } from "@/app/api/admin/register/route";
import { POST as createOrg } from "@/app/api/admin/organizations/route";
import { POST as createInvitation } from "@/app/api/admin/organizations/[id]/invitations/route";
import { POST as acceptInvitation } from "@/app/api/admin/organizations/[id]/invitations/[token]/accept/route";
import { PATCH as updateMember, DELETE as removeMember } from "@/app/api/admin/organizations/[id]/members/[adminId]/route";
import { POST as convertToOrg } from "@/app/api/admin/profile/convert/route";

type Pm = {
  user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  admin: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  adminOrganization: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  adminOrganizationMembership: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  adminInvitation: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  event: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const p = prisma as unknown as Pm;

const makeReq = (body: unknown, headers?: Record<string, string>) =>
  new NextRequest("http://localhost/", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });

const USER_ID = "user-1";
const ADMIN_ID = "admin-1";
const ORG_ID = "org-1";
const ADMIN_ID_2 = "admin-2";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Individual admin registration
// ---------------------------------------------------------------------------
describe("POST /api/admin/register — individual", () => {
  it("registers an individual admin for authenticated non-admin user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({ id: USER_ID, isAdmin: false, adminProfile: null });
    p.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { update: vi.fn() },
        admin: { create: vi.fn().mockResolvedValue({ id: ADMIN_ID }) },
      }),
    );

    const res = await registerAdminPost(makeReq({ type: "INDIVIDUAL" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe("INDIVIDUAL");
  });

  it("rejects registration if user is already an admin", async () => {
    getSessionMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({ id: USER_ID, isAdmin: true, adminProfile: { id: ADMIN_ID } });

    const res = await registerAdminPost(makeReq({ type: "INDIVIDUAL" }));
    expect(res.status).toBe(409);
  });

  it("rejects unauthenticated request", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await registerAdminPost(makeReq({ type: "INDIVIDUAL" }));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Organization admin registration
// ---------------------------------------------------------------------------
describe("POST /api/admin/register — organization", () => {
  it("creates org + admin profile atomically", async () => {
    getSessionMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({ id: USER_ID, isAdmin: false, adminProfile: null });
    p.adminOrganization.findUnique.mockResolvedValue(null); // slug not taken
    p.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { update: vi.fn() },
        admin: { create: vi.fn().mockResolvedValue({ id: ADMIN_ID }) },
        adminOrganization: { create: vi.fn().mockResolvedValue({ id: ORG_ID }) },
      }),
    );

    const res = await registerAdminPost(
      makeReq({ type: "ORGANIZATION", organization: { name: "Acme Events", slug: "acme-events" } }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe("ORGANIZATION");
    expect(body.organizationId).toBe(ORG_ID);
  });

  it("rejects duplicate slug", async () => {
    getSessionMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({ id: USER_ID, isAdmin: false, adminProfile: null });
    p.adminOrganization.findUnique.mockResolvedValue({ id: ORG_ID }); // slug taken

    const res = await registerAdminPost(
      makeReq({ type: "ORGANIZATION", organization: { name: "Acme", slug: "acme" } }),
    );
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Organization creation (POST /api/admin/organizations)
// ---------------------------------------------------------------------------
describe("POST /api/admin/organizations", () => {
  it("creates org for admin with no existing memberships", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: { id: ADMIN_ID, type: AdminType.INDIVIDUAL, organizationMemberships: [] },
    });
    p.admin.findUnique.mockResolvedValue({
      type: AdminType.INDIVIDUAL,
      organizationMemberships: [],
    });
    p.adminOrganization.findUnique.mockResolvedValue(null);
    p.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        adminOrganization: { create: vi.fn().mockResolvedValue({ id: ORG_ID, name: "TestOrg", slug: "test-org" }) },
        admin: { update: vi.fn() },
      }),
    );

    const res = await createOrg(
      new NextRequest("http://localhost/api/admin/organizations", {
        method: "POST",
        body: JSON.stringify({ name: "TestOrg", slug: "test-org" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("blocks creation when admin already belongs to an org", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: { id: ADMIN_ID, type: AdminType.INDIVIDUAL, organizationMemberships: [{ organizationId: ORG_ID, permissions: [] }] },
    });
    p.admin.findUnique.mockResolvedValue({
      type: AdminType.INDIVIDUAL,
      organizationMemberships: [{ organizationId: ORG_ID }],
    });

    const res = await createOrg(
      new NextRequest("http://localhost/api/admin/organizations", {
        method: "POST",
        body: JSON.stringify({ name: "Another", slug: "another" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------
describe("POST /api/admin/organizations/[id]/invitations", () => {
  it("org owner can invite a user", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique
      .mockResolvedValueOnce({
        id: USER_ID, email: "a@b.com", isAdmin: true,
        adminProfile: { id: ADMIN_ID, type: AdminType.ORGANIZATION, organizationMemberships: [] },
      })
      .mockResolvedValueOnce({ id: "user-invited", isAdmin: true, adminProfile: { id: "admin-invited" } }); // invitee is existing admin

    p.adminOrganization.findUnique.mockResolvedValue({
      name: "Test Org",
      ownerId: ADMIN_ID,
      owner: { user: { name: "Owner Name" } },
    });
    p.adminOrganizationMembership.findFirst.mockResolvedValue(null);
    p.adminInvitation.findFirst.mockResolvedValue(null);
    p.adminInvitation.create.mockResolvedValue({ id: "inv-1", token: "tok-abc" });

    const res = await createInvitation(
      new NextRequest("http://localhost/", {
        method: "POST",
        body: JSON.stringify({ email: "newadmin@example.com", permissions: [AdminOrgPermission.COMMUNITY] }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: ORG_ID }) },
    );
    expect(res.status).toBe(201);
  });

  it("non-owner member cannot invite", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: { id: ADMIN_ID, type: AdminType.INDIVIDUAL, organizationMemberships: [] },
    });
    // org owner is someone else
    p.adminOrganization.findUnique.mockResolvedValue({ ownerId: ADMIN_ID_2 });

    const res = await createInvitation(
      new NextRequest("http://localhost/", {
        method: "POST",
        body: JSON.stringify({ email: "x@x.com", permissions: [] }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: ORG_ID }) },
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Accept invitation — requires existing admin account
// ---------------------------------------------------------------------------
describe("POST /api/admin/organizations/[id]/invitations/[token]/accept", () => {
  it("accepting creates membership for existing admin user", async () => {
    const createMembership = vi.fn();
    getSessionMock.mockResolvedValue({ user: { id: "user-admin" } });
    p.adminInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      organizationId: ORG_ID,
      invitedEmail: "admin@example.com",
      permissions: [AdminOrgPermission.COMMUNITY],
      accessLevel: "READ",
      departmentId: "dept-stage",
      role: "Stage manager",
      status: AdminInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    p.user.findUnique.mockResolvedValue({
      email: "admin@example.com",
      isAdmin: true,
      adminProfile: { id: "admin-existing" },
    });
    p.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        adminOrganizationMembership: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: createMembership,
        },
        adminInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }),
    );

    const res = await acceptInvitation(
      new NextRequest("http://localhost/", { method: "POST" }),
      { params: Promise.resolve({ id: ORG_ID, token: "tok-abc" }) },
    );
    expect(res.status).toBe(200);
    expect(createMembership).toHaveBeenCalledWith({ data: expect.objectContaining({ accessLevel: "READ", departmentId: "dept-stage", role: "Stage manager" }) });
  });

  it("does not create membership if an invitation is revoked during acceptance", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-admin" } });
    p.adminInvitation.findUnique.mockResolvedValue({ id: "inv-1", organizationId: ORG_ID, invitedEmail: "admin@example.com", permissions: [], status: AdminInvitationStatus.PENDING, expiresAt: new Date(Date.now() + 86_400_000) });
    p.user.findUnique.mockResolvedValue({ email: "admin@example.com", isAdmin: true, adminProfile: { id: "admin-existing" } });
    const createMembership = vi.fn();
    p.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      adminInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      adminOrganizationMembership: { create: createMembership },
    }));
    const res = await acceptInvitation(new NextRequest("http://localhost/", { method: "POST" }), { params: Promise.resolve({ id: ORG_ID, token: "tok-abc" }) });
    expect(res.status).toBe(409);
    expect(createMembership).not.toHaveBeenCalled();
  });

  it("rejects expired invitation", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-new" } });
    p.adminInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      organizationId: ORG_ID,
      invitedEmail: "new@example.com",
      permissions: [],
      status: AdminInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() - 1000), // expired
    });
    p.adminInvitation.update.mockResolvedValue({});

    const res = await acceptInvitation(
      new NextRequest("http://localhost/", { method: "POST" }),
      { params: Promise.resolve({ id: ORG_ID, token: "tok-old" }) },
    );
    expect(res.status).toBe(410);
  });

  it("rejects when email does not match session user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-other" } });
    p.adminInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      organizationId: ORG_ID,
      invitedEmail: "original@example.com",
      permissions: [],
      status: AdminInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    p.user.findUnique.mockResolvedValue({ email: "different@example.com", isAdmin: false, adminProfile: null });

    const res = await acceptInvitation(
      new NextRequest("http://localhost/", { method: "POST" }),
      { params: Promise.resolve({ id: ORG_ID, token: "tok-mismatch" }) },
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Multi-org membership — no permission leakage
// ---------------------------------------------------------------------------
describe("checkEventAdminAuth — multi-org isolation", () => {
  const ORG_A = "org-a";
  const ORG_B = "org-b";
  const ADMIN_MULTI = "admin-multi";

  it("grants access when admin is member of owning org", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: {
        id: ADMIN_MULTI,
        type: AdminType.INDIVIDUAL,
        organizationMemberships: [
          { organizationId: ORG_A, permissions: [] },
          { organizationId: ORG_B, permissions: [] },
        ],
      },
    });
    p.event.findUnique.mockResolvedValue({ ownerId: null, organizationId: ORG_A });

    const result = await checkEventAdminAuth(1);
    expect(result.authorized).toBe(true);
    expect(result.orgId).toBe(ORG_A);
  });

  it("denies access to event owned by org the admin is NOT a member of", async () => {
    const ORG_C = "org-c";
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: {
        id: ADMIN_MULTI,
        type: AdminType.INDIVIDUAL,
        organizationMemberships: [
          { organizationId: ORG_A, permissions: [] },
        ],
      },
    });
    p.event.findUnique.mockResolvedValue({ ownerId: null, organizationId: ORG_C });

    const result = await checkEventAdminAuth(2);
    expect(result.authorized).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Event-scoped authorization — personal ownership
// ---------------------------------------------------------------------------
describe("checkEventAdminAuth — personal event ownership", () => {
  it("grants access when admin personally owns event", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: { id: ADMIN_ID, type: AdminType.INDIVIDUAL, organizationMemberships: [] },
    });
    p.event.findUnique.mockResolvedValue({ ownerId: ADMIN_ID, organizationId: null });

    const result = await checkEventAdminAuth(10);
    expect(result.authorized).toBe(true);
    expect(result.isEventOwner).toBe(true);
  });

  it("denies access to unrelated event (different owner, no org)", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: { id: ADMIN_ID, type: AdminType.INDIVIDUAL, organizationMemberships: [] },
    });
    p.event.findUnique.mockResolvedValue({ ownerId: "admin-other", organizationId: null });

    const result = await checkEventAdminAuth(99);
    expect(result.authorized).toBe(false);
    expect(result.error).toMatch(/No access/);
  });
});

// ---------------------------------------------------------------------------
// Scoped permissions — STRIPE_FINANCES gate
// ---------------------------------------------------------------------------
describe("checkEventAdminAuth — permission scopes", () => {
  it("grants access when required permission is present in membership", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: {
        id: ADMIN_ID, type: AdminType.ORGANIZATION,
        organizationMemberships: [
          { organizationId: ORG_ID, permissions: [AdminOrgPermission.STRIPE_FINANCES] },
        ],
      },
    });
    p.event.findUnique.mockResolvedValue({ ownerId: null, organizationId: ORG_ID });

    const result = await checkEventAdminAuth(5, AdminOrgPermission.STRIPE_FINANCES);
    expect(result.authorized).toBe(true);
  });

  it("denies STRIPE_FINANCES access when permission not in membership", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: {
        id: ADMIN_ID, type: AdminType.ORGANIZATION,
        organizationMemberships: [
          { organizationId: ORG_ID, permissions: [AdminOrgPermission.COMMUNITY] },
        ],
      },
    });
    p.event.findUnique.mockResolvedValue({ ownerId: null, organizationId: ORG_ID });

    const result = await checkEventAdminAuth(5, AdminOrgPermission.STRIPE_FINANCES);
    expect(result.authorized).toBe(false);
    expect(result.error).toMatch(/Insufficient/);
  });
});

// ---------------------------------------------------------------------------
// Individual → Organization conversion
// ---------------------------------------------------------------------------
describe("POST /api/admin/profile/convert", () => {
  it("converts individual admin to org when no existing memberships", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: { id: ADMIN_ID, type: AdminType.INDIVIDUAL, organizationMemberships: [] },
    });
    p.admin.findUnique.mockResolvedValue({ type: AdminType.INDIVIDUAL, organizationMemberships: [] });
    p.adminOrganization.findUnique.mockResolvedValue(null);
    p.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        adminOrganization: { create: vi.fn().mockResolvedValue({ id: ORG_ID }) },
        admin: { update: vi.fn() },
      }),
    );

    const res = await convertToOrg(
      new NextRequest("http://localhost/", {
        method: "POST",
        body: JSON.stringify({ organization: { name: "My Org", slug: "my-org" } }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("blocks conversion when admin is already a member of an organization", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: {
        id: ADMIN_ID, type: AdminType.INDIVIDUAL,
        organizationMemberships: [{ organizationId: ORG_ID, permissions: [] }],
      },
    });
    p.admin.findUnique.mockResolvedValue({
      type: AdminType.INDIVIDUAL,
      organizationMemberships: [{ organizationId: ORG_ID }],
    });

    const res = await convertToOrg(
      new NextRequest("http://localhost/", {
        method: "POST",
        body: JSON.stringify({ organization: { name: "My Org", slug: "my-org" } }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Member permission management
// ---------------------------------------------------------------------------
describe("PATCH /api/admin/organizations/[id]/members/[adminId]", () => {
  it("owner can update member permissions", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: { id: ADMIN_ID, type: AdminType.ORGANIZATION, organizationMemberships: [] },
    });
    p.adminOrganization.findUnique.mockResolvedValue({ ownerId: ADMIN_ID });
    p.adminOrganizationMembership.findUnique.mockResolvedValue({ adminId: ADMIN_ID_2, organizationId: ORG_ID, permissions: [] });
    p.adminOrganizationMembership.update.mockResolvedValue({ adminId: ADMIN_ID_2, permissions: [AdminOrgPermission.COMMUNITY] });

    const res = await updateMember(
      new NextRequest("http://localhost/", {
        method: "PATCH",
        body: JSON.stringify({ permissions: [AdminOrgPermission.COMMUNITY] }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: ORG_ID, adminId: ADMIN_ID_2 }) },
    );
    expect(res.status).toBe(200);
  });

  it("non-owner cannot update permissions", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: { id: ADMIN_ID, type: AdminType.INDIVIDUAL, organizationMemberships: [] },
    });
    p.adminOrganization.findUnique.mockResolvedValue({ ownerId: ADMIN_ID_2 }); // different owner

    const res = await updateMember(
      new NextRequest("http://localhost/", {
        method: "PATCH",
        body: JSON.stringify({ permissions: [] }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: ORG_ID, adminId: ADMIN_ID }) },
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Member removal
// ---------------------------------------------------------------------------
describe("DELETE /api/admin/organizations/[id]/members/[adminId]", () => {
  it("owner can remove a member", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: { id: ADMIN_ID, type: AdminType.ORGANIZATION, organizationMemberships: [] },
    });
    p.adminOrganization.findUnique.mockResolvedValue({ ownerId: ADMIN_ID });
    p.adminOrganizationMembership.delete.mockResolvedValue({});

    const res = await removeMember(
      new NextRequest("http://localhost/", { method: "DELETE" }),
      { params: Promise.resolve({ id: ORG_ID, adminId: ADMIN_ID_2 }) },
    );
    expect(res.status).toBe(200);
  });

  it("owner cannot remove themselves", async () => {
    authApiMock.mockResolvedValue({ user: { id: USER_ID } });
    p.user.findUnique.mockResolvedValue({
      id: USER_ID, email: "a@b.com", isAdmin: true,
      adminProfile: { id: ADMIN_ID, type: AdminType.ORGANIZATION, organizationMemberships: [] },
    });
    p.adminOrganization.findUnique.mockResolvedValue({ ownerId: ADMIN_ID });

    const res = await removeMember(
      new NextRequest("http://localhost/", { method: "DELETE" }),
      { params: Promise.resolve({ id: ORG_ID, adminId: ADMIN_ID }) },
    );
    expect(res.status).toBe(400);
  });
});
