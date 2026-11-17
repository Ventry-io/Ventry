import { prisma } from "@/lib/prisma/prisma";
import { normalizeStayPolicy } from "@/lib/events/accommodation";
import { detachMember, expireStaleInvitations } from "@/lib/rooms/attendee";
import {
  ACTIVE_STATUSES,
  audit,
  hasConfirmedRoomHolder,
  holdsRoom,
  isActiveRegistration,
  loadStayContext,
  lockRow,
  RoomError,
  type RoomEventContext,
  type RoomNotice,
  roomPageLink,
  roomTypeOf,
  type Tx,
} from "@/lib/rooms/common";
import {
  hotelForRoomType,
  mergeStays,
  occupancyOf,
  resolveMemberStay,
  staysOverlap,
  withinAvailability,
} from "@/lib/rooms/stay";

type Actor = { adminId?: string; userId?: string };

const memberRegistrationSelect = {
  id: true,
  ticketId: true,
  status: true,
  preferences: true,
  userId: true,
  registrationItems: { select: { productId: true } },
  user: { select: { name: true, username: true } },
} as const;

const groupSelect = {
  id: true,
  productId: true,
  createdAt: true,
  members: { orderBy: { joinedAt: "asc" as const }, select: { registration: { select: memberRegistrationSelect } } },
  assignment: { select: { roomId: true, checkIn: true, checkOut: true, note: true, room: { select: { reference: true } } } },
  _count: { select: { invitations: { where: { status: "PENDING" as const } } } },
} as const;

function eventLink(eventId: number) {
  return roomPageLink(eventId);
}

function memberNotices(userIds: string[], event: RoomEventContext, body: string): RoomNotice[] {
  return userIds.map((userId) => ({ userId, title: `Room update: ${event.name}`, body, link: eventLink(event.id) }));
}

// ---- Overview --------------------------------------------------------------------------

