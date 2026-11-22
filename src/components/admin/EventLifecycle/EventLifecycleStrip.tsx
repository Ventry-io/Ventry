import { Box } from "@mui/material";
import { EVENT_STAGES, type EventStage } from "@/lib/events/lifecycle";

const LABELS: Record<(typeof EVENT_STAGES)[number], string> = {
  draft: "Draft", published: "Published", registration: "Registration open", live: "Live", past: "Past",
};

/** The same five-step strip on every event, so its state reads in one glance. */
export default function EventLifecycleStrip({ stage }: { stage: EventStage }) {
  if (stage === "cancelled") {
    return <Box role="status" sx={{ px: 1.5, py: 1, borderRadius: "10px", bgcolor: "var(--ink-tomato)", color: "var(--background)", fontWeight: 600, fontSize: "0.875rem" }}>Cancelled</Box>;
  }
  const current = EVENT_STAGES.indexOf(stage);
  return (
    <Box component="ol" aria-label="Event lifecycle" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", gap: 0.5 }}>
      {EVENT_STAGES.map((item, index) => (
        <Box
          component="li"
          key={item}
          aria-current={index === current ? "step" : undefined}
          sx={{
            // Phones: only the current step keeps its label on screen; the others shrink to segments so nothing truncates.
            flex: { xs: index === current ? "1 0 auto" : "0 0 18px", sm: "1 1 0" }, minWidth: 0,
            px: { xs: index === current ? 1.5 : 0, sm: 1.5 }, py: 1, borderRadius: "10px", fontSize: "0.875rem", fontWeight: 600, lineHeight: 1.3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            ...(index < current && { bgcolor: "color-mix(in srgb, var(--ink-teal) 14%, transparent)", color: "primary.main" }),
            ...(index === current && { bgcolor: "primary.main", color: "primary.contrastText" }),
            ...(index > current && { bgcolor: "var(--liner)", color: "text.secondary" }),
          }}
        >
          {index === current ? LABELS[item] : <Box component="span" sx={{ display: "block", clipPath: { xs: "inset(50%)", sm: "none" }, height: { xs: "1lh", sm: "auto" } }}>{LABELS[item]}</Box>}
        </Box>
      ))}
    </Box>
  );
}
