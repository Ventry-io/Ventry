import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma/prisma";
import type { RoomInvitationMailData } from "@/lib/rooms/mail";
import {
  ACTIVE_STATUSES,
  audit,
  holdsRoom,
  isActiveRegistration,
  isCutoffPassed,
  loadStayContext,
  lockRow,
  RoomError,
  type RoomNotice,
  roomPageLink,
  roomTypeOf,
  type Tx,
} from "@/lib/rooms/common";
import { hotelForRoomType, mergeStays, occupancyOf, resolveMemberStay } from "@/lib/rooms/stay";

export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

// Roommates only ever see usernames: no legal name, email or registration details.
const publicUser = { select: { id: true, username: true } } as const;
const displayName = (user: { username: string | null }) => user.username || "Attendee";

// Every room change notifies everyone whose room page shows it: that notification is the live refresh signal.
function groupNotices(userIds: string[], event: { id: number; name: string }, body: string): RoomNotice[] {
  return [...new Set(userIds)].map((userId) => ({ userId, title: `Room group update: ${event.name}`, body, link: roomPageLink(event.id) }));
}

/** Voids a registration's open incoming invitations. Returns the members of the inviting groups. */
async function voidIncomingInvitations(tx: Tx, registrationId: string, exceptId?: string) {
  const where = { inviteeRegistrationId: registrationId, status: "PENDING" as const, ...(exceptId ? { id: { not: exceptId } } : {}) };
  const open = await tx.roomInvitation.findMany({
    where,
    select: { group: { select: { members: { select: { registration: { select: { userId: true } } } } } } },
  });
  await tx.roomInvitation.updateMany({ where, data: { status: "REVOKED", respondedAt: new Date() } });
  return open.flatMap((invitation) => invitation.group.members.map((member) => member.registration.userId));
}

async function loadOwnRegistration(tx: Tx, userId: string, eventId: number) {
  const registration = await tx.registration.findUnique({
    where: { userId_eventId: { userId, eventId } },
    select: {
      id: true,
      status: true,
      registrationItems: { select: { productId: true, product: { select: { type: true } } } },
      roomGroupMember: { select: { groupId: true } },
    },
  });
  if (!registration || !ACTIVE_STATUSES.includes(registration.status)) {
    throw new RoomError("No active registration for this event", 404);
  }
  return registration;
}

function assertBeforeCutoff(cutoff: Date | null) {
  if (isCutoffPassed(cutoff)) {
    throw new RoomError("The room group deadline has passed. Contact the organizer for changes.", 409);
  }
}

/** Lazily flips overdue invitations to EXPIRED so every reader sees the real state. */
export async function expireStaleInvitations(db: Tx | typeof prisma, eventId: number, now = new Date()) {
  await db.roomInvitation.updateMany({
    where: { status: "PENDING", expiresAt: { lte: now }, group: { eventId } },
    data: { status: "EXPIRED" },
  });
}

