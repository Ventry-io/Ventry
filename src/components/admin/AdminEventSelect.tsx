"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, MenuItem, Stack, TextField } from "@mui/material";

function AdminEventSelectContent() {
  const [events, setEvents] = useState<{ id: number; name: string }[]>([]);
  const [error, setError] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const selectedId = /^\/admin\/events\/(\d+)(?:\/|$)/.exec(pathname)?.[1] || search.get("eventId") || "";
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/event", { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error("Events unavailable");
      return response.json();
    }).then(data => setEvents(data.events)).catch(error => { if (error.name !== "AbortError") setError(true); });
    return () => controller.abort();
  }, [pathname]);
  return <Box sx={{ mb: 2 }}>
    {error && <Alert severity="error">Events could not load. Reload to retry.</Alert>}
    <TextField select fullWidth label="Active event" value={events.some(event => String(event.id) === selectedId) ? selectedId : ""} onChange={event => {
      const id = event.target.value;
      const eventPath = /^\/admin\/events\/\d+(\/.*)?$/.exec(pathname);
      const target = eventPath ? `/admin/events/${id}${eventPath[1] || ""}` : ["/admin", "/admin/users", "/admin/tickets", "/admin/billing"].includes(pathname) ? pathname : "/admin";
      router.push(`${target}?eventId=${id}`);
    }} sx={{ maxWidth: 480 }}>
      <MenuItem value="" disabled>Select an event to manage</MenuItem>
      {events.map(event => <MenuItem key={event.id} value={String(event.id)}>{event.name}</MenuItem>)}
    </TextField>
    {selectedId && events.some(event => String(event.id) === selectedId) && <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
      {[["", "Event settings"], ["/check-in", "Check-in"], ["/badges", "Badges"], ["/community", "Community"]].map(([suffix, label]) => <Button key={label} href={`/admin/events/${selectedId}${suffix}`}>{label}</Button>)}
      <Button href={`/events/${selectedId}`}>Public page</Button>
    </Stack>}
  </Box>;
}

export default function AdminEventSelect() {
  return <Suspense fallback={null}><AdminEventSelectContent /></Suspense>;
}
