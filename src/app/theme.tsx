'use client';

import type * as React from 'react';
import { createTheme, ThemeProvider as MUIThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { kissCut } from '@/lib/ui/kissCut';

/**
 * "Kiss-Cut Sheet": warm white stock, a waxy liner for rails and insets, near-black ink,
 * and saturated spot inks that each carry one job. State (statuses, tags, avatars) is drawn
 * as die-cut stickers; surfaces stay flat and are separated by 1px rules, not shadows.
 * Custom tokens (liner, rule, sticker outline) live as CSS variables in globals.css.
 */
const display = 'var(--font-display), "Rubik", system-ui, sans-serif';
const body = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';


const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: 'class',
  },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#0b7a7c', contrastText: '#ffffff' },
        secondary: { main: '#5f3fd0', contrastText: '#ffffff' },
        success: { main: '#1f7442', contrastText: '#ffffff' },
        error: { main: '#c4421f', contrastText: '#ffffff' },
        warning: { main: '#f2b134', contrastText: '#1d1b22' },
        info: { main: '#0b7a7c', contrastText: '#ffffff' },
        text: { primary: '#1d1b22', secondary: '#625e6a' },
        divider: '#e2ded5',
        background: { default: '#fbfaf7', paper: '#ffffff' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#3cc2c4', contrastText: '#141318' },
        secondary: { main: '#a48bff', contrastText: '#141318' },
        success: { main: '#4cc47a', contrastText: '#141318' },
        error: { main: '#ff7a55', contrastText: '#141318' },
        warning: { main: '#f5c04f', contrastText: '#141318' },
        info: { main: '#3cc2c4', contrastText: '#141318' },
        text: { primary: '#f2efe9', secondary: '#a8a3b1' },
        divider: '#2e2b35',
        background: { default: '#141318', paper: '#1b1a20' },
      },
    },
  },
  // Kept at MUI's base 4: ~77 existing sx props use numeric radii (2 = 8px). The 12-14px sheet radius is set per component below.
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: body,
    h1: { fontFamily: display, fontWeight: 700, fontSize: '3rem', letterSpacing: '-0.02em', lineHeight: 1.1 },
    h2: { fontFamily: display, fontWeight: 700, fontSize: '2.375rem', letterSpacing: '-0.02em', lineHeight: 1.15 },
    h3: { fontFamily: display, fontWeight: 600, fontSize: '2rem', letterSpacing: '-0.015em', lineHeight: 1.2 },
    h4: { fontFamily: display, fontWeight: 600, fontSize: '1.625rem', letterSpacing: '-0.01em', lineHeight: 1.25 },
    h5: { fontFamily: display, fontWeight: 600, fontSize: '1.3125rem', lineHeight: 1.3 },
    h6: { fontFamily: display, fontWeight: 600, fontSize: '1.0625rem', lineHeight: 1.35 },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600, fontSize: '0.8125rem', letterSpacing: '0.02em' },
    overline: { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.08em', lineHeight: 1.6 },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0, fontSize: '0.9375rem' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { fontVariantNumeric: 'tabular-nums' },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none' },
        rounded: { borderRadius: 12 },
        // Flat sheet: depth comes from a 1px rule, not elevation shadows.
        elevation: ({ theme }) => ({ border: `1px solid ${theme.vars.palette.divider}` }),
      },
    },
    MuiCard: { defaultProps: { elevation: 0 } },
    MuiSkeleton: { styleOverrides: { rounded: { borderRadius: 12 } } },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      // '&&' outranks the flat-paper border so the bar keeps only its bottom rule.
      styleOverrides: { root: ({ theme }) => ({ '&&': { border: 0, borderBottom: `1px solid ${theme.vars.palette.divider}` }, backgroundColor: theme.vars.palette.background.default }) },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 12, paddingInline: 18, minHeight: 40 },
        sizeSmall: { minHeight: 32, paddingInline: 12, borderRadius: 10 },
        sizeLarge: { minHeight: 48, paddingInline: 22, fontSize: '1rem' },
        // The next action is the one ink-filled button; teal stays for links, selection and focus.
        containedPrimary: ({ theme }) => ({
          backgroundColor: theme.vars.palette.text.primary,
          color: theme.vars.palette.background.paper,
          '&:hover': { backgroundColor: theme.vars.palette.primary.main, color: theme.vars.palette.primary.contrastText },
        }),
        outlined: ({ theme }) => ({ borderColor: theme.vars.palette.divider, backgroundColor: theme.vars.palette.background.paper }),
        outlinedPrimary: ({ theme }) => ({ color: theme.vars.palette.text.primary, '&:hover': { borderColor: theme.vars.palette.text.primary, backgroundColor: theme.vars.palette.background.paper } }),
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiChip: {
      styleOverrides: {
        root: { ...kissCut, fontWeight: 600, borderRadius: 999, height: 'auto', minHeight: 28 },
        label: { paddingInline: 10, paddingBlock: 2 },
        sizeSmall: { minHeight: 24, fontSize: '0.75rem' },
        filled: ({ theme }) => ({ '&.MuiChip-colorDefault': { backgroundColor: 'var(--liner)', color: theme.vars.palette.text.primary } }),
        outlined: { boxShadow: 'none', border: '1px solid var(--rule)' },
      },
    },
    MuiAvatar: { styleOverrides: { root: { ...kissCut, fontFamily: display, fontWeight: 600 } } },
    MuiBadge: { styleOverrides: { badge: { ...kissCut, fontWeight: 700 } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 12,
          backgroundColor: theme.vars.palette.background.paper,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--rule-strong)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: theme.vars.palette.text.secondary },
        }),
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontWeight: 500 } } },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 14, border: '1px solid', alignItems: 'center' },
        standardSuccess: ({ theme }) => ({ borderColor: `rgba(${theme.vars.palette.success.mainChannel} / 0.35)` }),
        standardInfo: ({ theme }) => ({ borderColor: `rgba(${theme.vars.palette.info.mainChannel} / 0.35)` }),
        standardWarning: ({ theme }) => ({ borderColor: `rgba(${theme.vars.palette.warning.mainChannel} / 0.6)` }),
        standardError: ({ theme }) => ({ borderColor: `rgba(${theme.vars.palette.error.mainChannel} / 0.35)` }),
      },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 18 } } },
    MuiDialogTitle: { styleOverrides: { root: { fontFamily: display, fontWeight: 600 } } },
    MuiMenu: { styleOverrides: { paper: { borderRadius: 14, marginTop: 4 } } },
    MuiPopover: { defaultProps: { slotProps: { paper: { elevation: 8 } } } },
    MuiTooltip: { styleOverrides: { tooltip: ({ theme }) => ({ backgroundColor: theme.vars.palette.text.primary, color: theme.vars.palette.background.paper, fontSize: '0.8125rem', borderRadius: 8 }) } },
    MuiTabs: { styleOverrides: { indicator: { height: 3, borderRadius: 3 } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, fontSize: '0.9375rem', minHeight: 48 } } },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({ borderBottomColor: theme.vars.palette.divider }),
        head: ({ theme }) => ({ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.vars.palette.text.secondary }),
      },
    },
    MuiDivider: { styleOverrides: { root: ({ theme }) => ({ borderColor: theme.vars.palette.divider }) } },
    MuiListItemButton: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 999, height: 8, backgroundColor: 'var(--liner)' }, bar: { borderRadius: 999 } } },
    MuiDrawer: { styleOverrides: { paper: { backgroundColor: 'var(--liner)', borderRight: '1px dashed var(--rule-strong)' } } },
    MuiLink: { defaultProps: { underline: 'hover' }, styleOverrides: { root: { fontWeight: 500, textUnderlineOffset: '0.18em' } } },
  },
});

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <MUIThemeProvider theme={theme} defaultMode="system">
      <CssBaseline />
      {children}
    </MUIThemeProvider>
  );
}