export async function getRoomView(userId: string, eventId: number) {
  await expireStaleInvitations(prisma, eventId);
  const event = await loadStayContext(prisma, eventId);
  const registration = await prisma.registration.findUnique({
    where: { userId_eventId: { userId, eventId } },
    select: {
      id: true,
      status: true,
      preferences: true,
      registrationItems: { select: { productId: true } },
      roomGroupMember: {
        select: {
          group: {
            select: {
              id: true,
              productId: true,
              assignment: { select: { room: { select: { reference: true } } } },
              members: {
                orderBy: { joinedAt: "asc" },
                select: {
                  joinedAt: true,
                  registration: {
                    select: {
                      id: true,
                      status: true,
                      preferences: true,
                      registrationItems: { select: { productId: true } },
                      user: publicUser,
                    },
                  },
                },
              },
              invitations: {
                where: { status: "PENDING" },
                select: { token: true, expiresAt: true, invitee: { select: { user: publicUser } } },
              },
            },
          },
        },
      },
      roomInvitationsReceived: {
        where: { status: "PENDING" },
        select: {
          token: true,
          expiresAt: true,
          inviter: { select: { user: publicUser } },
          group: { select: { productId: true } },
        },
      },
    },
  });
  if (!registration) throw new RoomError("No registration for this event", 404);

  const bookedRoom = event.products.find((product) =>
    registration.registrationItems.some((item) => item.productId === product.id),
  );
  const group = registration.roomGroupMember?.group;
  const roomType = group ? event.products.find((product) => product.id === group.productId) : undefined;
  const hotel = group ? hotelForRoomType(event, group.productId) : null;

  return {
    cutoffAt: event.roomGroupCutoffAt,
    canChange: !isCutoffPassed(event.roomGroupCutoffAt),
    myStatus: registration.status,
    bookedRoom: bookedRoom
      ? { id: bookedRoom.id, name: bookedRoom.name, minOccupants: bookedRoom.minOccupants, maxOccupants: bookedRoom.maxOccupants }
      : null,
    group: group
      ? {
          id: group.id,
          roomType: roomType
            ? { id: roomType.id, name: roomType.name, minOccupants: roomType.minOccupants, maxOccupants: roomType.maxOccupants }
            : null,
          hotelName: hotel?.name ?? null,
          roomReference: group.assignment?.room.reference ?? null,
          stay: mergeStays(group.members.map((member) => resolveMemberStay(hotel, member.registration.preferences))),
          occupancy: roomType ? occupancyOf(group.members.length, roomType.minOccupants, roomType.maxOccupants) : null,
          // Open invitations hold a bed until they are answered or expire.
          bedsReserved: group.members.length + group.invitations.length,
          members: group.members.map((member) => ({
            name: displayName(member.registration.user),
            isMe: member.registration.id === registration.id,
            roomHolder: holdsRoom(member.registration, group.productId),
            joinedAt: member.joinedAt,
          })),
          pendingInvitations: group.invitations.map((invitation) => ({
            token: invitation.token,
            invitee: displayName(invitation.invitee.user),
            expiresAt: invitation.expiresAt,
          })),
        }
      : null,
    incomingInvitations: registration.roomInvitationsReceived.map((invitation) => ({
      token: invitation.token,
      from: displayName(invitation.inviter.user),
      roomTypeName: event.products.find((product) => product.id === invitation.group.productId)?.name ?? null,
      expiresAt: invitation.expiresAt,
    })),
  };
}

export async function inviteRoommate(userId: string, eventId: number, username: string) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const event = await loadStayContext(tx, eventId);
    assertBeforeCutoff(event.roomGroupCutoffAt);
    const me = await loadOwnRegistration(tx, userId, eventId);

    let groupId = me.roomGroupMember?.groupId;
    if (!groupId) {
      const roomItem = me.registrationItems.find((item) => item.product.type === "ACCOMMODATION");
      if (!roomItem) throw new RoomError("Book a room before inviting roommates.", 422);
      const created = await tx.roomGroup.create({
        data: { eventId, productId: roomItem.productId, members: { create: { registrationId: me.id } } },
      });
      groupId = created.id;
      await audit(tx, { eventId, groupId, actorUserId: userId, action: "GROUP_CREATED" });
    }

    await lockRow(tx, "RoomGroup", groupId);
    const group = await tx.roomGroup.findUniqueOrThrow({
      where: { id: groupId },
      select: {
        productId: true,
        assignment: { select: { id: true } },
        members: { select: { registration: { select: { status: true, registrationItems: { select: { productId: true } } } } } },
        _count: { select: { members: true, invitations: { where: { status: "PENDING", expiresAt: { gt: now } } } } },
      },
    });
    if (group.assignment) throw new RoomError("Your group already has a room. Contact the organizer for changes.", 409);
    if (!group.members.some((member) => holdsRoom(member.registration, group.productId))) {
      throw new RoomError("Your group has no booked room anymore. Book a room or contact the organizer.", 409);
    }
    const roomType = roomTypeOf(event, group.productId);
    if (roomType.maxOccupants < 2) throw new RoomError("This room type is for a single guest.", 422);
    if (group._count.members + group._count.invitations >= roomType.maxOccupants) {
      throw new RoomError("Your room group is full (including open invitations).", 409);
    }

    // Same message for every failure so the lookup does not reveal who attends the event.
    // Roommates only need an active registration (a ticket); the bed comes from the room booker.
    const notEligible = new RoomError("No registered attendee with this username for this event.", 404);
    const inviteeUser = await tx.user.findUnique({ where: { username }, select: { id: true, email: true } });
    if (!inviteeUser || inviteeUser.id === userId) throw notEligible;
    const invitee = await tx.registration.findUnique({
      where: { userId_eventId: { userId: inviteeUser.id, eventId } },
      select: {
        id: true,
        status: true,
        registrationItems: { select: { productId: true } },
        roomGroupMember: { select: { groupId: true } },
      },
    });
    if (!invitee || !isActiveRegistration(invitee)) throw notEligible;
    if (invitee.roomGroupMember?.groupId === groupId) throw new RoomError("This attendee is already in your group.", 409);

    const duplicate = await tx.roomInvitation.findFirst({
      where: { groupId, inviteeRegistrationId: invitee.id, status: "PENDING", expiresAt: { gt: now } },
      select: { id: true },
    });
    if (duplicate) throw new RoomError("This attendee already has an open invitation.", 409);

    const ttlEnd = new Date(now.getTime() + INVITATION_TTL_MS);
    const cutoff = event.roomGroupCutoffAt;
    const invitation = await tx.roomInvitation.create({
      data: {
        token: randomBytes(32).toString("base64url"),
        groupId,
        inviterRegistrationId: me.id,
        inviteeRegistrationId: invitee.id,
        expiresAt: cutoff && cutoff < ttlEnd ? cutoff : ttlEnd,
      },
      select: { token: true, expiresAt: true },
    });
    await audit(tx, { eventId, groupId, actorUserId: userId, action: "INVITATION_SENT", metadata: { inviteeRegistrationId: invitee.id } });

    const link = `${roomPageLink(eventId)}?invite=${invitation.token}`;
    const inviterName = (await tx.user.findUnique({ where: { id: userId }, select: { username: true } }))?.username || "An attendee";
    const notices: RoomNotice[] = [
      {
        userId: inviteeUser.id,
        title: `Roommate invitation: ${event.name}`,
        body: `${inviterName} invited you to share a hotel room. Accept or decline on the room page.`,
        link,
      },
    ];
    const mail: RoomInvitationMailData = {
      to: inviteeUser.email,
      inviterName,
      eventName: event.name,
      roomTypeName: roomType.name,
      link,
      expiresAt: invitation.expiresAt,
    };
    return { invitation, notices, mail };
  });
}

