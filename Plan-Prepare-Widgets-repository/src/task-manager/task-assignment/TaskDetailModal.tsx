// ── Task Detail Modal ──────────────────────────────────────────────────────
//
// A read-only "More Details" pop-up that shows the full information for a
// WorkflowTask: description, assignees, due window, status, section / phase,
// and the complete interactive subtask checklist.

import { Icon } from "@blueprintjs/core";
import React from "react";
import { MilModal } from "../../shared/components/Modal.js";
import { MilLabel } from "../../shared/components/Label.js";
import type { SubTask, WorkflowTask } from "./types.js";
import {
  TASK_STATUS_INTENT,
  TASK_STATUS_LABEL,
} from "../../shared/task/taskTaxonomy.js";
import "./taskAssignment.css";

// ── Status helpers ─────────────────────────────────────────────────────────
// Sourced from the shared taxonomy so every widget agrees on the
// status vocabulary, including "approved" which the ontology uses.

const STATUS_INTENT = TASK_STATUS_INTENT;
const STATUS_LABEL = TASK_STATUS_LABEL;

// ── Detail row (label + value pair) ───────────────────────────────────────

const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="tdm-detail-row">
    <span className="tdm-detail-row__label">{label}</span>
    <span className="tdm-detail-row__value">{children}</span>
  </div>
);

// ── Subtask item (read-only + togglable) ───────────────────────────────────

const SubTaskLine: React.FC<{ subTask: SubTask; onToggle: () => void }> = ({ subTask, onToggle }) => (
  <button
    className={`tdm-subtask-item ${subTask.done ? "tdm-subtask-item--done" : ""}`}
    onClick={onToggle}
    title={subTask.done ? "Mark incomplete" : "Mark complete"}
  >
    <div className={`tdm-subtask-check ${subTask.done ? "tdm-subtask-check--done" : ""}`}>
      {subTask.done && <Icon icon="tick" size={9} />}
    </div>
    <span className="tdm-subtask-label">{subTask.label}</span>
  </button>
);

// ── Props ──────────────────────────────────────────────────────────────────

interface TaskDetailModalProps {
  task: WorkflowTask;
  /** Phase name resolved from phases list — optional */
  phaseName?: string;
  onClose: () => void;
  /** Allow toggling subtask done state from the detail view */
  onToggleSubTask?: (subTaskId: string) => void;
  /** Open the edit modal directly */
  onEdit?: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task,
  phaseName,
  onClose,
  onToggleSubTask,
  onEdit,
}) => {
  const hasSubTasks  = (task.subTasks?.length ?? 0) > 0;
  const doneCount    = task.subTasks?.filter(s => s.done).length ?? 0;
  const totalCount   = task.subTasks?.length ?? 0;
  const completionPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const statusIntent = STATUS_INTENT[task.status];
  const statusLabel  = STATUS_LABEL[task.status];

  const actions = [
    ...(onEdit ? [{ label: "Edit Task", variant: "default" as const, icon: "edit" as const, onClick: () => { onEdit(); onClose(); } }] : []),
    { label: "Close", variant: "default" as const, onClick: onClose },
  ];

  return (
    <MilModal
      title={task.title}
      titleIcon="document"
      size="md"
      actions={actions}
      onClose={onClose}
    >
      <div className="tdm-body">

        {/* ── Status + section badges ─────────────────────────────── */}
        <div className="tdm-badges">
          <MilLabel intent={statusIntent}>{statusLabel}</MilLabel>
          <MilLabel intent="grey">{task.section}</MilLabel>
          {phaseName && <MilLabel intent="blue">{phaseName}</MilLabel>}
        </div>

        {/* ── Description ─────────────────────────────────────────── */}
        {task.description ? (
          <div className="tdm-section">
            <div className="tdm-section__heading">Description</div>
            <p className="tdm-description">{task.description}</p>
          </div>
        ) : (
          <div className="tdm-section">
            <div className="tdm-section__heading">Description</div>
            <p className="tdm-description tdm-description--empty">No description provided.</p>
          </div>
        )}

        {/* ── Assignment details ──────────────────────────────────── */}
        <div className="tdm-section">
          <div className="tdm-section__heading">Assignment</div>
          <div className="tdm-detail-grid">
            <DetailRow label="Approver">
              {task.approver
                ? <><Icon icon="person" size={11} style={{ marginRight: 5 }} />{task.approver}</>
                : <span className="tdm-unassigned">Unassigned</span>}
            </DetailRow>
            <DetailRow label="Task Owner">
              {task.owner
                ? <><Icon icon="person" size={11} style={{ marginRight: 5 }} />{task.owner}</>
                : <span className="tdm-unassigned">Unassigned</span>}
            </DetailRow>
            <DetailRow label="Due Window">
              {task.due && task.due !== "—"
                ? <><Icon icon="time" size={11} style={{ marginRight: 5 }} />{task.due}</>
                : <span className="tdm-unassigned">—</span>}
            </DetailRow>
          </div>
        </div>

        {/* ── Subtasks ────────────────────────────────────────────── */}
        {hasSubTasks && (
          <div className="tdm-section">
            <div className="tdm-section__heading">
              Checklist
              <span className="tdm-section__count">{doneCount} / {totalCount}</span>
            </div>

            {/* Progress bar */}
            <div className="tdm-progress">
              <div className="tdm-progress__bar">
                <div className="tdm-progress__fill" style={{ width: `${completionPct}%` }} />
              </div>
              <span className="tdm-progress__label">{completionPct}%</span>
            </div>

            {/* Subtask list */}
            <div className="tdm-subtask-list">
              {task.subTasks!.map(st => (
                <SubTaskLine
                  key={st.id}
                  subTask={st}
                  onToggle={() => onToggleSubTask?.(st.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </MilModal>
  );
};
