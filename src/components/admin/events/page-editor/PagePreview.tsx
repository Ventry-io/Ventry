"use client";

import type { MouseEvent } from "react";
import { Box, Paper, Typography } from "@mui/material";
import { EventSiteFrame, EventSiteHeader, EventSiteStyles, pageBackgroundSx } from "@/components/events/site/EventSiteFrame";
import EventSiteNav from "@/components/events/site/EventSiteNav";
import PageBlocks, { type SiteContext } from "@/components/events/site/PageBlocks";
import type { EventPage } from "@/types/schemas/event/page";

export type PreviewEvent = { id: number; name: string; description: string; imageUrl: string | null; location: { name: string; address: string; city: string; country: string } | null };

/** Renders the draft with the same components as the public page. Internal links switch the previewed page. */
export default function PagePreview({ design, pageIndex, css, event, mobile, onNavigate }: {
  design: EventPage; pageIndex: number; css: string; event: PreviewEvent; mobile: boolean; onNavigate: (index: number) => void;
}) {
  const page = design.pages[pageIndex] ?? design.pages[0];
  const ctx: SiteContext = { eventId: event.id, homeSlug: design.pages[0].slug, telegramSource: "preview" };
  const intercept = (clickEvent: MouseEvent) => {
    const anchor = (clickEvent.target as HTMLElement).closest("a");
    if (!anchor) return;
    clickEvent.preventDefault();
    const path = new URL(anchor.href, window.location.href).pathname;
    const slug = path === `/events/${event.id}` ? design.pages[0].slug : /\/p\/([^/]+)$/.exec(path)?.[1];
    const index = design.pages.findIndex(p => p.slug === slug);
    if (index >= 0) onNavigate(index);
  };
  return <Box onClickCapture={intercept} sx={{ mx: "auto", width: mobile ? 390 : "100%", maxWidth: "100%", border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
    <Box sx={pageBackgroundSx(design.theme)}>
      <EventSiteStyles css={css} />
      <EventSiteFrame theme={design.theme}>
        <EventSiteHeader theme={design.theme} name={event.name} imageUrl={event.imageUrl}>
          {pageIndex > 0 && <Typography variant="h5" component="p">{page.title}</Typography>}
        </EventSiteHeader>
        <EventSiteNav nav={design.nav} ctx={ctx} currentHref={pageIndex > 0 ? `/events/${event.id}/p/${page.slug}` : `/events/${event.id}`} />
      </EventSiteFrame>
      <Box sx={{ p: mobile ? 2 : 4 }}>
        <EventSiteFrame theme={design.theme}>
          <Box className={`vp-page vp-page-${page.slug}`}>
            <PageBlocks blocks={page.blocks} ctx={ctx} slots={{
              about: <><Typography variant="h4" component="h2" gutterBottom>About this Event</Typography><Typography sx={{ whiteSpace: "pre-wrap" }}>{event.description}</Typography></>,
              location: event.location && <><Typography variant="h4" component="h2" gutterBottom>Location</Typography>
                <Paper variant="outlined" sx={{ p: 3 }}><Typography variant="h6">{event.location.name}</Typography><Typography>{event.location.address}</Typography><Typography>{event.location.city}, {event.location.country}</Typography></Paper></>,
              attendees: <><Typography variant="h4" component="h2" gutterBottom>Attendees</Typography><Typography>Attendees who chose to be listed appear here.</Typography></>,
            }} />
          </Box>
        </EventSiteFrame>
        {pageIndex === 0 && <Typography variant="body2" sx={{ mt: 3, opacity: 0.8 }}>On the live page, this content is the “Overview” tab next to Schedule and Community, with the registration box beside it.</Typography>}
      </Box>
    </Box>
  </Box>;
}
