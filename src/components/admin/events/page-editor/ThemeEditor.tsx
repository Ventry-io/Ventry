"use client";

import { useState } from "react";
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { PAGE_FONTS, contrastRatio, type PageTheme } from "@/types/schemas/event/page";
import type { SanitizedCss } from "@/lib/events/page-css";
import { Thumb, UploadButton, type EditorEnv } from "./BlockFields";

const FONT_NAMES: Record<keyof typeof PAGE_FONTS, string> = {
  "sans-serif": "Clean sans-serif", serif: "Classic serif", monospace: "Typewriter / mono", rounded: "Rounded",
  humanist: "Humanist", geometric: "Geometric", slab: "Slab serif", handwritten: "Handwritten",
};

export function ThemeEditor({ theme, onChange, env }: { theme: PageTheme; onChange: (theme: PageTheme) => void; env: EditorEnv }) {
  return <Stack spacing={3}>
    <Stack direction="row" flexWrap="wrap" gap={2}>
      {(["background", "foreground", "accent"] as const).map(key => <TextField key={key} type="color" label={{ background: "Background", foreground: "Text", accent: "Links & buttons" }[key]}
        value={theme[key]} onChange={event => onChange({ ...theme, [key]: event.target.value })} sx={{ width: 150 }} />)}
    </Stack>
    {(["foreground", "accent"] as const).map(key => contrastRatio(theme.background, theme[key]) < 4.5 &&
      <Alert key={key} severity="warning">{key === "foreground" ? "Text" : "Link"} color contrast is {contrastRatio(theme.background, theme[key]).toFixed(1)}:1. At least 4.5:1 is required so everyone can read the page.</Alert>)}
    <TextField select label="Font" value={theme.font} onChange={event => onChange({ ...theme, font: event.target.value as PageTheme["font"] })} sx={{ maxWidth: 320 }}>
      {Object.entries(PAGE_FONTS).map(([key, stack]) => <MenuItem key={key} value={key} sx={{ fontFamily: stack }}>{FONT_NAMES[key as keyof typeof PAGE_FONTS]}</MenuItem>)}
    </TextField>
    <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
      <UploadButton env={env} kind="font" accept=".woff2,font/woff2" label={theme.customFontUrl ? "Replace own font" : "Upload own font (WOFF2)"} onUploaded={data => onChange({ ...theme, customFontUrl: data.url })} />
      {theme.customFontUrl && <Button size="small" onClick={() => onChange({ ...theme, customFontUrl: undefined })}>Remove own font</Button>}
      <Typography variant="body2" color="text.secondary">Up to 1 MB. Make sure the font licence allows web use. The font above is the fallback.</Typography>
    </Stack>
    <Box>
      <Typography variant="subtitle1" gutterBottom>Header</Typography>
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <UploadButton env={env} label="Upload header image or GIF" onUploaded={data => onChange({ ...theme, headerUrl: data.url, headerPosterUrl: data.posterUrl })} />
        <Button size="small" disabled={!theme.headerUrl} onClick={() => onChange({ ...theme, headerUrl: undefined, headerPosterUrl: undefined })}>Use event banner</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Up to 5 MB. Animated GIFs show a still image to visitors who prefer reduced motion.</Typography>
    </Box>
    <Box>
      <Typography variant="subtitle1" gutterBottom>Page background image</Typography>
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <Thumb url={theme.backgroundImage} />
        {/* Backgrounds use the still image: CSS backgrounds cannot honour reduced motion. */}
        <UploadButton env={env} label={theme.backgroundImage ? "Replace background image" : "Upload background image"} onUploaded={data => onChange({ ...theme, backgroundImage: data.posterUrl || data.url })} />
        {theme.backgroundImage && <Button size="small" onClick={() => onChange({ ...theme, backgroundImage: undefined })}>Remove background image</Button>}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Choose a calm image so text stays readable. The background colour above is shown while it loads.</Typography>
    </Box>
  </Stack>;
}

export function CssEditor({ theme, onChange, result, env }: { theme: PageTheme; onChange: (theme: PageTheme) => void; result: SanitizedCss; env: EditorEnv }) {
  const [assets, setAssets] = useState<string[]>([]);
  return <Stack spacing={2}>
    <Alert severity="info">
      Custom CSS only styles your event page. Useful selectors: <code>.vp-root</code> (whole page), <code>.vp-header</code>, <code>.vp-title</code>, <code>.vp-nav</code>,
      {" "}<code>.vp-block</code>, <code>.vp-block-gallery</code> (one per element type), <code>.vp-page-artists</code> (per subpage) and your own element classes.
      Images in <code>url()</code> must be uploaded below first. <code>@import</code>, external URLs, <code>@font-face</code> and <code>position: fixed</code> are removed.
      Animations are switched off for visitors who prefer reduced motion.
    </Alert>
    <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
      <UploadButton env={env} label="Upload image for CSS" onUploaded={data => setAssets(current => [...current, data.posterUrl || data.url])} />
      <Typography variant="body2" color="text.secondary">Then copy its <code>url(…)</code> into your CSS.</Typography>
    </Stack>
    {assets.map(url => <Stack key={url} direction="row" gap={1} alignItems="center">
      <Thumb url={url} />
      <Button size="small" onClick={() => void navigator.clipboard?.writeText(`url("${url}")`)}>Copy url(…)</Button>
    </Stack>)}
    <TextField label="Custom CSS" multiline minRows={14} value={theme.customCss} onChange={event => onChange({ ...theme, customCss: event.target.value })}
      slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13 } } }}
      helperText={`${theme.customCss.length.toLocaleString()} / 20,000 characters`} error={!!result.error} />
    {result.error && <Alert severity="error">{result.error}</Alert>}
    {result.removed.length > 0 && <Alert severity="warning">
      These rules are removed for security:
      <Box component="ul" sx={{ m: 0, pl: 3 }}>{[...new Set(result.removed)].slice(0, 20).map(rule => <li key={rule}><code>{rule}</code></li>)}</Box>
    </Alert>}
  </Stack>;
}
