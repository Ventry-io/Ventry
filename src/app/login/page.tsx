import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import LoginPageClient from "@/components/auth/LoginPageClient";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma/prisma";
import { Suspense } from "react";
import PageLoadingState from "@/components/common/PageLoadingState";
import AuthSheet from "@/components/auth/AuthSheet";
import { BRAND_NAME } from "@/lib/brand";

export default function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <LoginPageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginPageContent({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  // Check if user is already logged in and has pending links
  const session = await getSession();
  
  if (session?.user?.id) {
    // User is logged in, check for pending links
    const pendingLinks = await prisma.pendingAccountLink.findMany({
      where: {
        userId: session.user.id,
        expiresAt: {
          gt: new Date()
        }
      }
    });
    
    if (pendingLinks.length > 0) {
      // Redirect to link-account page
      const redirectUrl = callbackUrl 
        ? `/link-account?callbackUrl=${encodeURIComponent(callbackUrl)}`
        : "/link-account";
      redirect(redirectUrl);
    }
  }

  return (
    <Box sx={{ flex: 1, display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0, 5fr) minmax(0, 6fr)" } }}>
      <AuthSheet />
      <Box sx={{ display: "flex", justifyContent: "center", px: 2, py: { xs: 4, md: 8 } }}>
        <Box sx={{ width: "100%", maxWidth: 460 }}>
          <Typography component="h1" variant="h3" sx={{ mb: 1 }}>
            Log in
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Welcome back to {BRAND_NAME}. Your tickets, rooms and events are waiting.
          </Typography>
          <LoginPageClient />
        </Box>
      </Box>
    </Box>
  );
}