export async function getRoomOverview(eventId: number) {
  await expireStaleInvitations(prisma, eventId);
  const event = await loadStayContext(prisma, eventId);
  const [rooms, groups, unresolved] = await Promise.all([
    prisma.hotelRoom.findMany({
      where: { eventId },
      orderBy: { reference: "asc" },
      select: {
        id: true,
        hotelId: true,
        productId: true,
        reference: true,
        availableFrom: true,
        availableUntil: true,
        assignments: { select: { groupId: true, checkIn: true, checkOut: true, group: { select: { _count: { select: { members: true } } } } } },
      },
    }),
    prisma.roomGroup.findMany({ where: { eventId }, orderBy: { createdAt: "asc" }, select: groupSelect }),
    prisma.registration.findMany({
      where: {
        eventId,
        status: { in: ACTIVE_STATUSES },
        roomGroupMember: null,
        registrationItems: { some: { product: { type: "ACCOMMODATION" } } },
      },
      select: {
        id: true,
        ticketId: true,
        status: true,
        user: { select: { name: true, username: true } },
        registrationItems: { where: { product: { type: "ACCOMMODATION" } }, select: { productId: true } },
      },
    }),
  ]);

  const hotels = normalizeStayPolicy(event.stayPolicy, event.products, event.name, event.startDate, event.endDate).hotels;
  const hotelName = (hotelId: string) => hotels.find((hotel) => hotel.id === hotelId)?.name ?? hotelId;
  const maxOf = (productId: string) => event.products.find((product) => product.id === productId)?.maxOccupants ?? 1;
  const minOf = (productId: string) => event.products.find((product) => product.id === productId)?.minOccupants ?? 1;

  const groupViews = groups.map((group) => {
    const hotel = hotelForRoomType(event, group.productId);
    const stays = group.members.map((member) => resolveMemberStay(hotel, member.registration.preferences));
    const stay = mergeStays(stays);
    const members = group.members.map(({ registration }) => ({
      registrationId: registration.id,
      ticketId: registration.ticketId,
      name: registration.user.name || registration.user.username || "Attendee",
      status: registration.status,
      active: isActiveRegistration(registration),
      roomHolder: holdsRoom(registration, group.productId),
      confirmed: registration.status === "CONFIRMED",
    }));
    const roomHolders = members.filter((member) => member.roomHolder).length;
    const issues: string[] = [];
    if (!group.assignment) issues.push("UNASSIGNED");
    if (roomHolders === 0) issues.push("NO_ROOM_BOOKING");
    // Two members paid for a room of this type while sharing one: one booking can be released.
    if (roomHolders > 1) issues.push("EXTRA_ROOM_BOOKING");
    if (members.some((member) => !member.active)) issues.push("INACTIVE_MEMBER");
    if (members.some((member) => !member.confirmed)) issues.push("NOT_CONFIRMED");
    const occupancy = occupancyOf(members.length, minOf(group.productId), maxOf(group.productId));
    if (occupancy !== "OK") issues.push(`${occupancy}_OCCUPIED`);
    // Members changed after assignment and now need nights the room was not booked for.
    if (group.assignment && stay && (stay.checkIn < group.assignment.checkIn || stay.checkOut > group.assignment.checkOut)) {
      issues.push("STAY_OUTSIDE_ASSIGNMENT");
    }
    return {
      id: group.id,
      productId: group.productId,
      roomTypeName: event.products.find((product) => product.id === group.productId)?.name ?? null,
      hotelName: hotel?.name ?? null,
      members,
      pendingInvitations: group._count.invitations,
      stay,
      occupancy,
      assignment: group.assignment
        ? { roomId: group.assignment.roomId, reference: group.assignment.room.reference, checkIn: group.assignment.checkIn, checkOut: group.assignment.checkOut, note: group.assignment.note }
        : null,
      issues,
    };
  });

  const roomViews = rooms.map((room) => ({
    id: room.id,
    hotelId: room.hotelId,
    hotelName: hotelName(room.hotelId),
    productId: room.productId,
    roomTypeName: event.products.find((product) => product.id === room.productId)?.name ?? null,
    reference: room.reference,
    availableFrom: room.availableFrom,
    availableUntil: room.availableUntil,
    assignments: room.assignments.map((assignment) => ({
      groupId: assignment.groupId,
      checkIn: assignment.checkIn,
      checkOut: assignment.checkOut,
      occupants: assignment.group._count.members,
      occupancy: occupancyOf(assignment.group._count.members, minOf(room.productId), maxOf(room.productId)),
    })),
  }));

  return {
    cutoffAt: event.roomGroupCutoffAt,
    hotels: hotels.map((hotel) => ({ id: hotel.id, name: hotel.name })),
    roomTypes: event.products.map((product) => ({
      id: product.id,
      name: product.name,
      hotelId: hotelForRoomType(event, product.id)?.id ?? null,
      hotelName: hotelForRoomType(event, product.id)?.name ?? null,
      minOccupants: product.minOccupants,
      maxOccupants: product.maxOccupants,
      // Each room booking (one booker per room) counts against capacity; roommates do not.
      bookingCapacity: product.capacity,
      booked: product.soldCount,
      rooms: rooms.filter((room) => room.productId === product.id).length,
    })),
    rooms: roomViews,
    groups: groupViews,
    unresolved: unresolved.map((registration) => ({
      registrationId: registration.id,
      ticketId: registration.ticketId,
      name: registration.user.name || registration.user.username || "Attendee",
      status: registration.status,
      productId: registration.registrationItems[0]?.productId ?? null,
    })),
  };
}

// ---- Settings & rooms ------------------------------------------------------------------

export async function updateRoomSettings(eventId: number, actor: Actor, roomGroupCutoffAt: Date | null) {
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: eventId }, data: { roomGroupCutoffAt } });
    await audit(tx, { eventId, actorAdminId: actor.adminId, action: "SETTINGS_UPDATED", metadata: { roomGroupCutoffAt: roomGroupCutoffAt?.toISOString() ?? null } });
  });
}

