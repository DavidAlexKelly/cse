// ── PPEA — Pure logic helpers ──────────────────────────────────────────────
// Pure, dependency-free functions used both by the React UI and by unit
// tests.  All state mutation in the UI flows through these helpers, so the
// add/edit/delete/approve/relayout behaviour can be tested in isolation.

import {
  PHASE_ORDER,
  SEED_BP_COORDS,
  type BpNode,
  type OperationOverlay,
  type PhaseId,
  type PpeaRole,
  type PpeaTask,
  type TaskEvent,
  type TaskEventKind,
  type TaskStatus,
} from "./ppeaData.js";

// ── Role mutations ─────────────────────────────────────────────────────────

let roleSeq = 0;
export function newRoleId(prefix = "role"): string {
  roleSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${roleSeq}`;
}

let taskSeq = 0;
export function newTaskId(prefix = "task"): string {
  taskSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${taskSeq}`;
}

export function addRole(roles: PpeaRole[], role: PpeaRole): PpeaRole[] {
  if (roles.some((r) => r.id === role.id)) {
    return roles.map((r) => (r.id === role.id ? role : r));
  }
  return [...roles, role];
}

export function updateRole(
  roles: PpeaRole[],
  id: string,
  patch: Partial<PpeaRole>
): PpeaRole[] {
  return roles.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/**
 * Removes a role and scrubs any references to it from every task's
 * owner/approver/involved arrays.
 */
export function deleteRole(
  roles: PpeaRole[],
  tasks: PpeaTask[],
  id: string
): { roles: PpeaRole[]; tasks: PpeaTask[] } {
  return {
    roles: roles.filter((r) => r.id !== id),
    tasks: tasks.map((t) => ({
      ...t,
      owner: t.owner.filter((x) => x !== id),
      approver: t.approver.filter((x) => x !== id),
      involved: t.involved.filter((x) => x !== id),
    })),
  };
}

// ── Task mutations ─────────────────────────────────────────────────────────

export function addTask(tasks: PpeaTask[], task: PpeaTask): PpeaTask[] {
  if (tasks.some((t) => t.id === task.id)) {
    return tasks.map((t) => (t.id === task.id ? task : t));
  }
  return [...tasks, task];
}

export function updateTask(
  tasks: PpeaTask[],
  id: string,
  patch: Partial<PpeaTask>
): PpeaTask[] {
  return tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

/**
 * Removes a task and scrubs any references to it from every other task's
 * `deps` array.
 */
export function deleteTask(tasks: PpeaTask[], id: string): PpeaTask[] {
  return tasks
    .filter((t) => t.id !== id)
    .map((t) => ({ ...t, deps: t.deps.filter((d) => d !== id) }));
}

// ── Per-operation overlay ──────────────────────────────────────────────────

export function getTaskStatus(
  overlay: OperationOverlay | undefined,
  taskId: string
): TaskStatus {
  return overlay?.[taskId]?.status ?? "not_started";
}

export function getTaskContent(
  overlay: OperationOverlay | undefined,
  taskId: string
): string {
  return overlay?.[taskId]?.content ?? "";
}

export function setTaskOverlay(
  overlay: OperationOverlay,
  taskId: string,
  patch: { content?: string; status?: TaskStatus }
): OperationOverlay {
  const prev = overlay[taskId] ?? {
    content: "",
    status: "not_started" as TaskStatus,
  };
  const next = {
    ...prev,
    content: patch.content ?? prev.content,
    status: patch.status ?? prev.status,
  };
  return { ...overlay, [taskId]: next };
}

// ── Task event history ─────────────────────────────────────────────────────

/** Returns the chronological list of events on this task (oldest → newest). */
export function getTaskHistory(
  overlay: OperationOverlay | undefined,
  taskId: string
): TaskEvent[] {
  return overlay?.[taskId]?.history ?? [];
}

let eventSeq = 0;
export function newEventId(): string {
  eventSeq += 1;
  return `evt_${Date.now().toString(36)}_${eventSeq}`;
}

/**
 * Append a new event to a task's history.  Pure — returns a fresh overlay.
 */
export function appendTaskEvent(
  overlay: OperationOverlay,
  taskId: string,
  event: {
    kind: TaskEventKind;
    roleId: string | null;
    comment?: string;
    /** Override timestamp (defaults to now).  Used for tests / seed data. */
    timestamp?: string;
  }
): OperationOverlay {
  const prev = overlay[taskId] ?? {
    content: "",
    status: "not_started" as TaskStatus,
  };
  const ev: TaskEvent = {
    id: newEventId(),
    kind: event.kind,
    roleId: event.roleId,
    timestamp: event.timestamp ?? new Date().toISOString(),
    ...(event.comment != null && event.comment.trim() !== ""
      ? { comment: event.comment.trim() }
      : {}),
  };
  return {
    ...overlay,
    [taskId]: { ...prev, history: [...(prev.history ?? []), ev] },
  };
}

/**
 * Maps a target `TaskStatus` (when arrived at via a workflow button) to the
 * `TaskEventKind` that produced it.  Returns null if the transition is not
 * a known workflow event (e.g. the Observer manual-override dropdown
 * jumping multiple steps).
 */
export function statusTransitionToEvent(
  prev: TaskStatus,
  next: TaskStatus
): TaskEventKind | null {
  if (prev === next) return null;
  if (prev === "not_started" && next === "in_progress") return "start";
  if (prev === "in_progress" && next === "ready_for_review") return "submit";
  if (prev === "ready_for_review" && next === "approved") return "approve";
  if (prev === "ready_for_review" && next === "in_progress") return "return";
  if (prev === "approved" && next === "in_progress") return "reopen";
  return null;
}

/** Comments are mandatory when an approver returns or re-opens a task. */
export function eventRequiresComment(kind: TaskEventKind): boolean {
  return kind === "return" || kind === "reopen";
}

// ── Permission model ───────────────────────────────────────────────────────
//
// Two distinct planes of authority:
//
//   1. **Workflow transitions** (start / submit / return / approve / reopen)
//      and **operation-content editing** are driven by per-task role
//      assignments (owner / approver / involved).
//
//   2. **Structural edits** (add/edit/delete roles, add/edit/delete task
//      definitions) are "designer" actions: only available when no role is
//      selected (i.e. the user is acting as Observer / exercise designer).
//
// Helpers below cover both.

// ── Workflow transitions (per-task, per-role) ──────────────────────────────

/**
 * Owners can start a `not_started` task.
 */
export function canStart(
  task: PpeaTask,
  roleId: string | null,
  status: TaskStatus
): boolean {
  if (!roleId) return false;
  if (!task.owner.includes(roleId)) return false;
  return status === "not_started";
}

/**
 * Owners can submit an `in_progress` task for review.
 */
export function canSubmitForReview(
  task: PpeaTask,
  roleId: string | null,
  status: TaskStatus
): boolean {
  if (!roleId) return false;
  if (!task.owner.includes(roleId)) return false;
  return status === "in_progress";
}

/**
 * Approvers can approve a task that is `ready_for_review`.
 */
export function canApprove(
  task: PpeaTask,
  roleId: string | null,
  status: TaskStatus
): boolean {
  if (!roleId) return false;
  return task.approver.includes(roleId) && status === "ready_for_review";
}

/**
 * Approvers can return a `ready_for_review` task to `in_progress`.
 */
export function canReturn(
  task: PpeaTask,
  roleId: string | null,
  status: TaskStatus
): boolean {
  if (!roleId) return false;
  return task.approver.includes(roleId) && status === "ready_for_review";
}

/**
 * Approvers can re-open an `approved` task — moving it back to
 * `in_progress` so the owner can rework it.
 */
export function canReopen(
  task: PpeaTask,
  roleId: string | null,
  status: TaskStatus
): boolean {
  if (!roleId) return false;
  return task.approver.includes(roleId) && status === "approved";
}

// ── Operation-content editing (the per-task textarea) ──────────────────────
//
// Rules:
//   - Owners can edit while the task is `not_started` or `in_progress`.
//     (Starting work is the natural moment to begin writing; not_started is
//      allowed so owners can stage notes before formally pressing Start.)
//   - Involved roles can edit only while `in_progress` — they contribute
//     material but never drive state.
//   - Approvers cannot edit content directly. When `ready_for_review` they
//     review read-only; if they want changes, they Return the task.
//   - Once `approved`, content is locked for everyone. An approver must
//     Re-open the task first.
//   - Observer (no role) cannot edit content — content is per-operation
//     work, not design.
export function canEditContent(
  task: PpeaTask,
  roleId: string | null,
  status: TaskStatus
): boolean {
  if (!roleId) return false;
  if (status === "approved" || status === "ready_for_review") return false;
  if (task.owner.includes(roleId)) {
    return status === "not_started" || status === "in_progress";
  }
  if (task.involved.includes(roleId)) {
    return status === "in_progress";
  }
  return false;
}

// ── Structural-edit permissions (designer mode) ────────────────────────────
//
// "Observer" = no role selected.  Acts as the exercise designer.  Only
// Observer may mutate role definitions and task definitions.

/** Can the user add/edit/delete a role definition? */
export function canManageRoles(roleId: string | null): boolean {
  return roleId === null;
}

/** Can the user add a brand-new task to a phase? */
export function canAddTask(roleId: string | null): boolean {
  return roleId === null;
}

/** Can the user edit a task's *definition* (name, desc, role assignments,
 *  dependencies)?  Editing the per-operation textarea is governed by
 *  `canEditContent` instead. */
export function canEditTaskDefinition(roleId: string | null): boolean {
  return roleId === null;
}

/** Can the user delete a task? */
export function canDeleteTask(roleId: string | null): boolean {
  return roleId === null;
}

// ── "What can I do on this task right now?" summary ────────────────────────
//
// A convenience helper used by the UI to render hints and counts.

export interface TaskActionAvailability {
  canStart: boolean;
  canSubmit: boolean;
  canReturn: boolean;
  canApprove: boolean;
  canReopen: boolean;
  canEditContent: boolean;
  /** True if at least one *transition* (not just content edit) is available
   *  to this role on this task.  This is a capability flag — it includes
   *  re-opening an already-approved task. */
  hasActionableTransition: boolean;
  /**
   * True when the system is *actively waiting* on this role on this task:
   *
   *   - Owner with the task `not_started`         (waiting for them to start)
   *   - Owner with the task `in_progress`         (waiting for them to submit)
   *   - Approver with the task `ready_for_review` (waiting for them to approve/return)
   *
   * Re-opening an approved task is a capability but **not** a pending
   * action — the workflow is at rest.  This flag drives the "ACTION"
   * visual cue on task rows.
   */
  hasPendingAction: boolean;
}

export function getTaskActions(
  task: PpeaTask,
  roleId: string | null,
  status: TaskStatus
): TaskActionAvailability {
  const start = canStart(task, roleId, status);
  const submit = canSubmitForReview(task, roleId, status);
  const ret = canReturn(task, roleId, status);
  const approve = canApprove(task, roleId, status);
  const reopen = canReopen(task, roleId, status);
  return {
    canStart: start,
    canSubmit: submit,
    canReturn: ret,
    canApprove: approve,
    canReopen: reopen,
    canEditContent: canEditContent(task, roleId, status),
    hasActionableTransition: start || submit || ret || approve || reopen,
    // Pending = system is waiting on this role.  Approval is pending
    // (review needed); re-open is a capability, not a pending action, so
    // tasks already approved do *not* badge as awaiting.
    hasPendingAction: start || submit || approve,
  };
}

// ── Blueprint layout ───────────────────────────────────────────────────────
//
// We want to keep the carefully hand-tuned positions of the seed tasks but
// also place any newly added task automatically.  Algorithm:
//
// 1.  Start from `SEED_BP_COORDS` for known ids.
// 2.  Compute the longest-path depth of every task following `deps`.
// 3.  For each phase, lay out tasks in their own column-band:
//        plan: 0..1, prepare: 2..4, execute: 5..7, assess: 8..
//     A new task's column = phase-base + clamp(depthWithinPhase).
// 4.  Stack rows densely, avoiding collisions with already-placed nodes.
//

const PHASE_COL_BASE: Record<PhaseId, number> = {
  plan: 0,
  prepare: 2,
  execute: 5,
  assess: 8,
};

const PHASE_COL_SPAN: Record<PhaseId, number> = {
  plan: 2,
  prepare: 3,
  execute: 3,
  assess: 1,
};

/** Longest-path depth from any root, per task id. */
function computeDepth(tasks: PpeaTask[]): Record<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo: Record<string, number> = {};
  function visit(id: string, stack: Set<string>): number {
    if (memo[id] != null) return memo[id];
    if (stack.has(id)) return 0;
    const t = byId.get(id);
    if (!t || t.deps.length === 0) {
      memo[id] = 0;
      return 0;
    }
    stack.add(id);
    const d =
      1 +
      Math.max(
        ...t.deps.map((dep) => {
          if (!byId.has(dep)) return 0;
          return visit(dep, stack);
        }),
        0
      );
    stack.delete(id);
    memo[id] = d;
    return d;
  }
  for (const t of tasks) visit(t.id, new Set());
  return memo;
}

/**
 * Returns BpNodes for every task, with `col`/`row` populated.  Seed tasks
 * keep their hand-tuned coordinates; new tasks are auto-laid out.
 */
export function computeBlueprint(tasks: PpeaTask[]): BpNode[] {
  const depth = computeDepth(tasks);

  // First pass: assign target column for every node.
  const targetCol: Record<string, number> = {};
  for (const t of tasks) {
    const seed = SEED_BP_COORDS[t.id];
    if (seed) {
      targetCol[t.id] = seed.col;
    } else {
      // Compute depth within the phase: the min depth of any task in this
      // phase becomes phase-base; depths higher than that span fall to the
      // far end of the phase.
      const phaseTaskIds = tasks
        .filter((x) => x.phase === t.phase)
        .map((x) => x.id);
      const phaseDepths = phaseTaskIds.map((id) => depth[id] ?? 0);
      const minDepth = phaseDepths.length ? Math.min(...phaseDepths) : 0;
      const rel = (depth[t.id] ?? 0) - minDepth;
      const span = PHASE_COL_SPAN[t.phase];
      const base = PHASE_COL_BASE[t.phase];
      targetCol[t.id] = base + Math.min(Math.max(rel, 0), span - 1);
    }
  }

  // Second pass: assign rows, packing densely within each column.  Seeded
  // rows are reserved first.
  const usedRows: Record<number, Set<number>> = {};
  function reserve(col: number, row: number): void {
    (usedRows[col] ??= new Set()).add(row);
  }
  function nextFreeRow(col: number, preferred = 0): number {
    const set = (usedRows[col] ??= new Set());
    let r = preferred;
    while (set.has(r)) r += 1;
    set.add(r);
    return r;
  }

  // Reserve seeded coordinates first so they win conflicts.
  for (const t of tasks) {
    const seed = SEED_BP_COORDS[t.id];
    if (seed) reserve(seed.col, seed.row);
  }

  const out: BpNode[] = [];
  for (const t of tasks) {
    const col = targetCol[t.id];
    const seed = SEED_BP_COORDS[t.id];
    const row = seed ? seed.row : nextFreeRow(col, depth[t.id] ?? 0);
    out.push({
      id: t.id,
      label: wrapLabel(t.name),
      phase: t.phase,
      col,
      row,
      deps: t.deps,
    });
  }
  return out;
}

/** Wrap long labels onto two lines for nicer node rendering. */
export function wrapLabel(name: string): string {
  if (name.length <= 22) return name;
  // Find a space close to the middle to split on.
  const mid = Math.floor(name.length / 2);
  for (let off = 0; off < name.length; off++) {
    const i = mid + off;
    if (name[i] === " ") return name.slice(0, i) + "\n" + name.slice(i + 1);
    const j = mid - off;
    if (j > 0 && name[j] === " ")
      return name.slice(0, j) + "\n" + name.slice(j + 1);
  }
  return name.replace(/(.{22})/, "$1\n");
}

// ── Downstream / upstream traversal ────────────────────────────────────────

export function getDirectDownstream(tasks: PpeaTask[], id: string): PpeaTask[] {
  return tasks.filter((t) => t.deps.includes(id));
}

export function getUpstream(tasks: PpeaTask[], id: string): PpeaTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const out: PpeaTask[] = [];
  const queue = [...(byId.get(id)?.deps ?? [])];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const t = byId.get(cur);
    if (t) {
      out.push(t);
      queue.push(...t.deps);
    }
  }
  return out;
}

// ── Phase ordering ─────────────────────────────────────────────────────────

export const PHASE_INDEX: Record<PhaseId, number> = PHASE_ORDER.reduce(
  (acc, p, i) => ({ ...acc, [p]: i }),
  {} as Record<PhaseId, number>
);

export function sortTasksByPhase(tasks: PpeaTask[]): PpeaTask[] {
  return [...tasks].sort((a, b) => {
    const pa = PHASE_INDEX[a.phase];
    const pb = PHASE_INDEX[b.phase];
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
}
