import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Box, Button, Container, Paper, Typography } from "@mui/material";
import PageLoadingState from "@/components/common/PageLoadingState";
import EventLocationMap from "@/components/events/EventLocationMap";
import { EventSiteFrame, EventSiteHeader, EventSiteStyles, pageBackgroundSx } from "@/components/events/site/EventSiteFrame";
import EventSiteNav from "@/components/events/site/EventSiteNav";
import PageBlocks, { type SiteContext } from "@/components/events/site/PageBlocks";
import { buildSiteCss, storageHost } from "@/lib/events/page-css";
import { canEditEvent, getEventViewer, visibleEventWhere } from "@/lib/events/public-event";
import { loadTelegramFeeds } from "@/lib/events/telegram";
import { prisma } from "@/lib/prisma/prisma";
import { normalizeEventPage } from "@/types/schemas/event/page";

type Params = { params: Promise<{ id: string; slug: string }> };

async function loadSubpage({ params }: Params) {
  const { id: rawId, slug } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id)) return null;
  const viewer = await getEventViewer();
  const event = await prisma.event.findFirst({
    where: visibleEventWhere(id, viewer),
    include: { location: true, products: { select: { type: true } } },
  });
  if (!event) return null;
  const design = normalizeEventPage(event.pageDesign);
  // The first page is the event home at /events/[id]; it is not served twice.
  const index = design.pages.findIndex(page => page.slug === slug);
  return index > 0 ? { event, design, page: design.pages[index], canEdit: canEditEvent(event, viewer) } : null;
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const data = await loadSubpage(props);
  return data ? { title: `${data.page.title} · ${data.event.name}` } : {};
}

export default function EventSubpage(props: Params) {
  return <Suspense fallback={<PageLoadingState />}><EventSubpageContent {...props} /></Suspense>;
}

async function EventSubpageContent(props: Params) {
  const data = await loadSubpage(props);
  if (!data) notFound();
  const { event, design, page, canEdit } = data;
  const { theme } = design;
  const ctx: SiteContext = { eventId: event.id, homeSlug: design.pages[0].slug, telegramSource: "public", telegram: await loadTelegramFeeds(page.blocks) };
  const hasTickets = event.products.some(product => product.type === "TICKET");

  return <Box sx={{ ...pageBackgroundSx(theme), minHeight: "100vh" }}>
    <EventSiteStyles css={buildSiteCss(theme, storageHost()).css} />
    <EventSiteFrame theme={theme}>
      <EventSiteHeader theme={theme} name={event.name} imageUrl={event.imageUrl}>
        <Typography variant="h5" component="p">{page.title}</Typography>
      </EventSiteHeader>
      <EventSiteNav nav={design.nav} ctx={ctx} currentHref={`/events/${event.id}/p/${page.slug}`} />
    </EventSiteFrame>
    <Container maxWidth="lg" sx={{ py: 6 }}>
      <EventSiteFrame theme={theme} sx={{ p: { xs: 0, md: 1 } }}>
        <Box component="main" className={`vp-page vp-page-${page.slug}`}>
          <PageBlocks blocks={page.blocks} ctx={ctx} slots={{
            about: <><Typography variant="h4" component="h2" gutterBottom>About this Event</Typography><Typography sx={{ whiteSpace: "pre-wrap" }}>{event.description}</Typography></>,
            location: event.location && <><Typography variant="h4" component="h2" gutterBottom>Location</Typography>
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Typography variant="h6">{event.location.name}</Typography>
                <Typography>{event.location.address}</Typography>
                <Typography>{event.location.postalCode} {event.location.city}, {event.location.country}</Typography>
                <EventLocationMap location={event.location} />
              </Paper></>,
            // shortcut: the attendee list needs the full registration query; subpages link to the home page instead.
            attendees: <Button variant="outlined" href={`/events/${event.id}`}>See who is attending</Button>,
          }} />
        </Box>
      </EventSiteFrame>
      <Paper elevation={4} sx={{ p: 3, mt: 6, borderRadius: 2, display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h6" component="p">{hasTickets ? "Tickets and registration" : "No ticket or booking is required for this event."}</Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          {canEdit && <Button variant="outlined" color="secondary" href={`/admin/events/${event.id}/page-designer`}>Design this page</Button>}
          <Button variant="contained" href={hasTickets ? `/events/${event.id}/register` : `/events/${event.id}`}>{hasTickets ? "Register" : "Back to event"}</Button>
        </Box>
      </Paper>
    </Container>
  </Box>;
}
