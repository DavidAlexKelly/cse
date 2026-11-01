// ── Task Assignment — Mock Data ────────────────────────────────────────────

import type { TeamMember, WorkflowTask } from "./types.js";

export const MOCK_TEAM_MEMBERS: TeamMember[] = [
  {
    id: "tm-1",
    name: "BGen Hartmann",
    rank: "BGen",
    role: "Exercise Director",
  },
  { id: "tm-2", name: "Col Anderssen", rank: "Col", role: "Deputy Director" },
  { id: "tm-3", name: "LtCol Kowalski", rank: "LtCol", role: "Plans Officer" },
  { id: "tm-4", name: "Maj Roos", rank: "Maj", role: "Training Planner" },
  {
    id: "tm-5",
    name: "Maj Westergaard",
    rank: "Maj",
    role: "Scenario Designer",
  },
];

// ── Canonical task list ────────────────────────────────────────────────────
// Single source of truth for all planning tasks.
// Used by Dashboard, Task Management tab, and Task Assignment widget.

export const MOCK_WORKFLOW_TASKS: WorkflowTask[] = [
  // ── Planning & Design ──────────────────────────────────────────────────
  {
    id: "task_scenario",
    section: "Planning & Design",
    phaseId: "phase_01",
    title: "Scenario design",
    description:
      "Strategic context, OPFOR definition, and exercise area narrative",
    owner: "LtCol Kowalski",
    approver: "Col Anderssen",
    due: "D-55",
    status: "assigned",
    subTasks: [
      {
        id: "st_s1",
        label: "Write OPFOR doctrine card (Dorvian 3rd CAA TTPs, EW, cyber)",
        done: true,
      },
      {
        id: "st_s2",
        label: "Lock J6 sign-off on specific C2 systems targeted in scenario",
        done: true,
      },
    ],
  },
  {
    id: "task_training_objectives",
    section: "Planning & Design",
    phaseId: "phase_01",
    title: "Training objectives",
    description: "Training objectives across J-directorates",
    owner: "Col Anderssen",
    approver: "BGen Hartmann",
    due: "D-55",
    status: "assigned",
    subTasks: [
      {
        id: "st_to1",
        label: "Lock priorities (High / Medium / Low) with J7",
        done: true,
      },
      {
        id: "st_to2",
        label: "Map each objective to at least one MEL/MIL inject",
        done: false,
      },
      {
        id: "st_to3",
        label: "Get sign-off from each functional-area lead",
        done: true,
      },
    ],
  },
  {
    id: "task_training_audience",
    section: "Planning & Design",
    phaseId: "phase_01",
    title: "Training audience",
    description:
      "Primary and secondary audiences, participating nations, and participant numbers",
    owner: "Col Anderssen",
    approver: "BGen Hartmann",
    due: "D-65",
    status: "in-review",
    subTasks: [
      {
        id: "st_ta1",
        label: "Confirm primary audience scope with HQ Commander",
        done: true,
      },
      {
        id: "st_ta2",
        label: "Lock participating nations and lead-nation role",
        done: true,
      },
      {
        id: "st_ta3",
        label: "Validate participant numbers per directorate with each nation",
        done: false,
      },
    ],
  },
  {
    id: "task_composition",
    section: "Planning & Design",
    phaseId: "phase_01",
    title: "Composition",
    description: "Simulation systems, C2 nodes, and federation architecture",
    owner: null,
    approver: null,
    due: "D-50",
    status: "pending",
    subTasks: [
      {
        id: "st_c1",
        label: "Confirm contributing nation force packages and capabilities",
        done: false,
      },
      {
        id: "st_c2",
        label: "Agree multinational C2 relationships and liaison arrangements",
        done: false,
      },
      {
        id: "st_c3",
        label: "Identify specialist enablers (ISR, EW, cyber) from each nation",
        done: false,
      },
    ],
  },

  // ── Scenario & Environment ─────────────────────────────────────────────
  {
    id: "task_pmesii",
    section: "Scenario & Environment",
    phaseId: "phase_01",
    title: "PMESII variables",
    description: "All PMESII-PT domains — 5 of 8 complete",
    owner: "Maj Westergaard",
    approver: "Col Anderssen",
    due: "D-45",
    status: "in-review",
    subTasks: [
      {
        id: "st_p1",
        label: "Complete Information domain with J6 input",
        done: false,
      },
      {
        id: "st_p2",
        label:
          "Define Physical Environment (terrain, weather) and Time domains",
        done: false,
      },
      {
        id: "st_p3",
        label:
          "Validate Military and Economic domains against scenario narrative",
        done: true,
      },
    ],
  },
  {
    id: "task_exercise_area",
    section: "Scenario & Environment",
    phaseId: "phase_01",
    title: "Exercise area",
    description: "AOR, key terrain features, and phase lines",
    owner: null,
    approver: null,
    due: "D-40",
    status: "pending",
    subTasks: [
      {
        id: "st_ea1",
        label: "Draw and submit AOR boundary for approval",
        done: false,
      },
      {
        id: "st_ea2",
        label:
          "Grid all phase lines and NAIs (Phase Line ODIN already referenced in MEL but unconfirmed)",
        done: false,
      },
      {
        id: "st_ea3",
        label: "Confirm restricted areas and no-fire zones with J3/J5",
        done: false,
      },
    ],
  },

  // ── Execution Planning ─────────────────────────────────────────────────
  {
    id: "task_mel_mil_p1",
    section: "Execution Planning",
    phaseId: "phase_01",
    title: "MEL/MIL — Phase 1",
    description: "Phase 1 injects: INTEL and CYBER events D+0 to D+2",
    owner: "LtCol Kowalski",
    approver: "Col Anderssen",
    due: "D-30",
    status: "in-review",
    subTasks: [
      {
        id: "st_m1a",
        label:
          "Tag every inject with a TO reference — flag any with no traceability",
        done: false,
      },
      {
        id: "st_m1b",
        label: "Confirm geographic anchoring for all location-based injects",
        done: false,
      },
    ],
  },
  {
    id: "task_mel_mil_p2",
    section: "Execution Planning",
    phaseId: "phase_02",
    title: "MEL/MIL — Phase 2",
    description: "Phase 2 injects: METOC and INTEL events D+3 to D+6",
    owner: "LtCol Kowalski",
    approver: "Col Anderssen",
    due: "D-30",
    status: "pending",
    subTasks: [
      {
        id: "st_m2a",
        label:
          "Review D+3–D+6 tempo — ensure High-priority TOs are stimulated at least twice",
        done: false,
      },
    ],
  },
  {
    id: "task_mel_mil_p3",
    section: "Execution Planning",
    phaseId: "phase_03",
    title: "MEL/MIL — Phase 3",
    description: "Phase 3 injects: LOG and POLMIL events D+7 to D+10",
    owner: "LtCol Kowalski",
    approver: "Col Anderssen",
    due: "D-30",
    status: "pending",
    subTasks: [],
  },
  {
    id: "task_mel_mil_p4",
    section: "Execution Planning",
    phaseId: "phase_04",
    title: "MEL/MIL — Phase 4",
    description: "Phase 4 injects: INFO OPS events D+11 to D+14",
    owner: "LtCol Kowalski",
    approver: "Col Anderssen",
    due: "D-30",
    status: "pending",
    subTasks: [],
  },
  {
    id: "task_orbat_positions",
    section: "Execution Planning",
    phaseId: "phase_01",
    title: "ORBAT & positions",
    description: "Force structure and start positions on map",
    owner: null,
    approver: null,
    due: "D-21",
    status: "pending",
    subTasks: [
      {
        id: "st_ob1",
        label:
          "Build BLUFOR HQ structure from confirmed national participant registers",
        done: false,
      },
      {
        id: "st_ob2",
        label:
          "Build OPFOR structure at battalion level from Dorvian doctrine card",
        done: false,
      },
      {
        id: "st_ob3",
        label:
          "Assign D-Day start positions on map (blocked on Exercise Area boundary)",
        done: false,
      },
    ],
  },
];

// Canonical section list now lives in shared/task/taskTaxonomy so the
// widgets and the ontology agree on one vocabulary. Re-exported here
// because several modules already import TASK_SECTIONS from this file.
export { TASK_SECTIONS } from "../../shared/task/taskTaxonomy.js";
