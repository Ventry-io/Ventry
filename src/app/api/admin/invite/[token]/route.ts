import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import { checkAdminAuth } from "@/lib/auth/admin";
import { AdminInvitationStatus } from "@/generated/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = await checkAdminAuth(req.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { token } = await params;

  const invitation = await prisma.adminInvitation.findUnique({
    where: { token },
    select: {
      id: true,
      organizationId: true,
      invitedEmail: true,
      permissions: true,
      accessLevel: true,
      role: true,
      department: { select: { name: true } },
      status: true,
      expiresAt: true,
      organization: { select: { name: true, slug: true } },
      invitedByAdmin: { select: { user: { select: { name: true } } } },
    },
  });

  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  if (invitation.status !== AdminInvitationStatus.PENDING) {
    return NextResponse.json({ error: "Invitation is no longer pending", status: invitation.status }, { status: 410 });
  }

  if (invitation.expiresAt < new Date()) {
    await prisma.adminInvitation.update({
      where: { id: invitation.id },
      data: { status: AdminInvitationStatus.EXPIRED },
    });
    return NextResponse.json({ error: "Invitation has expired" }, { status: 410 });
  }

  return NextResponse.json({
    invitation: {
      organizationId: invitation.organizationId,
      organizationName: invitation.organization.name,
      organizationSlug: invitation.organization.slug,
      invitedEmail: invitation.invitedEmail,
      inviterName: invitation.invitedByAdmin.user.name,
      permissions: invitation.permissions,
      accessLevel: invitation.accessLevel,
      role: invitation.role,
      department: invitation.department?.name || null,
      expiresAt: invitation.expiresAt.toISOString(),
    },
  });
}
