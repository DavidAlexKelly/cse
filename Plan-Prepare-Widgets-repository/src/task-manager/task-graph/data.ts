import type { Node, Edge } from "@xyflow/react";

// ── Task management activities ───────────────────────────────────────────

export interface Subtask {
  id: string;
  label: string;
  done: boolean;
  blocked?: boolean; // derived at runtime by graphEngine
  blockedBy?: string; // node id whose non-approved status blocks this subtask
}

export interface TaskNodeData {
  label: string;
  description: string;
  assignee: string;
  reviewer: string;
  status: "approved" | "in-review" | "pending" | "save";
  priority: "critical" | "warning" | "active" | "grey";
  progress: number; // 0–1, derived from subtasks by graphEngine
  category: string;
  subtasks?: Subtask[];
  [key: string]: unknown;
}

// ── Edge data ───────────────────────────────────────────────────────────
// Edge kind is DERIVED by graphEngine from source node status.
// "ready" = source approved, "active" = source in-progress, "blocked" = source pending
export type EdgeKind = "ready" | "active" | "blocked";

export interface TaskEdgeData {
  kind: EdgeKind;
  note?: string;
  [key: string]: unknown;
}

const X_GAP = 300;
const Y_GAP = 200;

// ── Static fallback nodes — names/subtasks aligned to the canonical task list
// (MOCK_WORKFLOW_TASKS in mockData.ts). Used only when no live tasks are injected.
export const taskNodes: Node<TaskNodeData>[] = [
  // ── Column 0 — Planning & Design ─────────────────────────────────
  {
    id: "task_scenario",
    type: "taskNode",
    position: { x: 0, y: 0 },
    data: {
      label: "Scenario design",
      description:
        "Strategic context, OPFOR definition, and exercise area narrative",
      assignee: "LtCol Kowalski",
      reviewer: "Col Anderssen",
      status: "approved",
      priority: "active",
      progress: 0,
      category: "Planning & Design",
      subtasks: [
        {
          id: "s-s1",
          label: "Write OPFOR doctrine card (Dorvian 3rd CAA TTPs, EW, cyber)",
          done: true,
        },
        {
          id: "s-s2",
          label: "Lock J6 sign-off on specific C2 systems targeted in scenario",
          done: true,
        },
      ],
    },
  },
  {
    id: "task_training_objectives",
    type: "taskNode",
    position: { x: 0, y: Y_GAP },
    data: {
      label: "Training objectives",
      description: "Training objectives across J-directorates",
      assignee: "Col Anderssen",
      reviewer: "BGen Hartmann",
      status: "approved",
      priority: "active",
      progress: 0,
      category: "Planning & Design",
      subtasks: [
        {
          id: "s-to1",
          label: "Lock priorities (High / Medium / Low) with J7",
          done: true,
        },
        {
          id: "s-to2",
          label: "Map each objective to at least one MEL/MIL inject",
          done: false,
        },
        {
          id: "s-to3",
          label: "Get sign-off from each functional-area lead",
          done: true,
        },
      ],
    },
  },
  {
    id: "task_training_audience",
    type: "taskNode",
    position: { x: 0, y: Y_GAP * 2 },
    data: {
      label: "Training audience",
      description:
        "Primary and secondary audiences, participating nations, participant numbers",
      assignee: "Col Anderssen",
      reviewer: "BGen Hartmann",
      status: "in-review",
      priority: "warning",
      progress: 0,
      category: "Planning & Design",
      subtasks: [
        {
          id: "s-ta1",
          label: "Confirm primary audience scope with HQ Commander",
          done: true,
        },
        {
          id: "s-ta2",
          label: "Lock participating nations and lead-nation role",
          done: true,
        },
        {
          id: "s-ta3",
          label:
            "Validate participant numbers per directorate with each nation",
          done: false,
        },
      ],
    },
  },
  {
    id: "task_composition",
    type: "taskNode",
    position: { x: 0, y: Y_GAP * 3 },
    data: {
      label: "Composition",
      description: "Simulation systems, C2 nodes, and federation architecture",
      assignee: "",
      reviewer: "",
      status: "pending",
      priority: "grey",
      progress: 0,
      category: "Planning & Design",
      subtasks: [
        {
          id: "s-c1",
          label: "Confirm contributing nation force packages and capabilities",
          done: false,
        },
        {
          id: "s-c2",
          label:
            "Agree multinational C2 relationships and liaison arrangements",
          done: false,
        },
        {
          id: "s-c3",
          label:
            "Identify specialist enablers (ISR, EW, cyber) from each nation",
          done: false,
        },
      ],
    },
  },

  // ── Column 1 — Scenario & Environment ────────────────────────────
  {
    id: "task_pmesii",
    type: "taskNode",
    position: { x: X_GAP, y: Y_GAP * 0.5 },
    data: {
      label: "PMESII variables",
      description: "All PMESII-PT domains — 5 of 8 complete",
      assignee: "Maj Westergaard",
      reviewer: "Col Anderssen",
      status: "in-review",
      priority: "warning",
      progress: 0,
      category: "Scenario & Environment",
      subtasks: [
        {
          id: "s-p1",
          label: "Complete Information domain with J6 input",
          done: false,
        },
        {
          id: "s-p2",
          label:
            "Define Physical Environment (terrain, weather) and Time domains",
          done: false,
        },
        {
          id: "s-p3",
          label:
            "Validate Military and Economic domains against scenario narrative",
          done: true,
        },
      ],
    },
  },
  {
    id: "task_exercise_area",
    type: "taskNode",
    position: { x: X_GAP, y: Y_GAP * 2 },
    data: {
      label: "Exercise area",
      description: "AOR, key terrain features, and phase lines",
      assignee: "",
      reviewer: "",
      status: "pending",
      priority: "grey",
      progress: 0,
      category: "Scenario & Environment",
      subtasks: [
        {
          id: "s-ea1",
          label: "Draw and submit AOR boundary for approval",
          done: false,
        },
        {
          id: "s-ea2",
          label:
            "Grid all phase lines and NAIs (Phase Line ODIN already referenced in MEL but unconfirmed)",
          done: false,
        },
        {
          id: "s-ea3",
          label: "Confirm restricted areas and no-fire zones with J3/J5",
          done: false,
        },
      ],
    },
  },

  // ── Column 2 — Execution Planning ────────────────────────────────
  {
    id: "task_mel_mil_p1",
    type: "taskNode",
    position: { x: X_GAP * 2, y: 0 },
    data: {
      label: "MEL/MIL — Phase 1",
      description: "Phase 1 injects: INTEL and CYBER events D+0 to D+2",
      assignee: "LtCol Kowalski",
      reviewer: "Col Anderssen",
      status: "in-review",
      priority: "critical",
      progress: 0,
      category: "Execution Planning",
      subtasks: [
        {
          id: "s-m1a",
          label:
            "Tag every inject with a TO reference — flag any with no traceability",
          done: false,
        },
        {
          id: "s-m1b",
          label: "Confirm geographic anchoring for all location-based injects",
          done: false,
          blockedBy: "task_exercise_area",
        },
      ],
    },
  },
  {
    id: "task_mel_mil_p2",
    type: "taskNode",
    position: { x: X_GAP * 2, y: Y_GAP },
    data: {
      label: "MEL/MIL — Phase 2",
      description: "Phase 2 injects: METOC and INTEL events D+3 to D+6",
      assignee: "LtCol Kowalski",
      reviewer: "Col Anderssen",
      status: "pending",
      priority: "grey",
      progress: 0,
      category: "Execution Planning",
      subtasks: [
        {
          id: "s-m2a",
          label:
            "Review D+3–D+6 tempo — ensure High-priority TOs are stimulated at least twice",
          done: false,
        },
      ],
    },
  },
  {
    id: "task_mel_mil_p3",
    type: "taskNode",
    position: { x: X_GAP * 2, y: Y_GAP * 2 },
    data: {
      label: "MEL/MIL — Phase 3",
      description: "Phase 3 injects: LOG and POLMIL events D+7 to D+10",
      assignee: "LtCol Kowalski",
      reviewer: "Col Anderssen",
      status: "pending",
      priority: "grey",
      progress: 0,
      category: "Execution Planning",
      subtasks: [],
    },
  },
  {
    id: "task_mel_mil_p4",
    type: "taskNode",
    position: { x: X_GAP * 2, y: Y_GAP * 3 },
    data: {
      label: "MEL/MIL — Phase 4",
      description: "Phase 4 injects: INFO OPS events D+11 to D+14",
      assignee: "LtCol Kowalski",
      reviewer: "Col Anderssen",
      status: "pending",
      priority: "grey",
      progress: 0,
      category: "Execution Planning",
      subtasks: [],
    },
  },
  {
    id: "task_orbat_positions",
    type: "taskNode",
    position: { x: X_GAP * 2, y: Y_GAP * 4 },
    data: {
      label: "ORBAT & positions",
      description: "Force structure and start positions on map",
      assignee: "",
      reviewer: "",
      status: "pending",
      priority: "grey",
      progress: 0,
      category: "Execution Planning",
      subtasks: [
        {
          id: "s-o1",
          label:
            "Build BLUFOR HQ structure from confirmed national participant registers",
          done: false,
        },
        {
          id: "s-o2",
          label:
            "Build OPFOR structure at battalion level from Dorvian doctrine card",
          done: false,
        },
        {
          id: "s-o3",
          label:
            "Assign D-Day start positions on map (blocked on Exercise Area boundary)",
          done: false,
          blockedBy: "task_exercise_area",
        },
      ],
    },
  },
];

