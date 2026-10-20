import { Box, Container, Paper, Typography } from "@mui/material";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import PageLoadingState from "@/components/common/PageLoadingState";
import CompleteProfileWizard from "@/components/auth/CompleteProfileWizard";
import { getCallbackPath } from "@/lib/auth/callback";
import { hasCheckInIdentity, hasBillingAddress } from "@/lib/user/profile-completion";
import { prisma } from "@/lib/prisma/prisma";

export default function CompleteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; intent?: string }>;
}) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <CompleteProfilePageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function CompleteProfilePageContent({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; intent?: string }>;
}) {
  const params = await searchParams;
  const callbackUrl = getCallbackPath(params.callbackUrl);
  const checkInOnly = params.intent === "check-in";
  const billingOnly = params.intent === "billing";
  const organizerOnly = params.intent === "organizer";
  const session = await getSession();

  if (!session?.user) {
    const completionUrl = `/complete-profile?${new URLSearchParams({ ...(params.intent ? { intent: params.intent } : {}), callbackUrl })}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(completionUrl)}`);
  }

  if (checkInOnly && hasCheckInIdentity(session.user)) {
    redirect(callbackUrl);
  }
  if (organizerOnly && session.user.isAdmin) redirect(callbackUrl);

  const personal = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { legalName: true, addressLine1: true, addressLine2: true, addressCity: true, addressState: true, addressPostalCode: true, addressCountry: true },
  });
  if (billingOnly && personal && hasCheckInIdentity(personal) && hasBillingAddress(personal)) redirect(callbackUrl);
  const defaultPersonal = Object.fromEntries(Object.entries(personal ?? {}).map(([key, value]) => [key, value ?? ""]));

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          minHeight: "100vh",
          py: 6,
        }}
      >
        <Paper variant="outlined" sx={{ width: "100%", p: { xs: 3, sm: 5 }, borderRadius: 3 }}>
          <Typography component="h1" variant="h4" fontWeight={700} align="center" sx={{ mb: 4 }}>
            {billingOnly ? "Ready to book" : checkInOnly ? "Ready for check-in" : organizerOnly ? "Start organizing" : "Make yourself at home"}
          </Typography>

          <CompleteProfileWizard
            callbackUrl={callbackUrl}
            defaultLegalName={session.user.oauthLegalNameSuggestion ?? undefined}
            defaultUsername={session.user.username ?? undefined}
            avatarUrl={session.user.image ?? undefined}
            checkInOnly={checkInOnly}
            billingOnly={billingOnly}
            organizerOnly={organizerOnly}
            defaultPersonal={defaultPersonal}
          />
        </Paper>
      </Box>
    </Container>
  );
}
