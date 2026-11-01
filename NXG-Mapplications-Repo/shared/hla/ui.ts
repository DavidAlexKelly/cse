// ── shared/hla/ui.ts ───────────────────────────────────────────────────────
// Dark console theme tokens for the HLA views (live map + analysis replay),
// matching execution-demo's palette. Previously duplicated in
// hlamap/components/ui.ts and analysisScreen/components/ui.ts; both now
// re-export this so the two screens cannot drift apart.

export const UI = {
  bg0: "#0e1219",
  bg1: "#141b26",
  bg2: "#1a2333",
  border: "#253041",
  text: "#c8d6e5",
  textDim: "#6b8299",
  textFaint: "#3a4d5f",
  accent: "#4fc3f7",
  blue: "#4d9fdc",
  red: "#d95c5c",
  green: "#52b788",
  amber: "#c9943a",
  fontSans: "Arial, 'Helvetica Neue', sans-serif",
  fontMono: "'Courier New', Courier, monospace",
} as const;

/** Marker/label colour for a force, used for headings and roll-up badges. */
export function forceColor(force: "BLUE" | "RED"): string {
  return force === "BLUE" ? "#80C0FF" : "#FF8080";
}
