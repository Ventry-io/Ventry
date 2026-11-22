import { Box, Typography } from "@mui/material";
import { kissCut } from "@/lib/ui/kissCut";
import { BRAND_NAME } from "@/lib/brand";

// What the product does, set as a sheet of stickers. Capabilities only, no claims.
const STICKERS = [
  { label: "Tickets with QR check-in", ink: "var(--ink-teal)", rotate: -4 },
  { label: "Badges", ink: "var(--ink-sun)", rotate: 3, dark: true },
  { label: "Hotel rooms & roommates", ink: "var(--ink-grape)", rotate: -2 },
  { label: "Event pages", ink: "var(--ink-tomato)", rotate: 5 },
  { label: "Community", ink: "var(--ink-leaf)", rotate: -3 },
  { label: "From a walk to a convention", ink: "var(--foreground)", rotate: 2 },
];

/** Decorative side panel for auth pages; hidden on small screens so the form comes first. */
export default function AuthSheet() {
  return (
    <Box
      aria-hidden
      sx={{
        display: { xs: "none", md: "flex" }, flexDirection: "column", justifyContent: "center", gap: 4, px: { md: 6, lg: 10 }, py: 8,
        bgcolor: "var(--liner)", borderRight: "1px dashed var(--rule-strong)",
      }}
    >
      <Typography sx={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "2.25rem", lineHeight: 1.15, letterSpacing: "-0.02em", maxWidth: 420 }}>
        Everything for your event, on one sheet.
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, maxWidth: 460 }}>
        {STICKERS.map(sticker => (
          <Box
            key={sticker.label}
            sx={{
              ...kissCut, borderRadius: 999, px: 2, py: 1, fontWeight: 600, fontSize: "0.9375rem",
              bgcolor: sticker.ink, color: sticker.dark ? "#1d1b22" : "var(--background)", transform: `rotate(${sticker.rotate}deg)`,
            }}
          >
            {sticker.label}
          </Box>
        ))}
      </Box>
      <Typography color="text.secondary" sx={{ maxWidth: 400 }}>
        {BRAND_NAME} runs registration, payment, check-in and everything in between.
      </Typography>
    </Box>
  );
}
