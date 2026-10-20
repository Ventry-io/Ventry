import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
    payment: {
        groupBy: vi.fn(),
        findMany: vi.fn(),
    },
    adminOrganizationMembership: {
        findMany: vi.fn(),
    },
}));

vi.mock("@/lib/prisma/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/app/api/auth/auth", () => ({
    auth: { api: { getSession: vi.fn() } },
}));

vi.mock("next/headers", () => ({ headers: vi.fn() }));

vi.mock("@/lib/stripe", () => ({
    calculatePlatformFeeAmount: (amountInCents: number) => {
        const feePercent = Number(process.env.PLATFORM_FEE_PERCENT) || 0;
        if (feePercent <= 0) return 0;
        return Math.floor((amountInCents * feePercent) / 100);
    },
}));

import { getBillingData } from "./billing-data";

function mockPaymentQueries(overrides: {
    groupBy?: unknown[];
    recentPayments?: unknown[];
    completedForFeeEstimate?: { amount: number; registration: { eventId: number } }[];
} = {}) {
    prismaMock.payment.groupBy.mockResolvedValue(overrides.groupBy ?? []);
    // findMany is called twice with different shapes: recent payments
    // (include) vs the fee-estimate query (select) — dispatch on that.
    prismaMock.payment.findMany.mockImplementation((args: { select?: unknown }) =>
        Promise.resolve(args?.select ? (overrides.completedForFeeEstimate ?? []) : (overrides.recentPayments ?? [])),
    );
}

