import { type NextRequest, NextResponse } from "next/server";
import { deleteRoom } from "@/lib/rooms/admin";
import { authorizeHotelAdmin, roomErrorResponse } from "@/lib/rooms/http";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; roomId: string }> }) {
  const { id, roomId } = await params;
  const gate = await authorizeHotelAdmin(req.headers, id, true);
  if ("response" in gate) return gate.response;
  try {
    await deleteRoom(gate.eventId, { adminId: gate.auth.adminId }, roomId);
    return NextResponse.json({ message: "Room deleted" });
  } catch (error) {
    return roomErrorResponse(error, "Delete room error:");
  }
}
