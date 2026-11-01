// src/apps/scenarioPlanner/phaseCreator/index.ts
//
// Public surface of the Phase Creator subsystem (v3 — sidebar-driven flow).

export { generateOrders, generateEndState } from "./logicClient";
export type {
  GenerateOrdersOutput,
  GenerateEndStateOutput,
  UnitOrder,
  EndStateUnit,
  EndStateEngagement,
} from "./logicClient";

export type {
  MapArrowPlacement,
  MapObjectivePlacement,
  MapPhaseState,
  MapUnitPlacement,
  MapObjectiveOutput,
  GenerateOrdersOutput as GenerateOrdersOutputType,
  GenerateEndStateOutput as GenerateEndStateOutputType,
} from "./types";
