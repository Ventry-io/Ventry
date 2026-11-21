"use client";

import { useId, useState, type ReactNode } from "react";
import { Box, Tab, Tabs, Typography } from "@mui/material";
import type { PageBlock } from "@/types/schemas/event/page";
import PageBlocks, { type BlockSlots, type SiteContext } from "./site/PageBlocks";

/** Home page content: designed blocks in "Overview", with Schedule and Community as fixed tabs. */
export default function EventPageContent({ blocks, ctx, slots, schedule, community }: {
  blocks: PageBlock[]; ctx: SiteContext; slots: BlockSlots; schedule?: ReactNode; community?: ReactNode;
}) {
  const [tab, setTab] = useState(0);
  const uid = useId();
  return <Box>
    <Tabs value={tab} onChange={(_, value: number) => setTab(value)} aria-label="Event content" variant="scrollable" scrollButtons="auto">
      {["Overview", "Schedule", "Community"].map((label, index) => <Tab key={label} label={label} id={`${uid}-tab-${index}`} aria-controls={`${uid}-panel-${index}`} />)}
    </Tabs>
    <Box role="tabpanel" id={`${uid}-panel-0`} aria-labelledby={`${uid}-tab-0`} hidden={tab !== 0} tabIndex={0} sx={{ pt: 3 }}>
      <PageBlocks blocks={blocks} ctx={ctx} slots={slots} />
    </Box>
    <Box role="tabpanel" id={`${uid}-panel-1`} aria-labelledby={`${uid}-tab-1`} hidden={tab !== 1} tabIndex={0} sx={{ pt: 3 }}>{schedule || <Typography>No schedule published yet.</Typography>}</Box>
    <Box role="tabpanel" id={`${uid}-panel-2`} aria-labelledby={`${uid}-tab-2`} hidden={tab !== 2} tabIndex={0} sx={{ pt: 3 }}>{community || <Typography>The community is not enabled for this event.</Typography>}</Box>
  </Box>;
}
