import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma";

vi.mock("@/lib/prisma/prisma", () => ({
  prisma: {
    event: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
  decrementProductStock: vi.fn(),
  getOrInitProductStock: vi.fn(),
  incrementProductStock: vi.fn(),
}));

vi.mock("@/lib/events/registration-capacity", () => ({
  countActiveRegistrations: vi.fn(),
  releaseExpiredPendingRegistrations: vi.fn(),
}));

vi.mock("@/lib/events/accommodation", () => ({
  findHotelByRoomProductId: vi.fn(() => null),
  normalizeStayPolicy: vi.fn(() => null),
  resolveStayFee: vi.fn(() => 0),
}));

import { POST } from "./route";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma/prisma";
import {
  countActiveRegistrations,
  releaseExpiredPendingRegistrations,
} from "@/lib/events/registration-capacity";

const mockedGetSession = getSession as unknown as ReturnType<typeof vi.fn>;
const mockedFindEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockedQueryRawUnsafe = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;
const mockedCountActiveRegistrations = countActiveRegistrations as unknown as ReturnType<typeof vi.fn>;
const mockedReleaseExpiredPendingRegistrations =
  releaseExpiredPendingRegistrations as unknown as ReturnType<typeof vi.fn>;

function attendRequest(body: unknown) {
  return new NextRequest("http://localhost/api/event/7/attend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function eventFixture() {
  return {
    id: 7,
    name: "Furavia",
    status: "PUBLISHED",
    registrationOpensAt: null,
    paymentDeadline: null,
    requireApproval: false,
    maxRegistrations: null,
    stayPolicy: null,
    startDate: new Date("2026-07-01T10:00:00.000Z"),
    endDate: new Date("2026-07-03T18:00:00.000Z"),
    products: [
      {
        id: "ticket-basic",
        name: "Basic Ticket",
        description: null,
        type: "TICKET",
        capacity: null,
        allowWaitlist: false,
        soldCount: 0,
        price: 0,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
  };
}

function transactionMock(registrationCreate: ReturnType<typeof vi.fn>) {
  return {
    registration: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: registrationCreate,
    },
    payment: {
      create: vi.fn(),
    },
    registrationItem: {
      create: vi.fn(),
    },
    waitlistEntry: {
      create: vi.fn(),
    },
    product: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe("POST /api/event/[id]/attend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetSession.mockResolvedValue({ user: { id: "user-1", legalName: "Jane Doe", addressLine1: "Main St 1", addressCity: "Berlin", addressPostalCode: "10115", addressCountry: "DE" } });
    mockedFindEvent.mockResolvedValue(eventFixture());
    mockedCountActiveRegistrations.mockResolvedValue(0);
    mockedReleaseExpiredPendingRegistrations.mockResolvedValue(undefined);
    mockedQueryRawUnsafe.mockResolvedValue([{ setval: 42 }]);
  });

  it("rejects a missing billing address before reserving products, even with a check-in name", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1", legalName: "Jane Doe" } });
    const response = await POST(attendRequest({ productIds: ["ticket-basic"] }), { params: Promise.resolve({ id: "7" }) });
    expect(response.status).toBe(422);
    expect(mockedFindEvent).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("requires check-in identity before reserving products", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "user-1", legalName: " " } });
    const response = await POST(attendRequest({ productIds: ["ticket-basic"] }), { params: Promise.resolve({ id: "7" }) });
    expect(response.status).toBe(422);
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("resyncs the ticketId sequence and retries once when autoincrement is behind", async () => {
    const ticketIdError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`"ticketId"`)',
      {
        code: "P2002",
        clientVersion: "test",
        meta: {},
      },
    );

    mockedTransaction
      .mockImplementationOnce(async (callback: (tx: ReturnType<typeof transactionMock>) => unknown) =>
        callback(transactionMock(vi.fn().mockRejectedValue(ticketIdError))),
      )
      .mockImplementationOnce(async (callback: (tx: ReturnType<typeof transactionMock>) => unknown) =>
        callback(transactionMock(vi.fn().mockResolvedValue({ id: "reg-1", status: "PENDING" }))),
      );

    const response = await POST(
      attendRequest({ productIds: ["ticket-basic"], preferences: {} }),
      { params: Promise.resolve({ id: "7" }) },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      message: "Registration successful",
      registrationId: "reg-1",
      awaitingApproval: false,
      status: "PENDING",
      confirmedProducts: ["ticket-basic"],
      waitlistedProducts: [],
    });
    expect(mockedQueryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("setval"));
    expect(mockedTransaction).toHaveBeenCalledTimes(2);
  });
});
