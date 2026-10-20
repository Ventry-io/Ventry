import { type NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { prisma } from "@/lib/prisma/prisma";
import { normalizeBadgeTemplate } from "@/lib/badges/badge";
import { badgeTemplateInputSchema } from "@/types/schemas/badge";
import { z } from "zod";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const eventId = Number((await params).id);
  if (Number.isNaN(eventId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const authResult = await checkEventAdminAuth(eventId, req.headers);
  if (!authResult.authorized) return NextResponse.json({ error: authResult.error || "Forbidden" }, { status: 403 });

  const templates = await prisma.badgeTemplate.findMany({
    where: { eventId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  return NextResponse.json({ templates: templates.map(normalizeBadgeTemplate) }, { status: 200 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const eventId = Number((await params).id);
    if (Number.isNaN(eventId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    const authResult = await checkEventAdminAuth(eventId, req.headers, undefined, true);
    if (!authResult.authorized) return NextResponse.json({ error: authResult.error || "Forbidden" }, { status: 403 });

    const body = await req.json();
    const data = badgeTemplateInputSchema.parse(body);

    const template = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.badgeTemplate.updateMany({
          where: { eventId },
          data: { isDefault: false },
        });
      }

      return tx.badgeTemplate.create({
        data: {
          eventId,
          name: data.name,
          isDefault: data.isDefault,
          widthMm: data.widthMm,
          heightMm: data.heightMm,
          background: data.background as Prisma.InputJsonValue,
          elements: data.elements as Prisma.InputJsonValue,
        },
      });
    });

    return NextResponse.json({ template: normalizeBadgeTemplate(template) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 422 });
    }

    console.error("Error creating badge template:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