describe("getBillingData — event scoping", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([]);
        mockPaymentQueries();
    });

    it("individual admin: all payment queries scoped to their events via registration.event filter", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([]);

        await getBillingData("admin-individual");

        const expectedFilter = {
            registration: { event: { OR: [{ ownerId: "admin-individual" }] } },
        };

        // groupBy (summary stats) uses the filter
        expect(prismaMock.payment.groupBy).toHaveBeenCalledWith(
            expect.objectContaining({ where: expectedFilter }),
        );
        // findMany (recent payments) uses the filter
        expect(prismaMock.payment.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expectedFilter }),
        );
    });

    it("org admin: queries scoped to org events via organizationId filter", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([
            { organizationId: "org-1", permissions: ["STRIPE_FINANCES"], organization: { ownerId: "other-admin" } },
        ]);

        await getBillingData("admin-org");

        const expectedFilter = {
            registration: {
                event: {
                    OR: [
                        { ownerId: "admin-org" },
                        { organizationId: { in: ["org-1"] } },
                    ],
                },
            },
        };

        expect(prismaMock.payment.groupBy).toHaveBeenCalledWith(
            expect.objectContaining({ where: expectedFilter }),
        );
        expect(prismaMock.payment.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expectedFilter }),
        );
    });

    it("org admin with no payments returns zero revenue", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([
            { organizationId: "org-1", permissions: ["STRIPE_FINANCES"], organization: { ownerId: "other-admin" } },
        ]);
        prismaMock.payment.groupBy.mockResolvedValue([]);
        prismaMock.payment.findMany.mockResolvedValue([]);

        const data = await getBillingData("admin-org");

        expect(data?.completed).toEqual({ sum: 0, count: 0 });
        expect(data?.netRevenue).toBe(0);
        expect(data?.recentPayments).toEqual([]);
    });

    it("individual admin with payments sees correct totals", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([]);
        prismaMock.payment.groupBy.mockResolvedValue([
            { paymentStatus: "COMPLETED", _sum: { amount: 1000 }, _count: { _all: 4 } },
            { paymentStatus: "PENDING", _sum: { amount: 200 }, _count: { _all: 2 } },
        ]);
        prismaMock.payment.findMany.mockResolvedValue([]);

        const data = await getBillingData("admin-individual");

        expect(data?.completed).toEqual({ sum: 1000, count: 4 });
        expect(data?.pending).toEqual({ sum: 200, count: 2 });
        // stripeFees = 4 * 0.25 + 1000 * 0.015 = 1 + 15 = 16
        expect(data?.stripeFees).toBeCloseTo(16);
        // no PLATFORM_FEE_PERCENT configured in this test env -> no platform fee
        expect(data?.platformFees).toBe(0);
        expect(data?.netRevenue).toBeCloseTo(984);
    });

    it("platform fee estimate is a per-event switch: under threshold = free, at/over = fee on all its tickets", async () => {
        const originalPercent = process.env.PLATFORM_FEE_PERCENT;
        const originalThreshold = process.env.PLATFORM_FEE_FREE_TICKET_THRESHOLD;
        process.env.PLATFORM_FEE_PERCENT = "2";
        process.env.PLATFORM_FEE_FREE_TICKET_THRESHOLD = "2";

        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([]);
        mockPaymentQueries({
            groupBy: [{ paymentStatus: "COMPLETED", _sum: { amount: 500 }, _count: { _all: 5 } }],
            completedForFeeEstimate: [
                // event 1: 4 tickets, at/over the threshold of 2 -> ALL 4 fee'd
                { amount: 100, registration: { eventId: 1 } },
                { amount: 100, registration: { eventId: 1 } },
                { amount: 100, registration: { eventId: 1 } },
                { amount: 100, registration: { eventId: 1 } },
                // event 2: only 1 ticket, under the threshold -> free
                { amount: 100, registration: { eventId: 2 } },
            ],
        });

        const data = await getBillingData("admin-individual");

        // event 1: 4 * (100 * 2%) = 8; event 2: 0
        expect(data?.platformFees).toBeCloseTo(8);

        if (originalPercent === undefined) delete process.env.PLATFORM_FEE_PERCENT;
        else process.env.PLATFORM_FEE_PERCENT = originalPercent;
        if (originalThreshold === undefined) delete process.env.PLATFORM_FEE_FREE_TICKET_THRESHOLD;
        else process.env.PLATFORM_FEE_FREE_TICKET_THRESHOLD = originalThreshold;
    });

    it("denied organization finances return no data without querying payments", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([
            { organizationId: "org-1", permissions: [], organization: { ownerId: "other-admin" } },
        ]);

        expect(await getBillingData("admin-org", "org-1")).toBeNull();
        expect(prismaMock.payment.groupBy).not.toHaveBeenCalled();
        expect(prismaMock.payment.findMany).not.toHaveBeenCalled();
    });

    it("combined totals exclude restricted organizations and flag the incomplete scope", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([
            { organizationId: "org-allowed", permissions: ["STRIPE_FINANCES"], organization: { ownerId: "other-admin" } },
            { organizationId: "org-denied", permissions: [], organization: { ownerId: "other-admin" } },
        ]);

        const data = await getBillingData("admin-org");

        expect(data?.hasRestrictedOrganizations).toBe(true);
        expect(prismaMock.payment.groupBy).toHaveBeenCalledWith(expect.objectContaining({
            where: { registration: { event: { OR: [{ ownerId: "admin-org" }, { organizationId: { in: ["org-allowed"] } }] } } },
        }));
    });

    it("completed payment query includes paymentStatus filter alongside event scope", async () => {
        prismaMock.adminOrganizationMembership.findMany.mockResolvedValue([]);

        await getBillingData("admin-individual");

        // The third groupBy call (revenueByEvent) filters COMPLETED + event scope
        const groupByCalls = prismaMock.payment.groupBy.mock.calls;
        const revenueByEventCall = groupByCalls.find(
            (call) => call[0]?.where?.paymentStatus === "COMPLETED",
        );
        expect(revenueByEventCall).toBeDefined();
        expect(revenueByEventCall?.[0].where).toEqual(
            expect.objectContaining({
                paymentStatus: "COMPLETED",
                registration: expect.objectContaining({ event: expect.any(Object) }),
            }),
        );
    });
});
