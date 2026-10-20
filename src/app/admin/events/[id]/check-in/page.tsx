import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import PageLoadingState from "@/components/common/PageLoadingState";
import AdminCheckInScanner from "@/components/admin/check-ins/AdminCheckInScanner";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { prisma } from "@/lib/prisma/prisma";
import Alert from "@mui/material/Alert";

export default function AdminEventCheckInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <AdminEventCheckInPageContent params={params} />
    </Suspense>
  );
}

async function AdminEventCheckInPageContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const eventId = Number((await params).id);
  if (Number.isNaN(eventId)) {
    notFound();
  }

  const authResult = await checkEventAdminAuth(eventId);
  if (!authResult.authorized) {
    redirect("/login?callbackUrl=/admin/events");
  }
  if (authResult.canWrite === false) {
    return <Alert severity="info">You have read-only access. Ask the organization owner for read and write access to check in attendees.</Alert>;
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });

  if (!event) {
    notFound();
  }

  return <AdminCheckInScanner eventId={event.id} />;
}
