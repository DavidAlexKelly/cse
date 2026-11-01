// ── PPEA Role Map — static seed data + types ───────────────────────────────
// Mirrors the role/phase/task structure from the reference HTML
// (nato_cax_ppea_role_map_5.html).  All content static — no ontology backing.
// State (added/edited roles, tasks, per-operation content) lives in React.

import {
  EXERCISES as SHARED_EXERCISES,
  type ExerciseRecord,
} from "../shared/data/index.js";

export type PhaseId = "plan" | "prepare" | "execute" | "assess";
export type RoleRel = "owner" | "approver" | "involved";

// ── Operation/exercise status for tasks ────────────────────────────────────
export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "ready_for_review"
  | "approved";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  approved: "Approved",
};

export const STATUS_ORDER: TaskStatus[] = [
  "not_started",
  "in_progress",
  "ready_for_review",
  "approved",
];

export interface PpeaRole {
  id: string;
  abbr: string;
  name: string;
  sub: string;
  desc: string;
}

/**
 * A task definition. Identified by a stable string `id` so add/edit/delete
 * is straightforward and Blueprint dependencies can reference it directly.
 *
 *  - `deps` are upstream task ids this task feeds *off of* (incoming edges).
 *    Downstream is derived: any task whose `deps` contains this id.
 */
export interface PpeaTask {
  id: string;
  phase: PhaseId;
  name: string;
  desc: string;
  owner: string[];
  approver: string[];
  involved: string[];
  deps: string[];
}

export interface BpNode {
  id: string;
  label: string;
  phase: PhaseId;
  /** Optional manual coordinates (kept from seed graph for nicer initial
   *  layout).  Newly created tasks omit these — auto-layout fills the gap. */
  col?: number;
  row?: number;
  deps: string[];
}
// ── Operation-specific per-task content ────────────────────────────────────
//
// A small overlay stored per operation.  Maps task id → details + status +
// transition history (audit trail).

export type TaskEventKind =
  | "start"
  | "submit"
  | "approve"
  | "return"
  | "reopen";

export const TASK_EVENT_LABEL: Record<TaskEventKind, string> = {
  start: "Started",
  submit: "Submitted for review",
  approve: "Approved",
  return: "Returned for rework",
  reopen: "Re-opened",
};

/**
 * A single workflow transition.
 *
 * `comment` is required for `return` and `reopen` (approvers must explain why
 * the owner has to rework, or why an approved item is being pulled back).
 * For other event kinds the comment is optional.
 */
export interface TaskEvent {
  id: string;
  kind: TaskEventKind;
  /** Role acting at the time of the event ("Observer" if null). */
  roleId: string | null;
  /** ISO timestamp. */
  timestamp: string;
  /** Optional free-text note. */
  comment?: string;
}

export interface OperationTaskDetails {
  /** Free-text operation-specific content (e.g. concrete scenario notes). */
  content: string;
  status: TaskStatus;
  /** Chronological list of workflow transitions on this task.  Empty for
   *  tasks that have never moved from their initial status. */
  history?: TaskEvent[];
}

export type OperationOverlay = Record<string, OperationTaskDetails>;

