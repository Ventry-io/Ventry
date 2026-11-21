import { prisma } from "@/lib/prisma/prisma";
import type { RegistrationStatus } from "@/generated/prisma";
import { audit, hasConfirmedRoomHolder, loadStayContext, type RoomEventContext } from "@/lib/rooms/common";
import { hotelForRoomType, resolveMemberStay } from "@/lib/rooms/stay";

export type ManifestRow = {
  hotel: string;
  roomReference: string;
  roomType: string;
  arrival: string;
  departure: string;
  guestName: string;
  earlyArrival: boolean;
  lateDeparture: boolean;
  ticketId: number;
  roomGroup: string;
};

type ManifestGuest = {
  ticketId: number;
  status: RegistrationStatus;
  preferences: unknown;
  registrationItems: Array<{ productId: string }>;
  user: { legalName: string | null; name: string | null };
};

const HEADERS = ["Hotel", "Room", "Room type", "Arrival", "Departure", "Guest (legal name)", "Early arrival", "Late departure", "Ticket", "Room group"];

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Lists confirmed guests of rooms that a confirmed member booked; roommates need no own room item.
 * Everything else stays out of the hotel's hands.
 */
export function buildManifestRows(
  event: RoomEventContext,
  entries: Array<{ productId: string; groupId: string | null; roomReference: string | null; guests: ManifestGuest[] }>,
  hotelId?: string,
): ManifestRow[] {
  const rows: ManifestRow[] = [];
  for (const entry of entries) {
    const hotel = hotelForRoomType(event, entry.productId);
    if (!hotel || (hotelId && hotel.id !== hotelId)) continue;
    const roomType = event.products.find((product) => product.id === entry.productId)?.name ?? "";
    if (!hasConfirmedRoomHolder(entry.guests, entry.productId)) continue;
    for (const guest of entry.guests) {
      if (guest.status !== "CONFIRMED") continue;
      const stay = resolveMemberStay(hotel, guest.preferences);
      if (!stay) continue;
      rows.push({
        hotel: hotel.name,
        roomReference: entry.roomReference ?? "",
        roomType,
        arrival: isoDate(stay.checkIn),
        departure: isoDate(stay.checkOut),
        guestName: guest.user.legalName || guest.user.name || "",
        earlyArrival: stay.earlyArrival,
        lateDeparture: stay.lateDeparture,
        ticketId: guest.ticketId,
        roomGroup: entry.groupId ?? "",
      });
    }
  }
  return rows.sort((a, b) => a.hotel.localeCompare(b.hotel) || a.roomReference.localeCompare(b.roomReference) || a.guestName.localeCompare(b.guestName));
}

function csvCell(value: string | number | boolean) {
  let text = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  // Spreadsheet formula injection guard.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function manifestToCsv(rows: ManifestRow[]) {
  const lines = [HEADERS, ...rows.map((row) => [row.hotel, row.roomReference, row.roomType, row.arrival, row.departure, row.guestName, row.earlyArrival, row.lateDeparture, row.ticketId, row.roomGroup])];
  return `${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const guestSelect = {
  ticketId: true,
  status: true,
  preferences: true,
  registrationItems: { select: { productId: true } },
  user: { select: { legalName: true, name: true } },
} as const;

export async function exportManifest(eventId: number, adminId: string | undefined, hotelId?: string) {
  const event = await loadStayContext(prisma, eventId);
  const [groups, ungrouped] = await Promise.all([
    prisma.roomGroup.findMany({
      where: { eventId },
      select: {
        id: true,
        productId: true,
        assignment: { select: { room: { select: { reference: true } } } },
        members: { select: { registration: { select: guestSelect } } },
      },
    }),
    // Confirmed guests without a group still need a bed: listed without room reference.
    prisma.registration.findMany({
      where: { eventId, status: "CONFIRMED", roomGroupMember: null, registrationItems: { some: { product: { type: "ACCOMMODATION" } } } },
      select: { ...guestSelect, registrationItems: { select: { productId: true, product: { select: { type: true } } } } },
    }),
  ]);

  const rows = buildManifestRows(
    event,
    [
      ...groups.map((group) => ({
        productId: group.productId,
        groupId: group.id,
        roomReference: group.assignment?.room.reference ?? null,
        guests: group.members.map((member) => member.registration),
      })),
      ...ungrouped.map((registration) => ({
        productId: registration.registrationItems.find((item) => item.product.type === "ACCOMMODATION")?.productId ?? "",
        groupId: null,
        roomReference: null,
        guests: [registration],
      })),
    ],
    hotelId,
  );

  await audit(prisma, { eventId, actorAdminId: adminId, action: "MANIFEST_EXPORTED", metadata: { hotelId: hotelId ?? null, rows: rows.length } });
  return manifestToCsv(rows);
}
