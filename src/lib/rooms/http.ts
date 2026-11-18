import { NextResponse } from "next/server";
import type { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { forbiddenResponse } from "@/lib/auth/admin";
import { checkEventAdminAuth, type EventAdminAuthResult } from "@/lib/auth/event-admin";
import { RoomError } from "@/lib/rooms/common";

export function parseEventId(raw: string) {
  const eventId = Number(raw);
  return Number.isInteger(eventId) && eventId > 0 ? eventId : null;
}

/** Room allocation and hotel manifests contain guest PII: event access plus HOTEL_MANAGEMENT. */
export async function authorizeHotelAdmin(
  headers: Headers,
  eventIdRaw: string,
  requireWrite: boolean,
): Promise<{ eventId: number; auth: EventAdminAuthResult } | { response: NextResponse }> {
  const eventId = parseEventId(eventIdRaw);
  if (!eventId) return { response: NextResponse.json({ error: "Invalid event id" }, { status: 400 }) };
  const auth = await checkEventAdminAuth(eventId, headers, "HOTEL_MANAGEMENT", requireWrite);
  if (!auth.authorized) {
    return {
      response:
        auth.error === "Event not found"
          ? NextResponse.json({ error: auth.error }, { status: 404 })
          : forbiddenResponse(auth.error),
    };
  }
  return { eventId, auth };
}

export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ response: NextResponse } | { data: z.infer<T> }> {
  const body = await req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { response: NextResponse.json({ error: parsed.error.issues }, { status: 422 }) };
  }
  return { data: parsed.data };
}

export function roomErrorResponse(error: unknown, logMessage: string) {
  if (error instanceof RoomError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json({ error: "This change conflicts with a concurrent update. Please reload." }, { status: 409 });
  }
  console.error(logMessage, error);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}
