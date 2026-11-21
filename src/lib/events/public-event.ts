import type { Prisma } from "@/generated/prisma";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma/prisma";

export type EventViewer = Awaited<ReturnType<typeof getEventViewer>>;

/** The signed-in visitor with the admin memberships that decide draft visibility. */
export async function getEventViewer(headers?: Headers) {
  const session = await getSession(headers);
  const user = session?.user ? await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      legalName: true, addressLine1: true, addressCity: true, addressPostalCode: true, addressCountry: true,
      isAdmin: true, adminProfile: { select: { id: true, organizationMemberships: { select: { organizationId: true } } } },
    },
  }) : null;
  const admin = user?.isAdmin ? user.adminProfile : null;
  return { session, user, admin, orgIds: admin?.organizationMemberships.map(m => m.organizationId) ?? [] };
}

/** Published (or due) events for everyone; drafts only for the owner and organization admins. */
export function visibleEventWhere(id: number, viewer: EventViewer): Prisma.EventWhereInput {
  return {
    id,
    OR: [
      { status: "PUBLISHED" },
      { status: "DRAFT", publishAt: { lte: new Date() } },
      ...(viewer.admin ? [
        { ownerId: viewer.admin.id },
        { organization: { ownerId: viewer.admin.id } },
        ...(viewer.orgIds.length ? [{ organizationId: { in: viewer.orgIds } }] : []),
      ] : []),
    ],
  };
}

export function canEditEvent(event: { ownerId: string | null; organizationId: string | null }, viewer: EventViewer) {
  return !!viewer.admin && (event.ownerId === viewer.admin.id || (event.organizationId != null && viewer.orgIds.includes(event.organizationId)));
}
