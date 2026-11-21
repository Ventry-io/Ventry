import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type MockRegistrationItem = {
  productId: string;
  product: {
    capacity: number | null;
  };
};

type MockRegistration = {
  id: string;
  userId: string;
  eventId: number;
  status: string;
  expiresAt: Date | null;
  registrationItems: MockRegistrationItem[];
};

type MockPayment = {
  id: string;
  registrationId: string;
  paymentStatus: string;
};

type MockWaitlistEntry = {
  registrationId: string;
  productId: string;
};

const { clearProductStockMock, getSessionMock } = vi.hoisted(() => ({
  clearProductStockMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

let mockRegistration: MockRegistration | null;
let mockPayments: MockPayment[];
let mockWaitlistEntries: MockWaitlistEntry[];
let mockProducts: Record<string, { soldCount: number }>;

vi.mock("@/lib/auth/session", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/lib/redis", () => ({
  clearProductStock: clearProductStockMock,
}));

vi.mock("@/lib/prisma/prisma", () => {
  const prismaMock = {
    $transaction: vi.fn(),
    registration: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      updateMany: vi.fn(),
    },
    registrationItem: {
      deleteMany: vi.fn(),
    },
    waitlistEntry: {
      deleteMany: vi.fn(),
    },
    product: {
      updateMany: vi.fn(),
    },
    roomInvitation: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    roomGroupMember: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };

  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));

  prismaMock.registration.findUnique.mockImplementation(async ({ where, select }: {
    where: { id?: string; userId_eventId?: { userId: string; eventId: number } };
    select?: { id?: boolean; registrationItems?: { select: { productId: boolean; product: { select: { capacity: boolean } } } } };
  }) => {
    const matchesWhere =
      mockRegistration &&
      ((where.id && mockRegistration.id === where.id) ||
        (where.userId_eventId &&
          mockRegistration.userId === where.userId_eventId.userId &&
          mockRegistration.eventId === where.userId_eventId.eventId));

    if (!matchesWhere || !mockRegistration) {
      return null;
    }

    if (select?.id && !select.registrationItems) {
      return { id: mockRegistration.id };
    }

    if (select?.registrationItems) {
      return {
        id: mockRegistration.id,
        registrationItems: mockRegistration.registrationItems.map((item) => ({
          productId: item.productId,
          product: {
            capacity: item.product.capacity,
          },
        })),
      };
    }

    return mockRegistration;
  });

  prismaMock.registration.update.mockImplementation(async ({ where, data }: {
    where: { id: string };
    data: { status?: string; expiresAt?: Date | null };
  }) => {
    if (!mockRegistration || mockRegistration.id !== where.id) {
      return null;
    }

    mockRegistration = {
      ...mockRegistration,
      ...data,
    };

    return mockRegistration;
  });

  prismaMock.payment.updateMany.mockImplementation(async ({ where, data }: {
    where: { registrationId: string; paymentStatus: string };
    data: { paymentStatus: string };
  }) => {
    let count = 0;
    mockPayments = mockPayments.map((payment) => {
      if (payment.registrationId === where.registrationId && payment.paymentStatus === where.paymentStatus) {
        count += 1;
        return {
          ...payment,
          paymentStatus: data.paymentStatus,
        };
      }

      return payment;
    });

    return { count };
  });

  prismaMock.registrationItem.deleteMany.mockImplementation(async ({ where }: { where: { registrationId: string } }) => {
    if (!mockRegistration || mockRegistration.id !== where.registrationId) {
      return { count: 0 };
    }

    const count = mockRegistration.registrationItems.length;
    mockRegistration.registrationItems = [];
    return { count };
  });

  prismaMock.waitlistEntry.deleteMany.mockImplementation(async ({ where }: { where: { registrationId: string } }) => {
    const count = mockWaitlistEntries.filter((entry) => entry.registrationId === where.registrationId).length;
    mockWaitlistEntries = mockWaitlistEntries.filter((entry) => entry.registrationId !== where.registrationId);
    return { count };
  });

  prismaMock.product.updateMany.mockImplementation(async ({ where, data }: {
    where: { id: string; soldCount: { gte: number } };
    data: { soldCount: { decrement: number } };
  }) => {
    const product = mockProducts[where.id];
    if (!product || product.soldCount < where.soldCount.gte) {
      return { count: 0 };
    }

    product.soldCount -= data.soldCount.decrement;
    return { count: 1 };
  });

  return { prisma: prismaMock };
});

import { POST } from "@/app/api/event/[id]/cancel/route";

function createRequest(eventId: string) {
  return new NextRequest(`http://localhost:3000/api/event/${eventId}/cancel`, {
    method: "POST",
  });
}

describe("App Router: /api/event/[id]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockRegistration = {
      id: "reg-1",
      userId: "user-1",
      eventId: 7,
      status: "PENDING",
      expiresAt: new Date("2026-04-10T12:00:00.000Z"),
      registrationItems: [
        {
          productId: "prod-limited",
          product: { capacity: 2 },
        },
        {
          productId: "prod-unlimited",
          product: { capacity: null },
        },
      ],
    };
    mockPayments = [
      {
        id: "pay-1",
        registrationId: "reg-1",
        paymentStatus: "PENDING",
      },
    ];
    mockWaitlistEntries = [
      {
        registrationId: "reg-1",
        productId: "prod-waitlist",
      },
    ];
    mockProducts = {
      "prod-limited": { soldCount: 1 },
      "prod-unlimited": { soldCount: 3 },
    };

    getSessionMock.mockReturnValue({ user: { id: "user-1" } });
  });

  it("cancels the registration and releases reserved capacity", async () => {
    const response = await POST(createRequest("7"), {
      params: Promise.resolve({ id: "7" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Registration cancelled" });
    expect(mockRegistration?.status).toBe("CANCELLED");
    expect(mockRegistration?.expiresAt).toBeNull();
    expect(mockRegistration?.registrationItems).toEqual([]);
    expect(mockPayments[0]?.paymentStatus).toBe("FAILED");
    expect(mockWaitlistEntries).toEqual([]);
    expect(mockProducts["prod-limited"]?.soldCount).toBe(0);
    expect(mockProducts["prod-unlimited"]?.soldCount).toBe(2);
    expect(clearProductStockMock).toHaveBeenCalledTimes(1);
    expect(clearProductStockMock).toHaveBeenCalledWith("prod-limited");
  });

  it("returns 404 when the user has no registration for the event", async () => {
    mockRegistration = null;

    const response = await POST(createRequest("7"), {
      params: Promise.resolve({ id: "7" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Registration not found" });
  });
});
