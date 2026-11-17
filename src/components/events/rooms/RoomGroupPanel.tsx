"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useNotificationStream } from "@/components/common/NotificationBell/useNotificationStream";

type RoomView = {
  cutoffAt: string | null;
  canChange: boolean;
  myStatus: string;
  bookedRoom: { id: string; name: string; minOccupants: number; maxOccupants: number } | null;
  group: {
    id: string;
    roomType: { name: string; minOccupants: number; maxOccupants: number } | null;
    hotelName: string | null;
    roomReference: string | null;
    stay: { checkIn: string; checkOut: string } | null;
    occupancy: "UNDER" | "OK" | "OVER" | null;
    bedsReserved: number;
    members: Array<{ name: string; isMe: boolean; roomHolder: boolean }>;
    pendingInvitations: Array<{ token: string; invitee: string; expiresAt: string }>;
  } | null;
  incomingInvitations: Array<{ token: string; from: string; roomTypeName: string | null; expiresAt: string }>;
};

function errorText(payload: unknown, fallback: string) {
  const error = (payload as { error?: unknown } | null)?.error;
  if (typeof error === "string") return error;
  if (Array.isArray(error)) return (error[0] as { message?: string })?.message || fallback;
  return fallback;
}

const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
const formatDateTime = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function RoomGroupPanel({ eventId, highlightToken }: { eventId: number; highlightToken: string | null }) {
  const [view, setView] = useState<RoomView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  // Per invitation: the invitee confirmed giving up their own room booking.
  const [releaseConfirmed, setReleaseConfirmed] = useState<Record<string, boolean>>({});

  const fetchView = useCallback(async () => {
    const res = await fetch(`/api/event/${eventId}/room`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    return res.ok ? { view: body as RoomView } : { error: errorText(body, "Failed to load your room group.") };
  }, [eventId]);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchView>>) => {
    if (result.view) setView(result.view);
    else setError(result.error ?? "Failed to load your room group.");
    setLoading(false);
  }, []);

  const load = useCallback(async () => apply(await fetchView()), [apply, fetchView]);

  useEffect(() => {
    fetchView().then(apply, () => apply({ error: "Network error. Please reload." }));
  }, [apply, fetchView]);

  // Room changes (invitations, accepts, assignments) always come with a notification: refresh live.
  useNotificationStream(() => {
    void load();
  });

  // Expiries and the cutoff are not pushed: reload when the next one passes.
  useEffect(() => {
    if (!view) return;
    const deadlines = [...(view.group?.pendingInvitations ?? []), ...view.incomingInvitations]
      .map((invitation) => invitation.expiresAt)
      .concat(view.canChange && view.cutoffAt ? [view.cutoffAt] : [])
      .map((value) => new Date(value).getTime())
      .filter((time) => time > Date.now()); // past ones (clock skew) would reload in a loop
    if (deadlines.length === 0) return;
    const timer = setTimeout(() => void load(), Math.min(...deadlines) - Date.now() + 1000);
    return () => clearTimeout(timer);
  }, [view, load]);

  const run = async (url: string, init: RequestInit, success: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorText(body, "Action failed."));
        return;
      }
      setMessage(success);
      await load();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const respond = (token: string, action: "accept" | "reject" | "revoke", success: string, releaseOwnRoom = false) =>
    run(
      `/api/event/${eventId}/room/invitations/${encodeURIComponent(token)}`,
      { method: "POST", body: JSON.stringify(action === "accept" && releaseOwnRoom ? { action, releaseOwnRoom } : { action }) },
      success,
    );

  if (loading) return <CircularProgress aria-label="Loading room group" />;
  if (!view) return <Alert severity="error">{error}</Alert>;

  const { group } = view;
  const roomType = group?.roomType ?? view.bookedRoom;
  const maxBeds = roomType?.maxOccupants ?? 1;
  // Only the room booker's group can invite; every open invitation holds one bed.
  const hasRoom = group ? group.members.some((member) => member.roomHolder) : Boolean(view.bookedRoom);
  const bedsReserved = group?.bedsReserved ?? 1;
  const canInvite = view.canChange && hasRoom && !group?.roomReference && bedsReserved < maxBeds;

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1" gutterBottom>Hotel room</Typography>
        <Typography color="text.secondary">
          Choose who you share your room with. Roommates only see your username.
        </Typography>
        {view.cutoffAt && (
          <Typography color={view.canChange ? "text.secondary" : "warning.main"} sx={{ mt: 1 }}>
            {view.canChange ? "Changes possible until " : "Room groups were locked on "}
            {formatDateTime(view.cutoffAt)}
          </Typography>
        )}
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {message && <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert>}

      {view.incomingInvitations.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" component="h2" gutterBottom>Invitations for you</Typography>
          <Stack spacing={2}>
            {view.incomingInvitations.map((invitation) => {
              const mustRelease = Boolean(view.bookedRoom);
              const confirmed = Boolean(releaseConfirmed[invitation.token]);
              return (
                <Stack
                  key={invitation.token}
                  spacing={1}
                  sx={invitation.token === highlightToken ? { borderLeft: 4, borderColor: "primary.main", pl: 1 } : undefined}
                >
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
                    <Typography sx={{ flexGrow: 1 }}>
                      <strong>{invitation.from}</strong> invited you{invitation.roomTypeName ? ` to share their ${invitation.roomTypeName}` : ""}.
                      {" "}Expires {formatDateTime(invitation.expiresAt)}.
                    </Typography>
                    <Button
                      variant="contained"
                      disabled={busy || !view.canChange || (mustRelease && !confirmed)}
                      onClick={() => respond(invitation.token, "accept", "You joined the room group.", mustRelease)}
                    >
                      {mustRelease ? "Release my room and accept" : "Accept"}
                    </Button>
                    <Button disabled={busy || !view.canChange} onClick={() => respond(invitation.token, "reject", "Invitation declined.")}>
                      Decline
                    </Button>
                  </Stack>
                  {mustRelease && view.bookedRoom && (
                    <Alert severity="warning">
                      You already booked a {view.bookedRoom.name}. Accepting releases your own room booking.
                      <FormControlLabel
                        sx={{ display: "flex", mt: 1 }}
                        control={
                          <Checkbox
                            checked={confirmed}
                            onChange={(event) => setReleaseConfirmed((current) => ({ ...current, [invitation.token]: event.target.checked }))}
                          />
                        }
                        label="I understand that if I am removed from this room group later, I will not have an assigned room."
                      />
                    </Alert>
                  )}
                </Stack>
              );
            })}
          </Stack>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" gutterBottom>Your room group</Typography>
        {!view.bookedRoom && !group && (
          <Typography color="text.secondary">
            You have no room yet. Accept an invitation from someone who booked a room, or book a room yourself.
          </Typography>
        )}
        {view.bookedRoom && !group && (
          <Typography color="text.secondary">
            You booked a {view.bookedRoom.name}. Invite roommates below, or wait for an invitation.
          </Typography>
        )}
        {group && (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {group.roomType && <Chip label={group.roomType.name} />}
              {group.hotelName && <Chip label={group.hotelName} variant="outlined" />}
              <Chip
                color={group.roomReference ? "success" : "default"}
                label={group.roomReference ? `Room ${group.roomReference}` : "No room assigned yet"}
              />
              {group.roomType && <Chip variant="outlined" label={`Beds: ${group.bedsReserved} / ${group.roomType.maxOccupants} reserved`} />}
              {!hasRoom && <Chip color="error" label="Nobody in this group booked the room anymore" />}
              {group.occupancy === "UNDER" && group.roomType && (
                <Chip color="warning" label={`Needs at least ${group.roomType.minOccupants} guests`} />
              )}
            </Stack>
            {group.stay && (
              <Typography>Stay: {formatDate(group.stay.checkIn)} – {formatDate(group.stay.checkOut)}</Typography>
            )}
            <Box component="ul" sx={{ m: 0, pl: 3 }}>
              {group.members.map((member, index) => (
                <li key={`${member.name}-${index}`}>
                  {member.name}{member.isMe ? " (you)" : ""}
                  {member.roomHolder && " – booked the room"}
                </li>
              ))}
            </Box>
            {group.pendingInvitations.length > 0 && (
              <Stack spacing={1}>
                <Typography variant="subtitle2">Open invitations</Typography>
                {group.pendingInvitations.map((invitation) => (
                  <Stack key={invitation.token} direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ flexGrow: 1 }}>
                      {invitation.invitee} · expires {formatDateTime(invitation.expiresAt)}
                    </Typography>
                    <Button size="small" disabled={busy || !view.canChange} onClick={() => respond(invitation.token, "revoke", "Invitation revoked.")}>
                      Revoke
                    </Button>
                  </Stack>
                ))}
              </Stack>
            )}
            {view.canChange && (
              <Box>
                <Button color="error" disabled={busy} onClick={() => run(`/api/event/${eventId}/room`, { method: "DELETE" }, "You left the room group.")}>
                  Leave group
                </Button>
              </Box>
            )}
          </Stack>
        )}
      </Paper>

      {canInvite && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" component="h2" gutterBottom>Invite a roommate</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Enter their username. They only need a ticket for this event. Each open invitation reserves a bed
            until it is answered or expires after 72 hours ({maxBeds - bedsReserved} bed(s) free).
          </Typography>
          <Stack
            component="form"
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                `/api/event/${eventId}/room/invitations`,
                { method: "POST", body: JSON.stringify({ username: username.trim() }) },
                "Invitation sent.",
              ).then(() => setUsername(""));
            }}
          >
            <TextField label="Username" value={username} onChange={(event) => setUsername(event.target.value)} required size="small" />
            <Button type="submit" variant="contained" disabled={busy || !username.trim()}>Send invitation</Button>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
