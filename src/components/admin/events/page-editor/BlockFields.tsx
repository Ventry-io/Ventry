"use client";

import { useState } from "react";
import { Alert, Box, Button, IconButton, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { Delete } from "@mui/icons-material";
import { LINK_ICONS, type LinkTarget, type PageBlock, type PageLinkSchema } from "@/types/schemas/event/page";
import type { z } from "zod";
import { newId } from "./blocks";

export type Uploaded = { url: string; posterUrl?: string };
export type Uploader = (file: File, kind?: "font") => Promise<Uploaded | null>;
export type EditorEnv = { pages: { slug: string; title: string }[]; upload: Uploader; uploading: boolean };
type Link = z.infer<typeof PageLinkSchema>;

const poster = (data: Uploaded) => data.posterUrl && data.posterUrl !== data.url ? data.posterUrl : undefined;

export function UploadButton({ env, label, onUploaded, accept = "image/jpeg,image/png,image/webp,image/gif", kind }: {
  env: EditorEnv; label: string; onUploaded: (data: Uploaded) => void; accept?: string; kind?: "font";
}) {
  return <Button component="label" variant="outlined" size="small" disabled={env.uploading}>
    {env.uploading ? "Uploading…" : label}
    <input hidden type="file" accept={accept} onChange={async event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      const data = file && await env.upload(file, kind);
      if (data) onUploaded(data);
    }} />
  </Button>;
}

