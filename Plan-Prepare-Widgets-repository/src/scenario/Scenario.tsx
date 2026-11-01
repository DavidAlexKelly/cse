import { Icon } from "@blueprintjs/core";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import { MilButton } from "../shared/components/Button.js";
import { CommentsThread } from "../shared/components/CommentsThread.js";
import { PersonSelect } from "../shared/components/PersonSelect.js";
import {
  STATUS_CLASS,
  STATUS_LABEL,
} from "../shared/task/taskTypes.js";
import type { ApprovalState } from "../shared/task/taskTypes.js";
import "../shared/styling/index.css";
import "../shared/styling/task-page.css";
import { OpforCard } from "./components/OpforCard.js";
import { StrategicContextCard } from "./components/StrategicContextCard.js";
import {
  CURRENT_USER_ID,
  INITIAL_SCENARIO,
  personById,
} from "./scenarioData.js";
import type {
  OpforDefinition,
  ScenarioState,
} from "./scenarioData.js";
import { useNxgScenario } from "../shared/hooks/useNxgScenario.js";
import { useNxgOpforDefinitions } from "../shared/hooks/useNxgOpforDefinitions.js";
import { useNxgScenarioMutations } from "../shared/hooks/useNxgScenarioMutations.js";
import { useNxgPhases } from "../shared/hooks/useNxgPhases.js";
import { useNxgTrainingObjectives } from "../shared/hooks/useNxgTrainingObjectives.js";
import { useScenarioIdFromObjectSet } from "../shared/hooks/useScenarioIdFromParam.js";
import { ScenarioGate } from "../shared/components/ScenarioGate.js";
import type ScenarioConfig from "./scenario.config.js";

const useWidgetContext = useFoundryWidgetContext.withTypes<typeof ScenarioConfig>();

// ── Helpers ────────────────────────────────────────────────────────────────

function nextOpforId(existing: OpforDefinition[]): string {
  let n = existing.length + 1;
  while (existing.some((o) => o.id === `opfor_new_${n}`)) n++;
  return `opfor_new_${n}`;
}

function nextCommentId(): string {
  return `c_${Date.now()}`;
}

function statusBadgeClass(status: string): string {
  switch (status?.toLowerCase()) {
    case "active":
    case "executing":
      return "badge--green";
    case "planning":
      case "in_progress":
      return "badge--amber";
    case "complete":
    case "completed":
      return "badge--blue";
      default:
      return "badge--grey";
  }
}

function classificationBadgeClass(cls: string): string {
  switch (cls?.toUpperCase()) {
    case "CONFIDENTIAL": return "badge--red";
    case "RESTRICTED":   return "badge--amber";
    default:             return "badge--grey";
  }
}

// ── Hero Header ────────────────────────────────────────────────────────────

interface ScenarioHeroProps {
  scenarioName: string;
  scenarioType: string;
  scenarioStatus: string;
  classification: string;
  overallProgressPct: number;
  currentPhase: string;
  phaseCount: number;
  injectCount: number;
  objectiveCount: number;
  loading: boolean;
}

const ScenarioHero: React.FC<ScenarioHeroProps> = ({
  scenarioName,
  scenarioType,
  scenarioStatus,
  classification,
  overallProgressPct,
  currentPhase,
  phaseCount,
  injectCount,
  objectiveCount,
  loading,
}) => (
  <div className="scn-hero">
    <div className="scn-hero__top">
      <div className="scn-hero__left">
        <div className="scn-hero__badges">
          {scenarioType && (
            <span className="badge badge--blue">{scenarioType}</span>
        )}
          {classification && (
            <span className={`badge ${classificationBadgeClass(classification)}`}>
              {classification}
            </span>
          )}
          {scenarioStatus && (
            <span className={`badge ${statusBadgeClass(scenarioStatus)}`}>
              {scenarioStatus}
            </span>
          )}
              </div>
        <div className="scn-hero__name">
          {loading ? "Loading…" : (scenarioName || "Untitled Scenario")}
            </div>
        {currentPhase && (
          <div className="scn-hero__sub">
            <Icon icon="layers" size={10} /> Current phase: <strong style={{ color: "#e6eaf8" }}>{currentPhase}</strong>
          </div>
        )}
            </div>
      <div className="scn-hero__right">
        <div className="scn-hero__progress-wrap">
          <span className="scn-hero__progress-label">Overall progress</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="scn-hero__progress-track">
              <div
                className="scn-hero__progress-fill"
                style={{ width: `${Math.min(100, overallProgressPct)}%` }}
              />
            </div>
            <span className="scn-hero__progress-pct">{overallProgressPct}%</span>
          </div>
            </div>
            </div>
        </div>

    <div className="scn-hero__stats">
      <div className="scn-hero__stat">
        <span className="scn-hero__stat-value">{loading ? "—" : phaseCount}</span>
        <span className="scn-hero__stat-label">Phases</span>
      </div>
      <div className="scn-hero__stat">
        <span className="scn-hero__stat-value">{loading ? "—" : objectiveCount}</span>
        <span className="scn-hero__stat-label">Objectives</span>
    </div>
      <div className="scn-hero__stat">
        <span className="scn-hero__stat-value">{loading ? "—" : injectCount}</span>
        <span className="scn-hero__stat-label">Injects</span>
      </div>
    </div>
  </div>
  );

