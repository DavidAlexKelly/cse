// ── PMESII Analysis — Root Layout ─────────────────────────────────────────

import { Icon } from "@blueprintjs/core";
import React, { useCallback, useState } from "react";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import { MilLabel } from "../shared/components/Label.js";
import { MilButton } from "../shared/components/Button.js";
import { PmesiiCard } from "./PmesiiCard.js";
import { PmesiiEditModal } from "./PmesiiEditModal.js";
import { CommentsPanel } from "./CommentsPanel.js";
import { MOCK_COMMENTS } from "./mockData.js";
import type { PmesiiVariable, PmesiiComment } from "./types.js";
import { useNxgPmesiiDomains } from "../shared/hooks/useNxgPmesiiDomains.js";
import { useNxgPmesiiMutations } from "../shared/hooks/useNxgPmesiiMutations.js";
import { pmesiiStatusToOntology } from "../shared/pmesii/pmesiiStatus.js";
import { useScenarioIdFromObjectSet } from "../shared/hooks/useScenarioIdFromParam.js";
import { ScenarioGate } from "../shared/components/ScenarioGate.js";
import type PmesiiAnalysisConfig from "./pmesiiAnalysis.config.js";
import "../shared/styling/index.css";
import "./pmesiiAnalysis.css";

const useWidgetContext = useFoundryWidgetContext.withTypes<typeof PmesiiAnalysisConfig>();

// ── Static source task (wt-5 from task-assignment) ─────────────────────────

const SOURCE_TASK = {
  id:          "wt-5",
  section:     "Scenario & Environment",
  title:       "PMESII variables",
  description: "Define all PMESII-PT variables",
  author:      "Maj Westergaard",   // the person doing the work
  due:         "0-90",
  status:      "in-review" as const,
};

// ── Reviewer list (task author excluded — can't review own work) ───────────

const REVIEWERS = [
  "BGen Hartmann",
  "Col Anderssen",
  "LtCol Kowalski",
  "Maj Roos",
];

// ── Completion fraction per card (0–1) ─────────────────────────────────────

const COMPLETION_WEIGHT: Record<PmesiiVariable["status"], number> = {
  approved:    1.0,
  "in-review": 0.6,
  critical:    0.3,
  pending:     0.0,
};

// ── Component ──────────────────────────────────────────────────────────────

