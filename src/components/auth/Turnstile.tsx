"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Alert, Box, Button, Typography } from "@mui/material";

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

export const turnstileEnabled = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export default function Turnstile({ onChange }: { onChange: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onChange);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { callback.current = onChange; }, [onChange]);
  useEffect(() => {
    const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    if (!ready || !container.current || !api) return;
    const id = api.render(container.current, {
      sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      action: "authenticate",
      callback: (token: string) => { setError(false); callback.current(token); },
      "expired-callback": () => callback.current(""),
      "error-callback": () => { callback.current(""); setError(true); },
    });
    return () => { api.remove(id); callback.current(""); };
  }, [ready, attempt]);
  if (!turnstileEnabled) return null;
  return <Box sx={{ my: 2 }}>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setReady(true)} onError={() => setError(true)} />
    <Typography role="status" variant="body2">{ready ? "Complete the security check before continuing." : "Loading security check…"}</Typography>
    <div ref={container} />
    {error && <Alert severity="error">Security check unavailable. Check your connection, then retry.</Alert>}
    <Button type="button" onClick={() => { if (!ready) { window.location.reload(); return; } onChange(""); setError(false); setAttempt(value => value + 1); }}>Retry security check</Button>
  </Box>;
}
