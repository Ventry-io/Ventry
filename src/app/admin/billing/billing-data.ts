import { getAdminFinanceAccess } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma/prisma";
import { estimatePlatformFees } from "@/lib/billing/platformFee";

export async function getBillingData(adminId: string, orgScope?: string) {
    const { eventFilter, hasRestrictedOrganizations } = await getAdminFinanceAccess(adminId, orgScope);
    if (!eventFilter) return null;
    const paymentEventFilter = { registration: { event: eventFilter } };

    const [byStatus, recentPayments, revenueByEvent, completedForFeeEstimate] = await Promise.all([
        prisma.payment.groupBy({
            by: ["paymentStatus"],
            where: paymentEventFilter,
            _sum: { amount: true },
            _count: { _all: true },
        }),
        prisma.payment.findMany({
            where: paymentEventFilter,
            orderBy: { createdAt: "desc" },
            take: 1000,
            include: {
                user: { select: { name: true, email: true } },
                registration: {
                    include: {
                        event: {
                            select: {
                                name: true,
                                owner: { select: { user: { select: { name: true } } } },
                                organization: { select: { name: true } },
                            },
                        },
                    },
                },
            },
        }),
        prisma.payment.groupBy({
            by: ["registrationId"],
            where: { paymentStatus: "COMPLETED", ...paymentEventFilter },
            _sum: { amount: true },
        }),
        prisma.payment.findMany({
            where: { paymentStatus: "COMPLETED", ...paymentEventFilter },
            orderBy: { createdAt: "asc" },
            select: { amount: true, registration: { select: { eventId: true } } },
        }),
    ]);

    const statusMap = Object.fromEntries(
        byStatus.map((s) => [s.paymentStatus, { sum: s._sum.amount ?? 0, count: s._count._all }])
    );

    const completed = statusMap.COMPLETED ?? { sum: 0, count: 0 };
    const pending = statusMap.PENDING ?? { sum: 0, count: 0 };
    const failed = statusMap.FAILED ?? { sum: 0, count: 0 };
    const refunded = statusMap.REFUNDED ?? { sum: 0, count: 0 };

    // Approximate Stripe fee: 1.5% + EUR 0.25 per completed transaction.
    const stripeFees = completed.count * 0.25 + completed.sum * 0.015;
    // Our own cut (Stripe Connect application_fee_amount), same free-ticket
    // threshold per event as the real charge — see src/lib/billing/platformFee.ts.
    const platformFees = estimatePlatformFees(
        completedForFeeEstimate.map((p) => ({ amount: p.amount, eventId: p.registration.eventId })),
    );
    const netRevenue = completed.sum - stripeFees - platformFees;

    return {
        hasRestrictedOrganizations,
        completed,
        pending,
        failed,
        refunded,
        stripeFees,
        platformFees,
        netRevenue,
        recentPayments,
        revenueByEvent,
    };
}
