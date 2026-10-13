"use client";

import { type ChangeEvent, type CSSProperties, type ElementType, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add,
  ContentCopy,
  CropSquare,
  Delete,
  Download,
  HorizontalRule,
  Image as ImageIcon,
  KeyboardArrowDown,
  KeyboardArrowUp,
  Print,
  RadioButtonUnchecked,
  Save,
} from "@mui/icons-material";
import Image from "next/image";
import QRCode from "react-qr-code";
import ImageCropper from "@/components/profile/ImageCropper";
import { attendeeInitials, fitBadgeText, getBadgeElementValue, getBadgePhotoUrl, type BadgeAttendee, type BadgeTemplate } from "@/lib/badges/badge";
import type { BadgeElement, BadgeFieldKey, BadgeTemplateInput } from "@/types/schemas/badge";

type TicketTier = {
  id: string;
  name: string;
};

type CustomField = {
  id: string;
  label: string;
};

type PendingFallbackPhoto = {
  name: string;
  src: string;
};

type BadgeDesignerProps = {
  canWrite?: boolean;
  eventId: number;
  eventName: string;
  initialTemplates: BadgeTemplate[];
  fallbackTemplate: BadgeTemplateInput;
  initialAttendees: BadgeAttendee[];
  ticketTiers: TicketTier[];
  customFields: CustomField[];
};

const FIELD_OPTIONS: Array<{ value: BadgeFieldKey; label: string }> = [
  { value: "photo", label: "Photo" },
  { value: "displayName", label: "Display name" },
  { value: "legalName", label: "Legal name" },
  { value: "ticketId", label: "Ticket number" },
  { value: "ticketTier", label: "Ticket tier" },
  { value: "crewDepartment", label: "Crew department" },
  { value: "crewRole", label: "Crew role" },
  { value: "eventName", label: "Event name" },
  { value: "qrCode", label: "QR code" },
  { value: "customField", label: "Custom field" },
  { value: "staticText", label: "Static text" },
];

const SHAPE_OPTIONS: Array<{ value: BadgeFieldKey; label: string; icon: ElementType }> = [
  { value: "rectangle", label: "Rectangle", icon: CropSquare },
  { value: "ellipse", label: "Ellipse", icon: RadioButtonUnchecked },
  { value: "line", label: "Line", icon: HorizontalRule },
];

const TYPE_OPTIONS = [...FIELD_OPTIONS, ...SHAPE_OPTIONS];
const SHAPE_TYPES = new Set<BadgeFieldKey>(["rectangle", "ellipse", "line"]);

function isShapeElement(element: BadgeElement) {
  return SHAPE_TYPES.has(element.type);
}

