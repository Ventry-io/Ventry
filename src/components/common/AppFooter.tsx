import GitHubIcon from "@mui/icons-material/GitHub";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { getBuildInfo } from "@/lib/build-info";

const legalLinks = [
  { href: "/imprint", label: "Imprint" },
  { href: "/privacy", label: "Privacy" },
];

export default function AppFooter() {
  const buildInfo = getBuildInfo();

  return (
    <Box
      component="footer"
      sx={{
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        color: "text.secondary",
        flexShrink: 0,
      }}
    >
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack
          alignItems={{ xs: "flex-start", md: "center" }}
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          spacing={2}
        >
          <Stack
            aria-label="Legal links"
            component="nav"
            direction="row"
            spacing={1.5}
            sx={{ "& > a + a": { borderLeft: 1, borderColor: "divider", pl: 1.5 } }}
          >
            {legalLinks.map((item) => (
              <Link
                color="text.secondary"
                href={item.href}
                key={item.href}
                sx={{ fontSize: "0.875rem", textDecorationColor: "transparent" }}
                underline="hover"
              >
                {item.label}
              </Link>
            ))}
          </Stack>

          <Stack alignItems="center" direction="row" spacing={1.25}>
            <Typography component="p" variant="caption">
              Version {buildInfo.version} · {buildInfo.commit} · Built {buildInfo.buildDate}
            </Typography>
            <Tooltip title="Open Ventry on GitHub">
              <IconButton
                aria-label="Open Ventry repository on GitHub"
                component="a"
                href={buildInfo.repositoryUrl}
                rel="noopener noreferrer"
                size="small"
                sx={{ color: "text.secondary" }}
                target="_blank"
              >
                <GitHubIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
