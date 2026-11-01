// src/apps/scenarioPlanner/shared/phaseColours.ts
//
// Phase colour palette and helpers — extracted from mockData.ts so they can
// be imported independently of the (now-deleted) mock dataset constants.

export const PHASE_COLOURS = [
  "#4A90D9", // blue   — phase_01
  "#E8A838", // amber  — phase_02
  "#5BAD6F", // green  — phase_03
  "#9B6DD1", // purple — phase_04
  "#D96A4A", // orange-red
  "#4ABFBF", // teal
];

export function getPhaseColour(index: number): string {
  return PHASE_COLOURS[index % PHASE_COLOURS.length];
}

export function getPhaseColourById(
  phaseId: string,
  phases: { id: string }[],
): string {
  const index = phases.findIndex((p) => p.id === phaseId);
  return index >= 0 ? getPhaseColour(index) : "#888888";
}

export const STATUS_COLORS: Record<string, string> = {
  APPROVED: "#2fbf71",
  REVIEW:   "#e8a838",
  DRAFT:    "#6a7292",
};

/**
 * Scenario loaded when Workshop does not supply a `scenarioObjectSet`.
 *
 * Single source of truth — `useScenario` uses it to fetch the NxgScenario and
 * DEFAULT_EXERCISE below describes the SAME exercise, so the fallback labels
 * can't drift away from the fallback data (they previously said
 * "IRON FORGE 26" / Poland while the scenario actually loaded was the
 * NEXGEN 2026 Narva scenario).
 */
export const DEFAULT_SCENARIO_ID = "scenario_operation_baltic_shield";

// Default exercise metadata used as Workshop field defaults and fallbacks
// when no live NxgScenario data is available. Must describe
// DEFAULT_SCENARIO_ID (see above).
export const DEFAULT_EXERCISE = {
  exerciseName:      "Operation BALTIC SHIELD",
  currentPhaseLabel: "EXECUTE",
  dDayOffset:        "D+1",
  nations:           ["POL", "LTU", "GBR", "USA", "DEU"] as string[],
};

/**
 * Exercise metadata for the IRON FORGE 26 mock dataset in
 * `shared/scenarioPhases.ts` (MOCK_PHASES). Only used when neither Workshop
 * nor the ontology provide phases.
 */
export const MOCK_EXERCISE = {
  exerciseName:      "IRON FORGE 26",
  currentPhaseLabel: "EXECUTE",
  dDayOffset:        "D+0",
  nations:           ["GBR", "DEU", "POL", "NOR", "NLD"] as string[],
};



