import EventCard from "@/components/events/EventCard";
import { Container, Grid, Typography, Box } from "@mui/material";
import { prisma } from "@/lib/prisma/prisma";
import type { Prisma } from "@/generated/prisma";
import { Suspense } from "react";
import { connection } from "next/server";
import StatusSnackbar from "@/components/common/StatusSnackbar";

interface SerializedEventForCard {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  imageUrl: string | null;
  location: {
    city: string;
    country: string;
  } | null;
}

const homeEventInclude = {
  location: {
    select: {
      city: true,
      country: true,
    },
  },
} satisfies Prisma.EventInclude;

type HomeEventRow = Prisma.EventGetPayload<{
  include: typeof homeEventInclude;
}>;

async function getHomeEvents(): Promise<SerializedEventForCard[]> {
  await connection();

  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED" },
    include: homeEventInclude,
    orderBy: { startDate: "asc" },
  }) as unknown as HomeEventRow[];

  return events.map((event) => ({
    id: event.id,
    name: event.name,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    imageUrl: event.imageUrl,
    location: event.location
      ? {
          city: event.location.city,
          country: event.location.country,
        }
      : null,
  }));
}

async function HomeEventGrid() {
  const serializedEvents = await getHomeEvents();

  return serializedEvents.length > 0 ? (
    <>
      <Typography role="status" variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {serializedEvents.length === 1 ? "1 event" : `${serializedEvents.length} events`}
      </Typography>
      <Grid container rowSpacing={6} columnSpacing={4}>
        {serializedEvents.map((event, index) => (
          <Grid key={event.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <EventCard event={event} priority={index < 3} />
          </Grid>
        ))}
      </Grid>
    </>
  ) : (
    <Box sx={{ py: 10, px: 3, textAlign: 'center', border: '1px dashed var(--rule-strong)', borderRadius: '16px', bgcolor: 'var(--liner)' }}>
      <Typography variant="h5" component="h2" gutterBottom>No upcoming events yet</Typography>
      <Typography color="text.secondary">New events appear here as soon as organizers publish them.</Typography>
    </Box>
  );
}

function HomeEventsFallback() {
  return (
    <Grid container rowSpacing={6} columnSpacing={4} aria-busy="true" aria-label="Loading events">
      {[0, 1, 2].map(index => (
        <Grid key={index} size={{ xs: 12, sm: 6, md: 4 }}>
          <Box sx={{ aspectRatio: '4 / 3', borderRadius: '16px', bgcolor: 'var(--liner)' }} />
          <Box sx={{ mt: 2, height: 24, width: '70%', borderRadius: '8px', bgcolor: 'var(--liner)' }} />
          <Box sx={{ mt: 1, height: 16, width: '45%', borderRadius: '8px', bgcolor: 'var(--liner)' }} />
        </Grid>
      ))}
    </Grid>
  );
}

export default function Home() {
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Suspense fallback={null}>
        <StatusSnackbar />
      </Suspense>
      <Box component="header" sx={{ mb: { xs: 3, md: 4 }, maxWidth: 720 }}>
        <Typography variant="h1" sx={{ fontSize: { xs: '2.25rem', md: '3.25rem' } }} gutterBottom>
          Upcoming events
        </Typography>
        <Typography variant="h6" component="p" color="text.secondary" sx={{ fontFamily: 'inherit', fontWeight: 400 }}>
          Find your next con, walk or meetup and register in a few steps.
        </Typography>
      </Box>

      <Suspense fallback={<HomeEventsFallback />}>
        <HomeEventGrid />
      </Suspense>
    </Container>
  );
}
