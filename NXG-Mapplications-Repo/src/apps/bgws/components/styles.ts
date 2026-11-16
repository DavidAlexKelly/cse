// ── bgws/components/styles.ts ──────────────────────────────────────────────
// Inline-style helpers for the BGWS panels, on the shared HLA console palette
// (shared/hla/ui) so this screen sits beside HLA Map and Analysis without
// looking like a different product. Buttons use the shared mil-btn classes.

import type { CSSProperties } from "react";
import { UI, tint } from "@/shared/hla/ui";
import type { OrderState } from "../types";
import { stateTone } from "../lib/outcomes";

export { UI, tint };

export const section: CSSProperties = {
  padding: "10px 12px",
  borderBottom: `1px solid ${UI.border}`,
};

export const heading: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: UI.textFaint,
  letterSpacing: 1,
  marginBottom: 6,
  textTransform: "uppercase",
};

export const row: CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" };

export const field: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  fontSize: 10,
  color: UI.textDim,
  flex: 1,
  minWidth: 0,
};

export const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: UI.bg2,
  border: `1px solid ${UI.border}`,
  borderRadius: UI.radius,
  color: UI.text,
  fontFamily: UI.fontSans,
  fontSize: 11,
  padding: "5px 6px",
};

export const mono: CSSProperties = { fontFamily: UI.fontMono, fontSize: 11 };

export const panel = (width: number): CSSProperties => ({
  width,
  flexShrink: 0,
  background: UI.bg1,
  borderLeft: `1px solid ${UI.border}`,
  borderRight: `1px solid ${UI.border}`,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  fontFamily: UI.fontSans,
  color: UI.text,
});

const TONE_COLOUR = {
  neutral: UI.textDim,
  progress: UI.blue,
  good: UI.green,
  bad: UI.red,
  muted: UI.textFaint,
} as const;

export function stateColour(state: OrderState): string {
  return TONE_COLOUR[stateTone(state)];
}

/** Colour for a BGWS federate state word. */
export function federateStateColour(state: string): string {
  switch (state) {
    case "running":
      return UI.green;
    case "ready":
    case "paused":
      return UI.blue;
    case "loading":
    case "building_terrain":
      return UI.amber;
    case "error":
      return UI.red;
    default:
      return UI.textDim;
  }
}

export function chip(colour: string, active = true): CSSProperties {
  return {
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: 999,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    border: `1px solid ${active ? colour : tint(colour, 35)}`,
    color: active ? colour : tint(colour, 60),
    background: active ? tint(colour, 12) : "transparent",
    whiteSpace: "nowrap",
  };
}
