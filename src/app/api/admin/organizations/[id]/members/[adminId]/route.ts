import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma/prisma";
import { checkAdminAuth } from "@/lib/auth/admin";
import { AdminOrgPermission } from "@/generated/prisma";

import { crewAssignmentSchema } from "@/types/schemas/crew";

const updateMemberSchema = z.object({
  permissions: z.array(z.nativeEnum(AdminOrgPermission)).optional(),
  ...crewAssignmentSchema.partial().shape,
}).strict().refine(value => Object.keys(value).length > 0, "No changes supplied");

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; adminId: string }> },
) {
  const auth = await checkAdminAuth(req.headers);
  if (!auth.authorized || !auth.adminId) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  const { id: orgId, adminId: targetAdminId } = await params;

  const org = await prisma.adminOrganization.findUnique({
    where: { id: orgId },
    select: { ownerId: true },
  });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  if (org.ownerId !== auth.adminId) {
    return NextResponse.json({ error: "Only the owner can update member permissions" }, { status: 403 });
  }
  if (targetAdminId === auth.adminId) {
    return NextResponse.json({ error: "Owner permissions cannot be modified this way" }, { status: 400 });
  }

  let body: z.infer<typeof updateMemberSchema>;
  try {
    body = updateMemberSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request", issues: err }, { status: 400 });
  }

  const membership = await prisma.adminOrganizationMembership.findUnique({
    where: { adminId_organizationId: { adminId: targetAdminId, organizationId: orgId } },
  });
  if (!membership) return NextResponse.json({ error: "Member not found in organization" }, { status: 404 });

  if (body.departmentId && !await prisma.crewDepartment.findFirst({ where: { id: body.departmentId, organizationId: orgId } })) {
    return NextResponse.json({ error: "Department does not belong to this organization" }, { status: 400 });
  }

  const updated = await prisma.adminOrganizationMembership.update({
    where: { adminId_organizationId: { adminId: targetAdminId, organizationId: orgId } },
    data: body,
  });

  return NextResponse.json({ membership: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; adminId: string }> },
) {
  const auth = await checkAdminAuth(req.headers);
  if (!auth.authorized || !auth.adminId) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  const { id: orgId, adminId: targetAdminId } = await params;

  const org = await prisma.adminOrganization.findUnique({
    where: { id: orgId },
    select: { ownerId: true },
  });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const isSelf = targetAdminId === auth.adminId;
  const isOwner = org.ownerId === auth.adminId;

  // Only owner can remove others; anyone can remove themselves (leave)
  if (!isSelf && !isOwner) {
    return NextResponse.json({ error: "Only the owner can remove members" }, { status: 403 });
  }
  if (isOwner && isSelf) {
    return NextResponse.json({ error: "Owner cannot leave the organization" }, { status: 400 });
  }

  await prisma.adminOrganizationMembership.delete({
    where: { adminId_organizationId: { adminId: targetAdminId, organizationId: orgId } },
  });

  return NextResponse.json({ success: true });
}