// ── Roles seed ─────────────────────────────────────────────────────────────
export const SEED_ROLES: PpeaRole[] = [
  {
    id: "ose",
    abbr: "OSE",
    name: "Officer Scheduling the Exercise",
    sub: "Top-level authority",
    desc: "The highest command authority for the exercise. The OSE sets the overall exercise aim, approves all major objectives, and issues the initial planning directive that launches the planning cycle. The OSE signs off the final scenario package before execution and receives the Lessons Identified Action Plan at the close of the Assess phase.",
  },
  {
    id: "ode",
    abbr: "ODE",
    name: "Officer Directing the Exercise",
    sub: "Exercise design lead",
    desc: "Responsible for the overall design, planning, and quality of the exercise. The ODE translates the OSE's aim into a coherent exercise concept, oversees scenario development, and approves most deliverables produced during Plan and Prepare. The ODE retains oversight during execution and chairs the final AAR approval.",
  },
  {
    id: "opr",
    abbr: "OPR/J7",
    name: "Officer with Primary Responsibility",
    sub: "Staff planning owner",
    desc: "The designated staff officer — typically in the J7/Training branch — who coordinates planning, preparation, execution, and analysis on behalf of the sponsoring HQ. The OPR is the day-to-day planning manager, primary point of contact for exercise administration, and co-owns the final scenario publication and lessons reporting.",
  },
  {
    id: "exdir",
    abbr: "EXDIR",
    name: "Exercise Director",
    sub: "EXCON command",
    desc: "Commands the Exercise Control (EXCON) organisation during the execution phase. The EXDIR is responsible for the overall direction and coherent flow of the exercise, ensures training objectives are being met, and is the authority for all EXCON decisions during play. The EXDIR also leads the After Action Review.",
  },
  {
    id: "cexcon",
    abbr: "C-EXCON",
    name: "Chief EXCON",
    sub: "Execution team lead",
    desc: "Leads the operational day-to-day running of the EXCON team during execution. The Chief EXCON synchronises HICON, LOCON, the MEL/MIL cell, and the simulation team, chairs daily EXCON coordination meetings, and maintains exercise tempo. They act as approver for most execution-phase tasks.",
  },
  {
    id: "ewt",
    abbr: "EWT",
    name: "Exercise Writing Team",
    sub: "Scenario & MEL/MIL authors",
    desc: "The core creative and technical team responsible for designing the exercise scenario, scripting MEL/MIL events, and drafting exercise documentation. The EWT translates high-level objectives into a playable scenario, defines the exercise fiction, and ensures internal consistency across all scenario elements.",
  },
  {
    id: "sme",
    abbr: "SME",
    name: "Subject Matter Experts",
    sub: "Domain specialists",
    desc: "Specialists who provide domain-specific expertise across areas such as joint operations, logistics, cyber, CIMIC, or specific national force structures. SMEs validate the realism of scenario elements — particularly PMSEII variables, ORBAT compositions, and MEL/MIL events.",
  },
  {
    id: "caxmgr",
    abbr: "CAX Mgr",
    name: "CAX Manager",
    sub: "Simulation oversight",
    desc: "Oversees all simulation activities for the exercise. The CAX Manager ensures AMSP-03 standards compliance, approves the scenario database built by the DB Manager, and ensures the technical simulation environment (JTLS/JCATS) is correctly configured.",
  },
  {
    id: "dbmgr",
    abbr: "DB Mgr",
    name: "Database Manager",
    sub: "ORBAT & scenario DB",
    desc: "Builds and maintains the simulation scenario database. This includes entering all force structures (ORBAT), unit positions, compositions, and equipment parameters into the simulation system. During execution, operates the simulation in real time.",
  },
  {
    id: "hicon",
    abbr: "HICON",
    name: "Higher Control Cell",
    sub: "Plays superior HQ",
    desc: "Represents the higher command chain above the Training Audience — typically NATO HQ, SHAPE, or operational-level commands. HICON issues orders, policy guidance, and information to the TA to drive training opportunities.",
  },
  {
    id: "locon",
    abbr: "LOCON",
    name: "Lower Control Cell",
    sub: "Plays subordinate forces",
    desc: "Simulates all forces subordinate to the Training Audience. Response Cell planners interpret TA orders and plan subordinate actions doctrinally; the Battle Captain converts these into simulation directives.",
  },
  {
    id: "melmil",
    abbr: "MEL/MIL",
    name: "MEL/MIL Coordinator",
    sub: "Events & incidents flow",
    desc: "Manages the Master Events List (MEL) and Master Incidents List (MIL) — the scripted sequence of events injected to drive training objectives. During Execute, they time and release events through HICON and LOCON.",
  },
  {
    id: "ot",
    abbr: "O/T",
    name: "Observer / Trainer",
    sub: "Embedded with TA",
    desc: "Embedded directly with Training Audience units to observe performance against training objectives. O/Ts provide real-time coaching, capture observations for the AAR, and feed evaluation data to the DIREVAL.",
  },
  {
    id: "direval",
    abbr: "DIREVAL",
    name: "Director of Evaluation",
    sub: "Assessment lead",
    desc: "Coordinates all evaluation and assessment activities throughout execution and into the Assess phase. The DIREVAL manages evaluation teams, collects observations, facilitates the AAR, and produces the Lessons Identified report.",
  },
  {
    id: "ta",
    abbr: "TA",
    name: "Training Audience",
    sub: "HQ / unit being trained",
    desc: "The headquarters, unit, or formation the exercise is designed to train. The TA receives injects from HICON, issues orders to LOCON, and conducts military planning as if the exercise were a real operation.",
  },
];

