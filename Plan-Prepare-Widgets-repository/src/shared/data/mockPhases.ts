// ============================================================
// Rich mock data for the Phases widget.
// Extends PhaseRecord with all fields needed to render the
// phase cards demo-ready without any ontology backing.
//
// The 4 phases come from NxgPhase in the ontology (phaseId,
// phaseName, phaseDescription, objectiveStatement, startOffset,
// endOffset, phaseStatus, sequenceNumber).
//
// Everything else (startDate, endDate, durationDays, stats,
// gaps, readinessPct) is mock-enriched here so the cards are
// always fully populated demo-ready.
//
// The widget hook merges live ontology fields on top of these
// stubs — ontology values always win for the fields they carry.
// ============================================================

import { phaseDisplayLabel } from "../hooks/useNxgPhases.js";

export interface PhaseGap {
  gapId: string;
  description: string;
  severity: "warning" | "critical";
}

export interface RichPhaseRecord {
  // ── From NxgPhase (ontology) ──────────────────────────────
  phaseId: string;
  phaseName: string;
  phaseTitle: string; // maps to phaseName display label
  phaseDescription: string;
  objectiveStatement: string;
  startOffset: string;
  endOffset: string;
  phaseStatus:
    | "approved"
    | "validated"
    | "needs-review"
    | "draft"
    | "planning"
    | "active";
  sequenceNumber: number;
  scenarioId: string;
  // ── Mock-enriched ─────────────────────────────────────────
  startDate: string;
  endDate: string;
  durationDays: number;
  readinessPct: number;
  // Stats
  activeActors: number;
  orbatEntities: number;
  openTasks: number;
  unassignedMil: number;
  melCount: number;
  milCount: number;
  injectReviewCount: number;
  // Gaps
  gaps: PhaseGap[];
}

// Keyed by phaseId so the hook can do an O(1) merge
export const MOCK_PHASE_EXTRAS: Record<
  string,
  Omit<
    RichPhaseRecord,
    | "phaseId"
    | "phaseName"
    | "phaseTitle"
    | "phaseDescription"
    | "objectiveStatement"
    | "startOffset"
    | "endOffset"
    | "phaseStatus"
    | "sequenceNumber"
    | "scenarioId"
  >
> = {
  phase_01: {
    startDate: "10 Mar 2026",
    endDate: "11 Mar 2026",
    durationDays: 2,
    readinessPct: 87,
    activeActors: 0,
    orbatEntities: 0,
    openTasks: 0,
    unassignedMil: 0,
    melCount: 0,
    milCount: 0,
    injectReviewCount: 0,
    gaps: [],
  },
  phase_02: {
    startDate: "12 Mar 2026",
    endDate: "13 Mar 2026",
    durationDays: 2,
    readinessPct: 74,
    activeActors: 3,
    orbatEntities: 4,
    openTasks: 2,
    unassignedMil: 0,
    melCount: 3,
    milCount: 3,
    injectReviewCount: 2,
    gaps: [
      {
        gapId: "gap_ph1_01",
        description:
          "INTEL inject coverage for D+1 morning is sparse — only 1 of 4 planned injects authored.",
        severity: "warning",
      },
    ],
  },
  phase_03: {
    startDate: "14 Mar 2026",
    endDate: "17 Mar 2026",
    durationDays: 4,
    readinessPct: 52,
    activeActors: 4,
    orbatEntities: 3,
    openTasks: 5,
    unassignedMil: 1,
    melCount: 7,
    milCount: 6,
    injectReviewCount: 10,
    gaps: [
      {
        gapId: "gap_ph2_01",
        description: "MEL/MIL inject owners not yet assigned for D-14 window.",
        severity: "warning",
      },
      {
        gapId: "gap_ph2_02",
        description:
          "ORBAT start positions blocked — Exercise Area boundary not finalised.",
        severity: "critical",
      },
    ],
  },
  phase_04: {
    startDate: "18 Mar 2026",
    endDate: "20 Mar 2026",
    durationDays: 3,
    readinessPct: 31,
    activeActors: 1,
    orbatEntities: 0,
    openTasks: 3,
    unassignedMil: 2,
    melCount: 4,
    milCount: 2,
    injectReviewCount: 4,
    gaps: [
      {
        gapId: "gap_ph3_01",
        description:
          "Rehearsal date not yet confirmed with all contributing nations.",
        severity: "warning",
      },
      {
        gapId: "gap_ph3_02",
        description: "Federation architecture integration test not scheduled.",
        severity: "critical",
      },
      {
        gapId: "gap_ph3_03",
        description: "AAR observers not assigned to Phase 4.",
        severity: "warning",
      },
    ],
  },
};

// Full fallback used when the ontology is unreachable
export const MOCK_RICH_PHASES: RichPhaseRecord[] = [
  {
    phaseId: "phase_01",
    phaseName: phaseDisplayLabel(1),
    phaseTitle: "Initiation",
    phaseDescription:
      "Initiation — exercise design, audience definition and governance",
    objectiveStatement:
      "Establish exercise governance, confirm training audience and lock strategic context",
    startOffset: "D-90",
    endOffset: "D-60",
    phaseStatus: "active",
    sequenceNumber: 1,
    scenarioId: "scenario_iron_forge_26",
    ...MOCK_PHASE_EXTRAS["phase_01"]!,
  },
  {
    phaseId: "phase_02",
    phaseName: phaseDisplayLabel(2),
    phaseTitle: "Scenario Design",
    phaseDescription:
      "Scenario Design — OPFOR, terrain, PMESII variables and phase lines",
    objectiveStatement:
      "Define full scenario narrative, OPFOR doctrine and operational environment",
    startOffset: "D-60",
    endOffset: "D-30",
    phaseStatus: "active",
    sequenceNumber: 2,
    scenarioId: "scenario_iron_forge_26",
    ...MOCK_PHASE_EXTRAS["phase_02"]!,
  },
  {
    phaseId: "phase_03",
    phaseName: phaseDisplayLabel(3),
    phaseTitle: "Execution Planning",
    phaseDescription:
      "Execution Planning — MEL/MIL, ORBAT, start positions and inject scheduling",
    objectiveStatement:
      "Produce complete MEL/MIL, assign inject owners and confirm ORBAT start positions",
    startOffset: "D-30",
    endOffset: "D-7",
    phaseStatus: "planning",
    sequenceNumber: 3,
    scenarioId: "scenario_iron_forge_26",
    ...MOCK_PHASE_EXTRAS["phase_03"]!,
  },
  {
    phaseId: "phase_04",
    phaseName: phaseDisplayLabel(4),
    phaseTitle: "Rehearsal & Final Checks",
    phaseDescription:
      "Rehearsal & Final Checks — dry-run, AAR prep and system integration tests",
    objectiveStatement:
      "Complete full rehearsal, validate federation architecture and lock final inject list",
    startOffset: "D-7",
    endOffset: "D+0",
    phaseStatus: "planning",
    sequenceNumber: 4,
    scenarioId: "scenario_iron_forge_26",
    ...MOCK_PHASE_EXTRAS["phase_04"]!,
  },
];
