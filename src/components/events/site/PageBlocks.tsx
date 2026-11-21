"use client";

import { useCallback, useId, useState, type ReactNode } from "react";
import { Box, Button, Grid, Menu, MenuItem, Stack, Typography } from "@mui/material";
import { Email, ExpandMore, Facebook, Instagram, Language, Link as LinkIcon, MusicNote, OpenInNew, Palette, ShoppingCart, Telegram, X, YouTube } from "@mui/icons-material";
import { linkHref, type LeafBlock, type LinkTarget, type PageBlock } from "@/types/schemas/event/page";
import type { ChannelPosts } from "@/lib/events/telegram";
import TelegramFeed from "./TelegramFeed";
import LeaveSiteGuard, { LEAVE_SITE_ATTR } from "./LeaveSiteGuard";
import { MotionSafeImage } from "./EventSiteFrame";

export type BlockSlots = { about?: ReactNode; location?: ReactNode; attendees?: ReactNode };
export type TelegramInitial = Record<string, ChannelPosts | null>;
export type SiteContext = { eventId: number; homeSlug: string; telegramSource: "public" | "preview"; telegram?: TelegramInitial };

/** Organizer links; external ones are marked so LeaveSiteGuard warns before every visit. */
export function linkProps(ctx: SiteContext, target: LinkTarget) {
  const href = linkHref(ctx.eventId, target, ctx.homeSlug);
  if (!("url" in target)) return { href };
  return { href, [LEAVE_SITE_ATTR]: "true", ...(href.startsWith("https:") ? { target: "_blank", rel: "noopener noreferrer" } : {}) };
}

const ICONS = { link: LinkIcon, website: Language, instagram: Instagram, youtube: YouTube, x: X, facebook: Facebook, telegram: Telegram, email: Email, shop: ShoppingCart, music: MusicNote, art: Palette };

const blockClass = (block: PageBlock) => ["vp-block", `vp-block-${block.type}`, block.cssClass].filter(Boolean).join(" ");
const SPACE = { sm: 2, md: 4, lg: 8 } as const;

export function LinkMenu({ ctx, label, links, className, variant = "outlined" }: {
  ctx: SiteContext; label: string; links: { id: string; label: string; target: LinkTarget }[]; className?: string; variant?: "outlined" | "text";
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  return <Box className={className}>
    <Button variant={variant} aria-haspopup="menu" aria-expanded={!!anchor} aria-controls={anchor ? menuId : undefined}
      endIcon={<ExpandMore />} onClick={event => setAnchor(event.currentTarget)}>{label}</Button>
    <Menu id={menuId} anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
      {links.map(link => <MenuItem key={link.id} component="a" {...linkProps(ctx, link.target)} onClick={() => setAnchor(null)}>{link.label}</MenuItem>)}
    </Menu>
  </Box>;
}

function TelegramBlock({ ctx, block }: { ctx: SiteContext; block: Extract<LeafBlock, { type: "telegram" }> }) {
  const load = useCallback(async (before?: number): Promise<ChannelPosts> => {
    const response = ctx.telegramSource === "public"
      ? await fetch(`/api/event/${ctx.eventId}/telegram?block=${encodeURIComponent(block.id)}${before ? `&before=${before}` : ""}`)
      : await fetch(`/api/admin/event/${ctx.eventId}/telegram-check`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: block.channel, before }),
      });
    if (!response.ok) throw new Error("Telegram unavailable");
    return response.json();
  }, [ctx.telegramSource, ctx.eventId, block.id, block.channel]);
  const initial = ctx.telegram && block.id in ctx.telegram ? ctx.telegram[block.id] : undefined;
  // Remount when the channel changes in the editor so the feed reloads.
  return <TelegramFeed key={block.channel} channel={block.channel} limit={block.limit} pinned={block.pinned} initial={initial} load={load} />;
}