export type InvitationAction = "accept" | "reject" | "revoke";

export async function respondToInvitation(
  userId: string,
  eventId: number,
  token: string,
  action: InvitationAction,
  options: { releaseOwnRoom?: boolean } = {},
) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const invitation = await tx.roomInvitation.findUnique({
      where: { token },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        groupId: true,
        inviteeRegistrationId: true,
        invitee: { select: { userId: true } },
        group: { select: { eventId: true } },
      },
    });
    if (!invitation || invitation.group.eventId !== eventId) throw new RoomError("Invitation not found", 404);

    const event = await loadStayContext(tx, eventId);
    assertBeforeCutoff(event.roomGroupCutoffAt);
    const me = await loadOwnRegistration(tx, userId, eventId);

    // Revoke: any current group member. Accept/reject: only the invited account.
    const allowed = action === "revoke" ? me.roomGroupMember?.groupId === invitation.groupId : me.id === invitation.inviteeRegistrationId;
    if (!allowed) throw new RoomError("Invitation not found", 404);

    await lockRow(tx, "RoomGroup", invitation.groupId);
    if (invitation.status !== "PENDING") throw new RoomError(`Invitation is already ${invitation.status.toLowerCase()}.`, 409);
    if (invitation.expiresAt <= now) throw new RoomError("Invitation has expired.", 410);

    const group = await tx.roomGroup.findUniqueOrThrow({
      where: { id: invitation.groupId },
      select: {
        productId: true,
        assignment: { select: { id: true } },
        members: { select: { registration: { select: { id: true, userId: true, status: true, registrationItems: { select: { productId: true } } } } } },
      },
    });

    const ownsRoom = me.registrationItems.some((item) => item.product.type === "ACCOMMODATION");
    if (action === "accept") {
      if (!group.members.some(({ registration }) => holdsRoom(registration, group.productId))) {
        throw new RoomError("This group no longer has a booked room.", 409);
      }
      if (ownsRoom && !options.releaseOwnRoom) {
        throw new RoomError("You already booked a room. Confirm that you release it to accept this invitation.", 409);
      }
      if (me.roomGroupMember) {
        const others = await tx.roomGroupMember.count({ where: { groupId: me.roomGroupMember.groupId, registrationId: { not: me.id } } });
        if (others > 0) throw new RoomError("Leave your current room group first.", 409);
      }
      if (group.assignment) throw new RoomError("This group already has a room. Ask the organizer to add you.", 409);
      if (group.members.length >= roomTypeOf(event, group.productId).maxOccupants) {
        throw new RoomError("This room group is already full.", 409);
      }
    }

    const nextStatus = action === "accept" ? "ACCEPTED" : action === "reject" ? "REJECTED" : "REVOKED";
    // Conditional update makes the token single-use even if two requests pass the checks above.
    const updated = await tx.roomInvitation.updateMany({
      where: { id: invitation.id, status: "PENDING" },
      data: { status: nextStatus, respondedAt: now },
    });
    if (updated.count === 0) throw new RoomError("Invitation was already answered.", 409);

    let releasedProductIds: string[] = [];
    const notices: RoomNotice[] = [];
    if (action === "accept") {
      // Leaving a group where the attendee was alone deletes it (with its pending invitations).
      if (me.roomGroupMember) {
        const left = await detachMember(tx, me.id, { eventId, actorUserId: userId, action: "MEMBER_LEFT" });
        notices.push(...groupNotices(left.orphanedInviteeUserIds, event, "A roommate invitation you received was withdrawn."));
      }
      if (ownsRoom) releasedProductIds = await releaseOwnRoom(tx, me.id, eventId, userId);
      await leaveRoomWaitlists(tx, me.id, eventId, userId);
      await tx.roomGroupMember.create({ data: { groupId: invitation.groupId, registrationId: me.id } });
      const otherInviters = await voidIncomingInvitations(tx, me.id, invitation.id);
      notices.push(...groupNotices(otherInviters, event, "An attendee you invited joined another room. The invitation was withdrawn."));
    }
    await audit(tx, { eventId, groupId: invitation.groupId, actorUserId: userId, action: `INVITATION_${nextStatus}` });

    if (action === "revoke") {
      notices.push(...groupNotices([invitation.invitee.userId], event, "A roommate invitation you received was withdrawn."));
    }
    const otherMembers = group.members.map((member) => member.registration.userId).filter((memberUserId) => memberUserId !== userId);
    const memberBody = {
      accept: "Your roommate invitation was accepted.",
      reject: "Your roommate invitation was declined.",
      revoke: "An open roommate invitation was revoked.",
    }[action];
    notices.push(...groupNotices(otherMembers, event, memberBody));
    return { status: nextStatus, notices, releasedProductIds };
  });
}

