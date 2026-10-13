import { notFound, redirect } from "next/navigation";
import BadgeDesigner from "@/components/admin/badges/BadgeDesigner";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { DEFAULT_BADGE_TEMPLATE, normalizeBadgeTemplate } from "@/lib/badges/badge";
import { loadBadgeAttendees } from "@/lib/badges/server";
import { prisma } from "@/lib/prisma/prisma";

type CustomFieldOption = {
  id: string;
  label: string;
};

function normalizeCustomFields(raw: unknown): CustomFieldOption[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((field) => {
    if (!field || typeof field !== "object") return [];
    const candidate = field as { id?: unknown; label?: unknown };
    if (typeof candidate.id !== "string" || typeof candidate.label !== "string") return [];
    return [{ id: candidate.id, label: candidate.label }];
  });
}

export default async function AdminEventBadgesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const eventId = Number((await params).id);
  if (Number.isNaN(eventId)) notFound();

  const authResult = await checkEventAdminAuth(eventId);
  if (!authResult.authorized) {
    redirect("/login?callbackUrl=/admin/events");
  }

  const [event, templates, attendees] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        customFields: true,
        products: {
          where: { type: "TICKET" },
          orderBy: { order: "asc" },
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.badgeTemplate.findMany({
      where: { eventId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    }),
    loadBadgeAttendees(eventId, { status: "CONFIRMED" }),
  ]);

  if (!event) notFound();

  return (
    <BadgeDesigner
      canWrite={authResult.canWrite}
      eventId={event.id}
      eventName={event.name}
      initialTemplates={templates.map(normalizeBadgeTemplate)}
      fallbackTemplate={{ ...DEFAULT_BADGE_TEMPLATE, name: `${event.name} Badge` }}
      initialAttendees={attendees}
      ticketTiers={event.products}
      customFields={normalizeCustomFields(event.customFields)}
    />
  );
}
