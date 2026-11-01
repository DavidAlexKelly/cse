/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
/* eslint-disable jsx-a11y/no-autofocus */
import React, { useEffect, useState } from "react";
import {
  PHASE_COLORS,
  PHASE_LABELS,
  STATUS_COLORS,
  STATUS_LABEL,
  STATUS_ORDER,
  TASK_EVENT_LABEL,
  type PpeaRole,
  type PpeaTask,
  type TaskEvent,
  type TaskEventKind,
  type TaskStatus,
} from "./ppeaData.js";
import {
  canDeleteTask,
  canEditContent,
  canEditTaskDefinition,
  eventRequiresComment,
  getTaskActions,
} from "./ppeaLogic.js";

interface Props {
  task: PpeaTask;
  roles: PpeaRole[];
  content: string;
  status: TaskStatus;
  /** Audit trail of workflow transitions on this task. */
  history: TaskEvent[];
  /** Selected role acting as the current user. Permissions derive from this. */
  actingRoleId: string | null;
  onClose: () => void;
  onContentChange: (content: string) => void;
  /**
   * Apply a workflow transition.  `comment` is mandatory for `return` and
   * `reopen`; the modal enforces this via the comment-prompt dialog before
   * calling back.
   */
  onTransition: (next: TaskStatus, comment?: string) => void;
  /**
   * Observer-only manual status override (skipping the comment prompt and
   * the audit-event recording).  Used by the designer dropdown only.
   */
  onDesignerOverrideStatus: (next: TaskStatus) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

/** Lightweight in-modal prompt shown when an approver Returns or Re-opens. */
interface CommentPrompt {
  next: TaskStatus;
  kind: TaskEventKind;
  title: string;
  blurb: string;
  /** Verb used on the confirm button (e.g. "Return"). */
  confirmLabel: string;
}

export const TaskModal: React.FC<Props> = ({
  task,
  roles,
  content,
  status,
  history,
  actingRoleId,
  onClose,
  onContentChange,
  onTransition,
  onDesignerOverrideStatus,
  onEdit,
  onDelete,
}) => {
  const [draft, setDraft] = useState(content);
  const [savedFlash, setSavedFlash] = useState(false);
  const [prompt, setPrompt] = useState<CommentPrompt | null>(null);
  const [promptDraft, setPromptDraft] = useState("");

  // Keep textarea in sync when task changes
  useEffect(() => {
    setDraft(content);
  }, [content, task.id]);

  // Close on Escape (prompt first, then the whole modal)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (prompt) {
        setPrompt(null);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, prompt]);

  const color = PHASE_COLORS[task.phase];
  const roleById = (id: string): PpeaRole | undefined =>
    roles.find((r) => r.id === id);

  const renderRow = (
    id: string,
    type: "owner" | "approver" | "involved",
  ): React.ReactNode => {
    const r = roleById(id);
    const label =
      type === "owner"
        ? "Task owner"
        : type === "approver"
          ? "Approver"
          : "Involved";
    return (
      <div key={`${type}-${id}`} className="ppea-modal__role-row">
        <span
          className={`ppea-modal__role-type ppea-modal__role-type--${type}`}
        >
          {label}
        </span>
        <span className="ppea-modal__role-name">{r?.name ?? id}</span>
        <span className="ppea-modal__role-sub">{r?.abbr ?? ""}</span>
      </div>
    );
  };

  const flashSaved = () => {
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1500);
  };

  const saveContent = () => {
    onContentChange(draft);
    flashSaved();
  };

  const actions = getTaskActions(task, actingRoleId, status);
  const allowEditContent = canEditContent(task, actingRoleId, status);
  const isObserver = actingRoleId === null;
  const allowEditDefinition = canEditTaskDefinition(actingRoleId);
  const allowDeleteTask = canDeleteTask(actingRoleId);

  const actingRole = actingRoleId ? roleById(actingRoleId) : null;
  const actingRel =
    actingRoleId &&
    (task.owner.includes(actingRoleId)
      ? "owner"
      : task.approver.includes(actingRoleId)
        ? "approver"
        : task.involved.includes(actingRoleId)
          ? "involved"
          : null);

  /** Human-readable explanation of what the acting role can do right now. */
  const permissionExplanation = (): string => {
    if (isObserver) {
      return "Observer / Designer view — you can edit task definitions but cannot drive workflow.";
    }
    if (!actingRel) {
      return "You have no role on this task. View only.";
    }
    if (actingRel === "owner") {
      if (status === "not_started")
        return "Owner — you can start work and write content.";
      if (status === "in_progress")
        return "Owner — you can write content and submit for review.";
      if (status === "ready_for_review")
        return "Owner — submitted. Awaiting approver.";
      return "Owner — task approved. Locked.";
    }
    if (actingRel === "approver") {
      if (status === "not_started")
        return "Approver — waiting for the owner to start.";
      if (status === "in_progress")
        return "Approver — waiting for the owner to submit.";
      if (status === "ready_for_review")
        return "Approver — review the content, then Approve or Return.";
      return "Approver — task approved. You may Re-open if rework is needed.";
    }
    // involved
    if (status === "in_progress")
      return "Involved — you can contribute to the content.";
    if (status === "ready_for_review")
      return "Involved — under review. Read-only.";
    if (status === "approved") return "Involved — approved. Locked.";
    return "Involved — not yet started. Read-only.";
  };

  // ── Workflow button helpers ──────────────────────────────────────────────

  /** For transitions that need an explanation (return / reopen), open the
   *  comment prompt.  For all others, fire the transition directly. */
  const handleTransition = (next: TaskStatus, kind: TaskEventKind) => {
    if (eventRequiresComment(kind)) {
      setPromptDraft("");
      setPrompt({
        next,
        kind,
        title:
          kind === "return" ? "Return for rework" : "Re-open approved task",
        blurb:
          kind === "return"
            ? "Tell the owner what needs to change. This comment is required and will be visible to everyone with access to the task."
            : "Explain why this approved task is being pulled back into work. This comment is required and will be visible to everyone.",
        confirmLabel: kind === "return" ? "Return" : "Re-open",
      });
    } else {
      onTransition(next);
    }
  };

  const submitPrompt = () => {
    if (!prompt) return;
    const trimmed = promptDraft.trim();
    if (!trimmed) return; // confirm button is disabled in this case anyway
    onTransition(prompt.next, trimmed);
    setPrompt(null);
  };

  // ── History rendering ────────────────────────────────────────────────────

  const renderHistoryEvent = (ev: TaskEvent): React.ReactNode => {
    const author = ev.roleId
      ? (roleById(ev.roleId)?.abbr ?? ev.roleId)
      : "Observer";
    const date = new Date(ev.timestamp);
    const dateStr = isNaN(date.getTime())
      ? ev.timestamp
      : `${date.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "2-digit",
        })} ${date.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
    const cls = `ppea-history__row ppea-history__row--${ev.kind}`;
    return (
      <div key={ev.id} className={cls}>
        <div className="ppea-history__head">
          <span
            className={`ppea-history__kind ppea-history__kind--${ev.kind}`}
          >
            {TASK_EVENT_LABEL[ev.kind]}
          </span>
          <span className="ppea-history__author">by {author}</span>
          <span className="ppea-history__date">{dateStr}</span>
        </div>
        {ev.comment && (
          <div className="ppea-history__comment">{ev.comment}</div>
        )}
      </div>
    );
  };

  return (
    <div
      className="ppea-modal-backdrop open"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="ppea-modal bp5-dark"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="ppea-modal__header">
          <span
            className="ppea-modal__pip"
            style={{ background: color.accent }}
          />
          <div className="ppea-modal__title-wrap">
            <div
              className="ppea-modal__phase-label"
              style={{ color: color.accent }}
            >
              {PHASE_LABELS[task.phase]}
            </div>
            <div className="ppea-modal__title">{task.name}</div>
          </div>
          <div className="ppea-modal__status-pill-wrap">
            <span
              className="ppea-modal__status-pill"
              style={{
                background: `${STATUS_COLORS[status]}33`,
                color: STATUS_COLORS[status],
                borderColor: `${STATUS_COLORS[status]}66`,
              }}
            >
              {STATUS_LABEL[status]}
            </span>
          </div>
          <button
            className="ppea-modal__close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="ppea-modal__body">
          {/* Description */}
          <div className="ppea-modal__section-label">Description</div>
          <p className="ppea-modal__desc">{task.desc || "—"}</p>

          {/* Roles involved */}
          <div className="ppea-modal__section-label">Roles involved</div>
          <div className="ppea-modal__role-rows">
            {task.owner.map((id) => renderRow(id, "owner"))}
            {task.approver.map((id) => renderRow(id, "approver"))}
            {task.involved.map((id) => renderRow(id, "involved"))}
            {task.owner.length +
              task.approver.length +
              task.involved.length ===
              0 && (
              <div className="ppea-empty-line">
                No roles assigned to this task yet.
              </div>
            )}
          </div>

          {/* Operation details */}
          <div className="ppea-modal__section-label">
            Operation details
            {!allowEditContent && (
              <span className="ppea-modal__readonly-tag">Read-only</span>
            )}
          </div>
          <textarea
            className={`ppea-bp-textarea ${!allowEditContent ? "readonly" : ""}`}
            placeholder={
              allowEditContent
                ? "Operation-specific details for this task (scenario notes, decisions, products produced …)"
                : "No content yet."
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            readOnly={!allowEditContent}
          />

          {/* Workflow actions */}
          <div className="ppea-modal__status-row">
            <div className="ppea-modal__status-actions">
              {actions.canStart && (
                <button
                  type="button"
                  className="ppea-btn ppea-btn--primary"
                  onClick={() => handleTransition("in_progress", "start")}
                  title="Move to In progress"
                >
                  Start work
                </button>
              )}
              {actions.canSubmit && (
                <button
                  type="button"
                  className="ppea-btn ppea-btn--primary"
                  onClick={() =>
                    handleTransition("ready_for_review", "submit")
                  }
                  title="Send to approver for review"
                >
                  Submit for review
                </button>
              )}
              {actions.canReturn && (
                <button
                  type="button"
                  className="ppea-btn ppea-btn--ghost"
                  onClick={() => handleTransition("in_progress", "return")}
                  title="Send back to the owner for rework (requires a comment)"
                >
                  Return for rework
                </button>
              )}
              {actions.canApprove && (
                <button
                  type="button"
                  className="ppea-btn ppea-btn--primary"
                  onClick={() => handleTransition("approved", "approve")}
                  title="Approve this task"
                >
                  Approve
                </button>
              )}
              {actions.canReopen && (
                <button
                  type="button"
                  className="ppea-btn ppea-btn--ghost"
                  onClick={() => handleTransition("in_progress", "reopen")}
                  title="Re-open this approved task back into In progress (requires a comment)"
                >
                  Re-open
                </button>
              )}
              {allowEditContent && (
                <button
                  type="button"
                  className="ppea-btn ppea-btn--default"
                  onClick={saveContent}
                >
                  Save details
                </button>
              )}
              <span
                className={`ppea-bp-saved-msg ${savedFlash ? "show" : ""}`}
              >
                Saved ✓
              </span>
            </div>
          </div>

          {/* Observer-only manual override */}
          {isObserver && (
            <div className="ppea-modal__designer-override">
              <label className="ppea-form-label" htmlFor="ppea-status-sel">
                Designer override · Status
              </label>
              <select
                id="ppea-status-sel"
                className="ppea-select"
                value={status}
                onChange={(e) =>
                  onDesignerOverrideStatus(e.target.value as TaskStatus)
                }
                title="Observer / designer can set any status to rehearse the flow (no audit event recorded)"
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <span className="ppea-modal__designer-hint">
                Available because no role is selected. Pick a role above to
                use the regular workflow. Designer overrides bypass the
                audit log.
              </span>
            </div>
          )}

          {/* History */}
          <div className="ppea-modal__section-label">
            History
            <span className="ppea-modal__count-tag">{history.length}</span>
          </div>
          {history.length === 0 ? (
            <div className="ppea-empty-line">No transitions yet.</div>
          ) : (
            <div className="ppea-history">
              {[...history].reverse().map(renderHistoryEvent)}
            </div>
          )}

          {/* Acting-as hint */}
          <div className="ppea-modal__acting-hint">
            {actingRole ? (
              <>
                Acting as <strong>{actingRole.abbr}</strong> ·{" "}
                {actingRel ?? "no role on this task"} —{" "}
                {permissionExplanation()}
              </>
            ) : (
              <>
                <strong>Observer</strong> · {permissionExplanation()}
              </>
            )}
          </div>
        </div>
        <div className="ppea-modal__footer">
          {onDelete && allowDeleteTask && (
            <button
              type="button"
              className="ppea-btn ppea-btn--danger"
              onClick={onDelete}
              title="Delete this task (Observer / Designer only)"
            >
              Delete task
            </button>
          )}
          <div className="ppea-spacer" />
          {onEdit && allowEditDefinition && (
            <button
              type="button"
              className="ppea-btn ppea-btn--default"
              onClick={onEdit}
              title="Edit task definition (Observer / Designer only)"
            >
              Edit task
            </button>
          )}
          <button
            type="button"
            className="ppea-btn ppea-btn--ghost"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {/* ── Inline comment prompt (Return / Re-open) ────────────────── */}
        {prompt && (
          <div
            className="ppea-modal__prompt-backdrop"
            onClick={() => setPrompt(null)}
            role="presentation"
          >
            <div
              className="ppea-modal__prompt"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="ppea-modal__prompt-title">{prompt.title}</div>
              <p className="ppea-modal__prompt-blurb">{prompt.blurb}</p>
              <label className="ppea-form-label" htmlFor="ppea-prompt-text">
                Comment <span style={{ color: "#ef4d4d" }}>*</span>
              </label>
              <textarea
                id="ppea-prompt-text"
                className="ppea-textarea"
                value={promptDraft}
                autoFocus
                onChange={(e) => setPromptDraft(e.target.value)}
                placeholder={
                  prompt.kind === "return"
                    ? "e.g. PMESII Infrastructure pillar needs more detail — see section 3."
                    : "e.g. Updated TA composition requires revised ORBAT mapping."
                }
              />
              <div className="ppea-modal__prompt-actions">
                <button
                  type="button"
                  className="ppea-btn ppea-btn--ghost"
                  onClick={() => setPrompt(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ppea-btn ppea-btn--primary"
                  onClick={submitPrompt}
                  disabled={promptDraft.trim() === ""}
                  title={
                    promptDraft.trim() === ""
                      ? "A comment is required"
                      : `Confirm ${prompt.confirmLabel.toLowerCase()}`
                  }
                >
                  {prompt.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
