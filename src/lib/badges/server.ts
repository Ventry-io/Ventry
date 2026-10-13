import ErrorCorrectLevel from "qr.js/lib/ErrorCorrectLevel";
import QRCodeGenerator from "qr.js/lib/QRCode";
import sharp from "sharp";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma/prisma";
import { attendeeInitials, fitBadgeText, getBadgeElementValue, getBadgePhotoUrl, type BadgeAttendee } from "@/lib/badges/badge";
import { refreshSignedUrls } from "@/lib/user/profilePicture";
import type { BadgeAttendeeQuery, BadgeElement, BadgeTemplateInput } from "@/types/schemas/badge";

const PRINT_SCALE = 4;
const SHAPE_ELEMENT_TYPES = new Set(["rectangle", "ellipse", "line"]);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value: string) {
  return escapeHtml(value);
}

function bytesToBinaryString(bytes: number[]) {
  return bytes.map(byte => String.fromCharCode(byte & 0xff)).join("");
}

function encodeStringToUtf8Bytes(input: string) {
  return Array.from(new TextEncoder().encode(input));
}

function getQrCells(value: string): boolean[][] {
  const qrcode = new QRCodeGenerator(-1, ErrorCorrectLevel.M);
  qrcode.addData(bytesToBinaryString(encodeStringToUtf8Bytes(value)), "Byte");
  qrcode.make();
  return qrcode.modules;
}

function renderQrSvg(value: string, attributes = "") {
  const cells = getQrCells(value);
  const fgD = cells
    .map((row, rowIndex) =>
      row.map((cell, cellIndex) => (cell ? `M ${cellIndex} ${rowIndex} l 1 0 0 1 -1 0 Z` : "")).join(" "),
    )
    .join(" ");

  return `<svg ${attributes} viewBox="0 0 ${cells.length} ${cells.length}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ffffff"/><path d="${fgD}" fill="#000000"/></svg>`;
}

function renderNestedQrSvg(value: string, element: BadgeElement) {
  return renderQrSvg(
    value,
    `x="${element.x}%" y="${element.y}%" width="${element.width}%" height="${element.height}%" preserveAspectRatio="xMidYMid meet"`,
  );
}

function toRecord(value: Prisma.JsonValue): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean | null] => {
      const val = entry[1];
      return val === null || typeof val === "string" || typeof val === "number" || typeof val === "boolean";
    }),
  );
}

