import { Container, Paper } from "@mui/material";
import { Suspense } from "react";
import CheckEmail from "@/components/auth/CheckEmail";
import PageLoadingState from "@/components/common/PageLoadingState";

export default function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; callbackUrl?: string }> }) {
  return <Suspense fallback={<PageLoadingState />}><Content searchParams={searchParams} /></Suspense>;
}

async function Content({ searchParams }: { searchParams: Promise<{ email?: string; callbackUrl?: string }> }) {
  const { email, callbackUrl } = await searchParams;
  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 }, borderRadius: 3 }}>
        <CheckEmail email={typeof email === "string" ? email : ""} callbackUrl={callbackUrl} />
      </Paper>
    </Container>
  );
}
