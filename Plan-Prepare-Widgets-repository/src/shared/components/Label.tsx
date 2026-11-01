import { Icon } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import React from "react";
import "../styling/components.css";

// ── Public types ───────────────────────────────────────────────────────────

/** Visual intent / colour of the label */
export type MilLabelIntent = "green" | "amber" | "red" | "blue" | "grey";

/** Structural role — drives typography and sizing */
export type MilLabelVariant =
  | "badge"       // small coloured pill  e.g. "RESTRICTED", "Active"
  | "section"     // all-caps section heading row
  | "meta"        // secondary small text beneath a title
  | "status-dot"; // coloured dot + text for status bars

export interface MilLabelProps {
  children: React.ReactNode;
  variant?: MilLabelVariant;
  intent?: MilLabelIntent;
  /** Optional BlueprintJS icon shown before the text */
  icon?: IconName;
  className?: string;
}

// ── Intent → CSS modifier (used by badge & status-dot) ─────────────────────
const INTENT_CLASS: Record<MilLabelIntent, string> = {
  green: "mil-label--green",
  amber: "mil-label--amber",
  red:   "mil-label--red",
  blue:  "mil-label--blue",
  grey:  "mil-label--grey",
};

// ── dot colour (status-dot variant) ────────────────────────────────────────
const DOT_CLASS: Record<MilLabelIntent, string> = {
  green: "",
  amber: "mil-statusbar__dot--amber",
  red:   "mil-statusbar__dot--red",
  blue:  "mil-statusbar__dot--amber", // no native blue dot, reuse amber slot
  grey:  "mil-statusbar__dot--red",   // fallback
};

// ── Component ──────────────────────────────────────────────────────────────
export const MilLabel: React.FC<MilLabelProps> = ({
  children,
  variant = "badge",
  intent = "grey",
  icon,
  className = "",
}) => {
  // ── badge ────────────────────────────────────────────────────────────────
  if (variant === "badge") {
    return (
      <span className={`mil-badge ${INTENT_CLASS[intent]} ${className}`}>
        {icon && <Icon icon={icon} size={10} style={{ marginRight: 4 }} />}
        {children}
      </span>
    );
  }

  // ── section heading ──────────────────────────────────────────────────────
  if (variant === "section") {
    return (
      <div className={`mil-section-label ${className}`}>
        {icon && <Icon icon={icon} size={10} style={{ marginRight: 5 }} />}
        {children}
      </div>
    );
  }

  // ── meta / secondary text ────────────────────────────────────────────────
  if (variant === "meta") {
    return (
      <div className={`mil-list-item__meta ${className}`}>
        {icon && <Icon icon={icon} size={10} style={{ marginRight: 4 }} />}
        {children}
      </div>
    );
  }

  // ── status-dot (for status bars) ─────────────────────────────────────────
  if (variant === "status-dot") {
    return (
      <div className={`mil-statusbar__item ${className}`}>
        <div className={`mil-statusbar__dot ${DOT_CLASS[intent]}`} />
        {children}
      </div>
    );
  }

  return null;
};
