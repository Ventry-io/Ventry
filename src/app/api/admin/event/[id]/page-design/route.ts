import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { forbiddenResponse } from "@/lib/auth/admin";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { prisma } from "@/lib/prisma/prisma";
import { EventPageSchema } from "@/types/schemas/event/page";

type Params = { params: Promise<{ id: string }> };
const bodySchema = z.object({ design: EventPageSchema }).strict();

async function authorize(req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) return { response: NextResponse.json({ error: "Invalid ID" }, { status: 400 }) };
  const auth = await checkEventAdminAuth(id, req.headers, undefined, true);
  return auth.authorized ? { id } : { response: forbiddenResponse(auth.error) };
}

async function readDesign(req: NextRequest) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  return body.success ? { design: body.data.design as Prisma.InputJsonValue } : { response: NextResponse.json({ error: body.error.issues }, { status: 422 }) };
}

// PUT /api/admin/event/[id]/page-design - saves work in progress; visitors keep seeing the published design.
export async function PUT(req: NextRequest, context: Params) {
  const auth = await authorize(req, context);
  if (auth.response) return auth.response;
  const body = await readDesign(req);
  if (body.response) return body.response;
  await prisma.event.update({ where: { id: auth.id }, data: { pageDesignDraft: body.design } });
  return NextResponse.json({ message: "Draft saved" });
}

// POST /api/admin/event/[id]/page-design - publishes the given design and clears the draft.
export async function POST(req: NextRequest, context: Params) {
  const auth = await authorize(req, context);
  if (auth.response) return auth.response;
  const body = await readDesign(req);
  if (body.response) return body.response;
  const event = await prisma.event.update({
    where: { id: auth.id },
    data: { pageDesign: body.design, pageDesignDraft: Prisma.DbNull, pageDesignPublishedAt: new Date() },
    select: { pageDesignPublishedAt: true },
  });
  return NextResponse.json({ publishedAt: event.pageDesignPublishedAt });
}

// DELETE /api/admin/event/[id]/page-design - discards the draft so the editor starts from the published design again.
export async function DELETE(req: NextRequest, context: Params) {
  const auth = await authorize(req, context);
  if (auth.response) return auth.response;
  await prisma.event.update({ where: { id: auth.id }, data: { pageDesignDraft: Prisma.DbNull } });
  return NextResponse.json({ message: "Draft discarded" });
}
