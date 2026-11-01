import React, { useCallback, useMemo, useState } from "react";
import "../shared/styling/index.css";
import "./ppea.css";
import { Blueprint } from "./Blueprint.js";
import {
  DEFAULT_OPERATION_ID,
  OPERATIONS,
  PHASE_ORDER,
  SEED_IRON_FORGE_OVERLAY,
  SEED_ROLES,
  SEED_TASKS,
  STATUS_COLORS,
  STATUS_LABEL,
  type OperationOverlay,
  type PhaseId,
  type PpeaRole,
  type PpeaTask,
  type TaskStatus,
  isInTask,
  roleTypeFor,
} from "./ppeaData.js";
import {
  addRole,
  addTask,
  appendTaskEvent,
  canAddTask,
  canManageRoles,
  deleteRole as deleteRoleHelper,
  deleteTask as deleteTaskHelper,
  getTaskActions,
  getTaskContent,
  getTaskHistory,
  getTaskStatus,
  newRoleId,
  newTaskId,
  setTaskOverlay,
  statusTransitionToEvent,
  updateRole,
  updateTask,
} from "./ppeaLogic.js";
import { RoleEditModal } from "./RoleEditModal.js";
import { TaskEditModal } from "./TaskEditModal.js";
import { TaskModal } from "./TaskModal.js";

type TabId = PhaseId | "all" | "blueprint";

const TABS: { id: TabId; label: string }[] = [
  { id: "all",       label: "All phases" },
  { id: "plan",      label: "Plan" },
  { id: "prepare",   label: "Prepare" },
  { id: "execute",   label: "Execute" },
  { id: "assess",    label: "Assess" },
  { id: "blueprint", label: "Blueprint" },
];

