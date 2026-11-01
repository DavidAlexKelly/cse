import { Icon } from "@blueprintjs/core";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import { MilButton } from "../shared/components/Button.js";
import { CommentsThread } from "../shared/components/CommentsThread.js";
import { MilLabel } from "../shared/components/Label.js";
import { PersonSelect } from "../shared/components/PersonSelect.js";
import "../shared/styling/index.css";
import "../shared/styling/task-page.css";
import {
  STATUS_CLASS,
  STATUS_LABEL,
} from "../shared/task/taskTypes.js";
import type { ApprovalState } from "../shared/task/taskTypes.js";
import { ObjectivesTable } from "./components/ObjectivesTable.js";
import {
  CURRENT_USER_ID,
  INITIAL_TRAINING_OBJECTIVES,
  personById,
} from "./trainingObjectivesData.js";
import type {
  TrainingObjectiveRecord,
  TrainingObjectivesState,
} from "./trainingObjectivesData.js";
import { useNxgTrainingObjectives } from "../shared/hooks/useNxgTrainingObjectives.js";
import { useNxgObjectiveMutations } from "../shared/hooks/useNxgObjectiveMutations.js";
import { useFirstObjectPropertyValue } from "../shared/hooks/useFirstObjectPropertyValue.js";
import { useScenarioIdFromObjectSet } from "../shared/hooks/useScenarioIdFromParam.js";
import { ScenarioGate } from "../shared/components/ScenarioGate.js";
import type TrainingObjectivesConfig from "./trainingObjectives.config.js";

const useWidgetContext = useFoundryWidgetContext.withTypes<typeof TrainingObjectivesConfig>();

function nextCommentId(): string {
  return `c_${Date.now()}`;
}

// ── Component ──────────────────────────────────────────────────────────────

