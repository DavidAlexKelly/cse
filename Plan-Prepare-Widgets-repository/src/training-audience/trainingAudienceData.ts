// ============================================================
// Training Audience Widget — local state types & seed.
//
// People / comments / workflow-task data is pulled from
// /shared/data/index.ts. Audience records come from
// /shared/data/trainingAudiences.json via the same helper.
// ============================================================

import {
  CURRENT_USER_ID,
  PEOPLE,
  TRAINING_AUDIENCES,
  commentsByIds,
  personById,
  workflowTaskById,
} from "../shared/data/index.js";
import type {
  CommentRecord,
  ParticipatingNation,
  SubtaskRecord,
  TrainingAudienceRecord,
  WorkflowTaskRecord,
} from "../shared/data/index.js";
import { taskStatusToApprovalState } from "../shared/task/taskTypes.js";
import type { ApprovalState } from "../shared/task/taskTypes.js";

// Re-exports so component files only need one import
export {
  CURRENT_USER_ID,
  PEOPLE,
  commentsByIds,
  personById,
};
export type {
  CommentRecord,
  ParticipatingNation,
  SubtaskRecord,
  TrainingAudienceRecord,
  WorkflowTaskRecord,
};
export type { ApprovalState };

// ── UI state shape ────────────────────────────────────────────────────────

export interface TrainingAudienceState {
  task: {
    title: string;
    assigneeId: string;
    reviewerId: string;
    due: string;
    description: string;
    approvalState: ApprovalState;
    approvalNote: string;
  };
  subtasks: SubtaskRecord[];
  audiences: TrainingAudienceRecord[];
  /** Pulled out for easier table editing. Seeded from the primary audience's `participatingNations`. */
  participatingNations: ParticipatingNation[];
  comments: CommentRecord[];
}

// ── Initial state — assembled from shared seed ────────────────────────────

const task: WorkflowTaskRecord = workflowTaskById("task_training_audience")!;

const linkedAudiences: TrainingAudienceRecord[] = task.__links.definesContent
  .map((id) => TRAINING_AUDIENCES.find((a) => a.audienceId === id))
  .filter((a): a is TrainingAudienceRecord => a != null);

const primary = linkedAudiences.find((a) => a.audienceType === "primary");

export const INITIAL_TRAINING_AUDIENCE: TrainingAudienceState = {
  task: {
    title: "Define training audience",
    assigneeId: task.__links.assignedTo,
    reviewerId: task.__links.approvedBy,
    due: task.dueOffset,
    description:
      "Define who the exercise trains — primary and secondary audiences, nations, and participant numbers.",
    approvalState: taskStatusToApprovalState(task.status),
    approvalNote: "Submitted for approval · Awaiting BGen Hartmann",
  },
  subtasks: task.subtasks ?? [],
  audiences: linkedAudiences,
  participatingNations: primary?.participatingNations ?? [],
  comments: commentsByIds(task.__links.hasComment),
};
