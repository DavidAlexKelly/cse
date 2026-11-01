// ── PMESII Analysis — Domain Card ─────────────────────────────────────────

import { Icon } from "@blueprintjs/core";
import React from "react";
import { MilButton } from "../shared/components/Button.js";
import { MilLabel } from "../shared/components/Label.js";
import type { PmesiiVariable, PmesiiStatus, PmesiiDomain } from "./types.js";

// ── Domain → left-border colour ───────────────────────────────────────────

const DOMAIN_BORDER: Record<PmesiiDomain, string> = {
  "Political":            "#6a7292",
  "Military":             "#ef4d4d",
  "Economic":             "#f0a83c",
  "Social":               "#4c7ef3",
  "Infrastructure":       "#f0a83c",
  "Information":          "#6c5ce7",
  "Physical Environment": "#6a7292",
  "Time":                 "#6a7292",
};

// ── Status → badge intent ──────────────────────────────────────────────────

const STATUS_INTENT: Record<PmesiiStatus, "green" | "amber" | "red" | "grey"> = {
  approved:    "green",
  "in-review": "amber",
  pending:     "grey",
  critical:    "red",
};

const STATUS_LABEL: Record<PmesiiStatus, string> = {
  approved:    "Approved",
  "in-review": "In Review",
  pending:     "Pending",
  critical:    "Critical",
};

// ── Props ──────────────────────────────────────────────────────────────────

interface PmesiiCardProps {
  variable: PmesiiVariable;
  completionFraction: number;
  onEdit: (id: string) => void;
  onApprove: (id: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export const PmesiiCard: React.FC<PmesiiCardProps> = ({
  variable,
  completionFraction,
  onEdit,
  onApprove,
}) => {
  const isApproved = variable.status === "approved";
  const isPending  = variable.status === "pending";
  const isReview   = variable.status === "in-review";
  const isCritical = variable.status === "critical";

  const borderColor  = isApproved ? "#6c5ce7" : DOMAIN_BORDER[variable.domain];
  const statusIntent = STATUS_INTENT[variable.status];
  const statusLabel  = STATUS_LABEL[variable.status];

  const handleCardClick = () => {
    if (!isApproved) onEdit(variable.id);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(variable.id);
  };

  const handleApproveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onApprove(variable.id);
  };

  return (
    <div
      className={[
        "pa-card",
        isPending  ? "pa-card--pending"  : "",
        isApproved ? "pa-card--approved" : "",
        isCritical ? "pa-card--critical" : "",
      ].filter(Boolean).join(" ")}
      style={{ borderLeft: `3px solid ${borderColor}` }}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && handleCardClick()}
    >
      {/* ── Card header ─────────────────────────────────────────────── */}
      <div className="pa-card__header">
        <span className="pa-card__domain">
          {isApproved && (
            <Icon icon="tick-circle" size={10} className="pa-card__approved-icon" />
          )}
          {variable.domain.toUpperCase()}
        </span>
        <MilLabel variant="badge" intent={statusIntent}>
          {statusLabel}
        </MilLabel>
      </div>

      {/* ── Summary text ────────────────────────────────────────────── */}
      {isPending && !variable.summary.trim() ? (
        <p className="pa-card__summary pa-card__summary--empty">
          Click to add {variable.domain} variables…
        </p>
      ) : (
        <p className="pa-card__summary">{variable.summary}</p>
      )}

      {/* ── Card footer ─────────────────────────────────────────────── */}
      <div className="pa-card__footer">
        {/* Reviewer chip */}
        {variable.reviewer ? (
          <span className="pa-card__reviewer">
            <Icon icon="eye-open" size={10} />
            {variable.reviewer}
          </span>
        ) : (
          <span className="pa-card__reviewer pa-card__reviewer--none">
            No reviewer
          </span>
        )}

        {/* Actions */}
        <div className="pa-card__actions">
          {/* Approve — only shown when in-review or critical */}
          {(isReview || isCritical) && (
            <MilButton
              icon="tick"
              variant="primary"
              size="sm"
              onClick={handleApproveClick}
            >
              Approve
            </MilButton>
          )}
          {/* Edit — shown for non-pending cards; for approved, secondary style */}
          {!isPending && (
            <MilButton
              icon="edit"
              variant="ghost"
              size="sm"
              onClick={handleEditClick}
            >
              Edit
            </MilButton>
          )}
          {/* Add — pending cards */}
          {isPending && (
            <MilButton
              icon="add"
              variant="ghost"
              size="sm"
              onClick={handleEditClick}
            >
              Add
            </MilButton>
          )}
        </div>
      </div>

      {/* ── Approved stamp overlay ───────────────────────────────────── */}
      {isApproved && variable.reviewer && (
        <div className="pa-card__approved-stamp">
          <Icon icon="tick-circle" size={10} />
          Approved by {variable.reviewer}
        </div>
      )}

      {/* ── Completion pip ──────────────────────────────────────────── */}
      <div className="pa-card__pip-track">
        <div
          className="pa-card__pip-fill"
          style={{
            width: `${Math.round(completionFraction * 100)}%`,
            backgroundColor: isApproved ? "#6c5ce7" : DOMAIN_BORDER[variable.domain],
          }}
        />
      </div>
    </div>
  );
};
