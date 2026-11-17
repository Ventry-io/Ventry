"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

type Member = { registrationId: string; ticketId: number; name: string; status: string; active: boolean; roomHolder: boolean; confirmed: boolean };
type Group = {
  id: string;
  productId: string;
  roomTypeName: string | null;
  hotelName: string | null;
  members: Member[];
  pendingInvitations: number;
  stay: { checkIn: string; checkOut: string } | null;
  occupancy: "UNDER" | "OK" | "OVER";
  assignment: { roomId: string; reference: string } | null;
  issues: string[];
};
type Room = {
  id: string;
  hotelName: string;
  productId: string;
  roomTypeName: string | null;
  reference: string;
  assignments: Array<{ groupId: string; checkIn: string; checkOut: string; occupants: number; occupancy: string }>;
};
type Overview = {
  cutoffAt: string | null;
  hotels: Array<{ id: string; name: string }>;
  roomTypes: Array<{ id: string; name: string; hotelId: string | null; hotelName: string | null; minOccupants: number; maxOccupants: number; bookingCapacity: number | null; booked: number; rooms: number }>;
  rooms: Room[];
  groups: Group[];
  unresolved: Array<{ registrationId: string; ticketId: number; name: string; status: string; productId: string | null }>;
};

const ISSUE_LABELS: Record<string, string> = {
  UNASSIGNED: "No room",
  NO_ROOM_BOOKING: "Nobody booked the room",
  EXTRA_ROOM_BOOKING: "Several room bookings",
  INACTIVE_MEMBER: "Inactive member",
  NOT_CONFIRMED: "Not all confirmed",
  UNDER_OCCUPIED: "Under-occupied",
  OVER_OCCUPIED: "Over-occupied",
  STAY_OUTSIDE_ASSIGNMENT: "Stay exceeds booked nights",
};

function errorText(payload: unknown, fallback: string) {
  const error = (payload as { error?: unknown } | null)?.error;
  if (typeof error === "string") return error;
  if (Array.isArray(error)) return (error[0] as { message?: string })?.message || fallback;
  return fallback;
}

