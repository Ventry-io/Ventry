import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import { getEventViewer, visibleEventWhere } from "@/lib/events/public-event";
import { getChannelPosts, TelegramPreviewError } from "@/lib/events/telegram";
import { allBlocks, normalizeEventPage } from "@/types/schemas/event/page";

// GET /api/event/[id]/telegram?block=<id>&before=<post> - newer/older posts of a Telegram block on the event page.
// The channel comes from the saved page design, never from the request, so this is not an open proxy.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const blockId = req.nextUrl.searchParams.get("block");
  const rawBefore = req.nextUrl.searchParams.get("before");
  const before = rawBefore === null ? undefined : Number(rawBefore);
  if (!Number.isSafeInteger(id) || !blockId || (before !== undefined && (!Number.isSafeInteger(before) || before < 2))) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const event = await prisma.event.findFirst({ where: visibleEventWhere(id, await getEventViewer(req.headers)), select: { pageDesign: true } });
  const block = event && normalizeEventPage(event.pageDesign).pages.flatMap(page => allBlocks(page.blocks)).find(item => item.id === blockId);
  if (!block || block.type !== "telegram") return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await getChannelPosts(block.channel, before), { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (error) {
    if (!(error instanceof TelegramPreviewError)) console.error("Telegram feed failed:", error);
    return NextResponse.json({ error: "Telegram is unavailable" }, { status: 502 });
  }
}
