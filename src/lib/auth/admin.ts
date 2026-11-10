import { NextResponse } from "next/server";
import { auth } from "@/app/api/auth/auth";
import { prisma } from "@/lib/prisma/prisma";
import { headers } from "next/headers";
import { rethrowIfExpectedPrerenderInterruption } from "@/lib/next/prerender";
import type { AdminOrgPermission, Prisma } from "@/generated/prisma";

export type AdminAuthResult = {
  authorized: boolean;
  user?: { id: string; email: string };
  adminId?: string;
  error?: string;
};

export type EventAdminAuthResult = AdminAuthResult & {
  /** true when the admin owns the event directly */
  isEventOwner?: boolean;
  /** org membership that grants access, if applicable */
  orgId?: string;
  canWrite?: boolean;
};

const adminWithOrgsSelect = {
  id: true,
  email: true,
  isAdmin: true,
  adminProfile: {
    select: {
      id: true,
      type: true,
      organizationMemberships: {
        select: {
          organizationId: true,
          permissions: true,
          accessLevel: true,
          organization: { select: { ownerId: true } },
        },
      },
    },
  },
} as const;

export async function checkAdminAuth(requestHeaders?: Headers): Promise<AdminAuthResult> {
  try {
    const session = await auth.api.getSession({
      headers: requestHeaders || await headers()
    });

    if (!session?.user?.id) {
      return { authorized: false, error: "Not authenticated" };
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: adminWithOrgsSelect,
    });

    if (!user) {
      return { authorized: false, error: "User not found" };
    }

    if (!user.isAdmin) {
      return { authorized: false, error: "Admin access required" };
    }

    return {
      authorized: true,
      user: { id: user.id, email: user.email },
      adminId: user.adminProfile?.id,
    };
  } catch (error) {
    rethrowIfExpectedPrerenderInterruption(error);
    console.error("Admin auth check failed:", error);
    return { authorized: false, error: "Authentication check failed" };
  }
}

/**
 * Checks if the authenticated admin may act on the given event.
 * An admin may act if they personally own the event OR belong to the
 * organization that owns the event (with an optional required permission).
 */
export async function checkEventAdminAuth(
  eventId: number,
  requiredPermission?: AdminOrgPermission,
  requestHeaders?: Headers,
  requireWrite = false,
): Promise<EventAdminAuthResult> {
  try {
    const session = await auth.api.getSession({
      headers: requestHeaders || await headers()
    });

    if (!session?.user?.id) {
      return { authorized: false, error: "Not authenticated" };
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: adminWithOrgsSelect,
    });

    if (!user || !user.isAdmin || !user.adminProfile) {
      return { authorized: false, error: "Admin access required" };
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { ownerId: true, organizationId: true },
    });

    if (!event) {
      return { authorized: false, error: "Event not found" };
    }

    const admin = user.adminProfile;

    // Individual ownership
    if (event.ownerId === admin.id) {
      return {
        authorized: true,
        user: { id: user.id, email: user.email },
        adminId: admin.id,
        isEventOwner: true,
        canWrite: true,
      };
    }

    // Organization ownership
    if (event.organizationId) {
      const membership = admin.organizationMemberships.find(
        m => m.organizationId === event.organizationId
      );
      if (membership) {
        const isOrgOwner = membership.organization?.ownerId === admin.id;
        const canWrite = isOrgOwner || membership.accessLevel === "WRITE";
        if (requireWrite && !canWrite) return { authorized: false, error: "Read-only organization access" };
        if (!isOrgOwner && requiredPermission && !membership.permissions.includes(requiredPermission)) {
          return { authorized: false, error: "Insufficient organization permissions" };
        }
        return {
          authorized: true,
          user: { id: user.id, email: user.email },
          adminId: admin.id,
          isEventOwner: false,
          orgId: event.organizationId,
          canWrite,
        };
      }
    }

    return { authorized: false, error: "No access to this event" };
  } catch (error) {
    rethrowIfExpectedPrerenderInterruption(error);
    console.error("Event admin auth check failed:", error);
    return { authorized: false, error: "Authentication check failed" };
  }
}

/**
 * Returns a Prisma `where` filter that matches events accessible to the given admin.
 *
 * orgScope:
 *   undefined / "all" — personal + all org events (default)
 *   "personal"        — only directly owned events
 *   <orgId>           — only events for that org (if admin is a member)
 */
export async function adminEventFilter(adminId: string, orgScope?: string) {
  if (orgScope === "personal") {
    return { ownerId: adminId };
  }

  if (orgScope && orgScope !== "all") {
    const membership = await prisma.adminOrganizationMembership.findFirst({
      where: { adminId, organizationId: orgScope },
      select: { organizationId: true },
    });
    if (membership) {
      return { organizationId: orgScope };
    }
    // Invalid org or not a member — fall through to "all"
  }

  const memberships = await prisma.adminOrganizationMembership.findMany({
    where: { adminId },
    select: { organizationId: true },
  });
  const orgIds = memberships.map((m) => m.organizationId);
  return {
    OR: [
      { ownerId: adminId },
      ...(orgIds.length > 0 ? [{ organizationId: { in: orgIds } }] : []),
    ],
  };
}

export async function getAdminFinanceAccess(adminId: string, orgScope?: string): Promise<{
  eventFilter: Prisma.EventWhereInput | null;
  hasRestrictedOrganizations: boolean;
}> {
  if (orgScope === "personal") {
    return { eventFilter: { ownerId: adminId }, hasRestrictedOrganizations: false };
  }

  const memberships = await prisma.adminOrganizationMembership.findMany({
    where: { adminId },
    select: { organizationId: true, permissions: true, organization: { select: { ownerId: true } } },
  });
  const allowed = memberships.filter(m =>
    m.organization.ownerId === adminId || m.permissions.includes("STRIPE_FINANCES")
  );

  if (orgScope && orgScope !== "all") {
    return {
      eventFilter: allowed.some(m => m.organizationId === orgScope) ? { organizationId: orgScope } : null,
      hasRestrictedOrganizations: false,
    };
  }

  return {
    eventFilter: {
      OR: [
        { ownerId: adminId },
        ...(allowed.length ? [{ organizationId: { in: allowed.map(m => m.organizationId) } }] : []),
      ],
    },
    hasRestrictedOrganizations: allowed.length < memberships.length,
  };
}

export function unauthorizedResponse(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbiddenResponse(message = "Forbidden - Admin access required") {
  return NextResponse.json({ error: message }, { status: 403 });
}
