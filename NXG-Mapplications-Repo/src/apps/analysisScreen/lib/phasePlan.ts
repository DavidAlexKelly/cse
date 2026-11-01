// analysisScreen/lib/phasePlan.ts
//
// Build the PLAN half of plan-vs-execution from what the planner saved —
// NxgPhase plus its NxgPhaseMapState — instead of the one checked-in export
// (shared/hla/balticShieldPlan.ts). Pure: the caller fetches, this shapes.
//
// The shape is PhasePlan, unchanged, so the compliance engine, the plan
// overlay and the debrief work on any phase with no further changes.
//
// Faithful to the saved state, warts included: a unit with two orders keeps
// both, a zero-length order stays zero-length. Those are planning artefacts an
// after-action review should surface, not tidy away.
import {
  PLANNED_CATEGORY,
  type PhasePlan,
  type PlanPoint,
  type PlannedCategory,
  type PlannedUnit,
} from "@/shared/hla/balticShieldPlan";
import { UNIT_ARCHETYPES } from "../../scenarioPlanner/map/unitTemplates";
import type {
  MapArrowPlacement,
  MapPhaseState,
  MapUnitPlacement,
} from "../../scenarioPlanner/phaseCreator/types";

export interface PhasePlanInput {
  scenarioId: string;
  phaseId: string;
  phaseName: string;
  objectiveStatement: string;
  startOffset: string;
  endOffset: string;
  phaseDurationHours: number;
  start: MapPhaseState;
  /** The planner's predicted end state, when one was generated and saved. */
  end?: MapPhaseState | null;
}

/** Movement category for a placement — what drives planned travel times. */
export function categoryFor(unit: Pick<MapUnitPlacement, "templateId" | "sidc">): PlannedCategory {
  const templateId = unit.templateId ?? "";
  const base = templateId.split("__")[0];
  const archetype = UNIT_ARCHETYPES.find((a) => a.id === base);
  if (archetype) return archetype.category;
  if (PLANNED_CATEGORY[templateId]) return PLANNED_CATEGORY[templateId];
  // Last resort from the SIDC's battle dimension: sea → Naval, air → Aviation.
  const dim = unit.sidc?.[2]?.toUpperCase();
  if (dim === "S" || dim === "U") return "Naval";
  if (dim === "A") return "Aviation";
  return "Infantry";
}

function forceOf(unit: Pick<MapUnitPlacement, "force" | "sidc">): "blue" | "red" {
  if (unit.force) return unit.force;
  const aff = unit.sidc?.[1]?.toUpperCase();
  return aff === "H" || aff === "S" ? "red" : "blue";
}

function routeOf(arrow: MapArrowPlacement): PlanPoint[] {
  if (arrow.routeWaypoints && arrow.routeWaypoints.length >= 2) {
    return arrow.routeWaypoints.map(([lat, lng]) => ({ lat, lng }));
  }
  return [
    { lat: arrow.fromLat, lng: arrow.fromLng },
    { lat: arrow.toLat, lng: arrow.toLng },
  ];
}

export function phasePlanFromMapState(input: PhasePlanInput): PhasePlan {
  const units: PlannedUnit[] = input.start.units.map((u) => ({
    id: u.id,
    label: u.label,
    sidc: u.sidc,
    lat: u.lat,
    lng: u.lng,
    force: forceOf(u),
    templateId: u.templateId,
    category: categoryFor(u),
  }));
  const byId = new Map(units.map((u) => [u.id, u]));

  const orders = input.start.arrows
    .filter((a) => a.assignedUnitId && byId.has(a.assignedUnitId))
    .map((a) => {
      const unit = byId.get(a.assignedUnitId!)!;
      return {
        id: a.id,
        unitId: unit.id,
        unitLabel: unit.label,
        force: unit.force,
        taskLabel: a.tacticLabel || a.label || "Move",
        category: unit.category,
        route: routeOf(a),
        routeDurationSec: a.routeDurationSec,
        targetObjectiveId: a.targetObjectiveId,
      };
    });

  const controlMeasures = input.start.arrows
    .filter((a) => !a.assignedUnitId || !byId.has(a.assignedUnitId))
    .map((a) => ({
      id: a.id,
      label: a.tacticLabel || a.label,
      route: routeOf(a),
      colour: a.colour,
    }));

  const objectives = input.start.objectives.map((o) => ({
    id: o.id,
    name: o.name,
    lat: o.lat,
    lng: o.lng,
    colour: o.colour,
  }));

  const predictedEndState = (input.end?.units ?? []).map((u) => ({
    id: u.id,
    label: u.label,
    lat: u.lat,
    lng: u.lng,
    force: forceOf(u),
  }));

  return {
    phaseId: input.phaseId,
    scenarioId: input.scenarioId,
    phaseName: input.phaseName,
    objectiveStatement: input.objectiveStatement,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    phaseDurationHours: input.phaseDurationHours,
    units,
    orders,
    objectives,
    controlMeasures,
    predictedEndState,
  };
}

/** Stamp planned→entity matches onto a plan (units, orders, predicted end). */
export function withEntityIds(plan: PhasePlan, entityFor: ReadonlyMap<string, string>): PhasePlan {
  return {
    ...plan,
    units: plan.units.map((u) => ({ ...u, entityId: entityFor.get(u.id) })),
    orders: plan.orders.map((o) => ({ ...o, entityId: entityFor.get(o.unitId) })),
    predictedEndState: plan.predictedEndState.map((p) => ({ ...p, entityId: entityFor.get(p.id) })),
  };
}

/** Parse a stored map-state JSON column. Null when it is not a map state. */
export function parseMapState(raw: string | null | undefined): MapPhaseState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Array.isArray(parsed.units) &&
      Array.isArray(parsed.arrows) &&
      Array.isArray(parsed.objectives)
    ) {
      return parsed as MapPhaseState;
    }
  } catch {
    /* not JSON */
  }
  return null;
}
