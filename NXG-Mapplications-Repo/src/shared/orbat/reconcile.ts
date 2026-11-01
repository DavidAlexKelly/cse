// src/shared/orbat/reconcile.ts
//
// What is left of the scenario-wide reconciler. Every ORBAT write now goes
// through the PHASE reconcile (shared/orbat/phaseOrbat.ts → the
// nxgOReconcileScenarioOrbat action, one transaction per change); the
// scenario-wide write path (reconcileScenarioHierarchy, its debounced wrapper,
// and generate.ts's bulk generator) had no callers left and was removed
// (docs/ORBAT_PIPELINE_PLAN.md, 3.7).
//
// The derivation rules themselves (hierarchy.ts) are still how the planner
// works out which unit each side's tree hangs from.

import type { PlacedUnit } from "../../apps/scenarioPlanner/map/types";
import { desiredParentage, membersForScenario, type OrbatMember } from "./hierarchy";
import type { Side } from "./model";

/**
 * The unit each side's tree hangs from, for deep-linking "open the Blue/Red
 * ORBAT". Computed from the same rules the reconciler applies, so the link
 * lands on whatever is actually the root.
 */
export function sideRootKeys(placements: PlacedUnit[]): Partial<Record<Side, string>> {
  const members: OrbatMember[] = membersForScenario(placements);
  return desiredParentage(members).roots;
}