// ── Phase metadata ─────────────────────────────────────────────────────────

export const PHASE_LABELS: Record<PhaseId, string> = {
  plan: "Plan",
  prepare: "Prepare",
  execute: "Execute",
  assess: "Assess",
};

/** Colour palette used in the dark theme for each phase. */
export const PHASE_COLORS: Record<
  PhaseId,
  {
    accent: string;
    bg: string;
    border: string;
    text: string;
    label: string;
    labelBg: string;
  }
> = {
  plan: {
    accent: "#5B82B4",
    bg: "#10223D",
    border: "#3B6AAF",
    text: "#8EB8F0",
    label: "#4c7ef3",
    labelBg: "rgba(59,95,160,.15)",
  },
  prepare: {
    accent: "#24b47e",
    bg: "#0E2A1F",
    border: "#2A7A52",
    text: "#6ee7b7",
    label: "#3A9E6A",
    labelBg: "rgba(26,122,82,.15)",
  },
  execute: {
    accent: "#e08a2a",
    bg: "#2E1B08",
    border: "#B86A10",
    text: "#f5b955",
    label: "#e08a2a",
    labelBg: "rgba(184,106,16,.15)",
  },
  assess: {
    accent: "#d05aa8",
    bg: "#2A0E20",
    border: "#8A3060",
    text: "#e79ecb",
    label: "#d05aa8",
    labelBg: "rgba(138,48,96,.15)",
  },
};

export const PHASE_ORDER: PhaseId[] = ["plan", "prepare", "execute", "assess"];
// ── Status visuals ─────────────────────────────────────────────────────────

export const STATUS_COLORS: Record<TaskStatus, string> = {
  not_started: "#6a7292",
  in_progress: "#f0a83c",
  ready_for_review: "#4c7ef3",
  approved: "#6c5ce7",
};

// ── Seed tasks ─────────────────────────────────────────────────────────────
//
// Each task has a stable id used by deps + the BP layout map.

