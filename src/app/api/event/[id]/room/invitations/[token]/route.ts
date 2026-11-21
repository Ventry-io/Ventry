import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { syncReleasedProductStocks } from "@/lib/events/registration-capacity";
import { respondToInvitation } from "@/lib/rooms/attendee";
import { sendNotices } from "@/lib/rooms/common";
import { parseBody, parseEventId, roomErrorResponse } from "@/lib/rooms/http";
import { roomInvitationActionSchema } from "@/types/schemas/rooms";

/** Accept or reject (invitee only) or revoke (group members) a roommate invitation. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; token: string }> }) {
  const session = await getSession(req.headers);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, token } = await params;
  const eventId = parseEventId(id);
  if (!eventId) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  const body = await parseBody(req, roomInvitationActionSchema);
  if ("response" in body) return body.response;

  try {
    const { status, notices, releasedProductIds } = await respondToInvitation(session.user.id, eventId, token, body.data.action, {
      releaseOwnRoom: body.data.releaseOwnRoom,
    });
    await syncReleasedProductStocks(releasedProductIds);
    await sendNotices(notices);
    return NextResponse.json({ status });
  } catch (error) {
    return roomErrorResponse(error, "Roommate invitation response error:");
  }
}
