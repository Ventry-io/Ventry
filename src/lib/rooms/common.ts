import { NotificationType, type Prisma, type RegistrationStatus } from "@/generated/prisma";
import { createNotification } from "@/lib/notifications";
import type { StayEventContext } from "@/lib/rooms/stay";

export type Tx = Prisma.TransactionClient;

export class RoomError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const ACTIVE_STATUSES: RegistrationStatus[] = ["PENDING", "APPROVED", "CONFIRMED"];

export type RoomNotice = { userId: string; title: string; body: string; link: string };

type BookingSnapshot = { status: RegistrationStatus; registrationItems: Array<{ productId: string }> };

export function isActiveRegistration(registration: { status: RegistrationStatus }): boolean {
  return ACTIVE_STATUSES.includes(registration.status);
}

/** The room booker: active registration with a booked item of the group's room type. Roommates only need a ticket. */
export function holdsRoom(registration: BookingSnapshot, productId: string): boolean {
  return isActiveRegistration(registration) && registration.registrationItems.some((item) => item.productId === productId);
}

/** A group can only stay in a room that one of its members booked and (for manifests/assignments) paid. */
export function hasConfirmedRoomHolder(members: BookingSnapshot[], productId: string): boolean {
  return members.some((member) => member.status === "CONFIRMED" && holdsRoom(member, productId));
}

export function isCutoffPassed(cutoff: Date | null | undefined, now = new Date()): boolean {
  return Boolean(cutoff && now >= cutoff);
}

/** Row lock that serializes concurrent membership or assignment changes on one group/room. */
export async function lockRow(tx: Tx, table: "RoomGroup" | "HotelRoom", id: string) {
  if (table === "RoomGroup") {
    await tx.$queryRaw`SELECT id FROM "RoomGroup" WHERE id = ${id} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM "HotelRoom" WHERE id = ${id} FOR UPDATE`;
  }
}

export async function audit(
  tx: Tx,
  entry: {
    eventId: number;
    action: string;
    groupId?: string | null;
    actorUserId?: string | null;
    actorAdminId?: string | null;
    note?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await tx.roomAuditLog.create({ data: { ...entry, metadata: entry.metadata ?? {} } });
}

export async function loadStayContext(tx: Tx, eventId: number) {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      stayPolicy: true,
      roomGroupCutoffAt: true,
      products: {
        where: { type: "ACCOMMODATION" },
        select: {
          id: true,
          name: true,
          price: true,
          description: true,
          type: true,
          capacity: true,
          soldCount: true,
          minOccupants: true,
          maxOccupants: true,
        },
      },
    },
  });
  if (!event) throw new RoomError("Event not found", 404);
  return event satisfies StayEventContext;
}

export type RoomEventContext = Awaited<ReturnType<typeof loadStayContext>>;

export function roomTypeOf(event: RoomEventContext, productId: string) {
  const product = event.products.find((item) => item.id === productId);
  if (!product) throw new RoomError("Room type not found", 404);
  return product;
}

/** Notifications are best effort and sent after the transaction committed. */
export async function sendNotices(notices: RoomNotice[]) {
  await Promise.allSettled(
    notices.map((notice) =>
      createNotification(notice.userId, NotificationType.EVENT, notice.title, notice.body, notice.link),
    ),
  );
}

export function roomPageLink(eventId: number) {
  return `/events/${eventId}/room`;
}
