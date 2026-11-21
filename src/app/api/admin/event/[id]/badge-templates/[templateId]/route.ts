import { type NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { prisma } from "@/lib/prisma/prisma";
import { normalizeBadgeTemplate } from "@/lib/badges/badge";
import { badgeTemplatePatchSchema } from "@/types/schemas/badge";
import { z } from "zod";

async function authorize(eventId: number, request: NextRequest) {
  const authResult = await checkEventAdminAuth(eventId, request.headers, undefined, true);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || "Forbidden" }, { status: 403 });
  }

  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    const { id, templateId } = await params;
    const eventId = Number(id);
    if (Number.isNaN(eventId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    const forbidden = await authorize(eventId, req);
    if (forbidden) return forbidden;

    const body = await req.json();
    const data = badgeTemplatePatchSchema.parse(body);

    const template = await prisma.$transaction(async (tx) => {
      const result = await tx.badgeTemplate.updateMany({
        where: { id: templateId, eventId },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
          ...(data.widthMm !== undefined && { widthMm: data.widthMm }),
          ...(data.heightMm !== undefined && { heightMm: data.heightMm }),
          ...(data.background !== undefined && { background: data.background as Prisma.InputJsonValue }),
          ...(data.elements !== undefined && { elements: data.elements as Prisma.InputJsonValue }),
        },
      });

      if (result.count === 0) return null;

      if (data.isDefault) {
        await tx.badgeTemplate.updateMany({
          where: { eventId, id: { not: templateId } },
          data: { isDefault: false },
        });
      }

      return tx.badgeTemplate.findFirst({
        where: { id: templateId, eventId },
      });
    });

    if (!template) return NextResponse.json({ error: "Badge template not found" }, { status: 404 });

    return NextResponse.json({ template: normalizeBadgeTemplate(template) }, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 422 });
    }

    console.error("Error updating badge template:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const { id, templateId } = await params;
  const eventId = Number(id);
  if (Number.isNaN(eventId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const forbidden = await authorize(eventId, req);
  if (forbidden) return forbidden;

  const result = await prisma.badgeTemplate.deleteMany({ where: { id: templateId, eventId } });
  if (result.count === 0) return NextResponse.json({ error: "Badge template not found" }, { status: 404 });

  return NextResponse.json({ message: "Badge template deleted" }, { status: 200 });
}