export const SEED_TASKS: PpeaTask[] = [
  // ── Plan ───────────────────────────────────────────────────────────────
  {
    id: "P1",
    phase: "plan",
    name: "Define exercise aim & objectives",
    desc: "The OSE and ODE jointly determine the overarching purpose of the exercise — what capability or readiness gap it addresses, and what success looks like. This produces the formal Exercise Aim statement and the initial Training Objectives that all subsequent planning must serve.",
    owner: ["ose", "ode"],
    approver: ["ose"],
    involved: ["opr"],
    deps: [],
  },
  {
    id: "P2",
    phase: "plan",
    name: "Develop exercise concept",
    desc: "The ODE and OPR translate the approved aim into an Exercise Concept document describing the broad scenario setting, exercise type, timeline, command relationships, and resources required.",
    owner: ["ode", "opr"],
    approver: ["ose"],
    involved: ["ewt", "sme"],
    deps: ["P1"],
  },
  {
    id: "P3",
    phase: "plan",
    name: "Identify training audience",
    desc: "The OPR formally designates which headquarters, formation, or unit will be the Training Audience, determining the command level, ORBAT, and EXCON scale required.",
    owner: ["opr"],
    approver: ["ode"],
    involved: ["ose"],
    deps: ["P2"],
  },
  {
    id: "P4",
    phase: "plan",
    name: "Set PMSEII variables & scenario outline",
    desc: "The EWT and SMEs define the Political, Military, Social, Economic, Infrastructure, and Information conditions of the fictional operational environment.",
    owner: ["ewt", "sme"],
    approver: ["ode"],
    involved: ["opr", "caxmgr"],
    deps: ["P1"],
  },
  {
    id: "P5",
    phase: "plan",
    name: "Define exercise area",
    desc: "Selection and definition of the geographic area of operations, confirming it supports the scenario and is compatible with the simulation system's database.",
    owner: ["ewt"],
    approver: ["ode"],
    involved: ["sme", "dbmgr"],
    deps: ["P4"],
  },
  {
    id: "P6",
    phase: "plan",
    name: "Issue initial planning directive",
    desc: "The OSE formally initiates the exercise planning cycle by issuing a directive that authorises the exercise, names key appointments, and establishes the planning timeline.",
    owner: ["ose"],
    approver: [],
    involved: ["ode", "opr"],
    deps: ["P3", "P5"],
  },

  // ── Prepare ────────────────────────────────────────────────────────────
  {
    id: "PR1",
    phase: "prepare",
    name: "Design scenario & workflow",
    desc: "The EWT authors the full narrative scenario and designs the workflow structure mapping tasks to approvers and task owners, validated by SMEs and the CAX Manager.",
    owner: ["ewt"],
    approver: ["ode", "opr"],
    involved: ["sme", "caxmgr"],
    deps: ["P6"],
  },
  {
    id: "PR2",
    phase: "prepare",
    name: "Define / review training audience",
    desc: "A formal review confirming and documenting the Training Audience structure — which units participate, their command relationships, and how they interact with EXCON.",
    owner: ["opr"],
    approver: ["ode"],
    involved: ["ta"],
    deps: ["P3", "PR1"],
  },
  {
    id: "PR3",
    phase: "prepare",
    name: "Define / review PMSEII variables",
    desc: "A detailed elaboration of the PMSEII conditions producing the full operational environment documentation used by the EWT and HICON.",
    owner: ["ewt", "sme"],
    approver: ["ode"],
    involved: ["caxmgr"],
    deps: ["P4", "PR1"],
  },
  {
    id: "PR4",
    phase: "prepare",
    name: "Define / review training objectives",
    desc: "Training Objectives define what the TA will practice, how performance will be assessed, and which MEL/MIL events are needed to generate those training opportunities.",
    owner: ["opr", "ewt"],
    approver: ["ode"],
    involved: ["ot", "direval"],
    deps: ["PR2", "PR3"],
  },
  {
    id: "PR5",
    phase: "prepare",
    name: "Define / review exercise area",
    desc: "A detailed review confirming the geographic exercise area supports all planned training objectives and is correctly represented in the simulation database.",
    owner: ["ewt"],
    approver: ["ode"],
    involved: ["dbmgr", "sme"],
    deps: ["P5", "PR1"],
  },
  {
    id: "PR6",
    phase: "prepare",
    name: "Define / review MEL & MIL (+unit tasks)",
    desc: "The MEL/MIL Coordinator and EWT script all events and incidents, mapping each to a training objective and assigning it to HICON or LOCON for injection.",
    owner: ["melmil", "ewt"],
    approver: ["ode", "opr"],
    involved: ["hicon", "locon"],
    deps: ["PR4", "PR5"],
  },
  {
    id: "PR7",
    phase: "prepare",
    name: "Define / review ORBAT & Positions",
    desc: "The DB Manager builds the full force structure — all friendly, opposing, and neutral units, their equipment, and initial positions — in the simulation system.",
    owner: ["dbmgr"],
    approver: ["caxmgr"],
    involved: ["ewt", "sme"],
    deps: ["PR3", "PR5"],
  },
  {
    id: "PR8",
    phase: "prepare",
    name: "Define / review Composition",
    desc: "Detailed definition of equipment tables and unit compositions — vehicles, weapons systems, personnel, and logistics holdings for each simulated unit.",
    owner: ["dbmgr"],
    approver: ["caxmgr"],
    involved: ["ewt"],
    deps: ["PR7"],
  },
  {
    id: "PR9",
    phase: "prepare",
    name: "Build scenario database",
    desc: "The DB Manager populates the simulation system with all validated data: ORBAT, compositions, positions, terrain overlays, supply routes, and initial conditions.",
    owner: ["dbmgr"],
    approver: ["caxmgr"],
    involved: ["ewt"],
    deps: ["PR7", "PR8"],
  },
  {
    id: "PR10",
    phase: "prepare",
    name: "Assign approvers & task owners",
    desc: "The OPR formally assigns an approver and task owner to each item in the exercise workflow, establishing accountability for every preparatory task.",
    owner: ["opr"],
    approver: ["ode"],
    involved: ["exdir"],
    deps: ["PR4"],
  },
  {
    id: "PR11",
    phase: "prepare",
    name: "Technical control & CIS setup",
    desc: "The CAX Manager configures the full technical environment including simulation servers, network connections, and workstation allocation for HICON and LOCON cells.",
    owner: ["caxmgr"],
    approver: ["exdir"],
    involved: ["dbmgr"],
    deps: ["PR9"],
  },
  {
    id: "PR12",
    phase: "prepare",
    name: "Verify & publish scenario package",
    desc: "A final end-to-end review of all exercise products. Once approved by the OSE, the scenario package is published to all participants, formally closing the Prepare phase.",
    owner: ["ode", "opr"],
    approver: ["ose"],
    involved: ["ewt", "caxmgr", "exdir"],
    deps: ["PR6", "PR9", "PR10", "PR11"],
  },

  // ── Execute ────────────────────────────────────────────────────────────
  {
    id: "E1",
    phase: "execute",
    name: "Direct overall exercise conduct",
    desc: "The EXDIR holds authority over the entire exercise execution, sets the daily rhythm, resolves disputes, and ensures training objectives remain the guiding priority.",
    owner: ["exdir"],
    approver: ["ode"],
    involved: ["cexcon"],
    deps: ["PR12"],
  },
  {
    id: "E2",
    phase: "execute",
    name: "Control exercise flow (EXCON)",
    desc: "The Chief EXCON manages the operational coordination of all EXCON elements — synchronising MEL/MIL injections, managing simulation state, and maintaining exercise tempo.",
    owner: ["cexcon"],
    approver: ["exdir"],
    involved: ["hicon", "locon", "melmil"],
    deps: ["E1"],
  },
  {
    id: "E3",
    phase: "execute",
    name: "Play superior HQ injects (HICON)",
    desc: "HICON acts as the higher command chain above the TA — issuing operational orders, policy guidance, and political direction to drive training challenges.",
    owner: ["hicon"],
    approver: ["cexcon"],
    involved: ["melmil", "ewt"],
    deps: ["E2"],
  },
  {
    id: "E4",
    phase: "execute",
    name: "Simulate lower-level forces (LOCON)",
    desc: "LOCON simulates all forces subordinate to the TA, interpreting TA orders and planning subordinate actions doctrinally through the Battle Captain.",
    owner: ["locon"],
    approver: ["cexcon"],
    involved: ["melmil"],
    deps: ["E2"],
  },
  {
    id: "E5",
    phase: "execute",
    name: "Inject MEL/MIL events",
    desc: "The MEL/MIL Coordinator releases scripted events on schedule — or adjusts timing based on tempo — through HICON and LOCON to maintain training objectives coverage.",
    owner: ["melmil"],
    approver: ["cexcon"],
    involved: ["hicon", "locon", "ewt"],
    deps: ["E3", "E4"],
  },
  {
    id: "E6",
    phase: "execute",
    name: "Operate simulation (JTLS/JCATS)",
    desc: "The DB Manager and CAX operators run the simulation in real time, entering directives, resolving adjudication, and maintaining an accurate common operating picture.",
    owner: ["dbmgr", "caxmgr"],
    approver: ["cexcon"],
    involved: ["locon"],
    deps: ["E4", "E5"],
  },
  {
    id: "E7",
    phase: "execute",
    name: "Observe & mentor TA",
    desc: "Observer/Trainers embedded with TA units observe performance against training objectives, provide real-time coaching, and capture observations for the AAR.",
    owner: ["ot"],
    approver: ["direval"],
    involved: ["sme"],
    deps: ["E2"],
  },
  {
    id: "E8",
    phase: "execute",
    name: "Conduct TA planning & execution",
    desc: "The Training Audience conducts their mission as if it were a real operation, receiving direction from HICON and issuing orders to LOCON without knowledge of the script.",
    owner: ["ta"],
    approver: [],
    involved: ["ot", "hicon"],
    deps: ["E3", "E4", "E7"],
  },

  // ── Assess ─────────────────────────────────────────────────────────────
  {
    id: "A1",
    phase: "assess",
    name: "Coordinate evaluation teams",
    desc: "The DIREVAL organises all evaluation efforts — assigning O/Ts to specific Training Objectives and managing the flow of evaluation data to the assessment team.",
    owner: ["direval"],
    approver: ["exdir"],
    involved: ["ot", "opr"],
    deps: ["E1", "E7"],
  },
  {
    id: "A2",
    phase: "assess",
    name: "Collect observations & lessons",
    desc: "O/Ts and the DIREVAL consolidate raw observations into structured findings mapped to Training Objectives, forming the evidence base for the AAR.",
    owner: ["ot", "direval"],
    approver: ["direval"],
    involved: ["ta", "cexcon"],
    deps: ["E7", "A1"],
  },
  {
    id: "A3",
    phase: "assess",
    name: "Conduct After Action Review (AAR)",
    desc: "A structured debrief with the Training Audience reviewing performance against each Training Objective. The EXDIR and DIREVAL lead the AAR, the primary learning event of the exercise.",
    owner: ["exdir", "direval"],
    approver: ["ode"],
    involved: ["ta", "ot", "cexcon"],
    deps: ["A2"],
  },
  {
    id: "A4",
    phase: "assess",
    name: "Produce lessons identified report",
    desc: "The DIREVAL and OPR compile the formal Lessons Identified report consolidating observations, AAR outcomes, and recommended remedial actions.",
    owner: ["direval", "opr"],
    approver: ["ode"],
    involved: ["ose"],
    deps: ["A3"],
  },
  {
    id: "A5",
    phase: "assess",
    name: "Issue Lessons Identified Action Plan",
    desc: "The OSE issues the final LIAP, assigning responsibility for each remedial action with a target completion date, closing the PPEA cycle.",
    owner: ["ose"],
    approver: [],
    involved: ["ode", "opr", "direval"],
    deps: ["A4"],
  },
];

