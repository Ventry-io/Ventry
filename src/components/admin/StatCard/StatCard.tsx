import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

interface StatCardProps {
    label: string;
    value: string | number;
    sub?: string;
    color?: string;
}

/**
 * Metrics sit on one hairline row, no card per number. Right and bottom rules are drawn by each cell
 * and the row clips the outer ones, so a wrapped last row never shows empty ruled slots.
 */
export function StatRow({ children }: { children: ReactNode }) {
    return (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", md: "repeat(auto-fit, minmax(240px, 1fr))" }, overflow: "hidden", borderBlock: "1px solid", borderColor: "divider" }}>
            {children}
        </Box>
    );
}

/** One metric: the number carries the hierarchy by size alone and shrinks with its cell (cqi) instead of breaking mid-figure; the label stays small, colour only marks the category as a dot. */
export default function StatCard({ label, value, sub, color = "primary.main" }: StatCardProps) {
    return (
        <Box sx={{ px: { xs: 2, md: 3 }, py: { xs: 2, md: 3 }, minWidth: 0, containerType: "inline-size", boxShadow: "1px 0 0 var(--rule), 0 1px 0 var(--rule)" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
                <Typography variant="overline" component="p" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                    {label}
                </Typography>
            </Box>
            <Typography component="p" sx={{ mt: { xs: 1, md: 1.5 }, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: { xs: "min(2rem, 22cqi)", md: "min(3.25rem, 22cqi)" }, lineHeight: 1, letterSpacing: "-0.02em", overflowWrap: "anywhere" }}>
                {value}
            </Typography>
            {sub && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                    {sub}
                </Typography>
            )}
        </Box>
    );
}