/**
 * Gives up the attendee's own room booking to join someone else's room: removes the room item,
 * returns the room to stock and records it. Payments stay untouched; the history entry flags the refund.
 * Returns product ids whose stock cache must be cleared after commit.
 */
async function releaseOwnRoom(tx: Tx, registrationId: string, eventId: number, userId: string) {
  const items = await tx.registrationItem.findMany({
    where: { registrationId, product: { type: "ACCOMMODATION" } },
    select: { id: true, productId: true, priceAtBooking: true, product: { select: { name: true, capacity: true } } },
  });
  if (items.length === 0) return [];

  await tx.registrationItem.deleteMany({ where: { id: { in: items.map((item) => item.id) } } });
  for (const item of items) {
    await tx.product.updateMany({ where: { id: item.productId, soldCount: { gte: 1 } }, data: { soldCount: { decrement: 1 } } });
  }

  const released = new Set(items.map((item) => item.productId));
  await dropRoomPreferences(tx, registrationId, released);

  const paid = items.reduce((sum, item) => sum + item.priceAtBooking, 0);
  await tx.registrationHistory.create({
    data: {
      registrationId,
      action: "ROOM_RELEASED",
      changes: [{ label: "Room", old: items.map((item) => item.product.name).join(", "), new: "Shared room (roommate invitation)" }],
      notes: paid > 0 ? `Room released to join a roommate. Check refund of ${paid} EUR.` : "Room released to join a roommate.",
    },
  });
  await audit(tx, { eventId, actorUserId: userId, action: "ROOM_RELEASED", metadata: { registrationId, productIds: [...released] } });

  return items.filter((item) => item.product.capacity !== null).map((item) => item.productId);
}

/** Removes released or abandoned room types from the stored booking choices. */
async function dropRoomPreferences(tx: Tx, registrationId: string, productIds: Set<string>) {
  const registration = await tx.registration.findUniqueOrThrow({ where: { id: registrationId }, select: { preferences: true } });
  const preferences = (registration.preferences ?? {}) as Record<string, unknown>;
  const chosen = Array.isArray(preferences.productIds) ? (preferences.productIds as string[]) : [];
  await tx.registration.update({
    where: { id: registrationId },
    data: {
      preferences: {
        ...preferences,
        accommodationId: null,
        productIds: chosen.filter((id) => !productIds.has(id)),
      } as Prisma.InputJsonValue,
    },
  });
}

