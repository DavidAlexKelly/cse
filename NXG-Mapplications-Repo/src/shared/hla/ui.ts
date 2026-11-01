// ── shared/hla/ui.ts ───────────────────────────────────────────────────────
// Theme tokens for the HLA views (live map + analysis replay). Both apps
// re-export this so the two screens cannot drift apart.
//
// Two palettes, because they are consumed by two different renderers:
//
//   UI   the interface — React inline styles. These are the design system's
//        CSS variables (@acc/decho-styling, set up in shared/styles/global.css)
//        so HLA Map and Analysis follow the same theme as the Scenario
//        Planner, Execute and Readiness, including any re-theme. Each carries
//        a fallback matching the dark theme, for a page without the tokens.
//
//   MAP  what is drawn ON the map. Leaflet writes colours into SVG
//        presentation attributes (stroke="…"), which cannot resolve var(),
//        so these stay literal — the same values as UI's fallbacks.
//
// For a translucent tint of a UI colour use tint(): appending a hex alpha
// ("${UI.amber}22") only works on literal hex, not on a var().

export const MAP = {
  bg: "#0b0f17",
  text: "#e0e4ec",
  textDim: "#8a93a6",
  textFaint: "#4f5b68",
  accent: "#2fbf71",
  blue: "#58a6ff",
  red: "#e5534b",
  green: "#2fbf71",
  amber: "#f0b429",
  /** For HTML strings in map labels and tooltips: inline styles resolve
   *  var(), but UI.fontSans's quotes would end a style="…" attribute. */
  font: "var(--font-sans, Inter, system-ui, sans-serif)",
} as const;

export const UI = {
  bg0: `var(--bg-base, ${MAP.bg})`,
  bg1: "var(--bg-panel-flat, #111418)",
  bg2: "var(--bg-raised-flat, #1a2030)",
  border: "var(--border-subtle, #232a40)",
  borderStrong: "var(--border-default, #2f3860)",
  text: `var(--text-primary, ${MAP.text})`,
  textDim: `var(--text-muted, ${MAP.textDim})`,
  textFaint: `var(--text-disabled, ${MAP.textFaint})`,
  /** The app accent — selection, focus, primary actions. */
  accent: `var(--accent-primary, ${MAP.accent})`,
  /** Screen eyebrows ("EXECUTE", "ANALYSE"), as on every other screen. */
  eyebrow: "#58a6ff",
  blue: `var(--accent-blue, ${MAP.blue})`,
  red: `var(--accent-red, ${MAP.red})`,
  green: `var(--accent-green, ${MAP.green})`,
  amber: `var(--accent-amber, ${MAP.amber})`,
  /** Interface text: labels, buttons, headings. */
  fontSans: 'var(--font-sans, "Inter", system-ui, sans-serif)',
  /** Data: clocks, timestamps, coordinates, counts in tables, logs. */
  fontMono: 'var(--font-mono, "JetBrains Mono", ui-monospace, monospace)',
  radius: "var(--radius-sm, 4px)",
  radiusCard: "8px",
} as const;

/** A translucent version of a UI colour — works on var() and hex alike. */
export function tint(colour: string, percent: number): string {
  return `color-mix(in srgb, ${colour} ${percent}%, transparent)`;
}

/** Marker/label colour for a force, used for headings and roll-up badges. */
export function forceColor(force: "BLUE" | "RED"): string {
  return force === "BLUE" ? "#80C0FF" : "#FF8080";
}
