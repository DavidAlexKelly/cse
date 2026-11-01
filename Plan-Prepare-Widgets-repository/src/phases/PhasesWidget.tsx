/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { Icon } from "@blueprintjs/core";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import { deleteNxgPPhase, NxgPhase } from "@custom-widget/sdk";
import { client } from "../client.js";
import { useScenarioIdFromObjectSet } from "../shared/hooks/useScenarioIdFromParam.js";
import { ScenarioGate } from "../shared/components/ScenarioGate.js";
import { useRichPhases } from "./useRichPhases.js";
import { CreatePhaseModal } from "./CreatePhaseModal.js";
import { EditPhaseModal } from "./EditPhaseModal.js";
import type { RichPhaseRecord } from "../shared/data/mockPhases.js";
import "../shared/styling/index.css";
import "./phasesWidget.css";
import type PhasesWidgetConfig from "./phasesWidget.config.js";

const useWidgetContext =
  useFoundryWidgetContext.withTypes<typeof PhasesWidgetConfig>();

/** Only this scenario allows create / edit / delete */
const WRITABLE_SCENARIO_ID = "scenario_iron_forge_26";

// ── Helpers ────────────────────────────────────────────────────────────────

function statusLabel(status: string): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "validated":
      return "Validated";
    case "needs-review":
      return "Needs review";
    case "draft":
      return "Draft";
    case "active":
      return "Active";
    case "planning":
      return "Planning";
    default:
      return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "approved":
      return "ph-badge--green";
    case "validated":
      return "ph-badge--blue";
    case "needs-review":
      return "ph-badge--amber";
    case "draft":
      return "ph-badge--grey";
    case "active":
      return "ph-badge--green";
    default:
      return "ph-badge--grey";
  }
}

function statusDotClass(status: string): string {
  switch (status) {
    case "approved":
      return "ph-dot--green";
    case "validated":
      return "ph-dot--blue";
    case "needs-review":
      return "ph-dot--amber";
    case "draft":
      return "ph-dot--grey";
    case "active":
      return "ph-dot--green";
    default:
      return "ph-dot--grey";
  }
}

// ── Phase Card ─────────────────────────────────────────────────────────────

interface PhaseCardProps {
  phase: RichPhaseRecord;
  isSelected: boolean;
  canWrite: boolean;
  onClick: (phase: RichPhaseRecord) => void;
  onEdit: (phase: RichPhaseRecord) => void;
  onDelete: (phase: RichPhaseRecord) => void;
}