// ── Component ──────────────────────────────────────────────────────────────

const ScenarioBody: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {

  const {
    scenario: liveScenario,
    loading: scenarioLoading,
    source: scenarioSource,
  } = useNxgScenario(scenarioId);
  const { phases } = useNxgPhases(scenarioId);
  const { objectives } = useNxgTrainingObjectives(scenarioId);
  const {
    opforDefinitions: liveOpfor,
    loading: opforLoading,
    refresh: refreshOpfor,
  } = useNxgOpforDefinitions(scenarioId);
  const { emitEvent } = useWidgetContext();
  // Routed through the mutation hook's onSuccess so every write notifies
  // Workshop, rather than each call site having to remember to.
  const notifyDataChanged = useCallback(
    () => emitEvent("onDataChanged", { parameterUpdates: {} }),
    [emitEvent],
  );
  const {
    updateScenario,
    createOpfor,
    updateOpfor: persistOpfor,
    deleteOpfor: persistDeleteOpfor,
    error: writeError,
    clearError: clearWriteError,
  } = useNxgScenarioMutations({ onSuccess: notifyDataChanged });

  // The seed scenario has no matching ontology object, so edits to it
  // stay in memory rather than producing "object not found" errors.
  const persists = scenarioSource === "ontology";

  // Inject count: we already fetch injects in the existing state — track via localEvents length
  const [injectCount, setInjectCount] = useState(0);

  const [state, setState] = useState<ScenarioState>(INITIAL_SCENARIO);

  // When the live scenario arrives, hydrate the strategic context.
  useEffect(() => {
    if (!scenarioLoading && liveScenario) {
      setState((prev) => ({
        ...prev,
        strategicContext: {
          ...prev.strategicContext,
          title: liveScenario.strategicContextTitle || prev.strategicContext.title,
          body: liveScenario.strategicContextBody || prev.strategicContext.body,
          generated: liveScenario.aiGenerated,
        },
      }));
    }
  }, [liveScenario, scenarioLoading]);

  // OPFOR doctrine cards are a first-class object type now, so the
  // ontology is authoritative once the scenario has any. They used to
  // live only in component state and were lost on refresh.
  useEffect(() => {
    if (!opforLoading && liveOpfor.length > 0) {
      setState((prev) => ({ ...prev, opforDefinitions: liveOpfor }));
    }
  }, [liveOpfor, opforLoading]);

  // Fetch inject count separately (lightweight)
  useEffect(() => {
    if (!scenarioId) return;
    let cancelled = false;
    import("../client.js").then(({ client }) =>
      import("@custom-widget/sdk").then(({ NxgInject }) =>
        client(NxgInject)
          .where({ scenarioId: { $eq: scenarioId } })
          .fetchPage({ $pageSize: 1 })
          .then((page) => {
            if (!cancelled) setInjectCount(page.data.length > 0 ? page.data.length : 0);
          })
          .catch(() => {})
      )
    );
    return () => { cancelled = true; };
  }, [scenarioId]);

  const assignee = personById(state.task.assigneeId);
  const reviewer = personById(state.task.reviewerId);

  // Subtask progress (used only to gate the Submit button)
  const { doneCount, totalCount, pct } = useMemo(() => {
    const total = state.subtasks.length;
    const done = state.subtasks.filter((s) => s.done).length;
    return {
      doneCount: done,
      totalCount: total,
      pct: total === 0 ? 0 : Math.round((done / total) * 100),
    };
  }, [state.subtasks]);

  // ── Mutators ─────────────────────────────────────────────────────────────

  const toggleSubtask = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      subtasks: prev.subtasks.map((s) =>
        s.subtaskId === id ? { ...s, done: !s.done } : s,
      ),
    }));
  }, []);

  const setAssignee = useCallback((id: string) => {
    setState((prev) => ({ ...prev, task: { ...prev.task, assigneeId: id } }));
  }, []);

  const setReviewer = useCallback((id: string) => {
    setState((prev) => ({ ...prev, task: { ...prev.task, reviewerId: id } }));
  }, []);

  const setApprovalState = useCallback(
    (next: ApprovalState, note?: string) => {
      setState((prev) => ({
        ...prev,
        task: {
          ...prev.task,
          approvalState: next,
          approvalNote: note ?? prev.task.approvalNote,
        },
      }));
    },
    [],
  );

  const updateContext = useCallback(
    (next: ScenarioState["strategicContext"]) => {
      setState((prev) => ({ ...prev, strategicContext: next }));
      if (!persists || !liveScenario) return;
      // Only the narrative fields are editable here; everything else is
      // passed through unchanged so the modify action does not blank it.
      void updateScenario(liveScenario.scenarioId, {
        name: liveScenario.scenarioName,
        scenarioType: liveScenario.scenarioType,
        status: liveScenario.scenarioStatus,
        classification: liveScenario.classification,
        currentPhase: liveScenario.currentPhase,
        overallProgressPct: liveScenario.overallProgressPct,
        dDay: liveScenario.dDay,
        strategicContextTitle: next.title,
        strategicContextBody: next.body,
        aiGenerated: next.generated,
      }).catch(() => undefined);
    },
    [persists, liveScenario, updateScenario],
  );

  const updateOpfor = useCallback(
    (next: OpforDefinition) => {
      setState((prev) => ({
        ...prev,
        opforDefinitions: prev.opforDefinitions.map((o) =>
          o.id === next.id ? next : o,
        ),
      }));
      if (!persists) return;
      void persistOpfor(next.id, {
        title: next.title,
        meta: next.meta,
        body: next.body,
        tags: next.tags,
        aiGenerated: next.generated,
      }).catch(() => refreshOpfor());
    },
    [persists, persistOpfor, refreshOpfor],
  );

  const deleteOpfor = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        opforDefinitions: prev.opforDefinitions.filter((o) => o.id !== id),
      }));
      if (!persists) return;
      void persistDeleteOpfor(id)
        .then(() => refreshOpfor())
        .catch(() => refreshOpfor());
    },
    [persists, persistDeleteOpfor, refreshOpfor],
  );

  const addOpfor = useCallback(() => {
    const title = "New OPFOR definition";
    const body =
      "Describe this threat actor's composition, doctrine and likely actions.";

    if (persists) {
      // The ontology mints the primary key, so create then re-read.
      void createOpfor(scenarioId, {
        title,
        meta: "",
        body,
        tags: [],
        aiGenerated: false,
      })
        .then(() => refreshOpfor())
        .catch(() => refreshOpfor());
      return;
    }

    setState((prev) => {
      const id = nextOpforId(prev.opforDefinitions);
      const newOpfor: OpforDefinition = {
        id,
        title,
        generated: false,
        meta: "",
        body,
        tags: [],
      };
      return {
        ...prev,
        opforDefinitions: [...prev.opforDefinitions, newOpfor],
      };
    });
  }, [persists, scenarioId, createOpfor, refreshOpfor]);

  const addComment = useCallback((text: string) => {
    setState((prev) => ({
      ...prev,
      comments: [
        ...prev.comments,
        {
          commentId: nextCommentId(),
          body: text,
          timestamp: new Date().toISOString(),
          __links: { authoredBy: CURRENT_USER_ID },
        },
      ],
    }));
  }, []);

  // ── Banner actions vary by status ────────────────────────────────────────

  const renderBannerActions = () => {
    switch (state.task.approvalState) {
      case "approved":
        return (
          <MilButton
            icon="undo"
            variant="default"
            onClick={() =>
              setApprovalState(
                "submitted",
                "Reopened for review · awaiting reviewer",
              )
            }
          >
            Reopen for review
          </MilButton>
        );
      case "submitted":
        return (
          <>
            <MilButton
              icon="cross"
              variant="ghost"
              onClick={() =>
                setApprovalState(
                  "in_progress",
                  "Returned for changes · with assignee",
                )
              }
            >
              Return
            </MilButton>
            <MilButton
              icon="tick"
              variant="primary"
              onClick={() =>
                setApprovalState(
                  "approved",
                  `Approved by ${reviewer?.name ?? "reviewer"} · just now`,
                )
              }
            >
              Approve
            </MilButton>
          </>
        );
      case "in_progress":
      case "not_started":
      default:
        return (
          <MilButton
            icon="tick"
            variant="primary"
            disabled={doneCount < totalCount}
            title={
              doneCount < totalCount
                ? "Complete all subtasks before submitting"
                : undefined
            }
            onClick={() =>
              setApprovalState(
                "submitted",
                `Submitted for approval · awaiting ${reviewer?.name ?? "reviewer"}`,
              )
            }
          >
            Submit for approval
          </MilButton>
        );
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="scn-root bp5-dark">
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

      {!persists && !scenarioLoading && (
        <div className="mil-banner mil-banner--warning">
          <Icon icon="database" size={12} />
          <span>
            Showing seed data — this scenario could not be loaded from the
            ontology, so edits are not saved.
          </span>
        </div>
      )}

      {/* ── NEW: Hero header backed by real NxgScenario data ── */}
      <ScenarioHero
        scenarioName={liveScenario?.scenarioName ?? ""}
        scenarioType={liveScenario?.scenarioType ?? ""}
        scenarioStatus={liveScenario?.scenarioStatus ?? ""}
        classification={liveScenario?.classification ?? ""}
        overallProgressPct={liveScenario?.overallProgressPct ?? 0}
        currentPhase={liveScenario?.currentPhase ?? ""}
        phaseCount={phases.length}
        injectCount={injectCount}
        objectiveCount={objectives.length}
        loading={scenarioLoading}
      />

      {/* ── Existing approval banner ── */}
      <div className="scn-banner">
        <div className="scn-banner__left">
          <span
            className={`scn-banner__status ${STATUS_CLASS[state.task.approvalState]}`}
          >
            <span className="scn-banner__status-dot" />
            {STATUS_LABEL[state.task.approvalState]}
          </span>
          <div className="scn-banner__title">{state.task.title}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {renderBannerActions()}
        </div>
      </div>

      <div className="scn-subline">
        {assignee && (
          <>
            Assigned to{" "}
            <strong style={{ color: "#aab3d0" }}>{assignee.name}</strong>
          </>
        )}
        <span className="scn-subline__sep">·</span>
        Due <strong style={{ color: "#aab3d0" }}>{state.task.due}</strong>
        <span className="scn-subline__sep">·</span>
        {state.task.description}
        {state.task.approvalNote && (
          <>
            <span className="scn-subline__sep">·</span>
            <em style={{ color: "#98a1c0" }}>{state.task.approvalNote}</em>
          </>
        )}
      </div>

      <div className="scn-body">
        <div className="scn-people-row">
          <PersonSelect
            label="Assignee"
            value={state.task.assigneeId}
            onChange={setAssignee}
          />
          <PersonSelect
            label="Reviewer"
            value={state.task.reviewerId}
            onChange={setReviewer}
          />
        </div>

        <div className="scn-subtasks">
          <div className="scn-subtasks__header">
            <span className="scn-subtasks__label">
              Subtasks — {doneCount}/{totalCount} complete
            </span>
            <span className="scn-subtasks__pct">{pct}%</span>
          </div>
          <div className="scn-progress">
            <div className="scn-progress__bar" style={{ width: `${pct}%` }} />
          </div>
          {state.subtasks.map((s) => (
            <div
              key={s.subtaskId}
              className={`scn-subtask ${s.done ? "scn-subtask--done" : ""}`}
              role="checkbox"
              aria-checked={s.done}
              tabIndex={0}
              onClick={() => toggleSubtask(s.subtaskId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleSubtask(s.subtaskId);
                }
              }}
            >
              <div className="scn-subtask__box">
                {s.done && <Icon icon="tick" size={10} color="#ffffff" />}
              </div>
              <div className="scn-subtask__text">{s.text}</div>
            </div>
          ))}
        </div>

        <StrategicContextCard
          context={state.strategicContext}
          onChange={updateContext}
        />

        <div className="scn-section">
          <div className="scn-section__head">
            <div className="scn-section__title">
              <Icon icon="shield" size={11} />
              OPFOR definitions
              <span style={{ color: "#454c68" }}>·</span>
              <span style={{ color: "#98a1c0", fontWeight: 600 }}>
                {state.opforDefinitions.length}
              </span>
            </div>
            <div className="scn-section__actions">
              <MilButton icon="add" variant="default" onClick={addOpfor}>
                Add OPFOR
              </MilButton>
            </div>
          </div>

          {state.opforDefinitions.length === 0 ? (
            <div className="mil-empty">
              <Icon icon="shield" size={28} />
              <div className="mil-empty__text">No OPFOR defined</div>
            </div>
          ) : (
            <div className="scn-opfor-grid">
              {state.opforDefinitions.map((o) => (
                <OpforCard
                  key={o.id}
                  opfor={o}
                  onChange={updateOpfor}
                  onDelete={() => deleteOpfor(o.id)}
                />
              ))}
            </div>
          )}
        </div>

        <CommentsThread comments={state.comments} onAdd={addComment} />
      </div>
    </div>
  );
};

// ── Widget entry point ─────────────────────────────────────────────────────
// Resolves the bound scenario before mounting the body, so the body always
// has a real scenario to work with and never silently falls back to a
// default exercise.

export const Scenario: React.FC = () => {
  const { parameters } = useWidgetContext();
  const binding = useScenarioIdFromObjectSet(
    parameters.values.scenario?.objectSet
  );
  return (
    <ScenarioGate binding={binding}>
      {(scenarioId) => <ScenarioBody scenarioId={scenarioId} />}
    </ScenarioGate>
  );
};
