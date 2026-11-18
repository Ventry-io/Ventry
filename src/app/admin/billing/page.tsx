import { Suspense } from "react";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Divider from "@mui/material/Divider";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import { AttachMoney, TrendingUp, Cancel, HourglassEmpty } from "@mui/icons-material";
import StatCard from "@/components/admin/StatCard/StatCard";
import { checkAdminAuth } from "@/lib/auth/admin";
import { redirect } from "next/navigation";
import { getBillingData } from "./billing-data";
import RecentPaymentsTable from "./RecentPaymentsTable";

const fmt = (amount: number) =>
    `€\u202f${amount.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function BillingContent({ adminId, orgScope }: { adminId: string; orgScope?: string }) {
    const data = await getBillingData(adminId, orgScope);
    if (!data) {
        return (
            <Grid size={12}>
                <Alert severity="info">
                    <AlertTitle>Finance access required</AlertTitle>
                    You don’t have access to this organization’s finances. Ask the organization owner to grant you the Finances permission.
                </Alert>
            </Grid>
        );
    }
    const paymentRows = data.recentPayments.map((p) => ({
        id: p.id,
        createdAt: p.createdAt,
        userName: p.user.name ?? p.user.email,
        userEmail: p.user.email,
        eventName: p.registration.event.name,
        ownerName: p.registration.event.organization?.name ?? p.registration.event.owner?.user.name ?? "—",
        amount: p.amount,
        currency: p.currency.toUpperCase(),
        paymentStatus: p.paymentStatus,
    }));

    return (
        <>
            {data.hasRestrictedOrganizations && (
                <Grid size={12}>
                    <Alert severity="info">
                        Some organization finances are hidden because you don’t have the Finances permission.
                        Totals below include only events whose finances you can access. Ask the organization owner for access.
                    </Alert>
                </Grid>
            )}
            {/* Summary cards */}
            <Grid size={12}>
                <Typography variant="h6" fontWeight={600} color="text.secondary">Overview</Typography>
                <Divider sx={{ mt: 0.5, mb: 2 }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <StatCard
                    label="Gross Revenue"
                    value={fmt(data.completed.sum)}
                    sub={`${data.completed.count} completed payments`}
                    Icon={TrendingUp}
                    color="success.main"
                />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <StatCard
                    label="Est. Stripe Fees"
                    value={fmt(data.stripeFees)}
                    sub="1.5% + €0.25 / txn (approx.)"
                    Icon={AttachMoney}
                    color="warning.main"
                />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <StatCard
                    label="Platform Fee"
                    value={fmt(data.platformFees)}
                    sub="Ventry's own cut"
                    Icon={AttachMoney}
                    color="warning.main"
                />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <StatCard
                    label="Net Revenue"
                    value={fmt(data.netRevenue)}
                    sub="After estimated fees"
                    Icon={AttachMoney}
                    color="primary.main"
                />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <StatCard
                    label="Pending"
                    value={fmt(data.pending.sum)}
                    sub={`${data.pending.count} payments`}
                    Icon={HourglassEmpty}
                    color="info.main"
                />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <StatCard
                    label="Failed"
                    value={fmt(data.failed.sum)}
                    sub={`${data.failed.count} payments`}
                    Icon={Cancel}
                    color="error.main"
                />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <StatCard
                    label="Refunded"
                    value={fmt(data.refunded.sum)}
                    sub={`${data.refunded.count} payments`}
                    Icon={Cancel}
                    color="text.secondary"
                />
            </Grid>

            {/* Recent payments table */}
            <Grid size={12}>
                <Typography variant="h6" fontWeight={600} color="text.secondary" sx={{ mt: 2 }}>
                    Recent Payments
                </Typography>
                <Divider sx={{ mt: 0.5, mb: 2 }} />
            </Grid>
            <Grid size={12}>
                <RecentPaymentsTable rows={paymentRows} />
            </Grid>
        </>
    );
}

type Props = { searchParams: Promise<{ orgFilter?: string }> };

export default async function AdminBillingPage({ searchParams }: Props) {
    const auth = await checkAdminAuth();
    if (!auth.authorized) redirect("/login");
    if (!auth.adminId) redirect("/unauthorized");

    const { orgFilter } = await searchParams;

    return (
        <Box>
            <Typography variant="h4" fontWeight={700} gutterBottom>
                Billing
            </Typography>
            <Grid container spacing={2} alignItems="stretch">
                <Suspense
                    fallback={Array.from({ length: 6 }).map((_, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
                        <Grid key={i} size={{ xs: 12, sm: 6, md: 3 }}>
                            <Skeleton variant="rounded" height={110} />
                        </Grid>
                    ))}
                >
                    <BillingContent adminId={auth.adminId} orgScope={orgFilter} />
                </Suspense>
            </Grid>
        </Box>
    );
}
