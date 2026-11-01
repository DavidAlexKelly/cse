// ── Task Assignment — Root Layout ──────────────────────────────────────────

import { Icon } from "@blueprintjs/core";
import React, { useCallback, useEffect, useState } from "react";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import { MilButton } from "../../shared/components/Button.js";
import { MilLabel } from "../../shared/components/Label.js";
import { MOCK_TEAM_MEMBERS, TASK_SECTIONS } from "./mockData.js";
import { AddTaskModal } from "./AddTaskModal.js";
import { useNxgTasks } from "../../shared/hooks/useNxgTasks.js";
import { useNxgPhases } from "../../shared/hooks/useNxgPhases.js";
import { useNxgTaskMutations } from "../../shared/hooks/useNxgTaskMutations.js";
import { useScenarioIdFromObjectSet } from "../../shared/hooks/useScenarioIdFromParam.js";
import { ScenarioGate } from "../../shared/components/ScenarioGate.js";
import { TeamSidebar } from "./TeamSidebar.js";
import { WorkflowTable } from "./WorkflowTable.js";
import { TaskGraph } from "../task-graph/TaskGraph.js";
import type { TeamMember, WorkflowTask } from "./types.js";
import type TaskAssignmentConfig from "./taskAssignment.config.js";
import "./taskAssignment.css";

const useWidgetContext = useFoundryWidgetContext.withTypes<typeof TaskAssignmentConfig>();

// ── Status summary helpers ─────────────────────────────────────────────────

function countByStatus(tasks: WorkflowTask[], status: WorkflowTask["status"]) {
  return tasks.filter(t => t.status === status).length;
}

type ViewMode = "list" | "graph";

// ── Component ──────────────────────────────────────────────────────────────

