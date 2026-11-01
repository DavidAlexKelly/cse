// src/apps/scenarioPlanner/phaseCreator/resolveOrders.ts
//
// Deterministic order-resolution engine. Pure functions, no LLM calls.
// See src/filetoimplement/STEP2_NOTES.md and phase_generation_upgrade_plan.md.
import type {
  MapArrowPlacement,
  MapObjectivePlacement,
  MapUnitPlacement,
} from "./types";
import { UNIT_ARCHETYPES } from "../map/unitTemplates";
import type { UnitTemplate } from "../map/types";
import { lookupTaskForOrder, type TacticTaskDef, type TaskEffect } from "@acc/app6d/core";
import {
  DEFAULT_TIME_SCALE,
  combatPowerForSidc,
  distanceKm,
  movementRateKmh,
  engagementRadiusForSidc,
  lanchesterAttrition,
  type TimeScaleConfig,
} from "../shared/timeScale";

export type OrderFeasibility =
  | "achieved"
  | "partial"
  | "infeasible-time"
  | "infeasible-opposed"
  | "not-applicable";

export interface EngagementOutcome {
  opposingUnitId: string;
  opposingUnitLabel?: string;
  opposingTask?: TacticTaskDef;
  friendlyPowerIndex: number;
  hostilePowerIndex: number;
  outcome: "friendly-favoured" | "even" | "hostile-favoured";
  estimatedAttritionPct: { friendly: number; hostile: number };
}

export interface OrderResolution {
  orderId: string;
  assignedUnitId?: string;
  unitLabel?: string;
  unitForce?: "blue" | "red";
  task?: TacticTaskDef;
  distanceKm?: number;
  etaHours?: number;
  feasibility: OrderFeasibility;
  note: string;
  engagement?: EngagementOutcome;
}

// Engagement radius is now per-echelon — see engagementRadiusForSidc() in timeScale.ts
const ACHIEVED_FRACTION = 0.8;
const PARTIAL_FRACTION = 1.1;

const COMBAT_EFFECTS: ReadonlySet<TaskEffect> = new Set([
  "destroy",
  "neutralize",
  "block",
  "seize",
  "contain",
  "isolate",
  "fix",
  "breach",
]);

const STANDING_EFFECTS: ReadonlySet<TaskEffect> = new Set([
  "control-measure",
  "obstacle",
  "hazard",
  "airspace",
  "fires",
]);

export function categoryForSidc(sidc: string): UnitTemplate["category"] | undefined {
  if (sidc.length < 10) return undefined;
  const dim = sidc[2];
  const fn6 = sidc.slice(4, 10);
  const match = UNIT_ARCHETYPES.find((a) => {
    const archFn6 = (a.functionId + "------").slice(0, 6);
    return a.dim === dim && archFn6 === fn6;
  });
  return match?.category;
}

function findUnit(units: MapUnitPlacement[], id: string | undefined): MapUnitPlacement | undefined {
  if (!id) return undefined;
  return units.find((u) => u.id === id);
}

function taskForUnit(unitId: string, arrows: MapArrowPlacement[]): TacticTaskDef | undefined {
  const arrow = arrows.find((a) => a.assignedUnitId === unitId);
  if (!arrow) return undefined;
  return lookupTaskForOrder(arrow.tacticLabel ?? arrow.label);
}

function formatNote(
  unit: MapUnitPlacement,
  task: TacticTaskDef | undefined,
  dKm: number,
  etaHours: number,
  durationHours: number,
  feasibility: OrderFeasibility,
  engagement: EngagementOutcome | undefined,
): string {
  const taskName = task?.name ?? "order";
  const parts: string[] = [
    `${unit.label} (${unit.force ?? "blue"}) — ${taskName.toUpperCase()}: ` +
      `distance ${dKm.toFixed(1)}km, ETA ${etaHours.toFixed(1)}h of ${durationHours}h phase`,
  ];
  switch (feasibility) {
    case "achieved":
      parts.push("→ ACHIEVED.");
      break;
    case "partial":
      parts.push("→ PARTIAL — unit will still be closing on the objective as the phase ends.");
      break;
    case "infeasible-time":
      parts.push("→ INFEASIBLE (time) — unit will still be en route at phase end.");
      break;
    case "infeasible-opposed":
      parts.push("→ INFEASIBLE (opposed) — arrival was timewise feasible but the objective is defended at unfavourable odds.");
      break;
    default:
      break;
  }
  if (engagement) {
    parts.push(
      `Engaged ${engagement.opposingUnitLabel ?? "an opposing unit"}` +
        (engagement.opposingTask ? ` (${engagement.opposingTask.name})` : "") +
        ` near the objective — ${engagement.outcome} ` +
        `(power ${engagement.friendlyPowerIndex.toFixed(2)} vs ${engagement.hostilePowerIndex.toFixed(2)}), ` +
        `est. attrition friendly ${engagement.estimatedAttritionPct.friendly}% / ` +
        `hostile ${engagement.estimatedAttritionPct.hostile}%.`,
    );
  }
  return parts.join(" ");
}

