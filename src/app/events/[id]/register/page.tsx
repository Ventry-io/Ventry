import { prisma } from "@/lib/prisma/prisma";
import { getSession } from "@/lib/auth/session";
import { normalizeStayPolicy } from "@/lib/events/accommodation";
import { redirect, notFound } from "next/navigation";
import { Container, Box, Typography } from "@mui/material";
import RegistrationWizard from "./RegistrationWizard";
import type { SerializedProduct, SerializedStayPolicy } from "@/types/event";
import { Suspense } from "react";
import PageLoadingState from "@/components/common/PageLoadingState";

interface SerializedEventForWizard {
  id: number;
  name: string;
  products: SerializedProduct[];
  stayPolicy: SerializedStayPolicy | null;
  requiresHotel?: boolean;
  requireApproval?: boolean;
  customFields: { id: string; label: string; type: "text" | "number" | "boolean" | "select"; required: boolean; options?: string[] }[];
}

export default function RegisterEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <RegisterEventPageContent params={params} />
    </Suspense>
  );
}

async function RegisterEventPageContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session?.user) {
    const id = (await params).id;
    redirect(`/login?callbackUrl=/events/${id}/register`);
  }

  const id = Number((await params).id);
  if (Number.isNaN(id)) notFound();

  const event = await prisma.event.findUnique({
    where: { id, status: 'PUBLISHED' },
    include: {
      products: {
        orderBy: { createdAt: "asc" }
      },
    }
  });

  if (!event) notFound();
  if (!event.products.some(product => product.type === "TICKET")) redirect(`/events/${id}`);

  // Check if already registered
  const existingRegistration = await prisma.registration.findUnique({
    where: {
      userId_eventId: {
        userId: session.user.id,
        eventId: id
      }
    },
    include: {
      registrationItems: {
        include: {
          product: true
        }
      },
      payments: {
        orderBy: { createdAt: "desc" }
      }
    },
  });
  const hasCompletedPayment = existingRegistration?.payments.some(payment => payment.paymentStatus === "COMPLETED") || false;
  const resolvedEditMode =
    existingRegistration
      ? hasCompletedPayment
        ? "extras"
        : "full"
      : "create";

  const serializedEvent: SerializedEventForWizard = {
    id: event.id,
    name: event.name,
    products: event.products.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      description: p.description,
      type: p.type,
      capacity: p.capacity
    })),
    stayPolicy: normalizeStayPolicy(
      event.stayPolicy,
      event.products.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        description: p.description,
        type: p.type as SerializedProduct["type"],
        capacity: p.capacity
      })),
      event.name,
      event.startDate,
      event.endDate
    ) as SerializedStayPolicy,
    requiresHotel: event.requiresHotel,
    requireApproval: event.requireApproval,
    customFields: event.customFields as unknown as SerializedEventForWizard['customFields']
  };

  return (
    <Container maxWidth="lg" sx={{ py: 8 }}>
      <Box mb={4}>
        <Typography variant="h3" component="h1" gutterBottom fontWeight="bold">
          {existingRegistration ? 'Edit Registration' : 'Registration'}
        </Typography>
        <Typography variant="h5" color="text.secondary">
          {event.name}
        </Typography>
      </Box>

      <RegistrationWizard 
        event={serializedEvent} 
        userId={session.user.id} 
        editMode={resolvedEditMode}
        initialRegistration={existingRegistration as unknown as {
          id: string;
          preferences: {
            productId?: string;
            accommodationId?: string;
            productIds?: string[];
            needsHotel?: boolean;
            earlyArrival?: boolean;
            lateDeparture?: boolean;
            customFieldsData?: Record<string, string | number | boolean>;
            showOnAttendees?: boolean;
          };
          status: string;
          registrationItems: {
            productId: string;
            product: SerializedProduct;
          }[];
          payments: {
            id: string;
            amount: number;
            paymentStatus: string;
          }[];
        }}
      />
    </Container>
  );
}
