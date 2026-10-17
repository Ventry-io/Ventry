import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import { getSession } from "@/lib/auth/session";
import { headers } from "next/headers";
import { AdminInvitationStatus } from "@/generated/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const session = await getSession(await headers());
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id: orgId, token } = await params;

  const invitation = await prisma.adminInvitation.findUnique({
    where: { token },
    select: {
      id: true,
      organizationId: true,
      invitedEmail: true,
      permissions: true,
      accessLevel: true,
      departmentId: true,
      role: true,
      status: true,
      expiresAt: true,
    },
  });

  if (!invitation || invitation.organizationId !== orgId) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }
  if (invitation.status !== AdminInvitationStatus.PENDING) {
    return NextResponse.json({ error: "Invitation is no longer pending" }, { status: 409 });
  }
  if (invitation.expiresAt < new Date()) {
    await prisma.adminInvitation.update({
      where: { id: invitation.id },
      data: { status: AdminInvitationStatus.EXPIRED },
    });
    return NextResponse.json({ error: "Invitation has expired" }, { status: 410 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, isAdmin: true, adminProfile: { select: { id: true } } },
  });

  if (!user || user.email !== invitation.invitedEmail) {
    return NextResponse.json({ error: "This invitation was sent to a different email address" }, { status: 403 });
  }

  if (!user.isAdmin || !user.adminProfile?.id) {
    return NextResponse.json({ error: "You must have an organizer account to accept this invitation" }, { status: 403 });
  }

  const adminId = user.adminProfile.id;

  const accepted = await prisma.$transaction(async tx => {
    const claimed = await tx.adminInvitation.updateMany({
      where: { id: invitation.id, status: AdminInvitationStatus.PENDING, expiresAt: { gt: new Date() } },
      data: { status: AdminInvitationStatus.ACCEPTED, invitedAdminId: adminId },
    });
    if (!claimed.count) return false;
    // Check not already a member
    const existing = await tx.adminOrganizationMembership.findUnique({
      where: { adminId_organizationId: { adminId, organizationId: orgId } },
    });

    if (!existing) {
      await tx.adminOrganizationMembership.create({
        data: {
          adminId,
          organizationId: orgId,
          permissions: invitation.permissions,
          accessLevel: invitation.accessLevel,
          departmentId: invitation.departmentId,
          role: invitation.role,
        },
      });
    }

    return true;
  });

  if (!accepted) return NextResponse.json({ error: "Invitation is no longer pending or has expired" }, { status: 409 });

  return NextResponse.json({ success: true });
}
