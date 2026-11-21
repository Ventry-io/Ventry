"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, IconButton, MenuItem, Paper, Stack, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { ArrowDownward, ArrowUpward, Delete } from "@mui/icons-material";
import { EventPageSchema, type EventPage, type NavItem } from "@/types/schemas/event/page";
import { buildSiteCss } from "@/lib/events/page-css";
import { PAGE_TEMPLATES, applyTemplate, type PageTemplate } from "@/lib/events/page-templates";
import BlockList from "./BlockList";
import { LinkList, LinkTargetField, type EditorEnv, type Uploader } from "./BlockFields";
import { CssEditor, ThemeEditor } from "./ThemeEditor";
import PagePreview, { type PreviewEvent } from "./PagePreview";
import { newId } from "./blocks";

// While typing, a trailing hyphen must survive so "about-" can become "about-us"; it is trimmed on blur.
const slugify = (value: string, typing = false) => {
  const slug = value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-/, "").slice(0, 60);
  return typing ? slug : slug.replace(/-$/, "") || "page";
};
const swap = <T,>(items: T[], index: number, delta: number) => {
  const next = [...items];
  [next[index], next[index + delta]] = [next[index + delta], next[index]];
  return next;
};

function PagesEditor({ design, onChange, selected, onSelect }: { design: EventPage; onChange: (design: EventPage) => void; selected: number; onSelect: (index: number) => void }) {
  const setPage = (index: number, patch: Partial<EventPage["pages"][number]>) => {
    const old = design.pages[index].slug;
    const pages = design.pages.map((page, i) => i === index ? { ...page, ...patch } : page);
    // Keep menu links working when a page address changes.
    const retarget = <T extends { target?: { page: string } | { url: string } }>(item: T): T => item.target && "page" in item.target && item.target.page === old && patch.slug ? { ...item, target: { page: patch.slug } } : item;
    onChange({ ...design, pages, nav: design.nav.map(item => ({ ...retarget(item), children: item.children.map(retarget) })) });
  };
  const add = () => {
    let slug = "new-page";
    for (let n = 2; design.pages.some(page => page.slug === slug); n++) slug = `new-page-${n}`;
    onChange({ ...design, pages: [...design.pages, { id: newId(), slug, title: "New page", blocks: [] }] });
    onSelect(design.pages.length);
  };
  return <Stack spacing={1.5}>
    <Typography variant="body2" color="text.secondary">The first page is the event home page. Other pages get their own address, for example /events/…/p/artists.</Typography>
    {design.pages.map((page, index) => <Paper key={page.id} variant="outlined" sx={{ p: 1.5, borderColor: index === selected ? "primary.main" : undefined }}>
      <Stack direction={{ xs: "column", md: "row" }} gap={1} alignItems={{ md: "center" }}>
        <TextField size="small" label="Page title" value={page.title} onChange={event => setPage(index, { title: event.target.value })} />
        <TextField size="small" label="Address" value={page.slug} disabled={index === 0} helperText={index === 0 ? "Home page" : undefined}
          onChange={event => setPage(index, { slug: slugify(event.target.value, true) })}
          onBlur={event => setPage(index, { slug: slugify(event.target.value) })} />
        <Stack direction="row" sx={{ ml: { md: "auto" } }}>
          <Button size="small" variant={index === selected ? "contained" : "text"} onClick={() => onSelect(index)}>Edit elements</Button>
          <IconButton size="small" aria-label={`Move page ${page.title} up`} disabled={index < 2} onClick={() => onChange({ ...design, pages: swap(design.pages, index, -1) })}><ArrowUpward fontSize="small" /></IconButton>
          <IconButton size="small" aria-label={`Move page ${page.title} down`} disabled={index === 0 || index === design.pages.length - 1} onClick={() => onChange({ ...design, pages: swap(design.pages, index, 1) })}><ArrowDownward fontSize="small" /></IconButton>
          <IconButton size="small" aria-label={`Delete page ${page.title}`} disabled={index === 0} onClick={() => {
            if (!window.confirm(`Delete the page “${page.title}” and its elements?`)) return;
            onChange({ ...design, pages: design.pages.filter(p => p.id !== page.id) });
            onSelect(0);
          }}><Delete fontSize="small" /></IconButton>
        </Stack>
      </Stack>
    </Paper>)}
    <Box><Button variant="outlined" disabled={design.pages.length >= 20} onClick={add}>Add page</Button></Box>
  </Stack>;
}