const TrainingObjectivesBody: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {
  const { parameters } = useWidgetContext();
  const selectedPhaseId = useFirstObjectPropertyValue(
    parameters.values.selectedPhase?.objectSet,
    "phaseId",
  );

  const {
    objectives: liveObjectives,
    loading,
    source,
    refresh: refreshObjectives,
  } = useNxgTrainingObjectives(scenarioId);
  const { emitEvent } = useWidgetContext();
  // Routed through the mutation hook's onSuccess so every write notifies
  // Workshop, rather than each call site having to remember to.
  const notifyDataChanged = useCallback(
    () => emitEvent("onDataChanged", { parameterUpdates: {} }),
    [emitEvent],
  );
  const {
    createObjective,
    updateObjective,
    deleteObjective,
    error: writeError,
    clearError: clearWriteError,
  } = useNxgObjectiveMutations({ onSuccess: notifyDataChanged });

  // Seed records have no matching ontology objects, so edits to them
  // stay in memory rather than producing "object not found" errors.
  const persists = source === "ontology";

  const [state, setState] = useState<TrainingObjectivesState>(
    INITIAL_TRAINING_OBJECTIVES,
  );

  // When a phase is bound, narrow to that phase's objectives so this
  // widget can follow the selection the Phases widget publishes.
  //
  // The filter is applied here, at hydration, rather than at render: the
  // save logic diffs the table's array against state.objectives, so if
  // state held the full list while the table showed a subset, every
  // filtered-out objective would look deleted.
  const visibleObjectives = useMemo(
    () =>
      selectedPhaseId == null
        ? liveObjectives
        : liveObjectives.filter((o) => o.phaseId === selectedPhaseId),
    [liveObjectives, selectedPhaseId],
  );

  // When live objectives arrive from the ontology, hydrate state
  useEffect(() => {
    if (!loading) {
      setState((prev) => ({ ...prev, objectives: visibleObjectives }));
    }
  }, [visibleObjectives, loading]);

  const assignee = personById(state.task.assigneeId);
  const reviewer = personById(state.task.reviewerId);

  // Subtask progress (gates Submit button only)
  const { doneCount, totalCount, pct } = useMemo(() => {
    const total = state.subtasks.length;
    const done = state.subtasks.filter((s) => s.done).length;
    return {
      doneCount: done,
      totalCount: total,
      pct: total === 0 ? 0 : Math.round((done / total) * 100),
    };
  }, [state.subtasks]);

  // Priority summary for the section subtitle
  const { high, medium, low } = useMemo(() => {
    let h = 0;
    let m = 0;
    let l = 0;
    for (const o of state.objectives) {
      if (o.priority === "High") h++;
      else if (o.priority === "Medium") m++;
      else if (o.priority === "Low") l++;
    }
    return { high: h, medium: m, low: l };
  }, [state.objectives]);

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

  /** Any content change demotes the status so it must be reviewed again. */
  const markEdited = useCallback(
    (prev: TrainingObjectivesState): TrainingObjectivesState => {
      if (
        prev.task.approvalState === "approved" ||
        prev.task.approvalState === "submitted"
      ) {
        return {
          ...prev,
          task: {
            ...prev.task,
            approvalState: "in_progress",
            approvalNote: "Edited · re-submit for approval",
          },
        };
      }
      return prev;
    },
    [],
  );

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

  /**
   * The table hands back the whole objective array on any change, so
   * diff it against what we had to work out which rows were added,
   * edited or removed, and persist just those.
   *
   * Note the table renumbers refs (TO-01, TO-02 …) after an add,
   * delete or reorder, so a single removal legitimately produces
   * several updates.
   */
  const updateObjectives = useCallback(
    (next: TrainingObjectiveRecord[]) => {
      const previous = state.objectives;
      setState((prev) => markEdited({ ...prev, objectives: next }));

      if (!persists) return;

      const prevById = new Map(previous.map((o) => [o.objectiveId, o]));
      const nextIds = new Set(next.map((o) => o.objectiveId));
      const writes: Promise<void>[] = [];
      let structuralChange = false;

      for (const removed of previous) {
        if (!nextIds.has(removed.objectiveId)) {
          structuralChange = true;
          writes.push(deleteObjective(removed.objectiveId));
        }
      }

      for (const row of next) {
        const before = prevById.get(row.objectiveId);
        if (!before) {
          // New row — the ontology mints the real primary key.
          structuralChange = true;
          writes.push(
            createObjective(scenarioId, {
              objective: row.objective,
              ref: row.ref,
              functionalArea: row.functionalArea,
              priority: row.priority,
              // Inherit the active phase filter, or the new row would be
              // saved and then immediately filtered out of view.
              phaseId: selectedPhaseId,
            }),
          );
          continue;
        }
        if (
          before.objective !== row.objective ||
          before.ref !== row.ref ||
          before.functionalArea !== row.functionalArea ||
          before.priority !== row.priority
        ) {
          writes.push(
            updateObjective(row.objectiveId, {
              objective: row.objective,
              ref: row.ref,
              functionalArea: row.functionalArea,
              priority: row.priority,
            }),
          );
        }
      }

      if (writes.length === 0) return;

      // Wait for the writes to settle before re-reading, otherwise the
      // refresh races them and returns the pre-write state. Always
      // refresh after an add or delete so locally generated ids are
      // replaced by the real ontology primary keys; after edit-only
      // changes, refresh only if something failed.
      void Promise.allSettled(writes).then((outcomes) => {
        const anyFailed = outcomes.some((o) => o.status === "rejected");
        if (structuralChange || anyFailed) refreshObjectives();
      });
    },
    [
      markEdited,
      state.objectives,
      persists,
      scenarioId,
      selectedPhaseId,
      createObjective,
      updateObjective,
      deleteObjective,
      refreshObjectives,
    ],
  );

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

  // ── Banner actions ───────────────────────────────────────────────────────

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

      {!persists && !loading && (
        <div className="mil-banner mil-banner--warning">
          <Icon icon="database" size={12} />
          <span>
            Showing seed data — this scenario has no training objectives in the
            ontology, so edits are not saved.
          </span>
        </div>
      )}

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
        {/* People */}
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

        {/* Subtasks */}
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

        {/* Objectives section */}
        <div className="scn-section">
          <div className="scn-section__head">
            <div className="scn-section__title">
              <Icon icon="flag" size={11} />
              Training objectives
              {state.task.aiAssisted && (
                <span className="scn-tagline">Generated</span>
              )}
            </div>
          </div>

          {/* Summary chips */}
          <div className="scn-summary-row">
            <span>
              <strong style={{ color: "#e6eaf8" }}>
                {state.objectives.length}
              </strong>{" "}
              objective{state.objectives.length === 1 ? "" : "s"}
            </span>
            {state.objectives.length > 0 && (
              <>
                <span className="scn-summary-row__sep">·</span>
                <MilLabel intent="red">{high} High</MilLabel>
                <MilLabel intent="amber">{medium} Medium</MilLabel>
                <MilLabel intent="green">{low} Low</MilLabel>
              </>
            )}
          </div>

          <ObjectivesTable
            objectives={state.objectives}
            onChange={updateObjectives}
          />
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

export const TrainingObjectives: React.FC = () => {
  const { parameters } = useWidgetContext();
  const binding = useScenarioIdFromObjectSet(
    parameters.values.scenario?.objectSet
  );
  return (
    <ScenarioGate binding={binding}>
      {(scenarioId) => <TrainingObjectivesBody scenarioId={scenarioId} />}
    </ScenarioGate>
  );
};