// ── Seed blueprint layout coordinates (only for seed tasks) ────────────────

export const SEED_BP_COORDS: Record<string, { col: number; row: number }> = {
  P1: { col: 0, row: 0 },
  P2: { col: 0, row: 1 },
  P3: { col: 0, row: 2 },
  P4: { col: 1, row: 1 },
  P5: { col: 1, row: 2 },
  P6: { col: 0, row: 3 },
  PR1: { col: 2, row: 0 },
  PR2: { col: 2, row: 1 },
  PR3: { col: 3, row: 0 },
  PR4: { col: 2, row: 2 },
  PR5: { col: 3, row: 1 },
  PR6: { col: 3, row: 2 },
  PR7: { col: 4, row: 1 },
  PR8: { col: 4, row: 2 },
  PR9: { col: 4, row: 3 },
  PR10: { col: 2, row: 3 },
  PR11: { col: 4, row: 4 },
  PR12: { col: 3, row: 4 },
  E1: { col: 5, row: 0 },
  E2: { col: 5, row: 1 },
  E3: { col: 5, row: 2 },
  E4: { col: 6, row: 2 },
  E5: { col: 5, row: 3 },
  E6: { col: 6, row: 3 },
  E7: { col: 7, row: 2 },
  E8: { col: 7, row: 3 },
  A1: { col: 8, row: 1 },
  A2: { col: 8, row: 2 },
  A3: { col: 8, row: 3 },
  A4: { col: 8, row: 4 },
  A5: { col: 8, row: 5 },
};

