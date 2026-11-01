// analysisScreen/lib/demoObjectives.ts
//
// Training objectives for the synthetic Baltic Shield run, used ONLY in mock
// mode and only when the ontology has none for the scenario (e.g. no Foundry
// connection in the room). The debrief badges them "DEMO OBJECTIVES". They
// are written against what the Phase 1 plan actually asks of its units, so the
// assessment they produce is an honest reading of the mock run.
import type { NxgTrainingObjective } from "../../scenarioPlanner/shared/types";

export const DEMO_OBJECTIVES: NxgTrainingObjective[] = [
  {
    objectiveId: "demo-to-01",
    ref: "TO-01",
    objective: "Seize and hold the reinforcement corridor with a coordinated brigade attack",
    functionalArea: "Manoeuvre",
    priority: "High",
  },
  {
    objectiveId: "demo-to-02",
    ref: "TO-02",
    objective: "Provide air defence cover for the corridor and the reception areas",
    functionalArea: "Protection",
    priority: "High",
  },
  {
    objectiveId: "demo-to-03",
    ref: "TO-03",
    objective:
      "Establish ISR over the corridor approaches to give early warning of the enemy advance",
    functionalArea: "Intelligence",
    priority: "Medium",
  },
  {
    objectiveId: "demo-to-04",
    ref: "TO-04",
    objective: "Maintain the JOC battle rhythm and timely reporting to higher",
    functionalArea: "C2",
    priority: "Low",
  },
];
