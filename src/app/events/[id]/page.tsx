import { prisma } from "@/lib/prisma/prisma";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { calculateMaximumStaySurcharge, normalizeStayPolicy, resolveAccommodationHotels } from "@/lib/events/accommodation";
import {
  Container,
  Box,
  Typography,
  Grid,
  Paper,
  Stack,
  Button,
  Divider,
  Chip,
  Alert
} from "@mui/material";
import { 
  CalendarMonth, 
  LocationOn, 
  AccessTime, 
  ConfirmationNumber,
  Edit
} from "@mui/icons-material";
import Image from "next/image";
import EventRegistrationStatus from "@/components/events/EventRegistrationStatus";
import RegistrationCountdown from "@/components/events/RegistrationCountdown";
import EventSchedule from "@/components/events/EventSchedule";
import EventLocationMap from "@/components/events/EventLocationMap";
import SupportTicketPanel from "@/components/events/SupportTicketPanel";
import CommunitySection from "@/components/events/community/CommunitySection";
import type { SerializedEvent, SerializedProduct } from "@/types/event";
import { Suspense } from "react";
import PageLoadingState from "@/components/common/PageLoadingState";
import { hasCheckInIdentity, hasBillingAddress } from "@/lib/user/profile-completion";
import { AttendeeCard } from "./AttendeeCard";

const eventDateFormatter = new Intl.DateTimeFormat("en-US");

