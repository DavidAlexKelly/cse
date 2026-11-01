/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import React, { useState } from "react";
import {
  PHASE_LABELS,
  PHASE_ORDER,
  type PhaseId,
  type PpeaRole,
  type PpeaTask,
} from "./ppeaData.js";

interface Props {
  initial: Partial<PpeaTask> | null;
  mode: "create" | "edit";
  roles: PpeaRole[];
  /** All other tasks (excluding the one being edited) — for the
   *  upstream/downstream selectors. */
  otherTasks: PpeaTask[];
  /** Direct downstream ids of the task being edited, so we can show that the
   *  user can clear them if they want. */
  initialDownstream: string[];
  onClose: () => void;
  onSave: (
    task: PpeaTask,
    newDownstreamIds: string[],
  ) => void;
  onDelete?: () => void;
}

function RoleChips({
  roles,
  selected,
  onToggle,
}: {
  roles: PpeaRole[];
  selected: string[];
  onToggle: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="ppea-chip-grid">
      {roles.map((r) => {
        const on = selected.includes(r.id);
        return (
          <button
            key={r.id}
            type="button"
            className={`ppea-chip ${on ? "ppea-chip--on" : ""}`}
            onClick={() => onToggle(r.id)}
            title={r.name}
          >
            {r.abbr}
          </button>
        );
      })}
    </div>
  );
}

function TaskCheckboxList({
  tasks,
  selected,
  onToggle,
}: {
  tasks: PpeaTask[];
  selected: string[];
  onToggle: (id: string) => void;
}): React.ReactElement {
  if (tasks.length === 0) {
    return <div className="ppea-empty-line">No other tasks yet.</div>;
  }
  return (
    <div className="ppea-task-checklist">
      {tasks.map((t) => {
        const on = selected.includes(t.id);
        return (
          <label key={t.id} className="ppea-task-check">
            <input
              type="checkbox"
              checked={on}
              onChange={() => onToggle(t.id)}
            />
            <span
              className="ppea-task-check__phase"
              data-phase={t.phase}
            >
              {PHASE_LABELS[t.phase].slice(0, 3).toUpperCase()}
            </span>
            <span className="ppea-task-check__name">{t.name}</span>
          </label>
        );
      })}
    </div>
  );
}

export const TaskEditModal: React.FC<Props> = ({
  initial,
  mode,
  roles,
  otherTasks,
  initialDownstream,
  onClose,
  onSave,
  onDelete,
}) => {
  const [name, setName] = useState(initial?.name ?? "");
  const [phase, setPhase] = useState<PhaseId>(initial?.phase ?? "plan");
  const [desc, setDesc] = useState(initial?.desc ?? "");
  const [owner, setOwner] = useState<string[]>(initial?.owner ?? []);
  const [approver, setApprover] = useState<string[]>(initial?.approver ?? []);
  const [involved, setInvolved] = useState<string[]>(initial?.involved ?? []);
  const [deps, setDeps] = useState<string[]>(initial?.deps ?? []);
  const [downstream, setDownstream] = useState<string[]>(initialDownstream);

  const toggle =
    (setter: React.Dispatch<React.SetStateAction<string[]>>) =>
    (id: string) =>
      setter((cur) =>
        cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
      );

  const canSave = name.trim().length > 0;

  return (
    <div
      className="ppea-modal-backdrop open"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="ppea-modal ppea-modal--wide bp5-dark"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ppea-modal__header">
          <div className="ppea-modal__title-wrap">
            <div className="ppea-modal__phase-label">
              {mode === "create" ? "Add task" : "Edit task"}
            </div>
            <div className="ppea-modal__title">{name || "New task"}</div>
          </div>
          <button
            type="button"
            className="ppea-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="ppea-modal__body">
          <div className="ppea-form-grid">
            <label className="ppea-form-field">
              <span className="ppea-form-label">Title</span>
              <input
                className="ppea-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Task title"
              />
            </label>

            <label className="ppea-form-field">
              <span className="ppea-form-label">Phase</span>
              <select
                className="ppea-select"
                value={phase}
                onChange={(e) => setPhase(e.target.value as PhaseId)}
              >
                {PHASE_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PHASE_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>

            <label className="ppea-form-field">
              <span className="ppea-form-label">Short description</span>
              <textarea
                className="ppea-textarea"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="What is this task?"
              />
            </label>

            <div className="ppea-form-field">
              <span className="ppea-form-label">Task owner(s)</span>
              <RoleChips
                roles={roles}
                selected={owner}
                onToggle={toggle(setOwner)}
              />
            </div>

            <div className="ppea-form-field">
              <span className="ppea-form-label">Approver(s)</span>
              <RoleChips
                roles={roles}
                selected={approver}
                onToggle={toggle(setApprover)}
              />
            </div>

            <div className="ppea-form-field">
              <span className="ppea-form-label">Involved</span>
              <RoleChips
                roles={roles}
                selected={involved}
                onToggle={toggle(setInvolved)}
              />
            </div>

            <div className="ppea-form-field">
              <span className="ppea-form-label">
                Feeds <em>from</em> (upstream tasks)
              </span>
              <TaskCheckboxList
                tasks={otherTasks}
                selected={deps}
                onToggle={toggle(setDeps)}
              />
            </div>

            <div className="ppea-form-field">
              <span className="ppea-form-label">
                Feeds <em>into</em> (downstream tasks)
              </span>
              <TaskCheckboxList
                tasks={otherTasks}
                selected={downstream}
                onToggle={toggle(setDownstream)}
              />
            </div>
          </div>
        </div>
        <div className="ppea-modal__footer">
          {mode === "edit" && onDelete && (
            <button
              type="button"
              className="ppea-btn ppea-btn--danger"
              onClick={onDelete}
            >
              Delete task
            </button>
          )}
          <div className="ppea-spacer" />
          <button
            type="button"
            className="ppea-btn ppea-btn--ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ppea-btn ppea-btn--primary"
            disabled={!canSave}
            onClick={() =>
              onSave(
                {
                  id: initial?.id ?? "",
                  phase,
                  name: name.trim(),
                  desc: desc.trim(),
                  owner,
                  approver,
                  involved,
                  deps,
                },
                downstream,
              )
            }
          >
            {mode === "create" ? "Create task" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
};
