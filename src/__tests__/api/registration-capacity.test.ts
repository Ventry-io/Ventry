import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, GET } from '@/app/api/event/[id]/attend/route';
import { NextRequest } from 'next/server';
import type { Event, Product, Registration, Payment, Prisma } from '@/generated/prisma';

// ------------------------------------------------------------------
// Type Definitions
// ------------------------------------------------------------------

interface MockEvent extends Partial<Event> {
  products: Partial<Product>[];
  _count: { registrations: number };
  stayPolicy: Prisma.JsonValue;
  requiresHotel: boolean;
}

interface MockDbState {
  event: MockEvent | null;
  registration: Partial<Registration>[];
  product: Partial<Product> | null;
  registrationItem: Record<string, unknown>[];
  payment: Partial<Payment>[];
  waitlist: Record<string, unknown>[];
}

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

vi.mock('@/lib/prisma/prisma', () => {
  const prismaMock = {
    event: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
    registration: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    registrationItem: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    payment: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    waitlistEntry: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    }
  };
  
  // Self-reference for transaction callback
  prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => await callback(prismaMock));

  return { prisma: prismaMock };
});

import { prisma } from '@/lib/prisma/prisma';

// Use a utility type for DeepMockProxy if available or build a compatible shape
type MockPrismaClient = {
  event: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  registration: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  registrationItem: { create: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  product: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  payment: { create: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  waitlistEntry: { create: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
};

const prismaMock = prisma as unknown as MockPrismaClient;

const getSessionMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSession: () => getSessionMock()
}));

// Mock Redis Factory
const redisStore = new Map<string, number>();
vi.mock('@/lib/redis', () => ({
  getOrInitProductStock: vi.fn(async (id: string, cap: number, sold: number) => {
      // Always reset if not present or just trust test setup
      if (!redisStore.has(id)) {
          redisStore.set(id, Math.max(0, cap - sold));
      }
      return true;
  }),
  decrementProductStock: vi.fn(async (id: string) => {
      const current = redisStore.get(id) ?? 0;
      if (current > 0) {
          redisStore.set(id, current - 1);
          return true;
      }
      return false;
  }),
  incrementProductStock: vi.fn(async (id: string) => {
      const current = redisStore.get(id) ?? 0;
      redisStore.set(id, current + 1);
  }),
  clearProductStock: vi.fn(async (id: string) => {
      redisStore.delete(id);
  })
}));

// We need a mutable "DB" state to simulate multiple users registering
let mockDb: MockDbState = {
  event: null,
  registration: [],
  product: null,
  registrationItem: [],
  payment: [],
  waitlist: []
};

