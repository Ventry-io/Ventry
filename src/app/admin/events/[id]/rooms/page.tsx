import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Box } from "@mui/material";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import PageLoadingState from "@/components/common/PageLoadingState";
import RoomAllocationPanel from "@/components/admin/rooms/RoomAllocationPanel";

export default function AdminEventRoomsPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <AdminEventRoomsPageContent params={params} />
    </Suspense>
  );
}

async function AdminEventRoomsPageContent({ params }: { params: Promise<{ id: string }> }) {
  const eventId = Number((await params).id);
  if (!Number.isInteger(eventId)) notFound();

  const auth = await checkEventAdminAuth(eventId, undefined, "HOTEL_MANAGEMENT");
  if (!auth.authorized) {
    if (auth.error === "Event not found") notFound();
    redirect(`/login?callbackUrl=/admin/events/${eventId}/rooms`);
  }

  return (
    <Box sx={{ py: 4 }}>
      <RoomAllocationPanel eventId={eventId} canWrite={Boolean(auth.canWrite)} />
    </Box>
  );
}
