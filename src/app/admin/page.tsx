import { Suspense } from "react";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Divider from "@mui/material/Divider";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import {
    People,
    VerifiedUser,
    ConfirmationNumber,
    SupportAgent,
    Event,
    AttachMoney,
} from "@mui/icons-material";
import StatCard from "@/components/admin/StatCard/StatCard";
import { prisma } from "@/lib/prisma/prisma";
import { checkAdminAuth, adminEventFilter, getAdminFinanceAccess } from "@/lib/auth/admin";
import { redirect } from "next/navigation";

async function getDashboardStats(adminId: string, orgScope?: string) {
    const [eventFilter, financeAccess] = await Promise.all([
        adminEventFilter(adminId, orgScope),
        getAdminFinanceAccess(adminId, orgScope),
    ]);

    const [
        totalRegistrants,
        verifiedRegistrants,
        totalTickets,
        openTickets,
        eventsByStatus,
        revenue,
    ] = await Promise.all([
        // Unique users registered to this admin's events
        prisma.registration.groupBy({
            by: ["userId"],
            where: { event: eventFilter },
        }).then((rows) => rows.length),
        // Unique verified users registered to this admin's events
        prisma.registration.groupBy({
            by: ["userId"],
            where: {
                event: eventFilter,
                user: { emailVerified: true },
            },
        }).then((rows) => rows.length),
        prisma.supportTicket.count({ where: { event: eventFilter } }),
        prisma.supportTicket.count({
            where: {
                event: eventFilter,
                status: { in: ["OPEN", "IN_PROGRESS"] },
            },
        }),
        prisma.event.groupBy({
            by: ["status"],
            where: eventFilter,
            _count: { _all: true },
        }),
        financeAccess.eventFilter ? prisma.payment.aggregate({
            _sum: { amount: true },
            where: {
                paymentStatus: "COMPLETED",
                registration: { event: financeAccess.eventFilter },
            },
        }) : null,
    ]);

    const eventCounts = Object.fromEntries(
        eventsByStatus.map((e) => [e.status, e._count._all])
    ) as Record<string, number>;

    return {
        totalRegistrants,
        verifiedRegistrants,
        totalTickets,
        openTickets,
        draftEvents: eventCounts.DRAFT ?? 0,
        publishedEvents: eventCounts.PUBLISHED ?? 0,
        cancelledEvents: eventCounts.CANCELLED ?? 0,
        totalRevenue: revenue ? revenue._sum.amount ?? 0 : null,
        hasRestrictedFinances: financeAccess.hasRestrictedOrganizations,
    };
}

function StatSkeleton() {
    return (
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
            <Skeleton variant="rounded" height={110} />
        </Grid>
    );
}

async function DashboardStats({ adminId, orgScope }: { adminId: string; orgScope?: string }) {
    const stats = await getDashboardStats(adminId, orgScope);
    const verifiedPct = stats.totalRegistrants
        ? Math.round((stats.verifiedRegistrants / stats.totalRegistrants) * 100)
        : 0;

    return (
        <>
            {/* Registrants */}
            <Grid size={12}>
                <Typography variant="h6" fontWeight={600} color="text.secondary">Registrants</Typography>
                <Divider sx={{ mt: 0.5, mb: 2 }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <StatCard label="Total Registrants" value={stats.totalRegistrants} Icon={People} color="primary.main" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <StatCard
                    label="Verified Registrants"
                    value={stats.verifiedRegistrants}
                    sub={`${verifiedPct}% of registrants`}
                    Icon={VerifiedUser}
                    color="success.main"
                />
            </Grid>

            {/* Support Tickets */}
            <Grid size={12}>
                <Typography variant="h6" fontWeight={600} color="text.secondary" sx={{ mt: 2 }}>Support Tickets</Typography>
                <Divider sx={{ mt: 0.5, mb: 2 }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <StatCard label="Total Tickets" value={stats.totalTickets} Icon={ConfirmationNumber} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <StatCard
                    label="Open / In Progress"
                    value={stats.openTickets}
                    Icon={SupportAgent}
                    color={stats.openTickets > 0 ? "warning.main" : "success.main"}
                />
            </Grid>

            {/* Events */}
            <Grid size={12}>
                <Typography variant="h6" fontWeight={600} color="text.secondary" sx={{ mt: 2 }}>Events</Typography>
                <Divider sx={{ mt: 0.5, mb: 2 }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <StatCard label="Draft" value={stats.draftEvents} Icon={Event} color="text.secondary" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <StatCard label="Published" value={stats.publishedEvents} Icon={Event} color="primary.main" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <StatCard label="Cancelled" value={stats.cancelledEvents} Icon={Event} color="error.main" />
            </Grid>

            {/* Revenue */}
            <Grid size={12}>
                <Typography variant="h6" fontWeight={600} color="text.secondary" sx={{ mt: 2 }}>Revenue</Typography>
                <Divider sx={{ mt: 0.5, mb: 2 }} />
            </Grid>
            {stats.totalRevenue === null ? (
                <Grid size={12}>
                    <Alert severity="info">
                        <AlertTitle>Finance access required</AlertTitle>
                        You don’t have access to this organization’s finances. Ask the organization owner to grant you the Finances permission.
                    </Alert>
                </Grid>
            ) : (
                <>
                    {stats.hasRestrictedFinances && (
                        <Grid size={12}>
                            <Alert severity="info">
                                Some organization finances are hidden because you don’t have the Finances permission.
                                Revenue below includes only events whose finances you can access. Ask the organization owner for access.
                            </Alert>
                        </Grid>
                    )}
                    <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                        <StatCard
                            label="Total Revenue (completed)"
                            value={`€ ${stats.totalRevenue.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            Icon={AttachMoney}
                            color="success.main"
                            sub="See Billing for full breakdown"
                        />
                    </Grid>
                </>
            )}
        </>
    );
}

type Props = { searchParams: Promise<{ orgFilter?: string }> };

export default async function AdminDashboardPage({ searchParams }: Props) {
    const auth = await checkAdminAuth();
    if (!auth.authorized) redirect("/login");

    if (!auth.adminId) {
        return (
            <Box>
                <Typography color="error">Admin profile incomplete.</Typography>
            </Box>
        );
    }

    const { orgFilter } = await searchParams;

    return (
        <Box>
            <Typography variant="h4" fontWeight={700} gutterBottom>
                Dashboard
            </Typography>
            <Grid container spacing={2} alignItems="stretch">
                <Suspense
                    fallback={Array.from({ length: 7 }).map((_, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
                        <StatSkeleton key={i} />
                    ))}
                >
                    <DashboardStats adminId={auth.adminId} orgScope={orgFilter} />
                </Suspense>
            </Grid>
        </Box>
    );
}
