// ============================================================
// Design tokens for inline styles — sourced from the package
// ------------------------------------------------------------
// This module used to be the second copy of the palette: the same
// colours as global.css, written again as TypeScript, kept in step
// by hand. It is now a thin projection of @acc/decho-styling's
// `modern` skin, so there is one source of truth for both the CSS
// variables and the values that end up in `style={{ ... }}`.
//
// The export shape is unchanged on purpose. Roughly 600 call sites
// across eighteen widgets import `colors`, `typography`, `radii`
// and friends; renaming them would be a large diff with no
// behavioural change. New code can import from the package
// directly — `import { tokensFor } from "@acc/decho-styling"` —
// and both will agree, because this is that.
//
// WHY `modern`
// ------------
// It is the skin these widgets are drawn in: the lit indigo
// command-centre look. `tokensFor("classic")` is the older flat
// palette, and switching this one line would take every widget
// back to it.
// ============================================================

import { tokensFor } from "@acc/decho-styling";

const T = tokensFor("modern");

export const colors = {
  // Backgrounds. In this skin the surfaces are translucent by
  // design — they are glass over the app gradient, not slabs.
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
  accentPrimaryActive: T.color.accent,
  accentPrimaryMuted: T.color.accentSoft,
  accentPrimaryGlow: T.color.accentSoft,

  // Violet and teal are the stops of the package's hairline
  // gradient rather than tokens of their own; they live here so
  // this file and global.css cannot disagree about them.
  accentViolet: "#c47af5",
  accentVioletMuted: "rgba(196, 122, 245, 0.16)",
  accentCyan: "#35d6c0",
  accentCyanMuted: "rgba(53, 214, 192, 0.14)",

  accentGreen: T.color.success,
  accentGreenBright: T.color.success,
  accentGreenMuted: T.color.successSoft,

  accentAmber: T.color.warning,
  accentAmberMuted: T.color.warningSoft,
  accentAmberGlow: T.color.warningSoft,

  accentRed: T.color.danger,
  accentRedHover: T.color.danger,
  accentRedMuted: T.color.dangerSoft,

  accentBlue: T.color.info,
  accentBlueMuted: T.color.infoSoft,

  // Text
  textPrimary: T.color.text,
  textSecondary: T.color.textMuted,
  textMuted: T.color.textFaint,
  textDisabled: T.color.textFaint,
  textOnAccent: T.color.onAccent,

  // Status tones — "how should this tag look". Not the RAG scale below.
  statusGreen: T.color.success,
  statusAmber: T.color.warning,
  statusRed: T.color.danger,
  statusGrey: T.color.textMuted,
  statusBlue: T.color.info,
  statusViolet: "#c47af5",

  // AI — the controls that hand work to a model.
  accentAi: T.color.ai,
  accentAiMuted: T.color.aiSoft,
} as const;

/**
 * The RAG scale — "what state is this item in".
 *
 * Deliberately a separate object from `colors`, because it is a separate
 * question: a tone is a visual weight, a status is a fact about the work. Same
 * seven everywhere, so a heatmap in the planner and a status column in the
 * task manager cannot disagree about what amber means.
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
 * Chart series colours, in order.
 *
 * `chartSeries(i)` wraps, so an eleventh series repeats rather than rendering
 * invisibly — a chart that needs more than ten colours needs grouping instead.
 */
export { chartSeries } from "@acc/decho-styling";

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
  /** The light behind everything. Put it on the widget's root. */
  bgBase: T.gradient.app,
  bgSurface: T.gradient.surface,
  bgPanel: T.gradient.surface,
  bgRaised: T.gradient.raised,
  bgGlass: T.gradient.surface,
  accentPrimary: T.gradient.accent,
  /** The indigo → violet → teal rule along the top of a surface. */
  accentSpectrum: T.gradient.hairline,
  accentRed: `linear-gradient(135deg, ${T.color.danger} 0%, ${T.color.danger} 100%)`,
  accentGreen: `linear-gradient(135deg, ${T.color.success} 0%, ${T.color.success} 100%)`,
} as const;

export const typography = {
  fontFamily: "var(--font-sans)",
  fontFamilyMono: "var(--font-mono)",

  // This repo's scale, not the package's — see the note in
  // global.css: the package stops at 15px and these headings do not.
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

  letterSpacingWide: "0.06em",
  letterSpacingWidest: "0.14em",
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
  "12": "48px",
  // Legacy aliases kept for backwards compatibility
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  "2xl": "32px",
  "3xl": "48px",
} as const;

export const radii = {
  none: "0px",
  sm: T.radius.sm,
  md: T.radius.md,
  lg: T.radius.lg,
  xl: "16px",
  pill: T.radius.pill,
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
  inset: "inset 0 1px 3px rgba(0, 0, 0, 0.45)",
  // Legacy aliases
  md: T.shadow.card,
  lg: T.shadow.panel,
} as const;

export const transitions = {
  fast: T.effect.transition,
  normal: T.effect.transition,
  slow: "0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  snap: "0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

/** Avatar colour palette — deterministic per-name colouring. */
export const avatarColors = [
  T.color.accent,
  T.color.info,
  "#35d6c0",
  "#c47af5",
  T.color.warning,
  T.color.success,
  T.color.accentHover,
  "#d05aa8",
] as const;

/**
 * Returns a deterministic avatar bg colour for a given name string.
 *
 * Still local: the package ships tokens, not helpers, and this is a
 * hash rather than a value. Worth moving there the second another
 * repo wants the same name to hash to the same colour — which is
 * exactly the argument that moved the palette.
 */
export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}
