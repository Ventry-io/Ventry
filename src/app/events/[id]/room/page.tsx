import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Container } from "@mui/material";
import { getSession } from "@/lib/auth/session";
import PageLoadingState from "@/components/common/PageLoadingState";
import RoomGroupPanel from "@/components/events/rooms/RoomGroupPanel";

export default function EventRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <EventRoomPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EventRoomPageContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const eventId = Number((await params).id);
  if (!Number.isInteger(eventId)) notFound();
  const { invite } = await searchParams;

  const session = await getSession();
  if (!session?.user) {
    const back = `/events/${eventId}/room${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(back)}`);
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <RoomGroupPanel eventId={eventId} highlightToken={invite ?? null} />
    </Container>
  );
}
