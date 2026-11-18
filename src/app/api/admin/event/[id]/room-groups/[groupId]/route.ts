import { type NextRequest, NextResponse } from "next/server";
import { assignGroupToRoom, mergeGroups, removeMemberAsAdmin, splitGroup, unassignGroup } from "@/lib/rooms/admin";
import { sendNotices } from "@/lib/rooms/common";
import { authorizeHotelAdmin, parseBody, roomErrorResponse } from "@/lib/rooms/http";
import { roomGroupActionSchema } from "@/types/schemas/rooms";

/** Assign / unassign a room, split, merge or remove a member. Every action is audited. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string }> }) {
  const { id, groupId } = await params;
  const gate = await authorizeHotelAdmin(req.headers, id, true);
  if ("response" in gate) return gate.response;
  const body = await parseBody(req, roomGroupActionSchema);
  if ("response" in body) return body.response;
  const actor = { adminId: gate.auth.adminId };
  const input = body.data;

  try {
    const result =
      input.action === "assign"
        ? await assignGroupToRoom(gate.eventId, actor, groupId, input.roomId, input.note ?? null)
        : input.action === "unassign"
          ? await unassignGroup(gate.eventId, actor, groupId, input.note ?? null)
          : input.action === "split"
            ? await splitGroup(gate.eventId, actor, groupId, input.registrationIds, input.note)
            : input.action === "merge"
              ? await mergeGroups(gate.eventId, actor, groupId, input.sourceGroupId, input.note)
              : await removeMemberAsAdmin(gate.eventId, actor, groupId, input.registrationId, input.note);
    await sendNotices(result.notices);
    return NextResponse.json({ ok: true, ...("groupId" in result ? { groupId: result.groupId } : {}) });
  } catch (error) {
    return roomErrorResponse(error, "Room group update error:");
  }
}
