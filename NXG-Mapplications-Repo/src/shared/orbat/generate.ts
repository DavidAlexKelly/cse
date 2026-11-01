// src/shared/orbat/generate.ts
//
// Bulk ORBAT generation: give every placed land unit that hasn't got one a
// basic ORBAT, and organise the whole force — in ONE action.
//
// This is the case that made the per-object write path untenable. Fifteen land
// units in BALTIC SHIELD, thirteen nodes each, is ~200 NxgUnit creates plus
// ~190 edges; as individual OSDK actions that is several hundred round trips,
// no transaction, and a UI that has to explain what "failed at unit 137" means.
//
// Sent through reconcile_scenario_orbat instead it is one call: the units, the
// internal structure of each ORBAT, and the parentage between them, applied as
// a single set of ontology edits.
//
// Only the placed units' ORBAT ROOTS are declared managed. The generated
// sub-tree beneath each one is written verbatim and never pruned — a planner's
// force structure is not something a later reconcile should second-guess.

import { client } from "@/client";
import { nxgOReconcileScenarioOrbat } from "@nxg-simulation-execution-testing/sdk";
import type { PlacedUnit } from "../../apps/scenarioPlanner/map/types";
import type { CompositionNode } from "../types/index";
import {
  buildReconcilePayload,
  memberWithKey,
  membersForScenario,
  type OrbatMember,
  type ReconcileEdge,
  type ReconcileUnit,
} from "./hierarchy";
import { ontologyDate } from "./model";
import { identityOf, serialiseComposition, withoutOrbat } from "./serialise";
import { buildOrbatSkeleton } from "./skeleton";
import { expandAutomat } from "./swordComposition";
import { loadSwordFormations } from "../lib/foundry";

import {
  describeActionError,
  isPinnedScenario,
  resolveScenarioOrbat,
  scenarioHierarchyName,
} from "./scenarioOrbat";

export { countPlacementsWithoutOrbat, serialiseComposition } from "./serialise";
export type { SerialisedOrbat } from "./serialise";

/** A placement that was given an ORBAT by generateOrbatsForPlacements. */
export interface GeneratedOrbat {
  /** Every placement id this ORBAT now belongs to — one per phase. */
  placementIds: string[];
  label: string;
  rootUnitKey: string;
  unitCount: number;
}

export type GenerateOutcome =
  | {
      status: "applied";
      hierarchyKey: string;
      generated: GeneratedOrbat[];
      units: number;
      edges: number;
    }
  | { status: "skipped"; reason: "pinned" | "nothing-to-do" }
  | { status: "failed"; detail: string };

export interface GenerateParams {
  scenarioId: string;
  scenarioName: string;
  /** Every placement in the scenario, across all phases. */
  placements: PlacedUnit[];
  /** Levels below each root. Default 2, as for a single placement. */
  depth?: number;
  /** Injectable for tests. */
  newKey?: () => string;
}

/**
 * Generate ORBATs for every land placement that hasn't got one, and reconcile
 * the whole hierarchy, in a single action.
 *
 * Never throws — the planner's map is unaffected by a failure and the call can
 * simply be repeated.
 */
export async function generateOrbatsForPlacements(
  params: GenerateParams,
): Promise<GenerateOutcome> {
  const { scenarioId, scenarioName, placements, depth = 2 } = params;

  if (isPinnedScenario(scenarioId)) return { status: "skipped", reason: "pinned" };

  // Group the placements that need an ORBAT by cross-phase identity.
  const pending = new Map<string, PlacedUnit[]>();
  for (const placement of placements) {
    if (!withoutOrbat(placement)) continue;
    const identity = identityOf(placement);
    const group = pending.get(identity);
    if (group) group.push(placement);
    else pending.set(identity, [placement]);
  }
  if (pending.size === 0) return { status: "skipped", reason: "nothing-to-do" };

  try {
    const target = await resolveScenarioOrbat(scenarioId, scenarioName, "blue");
    const validFrom = ontologyDate();

    const newUnits: ReconcileUnit[] = [];
    const subtreeEdges: ReconcileEdge[] = [];
    const generated: GeneratedOrbat[] = [];
    const newMembers: OrbatMember[] = [];

    // Load the SWORD catalogue once for the whole run so generated formations
    // come out linked. Failure is not fatal: a structural ORBAT is still worth
    // writing, and the missing links are reported by the asset gate rather
    // than silently accepted.
    const swordFormations = await loadSwordFormations().catch((err) => {
      console.warn("[generateOrbats] SWORD catalogue unavailable; generating structural ORBATs:", err);
      return undefined;
    });

    // Below a matched automat the echelon ladder stops being the best guess
    // available, because SWORD states the real composition. Only wired in
    // when the catalogue loaded — without it the generator produces the
    // structural tree it always did.
    const expander = swordFormations
      ? (node: CompositionNode) => expandAutomat(node, swordFormations)
      : undefined;

    for (const group of pending.values()) {
      const [placement] = group;
      const tree = buildOrbatSkeleton(placement, {
        depth,
        swordFormations,
        expandAutomat: expander,
      });
      const serialised = serialiseComposition(tree, {
        lat: placement.lat,
        lng: placement.lng,
        validFrom,
        newKey: params.newKey,
      });

      newUnits.push(...serialised.units);
      subtreeEdges.push(...serialised.edges);
      generated.push({
        placementIds: group.map((p) => p.id),
        label: placement.label,
        rootUnitKey: serialised.rootUnitKey,
        unitCount: serialised.units.length,
      });
      newMembers.push(memberWithKey(placement, serialised.rootUnitKey));
    }

    // Parentage is computed over the units that already had ORBATs AND the
    // ones being created now, so a newly generated brigade can take over as
    // the side root in the same call.
    const members = [...membersForScenario(placements), ...newMembers];

    const payload = buildReconcilePayload({
      operationKey: target.operationKey,
      hierarchyKey: target.hierarchyKey,
      hierarchyName: scenarioHierarchyName(scenarioName),
      members,
      validFrom,
      units: newUnits,
      extraEdges: subtreeEdges,
    });

    await client(nxgOReconcileScenarioOrbat).applyAction({
      scenario_json: JSON.stringify(payload),
    });

    console.log(
      `[generate] ${generated.length} ORBAT(s) for ${scenarioId}: ` +
        `${payload.units.length} units, ${payload.unitHierarchyEdges.length} edges ` +
        `in one action`,
    );

    return {
      status: "applied",
      hierarchyKey: target.hierarchyKey,
      generated,
      units: payload.units.length,
      edges: payload.unitHierarchyEdges.length,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : describeActionError(err);
    console.warn(`[generate] ${scenarioId} failed: ${detail}`);
    return { status: "failed", detail };
  }
}

