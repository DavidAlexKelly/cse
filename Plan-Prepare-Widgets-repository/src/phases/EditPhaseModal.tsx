/* eslint-disable jsx-a11y/no-autofocus */
// ============================================================
// EditPhaseModal — modifies an existing [NXG-P] Phase.
// Dates stored as ISO strings in startOffset / endOffset.
// ============================================================

import { Icon } from "@blueprintjs/core";
import type { Osdk } from "@osdk/client";
import React, { useCallback, useState } from "react";
import { modifyNxgPPhase, NxgPhase } from "@custom-widget/sdk";
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
  startDate: string; // ISO "YYYY-MM-DD"
  endDate: string; // ISO "YYYY-MM-DD"
  phaseStatus: PhaseStatus;
}

export interface EditPhaseModalProps {
  phaseObject: Osdk.Instance<NxgPhase>;
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

function coerceStatus(raw: string | undefined | null): PhaseStatus {
  const map: Record<string, PhaseStatus> = {
    draft: "draft",
    planning: "planning",
    "needs-review": "needs-review",
    needs_review: "needs-review",
    validated: "validated",
    approved: "approved",
    active: "active",
  };
  return map[raw?.toLowerCase() ?? ""] ?? "draft";
}

// ── Component ──────────────────────────────────────────────────────────────

export const EditPhaseModal: React.FC<EditPhaseModalProps> = ({
  phaseObject,
  onSuccess,
  onClose,
}) => {
  const [form, setForm] = useState<FormValues>({
    phaseName: phaseObject.phaseName ?? "",
    phaseDescription: phaseObject.phaseDescription ?? "",
    objectiveStatement: phaseObject.objectiveStatement ?? "",
    startDate: phaseObject.startOffset ?? "", // already ISO or empty
    endDate: phaseObject.endOffset ?? "",
    phaseStatus: coerceStatus(phaseObject.phaseStatus),
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
      await client(modifyNxgPPhase).applyAction({
        nxgPhase: phaseObject,
        phaseName: form.phaseName.trim(),
        phaseDescription: form.phaseDescription.trim() || undefined,
        objectiveStatement: form.objectiveStatement.trim() || undefined,
        startOffset: form.startDate || undefined,
        endOffset: form.endDate || undefined,
        phaseStatus: form.phaseStatus,
        sequenceNumber: phaseObject.sequenceNumber ?? undefined,
        scenarioId: phaseObject.scenarioId ?? undefined,
      });

      onSuccess();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to update phase. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }, [form, phaseObject, onSuccess]);

  const canSubmit = form.phaseName.trim().length > 0 && !submitting;

  return (
    <MilModal
      title={`Edit Phase — ${phaseObject.phaseName ?? phaseObject.phaseId}`}
      titleIcon="edit"
      size="md"
      onClose={onClose}
      actions={[
        { label: "Cancel", variant: "ghost", onClick: onClose },
        {
          label: submitting ? "Saving…" : "Save Changes",
          variant: "primary",
          icon: submitting ? undefined : "tick",
          disabled: !canSubmit,
          onClick: () => void handleSubmit(),
        },
      ]}
    >
      {/* Identity pill */}
      <div className="cpm-sequence-row">
        <span className="cpm-sequence-badge">
          <Icon icon="layers" size={10} />
          Phase {phaseObject.sequenceNumber ?? "—"}
        </span>
        <span className="cpm-sequence-hint">ID: {phaseObject.phaseId}</span>
      </div>

      {/* Phase Name */}
      <MilFormGroup label="Phase Name">
        <MilTextInput
          value={form.phaseName}
          onChange={(v) => update("phaseName", v)}
          placeholder="Phase name"
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
