"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Checkbox,
  FormGroup,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Block, Business, Delete, Edit, PersonRemove, Send } from "@mui/icons-material";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSearchParams } from "next/navigation";

import CrewHub, { CrewAssignmentFields } from "./CrewHub";
import type { CrewAssignment } from "@/types/schemas/crew";

const subscribeToOrigin = () => () => {};

function useOrigin() {
  return useSyncExternalStore(subscribeToOrigin, () => window.location.origin, () => "");
}

// ─── Types ────────────────────────────────────────────────────────────────────

type OrgPermission = "COMMUNITY" | "SUPPORT_TICKETS" | "EVENT_APPROVAL" | "STRIPE_FINANCES";
type InvitationStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  ownerId: string;
  createdAt: string;
  _count: { members: number; events: number };
}

interface OrgMember extends CrewAssignment {
  department?: { name: string } | null;
  adminId: string;
  permissions: OrgPermission[];
  joinedAt: string;
  admin: {
    id: string;
    user: { id: string; name: string; email: string; image: string | null };
  };
}

interface OrgInvitation extends CrewAssignment {
  department?: { name: string } | null;
  id: string;
  token: string;
  invitedEmail: string;
  permissions: OrgPermission[];
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  invitedByAdmin: { user: { id: string; name: string } };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PERMISSION_LABELS: Record<OrgPermission, string> = {
  COMMUNITY: "Community",
  SUPPORT_TICKETS: "Support Tickets",
  EVENT_APPROVAL: "Event Approval",
  STRIPE_FINANCES: "Finances",
};

const ALL_PERMISSIONS: OrgPermission[] = [
  "COMMUNITY",
  "SUPPORT_TICKETS",
  "EVENT_APPROVAL",
  "STRIPE_FINANCES",
];

const STATUS_COLOR: Record<
  InvitationStatus,
  "warning" | "success" | "error" | "default"
> = {
  PENDING: "warning",
  ACCEPTED: "success",
  DECLINED: "error",
  EXPIRED: "default",
};

const CREW_TABLE_SX = {
  "& thead": { display: { xs: "none", md: "table-header-group" } },
  "& tbody": { display: { xs: "block", md: "table-row-group" } },
  "& tbody tr": { display: { xs: "block", md: "table-row" }, borderBottom: { xs: "1px solid", md: 0 }, borderColor: "divider" },
  "& tbody td": { display: { xs: "block", md: "table-cell" }, borderBottom: { xs: 0, md: "1px solid" }, borderColor: "divider", overflowWrap: "anywhere" },
  "& td[data-label]::before": { content: { xs: "attr(data-label)", md: "none" }, display: "block", color: "text.secondary", fontSize: "0.75rem", mb: 0.5 },
};

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createOrgSchema = z.object({
  name: z.string().trim().min(2, "Min 2 characters").max(100, "Max 100 characters"),
  slug: z
    .string()
    .trim()
    .min(2, "Min 2 characters")
    .max(50, "Max 50 characters")
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only"),
  description: z.string().trim().max(500, "Max 500 characters").optional(),
});

const editOrgSchema = z.object({
  name: z.string().trim().min(2, "Min 2 characters").max(100, "Max 100 characters"),
  description: z.string().trim().max(500, "Max 500 characters").optional(),
});

const inviteSchema = z.object({
  email: z.string().trim().email("Invalid email address"),
});

type CreateOrgData = z.infer<typeof createOrgSchema>;
type EditOrgData = z.infer<typeof editOrgSchema>;
type InviteData = z.infer<typeof inviteSchema>;

// ─── PermissionsChips ─────────────────────────────────────────────────────────

function PermissionsChips({ permissions }: { permissions: OrgPermission[] }) {
  if (permissions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  }
  return (
    <Stack direction="row" flexWrap="wrap" gap={0.5}>
      {permissions.map((p) => (
        <Chip key={p} label={PERMISSION_LABELS[p]} size="small" variant="outlined" />
      ))}
    </Stack>
  );
}

// ─── OrgSettings (root) ───────────────────────────────────────────────────────

export default function OrgSettings() {
  const orgFilter = useSearchParams().get("orgFilter");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myAdminId, setMyAdminId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const load = useCallback(() => {
    return Promise.all([
      fetch("/api/admin/profile"),
      fetch("/api/admin/organizations"),
    ]).then(async ([profileRes, orgsRes]) => {
      if (!profileRes.ok) throw new Error("Failed to load profile");
      if (!orgsRes.ok) throw new Error("Failed to load organizations");
      const { admin } = (await profileRes.json()) as { admin: { id: string } };
      const { organizations } = (await orgsRes.json()) as {
        organizations: OrgSummary[];
      };
      setMyAdminId(admin.id);
      setError(null);
      setOrgs(organizations);
      setSelectedOrgId((prev) => {
        if (prev && organizations.some((o) => o.id === prev)) return prev;
        return organizations[0]?.id ?? null;
      });
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load");
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {error}
      </Alert>
    );
  }

  if (!myAdminId) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        Admin profile not found.
      </Alert>
    );
  }

  if (orgs.length === 0) {
    return <CreateOrgForm onCreated={load} />;
  }

  const selectedOrg = orgs.find((o) => o.id === orgFilter) ?? orgs.find((o) => o.id === selectedOrgId) ?? orgs[0];

  return (
    <Box>
      <OrgDashboard
        key={selectedOrg.id}
        org={selectedOrg}
        myAdminId={myAdminId}
        onOrgUpdated={(updated) =>
          setOrgs((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)))
        }
        onOrgDeleted={() => {
          setOrgs((prev) => {
            const remaining = prev.filter((o) => o.id !== selectedOrg.id);
            setSelectedOrgId(remaining[0]?.id ?? null);
            return remaining;
          });
        }}
      />
    </Box>
  );
}

