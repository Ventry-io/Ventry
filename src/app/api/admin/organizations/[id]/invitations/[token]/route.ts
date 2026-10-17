import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import { checkAdminAuth } from "@/lib/auth/admin";
import { AdminInvitationStatus } from "@/generated/prisma";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const auth = await checkAdminAuth(req.headers);
  if (!auth.authorized || !auth.adminId) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  const { id: orgId, token } = await params;

  const org = await prisma.adminOrganization.findUnique({
    where: { id: orgId },
    select: { ownerId: true },
  });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  if (org.ownerId !== auth.adminId) {
    return NextResponse.json({ error: "Only the organization owner can revoke invitations" }, { status: 403 });
  }

  const invitation = await prisma.adminInvitation.findUnique({
    where: { token },
    select: { id: true, organizationId: true, status: true },
  });

  if (!invitation || invitation.organizationId !== orgId) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }
  if (invitation.status !== AdminInvitationStatus.PENDING) {
    return NextResponse.json({ error: "Only pending invitations can be revoked" }, { status: 409 });
  }

  const revoked = await prisma.adminInvitation.deleteMany({ where: { id: invitation.id, status: AdminInvitationStatus.PENDING } });
  if (!revoked.count) return NextResponse.json({ error: "Invitation is no longer pending" }, { status: 409 });

  return NextResponse.json({ success: true });
}
