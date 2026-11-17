import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getRoomView, leaveRoomGroup } from "@/lib/rooms/attendee";
import { sendNotices } from "@/lib/rooms/common";
import { parseEventId, roomErrorResponse } from "@/lib/rooms/http";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession(req.headers);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const eventId = parseEventId((await params).id);
  if (!eventId) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  try {
    return NextResponse.json(await getRoomView(session.user.id, eventId));
  } catch (error) {
    return roomErrorResponse(error, "Room view error:");
  }
}

/** Leave the current room group (before the cutoff). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession(req.headers);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const eventId = parseEventId((await params).id);
  if (!eventId) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  try {
    const { notices } = await leaveRoomGroup(session.user.id, eventId);
    await sendNotices(notices);
    return NextResponse.json({ message: "Left room group" });
  } catch (error) {
    return roomErrorResponse(error, "Leave room group error:");
  }
}