/** Small thumbnail of an uploaded image so admins see what they picked without a URL field. */
export function Thumb({ url }: { url?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" width={56} height={56} style={{ objectFit: "cover", borderRadius: 4 }} /> : null;
}

export function LinkTargetField({ env, value, onChange, label = "Link to" }: { env: EditorEnv; value: LinkTarget; onChange: (target: LinkTarget) => void; label?: string }) {
  const isUrl = "url" in value;
  return <Stack direction={{ xs: "column", sm: "row" }} gap={1} sx={{ flex: 1 }}>
    <TextField select size="small" label={label} value={isUrl ? "__url" : value.page} sx={{ minWidth: 180 }}
      onChange={event => onChange(event.target.value === "__url" ? { url: "https://" } : { page: event.target.value })}>
      {env.pages.map(page => <MenuItem key={page.slug} value={page.slug}>Page: {page.title}</MenuItem>)}
      <MenuItem value="__url">External link…</MenuItem>
    </TextField>
    {isUrl && <TextField size="small" label="https:// or mailto: address" value={value.url} onChange={event => onChange({ url: event.target.value })} sx={{ flex: 1 }} />}
  </Stack>;
}

export function LinkList({ env, links, onChange, max = 15 }: { env: EditorEnv; links: Link[]; onChange: (links: Link[]) => void; max?: number }) {
  const set = (index: number, link: Link) => onChange(links.map((current, i) => i === index ? link : current));
  return <Stack spacing={1}>
    {links.map((link, index) => <Stack key={link.id} direction={{ xs: "column", md: "row" }} gap={1} alignItems={{ md: "center" }}>
      <TextField size="small" label="Label" value={link.label} onChange={event => set(index, { ...link, label: event.target.value })} />
      <LinkTargetField env={env} value={link.target} onChange={target => set(index, { ...link, target })} />
      <IconButton aria-label={`Remove link ${link.label || index + 1}`} onClick={() => onChange(links.filter(item => item.id !== link.id))}><Delete /></IconButton>
    </Stack>)}
    <Box><Button size="small" disabled={links.length >= max} onClick={() => onChange([...links, { id: newId(), label: "Link", target: { page: env.pages[0]?.slug || "home" } }])}>Add link</Button></Box>
  </Stack>;
}

function TelegramFields({ block, onChange }: { block: Extract<PageBlock, { type: "telegram" }>; onChange: (block: PageBlock) => void }) {
  const [pinnedText, setPinnedText] = useState(block.pinned.join(", "));
  return <>
    <Alert severity="info">
      Shows the newest posts of a <strong>public</strong> Telegram channel and updates automatically (about every 5 minutes). Visitors can load older posts.
      Private channels, groups and invitation links cannot be embedded. Visitors&apos; browsers connect to Telegram to display the posts.
    </Alert>
    <TextField size="small" label="Public channel username (without @)" helperText="From a link such as https://t.me/yourchannel" value={block.channel}
      onChange={event => onChange({ ...block, channel: event.target.value.replace(/^@|^https?:\/\/t\.me\/(s\/)?/i, "").split(/[/?#]/)[0] })} />
    <TextField size="small" type="number" label="Posts shown at first" value={block.limit} slotProps={{ htmlInput: { min: 3, max: 20 } }}
      onChange={event => onChange({ ...block, limit: Number(event.target.value) })} />
    <TextField size="small" label="Pinned post numbers (optional, comma separated)" helperText="Shown above the newest posts, e.g. 12, 40" value={pinnedText}
      onChange={event => {
        setPinnedText(event.target.value);
        onChange({ ...block, pinned: event.target.value.split(",").map(part => part.trim()).filter(Boolean).map(Number) });
      }} />
  </>;
}

/** Form fields for one non-section block. */
export default function BlockFields({ block, onChange, env }: { block: PageBlock; onChange: (block: PageBlock) => void; env: EditorEnv }) {
  switch (block.type) {
    case "heading": return <Stack direction={{ xs: "column", sm: "row" }} gap={1}>
      <TextField size="small" label="Heading" value={block.text} onChange={event => onChange({ ...block, text: event.target.value })} sx={{ flex: 1 }} />
      <TextField select size="small" label="Size" value={block.level} onChange={event => onChange({ ...block, level: Number(event.target.value) as 2 | 3 })}>
        <MenuItem value={2}>Large</MenuItem><MenuItem value={3}>Small</MenuItem>
      </TextField>
      <TextField select size="small" label="Align" value={block.align} onChange={event => onChange({ ...block, align: event.target.value as "left" | "center" })}>
        <MenuItem value="left">Left</MenuItem><MenuItem value="center">Center</MenuItem>
      </TextField>
    </Stack>;
    case "text": return <>
      <TextField size="small" label="Heading (optional)" value={block.title} onChange={event => onChange({ ...block, title: event.target.value })} />
      <TextField label="Text" multiline minRows={3} value={block.text} onChange={event => onChange({ ...block, text: event.target.value })} />
    </>;
    case "image": return <>
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <Thumb url={block.posterUrl || block.url} />
        <UploadButton env={env} label={block.url ? "Replace image" : "Upload image or GIF"} onUploaded={data => onChange({ ...block, url: data.url, posterUrl: poster(data) })} />
      </Stack>
      <TextField size="small" required label="Image description (for screen readers)" value={block.alt} onChange={event => onChange({ ...block, alt: event.target.value })} />
      <TextField size="small" label="Caption (optional)" value={block.caption || ""} onChange={event => onChange({ ...block, caption: event.target.value || undefined })} />
    </>;
    case "gallery": return <>
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <UploadButton env={env} label="Add image" onUploaded={data => onChange({ ...block, images: [...block.images, { url: data.url, posterUrl: poster(data), alt: "" }] })} />
        <TextField select size="small" label="Columns" value={block.columns} onChange={event => onChange({ ...block, columns: Number(event.target.value) })}>
          {[2, 3, 4].map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
        </TextField>
      </Stack>
      {block.images.length === 0 && <Typography variant="body2">Upload at least one image.</Typography>}
      {block.images.map((image, index) => <Stack key={`${image.url}-${index}`} direction="row" gap={1} alignItems="center">
        <Thumb url={image.posterUrl || image.url} />
        <TextField size="small" required label={`Description of image ${index + 1}`} value={image.alt} sx={{ flex: 1 }}
          onChange={event => onChange({ ...block, images: block.images.map((item, i) => i === index ? { ...item, alt: event.target.value } : item) })} />
        <IconButton aria-label={`Remove image ${index + 1}`} onClick={() => onChange({ ...block, images: block.images.filter((_, i) => i !== index) })}><Delete /></IconButton>
      </Stack>)}
    </>;
    case "button": return <Stack direction={{ xs: "column", md: "row" }} gap={1}>
      <TextField size="small" label="Button text" value={block.label} onChange={event => onChange({ ...block, label: event.target.value })} />
      <LinkTargetField env={env} value={block.target} onChange={target => onChange({ ...block, target })} />
      <TextField select size="small" label="Style" value={block.variant} onChange={event => onChange({ ...block, variant: event.target.value as "contained" | "outlined" })}>
        <MenuItem value="contained">Filled</MenuItem><MenuItem value="outlined">Outline</MenuItem>
      </TextField>
    </Stack>;
    case "link": return <>
      <Stack direction={{ xs: "column", sm: "row" }} gap={1}>
        <TextField select size="small" label="Show as" value={block.display} onChange={event => onChange({ ...block, display: event.target.value as "text" | "icon" | "image" })}>
          <MenuItem value="text">Text</MenuItem><MenuItem value="icon">Icon</MenuItem><MenuItem value="image">Image</MenuItem>
        </TextField>
        <TextField size="small" required sx={{ flex: 1 }} label={block.display === "text" ? "Link text" : "Link description (for screen readers)"} value={block.label} onChange={event => onChange({ ...block, label: event.target.value })} />
        <TextField select size="small" label="Align" value={block.align} onChange={event => onChange({ ...block, align: event.target.value as "left" | "center" })}>
          <MenuItem value="left">Left</MenuItem><MenuItem value="center">Center</MenuItem>
        </TextField>
      </Stack>
      {block.display === "icon" && <TextField select size="small" label="Icon" value={block.icon} onChange={event => onChange({ ...block, icon: event.target.value as typeof block.icon })} sx={{ maxWidth: 220 }}>
        {LINK_ICONS.map(icon => <MenuItem key={icon} value={icon}>{icon === "x" ? "X (Twitter)" : icon[0].toUpperCase() + icon.slice(1)}</MenuItem>)}
      </TextField>}
      {block.display === "image" && <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <Thumb url={block.posterUrl || block.imageUrl} />
        <UploadButton env={env} label={block.imageUrl ? "Replace image" : "Upload image or GIF"} onUploaded={data => onChange({ ...block, imageUrl: data.url, posterUrl: poster(data) })} />
      </Stack>}
      <LinkTargetField env={env} value={block.target} onChange={target => onChange({ ...block, target })} />
      {"url" in block.target && <Alert severity="info">Visitors see a warning that they are leaving this site every time they click an external link.</Alert>}
    </>;
    case "linkMenu": return <>
      <TextField size="small" label="Dropdown button text" value={block.label} onChange={event => onChange({ ...block, label: event.target.value })} />
      <LinkList env={env} links={block.links} onChange={links => onChange({ ...block, links })} />
    </>;
    case "accordion": return <Stack spacing={2}>
      {block.items.map((item, index) => <Stack key={item.id} spacing={1} sx={{ borderLeft: 3, borderColor: "divider", pl: 2 }}>
        <Stack direction="row" gap={1}>
          <TextField size="small" label="Question / title" value={item.title} sx={{ flex: 1 }}
            onChange={event => onChange({ ...block, items: block.items.map((current, i) => i === index ? { ...current, title: event.target.value } : current) })} />
          <IconButton aria-label={`Remove entry ${index + 1}`} disabled={block.items.length === 1} onClick={() => onChange({ ...block, items: block.items.filter(current => current.id !== item.id) })}><Delete /></IconButton>
        </Stack>
        <TextField size="small" label="Answer / content" multiline minRows={2} value={item.text}
          onChange={event => onChange({ ...block, items: block.items.map((current, i) => i === index ? { ...current, text: event.target.value } : current) })} />
      </Stack>)}
      <Box><Button size="small" disabled={block.items.length >= 30} onClick={() => onChange({ ...block, items: [...block.items, { id: newId(), title: "Question", text: "" }] })}>Add entry</Button></Box>
    </Stack>;
    case "spacer": return <TextField select size="small" label="Height" value={block.size} onChange={event => onChange({ ...block, size: event.target.value as "sm" | "md" | "lg" })} sx={{ maxWidth: 200 }}>
      <MenuItem value="sm">Small</MenuItem><MenuItem value="md">Medium</MenuItem><MenuItem value="lg">Large</MenuItem>
    </TextField>;
    case "telegram": return <TelegramFields block={block} onChange={onChange} />;
    case "about": return <Typography variant="body2">Shows the event description from the event settings.</Typography>;
    case "location": return <Typography variant="body2">Shows the venue address and map from the event settings.</Typography>;
    case "attendees": return <Typography variant="body2">Shows attendees who chose to be listed. On subpages this becomes a link to the home page.</Typography>;
    case "divider": case "section": return null;
  }
}
