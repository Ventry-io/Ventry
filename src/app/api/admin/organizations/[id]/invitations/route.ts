import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma/prisma";
import { checkAdminAuth } from "@/lib/auth/admin";
import { AdminOrgPermission, AdminInvitationStatus, NotificationType } from "@/generated/prisma";
import { renderComponentToHTML } from "@/lib/helpers/html";
import { sendMail } from "@/lib/mail";
import { createNotification } from "@/lib/notifications";
import OrgInvitationMail from "@/components/emails/OrgInvitationMail";
import { crewAssignmentSchema } from "@/types/schemas/crew";

function getAppBaseUrl() {
  return process.env.BETTER_AUTH_URL || process.env.NEXTAUTH_URL || "https://local.dev:3443";
}

const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  ...crewAssignmentSchema.shape,
  permissions: z.array(z.nativeEnum(AdminOrgPermission)).default([]),
}).strict();

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
    select: { ownerId: true, members: { select: { adminId: true } } },
  });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const isMember = org.members.some(m => m.adminId === auth.adminId);
  if (!isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const invitations = await prisma.adminInvitation.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      token: true,
      invitedEmail: true,
      permissions: true,
      accessLevel: true,
      departmentId: true,
      role: true,
      department: { select: { name: true } },
      status: true,
      expiresAt: true,
      createdAt: true,
      invitedByAdmin: { select: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ invitations });
}

export async function POST(
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
    select: {
      name: true,
      ownerId: true,
      owner: { select: { user: { select: { name: true } } } },
    },
  });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  if (org.ownerId !== auth.adminId) {
    return NextResponse.json({ error: "Only the organization owner can send invitations" }, { status: 403 });
  }

  let body: z.infer<typeof createInvitationSchema>;
  try {
    body = createInvitationSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request", issues: err }, { status: 400 });
  }

  // Stripe permissions are sensitive — must be explicitly in the request (already handled by schema)
  // Block re-inviting an already-active member
  const existingMember = await prisma.adminOrganizationMembership.findFirst({
    where: {
      organizationId: orgId,
      admin: { user: { email: body.email } },
    },
  });
  if (existingMember) {
    return NextResponse.json({ error: "User is already a member of this organization" }, { status: 409 });
  }

  // Check for existing pending invitation
  const existingInvite = await prisma.adminInvitation.findFirst({
    where: {
      organizationId: orgId,
      invitedEmail: body.email,
      status: AdminInvitationStatus.PENDING,
      expiresAt: { gt: new Date() },
    },
  });
  if (existingInvite) {
    return NextResponse.json({ error: "Pending invitation already exists for this email" }, { status: 409 });
  }

  const invitedUser = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true, isAdmin: true, adminProfile: { select: { id: true } } },
  });

  if (!invitedUser?.isAdmin || !invitedUser.adminProfile) {
    return NextResponse.json(
      { error: "No admin account found for this email. Only existing organizer accounts can be invited." },
      { status: 404 },
    );
  }

  if (body.departmentId && !await prisma.crewDepartment.findFirst({ where: { id: body.departmentId, organizationId: orgId } })) {
    return NextResponse.json({ error: "Department does not belong to this organization" }, { status: 400 });
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invitation = await prisma.adminInvitation.create({
    data: {
      organizationId: orgId,
      invitedEmail: body.email,
      invitedAdminId: invitedUser.adminProfile.id,
      invitedByAdminId: auth.adminId,
      permissions: body.permissions,
      accessLevel: body.accessLevel,
      departmentId: body.departmentId,
      role: body.role,
      expiresAt,
    },
  });

  const inviterName = org.owner.user.name || "An organizer";
  const acceptUrl = `${getAppBaseUrl()}/admin/invite/${invitation.token}`;
  const expiresAtFormatted = expiresAt.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let emailSent = false;
  try {
    const html = await renderComponentToHTML(OrgInvitationMail, {
      orgName: org.name,
      inviterName,
      invitedEmail: body.email,
      acceptUrl,
      expiresAt: expiresAtFormatted,
    });
    await sendMail(body.email, `You've been invited to join ${org.name} on Ventry`, html);
    emailSent = true;
  } catch (err) {
    console.error("Failed to send invitation email:", err);
  }

  try {
    await createNotification(
        invitedUser.id,
        NotificationType.SYSTEM,
        `You've been invited to join ${org.name}`,
        `${inviterName} invited you to become an organizer for ${org.name}.`,
        `/admin/invite/${invitation.token}`,
      );
  } catch (err) {
    console.error("Failed to send invitation notification:", err);
  }

  return NextResponse.json({ invitation, emailSent }, { status: 201 });
}
