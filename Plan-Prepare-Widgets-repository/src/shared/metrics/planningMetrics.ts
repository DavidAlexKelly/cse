// ============================================================
// Planning metrics
//
// Derives the figures the widgets display from ontology data,
// replacing the hard-coded MOCK_PHASE_EXTRAS lookups and the
// index-matched coveragePct merge.
//
// Everything here is a pure function of ontology records so it
// can be unit tested and so the numbers change when the plan
// changes. Where a figure is a heuristic rather than a stored
// value, the definition is documented on the function — these
// are planning indicators, not authoritative measures.
// ============================================================

import type { PhaseGap } from "../data/mockPhases.js";
import type { WorkflowTask } from "../../task-manager/task-assignment/types.js";

// ── D-Day offsets ─────────────────────────────────────────────────────────

/**
 * Parses a D-Day relative offset into a signed day count.
 * Accepts "D+0", "D-55", "D0", "d +5" and similar. Returns null
 * when the value is absent or is not an offset (some scenarios
 * store real dates in these fields).
 */
export function parseDayOffset(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = /^\s*d\s*([+-]?)\s*(\d+)\s*$/i.exec(raw);
  if (!match) return null;
  const [, sign, digits] = match;
  const magnitude = Number(digits);
  if (!Number.isFinite(magnitude)) return null;
  return sign === "-" ? -magnitude : magnitude;
}

/**
 * Resolves a D-Day relative offset to a calendar date, given the
 * scenario's D-Day. Returns null when either input is missing or
 * unparseable, so callers can fall back to showing the raw offset.
 */
export function resolveOffsetDate(
  dDay: string | Date | null | undefined,
  offset: string | null | undefined,
): Date | null {
  if (!dDay) return null;
  const days = parseDayOffset(offset);
  if (days == null) return null;
  const base = dDay instanceof Date ? new Date(dDay) : new Date(dDay);
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + days);
  return base;
}

/** Inclusive day count between two D-Day offsets, or null if either is unparseable. */
export function durationDaysBetween(
  startOffset: string | null | undefined,
  endOffset: string | null | undefined,
): number | null {
  const start = parseDayOffset(startOffset);
  const end = parseDayOffset(endOffset);
  if (start == null || end == null) return null;
  return Math.max(0, end - start) + 1;
}

// ── Phase readiness ───────────────────────────────────────────────────────

/**
 * Planning readiness for a phase, as the percentage of its tasks
 * that are approved. A phase with no tasks scores 0 rather than
 * 100 — nothing planned is not the same as everything done.
 */
export function phaseReadinessPct(tasksInPhase: WorkflowTask[]): number {
  if (tasksInPhase.length === 0) return 0;
  const approved = tasksInPhase.filter((t) => t.status === "approved").length;
  return Math.round((approved / tasksInPhase.length) * 100);
}

// ── Phase gaps ────────────────────────────────────────────────────────────

export interface PhaseGapInputs {
  phaseId: string;
  /** Tasks whose phaseId matches this phase. */
  tasks: WorkflowTask[];
  /** Number of injects scheduled in this phase. */
  injectCount: number;
  /** Number of training objectives assigned to this phase. */
  objectiveCount: number;
  /** Whether a map state has been authored for this phase. */
  hasMapState?: boolean;
}

/**
 * Rule-based planning gaps for a phase. These replace the static
 * MOCK_PHASE_EXTRAS gap lists, so they reflect the real state of
 * the plan and disappear once addressed.
 */
export function detectPhaseGaps(input: PhaseGapInputs): PhaseGap[] {
  const gaps: PhaseGap[] = [];
  const { phaseId, tasks, injectCount, objectiveCount, hasMapState } = input;

  if (objectiveCount === 0) {
    gaps.push({
      gapId: `${phaseId}-no-objectives`,
      description: "No training objectives assigned to this phase",
      severity: "critical",
    });
  }

  if (tasks.length === 0) {
    gaps.push({
      gapId: `${phaseId}-no-tasks`,
      description: "No planning tasks raised for this phase",
      severity: "critical",
    });
  }

  if (injectCount === 0) {
    gaps.push({
      gapId: `${phaseId}-no-injects`,
      description: "No MEL/MIL injects scheduled in this phase",
      severity: "warning",
    });
  }

  const unassigned = tasks.filter((t) => !t.owner).length;
  if (unassigned > 0) {
    gaps.push({
      gapId: `${phaseId}-unassigned-tasks`,
      description: `${unassigned} task${unassigned === 1 ? "" : "s"} without an owner`,
      severity: "warning",
    });
  }

  const unapproved = tasks.filter((t) => !t.approver).length;
  if (unapproved > 0) {
    gaps.push({
      gapId: `${phaseId}-unapproved-tasks`,
      description: `${unapproved} task${unapproved === 1 ? "" : "s"} without an approver`,
      severity: "warning",
    });
  }

  if (hasMapState === false) {
    gaps.push({
      gapId: `${phaseId}-no-map-state`,
      description: "No map state authored for this phase",
      severity: "warning",
    });
  }

  return gaps;
}

// ── Objective coverage ────────────────────────────────────────────────────

/**
 * Coverage for a training objective.
 *
 * The ontology does not store a coverage figure, and an objective
 * has no direct link to tasks — only a shared phase. So this is a
 * proxy: the share of that phase's planning tasks that are approved.
 * An objective not tied to a phase, or tied to a phase with no
 * tasks, scores 0.
 *
 * This replaces the previous behaviour, which took coveragePct from
 * whichever mock objective happened to sit at the same array index
 * and was therefore meaningless.
 */
export function objectiveCoveragePct(
  phaseId: string | null | undefined,
  tasksByPhase: Map<string, WorkflowTask[]>,
): number {
  if (!phaseId) return 0;
  const tasks = tasksByPhase.get(phaseId);
  if (!tasks || tasks.length === 0) return 0;
  return phaseReadinessPct(tasks);
}

/** Groups tasks by their phaseId, skipping tasks with no phase. */
export function groupTasksByPhase(
  tasks: WorkflowTask[],
): Map<string, WorkflowTask[]> {
  const byPhase = new Map<string, WorkflowTask[]>();
  for (const task of tasks) {
    if (!task.phaseId) continue;
    const bucket = byPhase.get(task.phaseId);
    if (bucket) bucket.push(task);
    else byPhase.set(task.phaseId, [task]);
  }
  return byPhase;
}
