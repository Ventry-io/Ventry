import { formatTicketQrPayload } from "@/lib/tickets/qr";
import type { BadgeElement, BadgeTemplateInput } from "@/types/schemas/badge";

export type BadgeAttendee = {
  id: string;
  registrationId: string;
  ticketId: number;
  status: "PENDING" | "APPROVED" | "CONFIRMED" | "CANCELLED" | "WAITLISTED";
  displayName: string;
  legalName: string | null;
  email: string;
  photoUrl: string | null;
  ticketTier: string | null;
  crewDepartment?: string | null;
  crewRole?: string | null;
  eventName: string;
  customFieldData: Record<string, string | number | boolean | null>;
};

export type BadgeTemplate = BadgeTemplateInput & {
  id: string;
  eventId: number;
  createdAt?: string;
  updatedAt?: string;
};

export const DEFAULT_BADGE_TEMPLATE: BadgeTemplateInput = {
  name: "Default Badge",
  isDefault: true,
  widthMm: 85,
  heightMm: 55,
  background: {
    color: "#f8fafc",
    fit: "cover",
    positionX: 50,
    positionY: 50,
    fallbackPhotoUrls: [],
  },
  elements: [
    {
      id: "photo",
      type: "photo",
      label: "Photo",
      x: 6,
      y: 12,
      width: 28,
      height: 43,
      fontSize: 10,
      fontWeight: "600",
      color: "#111827",
      align: "center",
      shape: "square",
    },
    {
      id: "name",
      type: "displayName",
      label: "Name",
      x: 38,
      y: 18,
      width: 40,
      height: 14,
      fontSize: 17,
      fontWeight: "700",
      color: "#111827",
      align: "left",
      shape: "square",
    },
    {
      id: "ticket",
      type: "ticketId",
      label: "Ticket Number",
      x: 38,
      y: 36,
      width: 28,
      height: 8,
      fontSize: 9,
      fontWeight: "600",
      color: "#475569",
      align: "left",
      shape: "square",
    },
    {
      id: "tier",
      type: "ticketTier",
      label: "Ticket Tier",
      x: 38,
      y: 47,
      width: 32,
      height: 8,
      fontSize: 8,
      fontWeight: "600",
      color: "#334155",
      align: "left",
      shape: "square",
    },
    {
      id: "qr",
      type: "qrCode",
      label: "QR Code",
      x: 77,
      y: 61,
      width: 17,
      height: 27,
      fontSize: 8,
      fontWeight: "600",
      color: "#111827",
      align: "center",
      shape: "square",
    },
    {
      id: "event",
      type: "eventName",
      label: "Event",
      x: 6,
      y: 4,
      width: 88,
      height: 8,
      fontSize: 8,
      fontWeight: "700",
      color: "#334155",
      align: "center",
      shape: "square",
    },
  ],
};

export function getBadgeElementValue(element: BadgeElement, attendee: BadgeAttendee, eventId: number) {
  switch (element.type) {
    case "displayName":
      return attendee.displayName;
    case "legalName":
      return attendee.legalName || attendee.displayName;
    case "ticketId":
      return `#${attendee.ticketId}`;
    case "ticketTier":
      return attendee.ticketTier || "Ticket";
    case "crewDepartment":
      return attendee.crewDepartment || "";
    case "crewRole":
      return attendee.crewRole || "";
    case "eventName":
      return attendee.eventName;
    case "customField": {
      const raw = element.customFieldId ? attendee.customFieldData[element.customFieldId] : null;
      return raw === null || raw === undefined ? "" : String(raw);
    }
    case "staticText":
      return element.staticText || "";
    case "qrCode":
      return formatTicketQrPayload({ eventId, ticketId: attendee.ticketId });
    case "photo":
      return attendee.photoUrl || "";
    case "rectangle":
    case "ellipse":
    case "line":
      return "";
    default:
      return "";
  }
}

export function attendeeInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map(part => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

function stableIndex(value: string, length: number) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

export function getBadgePhotoUrl(template: BadgeTemplateInput, attendee: BadgeAttendee) {
  if (attendee.photoUrl) return attendee.photoUrl;

  const fallbackPhotoUrls = template.background.fallbackPhotoUrls || [];
  if (fallbackPhotoUrls.length === 0) return null;

  const key = attendee.registrationId || String(attendee.ticketId);
  return fallbackPhotoUrls[stableIndex(key, fallbackPhotoUrls.length)];
}

function wrapTextToLines(value: string, maxCharsPerLine: number) {
  const sourceLines = value.split(/\r?\n/);
  const lines: string[] = [];

  for (const sourceLine of sourceLines) {
    const words = sourceLine.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      if (word.length > maxCharsPerLine) {
        if (current) {
          lines.push(current);
          current = "";
        }
        for (let index = 0; index < word.length; index += maxCharsPerLine) {
          lines.push(word.slice(index, index + maxCharsPerLine));
        }
        continue;
      }

      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxCharsPerLine && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }

    if (current) lines.push(current);
  }

  return lines.length === 0 ? [""] : lines;
}

export function fitBadgeText(template: BadgeTemplateInput, element: BadgeElement, value: string) {
  const minFontSize = 6;
  const maxFontSize = element.fontSize;
  const widthPx = Math.max(1, template.widthMm * 3.78 * (element.width / 100));
  const heightPx = Math.max(1, template.heightMm * 3.78 * (element.height / 100));

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 1) {
    const maxCharsPerLine = Math.max(1, Math.floor(widthPx / (fontSize * 0.55)));
    const lines = wrapTextToLines(value, maxCharsPerLine);
    const neededHeight = lines.length * fontSize * 1.12;
    if (neededHeight <= heightPx * 0.96) {
      return { fontSize, lines };
    }
  }

  return {
    fontSize: minFontSize,
    lines: wrapTextToLines(value, Math.max(1, Math.floor(widthPx / (minFontSize * 0.55)))),
  };
}

export function normalizeBadgeTemplate(raw: {
  id: string;
  eventId: number;
  name: string;
  isDefault: boolean;
  widthMm: number;
  heightMm: number;
  background: unknown;
  elements: unknown;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}): BadgeTemplate {
  const rawBackground = raw.background && typeof raw.background === "object" ? raw.background as Partial<BadgeTemplateInput["background"]> : {};

  return {
    id: raw.id,
    eventId: raw.eventId,
    name: raw.name,
    isDefault: raw.isDefault,
    widthMm: raw.widthMm,
    heightMm: raw.heightMm,
    background: {
      color: rawBackground.color || DEFAULT_BADGE_TEMPLATE.background.color,
      imageUrl: rawBackground.imageUrl || null,
      fit: rawBackground.fit === "contain" || rawBackground.fit === "stretch" || rawBackground.fit === "cover"
        ? rawBackground.fit
        : DEFAULT_BADGE_TEMPLATE.background.fit,
      positionX: typeof rawBackground.positionX === "number" ? rawBackground.positionX : 50,
      positionY: typeof rawBackground.positionY === "number" ? rawBackground.positionY : 50,
      fallbackPhotoUrls: Array.isArray(rawBackground.fallbackPhotoUrls)
        ? rawBackground.fallbackPhotoUrls.filter((url): url is string => typeof url === "string")
        : [],
    },
    elements: Array.isArray(raw.elements)
      ? (raw.elements as BadgeTemplateInput["elements"])
      : DEFAULT_BADGE_TEMPLATE.elements,
    createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : undefined,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : undefined,
  };
}