export default function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ message?: string }>;
}) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <EventDetailPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EventDetailPageContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ message?: string }>;
}) {
  const id = Number((await params).id);
  if (Number.isNaN(id)) notFound();

  const { message } = await searchParams;
  const session = await getSession();
  const bookingIdentity = session?.user ? await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { legalName: true, addressLine1: true, addressCity: true, addressPostalCode: true, addressCountry: true },
  }) : null;

  const event = await prisma.event.findFirst({
    where: { 
      id,
      OR: [
        { status: 'PUBLISHED' },
        { 
          status: 'DRAFT',
          publishAt: { lte: new Date() } // Auto-publish check
        },
        // Allow admins to view drafts
        ...(session?.user?.id ? [{ 
          ownerId: session.user.id
        }] : [])
      ]
    },
    include: {
      location: true,
      products: {
        orderBy: { createdAt: "asc" }
      },
      registrations: {
        where: { status: { not: 'CANCELLED' } },
        select: {
          userId: true,
          preferences: true
        }
      },
      _count: {
        select: { registrations: true }
      }
    }
  });

  if (!event) notFound();

  // Check if user owns or has org access to this event
  let canEdit = false;
  if (session?.user?.id) {
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        isAdmin: true,
        adminProfile: {
          select: {
            id: true,
            organizationMemberships: { select: { organizationId: true } },
          },
        },
      },
    });
    const adminId = dbUser?.adminProfile?.id;
    const orgIds = dbUser?.adminProfile?.organizationMemberships.map((m) => m.organizationId) ?? [];
    canEdit =
      !!adminId &&
      (event.ownerId === adminId ||
        (event.organizationId != null && orgIds.includes(event.organizationId)));
  }

  // If it was a scheduled draft, update its status to PUBLISHED proactively
  if (event.status === 'DRAFT' && event.publishAt && new Date(event.publishAt) <= new Date()) {
    await prisma.event.update({
      where: { id: event.id },
      data: { status: 'PUBLISHED' }
    });
  }

  // Check if user is registered
  const registration = session?.user?.id ? await prisma.registration.findUnique({
    where: {
      userId_eventId: {
        userId: session.user.id,
        eventId: id
      }
    },
    include: {
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 1
      }
    }
  }) : null;

  const canOpenSupportTicket = !!registration && registration.status !== "CANCELLED";

  // Add expiresAt to the cast/serialization if needed, 
  // but Prisma already includes it in the object since we updated the schema.
  // I'll make sure the props passed to EventRegistrationStatus are correct.

  const startDate = new Date(event.startDate);
  const endDate = new Date(event.endDate);
  // eslint-disable-next-line react-hooks/purity -- Request-time calculation in an async server component.
  const eventEnded = endDate.getTime() < Date.now();
  const serializedProducts = event.products.map(p => ({
    id: p.id,
    name: p.name,
    price: p.price,
    description: p.description,
    type: p.type as SerializedProduct['type'],
    capacity: p.capacity,
    soldCount: p.soldCount
  }));
  const stayPolicy = normalizeStayPolicy(
    event.stayPolicy,
    serializedProducts,
    event.location?.name || event.name,
    event.startDate,
    event.endDate
  );
  const accommodationHotels = resolveAccommodationHotels(
    stayPolicy,
    serializedProducts,
    event.location?.name || event.name,
    event.startDate,
    event.endDate
  );
  const maximumStaySurcharge = calculateMaximumStaySurcharge(
    stayPolicy,
    serializedProducts,
    event.location?.name || event.name,
    event.startDate,
    event.endDate
  );
  const visibleUserIds = event.registrations
    .filter((registration) => {
      const preferences = registration.preferences as { showOnAttendees?: boolean } | null;
      return !!preferences?.showOnAttendees;
    })
    .map((registration) => registration.userId);
  const uniqueVisibleUserIds = Array.from(new Set(visibleUserIds));
  const visibleUsers = uniqueVisibleUserIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: uniqueVisibleUserIds } },
        select: {
          id: true,
          name: true,
          country: true,
          profilePictures: {
            orderBy: [
              { order: 'asc' },
              { isPrimary: 'desc' },
              { createdAt: 'desc' }
            ],
            select: {
              signedUrl: true,
              isPrimary: true,
              order: true,
              createdAt: true
            }
          }
        }
      })
    : [];
  const visibleUsersById = new Map(visibleUsers.map(user => [user.id, user]));
  const attendees = event.registrations.map((registration, index) => {
    const preferences = registration.preferences as { showOnAttendees?: boolean } | null;
    if (!preferences?.showOnAttendees) {
      return {
        id: `anonymous-${index}`,
        name: "Anonymous",
        country: null,
        imageUrl: null
      };
    }

    const user = visibleUsersById.get(registration.userId);
    const primaryPicture = user?.profilePictures.find(p => p.isPrimary) || user?.profilePictures[0];

    return {
      id: user?.id || `anonymous-${index}`,
      name: user?.name || "Anonymous",
      country: user?.country || null,
      imageUrl: primaryPicture?.signedUrl || null
    };
  });

  // Serialize event for client components
  const serializedEvent: SerializedEvent = {
    ...event,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    stayPolicy,
    schedule: (event.schedule as unknown as SerializedEvent['schedule']) || [],
    products: serializedProducts
  };

  return (
    <Box>
      {/* Success Alert */}
      {message === 'update_success' && (
        <Container maxWidth="lg" sx={{ mt: 2 }}>
          <Alert severity="success" sx={{ borderRadius: 2 }}>
            Your registration preferences have been updated successfully.
          </Alert>
        </Container>
      )}

      {message === 'approval_pending' && (
        <Container maxWidth="lg" sx={{ mt: 2 }}>
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            Your registration has been submitted and is awaiting admin approval before payment.
          </Alert>
        </Container>
      )}

      {/* Hero Banner */}
      <Box sx={{ position: 'relative', height: { xs: 300, md: 500 }, width: '100%', bgcolor: 'grey.900' }}>
        {event.imageUrl ? (
          <Image
            src={event.imageUrl}
            alt={event.name}
            fill
            sizes="100vw"
            preload
            loading="eager"
            style={{ objectFit: 'cover', opacity: 0.7 }}
          />
        ) : (
          <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="h2" color="grey.700">Ventry</Typography>
          </Box>
        )}
        <Box 
          sx={{ 
            position: 'absolute', 
            bottom: 0, 
            left: 0, 
            width: '100%', 
            p: { xs: 4, md: 8 },
            background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)',
            color: 'white'
          }}
        >
          <Container maxWidth="lg">
            <Typography variant="h2" component="h1" fontWeight="bold" gutterBottom>
              {event.name}
            </Typography>
            <Stack direction="row" spacing={3}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CalendarMonth />
                <Typography variant="h6">
                  {eventDateFormatter.format(startDate)} - {eventDateFormatter.format(endDate)}
                </Typography>
              </Box>
              {event.location && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LocationOn />
                  <Typography variant="h6">
                    {event.location.city}, {event.location.country}
                  </Typography>
                </Box>
              )}
            </Stack>
          </Container>
        </Box>
      </Box>

      {/* Content */}
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Grid container spacing={6}>
          {/* Main Info */}
          <Grid size={{ xs: 12, md: 8 }}>
            <Box mb={6}>
              <Typography variant="h4" gutterBottom fontWeight="bold">About this Event</Typography>
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary', fontSize: '1.1rem' }}>
                {event.description}
              </Typography>
            </Box>

            {/* Schedule */}
            {serializedEvent.schedule && serializedEvent.schedule.length > 0 && (
              <Box mb={6}>
                <EventSchedule schedule={serializedEvent.schedule} />
              </Box>
            )}

            {event.location && (
              <Box mb={6}>
                <Typography variant="h4" gutterBottom fontWeight="bold">Location</Typography>
                <Paper variant="outlined" sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>{event.location.name}</Typography>
                  <Typography color="text.secondary">{event.location.address}</Typography>
                  <Typography color="text.secondary">
                    {event.location.postalCode} {event.location.city}
                  </Typography>
                  <Typography color="text.secondary">{event.location.state}, {event.location.country}</Typography>
                  <EventLocationMap location={event.location} />
                </Paper>
              </Box>
            )}

            <Box mb={6}>
              <Typography variant="h4" gutterBottom fontWeight="bold">Attendees</Typography>
              <Paper variant="outlined" sx={{ p: 3 }}>
                {attendees.length === 0 ? (
                  <Typography color="text.secondary">No attendees yet.</Typography>
                ) : (
                  <Grid container spacing={2}>
                    {attendees.map((attendee) => (
                      <Grid key={attendee.id} size={{ xs: 12, sm: 6, md: 4 }}>
                        <AttendeeCard attendee={attendee} />
                      </Grid>
                    ))}
                  </Grid>
                )}
              </Paper>
            </Box>

            {event.communityEnabled && (
              <Box mb={6}>
                <CommunitySection
                  eventId={event.id}
                  eventEnded={eventEnded}
                  communityOpenAfterEnd={event.communityOpenAfterEnd}
                  currentUserId={session?.user?.id || null}
                  canModerate={canEdit}
                />
              </Box>
            )}
          </Grid>

          {/* Registration Sidebar */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Stack spacing={3} sx={{ position: 'sticky', top: 100 }}>
              <Paper elevation={4} sx={{ p: 4, borderRadius: 2 }}>
                <Typography variant="h5" gutterBottom fontWeight="bold">Registration</Typography>
                <Divider sx={{ mb: 3 }} />
                
                <Stack spacing={2} mb={4}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <AccessTime color="primary" />
                    <Box>
                      <Typography variant="subtitle2">Duration</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))} Days
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <ConfirmationNumber color="primary" />
                    <Box>
                      <Typography variant="subtitle2">Price Range</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {event.products.length > 0 
                          ? (
                            <>
                              {`${Math.min(...event.products.map(p => p.price))}€ - ${Math.max(...event.products.map(p => p.price))}€`}
                              {maximumStaySurcharge > 0 && (
                                <Typography component="span" variant="caption" display="block" color="primary.main" sx={{ mt: 0.5 }}>
                                  + Optional Hotel Extras (up to {maximumStaySurcharge}€)
                                </Typography>
                              )}
                            </>
                          )
                          : 'Free / TBD'
                        }
                      </Typography>
                    </Box>
                  </Box>
                </Stack>

                {registration ? (
                  <EventRegistrationStatus 
                    registration={{
                      ...registration,
                      expiresAt: registration.expiresAt?.toISOString()
                    } as unknown as { id: string; status: string; ticketId: number; expiresAt?: string; payments: { id: string; amount: number; paymentStatus: string; paymentProvider: string }[] }} 
                    event={serializedEvent}
                  />
                ) : (
                  <>
                    {(!bookingIdentity || !hasCheckInIdentity(bookingIdentity) || !hasBillingAddress(bookingIdentity)) && (
                      <Alert severity="info" sx={{ mb: 2 }}>
                        Booking requires your legal name and billing address. Add them before ticket sales open to avoid delays. Preparing your details does not reserve a ticket.
                        <Button fullWidth size="small" sx={{ mt: 1 }} href={`/complete-profile?intent=billing&callbackUrl=${encodeURIComponent(`/events/${event.id}`)}`}>
                          Prepare booking details
                        </Button>
                      </Alert>
                    )}
                    <Button 
                      fullWidth 
                      variant="contained" 
                      size="large" 
                      sx={{ py: 2, fontSize: '1.1rem' }}
                      href={`/events/${event.id}/register`}
                      disabled={!!(event.registrationOpensAt && new Date(event.registrationOpensAt) > new Date()) || !!(event.maxRegistrations && event._count.registrations >= event.maxRegistrations)}
                    >
                      {event.maxRegistrations && event._count.registrations >= event.maxRegistrations 
                        ? 'Registration Full' 
                        : 'Register Now'}
                    </Button>

                    {event.registrationOpensAt && new Date(event.registrationOpensAt) > new Date() && (
                      <Box sx={{ mt: 3 }}>
                        {/* eslint-disable-next-line react-hooks/purity -- server component, Date.now() is safe here */}
                        {new Date(event.registrationOpensAt).getTime() - Date.now()< 3 * 24 * 60 * 60 * 1000 ? (
                          <RegistrationCountdown opensAt={event.registrationOpensAt.toISOString()} />
                        ) : (
                          <Alert severity="info" icon={false} sx={{ textAlign: 'center' }}>
                            <Typography variant="body2" fontWeight="bold">
                              Registration opens on:
                            </Typography>
                            <Typography variant="h6">
                              {eventDateFormatter.format(new Date(event.registrationOpensAt))}
                            </Typography>
                          </Alert>
                        )}
                      </Box>
                    )}
                  </>
                )}

                {canEdit && (
                  <Button
                    fullWidth
                    variant="outlined"
                    color="secondary"
                    startIcon={<Edit />}
                    href={`/admin/events/${event.id}`}
                    sx={{ mt: 2 }}
                  >
                    Edit Event (Admin)
                  </Button>
                )}

                {event.maxRegistrations && (
                  <Box sx={{ mt: 2, textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary">
                      {event._count.registrations} / {event.maxRegistrations} spots taken
                    </Typography>
                  </Box>
                )}
              </Paper>

              {canOpenSupportTicket && registration && (
                <SupportTicketPanel
                  eventId={event.id}
                  registrationId={registration.id}
                />
              )}

              <Box sx={{ px: 2 }}>
                <Typography variant="h6" gutterBottom>Includes</Typography>
                <Stack direction="row" flexWrap="wrap" gap={1}>
                  <Chip label="Badge" variant="outlined" />
                  <Chip label="Convention Access" variant="outlined" />
                  <Chip label="Workshops" variant="outlined" />
                  {accommodationHotels.length > 0 && (
                    <Chip label="Hotel Support" variant="outlined" />
                  )}
                </Stack>
              </Box>
            </Stack>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

