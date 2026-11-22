import { prisma } from "@/lib/prisma/prisma";
import { notFound } from "next/navigation";
import { canEditEvent, getEventViewer, visibleEventWhere } from "@/lib/events/public-event";
import { calculateMaximumStaySurcharge, normalizeStayPolicy } from "@/lib/events/accommodation";
import {
  Container,
  Box,
  Typography,
  Grid,
  Paper,
  Stack,
  Button,
  Alert
} from "@mui/material";
import {
  Edit,
  Hotel,
  Palette
} from "@mui/icons-material";
import EventPageContent from "@/components/events/EventPageContent";
import { EventSiteFrame, EventSiteHeader, EventSiteStyles, pageBackgroundSx } from "@/components/events/site/EventSiteFrame";
import EventSiteNav from "@/components/events/site/EventSiteNav";
import type { SiteContext } from "@/components/events/site/PageBlocks";
import { loadTelegramFeeds } from "@/lib/events/telegram";
import { buildSiteCss, storageHost } from "@/lib/events/page-css";
import { normalizeEventPage } from "@/types/schemas/event/page";
import { ticketPriceLabel } from "@/lib/events/pricing";
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

const eventDateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

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
  const viewer = await getEventViewer();
  const { session, user: bookingIdentity } = viewer;
  const event = await prisma.event.findFirst({
    where: visibleEventWhere(id, viewer),
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

  const canEdit = canEditEvent(event, viewer);

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
      },
      registrationItems: { select: { product: { select: { type: true } } } }
    }
  }) : null;

  const canOpenSupportTicket = !!registration && registration.status !== "CANCELLED";
  const hasHotelRoom = canOpenSupportTicket && !!registration?.registrationItems.some((item) => item.product.type === "ACCOMMODATION");

  // Add expiresAt to the cast/serialization if needed, 
  // but Prisma already includes it in the object since we updated the schema.
  // I'll make sure the props passed to EventRegistrationStatus are correct.

  const pageDesign = normalizeEventPage(event.pageDesign);
  const { theme } = pageDesign;
  const home = pageDesign.pages[0];
  const siteCss = buildSiteCss(theme, storageHost()).css;
  const siteCtx: SiteContext = { eventId: event.id, homeSlug: home.slug, telegramSource: "public", telegram: await loadTelegramFeeds(home.blocks) };
  const priceLabel = ticketPriceLabel(event.products);
  const hasTickets = event.products.some(product => product.type === "TICKET");
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
    <Box sx={pageBackgroundSx(theme)}>
      <EventSiteStyles css={siteCss} />
      {/* Success Alert */}
      {message === 'update_success' && (
        <Container maxWidth="lg" sx={{ mt: 2 }}>
          <Alert severity="success">
            Your registration preferences have been updated successfully.
          </Alert>
        </Container>
      )}

      {message === 'approval_pending' && (
        <Container maxWidth="lg" sx={{ mt: 2 }}>
          <Alert severity="info">
            Your registration has been submitted and is awaiting admin approval before payment.
          </Alert>
        </Container>
      )}

      <EventSiteFrame theme={theme}>
        <EventSiteHeader theme={theme} name={event.name} imageUrl={event.imageUrl}>
          <Stack direction="row" flexWrap="wrap" gap={2}>
            <Typography>{eventDateFormatter.format(startDate)} – {eventDateFormatter.format(endDate)}</Typography>
            {event.location && <Typography>{event.location.city}, {event.location.country}</Typography>}
          </Stack>
        </EventSiteHeader>
        <EventSiteNav nav={pageDesign.nav} ctx={siteCtx} currentHref={`/events/${event.id}`} />
      </EventSiteFrame>

      {/* Content */}
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <Grid container spacing={{ xs: 4, md: 6 }}>
          {/* Main Info */}
          <Grid size={{ xs: 12, md: 8 }}>
            <EventSiteFrame theme={theme} sx={{ p: { xs: 0, md: 1 } }}>
            <EventPageContent blocks={home.blocks} ctx={siteCtx} slots={{
              about: <Box>
              <Typography variant="h4" gutterBottom fontWeight="bold">About this event</Typography>
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary', fontSize: '1.1rem' }}>
                {event.description}
              </Typography>
            </Box>,
              location: event.location && (
              <Box>
                <Typography variant="h4" gutterBottom fontWeight="bold">Location</Typography>
                <Paper variant="outlined" sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>{event.location.name}</Typography>
                  <Typography>{event.location.address}</Typography>
                  <Typography>
                    {event.location.postalCode} {event.location.city}
                  </Typography>
                  <Typography>{[event.location.state, event.location.country].filter(Boolean).join(", ")}</Typography>
                  <EventLocationMap location={event.location} />
                </Paper>
              </Box>
            ),
              attendees: <Box>
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
            </Box>,
            }}
              schedule={serializedEvent.schedule && serializedEvent.schedule.length > 0 && (
              <Box mb={6}>
                <EventSchedule schedule={serializedEvent.schedule} />
              </Box>
            )}
              community={event.communityEnabled && (
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
            />
            </EventSiteFrame>
          </Grid>

          {/* Registration Sidebar */}
          {/* Phones: the booking card comes first so the next action is not buried below the attendee list. */}
          <Grid size={{ xs: 12, md: 4 }} order={{ xs: -1, md: 0 }}>
            <Stack spacing={3} sx={{ position: { md: 'sticky' }, top: 100 }}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="overline" component="h2" color="text.secondary">Registration</Typography>
                <Typography component="p" sx={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "2rem", lineHeight: 1.15, letterSpacing: "-0.01em" }}>
                  {priceLabel || "No ticket prices listed"}
                </Typography>
                {maximumStaySurcharge > 0 && (
                  <Typography variant="body2" color="text.secondary">+ optional hotel extras (up to {maximumStaySurcharge}€)</Typography>
                )}
                <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", m: 0, mt: 2.5, mb: 3, py: 1.5, borderBlock: "1px solid", borderColor: "divider" }}>
                  <Box>
                    <Typography component="dt" variant="caption" color="text.secondary">Duration</Typography>
                    <Typography component="dd" sx={{ m: 0, fontWeight: 600 }}>
                      {Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))} days
                    </Typography>
                  </Box>
                  {event.maxRegistrations && (
                    <Box>
                      <Typography component="dt" variant="caption" color="text.secondary">Spots taken</Typography>
                      <Typography component="dd" sx={{ m: 0, fontWeight: 600 }}>{event._count.registrations} / {event.maxRegistrations}</Typography>
                    </Box>
                  )}
                </Box>

                {!hasTickets ? (
                  <Alert severity="info">No ticket or booking is required for this event.</Alert>
                ) : registration ? (
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
                      href={`/events/${event.id}/register`}
                      disabled={!!(event.registrationOpensAt && new Date(event.registrationOpensAt) > new Date()) || !!(event.maxRegistrations && event._count.registrations >= event.maxRegistrations)}
                    >
                      {event.maxRegistrations && event._count.registrations >= event.maxRegistrations 
                        ? 'Registration full'
                        : 'Register now'}
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
                    Edit event
                  </Button>
                )}
                {canEdit && (
                  <Button
                    fullWidth
                    variant="outlined"
                    color="secondary"
                    startIcon={<Palette />}
                    href={`/admin/events/${event.id}/page-designer`}
                    sx={{ mt: 1 }}
                  >
                    Design this page
                  </Button>
                )}

              </Paper>

              {hasHotelRoom && (
                <Button variant="outlined" href={`/events/${event.id}/room`} startIcon={<Hotel />}>
                  Hotel room &amp; roommates
                </Button>
              )}

              {canOpenSupportTicket && registration && (
                <SupportTicketPanel
                  eventId={event.id}
                  registrationId={registration.id}
                />
              )}

            </Stack>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

