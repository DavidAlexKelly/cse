// ============================================================
// Training Objectives Widget — local state types & seed.
//
// All shared records come from /shared/data/index.ts. The seed
// here only assembles the in-memory UI state from those sources.
// ============================================================

import {
  CURRENT_USER_ID,
  PEOPLE,
  TRAINING_OBJECTIVES,
  commentsByIds,
  personById,
  workflowTaskById,
} from "../shared/data/index.js";
import type {
  CommentRecord,
  SubtaskRecord,
  TrainingObjectiveRecord,
  WorkflowTaskRecord,
} from "../shared/data/index.js";
import { taskStatusToApprovalState } from "../shared/task/taskTypes.js";
import type { ApprovalState } from "../shared/task/taskTypes.js";

// Re-exports so component files only need one import
export { CURRENT_USER_ID, PEOPLE, commentsByIds, personById };
export type {
  CommentRecord,
  SubtaskRecord,
  TrainingObjectiveRecord,
  WorkflowTaskRecord,
};
export type { ApprovalState };

// ── UI state shape ────────────────────────────────────────────────────────

export interface TrainingObjectivesState {
  task: {
    title: string;
    assigneeId: string;
    reviewerId: string;
    due: string;
    description: string;
    approvalState: ApprovalState;
    approvalNote: string;
    aiAssisted: boolean;
  };
  subtasks: SubtaskRecord[];
  objectives: TrainingObjectiveRecord[];
  comments: CommentRecord[];
}

// ── Initial state — assembled from shared seed ────────────────────────────

const task: WorkflowTaskRecord = workflowTaskById("task_training_objectives")!;

const linkedObjectives: TrainingObjectiveRecord[] = task.__links.definesContent
  .map((id) => TRAINING_OBJECTIVES.find((o) => o.objectiveId === id))
  .filter((o): o is TrainingObjectiveRecord => o != null);

export const INITIAL_TRAINING_OBJECTIVES: TrainingObjectivesState = {
  task: {
    title: "Define / review training objectives",
    assigneeId: task.__links.assignedTo,
    reviewerId: task.__links.approvedBy,
    due: task.dueOffset,
    description:
      "Objectives across J-directorates — what we want the audience to demonstrate.",
    approvalState: taskStatusToApprovalState(task.status),
    approvalNote: "Approved by BGen Hartmann · 1 Jun 2025 · No further action required",
    aiAssisted: task.aiAssisted,
  },
  subtasks: task.subtasks ?? [],
  objectives: linkedObjectives,
  comments: commentsByIds(task.__links.hasComment),
};