export function resolveOrders(
  units: MapUnitPlacement[],
  arrows: MapArrowPlacement[],
  objectives: MapObjectivePlacement[],
  durationHours: number,
  timeScale: TimeScaleConfig = DEFAULT_TIME_SCALE,
): OrderResolution[] {
  void timeScale;
  const results: OrderResolution[] = [];

  for (const arrow of arrows) {
    const task = lookupTaskForOrder(arrow.tacticLabel ?? arrow.label);
    const unit = findUnit(units, arrow.assignedUnitId);

    if (!unit) {
      results.push({
        orderId: arrow.id,
        task,
        feasibility: "not-applicable",
        note: task
          ? `${task.name} order drawn with no assigned unit — treated as a standing control measure/graphic, not a tasked order.`
          : `Unlabeled or unrecognised order graphic with no assigned unit — no doctrinal grounding available.`,
      });
      continue;
    }

    const effect = task?.effect;

    if (effect && STANDING_EFFECTS.has(effect)) {
      results.push({
        orderId: arrow.id,
        assignedUnitId: unit.id,
        unitLabel: unit.label,
        unitForce: unit.force,
        task,
        feasibility: "not-applicable",
        note:
          `${task!.name} is a standing control measure/graphic (${effect}), not a movement or ` +
          `combat task — carried forward unchanged into the next phase.`,
      });
      continue;
    }

    const targetObjective = arrow.targetObjectiveId
      ? objectives.find((o) => o.id === arrow.targetObjectiveId)
      : undefined;
    const target = targetObjective
      ? { lat: targetObjective.lat, lng: targetObjective.lng }
      : { lat: arrow.toLat, lng: arrow.toLng };

    const category = categoryForSidc(unit.sidc);
    const rateKmh = category ? movementRateKmh(category, "crossCountry") : movementRateKmh("Infantry", "crossCountry");
    const dKm = distanceKm({ lat: unit.lat, lng: unit.lng }, target);
    const etaHours = rateKmh > 0 ? dKm / rateKmh : Infinity;

    let feasibility: OrderFeasibility;
    if (etaHours <= durationHours * ACHIEVED_FRACTION) feasibility = "achieved";
    else if (etaHours <= durationHours * PARTIAL_FRACTION) feasibility = "partial";
    else feasibility = "infeasible-time";

    let engagement: EngagementOutcome | undefined;
    if (effect && COMBAT_EFFECTS.has(effect)) {
      const opposingForce = unit.force === "red" ? "blue" : "red";
      // Variable engagement radius: use the larger of the two units' echelon radii
      const unitEngagementRadius = engagementRadiusForSidc(unit.sidc);
      const nearbyOpposing = units.filter(
        (o) => {
          if (o.id === unit.id) return false;
          if ((o.force ?? "blue") !== opposingForce) return false;
          const opponentRadius = engagementRadiusForSidc(o.sidc);
          const effectiveRadius = Math.max(unitEngagementRadius, opponentRadius);
          return distanceKm({ lat: o.lat, lng: o.lng }, target) <= effectiveRadius;
        },
      );
      if (nearbyOpposing.length > 0) {
        const friendlyPower = combatPowerForSidc(unit.sidc);
        const hostilePower = nearbyOpposing.reduce((sum, o) => sum + combatPowerForSidc(o.sidc), 0);

        // Determine defense modifier: defending units get a 1.3× bonus
        const primaryOpposing = nearbyOpposing[0];
        const opposingTaskDef = taskForUnit(primaryOpposing.id, arrows);
        const isDefending = opposingTaskDef?.effect === "block"
          || opposingTaskDef?.name?.toLowerCase().includes("defend")
          || opposingTaskDef?.name?.toLowerCase().includes("retain");
        const defenseModifier = isDefending ? 1.3 : 1.0;

        // Determine intensity modifier based on task type
        const isDecisive = effect === "destroy" || effect === "seize" || effect === "breach";
        const isDelaying = effect === "fix" || effect === "contain" || effect === "isolate";
        const intensityModifier = isDecisive ? 1.3 : isDelaying ? 0.6 : 1.0;

        // Lanchester continuous attrition model
        const attritionResult = lanchesterAttrition(
          friendlyPower, hostilePower, defenseModifier, intensityModifier,
        );

        const outcome: EngagementOutcome["outcome"] = attritionResult.outcome;
        const attrition: EngagementOutcome["estimatedAttritionPct"] = {
          friendly: attritionResult.friendlyAttritionPct,
          hostile: attritionResult.hostileAttritionPct,
        };

        if (feasibility === "achieved" && outcome === "hostile-favoured") {
          feasibility = "infeasible-opposed";
        }

        engagement = {
          opposingUnitId: primaryOpposing.id,
          opposingUnitLabel: primaryOpposing.label,
          opposingTask: opposingTaskDef,
          friendlyPowerIndex: friendlyPower,
          hostilePowerIndex: hostilePower,
          outcome,
          estimatedAttritionPct: attrition,
        };
      }
    }

    results.push({
      orderId: arrow.id,
      assignedUnitId: unit.id,
      unitLabel: unit.label,
      unitForce: unit.force,
      task,
      distanceKm: dKm,
      etaHours,
      feasibility,
      engagement,
      note: formatNote(unit, task, dKm, etaHours, durationHours, feasibility, engagement),
    });
  }

  return results;
}

