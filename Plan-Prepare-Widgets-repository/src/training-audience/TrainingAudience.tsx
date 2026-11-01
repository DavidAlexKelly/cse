import { Icon } from "@blueprintjs/core";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import { MilButton } from "../shared/components/Button.js";
import { CommentsThread } from "../shared/components/CommentsThread.js";
import { PersonSelect } from "../shared/components/PersonSelect.js";
import "../shared/styling/index.css";
import "../shared/styling/task-page.css";
import {
  STATUS_CLASS,
  STATUS_LABEL,
} from "../shared/task/taskTypes.js";
import type { ApprovalState } from "../shared/task/taskTypes.js";
import { AudienceCard } from "./components/AudienceCard.js";
import { NationsTable } from "./components/NationsTable.js";
import {
  CURRENT_USER_ID,
  INITIAL_TRAINING_AUDIENCE,
  personById,
} from "./trainingAudienceData.js";
import type {
  ParticipatingNation,
  TrainingAudienceRecord,
  TrainingAudienceState,
} from "./trainingAudienceData.js";
import { useNxgTrainingAudiences } from "../shared/hooks/useNxgTrainingAudiences.js";
import type { ParticipatingNationRecord } from "../shared/hooks/useNxgTrainingAudiences.js";
import { useNxgAudienceMutations } from "../shared/hooks/useNxgAudienceMutations.js";
import { useScenarioIdFromObjectSet } from "../shared/hooks/useScenarioIdFromParam.js";
import { ScenarioGate } from "../shared/components/ScenarioGate.js";
import type TrainingAudienceConfig from "./trainingAudience.config.js";

const useWidgetContext = useFoundryWidgetContext.withTypes<typeof TrainingAudienceConfig>();

// ── Helpers ────────────────────────────────────────────────────────────────