const PhaseCard: React.FC<PhaseCardProps> = ({
  phase,
  isSelected,
  canWrite,
  onClick,
  onEdit,
  onDelete,
}) => {
  const hasGaps = phase.gaps.length > 0;
  const criticalGaps = phase.gaps.filter((g) => g.severity === "critical");
  const primaryGap = phase.gaps[0];

  return (
    <div
      className={`ph-card${isSelected ? " ph-card--selected" : ""}`}
      onClick={() => onClick(phase)}
    >
      {/* ── Card header ── */}
      <div className="ph-card__header">
        <div className="ph-card__title-row">
          <span className="ph-card__phase-tag">{phase.phaseName}</span>
          <span className="ph-card__title">{phase.phaseTitle}</span>
        </div>
        <div className="ph-card__header-right">
          <span className={`ph-badge ${statusClass(phase.phaseStatus)}`}>
            <span className={`ph-dot ${statusDotClass(phase.phaseStatus)}`} />
            {statusLabel(phase.phaseStatus)}
          </span>
          {canWrite && (
            <div className="ph-card__actions">
              <button
                type="button"
                className="ph-card__action-btn ph-card__action-btn--edit"
                title="Edit phase"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(phase);
                }}
              >
                <Icon icon="edit" size={11} />
              </button>
              <button
                type="button"
                className="ph-card__action-btn ph-card__action-btn--delete"
                title="Delete phase"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(phase);
                }}
              >
                <Icon icon="trash" size={11} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Date + inject summary ── */}
      <div className="ph-card__meta">
        <span className="ph-card__meta-item">
          <Icon icon="calendar" size={10} />
          {phase.startDate} – {phase.endDate}
        </span>
        <span className="ph-card__meta-dot" />
        <span className="ph-card__meta-item">
          <Icon icon="time" size={10} />
          {phase.durationDays} {phase.durationDays === 1 ? "day" : "days"}
        </span>
        {(phase.melCount > 0 || phase.milCount > 0) && (
          <>
            <span className="ph-card__meta-dot" />
            <span className="ph-card__meta-item">
              <Icon icon="list" size={10} />
              {phase.melCount} MEL
            </span>
            <span className="ph-card__meta-item">
              <Icon icon="people" size={10} />
              {phase.milCount} MIL
            </span>
            {phase.injectReviewCount > 0 && (
              <span className="ph-card__meta-item ph-card__meta-item--amber">
                · {phase.injectReviewCount} to review
              </span>
            )}
          </>
        )}
      </div>

      {/* ── Description ── */}
      <p className="ph-card__desc">{phase.phaseDescription}</p>

      {/* ── Stats grid ── */}
      <div className="ph-card__stats">
        <div className="ph-card__stat">
          <Icon icon="person" size={11} />
          <span className="ph-card__stat-label">Active actors</span>
          <span className="ph-card__stat-value">{phase.activeActors}</span>
        </div>
        <div className="ph-card__stat">
          <Icon icon="diagram-tree" size={11} />
          <span className="ph-card__stat-label">ORBAT entities</span>
          <span className="ph-card__stat-value">{phase.orbatEntities}</span>
        </div>
        <div className="ph-card__stat">
          <Icon icon="tick-circle" size={11} />
          <span className="ph-card__stat-label">Open tasks</span>
          <span className="ph-card__stat-value">{phase.openTasks}</span>
        </div>
        <div className="ph-card__stat">
          <Icon icon="warning-sign" size={11} />
          <span className="ph-card__stat-label">Unassigned MIL</span>
          <span
            className={`ph-card__stat-value${
              phase.unassignedMil > 0 ? " ph-card__stat-value--amber" : ""
            }`}
          >
            {phase.unassignedMil}
          </span>
        </div>
      </div>

      {/* ── Gap footer ── */}
      <div className="ph-card__footer">
        {hasGaps ? (
          <span
            className={`ph-card__gap${
              criticalGaps.length > 0 ? " ph-card__gap--critical" : ""
            }`}
          >
            <Icon icon="warning-sign" size={10} />
            {phase.gaps.length === 1
              ? primaryGap?.description
              : `${phase.gaps.length} open gaps`}
          </span>
        ) : (
          <span className="ph-card__no-gap">
            <Icon icon="tick-circle" size={10} />
            No open gaps
          </span>
        )}
      </div>
    </div>
  );
};

// ── Delete Confirmation Modal ──────────────────────────────────────────────

