/**
 * milStyles.ts — design tokens aligned with the Military Dark Theme
 * (same palette as global.css / theme.ts used across other widgets).
 */

import type React from "react";

// ── Colour palette (mirrors theme.ts) ─────────────────────────────────────
export const C = {
  // backgrounds
  bg:        "#080b16",   // bgBase
  bg2:       "#101424",   // bgPanel
  bg3:       "#101424",   // bgSurface
  surface:   "#191e37",   // bgRaised
  border:    "#232a45",   // borderSubtle
  borderLt:  "#2f3860",   // borderDefault

  // text
  text:      "#e9ecfb",   // textPrimary
  text2:     "#9aa3c4",   // textSecondary
  muted:     "#6a7292",   // textMuted

  // accents
  cyan:      "#2fbf71",   // accentPrimary (military green)
  cyanLt:    "#50c988",   // accentPrimaryHover
  cyanDim:   "rgba(74,124,89,0.15)",

  olive:     "#2fbf71",
  oliveLt:   "#50c988",
  oliveMut:  "rgba(74,124,89,0.15)",

  amber:     "#f0a83c",
  amberMut:  "rgba(201,146,42,0.15)",

  red:       "#ef5350",
  redMut:    "rgba(176,58,46,0.15)",

  navy:      "#101424",   // bgSurface (header/sidebar bg)
  navyDk:    "#080b16",   // bgBase
};

// ── Common element styles ──────────────────────────────────────────────────

export const inputStyle: React.CSSProperties = {
  padding: "5px 9px",
  background: "var(--bg-surface-flat)",
  border: "1px solid var(--border-default)",
  borderRadius: 2,
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  transition: "border-color 0.1s",
};

export const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

export const textAreaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical" as const,
  minHeight: 60,
  lineHeight: 1.5,
};

export const fieldLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  color: "var(--text-muted)",
  marginBottom: 4,
  display: "block",
};

// ── Button variants ────────────────────────────────────────────────────────

export function btnPrimary(fill = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: "5px 14px",
    height: 30,
    background: "#2fbf71",
    color: "#ffffff",
    border: "1px solid #2fbf71",
    borderRadius: 2,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    ...(fill ? { width: "100%" } : {}),
  };
}

export function btnDefault(fill = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: "5px 14px",
    height: 30,
    background: "#191e37",
    color: "#e9ecfb",
    border: "1px solid #2f3860",
    borderRadius: 2,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    ...(fill ? { width: "100%" } : {}),
  };
}

export function btnDanger(fill = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: "5px 14px",
    height: 30,
    background: "transparent",
    color: "#ef5350",
    border: "1px solid transparent",
    borderRadius: 2,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    ...(fill ? { width: "100%" } : {}),
  };
}

export function btnGhost(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: "3px 10px",
    height: 26,
    background: "transparent",
    color: "#9aa3c4",
    border: "1px solid transparent",
    borderRadius: 2,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    letterSpacing: "0.05em",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  };
}

// ── Simple modal overlay ───────────────────────────────────────────────────

export const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 16,
  overflowY: "auto",
};

export const modalStyle: React.CSSProperties = {
  background: "var(--bg-panel-flat)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 4,
  width: 560,
  maxWidth: "calc(100vw - 32px)",
  maxHeight: "90vh",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 12px 40px rgba(0,0,0,0.85)",
  minHeight: 0,
};
