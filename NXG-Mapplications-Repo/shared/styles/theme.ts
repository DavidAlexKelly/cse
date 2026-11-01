// ============================================================
// Design tokens for inline styles — sourced from the package
// ------------------------------------------------------------
// This module used to be a second copy of the palette: the same
// colours as global.css, written again as TypeScript, kept in step
// by hand. It is now a projection of @acc/decho-styling's `modern`
// theme, so there is one source of truth behind both the CSS
// variables and the values that end up in `style={{ ... }}`.
//
// It had no importers when it was rewritten — the apps were using
// CSS variables and hard-coded hexes instead — so this is also the
// module to reach for when converting those hexes. Prefer
// `var(--token)` in CSS; prefer these constants in TSX, and note
// the warning below before using either on a map.
//
// MAPS AND CANVASES
// -----------------
// MapLibre paint properties, deck.gl accessors, canvas fills and
// milsymbol options take real colour values, not CSS. A
// `var(--decho-color-accent)` handed to any of them resolves to
// nothing and the layer silently disappears. Use these constants
// there — they are plain strings — and keep `var()` for the DOM.
//
// WHY `modern`, RE-TINTED
// -----------------------
// It is what index.html selects (`decho-root decho-modern`), with the
// accent replaced by green. Change this line and the variables in
// global.css together — they are two halves of one decision — or call
// `tokensFor(skin)` directly if an app ever needs to differ.
// ============================================================

import { chartSeries, withAccent } from "@acc/decho-styling";

/**
 * The theme these apps are drawn in: modern, re-tinted green.
 *
 * Kept in step with the accent variables in global.css by hand — this is the
 * inline-style half of the same decision, and the two have to agree.
 */
const ACCENT = "#2fbf71";
const T = withAccent("modern", ACCENT);

export const colors = {
  // Backgrounds. Opaque in classic; translucent glass in the modern
  // and daylight themes, which is why map and canvas code should take
  // these constants rather than assuming a solid fill.
  bgBase: T.color.bg,
  bgSurface: T.color.surface,
  bgPanel: T.color.surface,
  bgRaised: T.color.surfaceRaised,
  bgHover: T.color.surfaceRaised,
  bgActive: T.color.accentSoft,
  bgOverlay: T.color.surfaceOverlay,

  // Borders
  borderSubtle: T.color.borderSubtle,
  borderDefault: T.color.border,
  borderStrong: T.color.borderStrong,

  // Accent
  accentPrimary: T.color.accent,
  accentPrimaryHover: T.color.accentHover,
  accentPrimaryMuted: T.color.accentSoft,
  accentPrimaryGlow: T.color.accentSoft,

  accentAmber: T.color.warning,
  accentAmberMuted: T.color.warningSoft,
  accentRed: T.color.danger,
  accentRedHover: T.color.danger,
  accentRedMuted: T.color.dangerSoft,
  accentBlue: T.color.info,
  accentBlueMuted: T.color.infoSoft,

  /** AI features — the controls that hand work to a model. */
  accentAi: T.color.ai,
  accentAiMuted: T.color.aiSoft,

  // Text
  textPrimary: T.color.text,
  textSecondary: T.color.textMuted,
  textMuted: T.color.textFaint,
  textDisabled: T.color.textFaint,
  textOnAccent: T.color.onAccent,

  // Status tones — "how should this look".
  statusGreen: T.color.success,
  statusAmber: T.color.warning,
  statusRed: T.color.danger,
  statusGrey: T.color.textMuted,
  statusBlue: T.color.info,
} as const;

/**
 * The RAG scale — "what state is this item in".
 *
 * A separate object from `colors` because it is a separate question:
 * a tone is a visual weight, a status is a fact about the work. Use
 * it for readiness, validation and phase-status columns so the ORBAT
 * manager and the scenario planner cannot disagree about amber.
 */
export const rag = {
  critical: T.status.critical,
  high: T.status.high,
  atRisk: T.status.atRisk,
  onTrack: T.status.onTrack,
  complete: T.status.complete,
  notAssessed: T.status.notAssessed,
  noData: T.status.noData,
} as const;

/**
 * Chart series, in order, plus axis and grid.
 *
 * `chartSeries(i)` wraps, so an eleventh series repeats rather than
 * rendering invisibly — a chart needing more than ten colours needs
 * grouping instead.
 */
export { chartSeries };

export const chart = {
  series: [
    T.chart.series1,
    T.chart.series2,
    T.chart.series3,
    T.chart.series4,
    T.chart.series5,
    T.chart.series6,
    T.chart.series7,
    T.chart.series8,
    T.chart.series9,
    T.chart.series10,
  ],
  axis: T.chart.axis,
  grid: T.chart.grid,
} as const;

export const gradients = {
  /** The light behind everything. Already on <body> via global.css. */
  bgBase: T.gradient.app,
  bgSurface: T.gradient.surface,
  bgPanel: T.gradient.surface,
  bgRaised: T.gradient.raised,
  accentPrimary: T.gradient.accent,
  /** The indigo → violet → teal rule along the top of a surface. */
  accentHairline: T.gradient.hairline,
} as const;

export const typography = {
  fontFamily: "var(--font-sans)",
  fontFamilyMono: "var(--font-mono)",

  // This repo's scale, not the package's — see the note in global.css.
  fontSizeXs: "10px",
  fontSizeSm: "12px",
  fontSizeMd: "13px",
  fontSizeLg: "14px",
  fontSizeXl: "16px",
  fontSize2xl: "20px",
  fontSize3xl: "24px",

  fontWeightNormal: "400",
  fontWeightMedium: "500",
  fontWeightSemibold: "600",
  fontWeightBold: "700",

  lineHeightTight: "1.2",
  lineHeightNormal: "1.5",
  lineHeightRelaxed: "1.6",
  lineHeightLoose: "1.7",
} as const;

// Also this repo's own: 4px steps, where the package counts in 2s.
export const spacing = {
  "1": "4px",
  "2": "8px",
  "3": "12px",
  "4": "16px",
  "5": "20px",
  "6": "24px",
  "8": "32px",
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  "2xl": "32px",
} as const;

export const radii = {
  none: "0px",
  sm: T.radius.sm,
  md: T.radius.md,
  lg: T.radius.lg,
  pill: T.radius.lg,
  full: T.radius.pill,
} as const;

export const shadows = {
  xs: T.shadow.sm,
  sm: T.shadow.sm,
  card: T.shadow.card,
  panel: T.shadow.panel,
  modal: T.shadow.panel,
  hover: T.shadow.cardHover,
  focus: `0 0 0 2px ${T.color.accentSoft}`,
  glow: T.shadow.selected,
  inset: "inset 0 1px 3px rgba(0, 0, 0, 0.4)",
} as const;

export const transitions = {
  fast: T.effect.transition,
  normal: T.effect.transition,
  slow: "0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  snap: "0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

/**
 * Avatar colours — deterministic per name.
 *
 * The chart series doubles as the avatar palette: ten distinguishable
 * colours already tuned to sit next to each other.
 */
export const avatarColors = chart.series;

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}
