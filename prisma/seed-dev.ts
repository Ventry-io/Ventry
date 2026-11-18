/**
 * Synthetic development data shaped like a real local database: individual and
 * organization admins with crew, simple and complex events, hotels with room
 * groups, payments, check-ins, community and support tickets.
 * All people, emails and addresses are invented (.test domain). Local use only.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/lib/bcrypt";
import type { createPrismaClient } from "../src/lib/prisma/client";
import type { Prisma } from "../src/generated/prisma";

type Db = ReturnType<typeof createPrismaClient>;

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const inDays = (days: number, hour = 0) => {
  const date = new Date(now + days * DAY);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};

/** Refuses anything that does not look like a local database (payments and mails are real elsewhere). */
export function assertLocalDatabase(url = process.env.DATABASE_URL ?? "") {
  const local = /^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1|postgres|db)(:\d+)?\//.test(url);
  if (!local || process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed development data: DATABASE_URL is not a local database.");
  }
}

type Persona = {
  key: string;
  name: string;
  username: string;
  legalName?: string;
  city?: string;
  bio?: string;
  pronouns?: string;
  emailVerified?: boolean;
  socialLinks?: Record<string, string>;
};

const PERSONAS: Persona[] = [
  { key: "orgOwner", name: "Olivia Orga", username: "olivia_orga", legalName: "Olivia Organisator", city: "Stuttgart" },
  { key: "crewSupport", name: "Sam Support", username: "sam_support", legalName: "Samuel Support", city: "Esslingen" },
  { key: "crewHotel", name: "Hanna Hotel", username: "hanna_hotel", legalName: "Hanna Herberge", city: "Ludwigsburg" },
  { key: "alex", name: "Alex", username: "alex_fox", legalName: "Alexander Beispiel", city: "Berlin", bio: "Fursuiter and coffee addict.", pronouns: "he/him", socialLinks: { telegram: "alex_fox_test" } },
  { key: "bea", name: "Bea", username: "bea_bunny", legalName: "Beatrice Muster", city: "Hamburg", pronouns: "she/her" },
  { key: "chris", name: "Chris", username: "chris_cat", legalName: "Christopher Probe", city: "München", bio: "First con!" },
  { key: "dana", name: "Dana", username: "dana_dragon", legalName: "Dana Testfrau", city: "Köln", pronouns: "they/them", socialLinks: { instagram: "dana_dragon_test" } },
  { key: "eli", name: "Eli", username: "eli_eagle", legalName: "Elias Exempel", city: "Leipzig" },
  { key: "finn", name: "Finn", username: "finn_wolf", legalName: "Finn Platzhalter", city: "Dresden" },
  { key: "gabi", name: "Gabi", username: "gabi_goat", legalName: "Gabriele Fiktiv", city: "Freiburg" },
  // Incomplete profile and unverified email: exercises the profile gate.
  { key: "newbie", name: "Newbie", username: "newbie_test", emailVerified: false },
];

const emailOf = (key: string) => `${key.toLowerCase()}@ventry.test`;

async function createPersonaUsers(db: Db, passwordHash: string) {
  const users: Record<string, { id: string }> = {};
  for (const persona of PERSONAS) {
    users[persona.key] = await db.user.create({
      data: {
        email: emailOf(persona.key),
        name: persona.name,
        username: persona.username,
        emailVerified: persona.emailVerified ?? true,
        bio: persona.bio,
        pronouns: persona.pronouns,
        socialLinks: persona.socialLinks ?? {},
        dateOfBirth: persona.legalName ? new Date("1996-05-17") : null,
        legalName: persona.legalName,
        country: persona.legalName ? "DE" : null,
        addressLine1: persona.legalName ? "Musterstraße 1" : null,
        addressCity: persona.city,
        addressPostalCode: persona.legalName ? "70173" : null,
        addressCountry: persona.legalName ? "DE" : null,
        accounts: { create: { providerId: "credential", password: passwordHash } },
      },
      select: { id: true },
    });
  }
  return users;
}

