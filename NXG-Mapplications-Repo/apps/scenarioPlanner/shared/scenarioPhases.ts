// src/apps/scenarioPlanner/shared/scenarioPhases.ts
//
// IRON FORGE 26 phase definitions — used as a dev/offline fallback in
// usePhases when no phasesParam arrives from Workshop.
//
// These match the NxgPhase ontology objects in scenario_iron_forge_26.
// When real Ontology data is wired through the Workshop phasesParam input,
// these are never used.

import type { Phase } from "./types";

export const MOCK_PHASES: Phase[] = [
  // ── Top-level phases ────────────────────────────────────────────────────────
  {
    id: "phase_01",
    name: "Phase 1 — Advance to Contact",
    status: "APPROVED",
    objective: "Establish forward defensive line at Phase Line ODIN.",
    startOffset: 0,
    endOffset: 2,
    unitIds: ["UNIT-1PWRR-BTL", "UNIT-RECCE-TP", "UNIT-BTL-HQ"],
    passCriteria: [
      "Phase Line ODIN secured by D+2",
      "OPFOR lead elements fixed and reported",
      "C2 nodes established under cyber threat",
    ],
    failCriteria: [
      "Phase Line ODIN not reached by D+2",
      "LOC compromised by civilian movement",
    ],
    tasks: [],
    taskIds: ["task_scenario", "task_training_audience", "task_training_objectives", "task_composition", "task_pmesii", "task_exercise_area", "task_mel_mil_p1", "task_orbat_positions"],
    audienceIds: ["audience_primary_div_hq", "audience_j3_ops", "audience_j2_intel"],
    pmesiiDomainIds: ["pmesii_political", "pmesii_military", "pmesii_infrastructure", "pmesii_information", "pmesii_physical_env"],
    objectiveIds: ["to_01", "to_05", "to_06"],
    injectIds: ["inject_01", "inject_02", "inject_03"],
    dependencies: [],
    owner: "1PWRR BG CDR",
  },
  {
    id: "phase_02",
    name: "Phase 2 — Deliberate Attack",
    status: "REVIEW",
    objective: "Seize RIDGELINE AMBER and isolate BRIDGE CLUSTER DELTA.",
    startOffset: 3,
    endOffset: 6,
    unitIds: ["UNIT-A-COY", "UNIT-C-SQN", "UNIT-B-COY"],
    passCriteria: [
      "RIDGELINE AMBER seized",
      "BRIDGE CLUSTER DELTA isolated",
      "OPFOR SOF threat in rear neutralised",
    ],
    failCriteria: [
      "Air support degraded beyond recovery",
      "Divisional logistics node overrun",
    ],
    tasks: [],
    taskIds: ["task_mel_mil_p2", "task_orbat_positions"],
    audienceIds: ["audience_primary_div_hq", "audience_j3_ops", "audience_j4_log"],
    pmesiiDomainIds: ["pmesii_military", "pmesii_infrastructure", "pmesii_physical_env", "pmesii_time"],
    objectiveIds: ["to_03", "to_07"],
    injectIds: ["inject_04", "inject_05"],
    dependencies: ["phase_01"],
    owner: "A COY CDR",
    basedOnPhaseId: "phase_01",
  },
  {
    id: "phase_03",
    name: "Phase 3 — Consolidation and Sustainment",
    status: "DRAFT",
    objective: "Consolidate gains and restore combat power at PORT SOVA.",
    startOffset: 7,
    endOffset: 10,
    unitIds: ["UNIT-1PWRR-BTL", "UNIT-B-COY", "UNIT-MOR-PLT"],
    passCriteria: [
      "PORT SOVA resupply corridor open",
      "Fuel reserves above 30% by D+10",
      "ROE updated and briefed to all callsigns",
    ],
    failCriteria: [
      "Fuel reserves drop below critical threshold",
      "Counter-attack not repelled",
    ],
    tasks: [],
    taskIds: ["task_mel_mil_p3", "task_orbat_positions"],
    audienceIds: ["audience_primary_div_hq", "audience_j4_log", "audience_j6_comms"],
    pmesiiDomainIds: ["pmesii_economic", "pmesii_infrastructure", "pmesii_social", "pmesii_time"],
    objectiveIds: ["to_02", "to_04"],
    injectIds: ["inject_06", "inject_07"],
    dependencies: ["phase_01", "phase_02"],
    owner: "1PWRR BG 2IC",
    basedOnPhaseId: "phase_02",
  },
  {
    id: "phase_04",
    name: "Phase 4 — Information Operations and Transition",
    status: "DRAFT",
    objective: "Defeat OPFOR information operation and transition to Phase Line CAESAR.",
    startOffset: 11,
    endOffset: 14,
    unitIds: ["UNIT-1PWRR-BTL", "UNIT-A-COY", "UNIT-C-SQN", "UNIT-RECCE-TP"],
    passCriteria: [
      "False ceasefire offer countered by STRATCOM",
      "Phase Line CAESAR reached",
      "Transition plan issued to all subordinates",
    ],
    failCriteria: [
      "Information operation degrades cohesion",
      "Offensive momentum lost",
    ],
    tasks: [],
    taskIds: ["task_mel_mil_p4", "task_orbat_positions"],
    audienceIds: ["audience_primary_div_hq", "audience_j2_intel", "audience_j6_comms"],
    pmesiiDomainIds: ["pmesii_political", "pmesii_information", "pmesii_social", "pmesii_time"],
    objectiveIds: ["to_08"],
    injectIds: ["inject_08"],
    dependencies: ["phase_03"],
    owner: "1PWRR BG CDR",
    basedOnPhaseId: "phase_03",
  },

  // ── Branch phases — COA alternatives after Phase 2 ────────────────────────
  // Two alternative approaches branch from Phase 2's end state. Planners can
  // explore both, then pick one when creating Phase 4.
  {
    id: "phase_03a",
    name: "Phase 3A — Tactical Withdrawal",
    status: "DRAFT",
    objective: "Conduct orderly withdrawal from RIDGELINE AMBER to reconstitute combat power at MSR VIKING.",
    startOffset: 7,
    endOffset: 10,
    unitIds: ["UNIT-1PWRR-BTL", "UNIT-B-COY", "UNIT-MOR-PLT"],
    passCriteria: [
      "All callsigns withdrawn to MSR VIKING by D+10",
      "Rearguard established without decisive engagement",
      "Equipment losses below threshold",
    ],
    failCriteria: [
      "Withdrawal becomes a rout",
      "OPFOR pursuit causes significant casualties",
    ],
    tasks: [],
    taskIds: [],
    dependencies: [],
    owner: "1PWRR BG 2IC",
    basedOnPhaseId: "phase_02",
  },
  {
    id: "phase_03b",
    name: "Phase 3B — Exploitation and Pursuit",
    status: "DRAFT",
    objective: "Exploit success at RIDGELINE AMBER — pursue retreating OPFOR to Phase Line THOR and seize PORT SOVA.",
    startOffset: 7,
    endOffset: 10,
    unitIds: ["UNIT-1PWRR-BTL", "UNIT-A-COY", "UNIT-C-SQN", "UNIT-RECCE-TP"],
    passCriteria: [
      "Phase Line THOR secured by D+9",
      "PORT SOVA seized and resupply corridor open",
      "OPFOR combat power degraded below 40%",
    ],
    failCriteria: [
      "OPFOR counter-attack stalls pursuit",
      "Logistics chain fails beyond RIDGELINE AMBER",
    ],
    tasks: [],
    taskIds: [],
    dependencies: [],
    owner: "A COY CDR",
    basedOnPhaseId: "phase_02",
  },
];
