/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { Icon } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import React from "react";
import "../styling/components.css";
import { MilLabel } from "./Label.js";
import type { MilLabelIntent } from "./Label.js";

// ── Public types ───────────────────────────────────────────────────────────

/** Left-border accent on a row */
export type MilListItemAccent = "active" | "warning" | "critical" | "none";

export interface MilListItemAction {
  icon: IconName;
  title?: string;
  intent?: "danger" | "default";
  onClick: (e: React.MouseEvent) => void;
}

export interface MilListItemProps {
  /** Primary title text */
  title: React.ReactNode;
  /** Secondary line beneath the title */
  meta?: React.ReactNode;
  /** BlueprintJS icon on the left */
  icon?: IconName;
  /** Coloured left-border accent */
  accent?: MilListItemAccent;
  /** Whether this row is the currently selected item */
  selected?: boolean;
  /** Badge / tag elements rendered right of meta, before actions */
  badges?: React.ReactNode;
  /** Icon-button actions revealed on hover */
  actions?: MilListItemAction[];
  onClick?: () => void;
  className?: string;
}

export interface MilListProps {
  /** Section heading shown above the list */
  sectionLabel?: string;
  /** Items to render */
  items: MilListItemProps[];
  /** Element shown when items is empty */
  emptyIcon?: IconName;
  emptyText?: string;
  className?: string;
}

// ── Accent → CSS modifier ──────────────────────────────────────────────────
const ACCENT_CLASS: Record<MilListItemAccent, string> = {
  active:   "mil-list-item--active",
  warning:  "mil-list-item--warning",
  critical: "mil-list-item--critical",
  none:     "",
};

// ── Single row ─────────────────────────────────────────────────────────────
export const MilListItem: React.FC<MilListItemProps> = ({
  title,
  meta,
  icon,
  accent = "none",
  selected = false,
  badges,
  actions = [],
  onClick,
  className = "",
}) => {
  const classes = [
    "mil-list-item",
    ACCENT_CLASS[accent],
    selected ? "mil-list-item--selected" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} onClick={onClick}>
      {icon && (
        <div className="mil-list-item__icon">
          <Icon icon={icon} size={14} />
        </div>
      )}

      <div className="mil-list-item__content">
        <div className="mil-list-item__title">{title}</div>
        {meta && (
          <MilLabel variant="meta">{meta}</MilLabel>
        )}
      </div>

      {badges && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {badges}
        </div>
      )}

      {actions.length > 0 && (
        <div className="mil-list-item__actions">
          {actions.map((action, i) => (
            <button
              key={i}
              className={`mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only${action.intent === "danger" ? " mil-btn--danger" : ""}`}
              title={action.title}
              onClick={(e) => { e.stopPropagation(); action.onClick(e); }}
            >
              <Icon icon={action.icon} size={12} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── List container ─────────────────────────────────────────────────────────
export const MilList: React.FC<MilListProps> = ({
  sectionLabel,
  items,
  emptyIcon = "search",
  emptyText = "No items found",
  className = "",
}) => {
  return (
    <div className={className}>
      {sectionLabel && (
        <MilLabel variant="section">{sectionLabel}</MilLabel>
      )}

      <div className="mil-list">
        {items.length === 0 ? (
          <div className="mil-empty">
            <Icon icon={emptyIcon} size={32} />
            <div className="mil-empty__text">{emptyText}</div>
          </div>
        ) : (
          items.map((item, i) => (
            <MilListItem key={i} {...item} />
          ))
        )}
      </div>
    </div>
  );
};

// ── Re-export intent type so consumers don't need a separate import ─────────
export type { MilLabelIntent };
