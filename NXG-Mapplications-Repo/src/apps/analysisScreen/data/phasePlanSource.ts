// analysisScreen/data/phasePlanSource.ts
//
// Load a phase's plan from the ontology: NxgPhase (via useScenario's Phase)
// and its NxgPhaseMapState — the start state the planner drew and the end
// state it predicted. Shaping is lib/phasePlan.ts.
import { NxgPhaseMapState } from "@nxg-simulation-execution-testing/sdk";
import { client } from "@/client";
import type { PhasePlan } from "@/shared/hla/balticShieldPlan";
import type { MapPhaseState } from "../../scenarioPlanner/phaseCreator/types";
import { formatPhaseOffset, phaseDurationHours } from "../../scenarioPlanner/shared/timeScale";
import type { Phase } from "../../scenarioPlanner/shared/types";
import { parseMapState, phasePlanFromMapState } from "../lib/phasePlan";

function size(raw: string | null | undefined): number {
  const state = parseMapState(raw);
  return state ? state.units.length + state.arrows.length + state.objectives.length : -1;
}

async function loadMapStateRow(phaseId: string) {
  const page = await client(NxgPhaseMapState)
    .where({ phaseId: { $eq: phaseId } })
    .fetchPage({ $pageSize: 20 });
  // Duplicate rows exist for some phases; the one with the most in it is the
  // one the planner has been working in (the same rule the planner uses).
  return [...page.data].sort((a, b) => size(b.startStateMapJson) - size(a.startStateMapJson))[0];
}

/** The phase's saved start state as the planner drew it (ORBAT links included). */
export async function loadPhaseStartState(phaseId: string): Promise<MapPhaseState | null> {
  return parseMapState((await loadMapStateRow(phaseId))?.startStateMapJson);
}

/**
 * The phase's plan, or null when the phase has no saved map state — nothing
 * was planned, so there is nothing to measure against.
 */
export async function loadPhasePlan(scenarioId: string, phase: Phase): Promise<PhasePlan | null> {
  const row = await loadMapStateRow(phase.id);
  const start = parseMapState(row?.startStateMapJson);
  if (!start || start.units.length === 0) return null;
  return phasePlanFromMapState({
    scenarioId,
    phaseId: phase.id,
    phaseName: phase.name,
    objectiveStatement: phase.objective ?? "",
    startOffset: formatPhaseOffset(phase.startOffset, phase.offsetUnit),
    endOffset: formatPhaseOffset(phase.endOffset, phase.offsetUnit),
    phaseDurationHours: phaseDurationHours(phase),
    start,
    end: parseMapState(row?.endStateMapJson),
  });
}
