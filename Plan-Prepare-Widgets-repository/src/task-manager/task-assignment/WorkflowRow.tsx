// ── Workflow Task Card (read-only by default) ──────────────────────────────

import { Icon } from "@blueprintjs/core";
import React, { useState } from "react";
import { MilLabel } from "../../shared/components/Label.js";
import { DeleteConfirmModal } from "./DeleteConfirmModal.js";
import { EditTaskModal } from "./EditTaskModal.js";
import { TaskDetailModal } from "./TaskDetailModal.js";
import type { SubTask, TeamMember, WorkflowTask } from "./types.js";
import {
  TASK_STATUS_INTENT,
  TASK_STATUS_LABEL,
} from "../../shared/task/taskTaxonomy.js";
import "./taskAssignment.css";

// ── Status → badge intent mapping ─────────────────────────────────────────
// Sourced from the shared taxonomy so every widget agrees on the
// status vocabulary, including "approved" which the ontology uses.

const STATUS_INTENT = TASK_STATUS_INTENT;
const STATUS_LABEL = TASK_STATUS_LABEL;

// ── Props ──────────────────────────────────────────────────────────────────

interface WorkflowRowProps {
  task: WorkflowTask;
  teamMembers: TeamMember[];
  /** Resolved phase name for the detail modal — passed down from PhaseGroup */
  phaseName?: string;
  onUpdate: (updated: WorkflowTask) => void;
  onDelete: (id: string) => void;
}

// ── Sub-task item ──────────────────────────────────────────────────────────

const SubTaskItem: React.FC<{ subTask: SubTask; onToggle: () => void }> = ({ subTask, onToggle }) => (
  <div
    className="ta-subtask-item"
    role="button"
    tabIndex={0}
    onClick={e => { e.stopPropagation(); onToggle(); }}
    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onToggle(); } }}
  >
    <div className={`ta-subtask-checkbox ${subTask.done ? "ta-subtask-checkbox--done" : ""}`}>
      {subTask.done && <Icon icon="tick" size={9} />}
    </div>
    <span className={`ta-subtask-label ${subTask.done ? "ta-subtask-label--done" : ""}`}>
      {subTask.label}
    </span>
  </div>
);

// ── Assignee pill ──────────────────────────────────────────────────────────

const AssigneePill: React.FC<{ label: string; name: string | null }> = ({ label, name }) => (
  <div className="ta-card__assignee">
    <span className="ta-card__assignee-label">{label}</span>
    {name
      ? <span className="ta-card__assignee-name">{name}</span>
      : <span className="ta-card__assignee-empty">Unassigned</span>
    }
  </div>
);

// ── Component ──────────────────────────────────────────────────────────────

export const WorkflowRow: React.FC<WorkflowRowProps> = ({
  task,
  teamMembers,
  phaseName,
  onUpdate,
  onDelete,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing,       setEditing]       = useState(false);
  const [showDetail,    setShowDetail]    = useState(false);
  const [expanded,      setExpanded]      = useState(false);

  const hasSubTasks = (task.subTasks?.length ?? 0) > 0;
  const doneCount   = task.subTasks?.filter(s => s.done).length ?? 0;
  const totalCount  = task.subTasks?.length ?? 0;

  const handleSubTaskToggle = (subTaskId: string) => {
    const updatedSubTasks = (task.subTasks ?? []).map(st =>
      st.id === subTaskId ? { ...st, done: !st.done } : st,
    );
    onUpdate({ ...task, subTasks: updatedSubTasks });
  };

  const statusIntent = STATUS_INTENT[task.status];
  const statusLabel  = STATUS_LABEL[task.status];

  return (
    <>
      {/* ── Task card ──────────────────────────────────────────────── */}
      <div className={`ta-card ${expanded ? "ta-card--expanded" : ""}`}>

        {/* ── Card body ─────────────────────────────────────────── */}
        <div className="ta-card__body">

          {/* Left: title + description + subtask progress */}
          <div className="ta-card__main">
            <div className="ta-card__title">{task.title}</div>
            {task.description && (
              <div className="ta-card__desc">{task.description}</div>
            )}
            {hasSubTasks && (
              <div className="ta-row__subtask-progress">
                <div className="ta-row__subtask-progress-bar">
                  <div
                    className="ta-row__subtask-progress-fill"
                    style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
                  />
                </div>
                <span className="ta-row__subtask-count">{doneCount}/{totalCount} steps</span>
              </div>
            )}
          </div>

          {/* Centre: assignees */}
          <div className="ta-card__assignees">
            <AssigneePill label="Approver" name={task.approver} />
            <AssigneePill label="Owner"    name={task.owner}    />
          </div>

          {/* Right: due + status */}
          <div className="ta-card__meta">
            {task.due && task.due !== "—" && (
              <div className="ta-card__due">
                <Icon icon="time" size={10} />
                {task.due}
              </div>
            )}
            <MilLabel intent={statusIntent}>{statusLabel}</MilLabel>
          </div>

          {/* Action buttons */}
          <div className="ta-card__actions">
            {/* More Details */}
            <button
              className="mil-btn mil-btn--ghost mil-btn--sm"
              title="More details"
              onClick={() => setShowDetail(true)}
            >
              <Icon icon="info-sign" size={11} />
              Details
            </button>

            {/* Expand subtasks inline */}
            {hasSubTasks && (
              <button
                className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only"
                title={expanded ? "Collapse checklist" : "Expand checklist"}
                onClick={() => setExpanded(p => !p)}
              >
                <Icon icon={expanded ? "chevron-up" : "chevron-down"} size={11} />
              </button>
            )}

            {/* Edit */}
            <button
              className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only"
              title="Edit task"
              onClick={() => setEditing(true)}
            >
              <Icon icon="edit" size={11} />
            </button>

            {/* Delete */}
            <button
              className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only"
              title="Remove task"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon icon="cross" size={11} />
            </button>
          </div>
        </div>

        {/* ── Inline subtask panel ──────────────────────────────── */}
        {expanded && hasSubTasks && (
          <div className="ta-subtask-panel">
            {task.subTasks!.map(st => (
              <SubTaskItem
                key={st.id}
                subTask={st}
                onToggle={() => handleSubTaskToggle(st.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* More Details modal */}
      {showDetail && (
        <TaskDetailModal
          task={task}
          phaseName={phaseName}
          onClose={() => setShowDetail(false)}
          onToggleSubTask={handleSubTaskToggle}
          onEdit={() => setEditing(true)}
        />
      )}

      {/* Edit modal */}
      {editing && (
        <EditTaskModal
          task={task}
          teamMembers={teamMembers}
          onSave={updated => { onUpdate(updated); setEditing(false); }}
          onClose={() => setEditing(false)}
        />
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <DeleteConfirmModal
          taskTitle={task.title}
          onConfirm={() => { onDelete(task.id); setConfirmDelete(false); }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
};
