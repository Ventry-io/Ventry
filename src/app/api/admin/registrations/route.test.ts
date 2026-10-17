import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const prismaMock = vi.hoisted(() => ({
    registration: {
        findMany: vi.fn(),
    },
}));

vi.mock("@/lib/prisma/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/lib/auth/admin", () => ({
    checkAdminAuth: vi.fn(),
    adminEventFilter: vi.fn(),
    forbiddenResponse: vi.fn((error?: string) =>
        new Response(JSON.stringify({ error: error ?? "Forbidden" }), {
            status: 403,
            headers: { "content-type": "application/json" },
        }),
    ),
}));

vi.mock("@/lib/next/prerender", () => ({
    rethrowIfExpectedPrerenderInterruption: vi.fn(),
}));

import { GET } from "./route";
import { checkAdminAuth, adminEventFilter } from "@/lib/auth/admin";

const mockedCheckAdminAuth = checkAdminAuth as unknown as ReturnType<typeof vi.fn>;
const mockedAdminEventFilter = adminEventFilter as unknown as ReturnType<typeof vi.fn>;

function getRequest(params: Record<string, string> = {}) {
    const url = new URL("http://localhost/api/admin/registrations");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return new NextRequest(url);
}

const INDIVIDUAL_FILTER = { OR: [{ ownerId: "admin-individual" }] };
const ORG_FILTER = {
    OR: [
        { ownerId: "admin-org" },
        { organizationId: { in: ["org-1"] } },
    ],
};

describe("GET /api/admin/registrations — event scoping", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.registration.findMany.mockResolvedValue([]);
    });

    it("returns 403 when not authorized", async () => {
        mockedCheckAdminAuth.mockResolvedValue({ authorized: false, error: "Not authenticated" });

        const res = await GET(getRequest());

        expect(res.status).toBe(403);
        expect(prismaMock.registration.findMany).not.toHaveBeenCalled();
    });

    it("returns 403 when authorized but adminId missing", async () => {
        mockedCheckAdminAuth.mockResolvedValue({ authorized: true, adminId: undefined });

        const res = await GET(getRequest());

        expect(res.status).toBe(403);
        expect(prismaMock.registration.findMany).not.toHaveBeenCalled();
    });

    it("individual admin: findMany called with ownerId-only event filter", async () => {
        mockedCheckAdminAuth.mockResolvedValue({ authorized: true, adminId: "admin-individual" });
        mockedAdminEventFilter.mockResolvedValue(INDIVIDUAL_FILTER);

        await GET(getRequest());

        expect(mockedAdminEventFilter).toHaveBeenCalledWith("admin-individual");
        expect(prismaMock.registration.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ event: INDIVIDUAL_FILTER }),
            }),
        );
    });

    it("org admin: findMany called with org-scoped event filter", async () => {
        mockedCheckAdminAuth.mockResolvedValue({ authorized: true, adminId: "admin-org" });
        mockedAdminEventFilter.mockResolvedValue(ORG_FILTER);

        await GET(getRequest());

        expect(mockedAdminEventFilter).toHaveBeenCalledWith("admin-org");
        expect(prismaMock.registration.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ event: ORG_FILTER }),
            }),
        );
    });

    it("org admin with no matching events returns empty registrations", async () => {
        mockedCheckAdminAuth.mockResolvedValue({ authorized: true, adminId: "admin-org" });
        mockedAdminEventFilter.mockResolvedValue(ORG_FILTER);
        prismaMock.registration.findMany.mockResolvedValue([]);

        const res = await GET(getRequest());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.registrations).toEqual([]);
    });

    it("returns registrations for events the admin owns", async () => {
        mockedCheckAdminAuth.mockResolvedValue({ authorized: true, adminId: "admin-individual" });
        mockedAdminEventFilter.mockResolvedValue(INDIVIDUAL_FILTER);
        const mockRegs = [
            { id: "reg-1", user: { id: "user-1" }, event: { id: 7, name: "My Event", ownerId: "admin-individual" } },
            { id: "reg-2", user: { id: "user-2" }, event: { id: 7, name: "My Event", ownerId: "admin-individual" } },
        ];
        prismaMock.registration.findMany.mockResolvedValue(mockRegs);

        const res = await GET(getRequest());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.registrations).toHaveLength(2);
    });

    it("eventId param is applied alongside event filter", async () => {
        mockedCheckAdminAuth.mockResolvedValue({ authorized: true, adminId: "admin-individual" });
        mockedAdminEventFilter.mockResolvedValue(INDIVIDUAL_FILTER);

        await GET(getRequest({ eventId: "7" }));

        expect(prismaMock.registration.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    event: INDIVIDUAL_FILTER,
                    eventId: 7,
                }),
            }),
        );
    });

    it("status param is applied alongside event filter", async () => {
        mockedCheckAdminAuth.mockResolvedValue({ authorized: true, adminId: "admin-individual" });
        mockedAdminEventFilter.mockResolvedValue(INDIVIDUAL_FILTER);

        await GET(getRequest({ status: "CONFIRMED" }));

        expect(prismaMock.registration.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    event: INDIVIDUAL_FILTER,
                    status: "CONFIRMED",
                }),
            }),
        );
    });

    it("org admin does not receive registrations from individual admin's events", async () => {
        mockedCheckAdminAuth.mockResolvedValue({ authorized: true, adminId: "admin-org" });
        mockedAdminEventFilter.mockResolvedValue(ORG_FILTER);
        // Simulate DB returning empty (individual admin's events don't match org filter)
        prismaMock.registration.findMany.mockResolvedValue([]);

        const res = await GET(getRequest());
        const body = await res.json();

        expect(body.registrations).toEqual([]);
        // Critically: the where clause does NOT include individual admin's ownerId
        const whereArg = prismaMock.registration.findMany.mock.calls[0][0].where;
        expect(whereArg.event.OR[0]).toEqual({ ownerId: "admin-org" });
        expect(whereArg.event.OR[0]).not.toEqual({ ownerId: "admin-individual" });
    });
});
