// ── PMESII Analysis — Edit / Add Modal ────────────────────────────────────

import React, { useState } from "react";
import {
  MilModal,
  MilFormRow,
  MilFormGroup,
  MilTextArea,
  MilSelect,
} from "../shared/components/Modal.js";
import { MilButton } from "../shared/components/Button.js";
import type { PmesiiVariable } from "./types.js";

// ── Constants ──────────────────────────────────────────────────────────────

const REVIEWER_OPTIONS = (reviewers: string[]) => [
  { value: "",  label: "— No reviewer —" },
  ...reviewers.map(r => ({ value: r, label: r })),
];

// ── Props ──────────────────────────────────────────────────────────────────

interface PmesiiEditModalProps {
  variable: PmesiiVariable;
  reviewers: string[];
  onSave: (updated: PmesiiVariable) => void;
  onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export const PmesiiEditModal: React.FC<PmesiiEditModalProps> = ({
  variable,
  reviewers,
  onSave,
  onClose,
}) => {
  const [summary,  setSummary]  = useState(variable.summary);
  const [reviewer, setReviewer] = useState(variable.reviewer ?? "");
  const [flagCritical, setFlagCritical] = useState(variable.status === "critical");

  const isValid = summary.trim() !== "";
  const isNew   = variable.status === "pending" && !variable.summary.trim();

  const handleSave = () => {
    if (!isValid) return;

    // Status logic:
    // - critical flag overrides everything
    // - if was pending and now has content → in-review
    // - if was approved and edited → back to in-review (un-approves)
    // - otherwise keep existing status
    let nextStatus = variable.status;
    if (flagCritical) {
      nextStatus = "critical";
    } else if (variable.status === "pending") {
      nextStatus = "in-review";
    } else if (variable.status === "approved") {
      nextStatus = "in-review";   // editing an approved card reverts it
    }

    onSave({
      ...variable,
      summary:  summary.trim(),
      reviewer: reviewer || null,
      status:   nextStatus,
    });
    onClose();
  };

  return (
    <MilModal
      title={`${isNew ? "Add" : "Edit"} — ${variable.domain.toUpperCase()}`}
      titleIcon={isNew ? "add" : "edit"}
      onClose={onClose}
      actions={[
        { label: "Cancel",               variant: "default", onClick: onClose },
        { label: isNew ? "Add" : "Save", variant: "primary", icon: isNew ? "add" : "tick", disabled: !isValid, onClick: handleSave },
      ]}
    >
      {/* Summary */}
      <MilFormRow>
        <MilFormGroup label="Summary">
          <MilTextArea
            value={summary}
            onChange={setSummary}
            placeholder={`Describe the ${variable.domain} situation…`}
            rows={4}
          />
        </MilFormGroup>
      </MilFormRow>

      {/* Reviewer */}
      <MilFormRow>
        <MilFormGroup label="Reviewer">
          <MilSelect
            value={reviewer}
            options={REVIEWER_OPTIONS(reviewers)}
            onChange={setReviewer}
          />
        </MilFormGroup>
      </MilFormRow>

      {/* Critical flag */}
      <MilFormRow>
        <MilFormGroup label="Flag as Critical">
          <MilButton
            icon={flagCritical ? "warning-sign" : "flag"}
            variant={flagCritical ? "danger" : "default"}
            size="sm"
            onClick={() => setFlagCritical(prev => !prev)}
          >
            {flagCritical ? "Remove Critical Flag" : "Flag as Critical"}
          </MilButton>
        </MilFormGroup>
      </MilFormRow>

      {/* Info note when editing an approved card */}
      {variable.status === "approved" && (
        <p style={{ fontSize: "11px", color: "#f0a83c", marginTop: "4px" }}>
          ⚠ Editing this domain will revert its status to In Review and require re-approval.
        </p>
      )}
    </MilModal>
  );
};
