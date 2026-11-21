import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Box } from "@mui/material";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { storageHost } from "@/lib/events/page-css";
import { prisma } from "@/lib/prisma/prisma";
import { normalizeEventPage } from "@/types/schemas/event/page";
import PageLoadingState from "@/components/common/PageLoadingState";
import PageDesigner from "@/components/admin/events/page-editor/PageDesigner";

export default function AdminEventPageDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <AdminEventPageDesignerContent params={params} />
    </Suspense>
  );
}

async function AdminEventPageDesignerContent({ params }: { params: Promise<{ id: string }> }) {
  const eventId = Number((await params).id);
  if (!Number.isInteger(eventId)) notFound();

  const auth = await checkEventAdminAuth(eventId);
  if (!auth.authorized) {
    if (auth.error === "Event not found") notFound();
    redirect(`/login?callbackUrl=/admin/events/${eventId}/page-designer`);
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, name: true, description: true, imageUrl: true, pageDesign: true, pageDesignDraft: true, pageDesignPublishedAt: true, location: { select: { name: true, address: true, city: true, country: true } } },
  });
  if (!event) notFound();

  const { pageDesign, pageDesignDraft, pageDesignPublishedAt, ...preview } = event;
  return (
    <Box sx={{ py: 2 }}>
      <PageDesigner published={normalizeEventPage(pageDesign)} draft={pageDesignDraft === null ? null : normalizeEventPage(pageDesignDraft)}
        publishedAt={pageDesignPublishedAt?.toISOString() ?? null} event={preview} assetHost={storageHost()} canWrite={Boolean(auth.canWrite)} />
    </Box>
  );
}