function colorInputValue(value: string | undefined, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function parseCustomCss(customCss: string | undefined): CSSProperties {
  if (!customCss?.trim()) return {};

  return Object.fromEntries(
    customCss
      .split(";")
      .map(rule => {
        const separator = rule.indexOf(":");
        if (separator === -1) return null;
        const rawProperty = rule.slice(0, separator).trim();
        const value = rule.slice(separator + 1).trim();
        if (!rawProperty || !value) return null;
        const property = rawProperty.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
        return [property, value];
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  ) as CSSProperties;
}

function createElement(type: BadgeFieldKey): BadgeElement {
  const shape = SHAPE_TYPES.has(type);
  return {
    id: `element-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    label: TYPE_OPTIONS.find(option => option.value === type)?.label || "Element",
    x: 10,
    y: 10,
    width: type === "photo" || type === "qrCode" ? 22 : type === "ellipse" ? 30 : 42,
    height: type === "photo" ? 34 : type === "qrCode" ? 22 : type === "line" ? 2 : type === "ellipse" ? 18 : 10,
    fontSize: type === "eventName" ? 10 : 14,
    fontWeight: type === "displayName" ? "700" : "600",
    color: shape ? "#2563eb" : "#111827",
    align: type === "qrCode" || type === "photo" ? "center" : "left",
    staticText: type === "staticText" ? "Text" : undefined,
    shape: "square",
    backgroundColor: shape ? "#2563eb" : undefined,
    borderColor: shape ? "#1d4ed8" : undefined,
    borderWidth: type === "rectangle" || type === "ellipse" ? 1 : 0,
  };
}

function templateToDraft(template: BadgeTemplate | BadgeTemplateInput): BadgeTemplateInput {
  return {
    name: template.name,
    isDefault: template.isDefault,
    widthMm: template.widthMm,
    heightMm: template.heightMm,
    background: template.background,
    elements: template.elements,
  };
}

function getErrorMessage(raw: unknown, fallback: string) {
  if (!raw || typeof raw !== "object") return fallback;
  const payload = raw as { error?: string | Array<{ message?: string }> };
  if (typeof payload.error === "string") return payload.error;
  if (Array.isArray(payload.error)) return payload.error[0]?.message || fallback;
  return fallback;
}

export default function BadgeDesigner({
  canWrite = true,
  eventId,
  eventName,
  initialTemplates,
  fallbackTemplate,
  initialAttendees,
  ticketTiers,
  customFields,
}: BadgeDesignerProps) {
  const initialTemplate = initialTemplates[0] || {
    ...fallbackTemplate,
    id: "draft",
    eventId,
  };

  const [templates, setTemplates] = useState<BadgeTemplate[]>(initialTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplate.id);
  const [draft, setDraft] = useState<BadgeTemplateInput>(templateToDraft(initialTemplate));
  const [selectedElementId, setSelectedElementId] = useState(draft.elements[0]?.id || "");
  const [attendees, setAttendees] = useState(initialAttendees);
  const [selectedAttendeeIds, setSelectedAttendeeIds] = useState<string[]>(initialAttendees.map(attendee => attendee.registrationId));
  const [sampleAttendeeId, setSampleAttendeeId] = useState(initialAttendees[0]?.registrationId || "");
  const [statusFilter, setStatusFilter] = useState("CONFIRMED");
  const [tierFilter, setTierFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [pageMode, setPageMode] = useState<"sheet" | "single">("sheet");
  const [saving, setSaving] = useState(false);
  const [loadingAttendees, setLoadingAttendees] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingFallbackPhoto, setUploadingFallbackPhoto] = useState(false);
  const [fallbackPhotoQueue, setFallbackPhotoQueue] = useState<PendingFallbackPhoto[]>([]);
  const [fallbackPhotoQueueIndex, setFallbackPhotoQueueIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ severity: "success" | "info" | "warning" | "error"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fallbackPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const activeFallbackPhoto = fallbackPhotoQueue[fallbackPhotoQueueIndex] || null;

  const selectedTemplate = templates.find(template => template.id === selectedTemplateId) || null;
  const selectedElement = draft.elements.find(element => element.id === selectedElementId) || null;
  const sampleAttendee = attendees.find(attendee => attendee.registrationId === sampleAttendeeId) || attendees[0] || null;
  const selectedAttendees = attendees.filter(attendee => selectedAttendeeIds.includes(attendee.registrationId));

  const previewStyle = useMemo(
    () => ({
      width: "100%",
      maxWidth: 560,
      aspectRatio: `${draft.widthMm} / ${draft.heightMm}`,
      backgroundColor: draft.background.color,
      backgroundImage: draft.background.imageUrl ? `url("${draft.background.imageUrl}")` : undefined,
      backgroundSize: draft.background.fit === "stretch" ? "100% 100%" : draft.background.fit,
      backgroundPosition: `${draft.background.positionX}% ${draft.background.positionY}%`,
      backgroundRepeat: "no-repeat",
    }),
    [draft],
  );

  const setDraftField = <K extends keyof BadgeTemplateInput>(field: K, value: BadgeTemplateInput[K]) => {
    setDraft(current => ({ ...current, [field]: value }));
  };

  const updateElement = (elementId: string, patch: Partial<BadgeElement>) => {
    setDraft(current => ({
      ...current,
      elements: current.elements.map(element => (element.id === elementId ? { ...element, ...patch } : element)),
    }));
  };

  const selectTemplate = (templateId: string) => {
    const template = templates.find(entry => entry.id === templateId);
    if (!template) return;
    setSelectedTemplateId(template.id);
    setDraft(templateToDraft(template));
    setSelectedElementId(template.elements[0]?.id || "");
    setNotice(null);
  };

  const addTemplate = () => {
    const template: BadgeTemplate = {
      ...fallbackTemplate,
      id: "draft",
      eventId,
      name: `${eventName} Badge`,
      isDefault: templates.length === 0,
    };
    setSelectedTemplateId(template.id);
    setDraft(templateToDraft(template));
    setSelectedElementId(template.elements[0]?.id || "");
  };

  const duplicateTemplate = () => {
    setSelectedTemplateId("draft");
    setDraft(current => ({ ...current, name: `${current.name} Copy`, isDefault: false }));
    setNotice({ severity: "info", message: "Duplicated as an unsaved template." });
  };

  const saveTemplate = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const isExisting = selectedTemplateId !== "draft" && !!selectedTemplate;
      const response = await fetch(
        isExisting
          ? `/api/admin/event/${eventId}/badge-templates/${selectedTemplateId}`
          : `/api/admin/event/${eventId}/badge-templates`,
        {
          method: isExisting ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      const payload = (await response.json().catch(() => null)) as { template?: BadgeTemplate; error?: unknown } | null;
      if (!response.ok || !payload?.template) {
        throw new Error(getErrorMessage(payload, "Failed to save badge template"));
      }

      setTemplates(current => {
        const without = current.filter(template => template.id !== payload.template?.id);
        const next = [payload.template as BadgeTemplate, ...without].map(template => ({
          ...template,
          isDefault: payload.template?.isDefault ? template.id === payload.template.id : template.isDefault,
        }));
        return next.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      });
      setSelectedTemplateId(payload.template.id);
      setDraft(templateToDraft(payload.template));
      setNotice({ severity: "success", message: "Badge template saved." });
    } catch (error) {
      setNotice({ severity: "error", message: error instanceof Error ? error.message : "Failed to save badge template" });
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async () => {
    if (selectedTemplateId === "draft" || !selectedTemplate) {
      addTemplate();
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/event/${eventId}/badge-templates/${selectedTemplateId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(getErrorMessage(payload, "Failed to delete badge template"));
      }

      const nextTemplates = templates.filter(template => template.id !== selectedTemplateId);
      setTemplates(nextTemplates);
      const next = nextTemplates[0] || { ...fallbackTemplate, id: "draft", eventId };
      setSelectedTemplateId(next.id);
      setDraft(templateToDraft(next));
      setSelectedElementId(next.elements[0]?.id || "");
      setNotice({ severity: "success", message: "Badge template deleted." });
    } catch (error) {
      setNotice({ severity: "error", message: error instanceof Error ? error.message : "Failed to delete badge template" });
    } finally {
      setSaving(false);
    }
  };

  const fetchAttendees = async () => {
    setLoadingAttendees(true);
    setNotice(null);
    try {
      const params = new URLSearchParams({ status: statusFilter });
      if (tierFilter) params.set("ticketTier", tierFilter);
      if (searchFilter.trim()) params.set("search", searchFilter.trim());

      const response = await fetch(`/api/admin/event/${eventId}/badges/attendees?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as { attendees?: BadgeAttendee[]; error?: unknown } | null;
      if (!response.ok || !payload?.attendees) {
        throw new Error(getErrorMessage(payload, "Failed to load attendees"));
      }

      setAttendees(payload.attendees);
      setSelectedAttendeeIds(payload.attendees.map(attendee => attendee.registrationId));
      setSampleAttendeeId(payload.attendees[0]?.registrationId || "");
    } catch (error) {
      setNotice({ severity: "error", message: error instanceof Error ? error.message : "Failed to load attendees" });
    } finally {
      setLoadingAttendees(false);
    }
  };

  const addElement = (type: BadgeFieldKey) => {
    const element = createElement(type);
    setDraft(current => ({ ...current, elements: [...current.elements, element] }));
    setSelectedElementId(element.id);
  };

  const moveElement = (elementId: string, direction: -1 | 1) => {
    setDraft(current => {
      const index = current.elements.findIndex(element => element.id === elementId);
      const nextIndex = index + direction;
      if (index === -1 || nextIndex < 0 || nextIndex >= current.elements.length) return current;

      const elements = [...current.elements];
      const [element] = elements.splice(index, 1);
      elements.splice(nextIndex, 0, element);
      return { ...current, elements };
    });
  };

  const removeElement = () => {
    if (!selectedElement) return;
    const remaining = draft.elements.filter(element => element.id !== selectedElement.id);
    setDraft(current => ({ ...current, elements: remaining }));
    setSelectedElementId(remaining[0]?.id || "");
  };

  const handleBackgroundUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/admin/media/upload", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as { url?: string; error?: unknown } | null;
      if (!response.ok || !payload?.url) {
        throw new Error(getErrorMessage(payload, "Failed to upload background image"));
      }

      setDraft(current => ({
        ...current,
        background: {
          ...current.background,
          imageUrl: payload.url,
          positionX: current.background.positionX ?? 50,
          positionY: current.background.positionY ?? 50,
        },
      }));
    } catch (error) {
      setNotice({ severity: "error", message: error instanceof Error ? error.message : "Failed to upload background image" });
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const handleFallbackPhotoSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setNotice(null);
    try {
      const images = await Promise.all(files.map(file => new Promise<PendingFallbackPhoto>((resolve, reject) => {
        if (!file.type.startsWith("image/")) {
          reject(new Error("Please select image files only."));
          return;
        }
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve({ name: file.name, src: reader.result?.toString() || "" }));
        reader.addEventListener("error", () => reject(new Error("Failed to read fallback photo.")));
        reader.readAsDataURL(file);
      })));
      setFallbackPhotoQueue(images.filter(image => image.src));
      setFallbackPhotoQueueIndex(0);
    } catch (error) {
      setNotice({ severity: "error", message: error instanceof Error ? error.message : "Failed to prepare fallback photos" });
    } finally {
      event.target.value = "";
    }
  };

  const closeFallbackPhotoCropper = () => {
    setFallbackPhotoQueue([]);
    setFallbackPhotoQueueIndex(0);
    setUploadingFallbackPhoto(false);
  };

  const handleFallbackPhotoCropComplete = async (croppedBlob: Blob) => {
    if (!activeFallbackPhoto) return;

    setUploadingFallbackPhoto(true);
    setNotice(null);
    try {
      const formData = new FormData();
      const fileName = activeFallbackPhoto.name.replace(/\.[^.]+$/, "") || "fallback-photo";
      formData.append("file", new File([croppedBlob], `${fileName}.jpg`, { type: "image/jpeg" }));
      formData.append("mode", "badge-photo");
      const response = await fetch("/api/admin/media/upload", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as { url?: string; error?: unknown } | null;
      if (!response.ok || !payload?.url) {
        throw new Error(getErrorMessage(payload, "Failed to upload fallback photo"));
      }
      const uploadedUrl = payload.url;

      setDraft(current => ({
        ...current,
        background: {
          ...current.background,
          fallbackPhotoUrls: [...(current.background.fallbackPhotoUrls || []), uploadedUrl].slice(0, 30),
        },
      }));

      if (fallbackPhotoQueueIndex + 1 >= fallbackPhotoQueue.length) {
        closeFallbackPhotoCropper();
      } else {
        setFallbackPhotoQueueIndex(current => current + 1);
      }
    } catch (error) {
      setNotice({ severity: "error", message: error instanceof Error ? error.message : "Failed to upload fallback photo" });
    } finally {
      setUploadingFallbackPhoto(false);
    }
  };

  const removeFallbackPhoto = (url: string) => {
    setDraft(current => ({
      ...current,
      background: {
        ...current.background,
        fallbackPhotoUrls: (current.background.fallbackPhotoUrls || []).filter(entry => entry !== url),
      },
    }));
  };

  const exportBadges = async (format: "html" | "png", printAfterOpen = false) => {
    if (selectedAttendees.length === 0) {
      setNotice({ severity: "warning", message: "Select at least one attendee." });
      return;
    }

    setExporting(true);
    setNotice(null);
    try {
      const attendeeIds = format === "png" ? [selectedAttendees[0].registrationId] : selectedAttendees.map(attendee => attendee.registrationId);
      const response = await fetch(`/api/admin/event/${eventId}/badges/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: draft,
          attendeeIds,
          format,
          pageMode,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(getErrorMessage(payload, "Failed to export badges"));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      if (format === "html") {
        const opened = window.open(url, "_blank");
        if (printAfterOpen && opened) {
          opened.addEventListener("load", () => opened.print(), { once: true });
        }
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `badge-${selectedAttendees[0].ticketId}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      setNotice({ severity: "error", message: error instanceof Error ? error.message : "Failed to export badges" });
    } finally {
      setExporting(false);
    }
  };

  const toggleAttendee = (registrationId: string, checked: boolean) => {
    setSelectedAttendeeIds(current => checked ? [...new Set([...current, registrationId])] : current.filter(id => id !== registrationId));
  };

  return (
    <>
    <Stack spacing={3}>
      {!canWrite ? <Alert severity="info">Read-only access. Preview and export badges; contact the organization owner to save templates.</Alert> : null}
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Badge Designer</Typography>
          <Typography variant="body2" color="text.secondary">{eventName}</Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="outlined" startIcon={<Add />} onClick={addTemplate}>New</Button>
          <Button variant="outlined" startIcon={<ContentCopy />} onClick={duplicateTemplate}>Duplicate</Button>
          <Button variant="outlined" color="error" startIcon={<Delete />} onClick={() => void deleteTemplate()} disabled={saving || !canWrite}>Delete</Button>
          <Button variant="contained" startIcon={saving ? <CircularProgress color="inherit" size={18} /> : <Save />} onClick={() => void saveTemplate()} disabled={saving || !canWrite}>Save</Button>
        </Stack>
      </Stack>

      {notice ? <Alert severity={notice.severity}>{notice.message}</Alert> : null}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 3 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Typography variant="h6">Template</Typography>
              <TextField
                select
                label="Saved template"
                value={selectedTemplateId}
                onChange={event => selectTemplate(event.target.value)}
                fullWidth
              >
                {selectedTemplateId === "draft" ? <MenuItem value="draft">Unsaved draft</MenuItem> : null}
                {templates.map(template => (
                  <MenuItem key={template.id} value={template.id}>{template.name}{template.isDefault ? " (default)" : ""}</MenuItem>
                ))}
              </TextField>
              <TextField label="Name" value={draft.name} onChange={event => setDraftField("name", event.target.value)} fullWidth />
              <FormControlLabel
                control={<Checkbox checked={draft.isDefault} onChange={event => setDraftField("isDefault", event.target.checked)} />}
                label="Default template"
              />
              <Stack direction="row" spacing={1}>
                <TextField
                  label="Width mm"
                  type="number"
                  value={draft.widthMm}
                  onChange={event => setDraftField("widthMm", Number(event.target.value || 85))}
                  fullWidth
                />
                <TextField
                  label="Height mm"
                  type="number"
                  value={draft.heightMm}
                  onChange={event => setDraftField("heightMm", Number(event.target.value || 55))}
                  fullWidth
                />
              </Stack>
              <TextField
                label="Background color"
                type="color"
                value={draft.background.color}
                onChange={event => setDraftField("background", { ...draft.background, color: event.target.value })}
                fullWidth
              />
              <TextField
                select
                label="Background fit"
                value={draft.background.fit}
                onChange={event => setDraftField("background", { ...draft.background, fit: event.target.value as "cover" | "contain" | "stretch" })}
                fullWidth
              >
                <MenuItem value="cover">Cover</MenuItem>
                <MenuItem value="contain">Contain</MenuItem>
                <MenuItem value="stretch">Stretch</MenuItem>
              </TextField>
              <input ref={fileInputRef} hidden type="file" accept="image/*" onChange={event => void handleBackgroundUpload(event)} />
              <Button variant="outlined" startIcon={uploading ? <CircularProgress size={18} /> : <ImageIcon />} onClick={() => fileInputRef.current?.click()} disabled={uploading || !canWrite}>
                Upload background
              </Button>
              {draft.background.imageUrl ? (
                <>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Background X</Typography>
                    <Slider
                      value={draft.background.positionX}
                      onChange={(_, value) => setDraftField("background", { ...draft.background, positionX: value as number })}
                      min={0}
                      max={100}
                      valueLabelDisplay="auto"
                    />
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Background Y</Typography>
                    <Slider
                      value={draft.background.positionY}
                      onChange={(_, value) => setDraftField("background", { ...draft.background, positionY: value as number })}
                      min={0}
                      max={100}
                      valueLabelDisplay="auto"
                    />
                  </Box>
                  <Button variant="text" color="error" onClick={() => setDraftField("background", { ...draft.background, imageUrl: null })}>
                    Remove background
                  </Button>
                </>
              ) : null}
              <Divider />
              <Stack spacing={1}>
                <Typography variant="subtitle2">Fallback profile photos</Typography>
                <Typography variant="caption" color="text.secondary">
                  Used randomly for attendees with no profile picture.
                </Typography>
                <input ref={fallbackPhotoInputRef} hidden multiple type="file" accept="image/*" onChange={event => void handleFallbackPhotoSelect(event)} />
                <Button
                  variant="outlined"
                  startIcon={uploadingFallbackPhoto ? <CircularProgress size={18} /> : <ImageIcon />}
                  onClick={() => fallbackPhotoInputRef.current?.click()}
                  disabled={!canWrite || uploadingFallbackPhoto || (draft.background.fallbackPhotoUrls || []).length >= 30}
                >
                  Upload fallback photos
                </Button>
                {(draft.background.fallbackPhotoUrls || []).length > 0 ? (
                  <Grid container spacing={1}>
                    {(draft.background.fallbackPhotoUrls || []).map(url => (
                      <Grid key={url} size={{ xs: 4 }}>
                        <Box
                          sx={{
                            position: "relative",
                            aspectRatio: "1 / 1",
                            overflow: "hidden",
                            borderRadius: 1,
                            border: "1px solid",
                            borderColor: "divider",
                          }}
                        >
                          <Image src={url} alt="" fill unoptimized style={{ objectFit: "cover" }} />
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeFallbackPhoto(url)}
                            sx={{
                              position: "absolute",
                              top: 2,
                              right: 2,
                              bgcolor: "background.paper",
                              "&:hover": { bgcolor: "background.paper" },
                            }}
                          >
                            <Delete fontSize="inherit" />
                          </IconButton>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                ) : null}
              </Stack>
            </Stack>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
                <Typography variant="h6">Preview</Typography>
                <TextField
                  select
                  size="small"
                  label="Sample attendee"
                  value={sampleAttendeeId}
                  onChange={event => setSampleAttendeeId(event.target.value)}
                  sx={{ minWidth: 240 }}
                >
                  {attendees.map(attendee => (
                    <MenuItem key={attendee.registrationId} value={attendee.registrationId}>
                      #{attendee.ticketId} {attendee.displayName}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>

              <Box sx={{ display: "flex", justifyContent: "center", overflowX: "auto", py: 2 }}>
                <Box
                  sx={{
                    ...previewStyle,
                    position: "relative",
                    overflow: "hidden",
                    border: "1px solid",
                    borderColor: "divider",
                    boxShadow: 2,
                  }}
                >
                  {sampleAttendee ? draft.elements.map(element => {
                    const photoUrl = element.type === "photo" ? getBadgePhotoUrl(draft, sampleAttendee) : null;
                    const textValue = !isShapeElement(element) && element.type !== "photo" && element.type !== "qrCode"
                      ? getBadgeElementValue(element, sampleAttendee, eventId)
                      : "";
                    const fittedText = textValue ? fitBadgeText(draft, element, textValue) : null;
                    return (
                      <Box
                        key={element.id}
                        onClick={() => setSelectedElementId(element.id)}
                        sx={{
                          position: "absolute",
                          left: `${element.x}%`,
                          top: `${element.y}%`,
                          width: `${element.width}%`,
                          height: `${element.height}%`,
                          outline: selectedElementId === element.id ? "2px solid #2563eb" : "1px dashed rgba(15,23,42,0.25)",
                          cursor: "pointer",
                          overflow: "hidden",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: element.align === "center" ? "center" : element.align === "right" ? "flex-end" : "flex-start",
                          textAlign: element.align,
                          color: element.color,
                          bgcolor: isShapeElement(element) ? element.backgroundColor || element.color : element.backgroundColor,
                          borderRadius: isShapeElement(element) && (element.type === "ellipse" || element.type === "line") ? "999px" : undefined,
                          border: element.borderWidth && element.borderWidth > 0 ? `${element.borderWidth}px solid ${element.borderColor || "#111827"}` : undefined,
                          fontSize: fittedText?.fontSize ?? element.fontSize,
                          fontWeight: element.fontWeight,
                          lineHeight: 1.1,
                          wordBreak: "break-word",
                          overflowWrap: "anywhere",
                          whiteSpace: "pre-wrap",
                          boxSizing: "border-box",
                          ...parseCustomCss(element.customCss),
                        }}
                      >
                        {isShapeElement(element) ? null : element.type === "photo" ? (
                          photoUrl ? (
                            <Box sx={{ position: "relative", width: "100%", height: "100%", borderRadius: element.shape === "circle" ? "999px" : 1, overflow: "hidden" }}>
                              <Image src={photoUrl} alt="" fill unoptimized style={{ objectFit: "cover" }} />
                            </Box>
                          ) : (
                            <Box sx={{ width: "100%", height: "100%", bgcolor: "grey.200", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: element.shape === "circle" ? "999px" : 1 }}>
                              {attendeeInitials(sampleAttendee.displayName)}
                            </Box>
                          )
                        ) : element.type === "qrCode" ? (
                          <Box sx={{ width: "100%", height: "100%", bgcolor: "white", p: 0.5 }}>
                            <QRCode value={getBadgeElementValue(element, sampleAttendee, eventId)} style={{ width: "100%", height: "100%" }} />
                          </Box>
                        ) : (
                          textValue
                        )}
                      </Box>
                    );
                  }) : (
                    <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Typography color="text.secondary">No attendee selected</Typography>
                    </Box>
                  )}
                </Box>
              </Box>

              <Divider />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {FIELD_OPTIONS.map(option => (
                  <Button key={option.value} size="small" variant="outlined" onClick={() => addElement(option.value)}>
                    {option.label}
                  </Button>
                ))}
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {SHAPE_OPTIONS.map(option => {
                  const Icon = option.icon;
                  return (
                    <Button key={option.value} size="small" variant="outlined" startIcon={<Icon />} onClick={() => addElement(option.value)}>
                      {option.label}
                    </Button>
                  );
                })}
              </Stack>
            </Stack>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, lg: 3 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Typography variant="h6">Layers</Typography>
              {draft.elements.length === 0 ? (
                <Alert severity="info">No elements yet.</Alert>
              ) : (
                <Stack spacing={1}>
                  {[...draft.elements].reverse().map(element => {
                    const index = draft.elements.findIndex(entry => entry.id === element.id);
                    return (
                      <Paper
                        key={element.id}
                        variant="outlined"
                        onClick={() => setSelectedElementId(element.id)}
                        sx={{
                          p: 1,
                          cursor: "pointer",
                          borderColor: selectedElementId === element.id ? "primary.main" : "divider",
                          bgcolor: selectedElementId === element.id ? "action.selected" : "background.paper",
                        }}
                      >
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="body2" fontWeight={600} noWrap>{element.label}</Typography>
                            <Typography variant="caption" color="text.secondary">{TYPE_OPTIONS.find(option => option.value === element.type)?.label || element.type}</Typography>
                          </Box>
                          <Tooltip title="Move forward">
                            <span>
                              <IconButton size="small" onClick={event => { event.stopPropagation(); moveElement(element.id, 1); }} disabled={index === draft.elements.length - 1}>
                                <KeyboardArrowUp fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="Move back">
                            <span>
                              <IconButton size="small" onClick={event => { event.stopPropagation(); moveElement(element.id, -1); }} disabled={index === 0}>
                                <KeyboardArrowDown fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      </Paper>
                    );
                  })}
                </Stack>
              )}
              <Divider />
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">Element</Typography>
                <Tooltip title="Remove element">
                  <span>
                    <IconButton size="small" color="error" onClick={removeElement} disabled={!selectedElement}>
                      <Delete fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
              {!selectedElement ? <Alert severity="info">Select or add an element.</Alert> : (
                <>
                  <TextField label="Label" value={selectedElement.label} onChange={event => updateElement(selectedElement.id, { label: event.target.value })} fullWidth />
                  <TextField
                    select
                    label="Type"
                    value={selectedElement.type}
                    onChange={event => updateElement(selectedElement.id, { type: event.target.value as BadgeFieldKey })}
                    fullWidth
                  >
                    {TYPE_OPTIONS.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                  </TextField>
                  {selectedElement.type === "customField" ? (
                    <TextField
                      select
                      label="Custom field"
                      value={selectedElement.customFieldId || ""}
                      onChange={event => updateElement(selectedElement.id, { customFieldId: event.target.value })}
                      fullWidth
                    >
                      {customFields.map(field => <MenuItem key={field.id} value={field.id}>{field.label}</MenuItem>)}
                    </TextField>
                  ) : null}
                  {selectedElement.type === "staticText" ? (
                    <TextField label="Text" value={selectedElement.staticText || ""} onChange={event => updateElement(selectedElement.id, { staticText: event.target.value })} fullWidth multiline minRows={2} />
                  ) : null}
                  {(["x", "y", "width", "height"] as const).map(field => (
                    <Box key={field}>
                      <Typography variant="caption" color="text.secondary">{field.toUpperCase()}</Typography>
                      <Slider value={selectedElement[field]} onChange={(_, value) => updateElement(selectedElement.id, { [field]: value as number })} min={field === "width" || field === "height" ? 1 : 0} max={100} />
                    </Box>
                  ))}
                  {isShapeElement(selectedElement) ? (
                    <>
                      <TextField
                        label={selectedElement.type === "line" ? "Line color" : "Fill"}
                        type="color"
                        value={colorInputValue(selectedElement.backgroundColor || selectedElement.color, "#2563eb")}
                        onChange={event => updateElement(selectedElement.id, { backgroundColor: event.target.value, color: event.target.value })}
                        fullWidth
                      />
                      <TextField
                        label="Stroke"
                        type="color"
                        value={colorInputValue(selectedElement.borderColor, "#111827")}
                        onChange={event => updateElement(selectedElement.id, { borderColor: event.target.value })}
                        fullWidth
                      />
                      <Box>
                        <Typography variant="caption" color="text.secondary">Stroke width</Typography>
                        <Slider
                          value={selectedElement.borderWidth || 0}
                          onChange={(_, value) => updateElement(selectedElement.id, { borderWidth: value as number })}
                          min={0}
                          max={20}
                          valueLabelDisplay="auto"
                        />
                      </Box>
                    </>
                  ) : (
                    <>
                      <TextField label="Font size" type="number" value={selectedElement.fontSize} onChange={event => updateElement(selectedElement.id, { fontSize: Number(event.target.value || 12) })} fullWidth />
                      <TextField label="Color" type="color" value={colorInputValue(selectedElement.color, "#111827")} onChange={event => updateElement(selectedElement.id, { color: event.target.value })} fullWidth />
                      <Stack direction="row" spacing={1}>
                        <TextField
                          select
                          label="Weight"
                          value={selectedElement.fontWeight}
                          onChange={event => updateElement(selectedElement.id, { fontWeight: event.target.value as "400" | "600" | "700" })}
                          fullWidth
                        >
                          <MenuItem value="400">Regular</MenuItem>
                          <MenuItem value="600">Semi</MenuItem>
                          <MenuItem value="700">Bold</MenuItem>
                        </TextField>
                        <TextField
                          select
                          label="Align"
                          value={selectedElement.align}
                          onChange={event => updateElement(selectedElement.id, { align: event.target.value as "left" | "center" | "right" })}
                          fullWidth
                        >
                          <MenuItem value="left">Left</MenuItem>
                          <MenuItem value="center">Center</MenuItem>
                          <MenuItem value="right">Right</MenuItem>
                        </TextField>
                      </Stack>
                    </>
                  )}
                  {selectedElement.type === "photo" ? (
                    <TextField
                      select
                      label="Shape"
                      value={selectedElement.shape}
                      onChange={event => updateElement(selectedElement.id, { shape: event.target.value as "square" | "circle" })}
                      fullWidth
                    >
                      <MenuItem value="square">Square</MenuItem>
                      <MenuItem value="circle">Circle</MenuItem>
                    </TextField>
                  ) : null}
                  <TextField
                    label="Custom CSS"
                    value={selectedElement.customCss || ""}
                    onChange={event => updateElement(selectedElement.id, { customCss: event.target.value })}
                    fullWidth
                    multiline
                    minRows={3}
                    placeholder="transform: rotate(-2deg);"
                  />
                </>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
            <Typography variant="h6">Attendees</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <TextField select size="small" label="Status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} sx={{ minWidth: 160 }}>
                <MenuItem value="CONFIRMED">Confirmed</MenuItem>
                <MenuItem value="APPROVED">Approved</MenuItem>
                <MenuItem value="PENDING">Pending</MenuItem>
                <MenuItem value="WAITLISTED">Waitlisted</MenuItem>
                <MenuItem value="ALL">All active</MenuItem>
              </TextField>
              <TextField select size="small" label="Ticket tier" value={tierFilter} onChange={event => setTierFilter(event.target.value)} sx={{ minWidth: 180 }}>
                <MenuItem value="">All tiers</MenuItem>
                {ticketTiers.map(tier => <MenuItem key={tier.id} value={tier.id}>{tier.name}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Search" value={searchFilter} onChange={event => setSearchFilter(event.target.value)} />
              <Button variant="outlined" onClick={() => void fetchAttendees()} disabled={loadingAttendees}>
                {loadingAttendees ? <CircularProgress size={18} /> : "Apply"}
              </Button>
            </Stack>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip label={`${selectedAttendees.length} selected`} />
            <Button size="small" onClick={() => setSelectedAttendeeIds(attendees.map(attendee => attendee.registrationId))}>Select all</Button>
            <Button size="small" onClick={() => setSelectedAttendeeIds([])}>Clear</Button>
            <TextField
              select
              size="small"
              label="Print layout"
              value={pageMode}
              onChange={event => setPageMode(event.target.value as "sheet" | "single")}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="sheet">Sheet</MenuItem>
              <MenuItem value="single">One per page</MenuItem>
            </TextField>
            <Button startIcon={<Print />} variant="contained" onClick={() => void exportBadges("html", true)} disabled={exporting}>Print</Button>
            <Button startIcon={<Download />} variant="outlined" onClick={() => void exportBadges("html")} disabled={exporting}>Open PDF view</Button>
            <Button startIcon={<Download />} variant="outlined" onClick={() => void exportBadges("png")} disabled={exporting || selectedAttendees.length === 0}>PNG first selected</Button>
          </Stack>

          <Grid container spacing={1}>
            {attendees.map(attendee => (
              <Grid key={attendee.registrationId} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={selectedAttendeeIds.includes(attendee.registrationId)}
                        onChange={event => toggleAttendee(attendee.registrationId, event.target.checked)}
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2" fontWeight={600}>#{attendee.ticketId} {attendee.displayName}</Typography>
                        <Typography variant="caption" color="text.secondary">{attendee.ticketTier || "Ticket"} • {attendee.email}</Typography>
                      </Box>
                    }
                    sx={{ alignItems: "flex-start", m: 0 }}
                  />
                </Paper>
              </Grid>
            ))}
          </Grid>
          {attendees.length === 0 ? <Alert severity="info">No attendees match the current filters.</Alert> : null}
        </Stack>
      </Paper>
    </Stack>
    <ImageCropper
      open={!!activeFallbackPhoto}
      imageSrc={activeFallbackPhoto?.src || null}
      onCancel={closeFallbackPhotoCropper}
      onCropComplete={handleFallbackPhotoCropComplete}
      aspect={1}
    />
    </>
  );
}
