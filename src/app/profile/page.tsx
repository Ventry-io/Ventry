import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma/prisma";
import { refreshSignedUrls } from "@/lib/user/profilePicture";
import ProfilePageClient from "@/components/profile/ProfilePageClient";
import { Container, Box, Typography, Button } from "@mui/material";
import { Visibility } from "@mui/icons-material";
import { Suspense } from "react";
import PageLoadingState from "@/components/common/PageLoadingState";

export default function ProfilePage() {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <ProfilePageContent />
    </Suspense>
  );
}

async function ProfilePageContent() {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  // Fetch user data from database
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      country: true,
      legalName: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressState: true,
      addressPostalCode: true,
      addressCountry: true,
      profilePictures: {
        orderBy: [
          { order: 'asc' },
          { isPrimary: 'desc' },
          { createdAt: 'desc' }
        ]
      },
      accounts: {
        select: {
          accountId: true,
          providerId: true,
          password: true // Check if password is set (in credential account)
        }
      },
      bio: true,
      dateOfBirth: true,
      pronouns: true,
      showAge: true,
      showExactBirthdate: true,
      showConventions: true,
      socialLinks: true,
      createdAt: true,
      updatedAt: true,
      adminProfile: { select: { type: true } },
    }
  });

  if (!user) {
    redirect("/login");
  }

  const profilePictures = await refreshSignedUrls(user.profilePictures);
  const isOrganization = user.adminProfile?.type === "ORGANIZATION";

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h5" component="h1" fontWeight={700}>
            Profile Settings
          </Typography>
          {user.username && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<Visibility />}
              href={`/profile/${encodeURIComponent(user.username)}`}
              target="_blank"
            >
              Preview
            </Button>
          )}
        </Box>
        <ProfilePageClient
          user={{ ...user, profilePictures, socialLinks: user.socialLinks as { telegram?: string; twitter?: string; instagram?: string } | null }}
          isOrganization={isOrganization}
        />
      </Box>
    </Container>
  );
}
