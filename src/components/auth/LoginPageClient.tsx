"use client";

import React from "react";
import LoginForm from "@/components/auth/LoginForm";
import { useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import authClient from "@/lib/auth/client";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { getCallbackPath } from "@/lib/auth/callback";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import LastUsedIndicator from "./LastUsedIndicator";

// All recognised status messages keyed by their URL param value.
// Priority is determined by the order they are checked below.
const STATUS_MESSAGES: Record<string, { severity: "success" | "info" | "warning" | "error"; title?: string; body: string }> = {
  // ?registered=true
  registered: {
    severity: "info",
    title: "Check your inbox",
    body: "If this e-mail address isn't registered yet, you'll receive a verification link shortly. Otherwise, try signing in or use 'Reset Password'.",
  },
  // ?status=email_verified
  email_verified: {
    severity: "success",
    title: "Email verified!",
    body: "Your e-mail address has been verified. You can now sign in.",
  },
  // ?status=password_reset
  password_reset: {
    severity: "success",
    title: "Password reset successful!",
    body: "Your password has been updated. You can now sign in with your new password.",
  },
  // ?status=logged_out
  logged_out: {
    severity: "info",
    body: "You have been signed out successfully.",
  },
  // ?status=session_expired
  session_expired: {
    severity: "warning",
    title: "Session expired",
    body: "Your session has expired. Please sign in again.",
  },
  // ?status=unauthorized
  unauthorized: {
    severity: "warning",
    title: "Authentication required",
    body: "You need to be signed in to access that page.",
  },
  // ?status=email_not_verified
  email_not_verified: {
    severity: "error",
    title: "Email not verified",
    body: "Please verify your e-mail address before signing in. Check your inbox for the verification link.",
  },
  // ?status=account_linked
  account_linked: {
    severity: "success",
    title: "Account linked!",
    body: "Your social account has been linked successfully. You can now sign in with it.",
  },
  // ?status=link_failed
  link_failed: {
    severity: "error",
    title: "Account linking failed",
    body: "We could not link your account. Please try again or contact support.",
  },
};

export default function LoginPageClient() {
  const searchParams = useSearchParams();
  const [mounted, setMounted] = React.useState(false);

  const callbackUrl = getCallbackPath(searchParams.get("callbackUrl"));
  const error = searchParams.get("error");
  const provider = searchParams.get("provider");
  const message = searchParams.get("message");
  const accountExists = searchParams.get("account_exists");
  const linkRequired = searchParams.get("link_required");
  const linkProvider = searchParams.get("link_provider") as "google" | "github" | null;
  const linkEmail = searchParams.get("email");

  // Resolve which single status banner to show (first match wins).
  // Read once from searchParams and store in state so it survives URL cleanup.
  const [resolvedStatus, setResolvedStatus] = React.useState<(typeof STATUS_MESSAGES)[string] | null>(null);

  const [linkingPassword, setLinkingPassword] = React.useState("");
  const [linkingLoading, setLinkingLoading] = React.useState(false);
  const [linkingError, setLinkingError] = React.useState("");

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Preserve browser query status before cleaning history after hydration.
    setMounted(true);

    // Read from window.location.search — useSearchParams() can return empty
    // params during SSR/hydration when inside a Suspense boundary.
    const sp = new URLSearchParams(window.location.search);
    const cb = sp.get("callbackUrl") || "/";
    const lr = sp.get("link_required");
    const lp = sp.get("link_provider");
    const le = sp.get("email");
    const msg = sp.get("message");

    // Resolve the status banner from URL params before stripping them.
    if (sp.get("registered")) setResolvedStatus(STATUS_MESSAGES.registered);
    else {
      const status = sp.get("status");
      if (status && STATUS_MESSAGES[status]) setResolvedStatus(STATUS_MESSAGES[status]);
      else if (msg === "Password reset successful") setResolvedStatus(STATUS_MESSAGES.password_reset);
    }

    // Strip all status-related query params from the URL so they don't
    // persist across page refreshes or back-navigation.
    const paramsToStrip = ["registered", "status", "message", "error", "provider", "account_exists"];
    const hasStatusParam = paramsToStrip.some(k => sp.has(k));
    if (hasStatusParam) {
      const next = new URLSearchParams();
      if (cb && cb !== "/") next.set("callbackUrl", cb);
      if (lr) next.set("link_required", lr);
      if (lp) next.set("link_provider", lp);
      if (le) next.set("email", le);
      const qs = next.toString();
      window.history.replaceState(null, "", `/login${qs ? `?${qs}` : ""}`);
    }
  }, []);

  const newUserCallbackURL = `/complete-profile?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  const handleGoogleSignIn = async () => {
    await authClient.signIn.social({ provider: "google", callbackURL: callbackUrl, newUserCallbackURL });
  };

  const handleGitHubSignIn = async () => {
    await authClient.signIn.social({ provider: "github", callbackURL: callbackUrl, newUserCallbackURL });
  };

  const handleLinkingLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinkingError("");
    setLinkingLoading(true);

    if (!linkEmail || !linkProvider) {
      setLinkingError("Email or provider not found. Please try signing in with OAuth again.");
      setLinkingLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/verify-and-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: linkEmail, password: linkingPassword, provider: linkProvider }),
      });

      const data = await response.json();

      if (!response.ok) {
        setLinkingError(data.error || "Invalid password");
        setLinkingLoading(false);
        return;
      }

      await authClient.signIn.social({ provider: linkProvider, callbackURL: callbackUrl });
    } catch (err) {
      console.error("Linking login error:", err);
      setLinkingError("An error occurred. Please try again.");
      setLinkingLoading(false);
    }
  };

  if (!mounted) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      {/* Single mutually-exclusive status banner */}
      {resolvedStatus && (
        <Box sx={{ mb: 2 }}>
          <Alert severity={resolvedStatus.severity}>
            {resolvedStatus.title && (
              <Typography variant="body2" fontWeight="bold" gutterBottom>
                {resolvedStatus.title}
              </Typography>
            )}
            <Typography variant="body2">{resolvedStatus.body}</Typography>
          </Alert>
        </Box>
      )}

      {resolvedStatus === STATUS_MESSAGES.registered && (
        <Button href={`/check-email?callbackUrl=${encodeURIComponent(callbackUrl)}`} sx={{ mb: 2 }}>Open email confirmation</Button>
      )}

      {accountExists && provider && (
        <Box sx={{ mb: 2 }}>
          <Alert severity="info">
            <Typography variant="body2" fontWeight="bold" gutterBottom>
              Account Already Exists
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              We found an existing account with this email. Please log in below, then you can link
              your {provider === "github" ? "GitHub" : "Google"} account from your profile.
            </Typography>
            <Typography variant="body2" color="text.secondary" fontSize="0.875rem">
              After logging in: Profile → Linked Accounts → Link {provider === "github" ? "GitHub" : "Google"}
            </Typography>
          </Alert>
        </Box>
      )}

      {linkRequired && linkProvider && linkEmail && (
        <Box sx={{ mb: 2 }}>
          <Alert severity="info">
            <Typography variant="body2" fontWeight="bold" gutterBottom>
              Link {linkProvider === "github" ? "GitHub" : "Google"} Account
            </Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>
              We found an existing account with email <strong>{linkEmail}</strong>. Please enter your
              password to link your {linkProvider === "github" ? "GitHub" : "Google"} account.
            </Typography>
            <form onSubmit={(e) => { void handleLinkingLogin(e); }}>
              <Stack spacing={2}>
                <TextField
                  label="Password"
                  type="password"
                  value={linkingPassword}
                  onChange={(e) => setLinkingPassword(e.target.value)}
                  required
                  fullWidth
                  autoFocus
                  helperText={`Password for ${linkEmail}`}
                />
                {linkingError && <Alert severity="error">{linkingError}</Alert>}
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  disabled={linkingLoading}
                  startIcon={linkingLoading ? <CircularProgress size={20} /> : null}
                >
                  {linkingLoading
                    ? "Verifying..."
                    : `Verify & Link ${linkProvider === "github" ? "GitHub" : "Google"}`}
                </Button>
              </Stack>
            </form>
          </Alert>
        </Box>
      )}

      {error === "PleaseLoginFirst" && provider && (
        <Box sx={{ mb: 2 }}>
          <Alert severity="warning">
            <Typography variant="body2" fontWeight="bold" gutterBottom>
              Account Linking Required
            </Typography>
            <Typography variant="body2">
              We found an existing account with this email. Please log in with your existing account
              first, then you can link your {provider === "github" ? "GitHub" : "Google"} account
              from your profile.
            </Typography>
          </Alert>
        </Box>
      )}

      {error === "AccessDenied" && message === "AccountExists" && (
        <Box sx={{ mb: 2 }}>
          <Alert severity="info">
            <Typography variant="body2" fontWeight="bold" gutterBottom>
              Account Already Exists
            </Typography>
            <Typography variant="body2">
              An account with this email already exists. Please log in to link this provider to your
              account.
            </Typography>
          </Alert>
        </Box>
      )}

      {!linkRequired && (
        <Stack spacing={3}>
          <LoginForm callbackUrl={callbackUrl} />
          <Typography variant="subtitle2" color="text.secondary" align="center">
            Or
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} justifyContent="center">
            <LoginMethodBox>
              <Button variant="outlined" color="secondary" onClick={() => void handleGoogleSignIn()}>
                Sign in with Google
              </Button>
              <LastUsedIndicator loginMethod="google" />
            </LoginMethodBox>
            <LoginMethodBox>
              <Button variant="outlined" color="secondary" onClick={() => void handleGitHubSignIn()}>
                Sign in with GitHub
              </Button>
              <LastUsedIndicator loginMethod="github" />
            </LoginMethodBox>
          </Stack>
          <Typography variant="caption" color="text.secondary" align="center">
            A Passkey lets you sign in without a password. If you don&apos;t have one yet, create it.
          </Typography>
        </Stack>
      )}
    </>
  );
}

function LoginMethodBox({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      {children}
    </Box>
  );
}