export async function loadBadgeAttendees(eventId: number, query: BadgeAttendeeQuery): Promise<BadgeAttendee[]> {
  const search = query.search?.trim();
  const registrations = await prisma.registration.findMany({
    where: {
      eventId,
      status:
        query.status === "ALL"
          ? { not: "CANCELLED" }
          : query.status,
      ...(search
        ? {
            user: {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { legalName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
      ...(query.ticketTier
        ? {
            registrationItems: {
              some: {
                product: {
                  id: query.ticketTier,
                  type: "TICKET",
                },
              },
            },
          }
        : {}),
    },
    include: {
      event: {
        select: {
          name: true,
          organizationId: true,
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          legalName: true,
          image: true,
          isAdmin: true,
          adminProfile: { select: { organizationMemberships: { select: { organizationId: true, role: true, department: { select: { name: true } } } } } },
          profilePictures: {
            orderBy: [
              { isPrimary: "desc" },
              { order: "asc" },
              { createdAt: "desc" },
            ],
            select: {
              id: true,
              signedUrl: true,
              storagePath: true,
              cachedUntil: true,
              isPrimary: true,
            },
          },
        },
      },
      registrationItems: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      },
    },
    orderBy: [{ ticketId: "asc" }],
  });

  return Promise.all(registrations.map(async registration => {
    const ticketItem = registration.registrationItems.find(item => item.product.type === "TICKET");
    const profilePictures = await refreshSignedUrls(registration.user.profilePictures);
    const primaryPicture = profilePictures.find(picture => picture.isPrimary) || profilePictures[0];

    const crew = registration.user.isAdmin ? registration.user.adminProfile?.organizationMemberships.find(m => m.organizationId === registration.event.organizationId) : null;
    return {
      crewDepartment: crew?.department?.name || null,
      crewRole: crew?.role || null,
      id: registration.id,
      registrationId: registration.id,
      ticketId: registration.ticketId,
      status: registration.status,
      displayName: registration.user.name || registration.user.legalName || registration.user.email,
      legalName: registration.user.legalName,
      email: registration.user.email,
      photoUrl: primaryPicture?.signedUrl || registration.user.image || null,
      ticketTier: ticketItem?.product.name || null,
      eventName: registration.event.name,
      customFieldData: toRecord(registration.customFieldData as Prisma.JsonValue),
    };
  }));
}

export async function loadBadgeAttendeesByIds(eventId: number, registrationIds: string[]) {
  const attendees = await loadBadgeAttendees(eventId, { status: "ALL" });
  const idSet = new Set(registrationIds);
  return attendees.filter(attendee => idSet.has(attendee.registrationId));
}

function backgroundCss(template: BadgeTemplateInput) {
  return `background-color:${template.background.color || "#ffffff"};`;
}

function backgroundImageCss(template: BadgeTemplateInput) {
  return [
    "position:absolute",
    "inset:0",
    "width:100%",
    "height:100%",
    `object-fit:${template.background.fit === "stretch" ? "fill" : template.background.fit}`,
    `object-position:${template.background.positionX}% ${template.background.positionY}%`,
    "z-index:0",
    "pointer-events:none",
  ].join(";");
}

function isShapeElement(element: BadgeElement) {
  return SHAPE_ELEMENT_TYPES.has(element.type);
}

function elementChromeCss(element: BadgeElement) {
  const styles: string[] = [];
  if (element.backgroundColor) {
    styles.push(`background-color:${element.backgroundColor}`);
  }
  if (element.borderWidth !== undefined && element.borderWidth > 0) {
    styles.push(`border:${element.borderWidth}px solid ${element.borderColor || "#111827"}`);
  }
  return styles;
}

function customCss(element: BadgeElement) {
  return element.customCss?.trim() || "";
}

function elementCss(element: BadgeElement, extraStyles: string[] = []) {
  return [
    "position:absolute",
    `left:${element.x}%`,
    `top:${element.y}%`,
    `width:${element.width}%`,
    `height:${element.height}%`,
    "z-index:1",
    ...elementChromeCss(element),
    `font-size:${element.fontSize}px`,
    `font-weight:${element.fontWeight}`,
    `color:${element.color}`,
    `text-align:${element.align}`,
    "overflow:hidden",
    "display:flex",
    "align-items:center",
    element.align === "center" ? "justify-content:center" : element.align === "right" ? "justify-content:flex-end" : "justify-content:flex-start",
    "line-height:1.1",
    "word-break:break-word",
    "overflow-wrap:anywhere",
    ...extraStyles,
    customCss(element),
  ].join(";");
}

function renderElementHtml(element: BadgeElement, template: BadgeTemplateInput, attendee: BadgeAttendee, eventId: number) {
  if (isShapeElement(element)) {
    const shapeStyles = [
      `background-color:${element.backgroundColor || element.color}`,
      element.type === "ellipse" || element.type === "line" ? "border-radius:999px" : "border-radius:4px",
      element.type === "line" ? `height:${element.height}%` : "",
    ].filter(Boolean);
    return `<div style="${escapeAttr(elementCss(element, shapeStyles))}"></div>`;
  }

  if (element.type === "photo") {
    const photoUrl = getBadgePhotoUrl(template, attendee);
    if (photoUrl) {
      return `<img alt="" src="${escapeAttr(photoUrl)}" style="${escapeAttr(elementCss(element, ["object-fit:cover", `border-radius:${element.shape === "circle" ? "999px" : "4px"}`]))}" />`;
    }

    return `<div style="${escapeAttr(elementCss(element, ["background:#e2e8f0", `border-radius:${element.shape === "circle" ? "999px" : "4px"}`]))}">${escapeHtml(attendeeInitials(attendee.displayName))}</div>`;
  }

  if (element.type === "qrCode") {
    const value = getBadgeElementValue(element, attendee, eventId);
    return `<div style="${escapeAttr(elementCss(element, ["background:#fff", "border:1px solid #cbd5e1", "padding:2px"]))}">${renderQrSvg(value)}</div>`;
  }

  const value = getBadgeElementValue(element, attendee, eventId);
  const fitted = fitBadgeText(template, element, value);
  const css = elementCss(element, [`font-size:${fitted.fontSize}px`]);
  return `<div style="${escapeAttr(css)}">${escapeHtml(value)}</div>`;
}

export function renderBadgeHtml(template: BadgeTemplateInput, attendee: BadgeAttendee, eventId: number) {
  const elements = template.elements.map(element => renderElementHtml(element, template, attendee, eventId)).join("");
  const backgroundImage = template.background.imageUrl
    ? `<img alt="" class="badge-bg" src="${escapeAttr(template.background.imageUrl)}" style="${backgroundImageCss(template)}" />`
    : "";

  return `<section class="badge" style="width:${template.widthMm}mm;height:${template.heightMm}mm;${backgroundCss(template)}">${backgroundImage}${elements}</section>`;
}

export function renderPrintableBadgesHtml(
  template: BadgeTemplateInput,
  attendees: BadgeAttendee[],
  eventId: number,
  pageMode: "sheet" | "single",
) {
  const badges = attendees.map(attendee => renderBadgeHtml(template, attendee, eventId)).join("");
  const pageBreak = pageMode === "single" ? ".badge{break-after:page;page-break-after:always;}" : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(template.name)} Badges</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:10mm;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif}
.sheet{display:flex;flex-wrap:wrap;gap:6mm;align-items:flex-start}
.badge{position:relative;overflow:hidden;background:#fff;box-shadow:0 0 0 1px #cbd5e1;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.badge-bg{display:block;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.badge svg{width:100%;height:100%;display:block}
${pageBreak}
@page{size:auto;margin:8mm}
@media print{
  body{padding:0;background:#fff}
  .sheet{gap:3mm}
  .badge{box-shadow:none;border:0.2mm solid #cbd5e1}
}
</style>
</head>
<body>
<main class="sheet">${badges}</main>
</body>
</html>`;
}

function svgText(template: BadgeTemplateInput, element: BadgeElement, value: string) {
  const fitted = fitBadgeText(template, element, value);
  const anchor = element.align === "center" ? "middle" : element.align === "right" ? "end" : "start";
  const x = element.align === "center" ? element.x + element.width / 2 : element.align === "right" ? element.x + element.width : element.x;
  const style = element.customCss ? ` style="${escapeAttr(element.customCss)}"` : "";
  const lineHeight = fitted.fontSize * 1.12 * PRINT_SCALE;
  const y = element.y + element.height / 2;
  const startDy = -((fitted.lines.length - 1) * lineHeight) / 2;
  const tspans = fitted.lines.map((line, index) => {
    const dy = index === 0 ? startDy : lineHeight;
    return `<tspan x="${x}%" dy="${dy}">${escapeHtml(line)}</tspan>`;
  }).join("");
  return `<text text-anchor="${anchor}" dominant-baseline="middle" font-size="${fitted.fontSize * PRINT_SCALE}" font-weight="${element.fontWeight}" fill="${escapeAttr(element.color)}" y="${y}%"${style}>${tspans}</text>`;
}

function svgShape(element: BadgeElement) {
  const fill = escapeAttr(element.backgroundColor || element.color);
  const stroke = element.borderWidth && element.borderWidth > 0
    ? ` stroke="${escapeAttr(element.borderColor || "#111827")}" stroke-width="${element.borderWidth / PRINT_SCALE}"`
    : "";
  const style = element.customCss ? ` style="${escapeAttr(element.customCss)}"` : "";

  if (element.type === "ellipse") {
    return `<ellipse cx="${element.x + element.width / 2}%" cy="${element.y + element.height / 2}%" rx="${element.width / 2}%" ry="${element.height / 2}%" fill="${fill}"${stroke}${style}/>`;
  }

  return `<rect x="${element.x}%" y="${element.y}%" width="${element.width}%" height="${element.height}%" rx="${element.type === "line" ? "999" : "1"}" fill="${fill}"${stroke}${style}/>`;
}

export async function renderBadgePng(template: BadgeTemplateInput, attendee: BadgeAttendee, eventId: number) {
  const width = Math.round(template.widthMm * PRINT_SCALE * 3.78);
  const height = Math.round(template.heightMm * PRINT_SCALE * 3.78);
  const elements = template.elements.map(element => {
    if (isShapeElement(element)) {
      return svgShape(element);
    }

    if (element.type === "photo") {
      const rx = element.shape === "circle" ? `${Math.min(element.width, element.height) / 2}%` : "2%";
      const initials = attendeeInitials(attendee.displayName);
      return `<rect x="${element.x}%" y="${element.y}%" width="${element.width}%" height="${element.height}%" rx="${rx}" fill="#e2e8f0"/><text x="${element.x + element.width / 2}%" y="${element.y + element.height / 2}%" text-anchor="middle" dominant-baseline="middle" font-size="${element.fontSize * PRINT_SCALE}" font-weight="700" fill="#334155">${escapeHtml(initials)}</text>`;
    }

    if (element.type === "qrCode") {
      return `<rect x="${element.x}%" y="${element.y}%" width="${element.width}%" height="${element.height}%" fill="#fff" stroke="#cbd5e1"/>${renderNestedQrSvg(getBadgeElementValue(element, attendee, eventId), element)}`;
    }

    return svgText(template, element, getBadgeElementValue(element, attendee, eventId));
  }).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 100 100" preserveAspectRatio="none"><rect width="100%" height="100%" fill="${escapeAttr(template.background.color || "#ffffff")}"/>${elements}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
