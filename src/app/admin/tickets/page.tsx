import { withEventScope } from "@/lib/events/admin-context";
import { redirect } from "next/navigation";
import { Alert, Box, Typography } from "@mui/material";
import { checkAdminAuth, adminEventFilter } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma/prisma";
import AdminTicketsOverview from "@/components/admin/tickets/AdminTicketsOverview";
import type { AdminTicket } from "@/components/admin/tickets/AdminTicketsOverview";
import type { Prisma } from "@/generated/prisma";
import { Suspense } from "react";
import PageLoadingState from "@/components/common/PageLoadingState";

const adminTicketInclude = {
  event: {
    select: {
      id: true,
      name: true,
    },
  },
  user: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  registration: {
    select: {
      id: true,
      ticketId: true,
    },
  },
} satisfies Prisma.SupportTicketInclude;

type AdminTicketRow = Prisma.SupportTicketGetPayload<{
  include: typeof adminTicketInclude;
}>;

type Props = { searchParams: Promise<{ orgFilter?: string; eventId?: string }> };

export default function AdminTicketsPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <AdminTicketsPageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminTicketsPageContent({ searchParams }: Props) {
  const { orgFilter, eventId } = await searchParams;
  if (!eventId) redirect("/admin/events");
  const authResult = await checkAdminAuth();

  if (!authResult.authorized) {
    if (authResult.error === "Not authenticated") {
      redirect("/login?callbackUrl=/admin/tickets");
    }

    return (
      <div style={{ padding: "20px", color: "red" }}>
        {authResult.error || "Access Denied"}
      </div>
    );
  }

  if (!authResult.adminId) {
    return <Alert severity="error">Your account has no admin profile.</Alert>;
  }

  const eventFilter = await adminEventFilter(authResult.adminId, orgFilter);
  const tickets = await prisma.supportTicket.findMany({
    where: { event: withEventScope(eventFilter, eventId) },
    include: adminTicketInclude,
    orderBy: {
      updatedAt: "desc",
    },
  }) as AdminTicketRow[];

  const serializedTickets: AdminTicket[] = tickets.map((ticket) => ({
    ...ticket,
    updatedAt: ticket.updatedAt.toISOString(),
  }));

  return (
    <Box>
      <Typography variant="h4" component="h1" fontWeight="bold" gutterBottom>
        Support Tickets
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Overview of tickets for events in your admin scope.
      </Typography>
      <AdminTicketsOverview key={eventId} initialTickets={serializedTickets} />
    </Box>
  );
}
