/* eslint-disable jsx-a11y/no-autofocus */
// ============================================================
// CreatePhaseModal — creates a new [NXG-P] Phase.
// Dates are stored as ISO strings in startOffset / endOffset.
// ============================================================

import { Icon } from "@blueprintjs/core";
import React, { useCallback, useState } from "react";
import { createNxgPPhase } from "@custom-widget/sdk";
import { client } from "../client.js";
import {
  MilModal,
  MilFormGroup,
  MilFormRow,
  MilTextInput,
  MilTextArea,
  MilSelect,
  MilDateInput,
} from "../shared/components/Modal.js";

// ── Types ──────────────────────────────────────────────────────────────────

type PhaseStatus =
  | "draft"
  | "planning"
  | "needs-review"
  | "validated"
  | "approved"
  | "active";

interface FormValues {
  phaseName: string;
  phaseDescription: string;
  objectiveStatement: string;
  startDate: string; // ISO "YYYY-MM-DD" — stored in startOffset
  endDate: string; // ISO "YYYY-MM-DD" — stored in endOffset
  phaseStatus: PhaseStatus;
}

export interface CreatePhaseModalProps {
  scenarioId: string;
  nextSequenceNumber: number;
  onSuccess: () => void;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: PhaseStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "planning", label: "Planning" },
  { value: "needs-review", label: "Needs Review" },
  { value: "validated", label: "Validated" },
  { value: "approved", label: "Approved" },
  { value: "active", label: "Active" },
];

// ── Component ──────────────────────────────────────────────────────────────

export const CreatePhaseModal: React.FC<CreatePhaseModalProps> = ({
  scenarioId,
  nextSequenceNumber,
  onSuccess,
  onClose,
}) => {
  const defaultName = `Phase ${nextSequenceNumber}`;

  const [form, setForm] = useState<FormValues>({
    phaseName: defaultName,
    phaseDescription: "",
    objectiveStatement: "",
    startDate: "",
    endDate: "",
    phaseStatus: "draft",
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setError(null);
    },
    []
  );

  const handleSubmit = useCallback(async () => {
    if (!form.phaseName.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      await client(createNxgPPhase).applyAction({
        phaseName: form.phaseName.trim(),
        phaseDescription: form.phaseDescription.trim() || undefined,
        objectiveStatement: form.objectiveStatement.trim() || undefined,
        startOffset: form.startDate || undefined, // store date in startOffset
        endOffset: form.endDate || undefined, // store date in endOffset
        phaseStatus: form.phaseStatus,
        sequenceNumber: nextSequenceNumber,
        scenarioId,
      });

      onSuccess();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to create phase. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }, [form, scenarioId, nextSequenceNumber, onSuccess]);

  const canSubmit = form.phaseName.trim().length > 0 && !submitting;

  return (
    <MilModal
      title={`New Phase — Phase ${nextSequenceNumber}`}
      titleIcon="layers"
      size="md"
      onClose={onClose}
      actions={[
        { label: "Cancel", variant: "ghost", onClick: onClose },
        {
          label: submitting ? "Creating…" : "Create Phase",
          variant: "primary",
          icon: submitting ? undefined : "tick",
          disabled: !canSubmit,
          onClick: () => void handleSubmit(),
        },
      ]}
    >
      {/* Sequence pill */}
      <div className="cpm-sequence-row">
        <span className="cpm-sequence-badge">
          <Icon icon="layers" size={10} />
          Phase {nextSequenceNumber}
        </span>
        <span className="cpm-sequence-hint">
          Will be added as the next phase in sequence
        </span>
      </div>

      {/* Phase Name */}
      <MilFormGroup label="Phase Name">
        <MilTextInput
          value={form.phaseName}
          onChange={(v) => update("phaseName", v)}
          placeholder={defaultName}
          autoFocus
        />
      </MilFormGroup>

      {/* Dates + Status */}
      <MilFormRow>
        <MilFormGroup label="Start Date" compact>
          <MilDateInput
            value={form.startDate}
            onChange={(v) => update("startDate", v)}
          />
        </MilFormGroup>
        <MilFormGroup label="End Date" compact>
          <MilDateInput
            value={form.endDate}
            onChange={(v) => update("endDate", v)}
          />
        </MilFormGroup>
        <MilFormGroup label="Status" compact>
          <MilSelect
            value={form.phaseStatus}
            options={STATUS_OPTIONS}
            onChange={(v) => update("phaseStatus", v as PhaseStatus)}
          />
        </MilFormGroup>
      </MilFormRow>

      {/* Description */}
      <MilFormGroup label="Description">
        <MilTextArea
          value={form.phaseDescription}
          onChange={(v) => update("phaseDescription", v)}
          placeholder="Describe the activities and context for this phase…"
          rows={3}
        />
      </MilFormGroup>

      {/* Objective Statement */}
      <MilFormGroup label="Objective Statement">
        <MilTextArea
          value={form.objectiveStatement}
          onChange={(v) => update("objectiveStatement", v)}
          placeholder="High-level objective for this phase…"
          rows={3}
        />
      </MilFormGroup>

      {error && (
        <div className="cpm-error">
          <Icon icon="warning-sign" size={12} />
          {error}
        </div>
      )}
    </MilModal>
  );
};
