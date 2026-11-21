"use client";

import { useId, useState, type MouseEvent, type ReactNode } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Typography } from "@mui/material";

/** Attribute that marks organizer-provided links leading off this site. */
export const LEAVE_SITE_ATTR = "data-leave-site";

function describe(href: string) {
  try {
    const url = new URL(href);
    // URL.hostname is punycode for international domains, which exposes look-alike characters.
    return url.protocol === "mailto:" ? { kind: "email" as const, target: url.pathname } : { kind: "web" as const, target: url.hostname };
  } catch {
    return { kind: "web" as const, target: href };
  }
}

/**
 * Wraps organizer content. Every click on an external organizer link asks for confirmation first,
 * because the destination is chosen by the organizer and not checked by the platform.
 */
export default function LeaveSiteGuard({ children }: { children: ReactNode }) {
  const [href, setHref] = useState<string | null>(null);
  const uid = useId();
  const intercept = (event: MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(`a[${LEAVE_SITE_ATTR}]`);
    if (!anchor) return;
    if (event.type === "auxclick" && event.button !== 1) return;
    event.preventDefault();
    setHref(anchor.getAttribute("href"));
  };
  const proceed = () => {
    if (!href) return;
    if (href.startsWith("mailto:")) window.location.href = href;
    else window.open(href, "_blank", "noopener,noreferrer");
    setHref(null);
  };
  const info = href ? describe(href) : null;
  const site = typeof window === "undefined" ? "this site" : window.location.hostname;

  return <Box onClickCapture={intercept} onAuxClickCapture={intercept} sx={{ display: "contents" }}>
    {children}
    <Dialog open={!!href} onClose={() => setHref(null)} aria-labelledby={`${uid}-title`} aria-describedby={`${uid}-text`}>
      <DialogTitle id={`${uid}-title`}>{info?.kind === "email" ? "Open your email app?" : `You are leaving ${site}`}</DialogTitle>
      <DialogContent>
        <DialogContentText id={`${uid}-text`} component="div">
          <Typography gutterBottom>
            This link was added by the event organizer and {info?.kind === "email" ? "writes an email to" : "opens an external website"}:
          </Typography>
          <Typography component="p" sx={{ fontWeight: 700, fontSize: "1.15rem", overflowWrap: "anywhere" }}>{info?.target}</Typography>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere", mb: 2 }}>{href}</Typography>
          <Alert severity="warning">
            {site} does not check external links. Only continue if you trust this link and its address looks right.
            Never enter your {site} password or payment details on another website.
          </Alert>
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button autoFocus onClick={() => setHref(null)}>Stay here</Button>
        <Button variant="contained" onClick={proceed}>{info?.kind === "email" ? "Open email app" : "Open link"}</Button>
      </DialogActions>
    </Dialog>
  </Box>;
}