// ─── CreateOrgForm ────────────────────────────────────────────────────────────

function CreateOrgForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const origin = useOrigin();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CreateOrgData>({
    resolver: zodResolver(createOrgSchema),
    mode: "onBlur",
  });

  const orgName = useWatch({ control: form.control, name: "name" }) ?? "";
  const slugManuallyEdited = !!form.formState.dirtyFields.slug;

  const generateSlug = useCallback(
    (name: string) =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    [],
  );

  useEffect(() => {
    if (!slugManuallyEdited && orgName) {
      form.setValue("slug", generateSlug(orgName), { shouldValidate: false });
    }
  }, [orgName, form, generateSlug, slugManuallyEdited]);

  const onSubmit = form.handleSubmit(async (data) => {
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setServerError(body.error ?? "Failed to create organization");
        return;
      }
      await onCreated();
    } catch {
      setServerError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Box sx={{ maxWidth: 560 }}>
      <Paper variant="outlined" sx={{ p: 4, borderRadius: 2 }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
          <Business color="action" sx={{ fontSize: 40 }} />
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Create your organization
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Invite team members and manage events together.
            </Typography>
          </Box>
        </Stack>

        {serverError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {serverError}
          </Alert>
        )}

        <Box component="form" onSubmit={(e) => void onSubmit(e)} noValidate>
          <TextField
            label="Organization name"
            required
            fullWidth
            margin="normal"
            {...form.register("name")}
            error={!!form.formState.errors.name}
            helperText={form.formState.errors.name?.message ?? " "}
          />

          <TextField
            label="URL slug"
            required
            fullWidth
            margin="normal"
            placeholder="my-organization"
            {...form.register("slug")}
            error={!!form.formState.errors.slug}
            helperText={
              form.formState.errors.slug?.message ??
              "Unique identifier used in URLs — lowercase, numbers and hyphens"
            }
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Typography variant="body2" color="text.secondary">
                      {origin}/org/
                    </Typography>
                  </InputAdornment>
                ),
              },
            }}
          />

          <TextField
            label="Description"
            fullWidth
            margin="normal"
            multiline
            rows={3}
            {...form.register("description")}
            error={!!form.formState.errors.description}
            helperText={form.formState.errors.description?.message ?? " "}
          />

          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={submitting}
            endIcon={submitting ? <CircularProgress size={18} /> : undefined}
            sx={{ mt: 2 }}
          >
            {submitting ? "Creating…" : "Create Organization"}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

