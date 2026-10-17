"use client";

import { useEffect, useState } from "react";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { MarkEmailReadOutlined } from "@mui/icons-material";
import authClient from "@/lib/auth/client";
import { getCallbackPath } from "@/lib/auth/callback";

export default function CheckEmail({ email: initialEmail = "", callbackUrl }: { email?: string; callbackUrl?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [remaining, setRemaining] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const callback = getCallbackPath(callbackUrl);

  useEffect(() => {
    if (!remaining) return;
    const timer = window.setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);

  const resend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending || remaining) return;
    setSending(true);
    setError(null);
    try {
      const result = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: callback });
      if (result.error) {
        setError("We could not send the link. Please try again in a moment.");
        setRemaining(60);
        return;
      }
      setSent(true);
      setRemaining(60);
    } catch {
      setError("Connection interrupted. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box sx={{ textAlign: "center" }}>
        <MarkEmailReadOutlined color="primary" sx={{ fontSize: 48, mb: 1 }} />
        <Typography component="h1" variant="h4" fontWeight={700} gutterBottom>Check your inbox</Typography>
        <Typography color="text.secondary">
          If this address is eligible, a confirmation link is on its way. Open it to verify your email and continue where you left off.
        </Typography>
      </Box>
      <Alert severity="info">The link is valid for 24 hours. Check your spam folder if it hasn&apos;t arrived.</Alert>
      {sent && <Alert severity="success">If this address needs verification, we&apos;ve sent a new link.</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Stack component="form" onSubmit={resend} spacing={2}>
        <TextField label="Email address" type="email" autoComplete="email" required fullWidth value={email} onChange={(event) => { setEmail(event.target.value); setSent(false); }} />
        <Button type="submit" variant="outlined" disabled={sending || remaining > 0}>
          {sending ? "Sending…" : remaining ? `Resend in ${remaining}s` : "Resend confirmation link"}
        </Button>
      </Stack>
      <Stack spacing={1} textAlign="center">
        <Button href={`/login?callbackUrl=${encodeURIComponent(callback)}`}>Back to sign in</Button>
        <Typography variant="body2" color="text.secondary">Entered the wrong address?</Typography>
        <Button href={`/register?callbackUrl=${encodeURIComponent(callback)}`}>Register with another email</Button>
      </Stack>
    </Stack>
  );
}
