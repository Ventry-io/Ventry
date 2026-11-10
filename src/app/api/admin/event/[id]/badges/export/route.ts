import { type NextRequest, NextResponse } from "next/server";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { BadgeImageError, loadBadgeAttendeesByIds, renderBadgePng, renderPrintableBadgesHtml } from "@/lib/badges/server";
import { badgeExportSchema } from "@/types/schemas/badge";
import { z } from "zod";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const eventId = Number((await params).id);
    if (Number.isNaN(eventId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    const authResult = await checkEventAdminAuth(eventId, req.headers);
    if (!authResult.authorized) return NextResponse.json({ error: authResult.error || "Forbidden" }, { status: 403 });

    const body = await req.json();
    const data = badgeExportSchema.parse(body);
    const attendees = await loadBadgeAttendeesByIds(eventId, data.attendeeIds);

    if (attendees.length === 0) {
      return NextResponse.json({ error: "No matching attendees found" }, { status: 404 });
    }

    if (data.format === "png") {
      if (data.additionalTemplates?.length) {
        return NextResponse.json({ error: "PNG export supports one design at a time; use the print view for multiple badges" }, { status: 422 });
      }
      if (attendees.length !== 1) {
        return NextResponse.json({ error: "PNG export supports one attendee at a time" }, { status: 422 });
      }

      const png = await renderBadgePng(data.template, attendees[0], eventId);
      const body = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="badge-${attendees[0].ticketId}.png"`,
        },
      });
    }

    const html = renderPrintableBadgesHtml(data.template, attendees, eventId, data.pageMode, data.additionalTemplates);
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": "inline; filename=\"badges.html\"",
      },
    });
  } catch (error) {
    if (error instanceof BadgeImageError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 422 });
    }

    console.error("Error exporting badges:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
