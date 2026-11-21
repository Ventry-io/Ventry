"use client";

import { useId, useState } from "react";
import { Box, Button, Divider, IconButton, ListSubheader, Menu, MenuItem, Stack } from "@mui/material";
import { Menu as MenuIcon } from "@mui/icons-material";
import type { NavItem } from "@/types/schemas/event/page";
import { LinkMenu, linkProps, type SiteContext } from "./PageBlocks";
import LeaveSiteGuard from "./LeaveSiteGuard";

/** Organizer-defined menu: inline on wide screens, one menu button on phones. */
export default function EventSiteNav({ nav, ctx, currentHref }: { nav: NavItem[]; ctx: SiteContext; currentHref: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  if (!nav.length) return null;
  const current = (href: string) => href === currentHref ? { "aria-current": "page" as const } : {};
  return <LeaveSiteGuard><Box component="nav" aria-label="Event pages" className="vp-nav" sx={{ borderBottom: 1, borderColor: "divider", px: 2, py: 1 }}>
    <Stack direction="row" flexWrap="wrap" gap={1} sx={{ maxWidth: "lg", mx: "auto", display: { xs: "none", md: "flex" } }}>
      {nav.map(item => item.children.length
        ? <LinkMenu key={item.id} ctx={ctx} label={item.label} variant="text" className="vp-nav-item" links={[...(item.target ? [{ id: `${item.id}-self`, label: item.label, target: item.target }] : []), ...item.children]} />
        : item.target && <Button key={item.id} className="vp-nav-item" {...linkProps(ctx, item.target)} {...current(linkProps(ctx, item.target).href)}>{item.label}</Button>)}
    </Stack>
    <Box sx={{ display: { xs: "block", md: "none" } }}>
      <IconButton aria-label="Open event menu" aria-haspopup="menu" aria-expanded={!!anchor} aria-controls={anchor ? menuId : undefined} onClick={event => setAnchor(event.currentTarget)} sx={{ color: "inherit" }}>
        <MenuIcon />
      </IconButton>
      <Menu id={menuId} anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {nav.flatMap((item, index) => [
          ...(index > 0 && item.children.length ? [<Divider key={`${item.id}-divider`} />] : []),
          ...(item.target ? [<MenuItem key={item.id} component="a" {...linkProps(ctx, item.target)} onClick={() => setAnchor(null)}>{item.label}</MenuItem>]
            : [<ListSubheader key={item.id}>{item.label}</ListSubheader>]),
          ...item.children.map(child => <MenuItem key={child.id} component="a" {...linkProps(ctx, child.target)} onClick={() => setAnchor(null)} sx={{ pl: 4 }}>{child.label}</MenuItem>),
        ])}
      </Menu>
    </Box>
  </Box></LeaveSiteGuard>;
}