const TaskAssignmentBody: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {

  const {
    tasks: liveTasks,
    loading: tasksLoading,
    source: taskSource,
    refresh: refreshTasks,
  } = useNxgTasks(scenarioId);
  const { phases } = useNxgPhases(scenarioId);
  const { emitEvent } = useWidgetContext();
  // Routed through the mutation hook's onSuccess so every write notifies
  // Workshop, rather than each call site having to remember to.
  const notifyDataChanged = useCallback(
    () => emitEvent("onDataChanged", { parameterUpdates: {} }),
    [emitEvent],
  );
  const {
    createTask,
    updateTask,
    deleteTask,
    updateSubtask,
    error: writeError,
    clearError: clearWriteError,
  } = useNxgTaskMutations({ onSuccess: notifyDataChanged });

  // When the task list came from local seed data there are no matching
  // ontology objects to write to, so edits stay in memory. Attempting a
  // write here would only produce confusing "object not found" errors.
  const persists = taskSource === "ontology";

  const [view,         setView]         = useState<ViewMode>("list");
  const [tasks,        setTasks]        = useState<WorkflowTask[]>(liveTasks);
  const [members,      setMembers]      = useState<TeamMember[]>(MOCK_TEAM_MEMBERS);

  // Keep task list in sync when the hook resolves
  useEffect(() => {
    if (!tasksLoading) {
      setTasks(liveTasks);
    }
  }, [liveTasks, tasksLoading]);
  const [showAddTask,  setShowAddTask]  = useState(false);
  const [activeMember, setActiveMember] = useState<string | null>(null);

  // ── Task handlers ──────────────────────────────────────────────────────
  // Each handler updates local state immediately so the UI stays
  // responsive, then persists. On failure we re-read from the ontology
  // so the view snaps back to the true stored state rather than
  // silently showing an edit that was never saved.

  const handleUpdateTask = (updated: WorkflowTask) => {
    const previous = tasks.find(t => t.id === updated.id);
    setTasks(prev => prev.map(t => (t.id === updated.id ? updated : t)));
    if (!persists) return;

    // Subtask checkbox toggles and label edits reach us as a whole-task
    // update, so diff them out and persist each one against its own
    // NxgSubtask object rather than rewriting the parent task.
    const before = new Map((previous?.subTasks ?? []).map(s => [s.id, s]));
    for (const sub of updated.subTasks ?? []) {
      const prevSub = before.get(sub.id);
      if (prevSub && (prevSub.done !== sub.done || prevSub.label !== sub.label)) {
        void updateSubtask(sub.id, {
          label: sub.label,
          done: sub.done,
        }).catch(() => refreshTasks());
      }
    }

    // Only write the task itself when one of its own fields moved,
    // so ticking a checkbox doesn't trigger a redundant task update.
    const taskFieldsChanged =
      previous == null ||
      previous.title !== updated.title ||
      previous.description !== updated.description ||
      previous.section !== updated.section ||
      previous.status !== updated.status ||
      previous.due !== updated.due ||
      previous.owner !== updated.owner ||
      previous.approver !== updated.approver ||
      previous.phaseId !== updated.phaseId ||
      previous.injectId !== updated.injectId ||
      previous.aiAssisted !== updated.aiAssisted;

    if (!taskFieldsChanged) return;

    void updateTask(updated.id, {
      title: updated.title,
      description: updated.description,
      section: updated.section,
      status: updated.status,
      due: updated.due,
      owner: updated.owner,
      approver: updated.approver,
      phaseId: updated.phaseId,
      injectId: updated.injectId,
      aiAssisted: updated.aiAssisted,
    }).catch(() => refreshTasks());
  };

  const handleDeleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    if (!persists) return;
    void deleteTask(id).catch(() => refreshTasks());
  };

  const handleAddTask = (task: WorkflowTask) => {
    if (!persists) {
      setTasks(prev => [...prev, task]);
      return;
    }
    // The ontology mints the real primary key, so refresh rather than
    // inserting the locally generated id into the list.
    void createTask(scenarioId, {
      title: task.title,
      description: task.description,
      section: task.section,
      status: task.status,
      due: task.due,
      owner: task.owner,
      approver: task.approver,
      phaseId: task.phaseId,
      aiAssisted: task.aiAssisted,
    })
      .then(() => refreshTasks())
      .catch(() => refreshTasks());
  };

  // ── Member handlers ────────────────────────────────────────────────────

  const handleAddMember = (member: TeamMember) => {
    setMembers(prev => [...prev, member]);
  };

  const handleSaveMember = (updated: TeamMember) => {
    setMembers(prev => prev.map(m => (m.id === updated.id ? updated : m)));
    if (activeMember) {
      const old = members.find(m => m.id === updated.id);
      if (old && old.name === activeMember) setActiveMember(updated.name);
    }
  };

  // ── Status counts ──────────────────────────────────────────────────────

  const approvedCount = countByStatus(tasks, "approved");
  const assignedCount = countByStatus(tasks, "assigned");
  const inReviewCount = countByStatus(tasks, "in-review");
  const pendingCount  = countByStatus(tasks, "pending");

  return (
    <div className="mil-widget bp5-dark">

      {/* ── Header — shared across both views ─────────────────────────── */}
      <div className="mil-header">
        <div className="mil-header__title">
          <Icon icon="people" size={14} />
          Workflow &amp; Team
          <span className="mil-header__subtitle">
            {view === "list" ? "Assign Approvers and Task Owners" : "Dependency Graph View"}
          </span>
        </div>
        <div className="mil-header__actions">
          {/* ── View toggle ──────────────────────────────────────────── */}
          <div className="ta-view-toggle">
            <button
              className={`ta-view-toggle__btn ${view === "list" ? "ta-view-toggle__btn--active" : ""}`}
              onClick={() => setView("list")}
              title="List view"
            >
              <Icon icon="list" size={11} />
              List
            </button>
            <div className="ta-view-toggle__divider" />
            <button
              className={`ta-view-toggle__btn ${view === "graph" ? "ta-view-toggle__btn--active" : ""}`}
              onClick={() => setView("graph")}
              title="Graph view"
            >
              <Icon icon="graph" size={11} />
              Graph
            </button>
          </div>

          {view === "list" && (
            <MilButton icon="star" variant="ghost">
              AI Recommended Assignments
            </MilButton>
          )}
        </div>
      </div>

      {/* ── Write failure banner ─────────────────────────────────────── */}
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

      {/* ── Graph view ───────────────────────────────────────────────── */}
      {view === "graph" && (
        <div className="ta-graph-embed">
          <TaskGraph embedded phases={phases} liveTasks={tasks} />
        </div>
      )}

      {/* ── List view ────────────────────────────────────────────────── */}
      {view === "list" && (
        <>
          <div className="ta-layout">
            <TeamSidebar
              members={members}
              tasks={tasks}
              activeMember={activeMember}
              onActiveMemberChange={setActiveMember}
              onAddMember={handleAddMember}
              onSaveMember={handleSaveMember}
              onUpdateTask={handleUpdateTask}
            />
            <WorkflowTable
              tasks={tasks}
              teamMembers={members}
              sections={TASK_SECTIONS}
              phases={phases}
              activeMember={activeMember}
              onClearMemberFilter={() => setActiveMember(null)}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
            />
          </div>

          {/* ── Footer ──────────────────────────────────────────────── */}
          <div className="ta-footer">
            <div className="ta-footer__left">
              <MilButton
                icon="add"
                variant="default"
                size="md"
                onClick={() => setShowAddTask(true)}
              >
                Add workflow task
              </MilButton>
            </div>
            <div className="ta-footer__right">
              <MilButton icon="tick" variant="primary">
                Confirm &amp; assign tasks
              </MilButton>
            </div>
          </div>

          {/* ── Status bar ──────────────────────────────────────────── */}
          <div className="mil-statusbar">
            <MilLabel variant="status-dot" intent="green">
              {approvedCount} Approved
            </MilLabel>
            <MilLabel variant="status-dot" intent="blue">
              {assignedCount} Assigned
            </MilLabel>
            <MilLabel variant="status-dot" intent="amber">
              {inReviewCount} In Review
            </MilLabel>
            <MilLabel variant="status-dot" intent="grey">
              {pendingCount} Pending
            </MilLabel>
            {!persists && !tasksLoading && (
              <MilLabel intent="amber">
                Seed data — edits are not saved
              </MilLabel>
            )}
            <span style={{ marginLeft: "auto", color: "#454c68" }}>
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} total
            </span>
          </div>
        </>
      )}

      {/* ── Add task modal ─────────────────────────────────────────────── */}
      {showAddTask && (
        <AddTaskModal
          teamMembers={members}
          onAdd={handleAddTask}
          onClose={() => setShowAddTask(false)}
        />
      )}
    </div>
  );
};

// ── Widget entry point ─────────────────────────────────────────────────────
// Resolves the bound scenario before mounting the body, so the body always
// has a real scenario to work with and never silently falls back to a
// default exercise.

export const TaskAssignment: React.FC = () => {
  const { parameters } = useWidgetContext();
  const binding = useScenarioIdFromObjectSet(
    parameters.values.scenario?.objectSet
  );
  return (
    <ScenarioGate binding={binding}>
      {(scenarioId) => <TaskAssignmentBody scenarioId={scenarioId} />}
    </ScenarioGate>
  );
};
