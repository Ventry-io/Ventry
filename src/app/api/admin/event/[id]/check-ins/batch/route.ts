import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma/prisma";
import { Prisma } from "@/generated/prisma";
import { forbiddenResponse } from "@/lib/auth/admin";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { getCheckInEligibility, resolveTicketTier } from "@/lib/tickets/check-in";
import { rethrowIfExpectedPrerenderInterruption } from "@/lib/next/prerender";

const MAX_BATCH_BYTES = 100 * 1024;

const checkInOperationSchema = z.object({
  clientOperationId: z.string().min(8).max(120),
  ticketId: z.coerce.number().int().positive(),
  scannedAt: z.string().optional(),
}).strict();

const checkInBatchSchema = z.object({
  operations: z.array(checkInOperationSchema).min(1).max(250),
}).strict();

type CheckInOperation = z.infer<typeof checkInOperationSchema>;

function parseClientDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const eventId = Number((await params).id);
    if (Number.isNaN(eventId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const authResult = await checkEventAdminAuth(eventId, req.headers, undefined, true);
    if (!authResult.authorized) {
      return forbiddenResponse(authResult.error);
    }

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).length > MAX_BATCH_BYTES) {
      return NextResponse.json({ error: "Batch is too large" }, { status: 413 });
    }

    const parsedBody = checkInBatchSchema.safeParse(JSON.parse(rawBody));
    if (!parsedBody.success) {
      return NextResponse.json({ error: parsedBody.error.issues }, { status: 422 });
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        scanOnce: true,
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const results = await prisma.$transaction(async (tx) => {
      const output = [];

      for (const operation of parsedBody.data.operations) {
        output.push(await processOperation(tx, event.id, event.scanOnce, authResult.adminId || null, operation));
      }

      return output;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return NextResponse.json({
      serverProcessedAt: new Date().toISOString(),
      results,
    });
  } catch (error) {
    rethrowIfExpectedPrerenderInterruption(error);
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Check-in is busy right now. Please retry." }, { status: 409 });
    }

    console.error("Check-in batch error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

async function processOperation(
  tx: Prisma.TransactionClient,
  eventId: number,
  scanOnce: boolean,
  adminId: string | null,
  operation: CheckInOperation,
) {
  const existingLog = await tx.registrationCheckInLog.findUnique({
    where: { clientOperationId: operation.clientOperationId },
    select: {
      result: true,
      ticketId: true,
      serverProcessedAt: true,
      notes: true,
    },
  });

  if (existingLog) {
    return {
      clientOperationId: operation.clientOperationId,
      ticketId: existingLog.ticketId,
      result: existingLog.result,
      serverProcessedAt: existingLog.serverProcessedAt.toISOString(),
      notes: existingLog.notes,
      idempotent: true,
    };
  }

  const registration = await tx.registration.findFirst({
    where: {
      eventId,
      ticketId: operation.ticketId,
    },
    include: {
      payments: {
        select: {
          paymentStatus: true,
        },
      },
      event: {
        select: {
          products: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      },
      user: {
        select: {
          name: true,
          legalName: true,
        },
      },
      registrationItems: {
        select: {
          product: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!registration) {
    const log = await tx.registrationCheckInLog.create({
      data: {
        registrationId: null,
        eventId,
        adminId,
        ticketId: operation.ticketId,
        clientOperationId: operation.clientOperationId,
        clientScannedAt: parseClientDate(operation.scannedAt),
        result: "NOT_FOUND",
        notes: { reason: "Ticket was not found for this event" },
      },
    });

    return {
      clientOperationId: operation.clientOperationId,
      ticketId: operation.ticketId,
      result: log.result,
      serverProcessedAt: log.serverProcessedAt.toISOString(),
      notes: log.notes,
      idempotent: false,
    };
  }

  const eligibility = getCheckInEligibility({
    status: registration.status,
    expiresAt: registration.expiresAt,
    checkedInAt: registration.checkedInAt,
    payments: registration.payments,
    scanOnce,
  });

  const clientScannedAt = parseClientDate(operation.scannedAt);
  const ticketProduct = resolveTicketTier(registration.registrationItems, registration.preferences, registration.event.products);
  const displayName = registration.user.name || registration.user.legalName || "Unnamed attendee";
  const legalName = registration.user.legalName || null;
  const baseNotes = {
    attendeeName: displayName,
    displayName,
    legalName,
    ticketTier: ticketProduct?.name || null,
  };

  if (!eligibility.eligible) {
    const log = await tx.registrationCheckInLog.create({
      data: {
        registrationId: registration.id,
        eventId,
        adminId,
        ticketId: operation.ticketId,
        clientOperationId: operation.clientOperationId,
        clientScannedAt,
        result: "REJECTED",
        notes: {
          ...baseNotes,
          reason: eligibility.reason,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      clientOperationId: operation.clientOperationId,
      ticketId: operation.ticketId,
      result: log.result,
      serverProcessedAt: log.serverProcessedAt.toISOString(),
      notes: log.notes,
      idempotent: false,
    };
  }

  const checkInAt = registration.checkedInAt || new Date();
  const updateResult = await tx.registration.updateMany({
    where: {
      id: registration.id,
      ...(scanOnce ? { checkedInAt: null } : {}),
    },
    data: {
      checkedInAt: checkInAt,
      checkedInByAdminId: adminId,
      checkInCount: { increment: 1 },
    },
  });

  if (updateResult.count === 0) {
    const log = await tx.registrationCheckInLog.create({
      data: {
        registrationId: registration.id,
        eventId,
        adminId,
        ticketId: operation.ticketId,
        clientOperationId: operation.clientOperationId,
        clientScannedAt,
        result: "REJECTED",
        notes: {
          ...baseNotes,
          reason: "Ticket was already checked in",
        } as Prisma.InputJsonValue,
      },
    });

    return {
      clientOperationId: operation.clientOperationId,
      ticketId: operation.ticketId,
      result: log.result,
      serverProcessedAt: log.serverProcessedAt.toISOString(),
      notes: log.notes,
      idempotent: false,
    };
  }

  const updatedRegistration = await tx.registration.findUniqueOrThrow({
    where: { id: registration.id },
    select: {
      checkedInAt: true,
      checkInCount: true,
    },
  });

  const log = await tx.registrationCheckInLog.create({
    data: {
      registrationId: registration.id,
      eventId,
      adminId,
      ticketId: operation.ticketId,
      clientOperationId: operation.clientOperationId,
      clientScannedAt,
      result: "ACCEPTED",
      notes: {
        ...baseNotes,
        checkedInAt: updatedRegistration.checkedInAt?.toISOString() || null,
        checkInCount: updatedRegistration.checkInCount,
      } as Prisma.InputJsonValue,
    },
  });

  return {
    clientOperationId: operation.clientOperationId,
    ticketId: operation.ticketId,
    result: log.result,
    serverProcessedAt: log.serverProcessedAt.toISOString(),
    notes: log.notes,
    idempotent: false,
  };
}
