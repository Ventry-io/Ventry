import { prisma } from "@/lib/prisma/prisma";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { normalizeStayPolicy } from "@/lib/events/accommodation";
import { redirect, notFound } from "next/navigation";
import EditEventClient from "./EditEventClient";
import type { Prisma } from "@/generated/prisma";
import type { SerializedEvent, SerializedProduct } from "@/types/event";
import { Suspense } from "react";
import PageLoadingState from "@/components/common/PageLoadingState";

const editEventInclude = {
  location: true,
  products: {
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.EventInclude;

type EditEventData = Prisma.EventGetPayload<{
  include: typeof editEventInclude;
}>;

export default function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <EditEventPageContent params={params} />
    </Suspense>
  );
}

async function EditEventPageContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (Number.isNaN(id)) notFound();

  const authResult = await checkEventAdminAuth(id);
  if (!authResult.authorized) {
    redirect("/login?callbackUrl=/admin/events");
  }

  const event: EditEventData | null = await prisma.event.findUnique({
    where: { id },
    include: editEventInclude,
  });

  if (!event) notFound();

  // Serialize dates for client component
  const serializedEvent: SerializedEvent = {
    ...event,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    products: event.products.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        description: p.description,
        type: p.type as SerializedProduct['type'],
        capacity: p.capacity,
        soldCount: p.soldCount
    })),
    stayPolicy: normalizeStayPolicy(
      event.stayPolicy,
      event.products.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        description: p.description,
        type: p.type as SerializedProduct['type'],
        capacity: p.capacity,
        soldCount: p.soldCount
      })),
      event.location?.name || event.name,
      event.startDate,
      event.endDate
    ),
    schedule: (event.schedule as unknown as SerializedEvent["schedule"]) || [],
  };

  return <EditEventClient event={serializedEvent} canWrite={authResult.canWrite} />;
}