export async function createRooms(
  eventId: number,
  actor: Actor,
  input: { hotelId: string; productId: string; references: string[]; availableFrom?: Date | null; availableUntil?: Date | null },
) {
  return prisma.$transaction(async (tx) => {
    const event = await loadStayContext(tx, eventId);
    const hotel = hotelForRoomType(event, input.productId);
    if (!hotel || hotel.id !== input.hotelId) throw new RoomError("Room type does not belong to this hotel.", 422);

    const created = await tx.hotelRoom.createMany({
      data: input.references.map((reference) => ({
        eventId,
        hotelId: input.hotelId,
        productId: input.productId,
        reference,
        availableFrom: input.availableFrom ?? null,
        availableUntil: input.availableUntil ?? null,
      })),
    });
    await audit(tx, { eventId, actorAdminId: actor.adminId, action: "ROOMS_CREATED", metadata: { hotelId: input.hotelId, productId: input.productId, references: input.references } });
    return created.count;
  });
}

export async function deleteRoom(eventId: number, actor: Actor, roomId: string) {
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "HotelRoom", roomId);
    const room = await tx.hotelRoom.findFirst({ where: { id: roomId, eventId }, select: { reference: true, _count: { select: { assignments: true } } } });
    if (!room) throw new RoomError("Room not found", 404);
    if (room._count.assignments > 0) throw new RoomError("Unassign the groups in this room first.", 409);
    await tx.hotelRoom.delete({ where: { id: roomId } });
    await audit(tx, { eventId, actorAdminId: actor.adminId, action: "ROOM_DELETED", metadata: { roomId, reference: room.reference } });
  });
}

// ---- Groups ----------------------------------------------------------------------------

async function loadGroup(tx: Tx, eventId: number, groupId: string) {
  await lockRow(tx, "RoomGroup", groupId);
  const group = await tx.roomGroup.findFirst({ where: { id: groupId, eventId }, select: groupSelect });
  if (!group) throw new RoomError("Room group not found", 404);
  return group;
}

export async function createGroupForRegistrations(eventId: number, actor: Actor, registrationIds: string[], note: string | null) {
  return prisma.$transaction(async (tx) => {
    const event = await loadStayContext(tx, eventId);
    const registrations = await tx.registration.findMany({
      where: { id: { in: registrationIds }, eventId },
      select: { ...memberRegistrationSelect, roomGroupMember: { select: { id: true } } },
    });
    if (registrations.length !== registrationIds.length) throw new RoomError("Registration not found", 404);
    if (registrations.some((registration) => registration.roomGroupMember)) throw new RoomError("A registration is already in a room group.", 409);

    const productId = registrations
      .flatMap((registration) => registration.registrationItems)
      .find((item) => event.products.some((product) => product.id === item.productId))?.productId;
    if (!productId || !registrations.some((registration) => holdsRoom(registration, productId))) {
      throw new RoomError("At least one registration needs an active room booking.", 422);
    }
    if (!registrations.every(isActiveRegistration)) throw new RoomError("All registrations must be active.", 422);
    if (registrations.length > roomTypeOf(event, productId).maxOccupants) throw new RoomError("Too many guests for this room type.", 422);

    const group = await tx.roomGroup.create({
      data: { eventId, productId, members: { create: registrationIds.map((registrationId) => ({ registrationId })) } },
      select: { id: true },
    });
    await audit(tx, { eventId, groupId: group.id, actorAdminId: actor.adminId, action: "GROUP_CREATED", note, metadata: { registrationIds } });
    return { groupId: group.id, notices: memberNotices(registrations.map((registration) => registration.userId), event, "The organizer placed you in a room group.") };
  });
}

