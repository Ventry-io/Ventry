import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
    adminOrganizationMembership: {
        findMany: vi.fn(),
    },
}));

vi.mock("@/lib/prisma/prisma", () => ({ prisma: prismaMock }));

// auth.ts calls auth.api.getSession — not needed for adminEventFilter tests
vi.mock("@/app/api/auth/auth", () => ({
    auth: { api: { getSession: vi.fn() } },
}));

vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { adminEventFilter, getAdminFinanceAccess } from "@/lib/auth/admin";

describe("adminEventFilter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("individual admin (no org memberships) returns ownerId-only OR filter", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([]);

        const filter = await adminEventFilter("admin-individual");

        expect(filter).toEqual({ OR: [{ ownerId: "admin-individual" }] });
    });

    it("org admin with one org returns ownerId + organizationId filter", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([
            { organizationId: "org-1" },
        ]);

        const filter = await adminEventFilter("admin-org");

        expect(filter).toEqual({
            OR: [
                { ownerId: "admin-org" },
                { organizationId: { in: ["org-1"] } },
            ],
        });
    });

    it("admin in multiple orgs includes all org IDs", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([
            { organizationId: "org-1" },
            { organizationId: "org-2" },
        ]);

        const filter = await adminEventFilter("admin-multi");

        expect(filter).toEqual({
            OR: [
                { ownerId: "admin-multi" },
                { organizationId: { in: ["org-1", "org-2"] } },
            ],
        });
    });

    it("org admin ownerId is their own ID, not another admin's", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([
            { organizationId: "org-1" },
        ]);

        const filter = await adminEventFilter("admin-org");

        // ownerId in filter is admin-org's own ID — individual admin events are NOT included
        const orFilter = filter as { OR: unknown[] };
        expect(orFilter.OR[0]).toEqual({ ownerId: "admin-org" });
        expect(orFilter.OR[0]).not.toEqual({ ownerId: "admin-individual" });
    });

    it("org with no events: filter still scoped to org — null organizationId events excluded", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([
            { organizationId: "org-empty" },
        ]);

        const filter = await adminEventFilter("admin-org");

        // Events with organizationId=null would NOT match { organizationId: { in: ["org-empty"] } }
        expect((filter as { OR: unknown[] }).OR[1]).toEqual({ organizationId: { in: ["org-empty"] } });
    });

    it("queries memberships using the given adminId", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([]);

        await adminEventFilter("specific-admin-id");

        expect(prismaMock.adminOrganizationMembership.findMany).toHaveBeenCalledWith({
            where: { adminId: "specific-admin-id" },
            select: { organizationId: true },
        });
    });
});

describe("getAdminFinanceAccess", () => {
    beforeEach(() => vi.clearAllMocks());

    it("denies an organization without Finances permission", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([
            { organizationId: "org-1", permissions: ["COMMUNITY"], organization: { ownerId: "owner" } },
        ]);
        expect((await getAdminFinanceAccess("member", "org-1")).eventFilter).toBeNull();
    });

    it("allows read-only members with Finances permission", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([
            { organizationId: "org-1", accessLevel: "READ", permissions: ["STRIPE_FINANCES"], organization: { ownerId: "owner" } },
        ]);
        expect(await getAdminFinanceAccess("member", "org-1")).toEqual({
            eventFilter: { organizationId: "org-1" }, hasRestrictedOrganizations: false,
        });
    });

    it("allows organization owners without explicit permissions", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([
            { organizationId: "org-1", permissions: [], organization: { ownerId: "owner" } },
        ]);
        expect((await getAdminFinanceAccess("owner", "org-1")).eventFilter).toEqual({ organizationId: "org-1" });
    });

    it("rejects an unknown organization instead of falling back to all finances", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([]);
        expect((await getAdminFinanceAccess("member", "unknown")).eventFilter).toBeNull();
    });

    it("keeps personal finances available without querying memberships", async () => {
        expect(await getAdminFinanceAccess("member", "personal")).toEqual({
            eventFilter: { ownerId: "member" }, hasRestrictedOrganizations: false,
        });
        expect(prismaMock.adminOrganizationMembership.findMany).not.toHaveBeenCalled();
    });
});