/** Keeps the env-configured dev logins (DEV_USER_ADMIN/PRIMARY/SECONDARY_*) from the original seed. */
async function createEnvUsers(db: Db) {
  const created: Record<string, { id: string; adminId?: string }> = {};
  for (const type of ["ADMIN", "PRIMARY", "SECONDARY"] as const) {
    const email = process.env[`DEV_USER_${type}_EMAIL`];
    const password = process.env[`DEV_USER_${type}_PASSWORD`];
    if (!email || !password) {
      console.warn(`⚠️ Missing DEV_USER_${type}_EMAIL/PASSWORD. Skipping ${type} login.`);
      continue;
    }
    // Seeding on top of an existing local DB: reuse the login instead of failing on the unique email.
    const existing = await db.user.findUnique({ where: { email }, select: { id: true, adminProfile: { select: { id: true } } } });
    if (existing) {
      created[type] = { id: existing.id, adminId: existing.adminProfile?.id };
      console.log(`👤 ${type} login reused: ${email}`);
      continue;
    }
    const user = await db.user.create({
      data: {
        email,
        name: `Dev ${type} User`,
        username: `dev_${type.toLowerCase()}`,
        isAdmin: type === "ADMIN",
        emailVerified: true,
        legalName: `Dev ${type} Legal`,
        country: "DE",
        addressLine1: "Devweg 1",
        addressCity: "Stuttgart",
        addressPostalCode: "70173",
        addressCountry: "DE",
        accounts: { create: { providerId: "credential", password: await hashPassword(password) } },
        adminProfile: type === "ADMIN" ? { create: { type: "INDIVIDUAL" } } : undefined,
      },
      select: { id: true, adminProfile: { select: { id: true } } },
    });
    created[type] = { id: user.id, adminId: user.adminProfile?.id };
    console.log(`👤 ${type} login: ${email}`);
  }
  return created;
}

function product(id: string, name: string, type: "TICKET" | "ADDON" | "ACCOMMODATION", price: number, order: number, extra: Partial<Prisma.ProductCreateWithoutEventInput> = {}) {
  return { id, name, type, price, order, description: `${name} (seed)`, ...extra };
}

function hotelPolicy(checkIn: Date, checkOut: Date) {
  return {
    main: { checkIn, checkOut },
    earlyArrival: { enabled: true, from: new Date(checkIn.getTime() - DAY), pricingMode: "AUTO" },
    lateDeparture: { enabled: true, until: new Date(checkOut.getTime() + DAY), pricingMode: "AUTO" },
  };
}

const location = (name: string, city: string) => ({
  name,
  address: "Messepiazza 1",
  city,
  state: "Baden-Württemberg",
  country: "Germany",
  postalCode: "70629",
});

type Booking = {
  userId: string;
  eventId: number;
  productIds: string[];
  status?: "PENDING" | "CONFIRMED" | "CANCELLED" | "APPROVED" | "WAITLISTED";
  preferences?: Record<string, unknown>;
  paid?: boolean;
};

/** Creates a registration with items, keeps Product.soldCount in sync and adds the Stripe payment. */
async function book(db: Db, booking: Booking) {
  const status = booking.status ?? "CONFIRMED";
  const products = await db.product.findMany({ where: { id: { in: booking.productIds } } });
  const active = status !== "CANCELLED" && status !== "WAITLISTED";
  const registration = await db.registration.create({
    data: {
      userId: booking.userId,
      eventId: booking.eventId,
      status,
      preferences: {
        productId: products.find((item) => item.type === "TICKET")?.id,
        productIds: booking.productIds,
        accommodationId: products.find((item) => item.type === "ACCOMMODATION")?.id,
        showOnAttendees: true,
        ...booking.preferences,
      },
      registrationItems: active
        ? { create: products.map((item) => ({ productId: item.id, priceAtBooking: item.price })) }
        : undefined,
      waitlistEntries: status === "WAITLISTED" ? { create: products.map((item) => ({ productId: item.id })) } : undefined,
    },
  });
  if (active) {
    await db.product.updateMany({ where: { id: { in: booking.productIds } }, data: { soldCount: { increment: 1 } } });
  }
  const amount = products.reduce((sum, item) => sum + item.price, 0);
  if (amount > 0 && (booking.paid ?? status === "CONFIRMED")) {
    await db.payment.create({
      data: { userId: booking.userId, registrationId: registration.id, amount, currency: "EUR", paymentStatus: "COMPLETED", paymentProvider: "STRIPE" },
    });
  }
  return registration;
}

