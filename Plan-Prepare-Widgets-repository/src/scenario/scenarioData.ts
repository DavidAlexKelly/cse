// ============================================================
// Scenario Widget — local state types & seed
//
// People, comments and workflow-task records are pulled from
// /shared/data/* via /shared/data/index.ts. The seed here only
// covers the bits that don't yet live in shared data (the
// strategic-context narrative and the OPFOR definitions), and
// the in-memory UI state shape.
// ============================================================

import {
  COMMENTS,
  CURRENT_USER_ID,
  PEOPLE,
  commentsByIds,
  personById,
  workflowTaskById,
} from "../shared/data/index.js";
import type {
  CommentRecord,
  SubtaskRecord,
  WorkflowTaskRecord,
} from "../shared/data/index.js";
import {
  taskStatusToApprovalState,
} from "../shared/task/taskTypes.js";
import type { ApprovalState } from "../shared/task/taskTypes.js";

// ── Re-exports so existing components keep working ────────────────────────

export { COMMENTS, CURRENT_USER_ID, PEOPLE, commentsByIds, personById };
export type { CommentRecord, SubtaskRecord, WorkflowTaskRecord };
export type { ApprovalState };

// ── OPFOR (not yet in shared data, kept local) ────────────────────────────

export interface OpforDefinition {
  id: string;
  title: string;
  generated: boolean;
  meta: string;
  body: string;
  tags: string[];
}

// ── UI state shape ────────────────────────────────────────────────────────

export interface ScenarioState {
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
  strategicContext: {
    title: string;
    generated: boolean;
    generatedFrom: string;
    lastEdited: string;
    body: string;
    tags: string[];
  };
  opforDefinitions: OpforDefinition[];
  comments: CommentRecord[];
}

// ── Initial state — assembled from shared seed ────────────────────────────

const scenarioTask: WorkflowTaskRecord = workflowTaskById("task_scenario")!;

export const INITIAL_SCENARIO: ScenarioState = {
  task: {
    title: "Define & review scenario",
    assigneeId: scenarioTask.__links.assignedTo,
    reviewerId: scenarioTask.__links.approvedBy,
    due: scenarioTask.dueOffset,
    description:
      "Review strategic context, OPFOR definition, and exercise area narrative.",
    approvalState: taskStatusToApprovalState(scenarioTask.status),
    approvalNote: "Approved by BGen Hartmann · 2 Jun 2025",
  },

  subtasks: scenarioTask.subtasks ?? [],

  strategicContext: {
    title: "The Sorvian Peninsula Crisis",
    generated: true,
    generatedFrom: "2 source documents",
    lastEdited: "09:14",
    body:
      "The fictional state of Sorvia, bordering the Eastern Flank, has experienced rapid deterioration of the security environment following contested elections and external interference by the Dorvian Federation. NATO has activated Article 4 consultations and deployed a Multinational Division to the region. The exercise begins at D-Day with the division assuming operational control of the assigned area under conditions of a high-intensity conventional threat combined with significant information operations and cyber activity targeting allied C2 nodes.",
    tags: ["High intensity", "Information ops", "Eastern Flank", "Article 4"],
  },

  opforDefinitions: [
    {
      id: "opfor_3caa",
      title: "Dorvian 3rd Combined Arms Army",
      generated: true,
      meta: "Near-peer · High readiness",
      body:
        "Combined arms force with integrated air defence, EW, and cyber capabilities. Manoeuvre-heavy doctrine with strong ISR and long-range fires. Will challenge BLUFOR across all functional areas simultaneously.",
      tags: ["Near-peer", "EW + Cyber", "Long-range fires"],
    },
    {
      id: "opfor_asymmetric",
      title: "Asymmetric threat cells",
      generated: false,
      meta: "Information environment",
      body:
        "Proxy forces conducting information operations, sabotage of LOCs, and civilian population influence. Active disinformation campaign targeting NATO public opinion and allied cohesion.",
      tags: ["IO/PSYOPS", "CIMIC impact"],
    },
  ],

  comments: commentsByIds(scenarioTask.__links.hasComment),
};