// ── Seed operation overlay for IRON FORGE 26 ───────────────────────────────
//
// Concise, demo-ready content based on the shared IRON FORGE 26 / Sorvian
// Peninsula Crisis seed data (scenarios.json, workflowTask.json).  Kept
// short on purpose so the modal stays scannable.
//
// Distribution covers all four task states:
//   approved          — earliest Plan items, locked
//   ready_for_review  — late-Plan / early-Prepare deliverables awaiting sign-off
//   in_progress       — current focus of EWT/DB Mgr/MEL-MIL
//   not_started       — remaining Prepare items, all of Execute & Assess

export const SEED_IRON_FORGE_OVERLAY: OperationOverlay = {
  P1: {
    status: "approved",
    content:
      "Aim: Validate a Multinational Division HQ for Article 4 deployment to the Sorvian Peninsula under high-intensity conventional threat with simultaneous information and cyber operations.",
  },
  P2: {
    status: "approved",
    content:
      "CAX, 14 days, D-Day = MNDIV assumes OPCON. Eastern Flank context. Sponsor: NATO HQ. Director: EXDIR Brig.Gen. Hartmann.",
  },
  P3: {
    status: "approved",
    content:
      "TA: MNDIV HQ (primary) + J3 Ops, J2 Intel, J4 Log, J6 Comms (secondary). Lead nation confirmed.",
  },
  P4: {
    status: "ready_for_review",
    content:
      "PMSEII outline locked for P/M/S/E/I; environment and time still TBC. Hostile media environment, near-peer OPFOR at 55% readiness.",
  },
  P5: {
    status: "approved",
    content:
      "AOR: Sorvian Peninsula. Key features: Port of Sova, Ridgeline Amber, Bridge Delta. Compatible with JTLS-GO terrain set.",
  },
  P6: {
    status: "approved",
    content:
      "Planning directive issued D-180. Appointments confirmed: OSE, ODE, OPR/J7, EXDIR, CAX Mgr, DIREVAL.",
  },

  PR1: {
    status: "ready_for_review",
    content:
      "Scenario draft v3 — Sorvian Peninsula Crisis. Workflow mapped: 8 deliverables, owners + approvers assigned. SME review pending.",
    history: [
      {
        id: "seed_pr1_1",
        kind: "start",
        roleId: "ewt",
        timestamp: "2026-01-12T09:15:00Z",
      },
      {
        id: "seed_pr1_2",
        kind: "submit",
        roleId: "ewt",
        timestamp: "2026-02-03T16:42:00Z",
      },
      {
        id: "seed_pr1_3",
        kind: "return",
        roleId: "ode",
        timestamp: "2026-02-05T10:05:00Z",
        comment:
          "Scenario v2 missed cyber inject coverage for J6 TOs — please integrate two MEL cyber events before resubmitting.",
      },
      {
        id: "seed_pr1_4",
        kind: "submit",
        roleId: "ewt",
        timestamp: "2026-02-18T14:20:00Z",
      },
    ],
  },
  PR2: {
    status: "ready_for_review",
    content:
      "TA structure confirmed; participant counts validated for 4 of 5 nations. Awaiting final numbers from lead nation.",
  },
  PR3: {
    status: "in_progress",
    content:
      "5 of 8 PMESII-PT domains complete. Infrastructure, Physical Environment, Time still pending.",
  },
  PR4: {
    status: "in_progress",
    content:
      "8 training objectives drafted across J-directorates. Priority lock complete; inject mapping in progress.",
  },
  PR5: {
    status: "in_progress",
    content:
      "AOR confirmed against TOs. Phase lines drafted, awaiting J3 review.",
  },
  PR6: {
    status: "in_progress",
    content:
      "47 MEL/MIL events drafted; 28 mapped to a TO. HICON/LOCON assignment ~60% complete.",
  },
  PR7: {
    status: "not_started",
    content: "",
  },
  PR8: {
    status: "not_started",
    content: "",
  },
  PR9: {
    status: "not_started",
    content: "",
  },
  PR10: {
    status: "ready_for_review",
    content:
      "Owners and approvers assigned to all 8 Prepare tasks. EXDIR review outstanding.",
  },
  PR11: {
    status: "not_started",
    content: "",
  },
  PR12: {
    status: "not_started",
    content: "",
  },

  E1: { status: "not_started", content: "" },
  E2: { status: "not_started", content: "" },
  E3: { status: "not_started", content: "" },
  E4: { status: "not_started", content: "" },
  E5: { status: "not_started", content: "" },
  E6: { status: "not_started", content: "" },
  E7: { status: "not_started", content: "" },
  E8: { status: "not_started", content: "" },

  A1: { status: "not_started", content: "" },
  A2: { status: "not_started", content: "" },
  A3: { status: "not_started", content: "" },
  A4: { status: "not_started", content: "" },
  A5: { status: "not_started", content: "" },
};

