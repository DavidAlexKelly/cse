// ============================================================
// Mock / seed data for the Scenario Dashboard widget.
// Used as a graceful fallback when the ontology is unavailable
// or no scenario parameter has been bound in Workshop.
// All data reflects the fictional Exercise IRON FORGE 26 world.
// ============================================================

import type { ScenarioContext } from "../hooks/useNxgScenario.js";
import type { PhaseRecord } from "../hooks/useNxgPhases.js";
import { phaseDisplayLabel } from "../hooks/useNxgPhases.js";
import type { TrainingObjectiveRecord } from "./index.js";

// ── Scenario ──────────────────────────────────────────────────────────────

export const MOCK_SCENARIO: ScenarioContext = {
  scenarioId: "scenario_iron_forge_26",
  scenarioName: "Exercise IRON FORGE 26",
  scenarioType: "CAX",
  classification: "NATO UNCLASSIFIED",
  scenarioStatus: "active",
  overallProgressPct: 42,
  currentPhase: phaseDisplayLabel(1),
  strategicContextTitle: "The Sorvian Peninsula Crisis",
  strategicContextBody:
    "The fictional state of Sorvia, bordering the Eastern Flank, has experienced rapid deterioration of the security environment following contested elections and external interference by the Dorvian Federation. NATO has activated Article 4 consultations and deployed a Multinational Division to the region. The exercise begins at D-Day with the division assuming operational control of the assigned area under conditions of a high-intensity conventional threat combined with significant information operations and cyber activity targeting allied C2 nodes.",
  aiGenerated: true,
  // Seed D-Day so offset-to-date resolution has something to work
  // with in demo mode. Real scenarios carry this on NxgScenario.
  dDay: "2026-03-02",
};

// ── Phases ────────────────────────────────────────────────────────────────
// readinessPct is a mock planning-readiness score per phase (0–100)

export const MOCK_PHASES: (PhaseRecord & { readinessPct: number })[] = [
  {
    phaseId: "phase_01",
    phaseName: "Phase 1",
    displayLabel: phaseDisplayLabel(1),
    phaseDescription:
      "Initiation — exercise design, audience definition and governance",
    objectiveStatement:
      "Establish exercise governance, confirm training audience and lock strategic context",
    startOffset: "D-90",
    endOffset: "D-60",
    phaseStatus: "active",
    sequenceNumber: 1,
    scenarioId: "scenario_iron_forge_26",
    readinessPct: 87,
  },
  {
    phaseId: "phase_02",
    phaseName: "Phase 2",
    displayLabel: phaseDisplayLabel(2),
    phaseDescription:
      "Scenario Design — OPFOR, terrain, PMESII variables and phase lines",
    objectiveStatement:
      "Define full scenario narrative, OPFOR doctrine and operational environment",
    startOffset: "D-60",
    endOffset: "D-30",
    phaseStatus: "active",
    sequenceNumber: 2,
    scenarioId: "scenario_iron_forge_26",
    readinessPct: 74,
  },
  {
    phaseId: "phase_03",
    phaseName: "Phase 3",
    displayLabel: phaseDisplayLabel(3),
    phaseDescription:
      "Execution Planning — MEL/MIL, ORBAT, start positions and inject scheduling",
    objectiveStatement:
      "Produce complete MEL/MIL, assign inject owners and confirm ORBAT start positions",
    startOffset: "D-30",
    endOffset: "D-7",
    phaseStatus: "planning",
    sequenceNumber: 3,
    scenarioId: "scenario_iron_forge_26",
    readinessPct: 52,
  },
  {
    phaseId: "phase_04",
    phaseName: "Phase 4",
    displayLabel: phaseDisplayLabel(4),
    phaseDescription:
      "Rehearsal & Final Checks — dry-run, AAR prep and system integration tests",
    objectiveStatement:
      "Complete full rehearsal, validate federation architecture and lock final inject list",
    startOffset: "D-7",
    endOffset: "D+0",
    phaseStatus: "planning",
    sequenceNumber: 4,
    scenarioId: "scenario_iron_forge_26",
    readinessPct: 31,
  },
];

// ── Tasks ─────────────────────────────────────────────────────────────────
// Single canonical task list — shared by Dashboard, Task Management, and
// Task Assignment widgets.  Import MOCK_WORKFLOW_TASKS from mockData.ts for
// full detail; this re-export keeps the dashboard hook unchanged.

export { MOCK_WORKFLOW_TASKS as MOCK_TASKS } from "../../task-manager/task-assignment/mockData.js";

// ── Training Objectives ───────────────────────────────────────────────────
// coveragePct is a mock inject-coverage score per objective (0–100)

export interface MockTrainingObjective extends TrainingObjectiveRecord {
  coveragePct: number;
}

export const MOCK_TRAINING_OBJECTIVES: MockTrainingObjective[] = [
  {
    objectiveId: "to_01",
    ref: "TO-01",
    objective: "Multinational HQ coordination",
    functionalArea: "C2",
    priority: "High",
    coveragePct: 88,
  },
  {
    objectiveId: "to_02",
    ref: "TO-02",
    objective: "Shared operational picture",
    functionalArea: "Staff Integration",
    priority: "High",
    coveragePct: 81,
  },
  {
    objectiveId: "to_03",
    ref: "TO-03",
    objective: "Command decision-making",
    functionalArea: "Fires",
    priority: "High",
    coveragePct: 76,
  },
  {
    objectiveId: "to_04",
    ref: "TO-04",
    objective: "Host-nation support & movement",
    functionalArea: "Logistics",
    priority: "Medium",
    coveragePct: 64,
  },
  {
    objectiveId: "to_05",
    ref: "TO-05",
    objective: "Cyber & information resilience",
    functionalArea: "Cyber / IM",
    priority: "High",
    coveragePct: 72,
  },
  {
    objectiveId: "to_06",
    ref: "TO-06",
    objective: "Civil-military coordination",
    functionalArea: "CIMIC",
    priority: "Medium",
    coveragePct: 53,
  },
  {
    objectiveId: "to_07",
    ref: "TO-07",
    objective: "AAR evidence & lessons",
    functionalArea: "Intelligence",
    priority: "Medium",
    coveragePct: 69,
  },
];