function Leaf({ block, ctx, slots }: { block: LeafBlock; ctx: SiteContext; slots: BlockSlots }) {
  switch (block.type) {
    case "about": case "location": case "attendees": return slots[block.type] ?? null;
    case "heading": return <Typography component={block.level === 2 ? "h2" : "h3"} variant={block.level === 2 ? "h4" : "h5"} sx={{ textAlign: block.align, fontWeight: 700 }}>{block.text}</Typography>;
    case "text": return <>
      {block.title && <Typography component="h2" variant="h4" gutterBottom>{block.title}</Typography>}
      <Typography sx={{ whiteSpace: "pre-wrap" }}>{block.text}</Typography>
    </>;
    case "image": return <Box component="figure" sx={{ m: 0 }}>
      <MotionSafeImage src={block.url} poster={block.posterUrl} alt={block.alt} style={{ maxWidth: "100%", height: "auto", display: "block" }} />
      {block.caption && <Typography component="figcaption" variant="body2" sx={{ mt: 1 }}>{block.caption}</Typography>}
    </Box>;
    case "gallery": return <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: `repeat(${block.columns}, minmax(0, 1fr))` } }}>
      {block.images.map((image, index) => <MotionSafeImage key={`${image.url}-${index}`} src={image.url} poster={image.posterUrl} alt={image.alt}
        style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />)}
    </Box>;
    case "button": return <Button variant={block.variant} size="large" {...linkProps(ctx, block.target)}>{block.label}</Button>;
    case "link": {
      const props = linkProps(ctx, block.target);
      const external = "url" in block.target;
      const Icon = ICONS[block.icon];
      return <Box sx={{ textAlign: block.align }}>
        {block.display === "image" && block.imageUrl
          ? <Box component="a" {...props} sx={{ display: "inline-block", borderRadius: 1, "&:focus-visible": { outline: "3px solid currentcolor", outlineOffset: 3 } }}>
            <MotionSafeImage src={block.imageUrl} poster={block.posterUrl} alt={block.label} style={{ maxWidth: "100%", height: "auto", display: "block" }} />
          </Box>
          : block.display === "icon"
            ? <Box component="a" {...props} aria-label={block.label} title={block.label} sx={{ display: "inline-flex", p: 1, borderRadius: "50%", "&:focus-visible": { outline: "3px solid currentcolor" } }}>
              <Icon sx={{ fontSize: 40 }} />
            </Box>
            : <Typography component="span" sx={{ fontSize: "1.1rem" }}><a {...props}>{block.label}</a>{external && <OpenInNew titleAccess="external link" sx={{ fontSize: "1rem", ml: 0.5, verticalAlign: "middle" }} />}</Typography>}
      </Box>;
    }
    case "linkMenu": return <LinkMenu ctx={ctx} label={block.label} links={block.links} />;
    case "accordion": return <Stack spacing={1}>
      {block.items.map(item => <Box key={item.id} component="details" sx={{ border: 1, borderColor: "currentcolor", borderRadius: 1, px: 2, py: 1, "& summary": { cursor: "pointer", fontWeight: 600 } }}>
        <summary>{item.title}</summary>
        <Typography sx={{ whiteSpace: "pre-wrap", mt: 1 }}>{item.text}</Typography>
      </Box>)}
    </Stack>;
    case "divider": return <Box component="hr" sx={{ border: 0, borderTop: 1, borderColor: "currentcolor", opacity: 0.3, my: 0 }} />;
    case "spacer": return <Box aria-hidden sx={{ height: SPACE[block.size] * 8 }} />;
    case "telegram": return <TelegramBlock ctx={ctx} block={block} />;
  }
}

export default function PageBlocks({ blocks, ctx, slots = {} }: { blocks: PageBlock[]; ctx: SiteContext; slots?: BlockSlots }) {
  return <LeaveSiteGuard><Stack spacing={4}>
    {blocks.map(block => block.type === "section"
      ? <Box key={block.id} component="section" className={blockClass(block)} sx={{
        bgcolor: block.background, color: block.foreground, borderRadius: 2, p: SPACE[block.padding],
        ...(block.backgroundImage ? { backgroundImage: `url("${block.backgroundImage}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
      }}>
        <Grid container spacing={4}>
          {block.columns.map((column, index) => <Grid key={`${block.id}-${index}`} size={{ xs: 12, md: 12 / block.columns.length }}>
            <Stack spacing={3}>{column.map(child => <Box key={child.id} className={blockClass(child)}><Leaf block={child} ctx={ctx} slots={slots} /></Box>)}</Stack>
          </Grid>)}
        </Grid>
      </Box>
      : <Box key={block.id} className={blockClass(block)}><Leaf block={block} ctx={ctx} slots={slots} /></Box>)}
  </Stack></LeaveSiteGuard>;
}