/**
 * Resolve a phase's start state into its end state.
 * Computes final unit positions based on order feasibility:
 *   - ACHIEVED: unit at destination (arrow toLat/toLng or objective)
 *   - PARTIAL: unit ~70% along the path from start to destination
 *   - INFEASIBLE-TIME: unit ~40% along the path
 *   - INFEASIBLE-OPPOSED: unit ~50% along, noted as reduced
 *   - NOT-APPLICABLE (standing): unit stays in place
 *   - No order: unit stays in place
 */
export function resolveToEndState(
  startState: { units: MapUnitPlacement[]; arrows: MapArrowPlacement[]; objectives: MapObjectivePlacement[] },
  durationHours: number,
  timeScale: TimeScaleConfig = DEFAULT_TIME_SCALE,
): { units: MapUnitPlacement[]; objectives: MapObjectivePlacement[]; resolutions: OrderResolution[] } {
  const resolutions = resolveOrders(
    startState.units,
    startState.arrows,
    startState.objectives,
    durationHours,
    timeScale,
  );

  // Build a map: unitId → its resolution (only the first order per unit matters)
  const unitResolution = new Map<string, OrderResolution>();
  for (const r of resolutions) {
    if (r.assignedUnitId && !unitResolution.has(r.assignedUnitId)) {
      unitResolution.set(r.assignedUnitId, r);
    }
  }

  // Compute end positions for each unit
  const endUnits: MapUnitPlacement[] = startState.units.map((unit) => {
    const resolution = unitResolution.get(unit.id);
    if (!resolution) {
      // No order for this unit — stays in place
      return { ...unit };
    }

    // Find the arrow for this unit to get destination
    const arrow = startState.arrows.find((a) => a.assignedUnitId === unit.id);
    if (!arrow) return { ...unit };

    // Determine destination
    const targetObj = arrow.targetObjectiveId
      ? startState.objectives.find((o) => o.id === arrow.targetObjectiveId)
      : undefined;
    const destLat = targetObj?.lat ?? arrow.toLat;
    const destLng = targetObj?.lng ?? arrow.toLng;

    // Compute interpolated position based on feasibility
    let fraction: number;
    switch (resolution.feasibility) {
      case 'achieved':
        fraction = 1.0;
        break;
      case 'partial':
        fraction = 0.7;
        break;
      case 'infeasible-time':
        fraction = 0.4;
        break;
      case 'infeasible-opposed':
        fraction = 0.5;
        break;
      case 'not-applicable':
      default:
        fraction = 0; // stays in place
        break;
    }

    if (fraction === 0) return { ...unit };

    return {
      ...unit,
      lat: unit.lat + (destLat - unit.lat) * fraction,
      lng: unit.lng + (destLng - unit.lng) * fraction,
    };
  });

  return {
    units: endUnits,
    objectives: [...startState.objectives], // carried forward unchanged
    resolutions,
  };
}