const BADGE_ELEMENTS = [
  { x: 6, y: 12, id: "photo", type: "photo", align: "center", color: "#111827", label: "Photo", shape: "square", width: 28, height: 43, fontSize: 10, fontWeight: "600" },
  { x: 38, y: 18, id: "name", type: "displayName", align: "left", color: "#111827", label: "Name", shape: "square", width: 40, height: 14, fontSize: 17, fontWeight: "700" },
  { x: 38, y: 36, id: "ticket", type: "ticketId", align: "left", color: "#475569", label: "Ticket Number", shape: "square", width: 28, height: 8, fontSize: 9, fontWeight: "600" },
  { x: 38, y: 47, id: "tier", type: "ticketTier", align: "left", color: "#334155", label: "Ticket Tier", shape: "square", width: 32, height: 8, fontSize: 8, fontWeight: "600" },
  { x: 76, y: 61, id: "qr", type: "qrCode", align: "center", color: "#111827", label: "QR Code", shape: "square", width: 17, height: 27, fontSize: 8, fontWeight: "600" },
  { x: 6, y: 4, id: "event", type: "eventName", align: "center", color: "#334155", label: "Event", shape: "square", width: 88, height: 8, fontSize: 8, fontWeight: "700" },
];

export async function seedDevelopmentData(db: Db) {
  assertLocalDatabase();
  if (await db.user.findUnique({ where: { email: emailOf("orgOwner") }, select: { id: true } })) {
    console.log("ℹ️ Development seed already present. Run `npx prisma migrate reset` for a fresh copy.");
    return;
  }

  const env = await createEnvUsers(db);
  const passwordHash = await hashPassword(process.env.DEV_SEED_PASSWORD || "ventry-dev-password");
  const u = await createPersonaUsers(db, passwordHash);

  // ---- Admins, organization, crew -------------------------------------------------------
  const ownerAdmin = await db.admin.create({ data: { userId: u.orgOwner.id, type: "ORGANIZATION" } });
  const supportAdmin = await db.admin.create({ data: { userId: u.crewSupport.id } });
  const hotelAdmin = await db.admin.create({ data: { userId: u.crewHotel.id } });
  await db.user.updateMany({ where: { id: { in: [u.orgOwner.id, u.crewSupport.id, u.crewHotel.id] } }, data: { isAdmin: true } });
  const individualAdminId = env.ADMIN?.adminId ?? ownerAdmin.id;

  const org = await db.adminOrganization.create({
    data: {
      name: "Ventry Test Crew",
      slug: "ventry-test-crew",
      description: "Organization for local testing",
      ownerId: ownerAdmin.id,
      crewResources: [{ id: "seed-resource", title: "Shift schedule", url: "https://example.com/shift-schedule" }],
      departments: { create: [{ name: "Security", planning: "Night shift: 2 people" }, { name: "Hotel Desk", planning: "Check-in 14–20h" }] },
    },
    include: { departments: true },
  });
  const department = (name: string) => org.departments.find((item) => item.name === name)?.id;
  const memberships: Prisma.AdminOrganizationMembershipCreateManyInput[] = [
    { adminId: ownerAdmin.id, organizationId: org.id, accessLevel: "WRITE", role: "Head of Organization" },
    { adminId: supportAdmin.id, organizationId: org.id, permissions: ["SUPPORT_TICKETS"], accessLevel: "READ", departmentId: department("Security"), role: "Support" },
    { adminId: hotelAdmin.id, organizationId: org.id, permissions: ["HOTEL_MANAGEMENT", "EVENT_APPROVAL"], accessLevel: "WRITE", departmentId: department("Hotel Desk"), role: "Hotel lead" },
  ];
  // The env dev admin owns its own events and is a full member of the org.
  if (env.ADMIN?.adminId) {
    memberships.push({ adminId: env.ADMIN.adminId, organizationId: org.id, permissions: ["COMMUNITY", "SUPPORT_TICKETS", "EVENT_APPROVAL", "STRIPE_FINANCES", "HOTEL_MANAGEMENT"], accessLevel: "WRITE" });
  }
  await db.adminOrganizationMembership.createMany({ data: memberships });
  await db.adminInvitation.createMany({
    data: [
      { organizationId: org.id, invitedEmail: "pending-crew@ventry.test", invitedByAdminId: ownerAdmin.id, permissions: ["COMMUNITY"], accessLevel: "READ", status: "PENDING", token: randomBytes(16).toString("hex"), expiresAt: inDays(7) },
      { organizationId: org.id, invitedEmail: emailOf("crewSupport"), invitedAdminId: supportAdmin.id, invitedByAdminId: ownerAdmin.id, permissions: ["SUPPORT_TICKETS"], accessLevel: "READ", status: "ACCEPTED", token: randomBytes(16).toString("hex"), expiresAt: inDays(-20) },
    ],
  });

  // ---- 1+2: drafts (individual owner) -----------------------------------------------------
  await db.event.create({
    data: {
      name: "Ventry Launch Meetup",
      description: "Small draft meetup with a single ticket.",
      startDate: inDays(40, 9),
      endDate: inDays(40, 17),
      ownerId: individualAdminId,
      location: { create: location("Ventry HQ", "Stuttgart") },
      products: { create: [product("seed-meetup-ticket", "Standard Ticket", "TICKET", 49, 0)] },
    },
  });
  await db.event.create({
    data: {
      name: "Workshop Weekend (draft)",
      description: "Draft with add-ons and a future registration start.",
      startDate: inDays(60, 10),
      endDate: inDays(61, 10),
      registrationOpensAt: inDays(20),
      ownerId: individualAdminId,
      location: { create: location("Werkstatt", "Esslingen") },
      products: { create: [product("seed-ws-ticket", "Workshop Ticket", "TICKET", 0, 0), product("seed-ws-kit", "Material Kit", "ADDON", 59, 1), product("seed-ws-lunch", "Lunch", "ADDON", 29, 2)] },
    },
  });

  // ---- 3: published org event with custom fields, schedule, add-ons ----------------------
  const day = await db.event.create({
    data: {
      name: "Community Day",
      description: "One and a half days with tickets, add-ons, custom fields and schedule.",
      status: "PUBLISHED",
      startDate: inDays(14, 10),
      endDate: inDays(15, 16),
      registrationOpensAt: inDays(-10),
      ownerId: ownerAdmin.id,
      organizationId: org.id,
      customFields: [
        { id: "diet", type: "select", label: "Food preference", options: ["Mixed", "Vegetarian", "Vegan"], required: true },
        { id: "tshirt", type: "text", label: "T-shirt size", required: false },
      ],
      schedule: [
        { id: "seed-open", title: "Opening", startTime: "10:00", endTime: "11:00", location: "Main Stage", description: "Welcome" },
        { id: "seed-panel", title: "Panel", startTime: "14:00", endTime: "15:00", location: "Room A", description: "" },
      ],
      location: { create: location("Kulturhaus", "Stuttgart") },
      products: {
        create: [
          product("seed-day-regular", "Regular", "TICKET", 100, 0, { capacity: 100 }),
          product("seed-day-sponsor", "Sponsor", "TICKET", 150, 1, { capacity: 100 }),
          product("seed-day-shirt", "T-Shirt", "ADDON", 20, 2, { capacity: 100 }),
          product("seed-day-badge", "Pin Set", "ADDON", 20, 3, { capacity: 100 }),
          product("seed-day-dinner", "Dinner", "ADDON", 20, 4, { capacity: 100 }),
        ],
      },
    },
  });
  const dayRegs = [
    await book(db, { userId: u.alex.id, eventId: day.id, productIds: ["seed-day-sponsor", "seed-day-shirt"], preferences: { customFieldsData: { diet: "Vegan", tshirt: "L" } } }),
    await book(db, { userId: u.bea.id, eventId: day.id, productIds: ["seed-day-regular"], preferences: { customFieldsData: { diet: "Mixed" } } }),
  ];

  // ---- 4: multi-day convention with hotels and roommates ---------------------------------
  const checkIn = inDays(30, 14);
  const checkOut = inDays(34, 10);
  const con = await db.event.create({
    data: {
      name: "Ventry Con",
      description: "Four-day convention with two hotels, room groups, community and badges.",
      status: "PUBLISHED",
      startDate: inDays(30, 12),
      endDate: inDays(34, 12),
      registrationOpensAt: inDays(-30),
      paymentDeadline: inDays(20),
      requiresHotel: false,
      communityEnabled: true,
      roomGroupCutoffAt: inDays(21),
      ownerId: ownerAdmin.id,
      organizationId: org.id,
      customFields: [
        { id: "fursuiter", type: "boolean", label: "I'm a fursuiter", required: false },
        { id: "food", type: "select", label: "Choose food", options: ["Mixed", "Vegetarian", "Vegan"], required: true },
        { id: "rules", type: "boolean", label: "I accept the house rules", required: true },
      ],
      schedule: [
        { id: "seed-con-open", title: "Opening", startTime: "19:00", endTime: "20:00", location: "Main Stage", description: "Opening ceremony" },
        { id: "seed-con-ops", title: "ConOps", startTime: "00:00", endTime: "23:59", location: "ConOps", description: "" },
        { id: "seed-con-close", title: "Closing", startTime: "19:00", endTime: "20:00", location: "Main Stage", description: "Closing ceremony" },
      ],
      stayPolicy: {
        version: 2,
        mainLocationIsAccommodation: true,
        allowOverflowHotels: true,
        samePolicyAcrossHotels: true,
        hotels: [
          { id: "seed-hotel-main", name: "Main Hotel", isPrimary: true, roomTypeProductIds: ["seed-room-double", "seed-room-single"], stayPolicy: hotelPolicy(checkIn, checkOut) },
          { id: "seed-hotel-overflow", name: "Overflow Hotel", isPrimary: false, roomTypeProductIds: ["seed-room-triple"], stayPolicy: hotelPolicy(checkIn, checkOut) },
        ],
      },
      location: { create: location("Congress Center", "Stuttgart") },
      products: {
        create: [
          product("seed-con-basic", "Basic", "TICKET", 100, 0, { capacity: 100 }),
          product("seed-con-sponsor", "Sponsor", "TICKET", 150, 1, { capacity: 100 }),
          product("seed-con-shirt", "Con Shirt", "ADDON", 20, 2, { capacity: 100 }),
          product("seed-con-dinner", "Banquet", "ADDON", 20, 3, { capacity: 100 }),
          // capacity = bookable rooms (one booker per room), min/maxOccupants = beds per room.
          product("seed-room-double", "Double Room", "ACCOMMODATION", 180, 4, { capacity: 5, minOccupants: 2, maxOccupants: 2 }),
          product("seed-room-single", "Single Room", "ACCOMMODATION", 160, 5, { capacity: 1, minOccupants: 1, maxOccupants: 1, allowWaitlist: true }),
          product("seed-room-triple", "Triple Room", "ACCOMMODATION", 210, 6, { capacity: 2, minOccupants: 2, maxOccupants: 3 }),
        ],
      },
      badgeTemplates: {
        create: [
          { name: "Con Badge", isDefault: true, elements: BADGE_ELEMENTS, background: { color: "#f8fafc", fit: "cover", positionX: 50, positionY: 50, fallbackPhotoUrls: [] } },
          { name: "Con Badge (dark)", elements: BADGE_ELEMENTS.map((item) => ({ ...item, color: "#f8fafc" })), background: { color: "#111827", fit: "cover", positionX: 50, positionY: 50, fallbackPhotoUrls: [] } },
        ],
      },
    },
  });
  const stay = (early = false, late = false) => ({ needsHotel: true, earlyArrival: early, lateDeparture: late, customFieldsData: { food: "Vegetarian", rules: true, fursuiter: early } });
  const conAlex = await book(db, { userId: u.alex.id, eventId: con.id, productIds: ["seed-con-sponsor", "seed-con-shirt", "seed-room-double"], preferences: stay(true, true) });
  // Roommates need only a ticket: Bea shares the double Alex booked.
  const conBea = await book(db, { userId: u.bea.id, eventId: con.id, productIds: ["seed-con-basic"], preferences: stay(true) });
  const conChris = await book(db, { userId: u.chris.id, eventId: con.id, productIds: ["seed-con-basic", "seed-room-double"], preferences: stay() });
  const conDana = await book(db, { userId: u.dana.id, eventId: con.id, productIds: ["seed-con-basic", "seed-room-triple"], preferences: stay(false, true) });
  const conEli = await book(db, { userId: u.eli.id, eventId: con.id, productIds: ["seed-con-basic", "seed-room-triple"], preferences: stay() });
  await book(db, { userId: u.finn.id, eventId: con.id, productIds: ["seed-con-basic", "seed-room-single"], preferences: stay() });
  await book(db, { userId: u.gabi.id, eventId: con.id, productIds: ["seed-con-basic", "seed-room-double"], status: "PENDING", preferences: stay() });
  await book(db, { userId: u.newbie.id, eventId: con.id, productIds: ["seed-con-basic"], status: "CANCELLED" });
  if (env.PRIMARY) await book(db, { userId: env.PRIMARY.id, eventId: con.id, productIds: ["seed-con-basic", "seed-room-double"], preferences: stay() });

  // Physical rooms: main hotel 101–104 (double), 110 (single), overflow 201–202 (triple).
  const rooms = await Promise.all(
    [
      ["101", "seed-hotel-main", "seed-room-double"],
      ["102", "seed-hotel-main", "seed-room-double"],
      ["103", "seed-hotel-main", "seed-room-double"],
      ["110", "seed-hotel-main", "seed-room-single"],
      ["201", "seed-hotel-overflow", "seed-room-triple"],
      ["202", "seed-hotel-overflow", "seed-room-triple"],
    ].map(([reference, hotelId, productId]) => db.hotelRoom.create({ data: { eventId: con.id, reference, hotelId, productId } })),
  );
  const room = (reference: string) => rooms.find((item) => item.reference === reference)?.id ?? "";

  // Assigned pair (Alex + Bea, double 101), stay = earliest arrival to latest departure.
  const assigned = await db.roomGroup.create({
    data: { eventId: con.id, productId: "seed-room-double", members: { create: [{ registrationId: conAlex.id }, { registrationId: conBea.id }] } },
  });
  await db.roomAssignment.create({
    data: { groupId: assigned.id, roomId: room("101"), checkIn: new Date(checkIn.getTime() - DAY), checkOut: new Date(checkOut.getTime() + DAY), assignedByAdminId: hotelAdmin.id, note: "Seed assignment" },
  });
  // Under-occupied triple with an open invitation from Dana to Eli. Eli booked an own triple,
  // so accepting shows the "release your room" confirmation.
  const triple = await db.roomGroup.create({ data: { eventId: con.id, productId: "seed-room-triple", members: { create: [{ registrationId: conDana.id }] } } });
  await db.roomInvitation.create({
    data: { token: randomBytes(32).toString("base64url"), groupId: triple.id, inviterRegistrationId: conDana.id, inviteeRegistrationId: conEli.id, expiresAt: inDays(3) },
  });
  // Chris (double) has no group yet: shows up as unresolved.
  await db.roomAuditLog.createMany({
    data: [
      { eventId: con.id, groupId: assigned.id, actorUserId: u.alex.id, action: "GROUP_CREATED" },
      { eventId: con.id, groupId: assigned.id, actorUserId: u.bea.id, action: "INVITATION_ACCEPTED" },
      { eventId: con.id, groupId: assigned.id, actorAdminId: hotelAdmin.id, action: "ROOM_ASSIGNED", note: "Seed assignment", metadata: { roomId: room("101"), reference: "101" } },
      { eventId: con.id, groupId: triple.id, actorUserId: u.dana.id, action: "INVITATION_SENT" },
    ],
  });

  // Community on the convention.
  const posts = [
    { authorId: u.alex.id, type: "TEXT" as const, content: "Who else is arriving early? 🦊", status: "APPROVED" as const, pinned: false },
    { authorId: u.bea.id, type: "TEXT" as const, content: "Looking for a roommate in the double rooms!", status: "APPROVED" as const, pinned: false },
    { authorId: u.chris.id, type: "TEXT" as const, content: "Spam link here", status: "REJECTED" as const, pinned: false },
    { authorId: u.dana.id, type: "TEXT" as const, content: "Deleted by author", status: "DELETED" as const, pinned: false, deletedAt: new Date() },
  ];
  const createdPosts = [];
  for (const post of posts) {
    createdPosts.push(await db.communityPost.create({ data: { eventId: con.id, tags: ["general"], ...post } }));
  }
  await db.postModerationLog.createMany({
    data: [
      ...createdPosts.map((post) => ({ postId: post.id, actorUserId: post.authorId, action: "CREATED" as const })),
      { postId: createdPosts[0].id, actorAdminId: ownerAdmin.id, action: "APPROVED" },
      { postId: createdPosts[2].id, actorAdminId: ownerAdmin.id, action: "REJECTED", reason: "Spam" },
      { postId: createdPosts[3].id, actorUserId: u.dana.id, action: "DELETED" },
    ],
  });
  await db.communityComment.createMany({
    data: [
      { postId: createdPosts[0].id, authorId: u.bea.id, content: "Me! Thursday evening.", status: "APPROVED" },
      { postId: createdPosts[1].id, authorId: u.chris.id, content: "I still need one, invite me: chris_cat", status: "APPROVED", mentionedUserIds: [u.bea.id] },
      { postId: createdPosts[1].id, authorId: u.eli.id, content: "removed", status: "DELETED", deletedAt: new Date() },
    ],
  });
  await db.postReaction.createMany({
    data: [
      { postId: createdPosts[0].id, userId: u.bea.id, reaction: "LIKE" },
      { postId: createdPosts[0].id, userId: u.chris.id, reaction: "LOVE" },
      { postId: createdPosts[1].id, userId: u.alex.id, reaction: "LIKE" },
    ],
  });
  await db.supportTicket.createMany({
    data: [
      { eventId: con.id, registrationId: conChris.id, userId: u.chris.id, subject: "Can I change my room type?", description: "I booked a double but would like a single.", status: "OPEN" },
      { eventId: con.id, registrationId: conDana.id, userId: u.dana.id, subject: "Invoice address", description: "Please add my company name.", status: "IN_PROGRESS", adminResponse: "We are on it.", lastUpdatedByAdminId: supportAdmin.id },
      { eventId: day.id, registrationId: dayRegs[1].id, userId: u.bea.id, subject: "Dinner allergy", description: "Nut allergy, please note.", status: "OPEN" },
    ],
  });
  await db.registrationHistory.create({
    data: { registrationId: conAlex.id, changedByAdminId: ownerAdmin.id, action: "UPDATED", changes: [{ label: "Badge Tier", old: "Basic", new: "Sponsor" }], notes: "Upgraded on site" },
  });

  // ---- 5: approval + scan-once event with check-ins ----------------------------------------
  const meetup = await db.event.create({
    data: {
      name: "Approval Meetup",
      description: "Requires approval before payment; tickets scan once.",
      status: "PUBLISHED",
      startDate: inDays(5, 18),
      endDate: inDays(6, 16),
      requireApproval: true,
      scanOnce: true,
      publishAt: inDays(-15),
      ownerId: individualAdminId,
      location: { create: location("Bar Central", "Stuttgart") },
      products: { create: [product("seed-meet-ticket", "Entry", "TICKET", 10, 0)] },
    },
  });
  const meetRegs = [];
  for (const key of ["alex", "bea", "chris", "dana"]) {
    meetRegs.push(await book(db, { userId: u[key].id, eventId: meetup.id, productIds: ["seed-meet-ticket"] }));
  }
  await book(db, { userId: u.eli.id, eventId: meetup.id, productIds: ["seed-meet-ticket"], status: "PENDING", paid: false });
  await book(db, { userId: u.finn.id, eventId: meetup.id, productIds: ["seed-meet-ticket"], status: "APPROVED", paid: false });
  for (const registration of meetRegs.slice(0, 3)) {
    const checkedInAt = new Date();
    await db.registration.update({ where: { id: registration.id }, data: { checkedInAt, checkedInByAdminId: individualAdminId, checkInCount: 1 } });
    await db.registrationCheckInLog.create({
      data: { registrationId: registration.id, eventId: meetup.id, adminId: individualAdminId, ticketId: registration.ticketId, clientOperationId: randomBytes(12).toString("hex"), clientScannedAt: checkedInAt, result: "ACCEPTED", notes: { ticketTier: "Entry", checkInCount: 1 } },
    });
  }

  // ---- 6: past free event with feedback --------------------------------------------------------
  const past = await db.event.create({
    data: {
      name: "Free Picnic (past)",
      description: "Free event that already ended; community stays open for feedback.",
      status: "PUBLISHED",
      startDate: inDays(-10, 12),
      endDate: inDays(-10, 18),
      communityEnabled: true,
      communityOpenAfterEnd: true,
      ownerId: ownerAdmin.id,
      organizationId: org.id,
      location: { create: location("Schlossgarten", "Stuttgart") },
      products: { create: [product("seed-picnic-ticket", "Free Entry", "TICKET", 0, 0)] },
    },
  });
  for (const key of ["alex", "gabi"]) await book(db, { userId: u[key].id, eventId: past.id, productIds: ["seed-picnic-ticket"] });
  const feedback = await db.communityPost.create({
    data: {
      eventId: past.id,
      authorId: u.gabi.id,
      type: "FEEDBACK",
      status: "APPROVED",
      pinned: true,
      feedbackRating: 4,
      feedbackType: "ORGANIZATION",
      feedbackEntries: [{ feedbackType: "ORGANIZATION", feedbackRating: 4, content: "Nicely done, a few hiccups." }],
    },
  });
  await db.postModerationLog.createMany({
    data: [
      { postId: feedback.id, actorUserId: u.gabi.id, action: "CREATED" },
      { postId: feedback.id, actorAdminId: ownerAdmin.id, action: "PINNED" },
    ],
  });

  await db.notification.createMany({
    data: [
      { userId: u.eli.id, type: "EVENT", title: "Roommate invitation: Ventry Con", body: "Dana invited you to share a room.", link: `/events/${con.id}/room` },
      { userId: u.bea.id, type: "COMMENT", title: "New comment", body: "chris_cat replied to your post", link: `/events/${con.id}/community`, read: true },
      { userId: u.chris.id, type: "SYSTEM", title: "Welcome to Ventry", read: true },
    ],
  });

  console.log(`🌱 Seeded ${PERSONAS.length} personas (password: DEV_SEED_PASSWORD or "ventry-dev-password"), 6 events, org "${org.slug}".`);
}
