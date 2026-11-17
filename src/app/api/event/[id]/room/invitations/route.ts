import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { inviteRoommate } from "@/lib/rooms/attendee";
import { sendNotices } from "@/lib/rooms/common";
import { sendRoomInvitationMail } from "@/lib/rooms/mail";
import { parseBody, parseEventId, roomErrorResponse } from "@/lib/rooms/http";
import { roomInviteSchema } from "@/types/schemas/rooms";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req.headers);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const eventId = parseEventId((await params).id);
  if (!eventId) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  const body = await parseBody(req, roomInviteSchema);
  if ("response" in body) return body.response;

  try {
    const { invitation, notices, mail } = await inviteRoommate(session.user.id, eventId, body.data.username);
    await Promise.all([sendNotices(notices), sendRoomInvitationMail(mail)]);
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return roomErrorResponse(error, "Roommate invitation error:");
  }
}
