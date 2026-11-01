// src/shared/orbat/reconcile.ts
//
// The apply half of the scenario hierarchy reconciler: work out the intended
// shape (hierarchy.ts) and hand it to the ontology in ONE call.
//
// That call is [NXG-O] Reconcile Scenario Orbat, a function-backed action over
// reconcile_scenario_orbat in the [NXG] Translator repo. It upserts the
// hierarchy and the requested edges, then deletes edges that contradict them
// for the units we declare we manage — all as a single transaction.
//
// The alternative was one action per object from the browser: ~400 calls to
// stand up Baltic Shield, no transaction, and no way to remove the edge a
// re-parent invalidates. This is one call that either lands or doesn't.

import { client } from "@/client";
import { nxgOReconcileScenarioOrbat } from "@nxg-simulation-execution-testing/sdk";
import type { PlacedUnit } from "../../apps/scenarioPlanner/map/types";
import {
  buildReconcilePayload,
  describeReconcile,
  desiredParentage,
  membersForScenario,
  type OrbatMember,
} from "./hierarchy";
import type { Side } from "./model";
import {
  describeActionError,
  isPinnedScenario,
  resolveScenarioOrbat,
  scenarioHierarchyName,
} from "./scenarioOrbat";

export interface ReconcileParams {
  scenarioId: string;
  scenarioName: string;
  /** Every placement in the scenario, across all its phases. */
  placements: PlacedUnit[];
  /** Reconcile even when the payload is unchanged (the Rebuild button). */
  force?: boolean;
}

export type ReconcileOutcome =
  | { status: "applied"; hierarchyKey: string; units: number; edges: number }
  | { status: "unchanged"; hierarchyKey: string }
  | { status: "skipped"; reason: "pinned" | "no-units" }
  | { status: "failed"; detail: string };

/**
 * Payload last successfully applied, per scenario.
 *
 * buildReconcilePayload is deterministic (there is a test pinning that), so an
 * unchanged payload means an unchanged hierarchy and the call can be skipped.
 * Without this, every map edit — including dragging a unit two metres — would
 * fire a reconcile that writes nothing.
 */
const _lastApplied = new Map<string, string>();

/** Forget what has been applied (tests, or after switching scenario). */
export function resetReconcileCache(): void {
  _lastApplied.clear();
}

/**
 * Bring the scenario's hierarchy into line with what is on the map.
 *
 * Never throws: a failed reconcile leaves the ORBATs themselves intact (they
 * are written separately) and the next run converges, so callers treat this as
 * advisory and surface the detail rather than blocking the planner's edit.
 */
export async function reconcileScenarioHierarchy(
  params: ReconcileParams,
): Promise<ReconcileOutcome> {
  const { scenarioId, scenarioName, placements, force } = params;

  // NEXGEN and friends: parentage was authored by hand, deriving it would
  // overwrite deliberate work.
  if (isPinnedScenario(scenarioId)) return { status: "skipped", reason: "pinned" };

  const members = membersForScenario(placements);
  if (members.length === 0) return { status: "skipped", reason: "no-units" };

  try {
    const target = await resolveScenarioOrbat(scenarioId, scenarioName, "blue");
    const payload = buildReconcilePayload({
      operationKey: target.operationKey,
      hierarchyKey: target.hierarchyKey,
      hierarchyName: scenarioHierarchyName(scenarioName),
      members,
    });
    const json = JSON.stringify(payload);

    if (!force && _lastApplied.get(scenarioId) === json) {
      return { status: "unchanged", hierarchyKey: target.hierarchyKey };
    }

    await client(nxgOReconcileScenarioOrbat).applyAction({ scenario_json: json });
    _lastApplied.set(scenarioId, json);

    console.log(`[reconcile] ${describeReconcile(payload)}`);
    return {
      status: "applied",
      hierarchyKey: target.hierarchyKey,
      units: payload.managedChildUnitKeys.length,
      edges: payload.unitHierarchyEdges.length,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : describeActionError(err);
    console.warn(`[reconcile] ${scenarioId} failed: ${detail}`);
    return { status: "failed", detail };
  }
}

/**
 * Debounced reconcile.
 *
 * Map edits arrive in bursts — a drag fires many, a phase load fires one per
 * unit — and each burst should produce at most one reconcile. Coalescing also
 * means the payload is computed from the settled state rather than a state
 * halfway through a change.
 */
export function createDebouncedReconciler(waitMs = 2000): {
  schedule: (params: ReconcileParams) => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: ReconcileParams | undefined;
  let inFlight = false;

  const run = async () => {
    if (!pending || inFlight) return;
    const params = pending;
    pending = undefined;
    inFlight = true;
    try {
      await reconcileScenarioHierarchy(params);
    } finally {
      inFlight = false;
      // Something arrived while we were writing — settle it too.
      if (pending) schedule(pending);
    }
  };

  const schedule = (params: ReconcileParams) => {
    pending = params;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), waitMs);
  };

  return {
    schedule,
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}

/**
 * The unit each side's tree hangs from, for deep-linking "open the Blue/Red
 * ORBAT". Computed from the same rules the reconciler applies, so the link
 * lands on whatever is actually the root.
 */
export function sideRootKeys(placements: PlacedUnit[]): Partial<Record<Side, string>> {
  const members: OrbatMember[] = membersForScenario(placements);
  return desiredParentage(members).roots;
}
