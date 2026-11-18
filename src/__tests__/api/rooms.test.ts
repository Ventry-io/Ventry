import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const p = vi.hoisted(() => {
  const model = (...methods: string[]) => Object.fromEntries(methods.map((method) => [method, vi.fn()]));
  const client: Record<string, unknown> = {
    user: model("findUnique"),
    event: model("findUnique", "update"),
    registration: model("findUnique", "findUniqueOrThrow", "findMany", "update"),
    registrationItem: model("findMany", "deleteMany"),
    registrationHistory: model("create"),
    payment: model("updateMany"),
    product: model("updateMany"),
    waitlistEntry: model("findMany", "deleteMany"),
    roomGroup: model("create", "findUniqueOrThrow", "findFirst", "findMany", "delete"),
    roomGroupMember: model("create", "findUnique", "findMany", "delete", "updateMany", "count"),
    roomInvitation: model("findUnique", "findFirst", "findMany", "create", "updateMany"),
    roomAssignment: model("findMany", "upsert", "delete"),
    hotelRoom: model("findFirst", "findMany"),
    roomAuditLog: model("create"),
    notification: model("create"),
    $queryRaw: vi.fn(),
  };
  client.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(client));
  return client as Record<string, Record<string, ReturnType<typeof vi.fn>>> & { $queryRaw: ReturnType<typeof vi.fn> };
});
const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma/prisma", () => ({ prisma: p }));
vi.mock("@/app/api/auth/auth", () => ({ auth: { api: { getSession: session } } }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/redis", () => ({ clearProductStock: vi.fn() }));
const sendMail = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
vi.mock("@/lib/mail", () => ({ sendMail }));

import { POST as invite } from "@/app/api/event/[id]/room/invitations/route";
import { POST as respond } from "@/app/api/event/[id]/room/invitations/[token]/route";
import { DELETE as leave, GET as view } from "@/app/api/event/[id]/room/route";
import { POST as groupAction } from "@/app/api/admin/event/[id]/room-groups/[groupId]/route";
import { GET as exportCsv } from "@/app/api/admin/event/[id]/rooms/export/route";
import { cancelRegistrationAndReleaseCapacity } from "@/lib/events/registration-capacity";

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 1000);
const stayContext = (cutoff: Date | null = null) => ({
  id: 1,
  name: "Con",
  startDate: new Date("2026-12-01T00:00:00Z"),
  endDate: new Date("2026-12-03T00:00:00Z"),
  roomGroupCutoffAt: cutoff,
  stayPolicy: {
    hotels: [
      {
        id: "h1",
        name: "Hotel A",
        isPrimary: true,
        roomTypeProductIds: ["double"],
        stayPolicy: {
          main: { checkIn: "2026-12-01T14:00:00Z", checkOut: "2026-12-03T10:00:00Z" },
          earlyArrival: { enabled: true, from: "2026-11-30T14:00:00Z" },
        },
      },
    ],
  },
  products: [
    { id: "double", name: "Double", price: 100, description: null, type: "ACCOMMODATION", capacity: 10, soldCount: 2, minOccupants: 2, maxOccupants: 2 },
    { id: "single", name: "Single", price: 80, description: null, type: "ACCOMMODATION", capacity: 10, soldCount: 1, minOccupants: 1, maxOccupants: 1 },
  ],
});
const roomBooking = [{ productId: "double", product: { type: "ACCOMMODATION" } }];
const ticketOnly = [{ productId: "ticket", product: { type: "TICKET" } }];
const holder = { status: "CONFIRMED", registrationItems: [{ productId: "double" }] };
const registrations: Record<string, unknown> = {};
let eventAuthRow: { ownerId: string | null; organizationId: string | null } = { ownerId: "adm", organizationId: null };
let cutoff: Date | null = null;

const req = (url: string, body?: unknown, method = body ? "POST" : "GET") =>
  new NextRequest(`https://local.dev:3443${url}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
const eventParams = { params: Promise.resolve({ id: "1" }) };
const tokenParams = (token = "tok") => ({ params: Promise.resolve({ id: "1", token }) });
const pendingInvitation = (overrides = {}) => ({
  id: "inv",
  status: "PENDING",
  expiresAt: FUTURE,
  groupId: "g1",
  inviteeRegistrationId: "reg-bob",
  invitee: { userId: "bob" },
  group: { eventId: 1 },
  ...overrides,
});
const twoPersonGroup = { productId: "double", assignment: null, members: [{ registration: { id: "reg-alice", userId: "alice", ...holder } }] };
const inviterGroup = (members = 1, invitations = 0) => ({
  productId: "double",
  assignment: null,
  members: [{ registration: holder }],
  _count: { members, invitations },
});

beforeEach(() => {
  vi.clearAllMocks();
  cutoff = null;
  eventAuthRow = { ownerId: "adm", organizationId: null };
  registrations.alice = { id: "reg-alice", status: "CONFIRMED", registrationItems: roomBooking, roomGroupMember: null };
  registrations.bob = { id: "reg-bob", status: "CONFIRMED", registrationItems: ticketOnly, roomGroupMember: null };
  p.event.findUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
    select.ownerId ? eventAuthRow : stayContext(cutoff),
  );
  p.registration.findUnique.mockImplementation(async ({ where }: { where: { userId_eventId?: { userId: string } } }) =>
    where.userId_eventId ? registrations[where.userId_eventId.userId] ?? null : null,
  );
  p.roomInvitation.updateMany.mockResolvedValue({ count: 1 });
  p.roomInvitation.findMany.mockResolvedValue([]);
  p.waitlistEntry.findMany.mockResolvedValue([]);
  p.roomInvitation.create.mockImplementation(async ({ data }: { data: { token: string; expiresAt: Date } }) => ({ token: data.token, expiresAt: data.expiresAt }));
  p.roomGroup.findUniqueOrThrow.mockResolvedValue(twoPersonGroup);
  session.mockResolvedValue({ user: { id: "bob" } });
});

describe("roommate invitations", () => {
  it("lets two attendees form a room group via invitation", async () => {
    session.mockResolvedValue({ user: { id: "alice" } });
    p.roomGroup.create.mockResolvedValue({ id: "g1" });
    p.roomGroup.findUniqueOrThrow.mockResolvedValueOnce(inviterGroup());
    p.user.findUnique.mockImplementation(async ({ where }: { where: { username?: string; id?: string } }) =>
      where.username === "bob" ? { id: "bob", email: "bob@ventry.test" } : { username: "alice" },
    );
    p.roomInvitation.findFirst.mockResolvedValue(null);

    const sent = await invite(req("/api/event/1/room/invitations", { username: "bob" }), eventParams);
    expect(sent.status).toBe(201);
    const { invitation } = await sent.json();
    expect(invitation.token).toMatch(/^[\w-]{43}$/);
    expect(p.roomGroup.create).toHaveBeenCalledWith({ data: { eventId: 1, productId: "double", members: { create: { registrationId: "reg-alice" } } } });
    expect(p.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "bob", link: `/events/1/room?invite=${invitation.token}` }) }));
    expect(sendMail).toHaveBeenCalledWith("bob@ventry.test", "Roommate invitation: Con", expect.stringContaining(`/events/1/room?invite=${invitation.token}`));
    expect(sendMail.mock.calls[0][2]).toContain("alice");

    session.mockResolvedValue({ user: { id: "bob" } });
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation({ token: invitation.token }));
    const accepted = await respond(req("/api/event/1/room/invitations/x", { action: "accept" }), tokenParams(invitation.token));
    expect(await accepted.json()).toEqual({ status: "ACCEPTED" });
    expect(p.roomInvitation.updateMany).toHaveBeenCalledWith({ where: { id: "inv", status: "PENDING" }, data: { status: "ACCEPTED", respondedAt: expect.any(Date) } });
    expect(p.roomGroupMember.create).toHaveBeenCalledWith({ data: { groupId: "g1", registrationId: "reg-bob" } });
    expect(p.$queryRaw).toHaveBeenCalled(); // group row locked before the capacity check
    expect(p.roomAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "INVITATION_ACCEPTED" }) });
  });

  it("hides the invitee lookup result behind one generic error", async () => {
    session.mockResolvedValue({ user: { id: "alice" } });
    registrations.alice = { ...(registrations.alice as object), roomGroupMember: { groupId: "g1" } };
    p.roomGroup.findUniqueOrThrow.mockResolvedValueOnce(inviterGroup());
    p.user.findUnique.mockResolvedValue({ id: "carol" });
    registrations.carol = null;
    const res = await invite(req("/api/event/1/room/invitations", { username: "carol" }), eventParams);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/No registered attendee/);
  });

  it("reserves a bed per open invitation and refuses once all beds are taken", async () => {
    session.mockResolvedValue({ user: { id: "alice" } });
    registrations.alice = { ...(registrations.alice as object), roomGroupMember: { groupId: "g1" } };
    // Double room: alice + one open invitation = 2 of 2 beds.
    p.roomGroup.findUniqueOrThrow.mockResolvedValueOnce(inviterGroup(1, 1));
    const res = await invite(req("/api/event/1/room/invitations", { username: "bob" }), eventParams);
    expect(res.status).toBe(409);
    expect(p.roomInvitation.create).not.toHaveBeenCalled();
  });

  it("refuses invitations from a single room: its only bed belongs to the booker", async () => {
    session.mockResolvedValue({ user: { id: "alice" } });
    registrations.alice = { ...(registrations.alice as object), roomGroupMember: { groupId: "g1" } };
    p.roomGroup.findUniqueOrThrow.mockResolvedValueOnce({ ...inviterGroup(), productId: "single", members: [{ registration: { status: "CONFIRMED", registrationItems: [{ productId: "single" }] } }] });
    const res = await invite(req("/api/event/1/room/invitations", { username: "bob" }), eventParams);
    expect(res.status).toBe(422);
    expect(p.roomInvitation.create).not.toHaveBeenCalled();
  });

  it("notifies the invitee live when an invitation is revoked", async () => {
    session.mockResolvedValue({ user: { id: "alice" } });
    registrations.alice = { ...(registrations.alice as object), roomGroupMember: { groupId: "g1" } };
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation());
    expect((await respond(req("/x", { action: "revoke" }), tokenParams())).status).toBe(200);
    expect(p.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "bob", body: expect.stringMatching(/withdrawn/) }) });
  });

  it("refuses invitations when nobody in the group booked the room", async () => {
    session.mockResolvedValue({ user: { id: "alice" } });
    registrations.alice = { ...(registrations.alice as object), roomGroupMember: { groupId: "g1" } };
    p.roomGroup.findUniqueOrThrow.mockResolvedValueOnce({ ...inviterGroup(), members: [{ registration: { status: "CONFIRMED", registrationItems: [] } }] });
    expect((await invite(req("/api/event/1/room/invitations", { username: "bob" }), eventParams)).status).toBe(409);
  });

  it("cannot be used by a different account", async () => {
    session.mockResolvedValue({ user: { id: "mallory" } });
    registrations.mallory = { id: "reg-mallory", status: "CONFIRMED", registrationItems: roomBooking, roomGroupMember: null };
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation());
    const res = await respond(req("/api/event/1/room/invitations/tok", { action: "accept" }), tokenParams());
    expect(res.status).toBe(404);
    expect(p.roomGroupMember.create).not.toHaveBeenCalled();
  });

  it("cannot be reused once answered and rejects expired links", async () => {
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation({ status: "ACCEPTED" }));
    expect((await respond(req("/x", { action: "accept" }), tokenParams())).status).toBe(409);

    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation({ expiresAt: PAST }));
    expect((await respond(req("/x", { action: "accept" }), tokenParams())).status).toBe(410);
    expect(p.roomGroupMember.create).not.toHaveBeenCalled();
  });

  it("lets only one of two concurrent accepts win", async () => {
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation());
    // Second request: the conditional status update matched nothing, the first already consumed the token.
    p.roomInvitation.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await respond(req("/x", { action: "accept" }), tokenParams());
    expect(res.status).toBe(409);
    expect(p.roomGroupMember.create).not.toHaveBeenCalled();
  });

  it("rejects an accept into a group that filled up meanwhile", async () => {
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation());
    p.roomGroup.findUniqueOrThrow.mockResolvedValue({
      ...twoPersonGroup,
      members: [...twoPersonGroup.members, { registration: { id: "reg-carol", userId: "carol", status: "CONFIRMED", registrationItems: [] } }],
    });
    const res = await respond(req("/x", { action: "accept" }), tokenParams());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/full/);
  });

  it("maps a lost unique-membership race to 409", async () => {
    const { Prisma } = await import("@/generated/prisma");
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation());
    p.roomGroupMember.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" }));
    expect((await respond(req("/x", { action: "accept" }), tokenParams())).status).toBe(409);
  });

  it("needs only a ticket to accept; an own room is released only after confirmation", async () => {
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation());
    expect((await respond(req("/x", { action: "accept" }), tokenParams())).status).toBe(200);
    expect(p.registrationItem.deleteMany).not.toHaveBeenCalled();

    vi.clearAllMocks();
    p.roomInvitation.updateMany.mockResolvedValue({ count: 1 });
    p.roomGroup.findUniqueOrThrow.mockResolvedValue(twoPersonGroup);
    registrations.bob = { id: "reg-bob", status: "CONFIRMED", registrationItems: [...ticketOnly, ...roomBooking], roomGroupMember: null };
    const unconfirmed = await respond(req("/x", { action: "accept" }), tokenParams());
    expect(unconfirmed.status).toBe(409);
    expect((await unconfirmed.json()).error).toMatch(/release/);
    expect(p.roomGroupMember.create).not.toHaveBeenCalled();

    p.registrationItem.findMany.mockResolvedValue([{ id: "item-room", productId: "double", priceAtBooking: 90, product: { name: "Double", capacity: 10 } }]);
    p.registration.findUniqueOrThrow.mockResolvedValue({ preferences: { productIds: ["ticket", "double"], accommodationId: "double" } });
    const accepted = await respond(req("/x", { action: "accept", releaseOwnRoom: true }), tokenParams());
    expect(accepted.status).toBe(200);
    expect(p.registrationItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["item-room"] } } });
    expect(p.product.updateMany).toHaveBeenCalledWith({ where: { id: "double", soldCount: { gte: 1 } }, data: { soldCount: { decrement: 1 } } });
    expect(p.registration.update).toHaveBeenCalledWith({ where: { id: "reg-bob" }, data: { preferences: { productIds: ["ticket"], accommodationId: null } } });
    expect(p.registrationHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "ROOM_RELEASED", notes: expect.stringMatching(/refund of 90 EUR/) }) });
    expect(p.roomGroupMember.create).toHaveBeenCalledWith({ data: { groupId: "g1", registrationId: "reg-bob" } });
  });

  it("rejects accepting into a group whose room booker left", async () => {
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation());
    p.roomGroup.findUniqueOrThrow.mockResolvedValue({ ...twoPersonGroup, members: [{ registration: { id: "reg-alice", userId: "alice", status: "CONFIRMED", registrationItems: [] } }] });
    expect((await respond(req("/x", { action: "accept" }), tokenParams())).status).toBe(409);
  });

  it("rejects inactive invitees", async () => {
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation());
    registrations.bob = { id: "reg-bob", status: "WAITLISTED", registrationItems: [], roomGroupMember: null };
    expect((await respond(req("/x", { action: "accept" }), tokenParams())).status).toBe(404);
  });

  it("blocks answering and leaving after the cutoff", async () => {
    cutoff = PAST;
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation());
    expect((await respond(req("/x", { action: "reject" }), tokenParams())).status).toBe(409);
    registrations.bob = { ...(registrations.bob as object), roomGroupMember: { groupId: "g1" } };
    expect((await leave(req("/api/event/1/room", undefined, "DELETE"), eventParams)).status).toBe(409);
    expect(p.roomGroupMember.delete).not.toHaveBeenCalled();
  });

  it("lets a member leave before the cutoff and deletes the empty group", async () => {
    registrations.bob = { ...(registrations.bob as object), roomGroupMember: { groupId: "g1" } };
    p.roomGroupMember.findUnique.mockResolvedValue({ groupId: "g1" });
    p.roomGroupMember.findMany.mockResolvedValue([]);
    expect((await leave(req("/api/event/1/room", undefined, "DELETE"), eventParams)).status).toBe(200);
    expect(p.roomGroup.delete).toHaveBeenCalledWith({ where: { id: "g1" } });
  });

  it("shows roommates by username only", async () => {
    p.roomInvitation.updateMany.mockResolvedValue({ count: 0 });
    p.registration.findUnique.mockResolvedValue({
      id: "reg-bob",
      status: "CONFIRMED",
      preferences: {},
      registrationItems: [{ productId: "ticket" }],
      roomGroupMember: {
        group: {
          id: "g1",
          productId: "double",
          assignment: null,
          members: [
            { joinedAt: new Date(), registration: { id: "reg-alice", status: "PENDING", preferences: { earlyArrival: true }, registrationItems: [{ productId: "double" }], user: { id: "alice", username: "alice" } } },
            { joinedAt: new Date(), registration: { id: "reg-bob", status: "CONFIRMED", preferences: {}, registrationItems: [{ productId: "ticket" }], user: { id: "bob", username: null } } },
          ],
          invitations: [],
        },
      },
      roomInvitationsReceived: [],
    });
    const body = await (await view(req("/api/event/1/room"), eventParams)).json();
    expect(body.group.members).toEqual([
      { name: "alice", isMe: false, roomHolder: true, joinedAt: expect.any(String) },
      { name: "Attendee", isMe: true, roomHolder: false, joinedAt: expect.any(String) },
    ]);
    expect(body.group.stay).toEqual({ checkIn: "2026-11-30T14:00:00.000Z", checkOut: "2026-12-03T10:00:00.000Z" });
    expect(body.group.occupancy).toBe("OK");
    expect(body.group.bedsReserved).toBe(2);
  });
});

describe("waitlist transitions", () => {
  it("drops the room waitlist entry of an attendee who accepts a bed in a roommate's room", async () => {
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation());
    p.waitlistEntry.findMany.mockResolvedValue([{ id: "wl-1", productId: "double" }]);
    p.registration.findUniqueOrThrow.mockResolvedValue({ preferences: { productIds: ["ticket", "double"], accommodationId: "double" } });

    expect((await respond(req("/x", { action: "accept" }), tokenParams())).status).toBe(200);
    expect(p.waitlistEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { registrationId: "reg-bob", product: { type: "ACCOMMODATION" } } }));
    expect(p.waitlistEntry.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["wl-1"] } } });
    expect(p.registration.update).toHaveBeenCalledWith({ where: { id: "reg-bob" }, data: { preferences: { productIds: ["ticket"], accommodationId: null } } });
    expect(p.roomAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "ROOM_WAITLIST_LEFT" }) });
  });

  it("keeps waitlists untouched when the invitation is declined", async () => {
    p.roomInvitation.findUnique.mockResolvedValue(pendingInvitation());
    expect((await respond(req("/x", { action: "reject" }), tokenParams())).status).toBe(200);
    expect(p.waitlistEntry.findMany).not.toHaveBeenCalled();
    expect(p.waitlistEntry.deleteMany).not.toHaveBeenCalled();
  });

  it("does not let an attendee who only waits for a room start a room group", async () => {
    session.mockResolvedValue({ user: { id: "bob" } }); // ticket booked, room only waitlisted: no room item
    const res = await invite(req("/api/event/1/room/invitations", { username: "alice" }), eventParams);
    expect(res.status).toBe(422);
    expect(p.roomGroup.create).not.toHaveBeenCalled();
  });

  it("refuses to invite a fully waitlisted registration with the generic error", async () => {
    session.mockResolvedValue({ user: { id: "alice" } });
    registrations.bob = { id: "reg-bob", status: "WAITLISTED", registrationItems: [], roomGroupMember: null };
    p.roomGroup.create.mockResolvedValue({ id: "g1" });
    p.roomGroup.findUniqueOrThrow.mockResolvedValueOnce(inviterGroup());
    p.user.findUnique.mockResolvedValue({ id: "bob", email: "bob@ventry.test" });
    const res = await invite(req("/api/event/1/room/invitations", { username: "bob" }), eventParams);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/No registered attendee/);
    expect(p.roomInvitation.create).not.toHaveBeenCalled();
  });
});

describe("cancellation", () => {
  it("removes the registration from its room group and voids its invitations", async () => {
    p.registration.findUnique.mockResolvedValue({ id: "reg-bob", eventId: 1, registrationItems: [] });
    p.roomGroupMember.findUnique.mockResolvedValue({ groupId: "g1" });
    p.roomGroupMember.findMany.mockResolvedValue([{ registration: { userId: "alice" } }]);
    const notices: Array<{ userId: string }> = [];
    await cancelRegistrationAndReleaseCapacity(p as never, "reg-bob", notices as never);
    expect(notices).toEqual([expect.objectContaining({ userId: "alice", body: expect.stringMatching(/cancelled/) })]);
    expect(p.roomInvitation.updateMany).toHaveBeenCalledWith({ where: { inviteeRegistrationId: "reg-bob", status: "PENDING" }, data: { status: "REVOKED", respondedAt: expect.any(Date) } });
    expect(p.roomGroupMember.delete).toHaveBeenCalledWith({ where: { registrationId: "reg-bob" } });
    expect(p.roomGroup.delete).not.toHaveBeenCalled();
    expect(p.roomAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "MEMBER_CANCELLED" }) });
  });
});

describe("admin room allocation", () => {
  const admin = (permissions: string[] = []) => ({
    id: "admin-user",
    email: "admin@example.com",
    isAdmin: true,
    adminProfile: {
      id: "adm",
      organizationMemberships: [{ organizationId: "org", permissions, accessLevel: "WRITE", organization: { ownerId: "owner" } }],
    },
  });
  const confirmedMember = (id: string, preferences = {}) => ({
    registration: { id, ticketId: 1, status: "CONFIRMED", preferences, userId: id, registrationItems: [{ productId: "double" }], user: { name: null, username: id } },
  });
  const group = { id: "g1", productId: "double", createdAt: new Date(), members: [confirmedMember("a", { earlyArrival: true }), confirmedMember("b")], assignment: null, _count: { invitations: 0 } };
  const room = { id: "r1", eventId: 1, hotelId: "h1", productId: "double", reference: "101", availableFrom: null, availableUntil: null };
  const assign = () => groupAction(req("/x", { action: "assign", roomId: "r1" }), { params: Promise.resolve({ id: "1", groupId: "g1" }) });

  beforeEach(() => {
    session.mockResolvedValue({ user: { id: "admin-user" } });
    p.user.findUnique.mockResolvedValue(admin());
    p.roomGroup.findFirst.mockResolvedValue(group);
    p.hotelRoom.findFirst.mockResolvedValue(room);
    p.roomAssignment.findMany.mockResolvedValue([]);
  });

  it("assigns a confirmed group for its merged stay and audits it", async () => {
    expect((await assign()).status).toBe(200);
    expect(p.roomAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ roomId: "r1", checkIn: new Date("2026-11-30T14:00:00Z"), checkOut: new Date("2026-12-03T10:00:00Z") }),
    }));
    expect(p.roomAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "ROOM_ASSIGNED", actorAdminId: "adm" }) });
  });

  it("prevents overbooking a room night", async () => {
    p.roomAssignment.findMany.mockResolvedValue([{ checkIn: new Date("2026-12-02T14:00:00Z"), checkOut: new Date("2026-12-04T10:00:00Z") }]);
    expect((await assign()).status).toBe(409);
    expect(p.roomAssignment.upsert).not.toHaveBeenCalled();
  });

  it("prevents more guests than the room holds and unconfirmed groups", async () => {
    p.roomGroup.findFirst.mockResolvedValue({ ...group, members: [...group.members, confirmedMember("c")] });
    expect((await assign()).status).toBe(422);
    p.roomGroup.findFirst.mockResolvedValue({ ...group, members: [{ registration: { ...confirmedMember("a").registration, status: "PENDING" } }] });
    expect((await assign()).status).toBe(422);
    expect(p.roomAssignment.upsert).not.toHaveBeenCalled();
  });

  it("requires an audit note for split and merge", async () => {
    const res = await groupAction(req("/x", { action: "merge", sourceGroupId: "g2", note: "" }), { params: Promise.resolve({ id: "1", groupId: "g1" }) });
    expect(res.status).toBe(422);
  });

  it("requires HOTEL_MANAGEMENT for the PII manifest export and audits it", async () => {
    eventAuthRow = { ownerId: "someone", organizationId: "org" };
    expect((await exportCsv(req("/api/admin/event/1/rooms/export"), eventParams)).status).toBe(403);

    p.user.findUnique.mockResolvedValue(admin(["HOTEL_MANAGEMENT"]));
    p.roomGroup.findMany.mockResolvedValue([
      { id: "g1", productId: "double", assignment: { room: { reference: "101" } }, members: [
        { registration: { ticketId: 5, status: "CONFIRMED", preferences: {}, registrationItems: [{ productId: "double" }], user: { legalName: "Ada Lovelace", name: "ada" } } },
        { registration: { ticketId: 6, status: "CANCELLED", preferences: {}, registrationItems: [], user: { legalName: "Gone", name: "gone" } } },
      ] },
    ]);
    p.registration.findMany.mockResolvedValue([]);
    const res = await exportCsv(req("/api/admin/event/1/rooms/export"), eventParams);
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Hotel A,101,Double,2026-12-01,2026-12-03,Ada Lovelace,no,no,5,g1");
    expect(csv).not.toContain("Gone");
    expect(p.roomAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "MANIFEST_EXPORTED", metadata: { hotelId: null, rows: 1 } }) });
  });
});
