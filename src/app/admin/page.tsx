import { withEventScope } from "@/lib/events/admin-context";
import { Suspense } from "react";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import StatCard, { StatRow } from "@/components/admin/StatCard/StatCard";
import EventLifecycleStrip from "@/components/admin/EventLifecycle/EventLifecycleStrip";
import { eventStage } from "@/lib/events/lifecycle";
import { prisma } from "@/lib/prisma/prisma";
import { checkAdminAuth, adminEventFilter, getAdminFinanceAccess } from "@/lib/auth/admin";
import { redirect } from "next/navigation";

async function getDashboardStats(adminId: string, eventId: string, orgScope?: string) {
    const [baseFilter, financeAccess] = await Promise.all([
        adminEventFilter(adminId, orgScope),
        getAdminFinanceAccess(adminId, orgScope),
    ]);

    const eventFilter = withEventScope(baseFilter, eventId);
    const [
        totalRegistrants,
        verifiedRegistrants,
        checkedIn,
        totalTickets,
        openTickets,
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
        prisma.registration.count({ where: { event: eventFilter, checkedInAt: { not: null } } }),
        prisma.supportTicket.count({ where: { event: eventFilter } }),
        prisma.supportTicket.count({
            where: {
                event: eventFilter,
                status: { in: ["OPEN", "IN_PROGRESS"] },
            },
        }),
        financeAccess.eventFilter ? prisma.payment.aggregate({
            _sum: { amount: true },
            where: {
                paymentStatus: "COMPLETED",
                registration: { event: withEventScope(financeAccess.eventFilter, eventId) },
            },
        }) : null,
    ]);

    return {
        totalRegistrants,
        verifiedRegistrants,
        checkedIn,
        totalTickets,
        openTickets,
        totalRevenue: revenue ? revenue._sum.amount ?? 0 : null,
        hasRestrictedFinances: financeAccess.hasRestrictedOrganizations,
    };
}

async function DashboardHeader({ adminId, orgScope, eventId }: { adminId: string; orgScope?: string; eventId: string }) {
    // Same access filter as the stats, so the header never names an event this admin cannot see.
    const event = await prisma.event.findFirst({
        where: withEventScope(await adminEventFilter(adminId, orgScope), eventId),
        select: { id: true, name: true, status: true, publishAt: true, registrationOpensAt: true, startDate: true, endDate: true, location: { select: { city: true } } },
    });
    if (!event) return <Typography variant="h3" component="h1" sx={{ mb: 3 }}>Dashboard</Typography>;
    const dates = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
    return (
        <Box sx={{ mb: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2 }}>
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h3" component="h1">{event.name}</Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                        {[event.location?.city, `${dates.format(event.startDate)} – ${dates.format(event.endDate)}`].filter(Boolean).join(" · ")}
                    </Typography>
                </Box>
                <Stack direction="row" flexWrap="wrap" gap={1}>
                    <Button variant="outlined" href={`/events/${event.id}`}>View public page</Button>
                    <Button variant="contained" href={`/admin/events/${event.id}/check-in`}>Open check-in</Button>
                </Stack>
            </Box>
            <EventLifecycleStrip stage={eventStage(event)} />
        </Box>
    );
}

async function DashboardStats({ adminId, orgScope, eventId }: { adminId: string; orgScope?: string; eventId: string }) {
    const stats = await getDashboardStats(adminId, eventId, orgScope);
    const pct = (part: number) => stats.totalRegistrants ? Math.round((part / stats.totalRegistrants) * 100) : 0;

    return (
        <Stack spacing={2}>
            <StatRow>
                <StatCard
                    label="Registrants"
                    value={stats.totalRegistrants}
                    sub={`${stats.verifiedRegistrants} verified · ${pct(stats.verifiedRegistrants)}%`}
                />
                <StatCard
                    label="Checked in"
                    value={stats.checkedIn}
                    sub={`${pct(stats.checkedIn)}% of registrants`}
                    color="success.main"
                />
                <StatCard
                    label="Open support tickets"
                    value={stats.openTickets}
                    sub={`${stats.totalTickets} total`}
                    color={stats.openTickets > 0 ? "warning.main" : "success.main"}
                />
                <StatCard
                    label="Revenue (completed)"
                    value={stats.totalRevenue === null ? "—" : `€ ${stats.totalRevenue.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    sub={stats.totalRevenue === null ? "Finance access required" : "See Billing for full breakdown"}
                    color={stats.totalRevenue === null ? "text.disabled" : "success.main"}
                />
            </StatRow>
            {stats.totalRevenue === null ? (
                <Alert severity="info">
                    <AlertTitle>Finance access required</AlertTitle>
                    You don’t have access to this organization’s finances. Ask the organization owner to grant you the Finances permission.
                </Alert>
            ) : stats.hasRestrictedFinances && (
                <Alert severity="info">
                    Some organization finances are hidden because you don’t have the Finances permission.
                    Revenue above includes only events whose finances you can access. Ask the organization owner for access.
                </Alert>
            )}
        </Stack>
    );
}

type Props = { searchParams: Promise<{ orgFilter?: string; eventId?: string }> };

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

    const { orgFilter, eventId } = await searchParams;
    if (!eventId) redirect("/admin/events");

    return (
        <Box>
            <Suspense fallback={<Skeleton variant="rounded" height={120} sx={{ mb: 3 }} />}>
                <DashboardHeader key={eventId} eventId={eventId} adminId={auth.adminId} orgScope={orgFilter} />
            </Suspense>
            <Suspense fallback={<Skeleton variant="rounded" height={160} />}>
                <DashboardStats key={eventId} eventId={eventId} adminId={auth.adminId} orgScope={orgFilter} />
            </Suspense>
        </Box>
    );
}