function nextAudienceId(
  existing: TrainingAudienceRecord[],
  type: "primary" | "secondary",
): string {
  let n = existing.length + 1;
  const prefix = type === "primary" ? "audience_new_primary_" : "audience_new_secondary_";
  while (existing.some((a) => a.audienceId === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function nextCommentId(): string {
  return `c_${Date.now()}`;
}

// ── Component ──────────────────────────────────────────────────────────────

const TrainingAudienceBody: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {

  const {
    audiences: liveAudiences,
    loading,
    source,
    refresh: refreshAudiences,
  } = useNxgTrainingAudiences(scenarioId);
  const { emitEvent } = useWidgetContext();
  // Routed through the mutation hook's onSuccess so every write notifies
  // Workshop, rather than each call site having to remember to.
  const notifyDataChanged = useCallback(
    () => emitEvent("onDataChanged", { parameterUpdates: {} }),
    [emitEvent],
  );
  const {
    createAudience,
    updateAudience: persistAudience,
    deleteAudience: persistDeleteAudience,
    createNation,
    updateNation,
    deleteNation,
    error: writeError,
    clearError: clearWriteError,
  } = useNxgAudienceMutations({ onSuccess: notifyDataChanged });

  // Seed records have no matching ontology objects, so edits to them
  // stay in memory rather than producing "object not found" errors.
  const persists = source === "ontology";

  const [state, setState] = useState<TrainingAudienceState>(
    INITIAL_TRAINING_AUDIENCE,
  );

  // When live audiences arrive from the ontology, hydrate state.
  // Participating nations are now a first-class object type, so the
  // ontology is authoritative for them too — this used to preserve the
  // local copy because there was nowhere to store them.
  useEffect(() => {
    if (!loading) {
      setState((prev) => {
        const primary = liveAudiences.find((a) => a.audienceType === "primary");
        return {
          ...prev,
          audiences: liveAudiences,
          participatingNations:
            primary?.participatingNations ?? prev.participatingNations,
        };
      });
    }
  }, [liveAudiences, loading]);

  const assignee = personById(state.task.assigneeId);
  const reviewer = personById(state.task.reviewerId);

  const primary = useMemo(
    () => state.audiences.find((a) => a.audienceType === "primary"),
    [state.audiences],
  );
  const secondary = useMemo(
    () => state.audiences.filter((a) => a.audienceType === "secondary"),
    [state.audiences],
  );

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

  /**
   * When the user edits any content card or table row, the page returns to
   * the "in_progress" state so a fresh review cycle can begin. This matches
   * the requirement: "when edit is done you need to review/approve again".
   */
  const markEdited = useCallback(
    (prev: TrainingAudienceState): TrainingAudienceState => {
      if (prev.task.approvalState === "approved" || prev.task.approvalState === "submitted") {
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

  const updateAudience = useCallback((next: TrainingAudienceRecord) => {
    setState((prev) =>
      markEdited({
        ...prev,
        audiences: prev.audiences.map((a) =>
          a.audienceId === next.audienceId ? next : a,
        ),
      }),
    );
    if (!persists) return;
    void persistAudience(next.audienceId, {
      name: next.name,
      audienceType: next.audienceType,
      description: next.description,
      participantCount: next.participantCount,
      directorates: next.directorates,
    }).catch(() => refreshAudiences());
  }, [markEdited, persists, persistAudience, refreshAudiences]);

  const deleteAudience = useCallback((id: string) => {
    setState((prev) =>
      markEdited({
        ...prev,
        audiences: prev.audiences.filter((a) => a.audienceId !== id),
      }),
    );
    if (!persists) return;
    void persistDeleteAudience(id)
      .then(() => refreshAudiences())
      .catch(() => refreshAudiences());
  }, [markEdited, persists, persistDeleteAudience, refreshAudiences]);

  const addSecondary = useCallback(() => {
    const name = "New secondary audience";
    const description =
      "Describe what this secondary audience exercises and which staff cells participate.";

    if (persists) {
      // The ontology mints the primary key, so create then re-read
      // rather than inserting a locally generated id.
      void createAudience(scenarioId, {
        name,
        audienceType: "secondary",
        description,
        participantCount: 0,
        directorates: [],
      })
        .then(() => refreshAudiences())
        .catch(() => refreshAudiences());
      return;
    }

    setState((prev) => {
      const id = nextAudienceId(prev.audiences, "secondary");
      const next: TrainingAudienceRecord = {
        audienceId: id,
        name,
        audienceType: "secondary",
        participantCount: 0,
        description,
        directorates: [],
      };
      return markEdited({
        ...prev,
        audiences: [...prev.audiences, next],
      });
    });
  }, [markEdited, persists, scenarioId, createAudience, refreshAudiences]);

  const addPrimary = useCallback(() => {
    const name = "New primary audience";
    const description =
      "Describe the primary training audience — the staff whose performance is being assessed.";

    if (persists) {
      if (state.audiences.some((a) => a.audienceType === "primary")) return;
      void createAudience(scenarioId, {
        name,
        audienceType: "primary",
        description,
        participantCount: 0,
        directorates: [],
      })
        .then(() => refreshAudiences())
        .catch(() => refreshAudiences());
      return;
    }

    setState((prev) => {
      if (prev.audiences.some((a) => a.audienceType === "primary")) return prev;
      const id = nextAudienceId(prev.audiences, "primary");
      const next: TrainingAudienceRecord = {
        audienceId: id,
        name,
        audienceType: "primary",
        participantCount: 0,
        description,
        directorates: [],
        participatingNations: [],
      };
      return markEdited({
        ...prev,
        audiences: [...prev.audiences, next],
      });
    });
  }, [
    markEdited,
    persists,
    scenarioId,
    state.audiences,
    createAudience,
    refreshAudiences,
  ]);

  /**
   * The nations table reports its whole array on any change, so diff it
   * against the current list to work out which rows were added, edited
   * or removed. Nations hang off the primary audience.
   */
  const updateNations = useCallback((next: ParticipatingNation[]) => {
    const previous = state.participatingNations;
    setState((prev) =>
      markEdited({
        ...prev,
        participatingNations: next,
      }),
    );

    const primaryAudience = state.audiences.find(
      (a) => a.audienceType === "primary",
    );
    if (!persists || !primaryAudience) return;

    // Rows carry an ontology primary key once saved; rows without one
    // are new. Match on that key, falling back to nation code for rows
    // the table has recreated.
    const keyOf = (n: ParticipatingNation): string =>
      (n as ParticipatingNationRecord).participatingNationId ?? `code:${n.nation}`;

    const prevByKey = new Map(previous.map((n) => [keyOf(n), n]));
    const nextKeys = new Set(next.map(keyOf));
    const writes: Promise<void>[] = [];
    let structuralChange = false;

    for (const removed of previous) {
      const id = (removed as ParticipatingNationRecord).participatingNationId;
      if (id && !nextKeys.has(keyOf(removed))) {
        structuralChange = true;
        writes.push(deleteNation(id));
      }
    }

    for (const row of next) {
      const id = (row as ParticipatingNationRecord).participatingNationId;
      const before = prevByKey.get(keyOf(row));
      if (!id) {
        structuralChange = true;
        writes.push(
          createNation(scenarioId, primaryAudience.audienceId, {
            nationCode: row.nation,
            role: row.role,
            participantCount: row.participantCount,
            directorates: row.directorates,
          }),
        );
        continue;
      }
      if (
        before &&
        (before.nation !== row.nation ||
          before.role !== row.role ||
          before.participantCount !== row.participantCount ||
          before.directorates.join("|") !== row.directorates.join("|"))
      ) {
        writes.push(
          updateNation(id, {
            nationCode: row.nation,
            role: row.role,
            participantCount: row.participantCount,
            directorates: row.directorates,
          }),
        );
      }
    }

    if (writes.length === 0) return;

    // Wait for the writes to settle before re-reading, so the refresh
    // does not race them and return the pre-write state.
    void Promise.allSettled(writes).then((outcomes) => {
      const anyFailed = outcomes.some((o) => o.status === "rejected");
      if (structuralChange || anyFailed) refreshAudiences();
    });
  }, [
    markEdited,
    persists,
    scenarioId,
    state.participatingNations,
    state.audiences,
    createNation,
    updateNation,
    deleteNation,
    refreshAudiences,
  ]);

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
            Showing seed data — this scenario has no training audiences in the
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

        {/* Subtasks (always present per spec; progress bar shown for symmetry with Scenario, the look-and-feel guidance says it's not critical here) */}
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

        {/* Primary audience */}
        <div className="scn-section">
          <div className="scn-section__head">
            <div className="scn-section__title">
              <Icon icon="people" size={11} />
              Primary training audience
            </div>
            <div className="scn-section__actions">
              {!primary && (
                <MilButton icon="add" variant="default" onClick={addPrimary}>
                  Add audience
                </MilButton>
              )}
            </div>
          </div>

          {primary ? (
            <div className="scn-audience-grid scn-audience-grid--single">
              <AudienceCard
                audience={primary}
                onChange={updateAudience}
                onDelete={() => deleteAudience(primary.audienceId)}
                primaryStyle
              />
            </div>
          ) : (
            <div className="mil-empty">
              <Icon icon="people" size={28} />
              <div className="mil-empty__text">No primary audience defined</div>
            </div>
          )}
        </div>

        {/* Secondary audiences */}
        <div className="scn-section">
          <div className="scn-section__head">
            <div className="scn-section__title">
              <Icon icon="people" size={11} />
              Secondary audiences
              <span style={{ color: "#454c68" }}>·</span>
              <span style={{ color: "#98a1c0", fontWeight: 600 }}>
                {secondary.length}
              </span>
            </div>
            <div className="scn-section__actions">
              <MilButton icon="add" variant="default" onClick={addSecondary}>
                Add
              </MilButton>
            </div>
          </div>

          {secondary.length === 0 ? (
            <div className="mil-empty">
              <Icon icon="people" size={28} />
              <div className="mil-empty__text">No secondary audiences</div>
            </div>
          ) : (
            <div className="scn-audience-grid">
              {secondary.map((a) => (
                <AudienceCard
                  key={a.audienceId}
                  audience={a}
                  onChange={updateAudience}
                  onDelete={() => deleteAudience(a.audienceId)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Participating nations table */}
        <NationsTable
          nations={state.participatingNations}
          onChange={updateNations}
        />

        {/* Comments */}
        <CommentsThread comments={state.comments} onAdd={addComment} />
      </div>
    </div>
  );
};

// ── Widget entry point ─────────────────────────────────────────────────────
// Resolves the bound scenario before mounting the body, so the body always
// has a real scenario to work with and never silently falls back to a
// default exercise.

export const TrainingAudience: React.FC = () => {
  const { parameters } = useWidgetContext();
  const binding = useScenarioIdFromObjectSet(
    parameters.values.scenario?.objectSet
  );
  return (
    <ScenarioGate binding={binding}>
      {(scenarioId) => <TrainingAudienceBody scenarioId={scenarioId} />}
    </ScenarioGate>
  );
};