// ------------------------------------------------------------------
// Helper to create requests
// ------------------------------------------------------------------
function createRegisterRequest(eventId: string, body: unknown) {
  return new NextRequest(`http://localhost:3000/api/event/${eventId}/attend`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function createGetRequest(eventId: string) {
    return new NextRequest(`http://localhost:3000/api/event/${eventId}/attend`, {
      method: 'GET',
    });
}

describe('Capacity Limit Integration Test', () => {
  const EVENT_ID = 1;
  const PRODUCT_ID = 'prod-limited';
  const CAPACITY = 2; // Low capacity to test easily

  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();

    // Reset "DB" state
    mockDb = {
      event: {
        id: EVENT_ID,
        status: 'PUBLISHED',
        registrationOpensAt: new Date(Date.now() - 100000), // Open
        paymentDeadline: new Date(Date.now() + 100000),
        products: [
          {
            id: PRODUCT_ID,
            name: 'Limited Product',
            price: 100,
            capacity: CAPACITY,
            soldCount: 0, // Starts empty
            type: 'TICKET',
            allowWaitlist: true, // Default allow
          }
        ],
        _count: { registrations: 0 },
        stayPolicy: {}, // Simplified
        requiresHotel: false
      },
      registration: [],
      payment: [],
      waitlist: [],
      product: null,
      registrationItem: []
    };

    // Setup Prisma Mocks Behavior
    prismaMock.event.findUnique.mockImplementation(async () => {
      // Return fresh state every time
      return mockDb.event;
    });

    prismaMock.registration.findUnique.mockImplementation(async ({ where }: { where: { userId_eventId: { userId: string, eventId: number } } }) => {
      const found = mockDb.registration.find(r => 
        r.userId === where.userId_eventId.userId && 
        r.eventId === where.userId_eventId.eventId
      ) || null;

      if (!found) {
        return null;
      }

      return {
        payments: [],
        ...found
      };
    });

    prismaMock.registration.findMany.mockResolvedValue([]);

    prismaMock.registration.count.mockImplementation(async ({ where }: { where: { eventId: number; status: { in: string[] } } }) => {
      return mockDb.registration.filter((registration) =>
        registration.eventId === where.eventId &&
        where.status.in.includes(String(registration.status))
      ).length;
    });

    prismaMock.registration.create.mockImplementation(async ({ data }: { data: Prisma.RegistrationCreateInput }) => {
      const newReg = { ...data, id: `reg-${Math.random()}` };
      mockDb.registration.push(newReg as unknown as Registration);
      if (mockDb.event) {
        mockDb.event._count.registrations++; // Increment event total count
      }
      return newReg;
    });

    prismaMock.registration.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const existing = mockDb.registration.find((registration) => registration.id === where.id);
      if (!existing) return null;
      Object.assign(existing, data);
      return existing;
    });

    prismaMock.registrationItem.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      mockDb.registrationItem.push(data);
      return data;
    });

    prismaMock.registrationItem.deleteMany.mockResolvedValue({ count: 0 });
    
    prismaMock.product.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (!mockDb.event) return null;
        return mockDb.event.products.find(p => p.id === where.id) || null;
    });

    prismaMock.product.update.mockImplementation(async ({ where, data }: { where: { id: string }, data: { soldCount?: { increment: number } } }) => {
       // Simulate atomic increment
       if (!mockDb.event) return null;
       
       const product = mockDb.event.products.find((p) => p.id === where.id);
       if (product && data.soldCount && data.soldCount.increment && product.soldCount !== undefined) {
         product.soldCount += data.soldCount.increment;
       }
       return product;
    });
    
    // Mock updateMany for atomic check
    prismaMock.product.updateMany.mockImplementation(async ({ where, data: _data }) => {
        if (!mockDb.event) return { count: 0 };
        
        const product = mockDb.event.products.find((p) => p.id === where.id);
        
        // Emulate "soldCount: { lt: capacity }" check
        if (!product || product.soldCount === undefined || product.capacity === undefined || product.capacity === null) {
            return { count: 0 };
        }
        
        if (product.soldCount < product.capacity) {
            // Success, increment
            product.soldCount += 1;
            return { count: 1 };
        } else {
            // Failed condition
            return { count: 0 };
        }
    });

    prismaMock.payment.create.mockImplementation(async ({ data }: { data: Prisma.PaymentCreateInput }) => {
      const newPayment = { ...data, id: `pay-${Math.random()}` };
      mockDb.payment.push(newPayment as unknown as Payment);
      return newPayment;
    });

    prismaMock.payment.updateMany.mockResolvedValue({ count: 0 });

    prismaMock.waitlistEntry.deleteMany.mockResolvedValue({ count: 0 });

    prismaMock.waitlistEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        mockDb.waitlist.push(data);
        return data;
    });
  });

  // ------------------------------------------------------------------
  // Tests
  // ------------------------------------------------------------------

  it('should return availability info via GET', async () => {
      const req = createGetRequest(String(EVENT_ID));
      const res = await GET(req, { params: Promise.resolve({ id: String(EVENT_ID) }) });
      const body = await res.json();
      
      expect(res.status).toBe(200);
      expect(body.eventId).toBe(EVENT_ID);
      expect(body.availability).toHaveLength(1);
      expect(body.availability[0].remaining).toBe(CAPACITY);
      expect(body.availability[0].isSoldOut).toBe(false);
  });

  it('should allow registration when capacity is available', async () => {
    // 1. User 1
    getSessionMock.mockReturnValue({ user: { id: 'user-1' } });
    
    const req = createRegisterRequest(String(EVENT_ID), { productId: PRODUCT_ID });
    const res = await POST(req, { params: Promise.resolve({ id: String(EVENT_ID) }) });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.status).toBe('PENDING');
    if (mockDb.event?.products[0]) {
        expect(mockDb.event.products[0].soldCount).toBe(1); // Consumed 1
    }
  });

  it('should enforce capacity limit and add to waitlist when full', async () => {
    // 1. User 1 registers (Capacity 2 -> 1 left)
    getSessionMock.mockReturnValue({ user: { id: 'user-1' } });
    let req = createRegisterRequest(String(EVENT_ID), { productId: PRODUCT_ID });
    await POST(req, { params: Promise.resolve({ id: String(EVENT_ID) }) });

    // 2. User 2 registers (Capacity 2 -> 0 left)
    getSessionMock.mockReturnValue({ user: { id: 'user-2' } });
    req = createRegisterRequest(String(EVENT_ID), { productId: PRODUCT_ID });
    await POST(req, { params: Promise.resolve({ id: String(EVENT_ID) }) });
    
    if (mockDb.event?.products[0]) {
        expect(mockDb.event.products[0].soldCount).toBe(2);
    }

    // 3. User 3 attempts registration (Capacity 2 -> Full! -> Waitlist)
    getSessionMock.mockReturnValue({ user: { id: 'user-3' } });
    req = createRegisterRequest(String(EVENT_ID), { productId: PRODUCT_ID });
    const res = await POST(req, { params: Promise.resolve({ id: String(EVENT_ID) }) });
    
    expect(res.status).toBe(201); // Created (Waitlist entry)
    const body = await res.json();
    
    expect(body.message).toContain('waitlist');
    expect(body.status).toBe('WAITLISTED');
    
    // Count should remain at 2
    if (mockDb.event?.products[0]) {
        expect(mockDb.event.products[0].soldCount).toBe(2);
    }
    
    // Verify waitlist entry
    expect(mockDb.waitlist).toHaveLength(1);
    expect(mockDb.registration.find(r => r.userId === 'user-3')?.status).toBe('WAITLISTED');
  });

  it('should return 400 for invalid product', async () => {
    getSessionMock.mockReturnValue({ user: { id: 'user-1' } });
    const req = createRegisterRequest(String(EVENT_ID), { productId: 'invalid-prod' });
    const res = await POST(req, { params: Promise.resolve({ id: String(EVENT_ID) }) });
    
    expect(res.status).toBe(400);
  });

  it('should block double registration for same user', async () => {
    getSessionMock.mockReturnValue({ user: { id: 'user-doubler' } });
    
    // First time
    let req = createRegisterRequest(String(EVENT_ID), { productId: PRODUCT_ID });
    let res = await POST(req, { params: Promise.resolve({ id: String(EVENT_ID) }) });
    expect(res.status).toBe(201);

    // Second time
    req = createRegisterRequest(String(EVENT_ID), { productId: PRODUCT_ID });
    res = await POST(req, { params: Promise.resolve({ id: String(EVENT_ID) }) });
    
    // Should fail (Error caught from transaction)
    expect(res.status).toBe(500); // 500 because we threw "Already registered" inside transaction
    const body = await res.json();
    expect(body.error).toBe("Already registered for this event");
  });

  it('should block waitlisting if disabled (T-shirt scenario)', async () => {
    // Modify product to disable waitlist
    if (mockDb.event?.products[0]) {
        mockDb.event.products[0].allowWaitlist = false;
        // Make it full
        mockDb.event.products[0].soldCount = CAPACITY;
    }
    
    // Simulate redis full
    redisStore.set(PRODUCT_ID, 0);

    getSessionMock.mockReturnValue({ user: { id: 'user-no-waitlist' } });
    
    const req = createRegisterRequest(String(EVENT_ID), { productId: PRODUCT_ID });
    const res = await POST(req, { params: Promise.resolve({ id: String(EVENT_ID) }) });
    
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('sold out');
  });

  it('should ignore capacity if capacity is null (unlimited)', async () => {
    if (mockDb.event?.products[0]) {
        // make unlimited
        mockDb.event.products[0].capacity = null;
        mockDb.event.products[0].soldCount = 1000;
    }

    getSessionMock.mockReturnValue({ user: { id: 'user-1001' } });
    
    const req = createRegisterRequest(String(EVENT_ID), { productId: PRODUCT_ID });
    const res = await POST(req, { params: Promise.resolve({ id: String(EVENT_ID) }) });
    
    expect(res.status).toBe(201);
    if (mockDb.event?.products[0]) {
        expect(mockDb.event.products[0].soldCount).toBe(1001);
    }
  });
});
