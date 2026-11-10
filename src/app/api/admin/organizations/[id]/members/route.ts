import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import { checkAdminAuth } from "@/lib/auth/admin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await checkAdminAuth(req.headers);
  if (!auth.authorized || !auth.adminId) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  const { id: orgId } = await params;

  const org = await prisma.adminOrganization.findUnique({
    where: { id: orgId },
    select: { members: { select: { adminId: true } } },
  });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const isMember = org.members.some(m => m.adminId === auth.adminId);
  if (!isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const members = await prisma.adminOrganizationMembership.findMany({
    where: { organizationId: orgId },
    select: {
      adminId: true,
      permissions: true,
      accessLevel: true,
      departmentId: true,
      role: true,
      department: { select: { name: true } },
      joinedAt: true,
      admin: {
        select: {
          id: true,
          type: true,
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  return NextResponse.json({ members });
}
