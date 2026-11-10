"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add,
  CheckCircle,
  Delete,
  Edit,
  Fingerprint,
  Info,
  Key,
} from "@mui/icons-material";
import authClient from "@/lib/auth/client";
import type { Passkey } from "@better-auth/passkey/client";

type AuthError = {
  message?: string;
  status?: number;
  statusText?: string;
};

type AuthResult<T> = {
  data: T | null;
  error: AuthError | null;
};

function getErrorMessage(error: AuthError | null | undefined, fallback: string) {
  if (!error) return fallback;
  const message = error.message || error.statusText || fallback;
  return error.status ? `${message} (${error.status})` : message;
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getDisplayName(passkey: Passkey, index: number) {
  return passkey.name?.trim() || `Passkey ${index + 1}`;
}

export default function PasskeyManager() {
  const passkeysQuery = authClient.useListPasskeys();
  const passkeys = useMemo(() => passkeysQuery.data ?? [], [passkeysQuery.data]);

  const [addOpen, setAddOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedPasskey, setSelectedPasskey] = useState<Passkey | null>(null);
  const [newPasskeyName, setNewPasskeyName] = useState("");
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refreshPasskeys = async () => {
    await passkeysQuery.refetch();
  };

  const openDetails = (passkey: Passkey) => {
    setSelectedPasskey(passkey);
    setEditName(passkey.name || "");
    setError(null);
    setSuccess(null);
    setDetailsOpen(true);
  };

  const closeAddDialog = () => {
    if (busy) return;
    setAddOpen(false);
    setNewPasskeyName("");
  };

  const closeDetailsDialog = () => {
    if (busy) return;
    setDetailsOpen(false);
    setSelectedPasskey(null);
    setEditName("");
  };

  const handleAddPasskey = async () => {
    const name = newPasskeyName.trim();
    if (!name) {
      setError("Name the passkey before creating it.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await authClient.passkey.addPasskey({ name });

      if (result.error) {
        setError(getErrorMessage(result.error, "Failed to create passkey."));
        return;
      }

      setSuccess("Passkey created.");
      setAddOpen(false);
      setNewPasskeyName("");
      await refreshPasskeys();
    } catch (err) {
      console.error("Failed to create passkey:", err);
      setError(err instanceof Error ? err.message : "Failed to create passkey.");
    } finally {
      setBusy(false);
    }
  };

  const handleRenamePasskey = async () => {
    const name = editName.trim();
    if (!selectedPasskey || !name) {
      setError("Passkey name is required.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await authClient.passkey.updatePasskey({
        id: selectedPasskey.id,
        name,
      }) as AuthResult<{ passkey: Passkey }>;

      if (result.error) {
        setError(getErrorMessage(result.error, "Failed to rename passkey."));
        return;
      }

      setSelectedPasskey(result.data?.passkey ?? { ...selectedPasskey, name });
      setSuccess("Passkey renamed.");
      await refreshPasskeys();
    } catch (err) {
      console.error("Failed to rename passkey:", err);
      setError(err instanceof Error ? err.message : "Failed to rename passkey.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePasskey = async () => {
    if (!selectedPasskey) return;

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await authClient.passkey.deletePasskey({
        id: selectedPasskey.id,
      }) as AuthResult<{ status: boolean }>;

      if (result.error) {
        setError(getErrorMessage(result.error, "Failed to delete passkey."));
        return;
      }

      setDetailsOpen(false);
      setSelectedPasskey(null);
      setEditName("");
      setSuccess("Passkey deleted.");
      await refreshPasskeys();
    } catch (err) {
      console.error("Failed to delete passkey:", err);
      setError(err instanceof Error ? err.message : "Failed to delete passkey.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Passkeys
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Use device biometrics, screen lock, or a security key to sign in.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<Add />}
          onClick={() => {
            setError(null);
            setSuccess(null);
            setAddOpen(true);
          }}
        >
          Add Passkey
        </Button>
      </Stack>

      {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      {success ? <Alert severity="success" sx={{ mt: 2 }}>{success}</Alert> : null}

      {passkeysQuery.isPending ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : passkeys.length === 0 ? (
        <Alert severity="info" sx={{ mt: 2 }}>
          No passkeys registered yet.
        </Alert>
      ) : (
        <Stack spacing={1} sx={{ mt: 2 }}>
          {passkeys.map((passkey, index) => (
            <Box
              key={passkey.id}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 2,
                p: 1.5,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                bgcolor: "background.default",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
                <Fingerprint color="action" />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {getDisplayName(passkey, index)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Created {formatDate(passkey.createdAt)}
                  </Typography>
                </Box>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                {passkey.backedUp ? (
                  <Chip icon={<CheckCircle />} label="Backed up" color="success" size="small" />
                ) : null}
                <Tooltip title="Details">
                  <IconButton size="small" onClick={() => openDetails(passkey)} aria-label={`Manage ${getDisplayName(passkey, index)}`}>
                    <Info fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      <Dialog open={addOpen} onClose={closeAddDialog} fullWidth maxWidth="sm">
        <DialogTitle>Add Passkey</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Passkey name"
              value={newPasskeyName}
              onChange={(event) => setNewPasskeyName(event.target.value)}
              required
              fullWidth
              autoFocus
              placeholder="MacBook Touch ID"
              helperText="Use a name that helps you recognize this device later."
              inputProps={{ maxLength: 80 }}
            />
            <Typography variant="body2" color="text.secondary">
              Next, your browser will guide you through creating a passkey. You can use your device’s fingerprint or face recognition, screen lock, or a security key, depending on what’s available.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAddDialog} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={busy ? <CircularProgress size={18} /> : <Key />}
            onClick={() => void handleAddPasskey()}
            disabled={busy || !newPasskeyName.trim()}
          >
            Create Passkey
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={detailsOpen} onClose={closeDetailsDialog} fullWidth maxWidth="sm">
        <DialogTitle>Passkey Details</DialogTitle>
        <DialogContent>
          {selectedPasskey ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Passkey name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                required
                fullWidth
                inputProps={{ maxLength: 80 }}
              />
              <Divider />
              <DetailRow label="Created" value={formatDate(selectedPasskey.createdAt)} />
              <DetailRow label="Device type" value={selectedPasskey.deviceType || "Unknown"} />
              <DetailRow label="Backed up" value={selectedPasskey.backedUp ? "Yes" : "No"} />
              <DetailRow label="Transports" value={selectedPasskey.transports || "Unknown"} />
              <DetailRow label="AAGUID" value={selectedPasskey.aaguid || "Unknown"} />
              <DetailRow label="ID" value={selectedPasskey.id} />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between" }}>
          <Button
            color="error"
            startIcon={<Delete />}
            onClick={() => void handleDeletePasskey()}
            disabled={busy || !selectedPasskey}
          >
            Delete
          </Button>
          <Box>
            <Button onClick={closeDetailsDialog} disabled={busy}>
              Close
            </Button>
            <Button
              variant="contained"
              startIcon={busy ? <CircularProgress size={18} /> : <Edit />}
              onClick={() => void handleRenamePasskey()}
              disabled={busy || !selectedPasskey || !editName.trim()}
              sx={{ ml: 1 }}
            >
              Save
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "140px 1fr" }, gap: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
        {value}
      </Typography>
    </Box>
  );
}