function NavEditor({ nav, onChange, env }: { nav: NavItem[]; onChange: (nav: NavItem[]) => void; env: EditorEnv }) {
  const set = (index: number, item: NavItem) => onChange(nav.map((current, i) => i === index ? item : current));
  return <Stack spacing={1.5}>
    <Typography variant="body2" color="text.secondary">The menu appears below the header on every page. An entry with sub-links becomes a dropdown. On phones the menu collapses into one button.</Typography>
    {nav.map((item, index) => <Paper key={item.id} variant="outlined" sx={{ p: 1.5 }}>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: "column", md: "row" }} gap={1} alignItems={{ md: "center" }}>
          <TextField size="small" label="Menu label" value={item.label} onChange={event => set(index, { ...item, label: event.target.value })} />
          <TextField select size="small" label="Type" value={item.children.length ? "dropdown" : "link"} sx={{ minWidth: 140 }}
            onChange={event => set(index, event.target.value === "dropdown"
              ? { ...item, target: undefined, children: item.children.length ? item.children : [{ id: newId(), label: "Link", target: { page: env.pages[0].slug } }] }
              : { ...item, children: [], target: item.target || { page: env.pages[0].slug } })}>
            <MenuItem value="link">Single link</MenuItem><MenuItem value="dropdown">Dropdown</MenuItem>
          </TextField>
          {!item.children.length && item.target && <LinkTargetField env={env} value={item.target} onChange={target => set(index, { ...item, target })} />}
          <Stack direction="row" sx={{ ml: { md: "auto" } }}>
            <IconButton size="small" aria-label={`Move ${item.label} left`} disabled={index === 0} onClick={() => onChange(swap(nav, index, -1))}><ArrowUpward fontSize="small" /></IconButton>
            <IconButton size="small" aria-label={`Move ${item.label} right`} disabled={index === nav.length - 1} onClick={() => onChange(swap(nav, index, 1))}><ArrowDownward fontSize="small" /></IconButton>
            <IconButton size="small" aria-label={`Remove ${item.label}`} onClick={() => onChange(nav.filter(current => current.id !== item.id))}><Delete fontSize="small" /></IconButton>
          </Stack>
        </Stack>
        {item.children.length > 0 && <Box sx={{ pl: 2, borderLeft: 3, borderColor: "divider" }}><LinkList env={env} links={item.children} onChange={children => set(index, { ...item, children: children.length ? children : item.children })} /></Box>}
      </Stack>
    </Paper>)}
    <Box><Button variant="outlined" disabled={nav.length >= 12} onClick={() => onChange([...nav, { id: newId(), label: "Menu", target: { page: env.pages[0].slug }, children: [] }])}>Add menu entry</Button></Box>
  </Stack>;
}

function TemplatePicker({ onApply }: { onApply: (template: PageTemplate) => void }) {
  const [pending, setPending] = useState<PageTemplate | null>(null);
  return <>
    <Grid container spacing={2}>
      {PAGE_TEMPLATES.map(template => <Grid key={template.id} size={{ xs: 12, sm: 6 }}>
        <Paper variant="outlined" sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", gap: 1 }}>
          <Box aria-hidden sx={{ height: 56, borderRadius: 1, bgcolor: template.design.theme.background, border: 1, borderColor: "divider", display: "flex", alignItems: "center", px: 2, gap: 1 }}>
            <Box sx={{ width: 40, height: 8, borderRadius: 4, bgcolor: template.design.theme.foreground }} />
            <Box sx={{ width: 24, height: 8, borderRadius: 4, bgcolor: template.design.theme.accent }} />
          </Box>
          <Typography variant="subtitle1" component="h3">{template.name}</Typography>
          <Typography variant="body2" sx={{ flex: 1 }}>{template.description}</Typography>
          <Typography variant="caption">{template.design.pages.length} page(s)</Typography>
          <Box><Button variant="outlined" onClick={() => setPending(template)}>Use template</Button></Box>
        </Paper>
      </Grid>)}
    </Grid>
    <Dialog open={!!pending} onClose={() => setPending(null)}>
      <DialogTitle>Use “{pending?.name}”?</DialogTitle>
      <DialogContent>This replaces your pages, menu, colors and custom CSS in the editor. Your uploaded header, background and font are kept. Nothing is published until you publish.</DialogContent>
      <DialogActions>
        <Button onClick={() => setPending(null)}>Cancel</Button>
        <Button variant="contained" onClick={() => { if (pending) onApply(pending); setPending(null); }}>Replace design</Button>
      </DialogActions>
    </Dialog>
  </>;
}

type Message = { severity: "success" | "error"; text: string; live?: boolean };