// ── Operations ─────────────────────────────────────────────────────────────
//
// Pulled from the shared `exercises.json` so we re-use any operations that
// other widgets already know about.  We mark IRON FORGE 26 as the default
// active operation.

export interface PpeaOperation {
  id: string;
  name: string;
  /** Short display name (e.g. "IRON FORGE 26"). */
  shortName: string;
}

function shortenExerciseName(name: string): string {
  // "Exercise IRON FORGE 26" → "IRON FORGE 26"
  return name.replace(/^Exercise\s+/i, "");
}

function exerciseToOperation(e: ExerciseRecord): PpeaOperation {
  return {
    id: e.exerciseId,
    name: e.name,
    shortName: shortenExerciseName(e.name),
  };
}

export const OPERATIONS: PpeaOperation[] =
  SHARED_EXERCISES.map(exerciseToOperation);

export const DEFAULT_OPERATION_ID: string =
  OPERATIONS.find((o) => /iron\s*forge/i.test(o.name))?.id ??
  OPERATIONS[0]?.id ??
  "exercise_iron_forge_26";

// ── Lookup helpers ─────────────────────────────────────────────────────────

export const roleById = (roles: PpeaRole[], id: string): PpeaRole | undefined =>
  roles.find((r) => r.id === id);
export const isInTask = (t: PpeaTask, id: string): boolean =>
  t.owner.includes(id) || t.approver.includes(id) || t.involved.includes(id);

export const roleTypeFor = (t: PpeaTask, id: string): RoleRel | null =>
  t.owner.includes(id)
    ? "owner"
    : t.approver.includes(id)
    ? "approver"
    : t.involved.includes(id)
    ? "involved"
    : null;