// ─── OrgDashboard ─────────────────────────────────────────────────────────────

function OrgDashboard({
  org,
  myAdminId,
  onOrgUpdated,
  onOrgDeleted,
}: {
  org: OrgSummary;
  myAdminId: string;
  onOrgUpdated: (org: OrgSummary) => void;
  onOrgDeleted: () => void;
}) {
  const [tab, setTab] = useState(0);
  const origin = useOrigin();
  const isOwner = org.ownerId === myAdminId;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <Avatar sx={{ bgcolor: "primary.main", width: 48, height: 48 }}>
          <Business />
        </Avatar>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            {org.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {origin}/org/{org.slug} · {org._count.members} member
            {org._count.members !== 1 ? "s" : ""} · {org._count.events} event
            {org._count.events !== 1 ? "s" : ""}
          </Typography>
        </Box>
      </Stack>

      <Paper variant="outlined" sx={{ borderRadius: 2 }}>
        <Tabs
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          value={tab}
          onChange={(_, v: number) => setTab(v)}
          sx={{ borderBottom: 1, borderColor: "divider", px: { xs: 0, sm: 2 } }}
        >
          <Tab label="Crew hub" />
          <Tab label="Details" />
          <Tab label="Members" />
          <Tab label="Invitations" />
        </Tabs>

        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          {tab === 0 && <CrewHub orgId={org.id} isOwner={isOwner} />}
          {tab === 1 && (
            <OrgDetailsTab
              org={org}
              isOwner={isOwner}
              onUpdated={onOrgUpdated}
              onDeleted={onOrgDeleted}
            />
          )}
          {tab === 2 && (
            <OrgMembersTab
              orgId={org.id}
              ownerId={org.ownerId}
              myAdminId={myAdminId}
              isOwner={isOwner}
            />
          )}
          {tab === 3 && (
            <OrgInvitationsTab orgId={org.id} isOwner={isOwner} />
          )}
        </Box>
      </Paper>
    </Box>
  );
}

// ─── OrgDetailsTab ────────────────────────────────────────────────────────────

