import { type NextRequest, NextResponse } from "next/server";
import { exportManifest } from "@/lib/rooms/manifest";
import { authorizeHotelAdmin, roomErrorResponse } from "@/lib/rooms/http";

/** Hotel manifest CSV (confirmed guests only). `?hotelId=` limits it to one hotel's guests. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await authorizeHotelAdmin(req.headers, (await params).id, false);
  if ("response" in gate) return gate.response;
  const hotelId = req.nextUrl.searchParams.get("hotelId") || undefined;
  try {
    const csv = await exportManifest(gate.eventId, gate.auth.adminId, hotelId);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="hotel-manifest-${gate.eventId}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return roomErrorResponse(error, "Hotel manifest export error:");
  }
}