export const Ppea: React.FC = () => {
  // ── Roles / tasks (shared across operations) ────────────────────────────
  const [roles, setRoles] = useState<PpeaRole[]>(SEED_ROLES);
  const [tasks, setTasks] = useState<PpeaTask[]>(SEED_TASKS);

  // ── Per-operation overlay
  //   IRON FORGE 26 is pre-populated from seed.  Other operations stay
  //   intentionally empty so the user can see the contrast.
  const [overlays, setOverlays] = useState<Record<string, OperationOverlay>>(
    () => ({ [DEFAULT_OPERATION_ID]: SEED_IRON_FORGE_OVERLAY }),
  );

  // ── Active selections ───────────────────────────────────────────────────
  const [operationId, setOperationId] = useState<string>(DEFAULT_OPERATION_ID);
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("all");

  // ── Modal state ─────────────────────────────────────────────────────────
  const [openTaskModal, setOpenTaskModal] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<
    | { mode: "create" }
    | { mode: "edit"; roleId: string }
    | null
  >(null);
  const [editingTask, setEditingTask] = useState<
    | { mode: "create"; phase: PhaseId }
    | { mode: "edit"; taskId: string }
    | null
  >(null);

  const isBlueprint = activeTab === "blueprint";

  // Memoised so dependent hooks (e.g. `actionablePerTask`) don't re-run on
  // every render — `{}` fallback would otherwise be a new object each time.
  const overlay: OperationOverlay = useMemo(
    () => overlays[operationId] ?? {},
    [overlays, operationId],
  );

  // ── Visible phases ──────────────────────────────────────────────────────
  const visPhases = useMemo<PhaseId[]>(() => {
    if (activeTab === "all" || activeTab === "blueprint") {
      return PHASE_ORDER;
    }
    return [activeTab];
  }, [activeTab]);

  const tasksByPhase = useMemo(() => {
    const m: Record<PhaseId, PpeaTask[]> = {
      plan: [],
      prepare: [],
      execute: [],
      assess: [],
    };
    for (const t of tasks) m[t.phase].push(t);
    return m;
  }, [tasks]);

  // Tasks relevant to the currently visible phases (used for "faded" role)
  const visibleTasks = useMemo(() => {
    if (activeTab === "all" || activeTab === "blueprint") return tasks;
    return tasks.filter((t) => t.phase === activeTab);
  }, [activeTab, tasks]);

  // ── Mutation handlers (delegate to pure helpers) ─────────────────────────
  const upsertRole = useCallback((role: PpeaRole) => {
    setRoles((cur) =>
      cur.some((r) => r.id === role.id)
        ? updateRole(cur, role.id, role)
        : addRole(cur, role),
    );
  }, []);

  const removeRole = useCallback(
    (id: string) => {
      setRoles((curRoles) => {
        const next = deleteRoleHelper(curRoles, tasks, id);
        setTasks(next.tasks);
        return next.roles;
      });
      if (activeRole === id) setActiveRole(null);
    },
    [activeRole, tasks],
  );

  const upsertTask = useCallback(
    (task: PpeaTask, newDownstreamIds: string[]) => {
      setTasks((cur) => {
        const has = cur.some((t) => t.id === task.id);
        let next = has ? updateTask(cur, task.id, task) : addTask(cur, task);
        next = next.map((t) => {
          if (t.id === task.id) return t;
          const wantsIt = newDownstreamIds.includes(t.id);
          const hasIt = t.deps.includes(task.id);
          if (wantsIt && !hasIt) {
            return { ...t, deps: [...t.deps, task.id] };
          }
          if (!wantsIt && hasIt) {
            return { ...t, deps: t.deps.filter((d) => d !== task.id) };
          }
          return t;
        });
        return next;
      });
    },
    [],
  );

  const removeTask = useCallback((id: string) => {
    setTasks((cur) => deleteTaskHelper(cur, id));
    setOverlays((cur) => {
      const out: Record<string, OperationOverlay> = {};
      for (const [opId, ov] of Object.entries(cur)) {
        if (id in ov) {
          const next: OperationOverlay = { ...ov };
          delete next[id];
          out[opId] = next;
        } else {
          out[opId] = ov;
        }
      }
      return out;
    });
  }, []);

  const setOverlayFor = useCallback(
    (
      taskId: string,
      patch: { content?: string; status?: TaskStatus },
    ) => {
      setOverlays((cur) => {
        const prev = cur[operationId] ?? {};
        return {
          ...cur,
          [operationId]: setTaskOverlay(prev, taskId, patch),
        };
      });
    },
    [operationId],
  );

  /**
   * Apply a workflow transition: persist the new status AND append an
   * audit event so the task history reflects who did what (and why, for
   * return/reopen which require a comment).
   *
   * Owners' start/submit and approvers' approve transitions can pass
   * `comment === undefined`; the appended event simply has no comment.
   * Comments are mandatory in the UI for return/reopen.
   */
  const applyTransition = useCallback(
    (
      taskId: string,
      nextStatus: TaskStatus,
      comment?: string,
    ) => {
      setOverlays((cur) => {
        const prev = cur[operationId] ?? {};
        const prevStatus = prev[taskId]?.status ?? "not_started";
        const kind = statusTransitionToEvent(prevStatus, nextStatus);
        let nextOverlay = setTaskOverlay(prev, taskId, { status: nextStatus });
        if (kind) {
          nextOverlay = appendTaskEvent(nextOverlay, taskId, {
            kind,
            roleId: activeRole,
            comment,
          });
        }
        return { ...cur, [operationId]: nextOverlay };
      });
    },
    [activeRole, operationId],
  );

  // ── Role toggle (also acts as the "log in as" simulator) ────────────────
  const toggleRole = (id: string) => {
    setActiveRole((cur) => (cur === id ? null : id));
  };

  const selectedRole = activeRole
    ? roles.find((r) => r.id === activeRole) ?? null
    : null;

  const roleStats = useMemo(() => {
    if (!activeRole) return null;
    return {
      owned: tasks.filter((t) => t.owner.includes(activeRole)).length,
      approvals: tasks.filter((t) => t.approver.includes(activeRole)).length,
      involved: tasks.filter((t) => t.involved.includes(activeRole)).length,
      total: tasks.filter((t) => isInTask(t, activeRole)).length,
    };
  }, [activeRole, tasks]);

  /** Tasks where the acting role currently has a *pending* action — i.e.
   *  the workflow is actively waiting on them (start / submit / approve).
   *  Re-opening an already-approved task is a capability, not pending
   *  work, so approved tasks do not light up.  This is what drives the
   *  "ACTION" tag on each row and the count in the hint bar. */
  const actionablePerTask = useMemo(() => {
    const out: Record<string, boolean> = {};
    if (!activeRole) return out;
    for (const t of tasks) {
      const st = getTaskStatus(overlay, t.id);
      out[t.id] = getTaskActions(t, activeRole, st).hasPendingAction;
    }
    return out;
  }, [activeRole, tasks, overlay]);

  const pendingActionCount = useMemo(() => {
    return Object.values(actionablePerTask).filter(Boolean).length;
  }, [actionablePerTask]);

  const renderHint = (): React.ReactNode => {
    if (!selectedRole) {
      return (
        <>
          <strong>Observer / Designer</strong> — pick a role to drive workflow.
          You can add or edit roles and tasks while in this mode.
        </>
      );
    }
    const total = roleStats?.total ?? 0;
    return (
      <>
        Acting as{" "}
        <strong>
          {selectedRole.name} ({selectedRole.abbr})
        </strong>{" "}
        — {total} task{total === 1 ? "" : "s"} ·{" "}
        {pendingActionCount > 0 ? (
          <strong>{pendingActionCount} awaiting your action</strong>
        ) : (
          <span>nothing awaiting you right now</span>
        )}
        .
      </>
    );
  };

  const allowAddTask = canAddTask(activeRole);
  const allowManageRoles = canManageRoles(activeRole);

  const taskForModal = openTaskModal
    ? tasks.find((t) => t.id === openTaskModal) ?? null
    : null;

  const taskBeingEdited =
    editingTask?.mode === "edit"
      ? tasks.find((t) => t.id === editingTask.taskId) ?? null
      : null;
  const roleBeingEdited =
    editingRole?.mode === "edit"
      ? roles.find((r) => r.id === editingRole.roleId) ?? null
      : null;

  return (
    <div className="ppea-root bp5-dark">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="ppea-header">
        <div>
          <span className="ppea-eyebrow">NATO Computer-Assisted Exercise</span>
          <h1 className="ppea-title">PPEA Role Map</h1>
          <p className="ppea-subtitle">
            Pick an operation and a role to act as — then drive tasks through
            the workflow.
          </p>
        </div>
        <div className="ppea-header-controls">
          <label className="ppea-select-field">
            <span className="ppea-select-field__label">Operation</span>
            <select
              className="ppea-select"
              value={operationId}
              onChange={(e) => {
                const id = e.target.value;
                setOperationId(id);
                setOverlays((cur) =>
                  id in cur ? cur : { ...cur, [id]: {} },
                );
              }}
            >
              {OPERATIONS.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.shortName}
                </option>
              ))}
            </select>
          </label>
          {!isBlueprint && (
            <div className="ppea-legend">
              <span className="ppea-legend__label">Status</span>
              <span className="ppea-leg">
                <span
                  className="ppea-leg__bar"
                  style={{ background: STATUS_COLORS.not_started, opacity: 0.55 }}
                />
                Not started
              </span>
              <span className="ppea-leg">
                <span
                  className="ppea-leg__bar"
                  style={{ background: STATUS_COLORS.in_progress }}
                />
                In progress
              </span>
              <span className="ppea-leg">
                <span
                  className="ppea-leg__bar"
                  style={{ background: STATUS_COLORS.ready_for_review }}
                />
                Ready for review
              </span>
              <span className="ppea-leg">
                <span
                  className="ppea-leg__bar"
                  style={{ background: STATUS_COLORS.approved }}
                />
                Approved
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ── Phase tabs ─────────────────────────────────────────────────── */}
      <nav className="ppea-phase-bar">
        {TABS.map((tab) => {
          const showSep = tab.id === "blueprint";
          return (
            <React.Fragment key={tab.id}>
              {showSep && <div className="ppea-phase-tab-sep" />}
              <button
                type="button"
                className={`ppea-phase-tab ${activeTab === tab.id ? "active" : ""}`}
                data-phase={tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {/* ── Main grid ──────────────────────────────────────────────────── */}
      <div className={`ppea-main ${isBlueprint ? "ppea-main--blueprint" : ""}`}>
        {!isBlueprint && (
          <aside className="ppea-sidebar">
            <div className="ppea-sidebar__top">
              <label className="ppea-select-field">
                <span className="ppea-select-field__label">Acting as</span>
                <select
                  className="ppea-select"
                  value={activeRole ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setActiveRole(v === "" ? null : v);
                  }}
                >
                  <option value="">— Observer —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.abbr} — {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ppea-sidebar__header">
              <span className="ppea-sidebar__label">Roles</span>
              {allowManageRoles && (
                <button
                  type="button"
                  className="ppea-icon-btn"
                  title="Add role (Observer / Designer only)"
                  onClick={() => setEditingRole({ mode: "create" })}
                >
                  +
                </button>
              )}
            </div>
            <div className="ppea-role-list">
              {roles.map((r) => {
                const relevant = visibleTasks.some((t) => isInTask(t, r.id));
                const faded = activeTab !== "all" && !relevant;
                const act = activeRole === r.id;
                return (
                  <div
                    key={r.id}
                    className={`ppea-role-row ${act ? "active" : ""} ${faded ? "faded" : ""}`}
                  >
                    <button
                      type="button"
                      className="ppea-role-btn"
                      onClick={() => toggleRole(r.id)}
                    >
                      <span className="ppea-role-btn__abbr">{r.abbr}</span>
                      <span className="ppea-role-btn__name">{r.name}</span>
                      <span className="ppea-role-btn__sub">{r.sub}</span>
                    </button>
                    {allowManageRoles && (
                      <button
                        type="button"
                        className="ppea-role-edit"
                        title="Edit role (Observer / Designer only)"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingRole({ mode: "edit", roleId: r.id });
                        }}
                      >
                        ✎
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        <div className="ppea-right">
          {/* Selected role detail */}
          {!isBlueprint && selectedRole && roleStats && (
            <div className="ppea-role-detail">
              <div className="ppea-role-detail__head">
                <div className="ppea-role-detail__abbr">
                  {selectedRole.abbr}
                </div>
                <div className="ppea-role-detail__name">
                  {selectedRole.name}
                </div>
                <div className="ppea-role-detail__sub">{selectedRole.sub}</div>
              </div>
              <div className="ppea-role-detail__body">
                <p className="ppea-role-detail__desc">{selectedRole.desc}</p>
                <div className="ppea-role-detail__stats">
                  {roleStats.owned > 0 && (
                    <span className="ppea-stat-chip ppea-stat-chip--owner">
                      {roleStats.owned} owned
                    </span>
                  )}
                  {roleStats.approvals > 0 && (
                    <span className="ppea-stat-chip ppea-stat-chip--approver">
                      {roleStats.approvals} approvals
                    </span>
                  )}
                  {roleStats.involved > 0 && (
                    <span className="ppea-stat-chip ppea-stat-chip--involved">
                      {roleStats.involved} involved
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Task lists per phase */}
          {!isBlueprint && (
            <div className="ppea-task-area">
              {visPhases.map((phaseId) => {
                const phaseTasks = tasksByPhase[phaseId];
                return (
                  <div key={phaseId} className="ppea-phase-block">
                    <div className="ppea-phase-head" data-phase={phaseId}>
                      <span className="ppea-phase-name">
                        {phaseId.toUpperCase()}
                      </span>
                      <span className="ppea-phase-count">
                        {phaseTasks.length} task
                        {phaseTasks.length === 1 ? "" : "s"}
                      </span>
                      {allowAddTask && (
                        <button
                          type="button"
                          className="ppea-icon-btn ppea-icon-btn--inline"
                          title="Add task to this phase (Observer / Designer only)"
                          onClick={() =>
                            setEditingTask({ mode: "create", phase: phaseId })
                          }
                        >
                          + Add task
                        </button>
                      )}
                    </div>
                    {phaseTasks.length > 0 && (
                      <div className="ppea-task-colhead">
                        <span className="ppea-task-colhead__status">
                          Status
                        </span>
                        <span className="ppea-task-colhead__name">Task</span>
                        <span className="ppea-task-colhead__badges">
                          <span className="ppea-task-colhead__legend">
                            <span className="ppea-task-colhead__leg ppea-task-colhead__leg--owner">
                              Owner
                            </span>
                            <span className="ppea-task-colhead__leg ppea-task-colhead__leg--approver">
                              Approver
                            </span>
                            <span className="ppea-task-colhead__leg ppea-task-colhead__leg--involved">
                              Involved
                            </span>
                          </span>
                        </span>
                        <span className="ppea-task-colhead__info" />
                      </div>
                    )}
                    <div className="ppea-task-list">
                      {phaseTasks.map((t) => {
                        const rel = activeRole
                          ? roleTypeFor(t, activeRole)
                          : null;
                        const actionable = !!actionablePerTask[t.id];
                        const cls = activeRole
                          ? rel
                            ? `ppea-task-row highlight-${rel}${actionable ? " action-required" : ""}`
                            : "ppea-task-row dim"
                          : "ppea-task-row";
                        const status = getTaskStatus(overlay, t.id);
                        return (
                          <div
                            key={t.id}
                            className={cls}
                            onClick={() => setOpenTaskModal(t.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setOpenTaskModal(t.id);
                              }
                            }}
                          >
                            <span className="ppea-task-status-col">
                              <span
                                className="ppea-task-status-dot"
                                style={{ background: STATUS_COLORS[status] }}
                                title={STATUS_LABEL[status]}
                              />
                            </span>
                            <span className="ppea-task-name">
                              {t.name}
                              {actionable && (
                                <span
                                  className="ppea-task-action-tag"
                                  title="Action available for the role you're acting as"
                                >
                                  ACTION
                                </span>
                              )}
                            </span>
                            <span className="ppea-badges">
                              {t.owner.map((id) => (
                                <button
                                  key={`o-${id}`}
                                  type="button"
                                  className="ppea-badge ppea-badge--owner"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleRole(id);
                                  }}
                                >
                                  {roles.find((r) => r.id === id)?.abbr ?? id}
                                </button>
                              ))}
                              {t.approver.map((id) => (
                                <button
                                  key={`a-${id}`}
                                  type="button"
                                  className="ppea-badge ppea-badge--approver"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleRole(id);
                                  }}
                                >
                                  {roles.find((r) => r.id === id)?.abbr ?? id}
                                </button>
                              ))}
                              {t.involved.map((id) => (
                                <button
                                  key={`i-${id}`}
                                  type="button"
                                  className="ppea-badge ppea-badge--involved"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleRole(id);
                                  }}
                                >
                                  {roles.find((r) => r.id === id)?.abbr ?? id}
                                </button>
                              ))}
                            </span>
                            <span
                              className="ppea-task-info"
                              title="View task details"
                            >
                              ⓘ
                            </span>
                          </div>
                        );
                      })}
                      {phaseTasks.length === 0 && (
                        <div className="ppea-empty-line">
                          No tasks in this phase yet.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Blueprint view */}
          {isBlueprint && (
            <Blueprint
              tasks={tasks}
              roles={roles}
              overlay={overlay}
              activeOperationId={operationId}
              onOpenTask={(id) => setOpenTaskModal(id)}
              onContentChange={(id, content) =>
                setOverlayFor(id, { content })
              }
            />
          )}
        </div>
      </div>

      {/* Hint bar */}
      {!isBlueprint && <div className="ppea-hintbar">{renderHint()}</div>}

      {/* ── Task detail modal ─────────────────────────────────────────── */}
      {taskForModal && (
        <TaskModal
          task={taskForModal}
          roles={roles}
          content={getTaskContent(overlay, taskForModal.id)}
          status={getTaskStatus(overlay, taskForModal.id)}
          history={getTaskHistory(overlay, taskForModal.id)}
          actingRoleId={activeRole}
          onClose={() => setOpenTaskModal(null)}
          onContentChange={(content) =>
            setOverlayFor(taskForModal.id, { content })
          }
          onTransition={(status, comment) =>
            applyTransition(taskForModal.id, status, comment)
          }
          onDesignerOverrideStatus={(status) =>
            setOverlayFor(taskForModal.id, { status })
          }
          onEdit={() => {
            setEditingTask({ mode: "edit", taskId: taskForModal.id });
            setOpenTaskModal(null);
          }}
          onDelete={() => {
            removeTask(taskForModal.id);
            setOpenTaskModal(null);
          }}
        />
      )}

      {/* ── Role edit modal ───────────────────────────────────────────── */}
      {editingRole && (
        <RoleEditModal
          mode={editingRole.mode}
          initial={roleBeingEdited}
          onClose={() => setEditingRole(null)}
          onSave={(role) => {
            const id = role.id || newRoleId();
            upsertRole({ ...role, id });
            setEditingRole(null);
          }}
          onDelete={
            editingRole.mode === "edit"
              ? () => {
                  if (roleBeingEdited) removeRole(roleBeingEdited.id);
                  setEditingRole(null);
                }
              : undefined
          }
        />
      )}

      {/* ── Task edit modal ───────────────────────────────────────────── */}
      {editingTask && (
        <TaskEditModal
          mode={editingTask.mode}
          roles={roles}
          otherTasks={
            editingTask.mode === "edit"
              ? tasks.filter((t) => t.id !== editingTask.taskId)
              : tasks
          }
          initial={
            editingTask.mode === "edit"
              ? taskBeingEdited
              : { phase: editingTask.phase }
          }
          initialDownstream={
            editingTask.mode === "edit" && taskBeingEdited
              ? tasks
                  .filter((t) => t.deps.includes(taskBeingEdited.id))
                  .map((t) => t.id)
              : []
          }
          onClose={() => setEditingTask(null)}
          onSave={(task, newDownstream) => {
            const id = task.id || newTaskId();
            upsertTask({ ...task, id }, newDownstream);
            setEditingTask(null);
          }}
          onDelete={
            editingTask.mode === "edit"
              ? () => {
                  if (taskBeingEdited) removeTask(taskBeingEdited.id);
                  setEditingTask(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
};
