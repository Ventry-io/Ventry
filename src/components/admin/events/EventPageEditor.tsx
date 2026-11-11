"use client";

import { useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { EventPageSchema, type EventPage, type PageBlock } from "@/types/schemas/event/page";
import EventPageContent, { EventPageHeader } from "@/components/events/EventPageContent";
import EventSchedule from "@/components/events/EventSchedule";
import type { SerializedLocation, SerializedScheduleItem } from "@/types/event";

export default function EventPageEditor({ value, onChange, onUploadingChange, eventId, name, description, location, imageUrl, schedule = [] }: {
  value: EventPage; onChange: (page: EventPage) => void; onUploadingChange: (busy: boolean) => void; eventId?: number; name: string; description: string; location?: Partial<SerializedLocation>; imageUrl?: string | null; schedule?: SerializedScheduleItem[];
}) {
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [newType, setNewType] = useState<PageBlock["type"]>("text");
  const update = (index: number, block: PageBlock) => onChange({ ...value, blocks: value.blocks.map((current, i) => i === index ? block : current) });
  const move = (index: number, delta: number) => {
    const blocks = [...value.blocks];
    [blocks[index], blocks[index + delta]] = [blocks[index + delta], blocks[index]];
    onChange({ ...value, blocks });
  };
  const add = () => {
    const id = crypto.randomUUID();
    const block: PageBlock = newType === "text" ? { id, type: newType, title: "", text: "" } : newType === "image" ? { id, type: newType, url: "", alt: "" } : newType === "telegram" ? { id, type: newType, channel: "", posts: [1] } : { id, type: newType };
    onChange({ ...value, blocks: [...value.blocks, block] });
  };
  const upload = async (file: File | undefined, index?: number) => {
    if (!file) return;
    setUploading(true); setError("");
    onUploadingChange(true);
    try {
      const form = new FormData();
      form.set("file", file);
      if (eventId) form.set("eventId", String(eventId));
      const response = await fetch("/api/admin/media/page", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed");
      if (index === undefined) onChange({ ...value, headerUrl: data.url, headerPosterUrl: data.posterUrl });
      else {
        const block = value.blocks[index];
        if (block.type === "image") update(index, { ...block, url: data.url });
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setUploading(false); onUploadingChange(false); }
  };
  const validation = EventPageSchema.safeParse(value);
  return <Stack component="fieldset" disabled={uploading} spacing={3} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
    <Typography variant="h6">Event page designer</Typography>
    <Typography>Arrange content with the move buttons. Schedule and Community remain fixed tabs. Preview before saving to publish your changes.</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {!validation.success && <Alert severity="warning">{validation.error.issues[0]?.message}</Alert>}
    <Stack direction="row" flexWrap="wrap" gap={2}>
      <TextField select label="Font" value={value.font} onChange={event => onChange({ ...value, font: event.target.value as EventPage["font"] })}>
        {["sans-serif", "serif", "monospace"].map(font => <MenuItem key={font} value={font}>{font}</MenuItem>)}
      </TextField>
      {(["background", "foreground", "accent"] as const).map(key => <TextField key={key} type="color" label={key} value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} sx={{ width: 140 }} />)}
    </Stack>
    <Stack direction="row" flexWrap="wrap" gap={2}>
      <Button component="label" disabled={uploading} variant="outlined">{uploading ? "Uploading…" : "Upload header image or GIF"}<input hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={event => void upload(event.target.files?.[0])} /></Button>
      <Button disabled={!value.headerUrl} onClick={() => onChange({ ...value, headerUrl: undefined, headerPosterUrl: undefined })}>Use event banner</Button>
    </Stack>
    <Typography variant="body2">Up to 5 MB. Animated GIFs use a static image when reduced motion is enabled.</Typography>
    {value.blocks.map((block, index) => <Paper key={block.id} variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
          <Typography component="h3" variant="subtitle1">{index + 1}. {block.type}</Typography>
          <Button aria-label={`Move element ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>Move up</Button>
          <Button aria-label={`Move element ${index + 1} down`} disabled={index === value.blocks.length - 1} onClick={() => move(index, 1)}>Move down</Button>
          <Button color="error" aria-label={`Remove element ${index + 1}`} onClick={() => onChange({ ...value, blocks: value.blocks.filter(item => item.id !== block.id) })}>Remove</Button>
        </Stack>
        {block.type === "text" && <>
          <TextField label="Heading" value={block.title} onChange={event => update(index, { ...block, title: event.target.value })} />
          <TextField label="Text" multiline minRows={3} value={block.text} onChange={event => update(index, { ...block, text: event.target.value })} />
        </>}
        {block.type === "image" && <>
          <TextField label="HTTPS image URL" value={block.url} onChange={event => update(index, { ...block, url: event.target.value })} />
          <TextField required label="Image description" value={block.alt} onChange={event => update(index, { ...block, alt: event.target.value })} />
          <Button component="label" disabled={uploading}>Upload image<input hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={event => void upload(event.target.files?.[0], index)} /></Button>
        </>}
        {block.type === "telegram" && <>
          <Alert severity="info">Only public Telegram channels and public posts support embedding. Private channels, invitation links and private messages are unsupported. Enter a public username and up to 10 post numbers from links such as https://t.me/channel/123. Selected posts show their content and original link; new channel posts are not added automatically. Visitors connect to Telegram when loading these posts.</Alert>
          <TextField label="Public channel username (without @)" value={block.channel} onChange={event => update(index, { ...block, channel: event.target.value })} />
          <TextField label="Post numbers, separated by commas" defaultValue={block.posts.join(", ")} onChange={event => update(index, { ...block, posts: event.target.value.split(",").map(id => Number(id.trim())) })} />
        </>}
      </Stack>
    </Paper>)}
    <Stack direction="row" flexWrap="wrap" gap={2}>
      <TextField select label="New element" value={newType} onChange={event => setNewType(event.target.value as PageBlock["type"])}>
        {["text", "image", "telegram", "about", "location", "attendees"].map(type => <MenuItem key={type} value={type}>{type}</MenuItem>)}
      </TextField>
      <Button disabled={value.blocks.length >= 30} onClick={add}>Add element</Button>
      <Button variant="contained" disabled={!validation.success || uploading} onClick={() => setPreview(true)}>Preview</Button>
    </Stack>
    <Dialog open={preview} onClose={() => setPreview(false)} fullWidth maxWidth="lg">
      <DialogTitle>Event page preview</DialogTitle>
      <DialogContent>
        <EventPageHeader design={value} name={name} imageUrl={imageUrl} />
        <Box sx={{ p: 2 }}><EventPageContent design={value} about={<><Typography variant="h4">About this Event</Typography><Typography sx={{ whiteSpace: "pre-wrap" }}>{description}</Typography></>} location={location && <><Typography variant="h4">Location</Typography><Typography>{location.name}</Typography><Typography>{location.address}</Typography><Typography>{location.postalCode} {location.city}, {location.country}</Typography></>} attendees={<Typography>Attendees appear here.</Typography>} schedule={schedule.length ? <EventSchedule schedule={schedule} /> : undefined} community={<Typography>The event community appears here when enabled.</Typography>} /></Box>
      </DialogContent>
      <DialogActions><Button onClick={() => setPreview(false)}>Close preview</Button></DialogActions>
    </Dialog>
  </Stack>;
}