export async function assignGroupToRoom(eventId: number, actor: Actor, groupId: string, roomId: string, note: string | null) {
  return prisma.$transaction(async (tx) => {
    const event = await loadStayContext(tx, eventId);
    // Lock order room -> group everywhere to avoid deadlocks between concurrent assignments.
    await lockRow(tx, "HotelRoom", roomId);
    const group = await loadGroup(tx, eventId, groupId);
    const room = await tx.hotelRoom.findFirst({ where: { id: roomId, eventId } });
    if (!room) throw new RoomError("Room not found", 404);
    if (room.productId !== group.productId) throw new RoomError("Room type of this room does not match the group.", 422);
    if (group.members.length === 0) throw new RoomError("Room group is empty.", 422);
    const memberRegistrations = group.members.map(({ registration }) => registration);
    if (!memberRegistrations.every((registration) => registration.status === "CONFIRMED") || !hasConfirmedRoomHolder(memberRegistrations, group.productId)) {
      throw new RoomError("Only groups whose members are all confirmed and who booked this room type can be assigned.", 422);
    }

    const roomType = roomTypeOf(event, group.productId);
    if (group.members.length > roomType.maxOccupants) {
      throw new RoomError(`This room holds at most ${roomType.maxOccupants} guests.`, 422);
    }

    const hotel = hotelForRoomType(event, group.productId);
    const stay = mergeStays(group.members.map(({ registration }) => resolveMemberStay(hotel, registration.preferences)));
    if (!stay) throw new RoomError("Stay dates could not be resolved for this group.", 422);
    if (!withinAvailability(stay, room.availableFrom, room.availableUntil)) {
      throw new RoomError("The room is not available for all nights of this stay.", 409);
    }

    const others = await tx.roomAssignment.findMany({
      where: { roomId, groupId: { not: groupId } },
      select: { checkIn: true, checkOut: true },
    });
    if (others.some((other) => staysOverlap(other, stay))) {
      throw new RoomError("The room is already booked for some of these nights.", 409);
    }

    const previous = group.assignment;
    await tx.roomAssignment.upsert({
      where: { groupId },
      create: { groupId, roomId, checkIn: stay.checkIn, checkOut: stay.checkOut, note, assignedByAdminId: actor.adminId },
      update: { roomId, checkIn: stay.checkIn, checkOut: stay.checkOut, note, assignedByAdminId: actor.adminId },
    });
    await audit(tx, {
      eventId,
      groupId,
      actorAdminId: actor.adminId,
      action: previous ? "ROOM_REASSIGNED" : "ROOM_ASSIGNED",
      note,
      metadata: { roomId, reference: room.reference, previousRoomId: previous?.roomId ?? null, checkIn: stay.checkIn.toISOString(), checkOut: stay.checkOut.toISOString() },
    });
    return { notices: memberNotices(group.members.map(({ registration }) => registration.userId), event, `Your hotel room is ${room.reference}.`) };
  });
}

export async function unassignGroup(eventId: number, actor: Actor, groupId: string, note: string | null) {
  return prisma.$transaction(async (tx) => {
    const event = await loadStayContext(tx, eventId);
    const group = await loadGroup(tx, eventId, groupId);
    if (!group.assignment) throw new RoomError("Room group has no room.", 409);
    await tx.roomAssignment.delete({ where: { groupId } });
    await audit(tx, { eventId, groupId, actorAdminId: actor.adminId, action: "ROOM_UNASSIGNED", note, metadata: { roomId: group.assignment.roomId, reference: group.assignment.room.reference } });
    return { notices: memberNotices(group.members.map(({ registration }) => registration.userId), event, "Your room assignment was removed by the organizer.") };
  });
}

export async function splitGroup(eventId: number, actor: Actor, groupId: string, registrationIds: string[], note: string) {
  return prisma.$transaction(async (tx) => {
    const event = await loadStayContext(tx, eventId);
    const group = await loadGroup(tx, eventId, groupId);
    const memberIds = new Set(group.members.map(({ registration }) => registration.id));
    if (!registrationIds.every((id) => memberIds.has(id)) || registrationIds.length >= memberIds.size) {
      throw new RoomError("Pick some, but not all, members of this group.", 422);
    }

    const created = await tx.roomGroup.create({ data: { eventId, productId: group.productId }, select: { id: true } });
    await tx.roomGroupMember.updateMany({ where: { groupId, registrationId: { in: registrationIds } }, data: { groupId: created.id } });
    await audit(tx, { eventId, groupId, actorAdminId: actor.adminId, action: "GROUP_SPLIT", note, metadata: { newGroupId: created.id, registrationIds } });
    await audit(tx, { eventId, groupId: created.id, actorAdminId: actor.adminId, action: "GROUP_SPLIT_CREATED", note, metadata: { fromGroupId: groupId, registrationIds } });
    return { groupId: created.id, notices: memberNotices(group.members.map(({ registration }) => registration.userId), event, "The organizer split your room group.") };
  });
}

