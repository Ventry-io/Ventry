import { type NextRequest, NextResponse } from "next/server";
import { createGroupForRegistrations, remindUnresolved } from "@/lib/rooms/admin";
import { sendNotices } from "@/lib/rooms/common";
import { authorizeHotelAdmin, parseBody, roomErrorResponse } from "@/lib/rooms/http";
import { roomGroupsActionSchema } from "@/types/schemas/rooms";

/** Create a group from registrations without one, or remind attendees with unresolved room groups. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await authorizeHotelAdmin(req.headers, (await params).id, true);
  if ("response" in gate) return gate.response;
  const body = await parseBody(req, roomGroupsActionSchema);
  if ("response" in body) return body.response;
  const actor = { adminId: gate.auth.adminId };

  try {
    if (body.data.action === "remind") {
      const { notices } = await remindUnresolved(gate.eventId, actor);
      await sendNotices(notices);
      return NextResponse.json({ notified: notices.length });
    }
    const { groupId, notices } = await createGroupForRegistrations(gate.eventId, actor, body.data.registrationIds, body.data.note ?? null);
    await sendNotices(notices);
    return NextResponse.json({ groupId }, { status: 201 });
  } catch (error) {
    return roomErrorResponse(error, "Room group action error:");
  }
}
