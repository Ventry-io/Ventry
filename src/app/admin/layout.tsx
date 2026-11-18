"use client";

import { Suspense, useState } from "react";
import { Container, Box, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Toolbar, Divider, IconButton, Tooltip } from "@mui/material";
import { Event, Dashboard, People, Settings, Home, SupportAgent, Payments, ChevronLeft, ChevronRight, Business } from "@mui/icons-material";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AdminOrgFilterSelect from "@/components/admin/AdminOrgFilterSelect";

const drawerWidth = 240;
const collapsedDrawerWidth = 72;

const primaryLinks = [
  { href: "/admin", label: "Dashboard", Icon: Dashboard },
  { href: "/admin/events", label: "Events", Icon: Event },
  { href: "/admin/organization", label: "Organization & crew", Icon: Business },
  { href: "/admin/users", label: "Users", Icon: People },
  { href: "/admin/tickets", label: "Tickets", Icon: SupportAgent },
  { href: "/admin/billing", label: "Billing", Icon: Payments },
];

const secondaryLinks = [
  { href: "/admin/settings", label: "Settings", Icon: Settings },
  { href: "/", label: "Back to Site", Icon: Home },
];

type NavLink = { href: string; label: string; Icon: typeof Dashboard };

function NavLinkItem({ href, label, Icon, expanded }: NavLink & { expanded: boolean }) {
  return (
    <ListItem disablePadding sx={{ display: "block" }}>
      <Tooltip title={expanded ? "" : label} placement="right">
        <ListItemButton
          component={Link}
          href={href}
          sx={{ minHeight: 48, justifyContent: expanded ? "initial" : "center", px: 2 }}
        >
          <ListItemIcon sx={{ minWidth: 0, mr: expanded ? 2 : 0, justifyContent: "center" }}>
            <Icon />
          </ListItemIcon>
          {expanded ? <ListItemText primary={label} /> : null}
        </ListItemButton>
      </Tooltip>
    </ListItem>
  );
}

function AdminNavLinksInner({ links, expanded }: { links: NavLink[]; expanded: boolean }) {
  const searchParams = useSearchParams();
  const orgFilter = searchParams.get("orgFilter");
  return links.map(({ href, label, Icon }) => {
    const resolvedHref = orgFilter ? `${href}?orgFilter=${encodeURIComponent(orgFilter)}` : href;
    return <NavLinkItem key={href} href={resolvedHref} label={label} Icon={Icon} expanded={expanded} />;
  });
}

function AdminNavLinks({ links, expanded }: { links: NavLink[]; expanded: boolean }) {
  return (
    <Suspense fallback={links.map(({ href, label, Icon }) => (
      <NavLinkItem key={href} href={href} label={label} Icon={Icon} expanded={expanded} />
    ))}>
      <AdminNavLinksInner links={links} expanded={expanded} />
    </Suspense>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const activeDrawerWidth = expanded ? drawerWidth : collapsedDrawerWidth;

  return (
    <Box
      sx={{
        display: "flex",
        "& ~ footer": {
          ml: `${activeDrawerWidth}px`,
          width: `calc(100% - ${activeDrawerWidth}px)`,
          transition: theme => theme.transitions.create(["margin-left", "width"], {
            duration: theme.transitions.duration.shorter,
          }),
        },
      }}
    >
      <Drawer
        variant="permanent"
        sx={{
          width: activeDrawerWidth,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: activeDrawerWidth,
            boxSizing: "border-box",
            overflowX: "hidden",
            transition: theme => theme.transitions.create("width", {
              duration: theme.transitions.duration.shorter,
            }),
          },
        }}
      >
        <Toolbar />
        <Box sx={{ display: "flex", justifyContent: expanded ? "flex-end" : "center", px: 1, py: 1 }}>
          <Tooltip title={expanded ? "Collapse navigation" : "Expand navigation"} placement="right">
            <IconButton onClick={() => setExpanded(current => !current)} aria-label={expanded ? "Collapse admin navigation" : "Expand admin navigation"}>
              {expanded ? <ChevronLeft /> : <ChevronRight />}
            </IconButton>
          </Tooltip>
        </Box>
        <Divider />
        <Box sx={{ overflow: 'auto' }}>
          <List>
            <AdminNavLinks links={primaryLinks} expanded={expanded} />
          </List>
          <Divider />
          <List>
            <AdminNavLinks links={secondaryLinks} expanded={expanded} />
          </List>
        </Box>
      </Drawer>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          p: { xs: 1.5, md: 3 },
          transition: theme => theme.transitions.create("padding", {
            duration: theme.transitions.duration.shorter,
          }),
        }}
      >
        <Toolbar />
        <Container maxWidth="xl" disableGutters>
          <AdminOrgFilterSelect />
          {children}
        </Container>
      </Box>
    </Box>
  );
}
