import type { CSSProperties, ReactNode } from "react";
import { Box, type SxProps, type Theme } from "@mui/material";
import { PAGE_FONTS, contrastRatio, type PageTheme } from "@/types/schemas/event/page";
import { PAGE_ROOT_CLASS } from "@/lib/events/page-css";

// shortcut: animation is detected by the .gif extension; remote animated WebP/PNG still play under reduced motion.
const mayAnimate = (url: string) => /\.gif(?:[?#]|$)/i.test(url);

/** Shows the still poster under reduced motion; hides only GIFs that have no poster. */
export function MotionSafeImage({ src, poster, alt, style, eager = false }: { src: string; poster?: string; alt: string; style: CSSProperties; eager?: boolean }) {
  return <Box component="picture" sx={!poster && mayAnimate(src) ? { "@media (prefers-reduced-motion: reduce)": { display: "none" } } : undefined}>
    {poster && <source media="(prefers-reduced-motion: reduce)" srcSet={poster} />}
    {/* Remote organizer images are displayed directly; never fetched by the application server. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} style={style} />
  </Box>;
}

export const onColor = (background: string) => contrastRatio(background, "#ffffff") >= 4.5 ? "#ffffff" : "#000000";

export function siteFont(theme: PageTheme) {
  return theme.customFontUrl ? `"vp-custom", ${PAGE_FONTS[theme.font]}` : PAGE_FONTS[theme.font];
}

function themeSx(theme: PageTheme) {
  return {
    bgcolor: theme.background, color: theme.foreground, fontFamily: siteFont(theme),
    "& .MuiTypography-root, & .MuiButton-root": { fontFamily: "inherit" },
    "& .MuiTypography-root": { color: "inherit" },
    "& .MuiPaper-root": { bgcolor: "inherit", color: "inherit" },
    "& a:not(.MuiButton-root)": { color: theme.accent },
    "& .MuiButton-contained": { bgcolor: theme.accent, color: onColor(theme.accent) },
    "& .MuiButton-outlined, & .MuiButton-text": { color: theme.accent, borderColor: theme.accent },
    "& .MuiTab-root": { color: theme.foreground },
    "& .MuiTab-root.Mui-selected": { color: theme.accent },
    "& .MuiTabs-indicator": { bgcolor: theme.accent },
    overflowWrap: "anywhere",
  } as const;
}

/** The organizer-styled area. contain: paint keeps custom CSS from painting over Ventry UI outside it. */
/** Page-wide background behind header, menu and content; the colour stays as fallback while the image loads. */
export const pageBackgroundSx = (theme: PageTheme) => ({
  bgcolor: theme.background, color: theme.foreground,
  ...(theme.backgroundImage ? { backgroundImage: `url("${theme.backgroundImage}")`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: { md: "fixed" } } : {}),
});

export function EventSiteFrame({ theme, children, sx }: { theme: PageTheme; children: ReactNode; sx?: SxProps<Theme> }) {
  return <Box className={PAGE_ROOT_CLASS} sx={[{ contain: "paint", isolation: "isolate" }, themeSx(theme), ...(Array.isArray(sx) ? sx : [sx])]}>{children}</Box>;
}

/** Renders CSS produced by buildSiteCss (sanitized, never raw organizer input). */
export function EventSiteStyles({ css }: { css: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by buildSiteCss, which rejects any </style.
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

export function EventSiteHeader({ theme, name, imageUrl, children }: { theme: PageTheme; name: string; imageUrl?: string | null; children?: ReactNode }) {
  const source = theme.headerUrl || imageUrl;
  return <Box className="vp-header" sx={{ position: "relative", height: { xs: 300, md: 500 }, bgcolor: "grey.900", overflow: "hidden" }}>
    {source && <MotionSafeImage eager src={source} poster={theme.headerPosterUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }} />}
    <Box className="vp-header-text" sx={{ position: "absolute", bottom: 0, width: "100%", p: { xs: 3, md: 6 }, color: "white", background: "linear-gradient(transparent, rgba(0,0,0,.9))", "& .MuiTypography-root": { color: "white" } }}>
      <Box sx={{ maxWidth: "lg", mx: "auto" }}>
        <Box component="h1" className="vp-title" sx={{ m: 0, fontSize: { xs: "2rem", md: "3.75rem" }, lineHeight: 1.15, fontWeight: 700, overflowWrap: "anywhere" }}>{name}</Box>
        {children}
      </Box>
    </Box>
  </Box>;
}
