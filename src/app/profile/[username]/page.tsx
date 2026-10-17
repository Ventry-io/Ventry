import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import {
  Container,
  Paper,
  Stack,
  Box,
  Typography,
  Chip
} from "@mui/material";
import prisma from "@/lib/prisma/prisma";
import ProfileHeader from "@/components/profile/ProfileHeader";
import ProfileBio from "@/components/profile/ProfileBio";
import PersonalInfo from "@/components/profile/PersonalInfo";
import PhotoGallery from "@/components/profile/PhotoGallery";
import EmptyState from "@/components/profile/EmptyState";
import { refreshSignedUrls } from "@/lib/user/profilePicture";
import { Suspense } from "react";
import PageLoadingState from "@/components/common/PageLoadingState";
import { calculateRealisticAge } from "@/lib/user/birthdate";

interface ProfilePicture {
  id: string;
  signedUrl: string | null;
  storagePath: string;
  isPrimary: boolean;
  createdAt: Date;
  cachedUntil: Date | null;
  order: number;
}

interface SocialLinks {
  telegram?: string;
  twitter?: string;
  instagram?: string;
}

export default function ProfileViewPage({ params }: { params: Promise<{ username: string }> }) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <ProfileViewPageContent params={params} />
    </Suspense>
  );
}

async function ProfileViewPageContent({ params }: { params: Promise<{ username: string }> }) {
  const { username: slug } = await params;

  // Support both the current username and legacy ID-based URLs
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: slug },
        { id: slug },
      ]
    },
    select: {
      id: true,
      name: true,
      username: true,
      country: true,
      profilePictures: {
        orderBy: [
          { order: 'asc' },
          { isPrimary: 'desc' },
          { createdAt: 'desc' }
        ]
      },
      bio: true,
      dateOfBirth: true,
      showAge: true,
      showExactBirthdate: true,
      showConventions: true,
      socialLinks: true,
      pronouns: true,
      adminProfile: { select: { type: true } },
    }
  });

  if (!user) {
    // The requested handle might be a recently-vacated username still inside
    // its 90-day reservation window (see changeUsername()) - redirect to
    // wherever it lives now instead of 404ing.
    const reservation = await prisma.usernameHistory.findFirst({
      where: { username: slug, expiresAt: { gt: new Date() } },
      select: { user: { select: { username: true } } },
    });
    if (reservation?.user?.username) {
      redirect(`/profile/${reservation.user.username}`);
    }
    notFound();
  }

  const [validatedPictures, conventions] = await Promise.all([
    refreshSignedUrls(user.profilePictures as ProfilePicture[]),
    user.showConventions
      ? prisma.event.findMany({
          where: {
            status: "PUBLISHED",
            registrations: { some: { userId: user.id, status: "CONFIRMED" } },
          },
          select: { id: true, name: true, startDate: true, endDate: true, imageUrl: true, location: { select: { city: true } } },
          orderBy: { startDate: "desc" },
        })
      : Promise.resolve([]),
  ]);
  const isOrganization = user.adminProfile?.type === "ORGANIZATION";
  const age = !isOrganization && user.showAge && user.dateOfBirth
    ? calculateRealisticAge(user.dateOfBirth) : null;
  const socialLinks = user.socialLinks as SocialLinks | null;
  const pictures = validatedPictures.map(({ id, signedUrl, isPrimary, createdAt }) => ({
    id, signedUrl, isPrimary, createdAt,
  }));
  const now = new Date();
  const attended = conventions.filter(event => event.endDate < now);
  const upcoming = conventions.filter(event => event.endDate >= now)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const hasPersonalInfo = !isOrganization && (age !== null || Boolean(user.pronouns));
  const hasSidebar = hasPersonalInfo || pictures.length > 1;
  const hasMainContent = Boolean(user.bio || user.showConventions);
  const hasContent = hasMainContent || hasSidebar;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 4 } }}>
      <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3, mb: 3 }}>
        <ProfileHeader
          name={user.name}
          username={user.username}
          pronouns={isOrganization ? null : user.pronouns}
          profilePictures={pictures}
          age={age}
          showAge={!isOrganization && user.showAge}
          country={user.country}
          socialLinks={socialLinks}
          eventCounts={user.showConventions ? { attended: attended.length, upcoming: upcoming.length } : undefined}
        />
      </Paper>

      {hasContent ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: hasSidebar && hasMainContent ? 'minmax(0, 1fr) 300px' : '1fr' }, gap: 3, alignItems: 'start' }}>
          {hasMainContent && <Stack spacing={3} sx={{ minWidth: 0 }}>
            {user.bio && <ProfileBio bio={user.bio} />}

            {user.showConventions && [
              { id: 'upcoming-events', title: 'Upcoming events', events: upcoming, description: 'Where you can meet next.', empty: 'No upcoming cons to share yet.' },
              { id: 'attended-events', title: 'Attended events', events: attended, description: 'Past cons with a confirmed registration.', empty: 'No past cons to share yet.' },
            ].map(section => (
              <Paper component="section" aria-labelledby={`${section.id}-title`} id={section.id} variant="outlined" key={section.id} sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3, scrollMarginTop: 80 }}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography id={`${section.id}-title`} variant="h6" component="h2" fontWeight={700}>{section.title}</Typography>
                  <Chip label={section.events.length} size="small" variant="outlined" />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>{section.description}</Typography>
                {section.events.length > 0 ? (
                  <Stack component="ul" spacing={1.5} sx={{ p: 0, m: 0, listStyle: 'none' }}>
                    {section.events.map(event => (
                      <Paper component="li" key={event.id} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', '&:hover, &:focus-within': { borderColor: 'primary.main' } }}>
                        <Link href={`/events/${event.id}`} style={{ display: 'flex', gap: 16, padding: 16, color: 'inherit', textDecoration: 'none', alignItems: 'center' }}>
                          <Box sx={{ width: { xs: 64, sm: 88 }, height: { xs: 64, sm: 88 }, position: 'relative', flexShrink: 0, borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover', display: 'grid', placeContent: 'center', textAlign: 'center' }}>
                            {event.imageUrl ? (
                              <Image src={event.imageUrl} alt="" fill sizes="88px" style={{ objectFit: 'cover' }} />
                            ) : (
                              <>
                                <Typography variant="caption" color="text.secondary">{event.startDate.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</Typography>
                                <Typography variant="h5" fontWeight={700}>{event.startDate.getUTCDate()}</Typography>
                              </>
                            )}
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            {event.startDate <= now && event.endDate >= now && <Chip label="Happening now" color="success" size="small" sx={{ mb: 0.5 }} />}
                            <Typography component="h3" variant="subtitle1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{event.name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              <time dateTime={event.startDate.toISOString()}>{event.startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</time>
                              {' – '}
                              <time dateTime={event.endDate.toISOString()}>{event.endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</time>
                            </Typography>
                            {event.location?.city && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{event.location.city}</Typography>}
                          </Box>
                        </Link>
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <Box sx={{ py: 3, px: 2, bgcolor: 'action.hover', borderRadius: 2, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">{section.empty}</Typography>
                  </Box>
                )}
              </Paper>
            ))}
          </Stack>}

          {hasSidebar && (
            <Paper component="aside" aria-label="About this person" variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
              <Stack spacing={3}>
                {hasPersonalInfo && (
                  <PersonalInfo
                    dateOfBirth={age !== null && user.showExactBirthdate ? user.dateOfBirth : null}
                    showAge={user.showAge}
                    showExactBirthdate={user.showExactBirthdate}
                    pronouns={user.pronouns}
                    age={age}
                  />
                )}
                {pictures.length > 1 && <PhotoGallery profilePictures={pictures} userName={user.name} />}
              </Stack>
            </Paper>
          )}
        </Box>
      ) : <EmptyState userName={user.name} />}
    </Container>
  );
}