function OrgDetailsTab({
  org,
  isOwner,
  onUpdated,
  onDeleted,
}: {
  org: OrgSummary;
  isOwner: boolean;
  onUpdated: (org: OrgSummary) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const origin = useOrigin();
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<EditOrgData>({
    resolver: zodResolver(editOrgSchema),
    defaultValues: { name: org.name, description: org.description ?? "" },
  });

  useEffect(() => {
    form.reset({ name: org.name, description: org.description ?? "" });
  }, [org, form]);

  const onSave = form.handleSubmit(async (data) => {
    setSaving(true);
    setServerError(null);
    try {
      const res = await fetch(`/api/admin/organizations/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setServerError(body.error ?? "Failed to save");
        return;
      }
      const { organization } = (await res.json()) as { organization: OrgSummary };
      onUpdated({ ...org, ...organization });
      setEditing(false);
    } catch {
      setServerError("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  });

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/organizations/${org.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setServerError(body.error ?? "Failed to delete");
        setDeleteConfirm(false);
        return;
      }
      onDeleted();
    } catch {
      setServerError("An unexpected error occurred");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box>
      {serverError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {serverError}
        </Alert>
      )}

      {editing ? (
        <Box component="form" onSubmit={(e) => void onSave(e)} noValidate>
          <TextField
            label="Organization name"
            required
            fullWidth
            margin="normal"
            {...form.register("name")}
            error={!!form.formState.errors.name}
            helperText={form.formState.errors.name?.message}
          />
          <TextField
            label="Description"
            fullWidth
            margin="normal"
            multiline
            rows={3}
            {...form.register("description")}
            error={!!form.formState.errors.description}
            helperText={form.formState.errors.description?.message}
          />
          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                setEditing(false);
                form.reset({ name: org.name, description: org.description ?? "" });
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </Stack>
        </Box>
      ) : (
        <Box>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="flex-start"
            sx={{ mb: 2 }}
          >
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Name
              </Typography>
              <Typography variant="body1" fontWeight={500}>
                {org.name}
              </Typography>
            </Box>
            {isOwner && (
              <Button
                startIcon={<Edit />}
                onClick={() => setEditing(true)}
                size="small"
              >
                Edit
              </Button>
            )}
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              URL Slug
            </Typography>
            <Typography variant="body1" sx={{ fontFamily: "monospace" }}>
              {origin}/org/{org.slug}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Slug cannot be changed after creation.
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Description
            </Typography>
            <Typography variant="body1">
              {org.description ?? <em>No description</em>}
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Grid container spacing={3} sx={{ mb: 2 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Typography variant="body2" color="text.secondary">
                Members
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {org._count.members}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Typography variant="body2" color="text.secondary">
                Events
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {org._count.events}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="body2" color="text.secondary">
                Created
              </Typography>
              <Typography variant="body1">
                {new Date(org.createdAt).toLocaleDateString("en-GB", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </Typography>
            </Grid>
          </Grid>

          {isOwner && (
            <>
              <Divider sx={{ my: 2 }} />
              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  gutterBottom
                  fontWeight={600}
                >
                  Danger Zone
                </Typography>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<Delete />}
                  onClick={() => setDeleteConfirm(true)}
                  disabled={org._count.events > 0}
                >
                  Delete Organization
                </Button>
                {org._count.events > 0 && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ mt: 1 }}
                  >
                    Cannot delete — organization has {org._count.events} event
                    {org._count.events !== 1 ? "s" : ""}.
                  </Typography>
                )}
              </Box>
            </>
          )}
        </Box>
      )}

      <Dialog open={deleteConfirm} onClose={() => setDeleteConfirm(false)}>
        <DialogTitle>Delete Organization?</DialogTitle>
        <DialogContent>
          <Typography>
            This will permanently delete <strong>{org.name}</strong> and remove
            all members. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleDelete()}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ─── PermissionsDialog ────────────────────────────────────────────────────────

function PermissionsDialog({
  open,
  initialPermissions,
  assignment,
  orgId,
  memberName,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  initialPermissions: OrgPermission[];
  assignment: CrewAssignment;
  orgId: string;
  memberName: string;
  error: string | null;
  onClose: () => void;
  onSave: (permissions: OrgPermission[], assignment: CrewAssignment) => Promise<void>;
}) {
  const [permissions, setPermissions] = useState<OrgPermission[]>(initialPermissions);
  const [saving, setSaving] = useState(false);
  const [crew, setCrew] = useState(assignment);

  const toggle = (p: OrgPermission) => {
    setPermissions((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(permissions, crew); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Edit crew member — {memberName}</DialogTitle>
      <DialogContent>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <CrewAssignmentFields orgId={orgId} value={crew} onChange={setCrew} />
        <Typography sx={{ mt: 2 }}>Additional permissions</Typography>
        <FormGroup>
          {ALL_PERMISSIONS.map((p) => (
            <FormControlLabel
              key={p}
              control={
                <Checkbox
                  checked={permissions.includes(p)}
                  onChange={() => toggle(p)}
                />
              }
              label={PERMISSION_LABELS[p]}
            />
          ))}
        </FormGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── OrgMembersTab ────────────────────────────────────────────────────────────

function OrgMembersTab({
  orgId,
  ownerId,
  myAdminId,
  isOwner,
}: {
  orgId: string;
  ownerId: string;
  myAdminId: string;
  isOwner: boolean;
}) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<OrgMember | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);
  const [removing, setRemoving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch(`/api/admin/organizations/${orgId}/members`).then(async (res) => {
      if (!res.ok) throw new Error("Failed to load members");
      const { members } = (await res.json()) as { members: OrgMember[] };
      setMembers(members);
      setError(null);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load");
    }).finally(() => {
      setLoading(false);
    });
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updatePermissions = async (
    targetAdminId: string,
    permissions: OrgPermission[],
    assignment: CrewAssignment,
  ) => {
    setActionError(null);
    try {
      const res = await fetch(
        `/api/admin/organizations/${orgId}/members/${targetAdminId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissions, ...assignment }),
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setActionError(body.error ?? "Failed to update permissions");
        return;
      }
    } catch {
      setActionError("Connection failed. Your changes are still in the form. Please retry.");
      return;
    }
    setEditTarget(null);
    await load();
  };

  const removeMember = async (targetAdminId: string) => {
    setActionError(null);
    setRemoving(true);
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/members/${targetAdminId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to remove member");
      }
      setRemoveTarget(null);
      if (targetAdminId === myAdminId) {
        window.location.assign("/admin/organization");
      } else {
        await load();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Connection failed. Please retry.");
    } finally {
      setRemoving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box>
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      )}

      <Box sx={{ overflowX: "auto" }}><Table size="small" sx={CREW_TABLE_SX}>
        <TableHead>
          <TableRow>
            <TableCell>Member</TableCell>
            <TableCell>Department / role</TableCell>
            <TableCell>Access</TableCell>
            <TableCell>Permissions</TableCell>
            <TableCell>Joined</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {members.map((member) => {
            const isThisOwner = member.adminId === ownerId;
            const isMe = member.adminId === myAdminId;
            return (
              <TableRow key={member.adminId}>
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <Avatar
                      src={member.admin.user.image ?? undefined}
                      sx={{ width: 32, height: 32, fontSize: "0.8rem" }}
                    >
                      {(member.admin.user.name || member.admin.user.email).charAt(0).toUpperCase()}
                    </Avatar>
                    <Box>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Typography variant="body2" fontWeight={500}>
                          {member.admin.user.name}
                        </Typography>
                        {isThisOwner && (
                          <Chip
                            label="Owner"
                            size="small"
                            color="primary"
                            sx={{ height: 18, fontSize: "0.65rem" }}
                          />
                        )}
                        {isMe && !isThisOwner && (
                          <Chip
                            label="You"
                            size="small"
                            variant="outlined"
                            sx={{ height: 18, fontSize: "0.65rem" }}
                          />
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {member.admin.user.email}
                      </Typography>
                    </Box>
                  </Stack>
                </TableCell>
                <TableCell data-label="Department / role">{member.department?.name || "Unassigned"}<Typography variant="caption" display="block">{member.role || "No role assigned"}</Typography></TableCell>
                <TableCell data-label="Access">{isThisOwner ? "Owner" : member.accessLevel === "READ" ? "Read only" : "Read and write"}</TableCell>
                <TableCell data-label="Permissions">
                  {isThisOwner ? (
                    <Typography variant="body2" color="text.secondary">
                      All permissions
                    </Typography>
                  ) : (
                    <PermissionsChips permissions={member.permissions} />
                  )}
                </TableCell>
                <TableCell data-label="Joined">
                  <Typography variant="caption" color="text.secondary">
                    {new Date(member.joinedAt).toLocaleDateString("en-GB")}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    {isOwner && !isThisOwner && (
                      <Tooltip title="Edit permissions">
                        <IconButton
                          aria-label="Edit permissions"
                          size="small"
                          onClick={() => setEditTarget(member)}
                        >
                          <Edit fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {!isThisOwner && (isOwner || isMe) && (
                      <Tooltip title={isMe ? "Leave organization" : "Remove member"}>
                        <IconButton
                          aria-label={isMe ? "Leave organization" : "Remove member"}
                          size="small"
                          color="error"
                          onClick={() => { setActionError(null); setRemoveTarget(member); }}
                        >
                          <PersonRemove fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table></Box>

      <Dialog open={!!removeTarget} onClose={() => { if (!removing) setRemoveTarget(null); }}>
        <DialogTitle>{removeTarget?.adminId === myAdminId ? "Leave this organization?" : `Remove ${removeTarget?.admin.user.name || removeTarget?.admin.user.email}?`}</DialogTitle>
        <DialogContent>
          {actionError ? <Alert severity="error">{actionError}</Alert> : null}
          <Typography>Crew access to this organization and its events will end. Registrations remain unchanged.</Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={removing} onClick={() => setRemoveTarget(null)}>Cancel</Button>
          <Button disabled={removing} color="error" onClick={() => removeTarget && void removeMember(removeTarget.adminId)}>{removing ? "Removing…" : removeTarget?.adminId === myAdminId ? "Leave organization" : "Remove"}</Button>
        </DialogActions>
      </Dialog>

      {editTarget && (
        <PermissionsDialog
          open
          error={actionError}
          orgId={orgId}
          assignment={{ accessLevel: editTarget.accessLevel || "WRITE", departmentId: editTarget.departmentId || null, role: editTarget.role || null }}
          initialPermissions={editTarget.permissions}
          memberName={editTarget.admin.user.name}
          onClose={() => setEditTarget(null)}
          onSave={(perms, assignment) => updatePermissions(editTarget.adminId, perms, assignment)}
        />
      )}
    </Box>
  );
}

// ─── OrgInvitationsTab ────────────────────────────────────────────────────────

function OrgInvitationsTab({
  orgId,
  isOwner,
}: {
  orgId: string;
  isOwner: boolean;
}) {
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [emailFailed, setEmailFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [crew, setCrew] = useState<CrewAssignment>({ accessLevel: "READ", departmentId: null, role: null });
  const [invitePermissions, setInvitePermissions] = useState<OrgPermission[]>([]);

  const inviteForm = useForm<InviteData>({
    resolver: zodResolver(inviteSchema),
    mode: "onBlur",
  });

  const load = useCallback(() => {
    return fetch(`/api/admin/organizations/${orgId}/invitations`).then(async (res) => {
      if (!res.ok) throw new Error("Failed to load invitations");
      const { invitations } = (await res.json()) as { invitations: OrgInvitation[] };
      setInvitations(invitations);
      setError(null);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load");
    }).finally(() => {
      setLoading(false);
    });
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSendInvite = inviteForm.handleSubmit(async (data) => {
    setSending(true);
    setSendError(null);
    setSendSuccess(null);
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email, permissions: invitePermissions, ...crew }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setSendError(body.error ?? "Failed to send invitation");
        return;
      }
      const result = await res.json();
      setEmailFailed(result.emailSent === false);
      setSendSuccess(result.emailSent === false ? `Invitation created for ${data.email}. Email delivery failed; copy the invitation link below.` : `Invitation sent to ${data.email}`);
      inviteForm.reset();
      setInvitePermissions([]);
      setCrew({ accessLevel: "READ", departmentId: null, role: null });
      await load();
    } catch {
      setSendError("An unexpected error occurred");
    } finally {
      setSending(false);
    }
  });

  const revokeInvitation = async (token: string) => {
    setRevoking(token);
    setRevokeError(null);
    try {
      const res = await fetch(
        `/api/admin/organizations/${orgId}/invitations/${token}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setRevokeError(body.error ?? "Failed to revoke invitation");
        return;
      }
      await load();
    } catch {
      setRevokeError("An unexpected error occurred");
    } finally {
      setRevoking(null);
    }
  };

  const toggleInvitePermission = (p: OrgPermission) => {
    setInvitePermissions((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box>
      {isOwner && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3, borderRadius: 2 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
            Send Invitation
          </Typography>
          {sendError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {sendError}
            </Alert>
          )}
          {sendSuccess && (
            <Alert severity={emailFailed ? "warning" : "success"} sx={{ mb: 2 }}>
              {sendSuccess}
            </Alert>
          )}

          <Box component="form" onSubmit={(e) => void onSendInvite(e)} noValidate>
            <TextField
              label="Email address"
              required
              fullWidth
              margin="normal"
              type="email"
              {...inviteForm.register("email")}
              error={!!inviteForm.formState.errors.email}
              helperText={inviteForm.formState.errors.email?.message || "Only existing organizer accounts can join your crew. Invitations expire after 7 days."}
            />

            <CrewAssignmentFields orgId={orgId} value={crew} onChange={setCrew} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 0.5 }}>
              Permissions
            </Typography>
            <FormGroup row>
              {ALL_PERMISSIONS.map((p) => (
                <FormControlLabel
                  key={p}
                  control={
                    <Checkbox
                      size="small"
                      checked={invitePermissions.includes(p)}
                      onChange={() => toggleInvitePermission(p)}
                    />
                  }
                  label={
                    <Typography variant="body2">{PERMISSION_LABELS[p]}</Typography>
                  }
                />
              ))}
            </FormGroup>

            <Button
              type="submit"
              variant="contained"
              disabled={sending}
              endIcon={sending ? <CircularProgress size={18} /> : <Send />}
              sx={{ mt: 2 }}
            >
              {sending ? "Sending…" : "Send Invitation"}
            </Button>
          </Box>
        </Paper>
      )}

      {revokeError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {revokeError}
        </Alert>
      )}

      {invitations.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No invitations yet.
        </Typography>
      ) : (
        <Box sx={{ overflowX: "auto" }}><Table size="small" sx={CREW_TABLE_SX}>
          <TableHead>
            <TableRow>
              <TableCell>Email / assignment</TableCell>
              <TableCell>Access</TableCell>
              <TableCell>Permissions</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Invited by</TableCell>
              <TableCell>Expires</TableCell>
              {isOwner && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {invitations.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>
                  <Typography variant="body2">{inv.invitedEmail}</Typography>
                  <Typography variant="caption">{[inv.department?.name, inv.role].filter(Boolean).join(" · ")}</Typography>
                </TableCell>
                <TableCell data-label="Access">{inv.accessLevel === "READ" ? "Read only" : "Read and write"}</TableCell>
                <TableCell data-label="Permissions">
                  <PermissionsChips permissions={inv.permissions} />
                </TableCell>
                <TableCell data-label="Status">
                  <Chip
                    label={
                      inv.status.charAt(0) + inv.status.slice(1).toLowerCase()
                    }
                    size="small"
                    color={STATUS_COLOR[inv.status]}
                    variant={inv.status === "PENDING" ? "filled" : "outlined"}
                  />
                </TableCell>
                <TableCell data-label="Invited by">
                  <Typography variant="caption" color="text.secondary">
                    {inv.invitedByAdmin.user.name}
                  </Typography>
                </TableCell>
                <TableCell data-label="Expires">
                  <Typography variant="caption" color="text.secondary">
                    {inv.status === "PENDING"
                      ? new Date(inv.expiresAt) < new Date()
                        ? "Expired"
                        : new Date(inv.expiresAt).toLocaleDateString("en-GB")
                      : "—"}
                  </Typography>
                </TableCell>
                {isOwner && (
                  <TableCell align="right">
                    {inv.status === "PENDING" && (
                      <Stack direction="row" alignItems="center">
                        <Button
                          size="small"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(`${window.location.origin}/admin/invite/${inv.token}`)
                              .then(() => {
                                setEmailFailed(false);
                                setSendSuccess("Invitation link copied.");
                              })
                              .catch(() => setRevokeError("Could not copy the invitation link. Please retry."));
                          }}
                        >
                          Copy link
                        </Button>
                        <Tooltip title="Revoke invitation">
                          <IconButton
                            aria-label="Revoke invitation"
                            size="small"
                            color="error"
                            disabled={revoking === inv.token}
                            onClick={() => void revokeInvitation(inv.token)}
                          >
                            {revoking === inv.token ? (
                              <CircularProgress size={16} />
                            ) : (
                              <Block fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table></Box>
      )}
    </Box>
  );
}