export async function mergeGroups(eventId: number, actor: Actor, targetGroupId: string, sourceGroupId: string, note: string) {
  if (targetGroupId === sourceGroupId) throw new RoomError("Pick two different groups.", 422);
  return prisma.$transaction(async (tx) => {
    const event = await loadStayContext(tx, eventId);
    // Lock in id order so two opposite merges cannot deadlock.
    const [first, second] = [targetGroupId, sourceGroupId].sort();
    const groups = [await loadGroup(tx, eventId, first), await loadGroup(tx, eventId, second)];
    const target = groups.find((group) => group.id === targetGroupId);
    const source = groups.find((group) => group.id === sourceGroupId);
    if (!target || !source) throw new RoomError("Room group not found", 404);
    if (target.productId !== source.productId) throw new RoomError("Groups have different room types.", 422);
    if (target.assignment || source.assignment) throw new RoomError("Unassign rooms before merging groups.", 409);
    if (target.members.length + source.members.length > roomTypeOf(event, target.productId).maxOccupants) {
      throw new RoomError("Merged group would exceed the room occupancy.", 422);
    }

    await tx.roomGroupMember.updateMany({ where: { groupId: sourceGroupId }, data: { groupId: targetGroupId } });
    await tx.roomGroup.delete({ where: { id: sourceGroupId } });
    await audit(tx, { eventId, groupId: targetGroupId, actorAdminId: actor.adminId, action: "GROUP_MERGED", note, metadata: { sourceGroupId, movedRegistrationIds: source.members.map(({ registration }) => registration.id) } });
    const userIds = [...target.members, ...source.members].map(({ registration }) => registration.userId);
    return { notices: memberNotices(userIds, event, "The organizer merged your room group.") };
  });
}

export async function removeMemberAsAdmin(eventId: number, actor: Actor, groupId: string, registrationId: string, note: string) {
  return prisma.$transaction(async (tx) => {
    const event = await loadStayContext(tx, eventId);
    const group = await loadGroup(tx, eventId, groupId);
    const member = group.members.find(({ registration }) => registration.id === registrationId);
    if (!member) throw new RoomError("Registration is not in this group.", 404);
    await detachMember(tx, registrationId, { eventId, action: "MEMBER_REMOVED", actorAdminId: actor.adminId, note });
    return { notices: memberNotices(group.members.map(({ registration }) => registration.userId), event, "The organizer changed your room group.") };
  });
}

// ---- Reminders -------------------------------------------------------------------------

/** Notifies attendees whose room situation is unresolved: no group, too few roommates or open invitations. */
export async function remindUnresolved(eventId: number, actor: Actor) {
  const overview = await getRoomOverview(eventId);
  const event = await loadStayContext(prisma, eventId);
  const shareable = new Set(event.products.filter((product) => product.maxOccupants > 1).map((product) => product.id));

  const registrationIds = new Set<string>();
  for (const registration of overview.unresolved) {
    if (registration.productId && shareable.has(registration.productId)) registrationIds.add(registration.registrationId);
  }
  for (const group of overview.groups) {
    if (group.occupancy === "UNDER" || group.pendingInvitations > 0) {
      for (const member of group.members) registrationIds.add(member.registrationId);
    }
  }

  const registrations = await prisma.registration.findMany({ where: { id: { in: [...registrationIds] } }, select: { userId: true } });
  const deadline = event.roomGroupCutoffAt ? ` before ${event.roomGroupCutoffAt.toISOString().slice(0, 10)}` : "";
  const notices = memberNotices(
    registrations.map((registration) => registration.userId),
    event,
    `Please finish your room group${deadline}.`,
  );
  await audit(prisma, { eventId, actorAdminId: actor.adminId, action: "REMINDER_SENT", metadata: { recipients: notices.length } });
  return { notices };
}
