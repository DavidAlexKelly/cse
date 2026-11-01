// ── Task Assignment — Type Definitions ────────────────────────────────────

// The task vocabulary lives in shared/task/taskTaxonomy so that the
// widgets, the ontology mappers and the action type allowed-values
// all agree on one list. Re-exported here so existing imports from
// this module keep working.
export type { TaskSection, TaskStatus } from "../../shared/task/taskTaxonomy.js";

import type { TaskSection, TaskStatus } from "../../shared/task/taskTaxonomy.js";

export interface TeamMember {
  id: string;
  name: string;
  rank: string;
  role: string;
}

export interface SubTask {
  /** NxgSubtask primary key when ontology-backed. */
  id: string;
  label: string;
  done: boolean;
}

export interface WorkflowTask {
  /** NxgTask primary key. */
  id: string;
  section: TaskSection;
  /** Phase ID from NxgTask.phaseId — used for phase-based grouping */
  phaseId: string | null;
  /**
   * Inject ID from NxgTask.injectId — set for tasks raised against a
   * MEL/MIL event. Optional because local seed records predate it.
   */
  injectId?: string | null;
  title: string;
  description: string;
  approver: string | null;
  owner: string | null;
  due: string;
  status: TaskStatus;
  /** Optional because local seed records predate it. */
  aiAssisted?: boolean;
  subTasks?: SubTask[];
}

// ── Status derivation helper ───────────────────────────────────────────────

export function deriveStatus(
  approver: string | null,
  owner: string | null,
): TaskStatus {
  if (approver && owner) return "assigned";
  if (approver || owner) return "in-review";
  return "pending";
}