/**
 * A bed in a roommate's room replaces any room the attendee still waited for. Without this, a later
 * waitlist booking would hand one person a second room and take it from the next person in line.
 */
async function leaveRoomWaitlists(tx: Tx, registrationId: string, eventId: number, userId: string) {
  const entries = await tx.waitlistEntry.findMany({
    where: { registrationId, product: { type: "ACCOMMODATION" } },
    select: { id: true, productId: true },
  });
  if (entries.length === 0) return;
  await tx.waitlistEntry.deleteMany({ where: { id: { in: entries.map((entry) => entry.id) } } });
  const productIds = entries.map((entry) => entry.productId);
  await dropRoomPreferences(tx, registrationId, new Set(productIds));
  await audit(tx, { eventId, actorUserId: userId, action: "ROOM_WAITLIST_LEFT", metadata: { registrationId, productIds } });
}

export async function leaveRoomGroup(userId: string, eventId: number) {
  return prisma.$transaction(async (tx) => {
    const event = await loadStayContext(tx, eventId);
    assertBeforeCutoff(event.roomGroupCutoffAt);
    const me = await loadOwnRegistration(tx, userId, eventId);
    if (!me.roomGroupMember) throw new RoomError("You are not in a room group.", 404);

    const result = await detachMember(tx, me.id, { eventId, actorUserId: userId, action: "MEMBER_LEFT" });
    return {
      notices: [
        ...groupNotices(result.remainingUserIds, event, "A roommate left your room group."),
        ...groupNotices(result.orphanedInviteeUserIds, event, "A roommate invitation you received was withdrawn."),
      ],
    };
  });
}

/**
 * Removes a registration from its room group (leave, cancellation, admin split).
 * Deletes the group when it becomes empty; its invitations and assignment cascade.
 */
export async function detachMember(
  tx: Tx,
  registrationId: string,
  context: { eventId: number; action: string; actorUserId?: string; actorAdminId?: string; note?: string },
) {
  const member = await tx.roomGroupMember.findUnique({ where: { registrationId }, select: { groupId: true } });
  if (!member) return { remainingUserIds: [] as string[], orphanedInviteeUserIds: [] as string[] };

  await lockRow(tx, "RoomGroup", member.groupId);
  await tx.roomGroupMember.delete({ where: { registrationId } });
  const remaining = await tx.roomGroupMember.findMany({
    where: { groupId: member.groupId },
    select: { registration: { select: { userId: true } } },
  });
  let orphanedInviteeUserIds: string[] = [];
  if (remaining.length === 0) {
    // The group's open invitations cascade away with it: their invitees must hear about it.
    const open = await tx.roomInvitation.findMany({
      where: { groupId: member.groupId, status: "PENDING" },
      select: { invitee: { select: { userId: true } } },
    });
    orphanedInviteeUserIds = open.map((invitation) => invitation.invitee.userId);
    await tx.roomGroup.delete({ where: { id: member.groupId } });
  }
  await audit(tx, {
    eventId: context.eventId,
    groupId: member.groupId,
    actorUserId: context.actorUserId,
    actorAdminId: context.actorAdminId,
    action: context.action,
    note: context.note,
    metadata: { registrationId, groupDeleted: remaining.length === 0 },
  });
  return { remainingUserIds: remaining.map((item) => item.registration.userId), orphanedInviteeUserIds };
}

/**
 * Called when a registration is cancelled: leaves its group and voids open invitations to it.
 * Returns the notices to send after commit.
 */
export async function releaseRoomGroupForCancelledRegistration(tx: Tx, registrationId: string, eventId: number) {
  const inviters = await voidIncomingInvitations(tx, registrationId);
  const result = await detachMember(tx, registrationId, { eventId, action: "MEMBER_CANCELLED" });
  if (inviters.length + result.remainingUserIds.length + result.orphanedInviteeUserIds.length === 0) return [];

  const event = { id: eventId, name: (await tx.event.findUnique({ where: { id: eventId }, select: { name: true } }))?.name ?? "Event" };
  return [
    ...groupNotices(result.remainingUserIds, event, "A roommate cancelled their registration and left your room group."),
    ...groupNotices(inviters, event, "An attendee you invited cancelled their registration. The invitation was withdrawn."),
    ...groupNotices(result.orphanedInviteeUserIds, event, "A roommate invitation you received was withdrawn."),
  ];
}
