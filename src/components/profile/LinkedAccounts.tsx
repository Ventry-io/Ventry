"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  Stack,
  Alert,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  GitHub,
  Google,
  Email,
  Add,
  CheckCircle,
  LinkOff,
  Info,
  Link as LinkIcon
} from "@mui/icons-material";
import PasskeyManager from "./PasskeyManager";
import ForgotPassword from "@/components/auth/ForgotPassword";
import authClient from "@/lib/auth/client";

interface LinkedAccountsProps {
  accounts: Array<{
    id: string;
    accountId: string;
    providerId: string;  // Changed from 'provider' for better-auth
  }>;
  hasPassword: boolean;
}

export default function LinkedAccounts({ accounts, hasPassword }: LinkedAccountsProps) {
  const router = useRouter();
  const [removedAccounts, setRemovedAccounts] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<LinkedAccountsProps['accounts'][number] | null>(null);
  const linkedAccounts = accounts.filter(account => !removedAccounts.includes(`${account.providerId}:${account.accountId}`));
  const hasOAuthProviders = linkedAccounts.some(account => !['credential', 'credentials'].includes(account.providerId));

  const handleUnlink = async (account: LinkedAccountsProps['accounts'][number]) => {
    const key = `${account.providerId}:${account.accountId}`;
    setRemoving(key);
    setError(null);
    setSuccess(null);
    try {
      const result = await authClient.unlinkAccount({ accountId: account.id });
      if (result.error) throw new Error(result.error.message || 'Failed to remove linked account.');
      setRemovedAccounts(previous => [...previous, key]);
      setSelectedAccount(null);
      setSuccess(`${getProviderName(account.providerId)} account removed.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove linked account.');
    } finally {
      setRemoving(null);
    }
  };

  const getProviderIcon = (providerId: string) => {
    switch (providerId) {
      case "github":
        return <GitHub />;
      case "google":
        return <Google />;
      case "credential":
      case "credentials":
        return <Email />;
      default:
        return <LinkIcon />;
    }
  };

  const getProviderName = (providerId: string) => {
    switch (providerId) {
      case "github":
        return "GitHub";
      case "google":
        return "Google";
      case "credential":
      case "credentials":
        return "Email & Password";
      default:
        return providerId;
    }
  };

  const availableProviders = [
    { id: "github", name: "GitHub", icon: <GitHub /> },
    { id: "google", name: "Google", icon: <Google /> }
  ];

  const linkedProviders = linkedAccounts.map(a => a.providerId);
  
  const unlinkableProviders = availableProviders.filter(
    p => !linkedProviders.includes(p.id)
  );

  const handleLinkProvider = async (providerId: string) => {
    if (!hasPassword && !hasOAuthProviders) {
      alert("Please set a password or link an OAuth provider first");
      return;
    }

    // Redirect to password verification page
    // eslint-disable-next-line react-hooks/immutability -- intentional navigation via window.location
    window.location.href = `/link-account/verify?provider=${providerId}&returnTo=${encodeURIComponent('/profile')}`;
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <LinkIcon />
          Linked Accounts
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Manage how you sign in to your account. Email sign-in is required; other accounts can be removed.
        </Typography>

        {error && !selectedAccount && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
        {!hasPassword && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Set an email password before removing linked accounts.
            <Button size="small" onClick={() => setPasswordDialogOpen(true)}>Set Password</Button>
          </Alert>
        )}

        {!hasPassword && !hasOAuthProviders && linkedProviders.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="caption">
              <strong>Security Notice:</strong> Set a password or link an OAuth provider to enable linking additional accounts.
            </Typography>
          </Alert>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" gutterBottom>
          Currently Linked:
        </Typography>

        {linkedProviders.length === 0 ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            No accounts linked yet. Link an account to enable sign-in.
          </Alert>
        ) : (
          <Stack spacing={1} sx={{ mb: 3 }}>
            {linkedAccounts.map(({ id, providerId, accountId }) => (
              <Box
                key={`${providerId}:${accountId}`}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  p: 1.5,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  bgcolor: "background.default"
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {getProviderIcon(providerId)}
                  <Typography variant="body2">
                    {getProviderName(providerId)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  {['credential', 'credentials'].includes(providerId) && (
                    <Chip icon={<CheckCircle />} label="Required" color="success" size="small" />
                  )}
                  <Tooltip title="Details">
                    <IconButton
                      size="small"
                      aria-label={`Manage ${getProviderName(providerId)} account`}
                      disabled={removing !== null}
                      onClick={() => {
                        setSelectedAccount({ id, providerId, accountId });
                        setError(null);
                        setSuccess(null);
                      }}
                    >
                      <Info fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>
            ))}
          </Stack>
        )}

        {unlinkableProviders.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            
            <Typography variant="subtitle2" gutterBottom>
              Available to Link:
            </Typography>

            <Stack spacing={1}>
              {unlinkableProviders.map((provider) => (
                <Box
                  key={provider.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    p: 1.5,
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {provider.icon}
                    <Typography variant="body2">
                      {provider.name}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Add />}
                    onClick={() => void handleLinkProvider(provider.id)}
                    disabled={removing !== null || (!hasPassword && !hasOAuthProviders)}
                  >
                    Link
                  </Button>
                </Box>
              ))}
            </Stack>
          </>
        )}

        <Divider sx={{ my: 3 }} />

        <PasskeyManager />

        <Dialog open={selectedAccount !== null} onClose={() => { if (!removing) setSelectedAccount(null); }} fullWidth maxWidth="sm">
          <DialogTitle>Linked Account Details</DialogTitle>
          <DialogContent>
            {selectedAccount && (
              <Stack spacing={2} sx={{ pt: 1 }}>
                {error && <Alert severity="error">{error}</Alert>}
                <Box>
                  <Typography variant="caption" color="text.secondary">Provider</Typography>
                  <Typography variant="body2">{getProviderName(selectedAccount.providerId)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Account ID</Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{selectedAccount.accountId}</Typography>
                </Box>
                {['credential', 'credentials'].includes(selectedAccount.providerId) ? (
                  <Alert severity="info">Email sign-in is required and cannot be removed.</Alert>
                ) : !hasPassword ? (
                  <Alert severity="info">Set an email password before removing linked accounts.</Alert>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Removing this account disables sign-in with this linked account. Your Ventry account and email sign-in remain available.
                  </Typography>
                )}
              </Stack>
            )}
          </DialogContent>
          <DialogActions sx={{ justifyContent: 'space-between' }}>
            {selectedAccount && !['credential', 'credentials'].includes(selectedAccount.providerId) && (
              <Button
                color="error"
                startIcon={<LinkOff />}
                disabled={!hasPassword || removing !== null}
                onClick={() => void handleUnlink(selectedAccount)}
              >
                {removing ? 'Removing...' : 'Remove'}
              </Button>
            )}
            <Button onClick={() => setSelectedAccount(null)} disabled={removing !== null} sx={{ ml: 'auto' }}>Close</Button>
          </DialogActions>
        </Dialog>

        <ForgotPassword open={passwordDialogOpen} onClose={() => setPasswordDialogOpen(false)} />
      </CardContent>
    </Card>
  );
}
