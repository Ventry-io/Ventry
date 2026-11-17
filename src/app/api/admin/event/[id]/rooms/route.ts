import { type NextRequest, NextResponse } from "next/server";
import { createRooms, getRoomOverview, updateRoomSettings } from "@/lib/rooms/admin";
import { authorizeHotelAdmin, parseBody, roomErrorResponse } from "@/lib/rooms/http";
import { createRoomsSchema, roomSettingsSchema } from "@/types/schemas/rooms";

type Params = { params: Promise<{ id: string }> };

/** Rooms, groups, occupancy conflicts and attendees without a group. */
export async function GET(req: NextRequest, { params }: Params) {
  const gate = await authorizeHotelAdmin(req.headers, (await params).id, false);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await getRoomOverview(gate.eventId));
  } catch (error) {
    return roomErrorResponse(error, "Room overview error:");
  }
}

/** Add physical rooms (room allotment) for one hotel room type. */
export async function POST(req: NextRequest, { params }: Params) {
  const gate = await authorizeHotelAdmin(req.headers, (await params).id, true);
  if ("response" in gate) return gate.response;
  const body = await parseBody(req, createRoomsSchema);
  if ("response" in body) return body.response;
  try {
    const created = await createRooms(gate.eventId, { adminId: gate.auth.adminId }, body.data);
    return NextResponse.json({ created }, { status: 201 });
  } catch (error) {
    return roomErrorResponse(error, "Create rooms error:");
  }
}

/** Room group cutoff date. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await authorizeHotelAdmin(req.headers, (await params).id, true);
  if ("response" in gate) return gate.response;
  const body = await parseBody(req, roomSettingsSchema);
  if ("response" in body) return body.response;
  try {
    await updateRoomSettings(gate.eventId, { adminId: gate.auth.adminId }, body.data.roomGroupCutoffAt);
    return NextResponse.json({ roomGroupCutoffAt: body.data.roomGroupCutoffAt });
  } catch (error) {
    return roomErrorResponse(error, "Room settings error:");
  }
}
