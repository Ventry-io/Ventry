"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { CrewAssignment, CrewDepartment, CrewResource } from "@/types/schemas/crew";

export function CrewAssignmentFields({
  orgId,
  value,
  onChange,
}: {
  orgId: string;
  value: CrewAssignment;
  onChange: (value: CrewAssignment) => void;
}) {
  const [departments, setDepartments] = useState<CrewDepartment[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/admin/organizations/${orgId}/crew`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (active) setDepartments(data.departments || []);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [orgId]);
  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      <TextField
        select
        label="Access level"
        value={value.accessLevel}
        onChange={(e) =>
          onChange({ ...value, accessLevel: e.target.value as CrewAssignment["accessLevel"] })
        }
        helperText="Read only can view. Read and write can make changes; sensitive actions also need the permissions below."
      >
        <MenuItem value="READ">Read only</MenuItem>
        <MenuItem value="WRITE">Read and write</MenuItem>
      </TextField>
      {error ? (
        <Alert severity="error">Could not load departments. Reopen this form to retry.</Alert>
      ) : null}
      <TextField
        select
        label="Department"
        value={value.departmentId || ""}
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        onChange={(e) => onChange({ ...value, departmentId: e.target.value || null })}
      >
        <MenuItem value="">Unassigned</MenuItem>
        {value.departmentId && !departments.some((d) => d.id === value.departmentId) ? (
          <MenuItem value={value.departmentId}>Current department</MenuItem>
        ) : null}
        {departments.map((d) => (
          <MenuItem key={d.id} value={d.id}>
            {d.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Crew role"
        value={value.role || ""}
        onChange={(e) => onChange({ ...value, role: e.target.value || null })}
        slotProps={{ htmlInput: { maxLength: 80 } }}
        helperText="For example: Stage manager. Appears on crew registrations and can be added to badges."
      />
    </Stack>
  );
}

export default function CrewHub({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
  const [data, setData] = useState<{
    departments: CrewDepartment[];
    crewResources: CrewResource[];
    canWrite: boolean;
    updatedAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [department, setDepartment] = useState<{
    id?: string;
    name: string;
    planning: string;
  } | null>(null);
  const [resource, setResource] = useState<CrewResource | null>(null);
  const [removal, setRemoval] = useState<{
    type: "department" | "resource";
    id: string;
    name: string;
  } | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/organizations/${orgId}/crew`);
    if (!res.ok) throw new Error("Could not load the crew hub. Please retry.");
    return res.json();
  }, [orgId]);
  useEffect(() => {
    void load()
      .then(setData)
      .catch((err) => setError(err.message));
  }, [load]);
  async function save(body: { action: string; [key: string]: unknown }) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/crew`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          ...(body.action === "resources" ? { updatedAt: data?.updatedAt } : {}),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        if (res.status === 409) setData(await load());
        throw new Error(result.error || "Could not save. Please retry.");
      }
      setData(await load());
      setDepartment(null);
      setResource(null);
      setRemoval(null);
      setNotice("Crew hub updated.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Connection failed. Your changes are still in the form.",
      );
    } finally {
      setSaving(false);
    }
  }
  const feedback = <>{error ? <Alert severity="error">{error}</Alert> : null}</>;
  if (!data)
    return error ? (
      <Stack spacing={2}>
        {feedback}
        <Button
          onClick={() =>
            void load()
              .then((result) => {
                setData(result);
                setError(null);
              })
              .catch((err) => setError(err.message))
          }
        >
          Retry
        </Button>
      </Stack>
    ) : (
      <CircularProgress aria-label="Loading crew hub" />
    );
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6">Crew hub</Typography>
        <Typography color="text.secondary">
          Plan department work, share documents, and keep your team informed. Assign people in
          Members; add staff in Invitations.
        </Typography>
      </Box>
      {!data.canWrite ? (
        <Alert severity="info">
          You have read-only access. Contact the organization owner to request changes.
        </Alert>
      ) : null}
      {!department && !resource && !removal ? feedback : null}
      {notice ? <Alert severity="success">{notice}</Alert> : null}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
      >
        <Typography variant="h6">Departments & planning</Typography>
        {isOwner ? (
          <Button onClick={() => setDepartment({ name: "", planning: "" })}>Add department</Button>
        ) : null}
      </Stack>
      {!data.departments.length ? (
        <Typography color="text.secondary">
          No departments yet. Start with teams such as Operations, Registration or Stage.
        </Typography>
      ) : null}
      {data.departments.map((d) => (
        <Paper variant="outlined" key={d.id} sx={{ p: 2 }}>
          <Typography fontWeight={700}>{d.name}</Typography>
          <Typography
            sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", mt: 1 }}
            color={d.planning ? "text.primary" : "text.secondary"}
          >
            {d.planning || "No planning notes yet."}
          </Typography>
          {data.canWrite ? (
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button onClick={() => setDepartment(d)}>
                Edit {isOwner ? "department" : "planning"}
              </Button>
              {isOwner ? (
                <Button
                  color="error"
                  onClick={() => setRemoval({ type: "department", id: d.id, name: d.name })}
                >
                  Delete
                </Button>
              ) : null}
            </Stack>
          ) : null}
        </Paper>
      ))}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
      >
        <Typography variant="h6">Shared links</Typography>
        {data.canWrite ? (
          <Button onClick={() => setResource({ id: crypto.randomUUID(), title: "", url: "" })}>
            Add link
          </Button>
        ) : null}
      </Stack>
      <Typography color="text.secondary">
        Google Docs, OneDrive, spreadsheets or shift schedules. Document access is managed by its
        provider.
      </Typography>
      {!data.crewResources.length ? (
        <Typography color="text.secondary">No shared links yet.</Typography>
      ) : null}
      {data.crewResources.map((r) => (
        <Paper variant="outlined" key={r.id} sx={{ p: 2 }}>
          <Link
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ overflowWrap: "anywhere" }}
          >
            {r.title} (opens in a new tab)
          </Link>
          {data.canWrite ? (
            <Stack direction="row">
              <Button onClick={() => setResource(r)}>Edit link</Button>
              <Button
                color="error"
                onClick={() => setRemoval({ type: "resource", id: r.id, name: r.title })}
              >
                Remove
              </Button>
            </Stack>
          ) : null}
        </Paper>
      ))}
      <Dialog
        open={!!department}
        onClose={() => {
          if (!saving) setDepartment(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (department) void save({ action: "department", ...department });
          }}
        >
          <DialogTitle>
            {department?.id ? "Edit department planning" : "Add department"}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {feedback}
              <TextField
                autoFocus
                required
                label="Department name"
                value={department?.name || ""}
                disabled={!isOwner || saving}
                onChange={(e) => setDepartment((d) => d && { ...d, name: e.target.value })}
                slotProps={{ htmlInput: { maxLength: 80 } }}
              />
              <TextField
                label="Planning notes"
                multiline
                minRows={4}
                value={department?.planning || ""}
                disabled={saving}
                onChange={(e) => setDepartment((d) => d && { ...d, planning: e.target.value })}
                helperText="Tasks, dates, responsibilities and handover notes."
                slotProps={{ htmlInput: { maxLength: 10000 } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={saving} onClick={() => setDepartment(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Saving…" : "Save department"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
      <Dialog
        open={!!resource}
        onClose={() => {
          if (!saving) setResource(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (resource)
              void save({
                action: "resources",
                resources: [...data.crewResources.filter((r) => r.id !== resource.id), resource],
              });
          }}
        >
          <DialogTitle>
            {data.crewResources.some((r) => r.id === resource?.id)
              ? "Edit shared link"
              : "Add shared link"}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {feedback}
              <TextField
                autoFocus
                required
                label="Link title"
                value={resource?.title || ""}
                disabled={saving}
                onChange={(e) => setResource((r) => r && { ...r, title: e.target.value })}
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
              <TextField
                required
                label="Document URL"
                type="url"
                value={resource?.url || ""}
                disabled={saving}
                onChange={(e) => setResource((r) => r && { ...r, url: e.target.value })}
                helperText="Use an https:// or http:// link."
                slotProps={{ htmlInput: { maxLength: 2000 } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={saving} onClick={() => setResource(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Saving…" : "Save link"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
      <Dialog
        open={!!removal}
        onClose={() => {
          if (!saving) setRemoval(null);
        }}
      >
        <DialogTitle>Remove {removal?.name}?</DialogTitle>
        <DialogContent>
          {feedback}
          <Typography>
            {removal?.type === "department"
              ? "Members and pending invitations will become unassigned. Their access and roles stay the same."
              : "This removes the link from the hub. The original document remains available."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => setRemoval(null)}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            color="error"
            onClick={() =>
              void save(
                removal?.type === "department"
                  ? { action: "deleteDepartment", id: removal.id }
                  : {
                      action: "resources",
                      resources: data.crewResources.filter((r) => r.id !== removal?.id),
                    },
              )
            }
          >
            {saving ? "Removing…" : "Remove"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