const PmesiiAnalysisBody: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {

  const {
    variables: liveVariables,
    loading,
    source,
    refresh,
  } = useNxgPmesiiDomains(scenarioId);
  const { emitEvent } = useWidgetContext();
  // Routed through the mutation hook's onSuccess so every write notifies
  // Workshop, rather than each call site having to remember to.
  const notifyDataChanged = useCallback(
    () => emitEvent("onDataChanged", { parameterUpdates: {} }),
    [emitEvent],
  );
  const {
    updateDomain,
    error: writeError,
    clearError: clearWriteError,
  } = useNxgPmesiiMutations({ onSuccess: notifyDataChanged });

  // Seed records have no matching ontology objects, so edits to them
  // stay in memory rather than producing "object not found" errors.
  const persists = source === "ontology";

  // Local state is seeded from the hook result (live or fallback mock)
  const [variables, setVariables] = useState<PmesiiVariable[]>(liveVariables);
  const [comments,  setComments]  = useState<PmesiiComment[]>(MOCK_COMMENTS);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Keep local state in sync when the hook resolves
  React.useEffect(() => {
    if (!loading) {
      setVariables(liveVariables);
    }
  }, [liveVariables, loading]);

  // ── Handlers ──────────────────────────────────────────────────────────
  // Update locally first so the card responds immediately, then persist.
  // On failure re-read so the card reverts to the stored value instead
  // of showing an edit that was never saved.

  const handleEdit = (id: string) => setEditingId(id);

  const persistVariable = (updated: PmesiiVariable) => {
    if (!persists) return;
    void updateDomain(updated.id, {
      value: updated.summary,
      status: pmesiiStatusToOntology(updated.status),
      reviewerPersonId: updated.reviewer,
    }).catch(() => refresh());
  };

  const handleApprove = (id: string) => {
    const approved = variables.find(v => v.id === id);
    setVariables(prev =>
      prev.map(v => v.id === id ? { ...v, status: "approved" } : v)
    );
    if (approved) persistVariable({ ...approved, status: "approved" });
  };

  const handleSave = (updated: PmesiiVariable) => {
    setVariables(prev => prev.map(v => (v.id === updated.id ? updated : v)));
    setEditingId(null);
    persistVariable(updated);
  };

  const handleAddComment = (text: string) => {
    const newComment: PmesiiComment = {
      id:        `c-${Date.now()}`,
      author:    SOURCE_TASK.author,
      rank:      "Maj",
      text,
      timestamp: "Just now",
    };
    setComments(prev => [...prev, newComment]);
  };

  // ── Derived state ──────────────────────────────────────────────────────

  const approvedCount  = variables.filter(v => v.status === "approved").length;
  const reviewCount    = variables.filter(v => v.status === "in-review").length;
  const pendingCount   = variables.filter(v => v.status === "pending").length;
  const criticalCount  = variables.filter(v => v.status === "critical").length;
  const allApproved    = approvedCount === variables.length && variables.length > 0;
  const canSubmit      = criticalCount === 0 && pendingCount === 0 && approvedCount > 0;

  const editingVariable = editingId
    ? variables.find(v => v.id === editingId) ?? null
    : null;

  return (
    <div className="mil-widget bp5-dark">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="mil-header">
        <div className="mil-header__title">
          <Icon icon="globe-network" size={14} />
          PMESII-PT Analysis
          <span className="mil-header__subtitle">Define &amp; Review Scenario Variables</span>
        </div>
      </div>

      {/* ── Write failure banner ─────────────────────────────────────────── */}
      {writeError && (
        <div className="mil-banner mil-banner--error" role="alert">
          <Icon icon="warning-sign" size={12} />
          <span>{writeError}</span>
          <button
            className="mil-banner__dismiss"
            onClick={clearWriteError}
            aria-label="Dismiss"
          >
            <Icon icon="cross" size={12} />
          </button>
        </div>
      )}

      {/* ── Seed data notice ─────────────────────────────────────────────── */}
      {!persists && !loading && (
        <div className="mil-banner mil-banner--warning">
          <Icon icon="database" size={12} />
          <span>
            Showing seed data — this scenario has no PMESII-PT domains in the
            ontology, so edits are not saved.
          </span>
        </div>
      )}

      {/* ── Task context banner ──────────────────────────────────────────── */}
      <div className={`pa-task-banner${allApproved ? " pa-task-banner--approved" : ""}`}>
        <div className="pa-task-banner__left">
          <Icon
            icon={allApproved ? "tick-circle" : "time"}
            size={13}
            className="pa-task-banner__icon"
          />
          <div className="pa-task-banner__text">
            <span className="pa-task-banner__label">Your task:</span>
            <span className="pa-task-banner__title">{SOURCE_TASK.title}</span>
            <span className="pa-task-banner__meta">
              <Icon icon="person" size={11} />
              {SOURCE_TASK.author}
              <span className="pa-task-banner__sep">·</span>
              <Icon icon="layers" size={11} />
              {SOURCE_TASK.section}
              <span className="pa-task-banner__sep">·</span>
              <Icon icon="time" size={11} />
              D{SOURCE_TASK.due}
              <span className="pa-task-banner__sep">·</span>
              <span className="pa-task-banner__progress">
                {approvedCount}/{variables.length} domains approved
              </span>
            </span>
          </div>
        </div>
        <div className="pa-task-banner__right">
          {allApproved
            ? <MilLabel variant="badge" intent="green">All Approved</MilLabel>
            : <MilLabel variant="badge" intent="amber">In Review</MilLabel>
          }
          <MilButton
            icon="tick"
            variant="primary"
            size="sm"
            disabled={!canSubmit}
          >
            Submit for Approval
          </MilButton>
        </div>
      </div>

      {/* ── Loading indicator ─────────────────────────────────────────────── */}
      {loading && (
        <div style={{ padding: "12px 16px", color: "#98a1c0", fontSize: 12 }}>
          Loading domains from Foundry…
        </div>
      )}

      {/* ── Domain grid ─────────────────────────────────────────────────── */}
      <div className="pa-grid">
        {variables.map(v => (
          <PmesiiCard
            key={v.id}
            variable={v}
            completionFraction={COMPLETION_WEIGHT[v.status]}
            onEdit={handleEdit}
            onApprove={handleApprove}
          />
        ))}
      </div>

      {/* ── Comments ────────────────────────────────────────────────────── */}
      <CommentsPanel comments={comments} onAdd={handleAddComment} />

      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div className="mil-statusbar">
        <MilLabel variant="status-dot" intent="green">
          {approvedCount} Approved
        </MilLabel>
        <MilLabel variant="status-dot" intent="amber">
          {reviewCount} In Review
        </MilLabel>
        <MilLabel variant="status-dot" intent="grey">
          {pendingCount} Pending
        </MilLabel>
        {criticalCount > 0 && (
          <MilLabel variant="status-dot" intent="red">
            {criticalCount} Critical
          </MilLabel>
        )}
        <span style={{ marginLeft: "auto", color: "#454c68" }}>
          {variables.length} domains total
        </span>
      </div>

      {/* ── Edit / Add Modal ────────────────────────────────────────────── */}
      {editingVariable && (
        <PmesiiEditModal
          variable={editingVariable}
          reviewers={REVIEWERS}
          onSave={handleSave}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
};

// ── Widget entry point ─────────────────────────────────────────────────────
// Resolves the bound scenario before mounting the body, so the body always
// has a real scenario to work with and never silently falls back to a
// default exercise.

export const PmesiiAnalysis: React.FC = () => {
  const { parameters } = useWidgetContext();
  const binding = useScenarioIdFromObjectSet(
    parameters.values.scenario?.objectSet
  );
  return (
    <ScenarioGate binding={binding}>
      {(scenarioId) => <PmesiiAnalysisBody scenarioId={scenarioId} />}
    </ScenarioGate>
  );
};
