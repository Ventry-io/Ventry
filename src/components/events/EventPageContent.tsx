"use client";

import { useState, type ReactNode } from "react";
import { Alert, Box, Stack, Tab, Tabs, Typography } from "@mui/material";
import type { EventPage, PageBlock } from "@/types/schemas/event/page";

function TelegramPosts({ block }: { block: Extract<PageBlock, { type: "telegram" }> }) {
  const [failed, setFailed] = useState(false);
  return <Stack spacing={2}>
    <Typography variant="h5" component="h2">Telegram · @{block.channel}</Typography>
    {failed && <Alert severity="info">Telegram could not load. Open the original posts below.</Alert>}
    {block.posts.map(post => <Box key={post}>
      <Box component="iframe" title={`Telegram @${block.channel}, post ${post}`} src={`https://t.me/${block.channel}/${post}?embed=1&mode=tme`}
        loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
        sx={{ width: "100%", height: 420, border: 0, "@media (prefers-reduced-motion: reduce)": { display: "none" } }} />
      <a href={`https://t.me/${block.channel}/${post}`} target="_blank" rel="noopener noreferrer">Open original Telegram post {post}</a>
    </Box>)}
  </Stack>;
}

export function EventPageHeader({ design, name, imageUrl, children }: { design: EventPage; name: string; imageUrl?: string | null; children?: ReactNode }) {
  // ponytail: Remote images have no trusted still frame; upload a header to generate one.
  const source = design.headerUrl || imageUrl;
  return <Box sx={{ position: "relative", height: { xs: 300, md: 500 }, bgcolor: "grey.900", overflow: "hidden", "& .MuiTypography-root": { fontFamily: design.font } }}>
    {source && <Box component="picture" sx={{ "@media (prefers-reduced-motion: reduce)": design.headerPosterUrl ? {} : { display: "none" } }}>
      {design.headerPosterUrl && <source media="(prefers-reduced-motion: reduce)" srcSet={design.headerPosterUrl} />}
      {/* Remote organizer images are displayed directly; never fetched by the application server. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={source} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }} />
    </Box>}
    <Box sx={{ position: "absolute", bottom: 0, width: "100%", p: { xs: 3, md: 6 }, color: "white", background: "linear-gradient(transparent, rgba(0,0,0,.9))" }}>
      <Typography component="h1" variant="h2" sx={{ fontSize: { xs: "2rem", md: "3.75rem" }, overflowWrap: "anywhere" }}>{name}</Typography>
      {children}
    </Box>
  </Box>;
}

export function eventPageStyles(design: EventPage) {
  return {
    bgcolor: design.background, color: design.foreground, fontFamily: design.font,
    "& .MuiTypography-root": { fontFamily: "inherit", color: "inherit" },
    "& .MuiPaper-root": { bgcolor: "inherit", color: "inherit" },
    "& a": { color: design.accent },
    "& .MuiTab-root": { color: design.foreground },
    "& .MuiTab-root.Mui-selected": { color: design.accent },
    "& .MuiTabs-indicator": { bgcolor: design.accent },
    overflowWrap: "anywhere",
  };
}

export default function EventPageContent({ design, about, location, attendees, schedule, community }: {
  design: EventPage; about?: ReactNode; location?: ReactNode; attendees?: ReactNode; schedule?: ReactNode; community?: ReactNode;
}) {
  const [tab, setTab] = useState(0);
  return <Box sx={eventPageStyles(design)}>
    <Tabs value={tab} onChange={(_, value: number) => setTab(value)} aria-label="Event content" variant="scrollable" scrollButtons="auto">
      {["Overview", "Schedule", "Community"].map((label, index) => <Tab key={label} label={label} id={`event-tab-${index}`} aria-controls={`event-panel-${index}`} />)}
    </Tabs>
    <Box role="tabpanel" id="event-panel-0" aria-labelledby="event-tab-0" hidden={tab !== 0} tabIndex={0} sx={{ pt: 3 }}>
      <Stack spacing={4}>
        {design.blocks.map(block => <Box key={block.id}>
          {block.type === "about" ? about : block.type === "location" ? location : block.type === "attendees" ? attendees :
            block.type === "telegram" ? <TelegramPosts block={block} /> : block.type === "text" ? <>
              {block.title && <Typography component="h2" variant="h4">{block.title}</Typography>}
              <Typography sx={{ whiteSpace: "pre-wrap" }}>{block.text}</Typography>
            </> : block.type === "image" ? <>
              <Box component="img" src={block.url} alt={block.alt} loading="lazy" sx={{ maxWidth: "100%", height: "auto", "@media (prefers-reduced-motion: reduce)": { display: "none" } }} />
            </> : null}
        </Box>)}
      </Stack>
    </Box>
    <Box role="tabpanel" id="event-panel-1" aria-labelledby="event-tab-1" hidden={tab !== 1} tabIndex={0} sx={{ pt: 3 }}>{schedule || <Typography>No schedule published yet.</Typography>}</Box>
    <Box role="tabpanel" id="event-panel-2" aria-labelledby="event-tab-2" hidden={tab !== 2} tabIndex={0} sx={{ pt: 3 }}>{community || <Typography>The community is not enabled for this event.</Typography>}</Box>
  </Box>;
}
