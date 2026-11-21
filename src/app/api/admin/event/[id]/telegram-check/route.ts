import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { forbiddenResponse } from "@/lib/auth/admin";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { getChannelPosts, TelegramPreviewError } from "@/lib/events/telegram";
import { TELEGRAM_CHANNEL } from "@/types/schemas/event/page";

const bodySchema = z.object({ channel: z.string().regex(TELEGRAM_CHANNEL), before: z.number().int().min(2).optional() }).strict();

// POST /api/admin/event/[id]/telegram-check - lets the page designer preview a channel before it is saved.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  const auth = await checkEventAdminAuth(id, req.headers, undefined, true);
  if (!auth.authorized) return forbiddenResponse(auth.error);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Use a public channel username, without @ or a URL" }, { status: 422 });
  try {
    return NextResponse.json(await getChannelPosts(body.data.channel, body.data.before));
  } catch (error) {
    if (error instanceof TelegramPreviewError) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("Telegram check failed:", error);
    return NextResponse.json({ error: "Telegram could not be reached. Please retry." }, { status: 502 });
  }
}