const day = (value: string) => new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
const toLocalInput = (value: string | null) => (value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

export default function RoomAllocationPanel({ eventId, canWrite }: { eventId: number; canWrite: boolean }) {
  const base = `/api/admin/event/${eventId}`;
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cutoff, setCutoff] = useState("");
  const [newRooms, setNewRooms] = useState({ productId: "", references: "" });
  const [roomChoice, setRoomChoice] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [mergeChoice, setMergeChoice] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const fetchOverview = useCallback(async () => {
    const res = await fetch(`${base}/rooms`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    return res.ok ? { overview: body as Overview } : { error: errorText(body, "Failed to load rooms.") };
  }, [base]);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchOverview>>) => {
    if (!result.overview) {
      setError(result.error ?? "Failed to load rooms.");
      return;
    }
    setData(result.overview);
    setCutoff(toLocalInput(result.overview.cutoffAt));
  }, []);

  const load = useCallback(async () => apply(await fetchOverview()), [apply, fetchOverview]);

  useEffect(() => {
    fetchOverview().then(apply, () => apply({ error: "Network error. Please reload." }));
  }, [apply, fetchOverview]);

  const call = async (url: string, method: string, payload: unknown, success: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: payload === undefined ? undefined : JSON.stringify(payload) });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorText(body, "Action failed."));
        return false;
      }
      setMessage(success);
      await load();
      return true;
    } catch {
      setError("Network error. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const groupCall = (groupId: string, payload: Record<string, unknown>, success: string) =>
    call(`${base}/room-groups/${groupId}`, "POST", { ...payload, ...(note.trim() ? { note: note.trim() } : {}) }, success);

  if (!data) return error ? <Alert severity="error">{error}</Alert> : <CircularProgress aria-label="Loading rooms" />;

  const conflicts = data.groups.filter((group) => group.issues.some((issue) => issue !== "UNASSIGNED"));

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
        <Typography variant="h4" component="h1">Hotel rooms</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {data.hotels.map((hotel) => (
            <Button key={hotel.id} variant="outlined" href={`${base}/rooms/export?hotelId=${encodeURIComponent(hotel.id)}`}>
              Manifest: {hotel.name}
            </Button>
          ))}
          <Button variant="outlined" href={`${base}/rooms/export`}>Manifest (all)</Button>
          {canWrite && (
            <Button disabled={busy} onClick={() => call(`${base}/room-groups`, "POST", { action: "remind" }, "Reminders sent.")}>
              Remind unresolved
            </Button>
          )}
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {message && <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert>}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" gutterBottom>Room types</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Rooms booked = bookings by room bookers (roommates join by invitation). Rooms = physical rooms added below. Edit beds per room in the event editor.
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Room type</TableCell>
              <TableCell>Hotel</TableCell>
              <TableCell>Beds / room</TableCell>
              <TableCell>Rooms booked</TableCell>
              <TableCell>Rooms</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.roomTypes.map((type) => (
              <TableRow key={type.id}>
                <TableCell>{type.name}</TableCell>
                <TableCell>{type.hotelName ?? "–"}</TableCell>
                <TableCell>{type.minOccupants === type.maxOccupants ? type.maxOccupants : `${type.minOccupants}–${type.maxOccupants}`}</TableCell>
                <TableCell>{type.booked}{type.bookingCapacity !== null ? ` / ${type.bookingCapacity}` : ""}</TableCell>
                <TableCell>{type.rooms}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {canWrite && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" component="h2" gutterBottom>Settings</Typography>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
            <TextField
              type="datetime-local"
              label="Room group cutoff"
              helperText="After this, attendees cannot invite, accept or leave."
              InputLabelProps={{ shrink: true }}
              value={cutoff}
              onChange={(event) => setCutoff(event.target.value)}
            />
            <Button
              disabled={busy}
              onClick={() => call(`${base}/rooms`, "PATCH", { roomGroupCutoffAt: cutoff ? new Date(cutoff).toISOString() : null }, "Cutoff saved.")}
            >
              Save cutoff
            </Button>
            <TextField
              sx={{ flexGrow: 1 }}
              label="Audit note for the next action"
              helperText="Required for split, merge and removal."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Stack>
        </Paper>
      )}

      {conflicts.length > 0 && (
        <Alert severity="warning">
          {conflicts.length} group(s) need attention: {conflicts.map((group) => group.issues.filter((issue) => issue !== "UNASSIGNED").map((issue) => ISSUE_LABELS[issue] ?? issue).join(", ")).join(" · ")}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" gutterBottom>Room groups ({data.groups.length})</Typography>
        <Stack spacing={2}>
          {data.groups.map((group) => {
            const rooms = data.rooms.filter((room) => room.productId === group.productId);
            const others = data.groups.filter((other) => other.id !== group.id && other.productId === group.productId);
            return (
              <Paper key={group.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                  <Chip label={group.roomTypeName ?? group.productId} />
                  {group.hotelName && <Chip variant="outlined" label={group.hotelName} />}
                  {group.assignment && <Chip color="success" label={`Room ${group.assignment.reference}`} />}
                  {group.stay && <Chip variant="outlined" label={`${day(group.stay.checkIn)} – ${day(group.stay.checkOut)}`} />}
                  {group.pendingInvitations > 0 && <Chip variant="outlined" label={`${group.pendingInvitations} open invitation(s)`} />}
                  {group.issues.map((issue) => (
                    <Chip key={issue} color={issue === "UNASSIGNED" ? "default" : "warning"} label={ISSUE_LABELS[issue] ?? issue} />
                  ))}
                </Stack>
                <Box component="ul" sx={{ m: 0, pl: 0, listStyle: "none" }}>
                  {group.members.map((member) => (
                    <li key={member.registrationId}>
                      {canWrite && group.members.length > 1 && (
                        <Checkbox
                          size="small"
                          inputProps={{ "aria-label": `Select ${member.name}` }}
                          checked={(selected[group.id] ?? []).includes(member.registrationId)}
                          onChange={(event) =>
                            setSelected((current) => ({
                              ...current,
                              [group.id]: event.target.checked
                                ? [...(current[group.id] ?? []), member.registrationId]
                                : (current[group.id] ?? []).filter((id) => id !== member.registrationId),
                            }))
                          }
                        />
                      )}
                      #{member.ticketId} {member.name} · {member.status}
                      {member.roomHolder && " · booked the room"}
                      {!member.active && " · inactive"}
                      {canWrite && (
                        <Button size="small" disabled={busy} onClick={() => groupCall(group.id, { action: "remove", registrationId: member.registrationId }, "Member removed.")}>
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                </Box>
                {canWrite && (
                  <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                    <TextField
                      select
                      size="small"
                      label="Room"
                      sx={{ minWidth: 160 }}
                      value={roomChoice[group.id] ?? group.assignment?.roomId ?? ""}
                      onChange={(event) => setRoomChoice((current) => ({ ...current, [group.id]: event.target.value }))}
                    >
                      {rooms.map((room) => (
                        <MenuItem key={room.id} value={room.id}>{room.reference} ({room.assignments.length} booking(s))</MenuItem>
                      ))}
                    </TextField>
                    <Button
                      variant="contained"
                      disabled={busy || !(roomChoice[group.id] ?? "")}
                      onClick={() => groupCall(group.id, { action: "assign", roomId: roomChoice[group.id] }, "Room assigned.")}
                    >
                      Assign
                    </Button>
                    {group.assignment && (
                      <Button disabled={busy} onClick={() => groupCall(group.id, { action: "unassign" }, "Room unassigned.")}>Unassign</Button>
                    )}
                    <Button
                      disabled={busy || !(selected[group.id]?.length)}
                      onClick={() => groupCall(group.id, { action: "split", registrationIds: selected[group.id] }, "Group split.").then((ok) => ok && setSelected((current) => ({ ...current, [group.id]: [] })))}
                    >
                      Split selected
                    </Button>
                    {others.length > 0 && (
                      <>
                        <TextField
                          select
                          size="small"
                          label="Merge group into this"
                          sx={{ minWidth: 200 }}
                          value={mergeChoice[group.id] ?? ""}
                          onChange={(event) => setMergeChoice((current) => ({ ...current, [group.id]: event.target.value }))}
                        >
                          {others.map((other) => (
                            <MenuItem key={other.id} value={other.id}>{other.members.map((member) => member.name).join(", ") || other.id}</MenuItem>
                          ))}
                        </TextField>
                        <Button
                          disabled={busy || !mergeChoice[group.id]}
                          onClick={() => groupCall(group.id, { action: "merge", sourceGroupId: mergeChoice[group.id] }, "Groups merged.")}
                        >
                          Merge
                        </Button>
                      </>
                    )}
                  </Stack>
                )}
              </Paper>
            );
          })}
          {data.groups.length === 0 && <Typography color="text.secondary">No room groups yet.</Typography>}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" gutterBottom>Guests without a group ({data.unresolved.length})</Typography>
        <Stack spacing={1}>
          {data.unresolved.map((registration) => (
            <Stack key={registration.registrationId} direction="row" spacing={1} alignItems="center">
              <Typography sx={{ flexGrow: 1 }}>
                #{registration.ticketId} {registration.name} · {registration.status} · {data.roomTypes.find((type) => type.id === registration.productId)?.name ?? "–"}
              </Typography>
              {canWrite && (
                <Button size="small" disabled={busy} onClick={() => call(`${base}/room-groups`, "POST", { action: "create", registrationIds: [registration.registrationId], ...(note.trim() ? { note: note.trim() } : {}) }, "Group created.")}>
                  Create group
                </Button>
              )}
            </Stack>
          ))}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" gutterBottom>Physical rooms ({data.rooms.length})</Typography>
        {canWrite && (
          <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ mb: 2 }}>
            <TextField
              select
              size="small"
              label="Room type"
              sx={{ minWidth: 200 }}
              value={newRooms.productId}
              onChange={(event) => setNewRooms((current) => ({ ...current, productId: event.target.value }))}
            >
              {data.roomTypes.map((type) => (
                <MenuItem key={type.id} value={type.id}>{type.name}{type.hotelName ? ` (${type.hotelName})` : ""}</MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              sx={{ flexGrow: 1 }}
              label="Room numbers, comma separated"
              value={newRooms.references}
              onChange={(event) => setNewRooms((current) => ({ ...current, references: event.target.value }))}
            />
            <Button
              disabled={busy || !newRooms.productId || !newRooms.references.trim()}
              onClick={() =>
                call(
                  `${base}/rooms`,
                  "POST",
                  {
                    hotelId: data.roomTypes.find((type) => type.id === newRooms.productId)?.hotelId ?? "",
                    productId: newRooms.productId,
                    references: newRooms.references.split(",").map((value) => value.trim()).filter(Boolean),
                  },
                  "Rooms added.",
                ).then((ok) => ok && setNewRooms({ productId: newRooms.productId, references: "" }))
              }
            >
              Add rooms
            </Button>
          </Stack>
        )}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Room</TableCell>
              <TableCell>Hotel</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Bookings</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {data.rooms.map((room) => (
              <TableRow key={room.id}>
                <TableCell>{room.reference}</TableCell>
                <TableCell>{room.hotelName}</TableCell>
                <TableCell>{room.roomTypeName ?? "–"}</TableCell>
                <TableCell>
                  {room.assignments.length === 0
                    ? "Free"
                    : room.assignments.map((assignment) => (
                        <Chip
                          key={assignment.groupId}
                          size="small"
                          sx={{ mr: 0.5 }}
                          color={assignment.occupancy === "OK" ? "default" : "warning"}
                          label={`${day(assignment.checkIn)} – ${day(assignment.checkOut)} · ${assignment.occupants} guest(s)`}
                        />
                      ))}
                </TableCell>
                <TableCell align="right">
                  {canWrite && room.assignments.length === 0 && (
                    <Button size="small" color="error" disabled={busy} onClick={() => call(`${base}/rooms/${room.id}`, "DELETE", undefined, "Room deleted.")}>
                      Delete
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