interface DeleteConfirmProps {
  phase: RichPhaseRecord;
  deleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirmModal: React.FC<DeleteConfirmProps> = ({
  phase,
  deleting,
  error,
  onConfirm,
  onCancel,
}) => (
  <div className="ph-overlay" onClick={onCancel}>
    <div className="ph-confirm-modal" onClick={(e) => e.stopPropagation()}>
      <div className="ph-confirm-modal__header">
        <Icon
          icon="warning-sign"
          size={16}
          className="ph-confirm-modal__icon"
        />
        <span className="ph-confirm-modal__title">Delete Phase</span>
      </div>
      <p className="ph-confirm-modal__body">
        Are you sure you want to delete{" "}
        <strong>{phase.phaseTitle || phase.phaseName}</strong>? This action
        cannot be undone.
      </p>
      {error && (
        <div className="cpm-error">
          <Icon icon="warning-sign" size={12} />
          {error}
        </div>
      )}
      <div className="ph-confirm-modal__actions">
        <button
          type="button"
          className="ph-confirm-modal__btn ph-confirm-modal__btn--cancel"
          onClick={onCancel}
          disabled={deleting}
        >
          Cancel
        </button>
        <button
          type="button"
          className="ph-confirm-modal__btn ph-confirm-modal__btn--delete"
          onClick={onConfirm}
          disabled={deleting}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  </div>
);

// ── Detail Panel ───────────────────────────────────────────────────────────

interface DetailPanelProps {
  phase: RichPhaseRecord;
  onClose: () => void;
}

const DetailPanel: React.FC<DetailPanelProps> = ({ phase, onClose }) => {
  return (
    <div className="ph-panel">
      {/* Header */}
      <div className="ph-panel__header">
        <div className="ph-panel__header-top">
          <div className="ph-panel__title-row">
            <span className="ph-card__phase-tag">{phase.phaseName}</span>
            <span className="ph-panel__title">{phase.phaseTitle}</span>
          </div>
          <button
            type="button"
            className="ph-panel__close"
            onClick={onClose}
            aria-label="Close panel"
          >
            <Icon icon="cross" size={14} />
          </button>
        </div>
        <span className={`ph-badge ${statusClass(phase.phaseStatus)}`}>
          <span className={`ph-dot ${statusDotClass(phase.phaseStatus)}`} />
          {statusLabel(phase.phaseStatus)}
        </span>
      </div>

      <div className="ph-panel__body">
        {/* Dates */}
        <div className="ph-panel__section">
          <div className="ph-panel__section-title">Timeline</div>
          <div className="ph-panel__row">
            <span className="ph-panel__row-label">Start</span>
            <span className="ph-panel__row-value">{phase.startDate}</span>
          </div>
          <div className="ph-panel__row">
            <span className="ph-panel__row-label">End</span>
            <span className="ph-panel__row-value">{phase.endDate}</span>
          </div>
          <div className="ph-panel__row">
            <span className="ph-panel__row-label">Duration</span>
            <span className="ph-panel__row-value">
              {phase.durationDays} {phase.durationDays === 1 ? "day" : "days"}
            </span>
          </div>
        </div>

        {/* Objective */}
        <div className="ph-panel__section">
          <div className="ph-panel__section-title">Phase objective</div>
          <p className="ph-panel__objective">{phase.objectiveStatement}</p>
        </div>

        {/* Readiness */}
        <div className="ph-panel__section">
          <div className="ph-panel__section-title">Planning readiness</div>
          <div className="ph-panel__readiness-row">
            <div className="ph-panel__readiness-track">
              <div
                className="ph-panel__readiness-fill"
                style={{
                  width: `${phase.readinessPct}%`,
                  background:
                    phase.readinessPct >= 80
                      ? "#24b47e"
                      : phase.readinessPct >= 60
                      ? "#4c7ef3"
                      : phase.readinessPct >= 40
                      ? "#f0a83c"
                      : "#ef4d4d",
                }}
              />
            </div>
            <span className="ph-panel__readiness-pct">
              {phase.readinessPct}%
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="ph-panel__section">
          <div className="ph-panel__section-title">Phase statistics</div>
          <div className="ph-panel__stats-grid">
            {[
              {
                label: "Active actors",
                value: phase.activeActors,
                icon: "person" as const,
              },
              {
                label: "ORBAT entities",
                value: phase.orbatEntities,
                icon: "diagram-tree" as const,
              },
              {
                label: "Open tasks",
                value: phase.openTasks,
                icon: "tick-circle" as const,
              },
              {
                label: "Unassigned MIL",
                value: phase.unassignedMil,
                icon: "warning-sign" as const,
              },
              {
                label: "MEL events",
                value: phase.melCount,
                icon: "list" as const,
              },
              {
                label: "MIL tasks",
                value: phase.milCount,
                icon: "people" as const,
              },
            ].map(({ label, value, icon }) => (
              <div key={label} className="ph-panel__stat-cell">
                <Icon icon={icon} size={12} className="ph-panel__stat-icon" />
                <span className="ph-panel__stat-value">{value}</span>
                <span className="ph-panel__stat-label">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Injects pending review */}
        {phase.injectReviewCount > 0 && (
          <div className="ph-panel__section">
            <div className="ph-panel__section-title">Injects to review</div>
            <div className="ph-panel__review-pill">
              <Icon icon="edit" size={11} />
              {phase.injectReviewCount} inject
              {phase.injectReviewCount > 1 ? "s" : ""} pending review
            </div>
          </div>
        )}

        {/* Gaps */}
        {phase.gaps.length > 0 && (
          <div className="ph-panel__section">
            <div className="ph-panel__section-title">
              Open gaps
              <span className="ph-panel__gap-count">{phase.gaps.length}</span>
            </div>
            <div className="ph-panel__gaps">
              {phase.gaps.map((gap) => (
                <div
                  key={gap.gapId}
                  className={`ph-panel__gap-item${
                    gap.severity === "critical"
                      ? " ph-panel__gap-item--critical"
                      : ""
                  }`}
                >
                  <Icon
                    icon={
                      gap.severity === "critical" ? "error" : "warning-sign"
                    }
                    size={11}
                    className="ph-panel__gap-icon"
                  />
                  <span>{gap.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main Widget ────────────────────────────────────────────────────────────

const PhasesWidgetBody: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {
  const { emitEvent } = useWidgetContext();
  // This widget writes through the phase actions directly rather than a
  // shared mutation hook, so it notifies Workshop at each success site.
  const notifyDataChanged = useCallback(
    () => emitEvent("onDataChanged", { parameterUpdates: {} }),
    [emitEvent],
  );

  // Loads ontology phases and merges with mock stats/gaps
  const { phases, phaseObjects, loading, source, refresh } =
    useRichPhases(scenarioId);

  // Seed phases have no matching ontology objects, so create/edit/delete
  // would fail against them.
  const persists = source === "ontology";

  // Always show edit/delete — the actions always write to WRITABLE_SCENARIO_ID
  const canWrite = true;
  const [selectedPhase, setSelectedPhase] = useState<RichPhaseRecord | null>(
    null
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPhase, setEditingPhase] = useState<RichPhaseRecord | null>(
    null
  );
  const [deletingPhase, setDeletingPhase] = useState<RichPhaseRecord | null>(
    null
  );
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleCardClick = useCallback(
    (phase: RichPhaseRecord) => {
      // Derived from current state rather than inside the setState updater,
      // so the emit is not tied to an updater that React may run twice.
      const deselecting = selectedPhase?.phaseId === phase.phaseId;
      setSelectedPhase(deselecting ? null : phase);
      // Tell Workshop which phase is selected so other widgets can follow
      // it — MIL/MEL, Task Graph and Training Objectives all take a
      // Selected Phase object set, so emit one directly.
      //
      // Deselecting emits a set filtered on an empty primary key, which
      // matches nothing: the parameter type has no null, so an empty object
      // set is how "no selection" is expressed.
      emitEvent("onPhaseSelected", {
        parameterUpdates: {
          selectedPhase: client(NxgPhase).where({
            phaseId: { $eq: deselecting ? "" : phase.phaseId },
          }),
        },
      });
    },
    [emitEvent, selectedPhase]
  );

  const handleClose = useCallback(() => setSelectedPhase(null), []);

  const handleEdit = useCallback((phase: RichPhaseRecord) => {
    setEditingPhase(phase);
  }, []);

  const handleDeleteRequest = useCallback((phase: RichPhaseRecord) => {
    setDeleteError(null);
    setDeletingPhase(phase);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingPhase) return;
    const obj = phaseObjects.get(deletingPhase.phaseId);
    if (!obj) {
      setDeleteError("Phase object not found — try refreshing.");
      return;
    }
    setDeleteInProgress(true);
    setDeleteError(null);
    try {
      await client(deleteNxgPPhase).applyAction({ nxgPhase: obj });
      setDeletingPhase(null);
      // close detail panel if it was showing the deleted phase
      setSelectedPhase((prev) =>
        prev?.phaseId === deletingPhase.phaseId ? null : prev
      );
      refresh();
      notifyDataChanged();
    } catch (e) {
      setDeleteError(
        e instanceof Error
          ? e.message
          : "Failed to delete phase. Please try again."
      );
    } finally {
      setDeleteInProgress(false);
    }
  }, [deletingPhase, phaseObjects, refresh, notifyDataChanged]);

  // Close panel on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedPhase(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="phw-root bp5-dark">
      {!persists && !loading && (
        <div className="mil-banner mil-banner--warning">
          <Icon icon="database" size={12} />
          <span>
            Showing seed data — this scenario has no phases in the ontology, so
            edits are not saved.
          </span>
        </div>
      )}

      {/* ── Page header ── */}
      <div className="phw-header">
        <div className="phw-header__left">
          <h1 className="phw-header__title">Phases</h1>
          <p className="phw-header__subtitle">
            {phases.length === 4
              ? "Four phases drive the exercise from initiation through rehearsal. Each phase carries its own dates, events, incidents and open tasks."
              : `${phases.length} phases drive the exercise from pre-crisis setup to after-action analysis. Each phase carries its own dates, events, incidents and open tasks.`}
          </p>
        </div>
        <div className="phw-header__right">
          <button
            type="button"
            className="phw-add-phase-btn"
            onClick={() => setShowCreateModal(true)}
            title="Create a new phase"
          >
            <Icon icon="plus" size={12} />
            New Phase
          </button>
          <div className="phw-header__divider" />
          <div className="phw-header__stat">
            <span className="phw-header__stat-value">
              {loading ? "—" : phases.length}
            </span>
            <span className="phw-header__stat-label">Total phases</span>
          </div>
          <div className="phw-header__stat">
            <span
              className="phw-header__stat-value"
              style={{ color: "#24b47e" }}
            >
              {
                phases.filter(
                  (p) =>
                    p.phaseStatus === "approved" ||
                    p.phaseStatus === "validated"
                ).length
              }
            </span>
            <span className="phw-header__stat-label">Approved / validated</span>
          </div>
          <div className="phw-header__stat">
            <span
              className="phw-header__stat-value"
              style={{ color: "#f0a83c" }}
            >
              {phases.filter((p) => p.phaseStatus === "needs-review").length}
            </span>
            <span className="phw-header__stat-label">Needs review</span>
          </div>
          <div className="phw-header__stat">
            <span
              className="phw-header__stat-value"
              style={{ color: "#6a7292" }}
            >
              {phases.filter((p) => p.phaseStatus === "draft").length}
            </span>
            <span className="phw-header__stat-label">Draft</span>
          </div>
        </div>
      </div>

      {/* ── Body: card grid always full-width + overlay panel ── */}
      <div className="phw-body">
        {/* Card grid — always full width, never shrinks */}
        <div className="phw-grid" ref={panelRef}>
          {phases.map((phase) => (
            <PhaseCard
              key={phase.phaseId}
              phase={phase}
              isSelected={selectedPhase?.phaseId === phase.phaseId}
              canWrite={canWrite}
              onClick={handleCardClick}
              onEdit={handleEdit}
              onDelete={handleDeleteRequest}
            />
          ))}
        </div>

        {/* Detail panel as a fixed overlay on the right — does NOT shrink grid */}
        {selectedPhase && (
          <div className="phw-panel-overlay">
            <DetailPanel phase={selectedPhase} onClose={handleClose} />
          </div>
        )}
      </div>

      {/* ── Create Phase modal ── */}
      {showCreateModal && (
        <CreatePhaseModal
          scenarioId={WRITABLE_SCENARIO_ID}
          nextSequenceNumber={phases.length + 1}
          onSuccess={() => {
            setShowCreateModal(false);
            refresh();
            notifyDataChanged();
          }}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* ── Edit Phase modal ── */}
      {editingPhase &&
        (() => {
          const obj = phaseObjects.get(editingPhase.phaseId);
          return obj ? (
            <EditPhaseModal
              phaseObject={obj}
              onSuccess={() => {
                setEditingPhase(null);
                refresh();
                notifyDataChanged();
              }}
              onClose={() => setEditingPhase(null)}
            />
          ) : null;
        })()}

      {/* ── Delete Confirmation ── */}
      {deletingPhase && (
        <DeleteConfirmModal
          phase={deletingPhase}
          deleting={deleteInProgress}
          error={deleteError}
          onConfirm={() => void handleDeleteConfirm()}
          onCancel={() => {
            setDeletingPhase(null);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
};

// ── Widget entry point ─────────────────────────────────────────────────────
// Resolves the bound scenario before mounting the body, so the body always
// has a real scenario to work with and never silently falls back to a
// default exercise.

export const PhasesWidget: React.FC = () => {
  const { parameters } = useWidgetContext();
  const binding = useScenarioIdFromObjectSet(
    parameters.values.scenario?.objectSet
  );
  return (
    <ScenarioGate binding={binding}>
      {(scenarioId) => <PhasesWidgetBody scenarioId={scenarioId} />}
    </ScenarioGate>
  );
};