// ── Edges (minimal — visual style is DERIVED by graphEngine) ────────────
// Only define source/target and optional notes. graphEngine applies all styling.
export const taskEdges: Edge<TaskEdgeData>[] = [
  {
    id: "e-sc-pmesii",
    source: "task_scenario",
    target: "task_pmesii",
    data: {
      kind: "active",
      note: "Scenario informs PMESII domain definitions",
    },
  },
  {
    id: "e-sc-to",
    source: "task_scenario",
    target: "task_training_objectives",
    data: { kind: "active" },
  },
  {
    id: "e-sc-ta",
    source: "task_scenario",
    target: "task_training_audience",
    data: { kind: "active" },
  },
  {
    id: "e-ta-to",
    source: "task_training_audience",
    target: "task_training_objectives",
    data: { kind: "active", note: "Audience feeds into / refines objectives" },
  },
  {
    id: "e-pmesii-ea",
    source: "task_pmesii",
    target: "task_exercise_area",
    data: { kind: "active", note: "PMESII defines the world for the AOR" },
  },
  {
    id: "e-to-mel-p1",
    source: "task_training_objectives",
    target: "task_mel_mil_p1",
    data: { kind: "active" },
  },
  {
    id: "e-mel-p1-p2",
    source: "task_mel_mil_p1",
    target: "task_mel_mil_p2",
    data: { kind: "active" },
  },
  {
    id: "e-mel-p2-p3",
    source: "task_mel_mil_p2",
    target: "task_mel_mil_p3",
    data: { kind: "active" },
  },
  {
    id: "e-mel-p3-p4",
    source: "task_mel_mil_p3",
    target: "task_mel_mil_p4",
    data: { kind: "active" },
  },
  {
    id: "e-ea-orbat",
    source: "task_exercise_area",
    target: "task_orbat_positions",
    data: { kind: "active" },
  },
  {
    id: "e-mel-p4-orbat",
    source: "task_mel_mil_p4",
    target: "task_orbat_positions",
    data: { kind: "active" },
  },
];
