import ErrorCorrectLevel from "qr.js/lib/ErrorCorrectLevel";
import QRCodeGenerator from "qr.js/lib/QRCode";
import sharp from "sharp";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma/prisma";
import { attendeeInitials, fitBadgeText, getBadgeElementValue, getBadgePhotoUrl, resolveBadgeTemplate, type BadgeAttendee } from "@/lib/badges/badge";
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
  const registrationQuery = {
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
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          requiresHotel: true,
          maxRegistrations: true,
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
          username: true,
          pronouns: true,
          country: true,
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
  } satisfies Prisma.RegistrationFindManyArgs;
  let eventCrew = new Map<string, { role: string | null; department: string | null }>();
  const registrations = await prisma.registration.findMany(registrationQuery).catch(async (error: unknown) => {
    // ponytail: Bridge the newer crew schema in shared development databases; remove when this branch adopts event-scoped crew.
    if (!(error instanceof Error) || !("code" in error) || error.code !== "P2022" ||
      !/AdminOrganizationMembership\.(role|departmentId)/.test(error.message)) throw error;

    const [rows, assignments] = await Promise.all([
      prisma.registration.findMany({
        ...registrationQuery,
        include: {
          ...registrationQuery.include,
          user: { select: { ...registrationQuery.include.user.select, adminProfile: false } },
        },
      }),
      prisma.$queryRaw<Array<{ registrationId: string; role: string | null; department: string | null }>>`
        SELECT r."id" AS "registrationId", a."role", d."name" AS "department"
        FROM "CrewAssignment" a
        JOIN "AdminOrganizationMembership" m ON m."id" = a."membershipId"
        JOIN "Admin" admin ON admin."id" = m."adminId"
        JOIN "Registration" r ON r."userId" = admin."userId" AND r."eventId" = a."eventId"
        JOIN "Event" e ON e."id" = a."eventId" AND e."organizationId" = m."organizationId"
        LEFT JOIN "CrewDepartment" d ON d."id" = a."departmentId"
        WHERE a."eventId" = ${eventId}
      `,
    ]);
    eventCrew = new Map(assignments.map(assignment => [assignment.registrationId, assignment]));
    return rows.map(row => ({ ...row, user: { ...row.user, adminProfile: null } }));
  });

  return Promise.all(registrations.map(async registration => {
    const ticketItem = registration.registrationItems.find(item => item.product.type === "TICKET");
    const profilePictures = await refreshSignedUrls(registration.user.profilePictures);
    const primaryPicture = profilePictures.find(picture => picture.isPrimary) || profilePictures[0];

    const crew = registration.user.isAdmin ? registration.user.adminProfile?.organizationMemberships.find(m => m.organizationId === registration.event.organizationId) : null;
    const assignment = registration.user.isAdmin ? eventCrew.get(registration.id) : null;
    return {
      crewDepartment: assignment?.department || crew?.department?.name || null,
      crewRole: assignment?.role || crew?.role || null,
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
      data: {
        user: {
          id: registration.user.id,
          name: registration.user.name,
          legalName: registration.user.legalName,
          email: registration.user.email,
          username: registration.user.username,
          pronouns: registration.user.pronouns,
          country: registration.user.country,
          isAdmin: registration.user.isAdmin,
        },
        event: {
          ...registration.event,
          startDate: registration.event.startDate.toISOString(),
          endDate: registration.event.endDate.toISOString(),
        },
        registration: {
          id: registration.id,
          status: registration.status,
          ticketId: registration.ticketId,
          preferences: registration.preferences,
          customFieldData: registration.customFieldData,
          checkInCount: registration.checkInCount,
          checkedInAt: registration.checkedInAt?.toISOString() || null,
          createdAt: registration.createdAt.toISOString(),
        },
        products: registration.registrationItems.map(item => ({
          ...item.product,
          priceAtBooking: item.priceAtBooking,
        })),
      },
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

  if (element.type === "photo" || element.type === "image") {
    const photoUrl = element.type === "image" ? element.imageUrl : getBadgePhotoUrl(template, attendee);
    if (photoUrl) {
      return `<img alt="" src="${escapeAttr(photoUrl)}" style="${escapeAttr(elementCss(element, ["object-fit:cover", `border-radius:${element.shape === "circle" ? "999px" : "4px"}`]))}" />`;
    }

    return element.type === "image" ? "" : `<div style="${escapeAttr(elementCss(element, ["background:#e2e8f0", `border-radius:${element.shape === "circle" ? "999px" : "4px"}`]))}">${escapeHtml(attendeeInitials(attendee.displayName))}</div>`;
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
  template = resolveBadgeTemplate(template, attendee);
  const elements = template.elements.map(element => renderElementHtml(element, template, attendee, eventId)).join("");
  const backgroundImage = template.background.imageUrl
    ? `<img alt="" class="badge-bg" src="${escapeAttr(template.background.imageUrl)}" style="${backgroundImageCss(template)}" />`
    : "";

  return `<section class="badge" style="${escapeAttr(`width:${template.widthMm}mm;height:${template.heightMm}mm;${backgroundCss(template)}`)}">${backgroundImage}${elements}</section>`;
}

export function renderPrintableBadgesHtml(
  template: BadgeTemplateInput,
  attendees: BadgeAttendee[],
  eventId: number,
  pageMode: "sheet" | "single",
  additionalTemplates: BadgeTemplateInput[] = [],
) {
  const badges = attendees.flatMap(attendee => [template, ...additionalTemplates].map(design => renderBadgeHtml(design, attendee, eventId))).join("");
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

export class BadgeImageError extends Error {}

async function badgeImageDataUrl(imageUrl: string) {
  const url = new URL(imageUrl);
  const storageOrigin = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : null;
  const storageImage = url.origin === storageOrigin && url.pathname.startsWith("/storage/v1/object/");
  const profileImage = url.protocol === "https:" && !url.port &&
    ["lh3.googleusercontent.com", "avatars.githubusercontent.com"].includes(url.hostname);
  if (url.username || url.password || (!storageImage && !profileImage)) {
    throw new BadgeImageError("PNG images must use uploaded media or supported profile images. Use the print view for external image URLs.");
  }
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.body) throw new Error("Image unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 10 * 1024 * 1024) throw new Error("Image too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const { data, info } = await sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000 }).resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    return { href: `data:image/png;base64,${data.toString("base64")}`, width: info.width, height: info.height };
  } catch {
    throw new BadgeImageError("Could not load a badge image for PNG export. Check the image or use the print view.");
  }
}

export async function renderBadgePng(template: BadgeTemplateInput, attendee: BadgeAttendee, eventId: number) {
  template = resolveBadgeTemplate(template, attendee);
  const width = Math.round(template.widthMm * PRINT_SCALE * 3.78);
  const height = Math.round(template.heightMm * PRINT_SCALE * 3.78);
  const urls = new Set<string>();
  if (template.background.imageUrl) urls.add(template.background.imageUrl);
  for (const element of template.elements) {
    const url = element.type === "image" ? element.imageUrl : element.type === "photo" ? getBadgePhotoUrl(template, attendee) : null;
    if (url) urls.add(url);
  }
  const images = new Map(await Promise.all([...urls].map(async url => [url, await badgeImageDataUrl(url)] as const)));
  const elements = template.elements.map(element => {
    if (isShapeElement(element)) {
      return svgShape(element);
    }

    if (element.type === "photo" || element.type === "image") {
      const url = element.type === "image" ? element.imageUrl : getBadgePhotoUrl(template, attendee);
      if (url) {
        const clipId = `photo-${template.elements.indexOf(element)}`;
        const radius = element.shape === "circle" ? Math.min(width * element.width, height * element.height) / 200 : 4 * PRINT_SCALE;
        return `<defs><clipPath id="${clipId}"><rect x="${element.x}%" y="${element.y}%" width="${element.width}%" height="${element.height}%" rx="${radius}"/></clipPath></defs><image href="${images.get(url)?.href}" x="${element.x}%" y="${element.y}%" width="${element.width}%" height="${element.height}%" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`;
      }
      if (element.type === "image") return "";
      const rx = element.shape === "circle" ? `${Math.min(element.width, element.height) / 2}%` : "2%";
      const initials = attendeeInitials(attendee.displayName);
      return `<rect x="${element.x}%" y="${element.y}%" width="${element.width}%" height="${element.height}%" rx="${rx}" fill="#e2e8f0"/><text x="${element.x + element.width / 2}%" y="${element.y + element.height / 2}%" text-anchor="middle" dominant-baseline="middle" font-size="${element.fontSize * PRINT_SCALE}" font-weight="700" fill="#334155">${escapeHtml(initials)}</text>`;
    }

    if (element.type === "qrCode") {
      return `<rect x="${element.x}%" y="${element.y}%" width="${element.width}%" height="${element.height}%" fill="#fff" stroke="#cbd5e1"/>${renderNestedQrSvg(getBadgeElementValue(element, attendee, eventId), element)}`;
    }

    return svgText(template, element, getBadgeElementValue(element, attendee, eventId));
  }).join("");

  let backgroundImage = "";
  const image = template.background.imageUrl ? images.get(template.background.imageUrl) : null;
  if (image) {
    const scale = (template.background.fit === "contain" ? Math.min : Math.max)(width / image.width, height / image.height);
    const imageWidth = template.background.fit === "stretch" ? width : image.width * scale;
    const imageHeight = template.background.fit === "stretch" ? height : image.height * scale;
    backgroundImage = `<image href="${image.href}" x="${(width - imageWidth) * template.background.positionX / 100}" y="${(height - imageHeight) * template.background.positionY / 100}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${escapeAttr(template.background.color || "#ffffff")}"/>${backgroundImage}${elements}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