export default function PageDesigner({ published, draft, publishedAt: initialPublishedAt, event, assetHost, canWrite }: {
  published: EventPage; draft: EventPage | null; publishedAt: string | null; event: PreviewEvent; assetHost: string | null; canWrite: boolean;
}) {
  const [design, setDesign] = useState(draft ?? published);
  // saved: what the server holds for the editor (draft or, without one, the live page); live: what visitors see.
  const [saved, setSaved] = useState(() => JSON.stringify(draft ?? published));
  const [live, setLive] = useState(() => JSON.stringify(published));
  const [publishedAt, setPublishedAt] = useState(initialPublishedAt);
  const [confirm, setConfirm] = useState<"publish" | "discard" | null>(null);
  const dialogId = useId();
  const [tab, setTab] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [saving, setSaving] = useState(false);
  const current = JSON.stringify(design);
  const dirty = current !== saved;
  const unpublished = current !== live;
  const page = design.pages[pageIndex] ?? design.pages[0];
  const css = useMemo(() => buildSiteCss(design.theme, assetHost), [design.theme, assetHost]);
  const validation = EventPageSchema.safeParse(design);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const upload: Uploader = async (file, kind) => {
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("eventId", String(event.id));
      if (kind) form.set("kind", kind);
      const response = await fetch("/api/admin/media/page", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed");
      return data;
    } catch (error) {
      setMessage({ severity: "error", text: error instanceof Error ? error.message : "Upload failed" });
      return null;
    } finally { setUploading(false); }
  };
  const env: EditorEnv = { pages: design.pages.map(p => ({ slug: p.slug, title: p.title })), upload, uploading };

  const request = async (method: "PUT" | "POST" | "DELETE", onDone: (data: { publishedAt?: string }) => void) => {
    if (method !== "DELETE" && !validation.success) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/event/${event.id}/page-design`, {
        method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify({ design: validation.data }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(data.error) ? data.error[0]?.message : data.error || "Saving failed");
      onDone(data);
    } catch (error) {
      setMessage({ severity: "error", text: error instanceof Error ? error.message : "Saving failed. Please retry." });
    } finally { setSaving(false); }
  };
  const saveDraft = () => request("PUT", () => {
    setSaved(current);
    setMessage({ severity: "success", text: "Draft saved. Visitors still see the published page until you publish." });
  });
  const publish = () => request("POST", data => {
    setSaved(current);
    setLive(current);
    setPublishedAt(data.publishedAt ?? new Date().toISOString());
    setMessage({ severity: "success", text: "Your page is live! Visitors now see this version. You can keep editing, changes stay in a draft until you publish again.", live: true });
  });
  const discard = () => request("DELETE", () => {
    setDesign(JSON.parse(live));
    setSaved(live);
    setPageIndex(0);
    setMessage({ severity: "success", text: "Draft discarded. The editor shows the published page again." });
  });
  const busy = !canWrite || saving || uploading;
  const status = dirty ? "Unsaved changes" : unpublished ? "Draft saved, not published yet" : "Published, matches the live page";

  const editor = <Stack spacing={2}>
    <Tabs value={tab} onChange={(_, value: number) => setTab(value)} variant="scrollable" scrollButtons="auto" aria-label="Designer sections">
      {["Elements", "Pages", "Menu", "Design", "Custom CSS", "Templates"].map(label => <Tab key={label} label={label} />)}
    </Tabs>
    {tab === 0 && <Stack spacing={2}>
      <TextField select size="small" label="Page" value={pageIndex} onChange={event => setPageIndex(Number(event.target.value))} sx={{ maxWidth: 320 }}>
        {design.pages.map((p, index) => <MenuItem key={p.id} value={index}>{p.title}{index === 0 ? " (home)" : ""}</MenuItem>)}
      </TextField>
      <BlockList key={page.id} label="Page" allowSections blocks={page.blocks} env={env}
        onChange={blocks => setDesign({ ...design, pages: design.pages.map((p, i) => i === pageIndex ? { ...p, blocks } : p) })} />
    </Stack>}
    {tab === 1 && <PagesEditor design={design} onChange={setDesign} selected={pageIndex} onSelect={index => { setPageIndex(index); }} />}
    {tab === 2 && <NavEditor nav={design.nav} env={env} onChange={nav => setDesign({ ...design, nav })} />}
    {tab === 3 && <ThemeEditor theme={design.theme} env={env} onChange={theme => setDesign({ ...design, theme })} />}
    {tab === 4 && <CssEditor theme={design.theme} result={css} env={env} onChange={theme => setDesign({ ...design, theme })} />}
    {tab === 5 && <TemplatePicker onApply={template => { setDesign(applyTemplate(design, template)); setPageIndex(0); setTab(0); }} />}
  </Stack>;

  const preview = <Stack spacing={1}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
      <Typography variant="subtitle1" component="h2">Preview: {page.title}</Typography>
      <ToggleButtonGroup size="small" exclusive value={mobile ? "mobile" : "desktop"} onChange={(_, value) => value && setMobile(value === "mobile")} aria-label="Preview size">
        <ToggleButton value="desktop">Desktop</ToggleButton><ToggleButton value="mobile">Phone</ToggleButton>
      </ToggleButtonGroup>
    </Stack>
    <PagePreview design={design} pageIndex={pageIndex} css={css.css} event={event} mobile={mobile} onNavigate={setPageIndex} />
  </Stack>;

  return <Stack spacing={2}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}
      sx={{ position: "sticky", top: 64, zIndex: 3, bgcolor: "background.paper", py: 1, borderBottom: 1, borderColor: "divider" }}>
      <Typography variant="h5" component="h1">Event page designer</Typography>
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
        <Box>
          <Typography variant="body2" role="status">{status}</Typography>
          <Typography variant="caption" color="text.secondary">{publishedAt ? `Last published ${new Date(publishedAt).toLocaleString()}` : "Not published from the designer yet"}</Typography>
        </Box>
        <Button href={`/events/${event.id}`} target="_blank">Open live page</Button>
        {unpublished && saved !== live && <Button color="error" onClick={() => setConfirm("discard")} disabled={busy}>Discard draft</Button>}
        <Button variant="outlined" onClick={() => void saveDraft()} disabled={busy || !dirty || !validation.success}>{saving ? "Saving…" : "Save draft"}</Button>
        <Button variant="contained" onClick={() => setConfirm("publish")} disabled={busy || !unpublished || !validation.success}>Publish</Button>
      </Stack>
    </Stack>
    <Dialog open={confirm === "publish"} onClose={() => setConfirm(null)} aria-labelledby={`${dialogId}-publish`}>
      <DialogTitle id={`${dialogId}-publish`}>Publish your event page?</DialogTitle>
      <DialogContent>
        <Typography gutterBottom>All visitors of <strong>/events/{event.id}</strong> and its subpages will see this version right away.</Typography>
        <Typography variant="body2" color="text.secondary">You can keep editing afterwards. New changes are saved as a draft and stay hidden until you publish again.</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setConfirm(null)}>Keep editing</Button>
        <Button variant="contained" onClick={() => { setConfirm(null); void publish(); }}>Publish now</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={confirm === "discard"} onClose={() => setConfirm(null)} aria-labelledby={`${dialogId}-discard`}>
      <DialogTitle id={`${dialogId}-discard`}>Discard your draft?</DialogTitle>
      <DialogContent>All changes since the last publish are lost. The editor goes back to the page visitors see now.</DialogContent>
      <DialogActions>
        <Button onClick={() => setConfirm(null)}>Keep draft</Button>
        <Button color="error" variant="contained" onClick={() => { setConfirm(null); void discard(); }}>Discard draft</Button>
      </DialogActions>
    </Dialog>
    {!canWrite && <Alert severity="info">You have read-only access to this event.</Alert>}
    {message && <Alert severity={message.severity} onClose={() => setMessage(null)}
      action={message.live ? <Button color="inherit" size="small" href={`/events/${event.id}`} target="_blank">View live page</Button> : undefined}>{message.text}</Alert>}
    {!validation.success && <Alert severity="warning">
      Fix these before saving or publishing:
      <Box component="ul" sx={{ m: 0, pl: 3 }}>{[...new Set(validation.error.issues.map(issue => issue.message))].slice(0, 6).map(text => <li key={text}>{text}</li>)}</Box>
    </Alert>}
    <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, value) => value && setView(value)} sx={{ display: { md: "none" } }} aria-label="Show editor or preview">
      <ToggleButton value="edit">Edit</ToggleButton><ToggleButton value="preview">Preview</ToggleButton>
    </ToggleButtonGroup>
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 5 }} sx={{ display: { xs: view === "edit" ? "block" : "none", md: "block" } }}>{editor}</Grid>
      <Grid size={{ xs: 12, md: 7 }} sx={{ display: { xs: view === "preview" ? "block" : "none", md: "block" } }}>
        <Box sx={{ position: { md: "sticky" }, top: { md: 140 } }}>{preview}</Box>
      </Grid>
    </Grid>
  </Stack>;
}
