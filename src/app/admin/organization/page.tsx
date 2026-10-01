import { checkAdminAuth } from "@/lib/auth/admin";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Box, Typography } from "@mui/material";
import PageLoadingState from "@/components/common/PageLoadingState";
import OrgSettings from "@/components/admin/organization/OrgSettings";

export default function OrganizationPage() {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <OrganizationPageContent />
    </Suspense>
  );
}

async function OrganizationPageContent() {
  const auth = await checkAdminAuth();
  if (!auth.authorized) {
    if (auth.error === "Not authenticated") redirect("/login?callbackUrl=/admin/organization");
    return <div style={{ color: "red" }}>Access Denied</div>;
  }

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Organization & crew
      </Typography>
      <OrgSettings />
    </Box>
  );
}
