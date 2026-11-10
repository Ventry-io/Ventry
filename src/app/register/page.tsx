import { Box, Container, Paper, Typography } from "@mui/material";
import { Suspense } from "react";
import PageLoadingState from "@/components/common/PageLoadingState";
import RegisterWizard from "@/components/auth/RegisterWizard";

export default function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <RegisterPageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function RegisterPageContent({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

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
        <Paper
          elevation={0}
          variant="outlined"
          sx={{
            width: "100%",
            p: { xs: 3, sm: 5 },
            borderRadius: 3,
          }}
        >
          <Typography
            component="h1"
            variant="h4"
            fontWeight={700}
            align="center"
            sx={{ mb: 1 }}
          >
            Create your account
          </Typography>

          <Typography color="text.secondary" align="center" sx={{ mb: 4 }}>
            Start exploring in two steps. Add event details when you need them.
          </Typography>

          <RegisterWizard callbackUrl={callbackUrl} />
        </Paper>
      </Box>
    </Container>
  );
}
