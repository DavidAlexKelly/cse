// src/shared/orbat/scenarioOrbat.ts
//
// Binds a Scenario Planner scenario to the ORBAT Manager's live hierarchy model.
//
// ─── Model ───────────────────────────────────────────────────────────────────
//
//   NxgOperation                          OPERATION-BALTIC-SHIELD
//     └── NxgUnitHierarchy  hier-{scenarioId}   "… — Scenario ORBAT"
//           ├── <friendly root unit>   ← most senior unit placed, a REAL unit
//           │     └── <placed unit ORBAT> …
//           └── <enemy root unit>
//                 └── <placed unit ORBAT> …
//
// ONE hierarchy per scenario, holding two trees. A hierarchy is a container;
// nothing requires it to have a single root, so both sides live in one and each
// side's root is a real unit rather than a synthetic "Blue Force" node.
//
// Nobody authors the overall ORBAT. Where each placed unit sits is DERIVED from
// the set of placed units and reconciled — see hierarchy.ts for the rules and
// reconcile.ts for the call. This module's job is narrower: resolve which
// hierarchy a scenario uses, and write a unit's own sub-tree.
//
// LEGACY: scenarios in SCENARIO_BINDINGS with per-side hierarchies (NEXGEN)
// keep them. Those were hand-built, with real force roots (NX-BG / EN-MRB), and
// the reconciler skips them — see isPinnedScenario.
//
// These are NOT NxgOTemplateOrbatGraph templates: templates are reusable
// patterns, these are the instances belonging to this scenario.

import { client } from "@/client";
import {
  NxgUnitHierachyEdge,
  NxgUnitHierarchy,
  createNxgUnitHierarchy,
} from "@nxg-simulation-execution-testing/sdk";
import {
  createCompositionInOntology,
  createEdgeFn,
} from "../lib/foundry";
import type { CompositionNode } from "../../types";
import { ORGANIC_RELATIONSHIP_KEY, ontologyDate, type Side } from "./model";

// The pure vocabulary (Side, ORGANIC_RELATIONSHIP_KEY, ontologyDate,
// sideForSidc) lives in model.ts so the reconciler can use it without pulling
// in "@/client" — see the note there. Re-exported so callers of this module are
// unaffected.
export {
  ORGANIC_RELATIONSHIP_KEY,
  ontologyDate,
  sideForSidc,
  type Side,
} from "./model";

/**
 * Operation used for scenarios with no explicit binding below.
 *
 * Whatever this is MUST already exist in NxgOperation, because
 * createNxgUnitHierarchy validates operationKey and rejects the write
 * otherwise. Until recently NxgOperation had no action types at all, so
 * operations were only authorable by hand-editing the mockontology `Operation`
 * dataset; createNxgOperation / deleteNxgOperation now exist for this.
 *
 * This tracks DEFAULT_SCENARIO_ID (scenarioPlanner/shared/phaseColours.ts),
 * which is "scenario_operation_baltic_shield" — so the default operation is
 * BALTIC SHIELD's, not ARCTIC WOLF's as it was while NEXGEN was the default.
 *
 * NOT OP-BALTIC-SHIELD-2026: that row declared terrain "estonia", whereas
 * every unit in the scenario's four phase map states sits between 54.1–55.1N
 * and 19.3–20.6E — Kaliningrad oblast and the Gulf of Gdansk. It has been
 * retired in favour of OPERATION-BALTIC-SHIELD on terrain "kaliningrad".
 */
export const DEFAULT_OPERATION_KEY = "OPERATION-BALTIC-SHIELD";

/** Where a scenario's ORBATs live, per side. */
interface SideBinding {
  hierarchyKey: string;
  /** Existing force root to hang unit ORBATs beneath, when there is one. */
  rootUnitKey?: string;
}

interface ScenarioBinding {
  operationKey: string;
  /**
   * Pinned hierarchies, when the scenario's ORBATs were hand-built and must be
   * used as-is. Omit a side (or both) to let discovery/creation run against
   * `operationKey` — which is the normal case for a scenario that only needs
   * its operation naming fixed.
   */
  blue?: SideBinding;
  red?: SideBinding;
}

/**
 * Explicit bindings for scenarios whose ORBATs already exist in the ontology.
 *
 * NxgUnitHierarchy has no scenarioId property, so the association can't be
 * queried directly. Rather than guess, the known scenarios are pinned here and
 * anything else falls back to discovery + creation below.
 */
const SCENARIO_BINDINGS: Record<string, ScenarioBinding> = {
  scenario_nexgen_2026: {
    operationKey: "OP-NEXGEN-2026",
    blue: { hierarchyKey: "OP-NEXGEN-2026-FRIENDLY", rootUnitKey: "NX-BG" },
    red: { hierarchyKey: "OP-NEXGEN-2026-ENEMY", rootUnitKey: "EN-MRB" },
  },
  // BALTIC SHIELD is the default scenario. Nothing is pinned: the two existing
  // Baltic Shield hierarchies (HIER-BALTIC-SHIELD-OPS / -REF) are a hand-built
  // 1 PWRR battalion ORBAT with no friendly/enemy split, and OPS still points
  // at the retired OP-BALTIC-SHIELD-2026 — they are legacy reference data. The
  // scenario's own per-side hierarchies are discovered or created beneath
  // OPERATION-BALTIC-SHIELD instead of hanging planner units off 1 PWRR.
  scenario_operation_baltic_shield: {
    operationKey: "OPERATION-BALTIC-SHIELD",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * OSDK errors stringify to a bare "Failed to fetch 400", hiding the server's
 * actual complaint. Pull out whatever detail is present.
 */
export function describeActionError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof e.errorName === "string") bits.push(e.errorName);
  if (typeof e.errorCode === "string") bits.push(`(${e.errorCode})`);
  if (e.parameters && typeof e.parameters === "object") bits.push(JSON.stringify(e.parameters));
  if (typeof e.errorInstanceId === "string") bits.push(`id=${e.errorInstanceId}`);
  if (bits.length === 0 && typeof e.message === "string") bits.push(e.message);
  return bits.join(" ") || String(err);
}

/** The single root of a hierarchy: a parent that is never a child. */
async function findHierarchyRoot(hierarchyKey: string): Promise<string | undefined> {
  try {
    const page = await client(NxgUnitHierachyEdge)
      .where({ hierarchyKey: { $eq: hierarchyKey } })
      .fetchPage({ $pageSize: 1000 });
    const parents = new Set<string>();
    const children = new Set<string>();
    for (const e of page.data) {
      if (e.parentUnitKey) parents.add(e.parentUnitKey);
      if (e.childUnitKey) children.add(e.childUnitKey);
    }
    for (const p of parents) if (!children.has(p)) return p;
  } catch (err) {
    console.warn(`[scenarioOrbat] could not resolve root of ${hierarchyKey}:`, err);
  }
  return undefined;
}

/**
 * True when this scenario's ORBATs are pinned to hand-built per-side
 * hierarchies (NEXGEN). The reconciler leaves those alone: their parentage was
 * authored deliberately and is not derivable from what the planner placed.
 */
export function isPinnedScenario(scenarioId: string): boolean {
  const binding = SCENARIO_BINDINGS[scenarioId];
  return !!(binding?.blue || binding?.red);
}

/** The hierarchy holding a scenario's own ORBAT, when it isn't pinned. */
export function scenarioHierarchyKey(scenarioId: string): string {
  return `hier-${scenarioId}`;
}

/** Display name for that hierarchy. */
export function scenarioHierarchyName(scenarioName: string): string {
  return `${scenarioName} — Scenario ORBAT`;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

export interface ResolvedSideOrbat {
  operationKey: string;
  hierarchyKey: string;
  /** Attach point for a unit ORBAT; undefined → top level of the hierarchy. */
  parentUnitKey?: string;
}

// One in-flight promise per cache key: several callers resolve at once (a
// placement and a reconcile, say) and must not create two hierarchies.
const _resolved = new Map<string, Promise<ResolvedSideOrbat>>();

/**
 * Resolve (and if necessary create) the hierarchy a placed unit's ORBAT belongs
 * to.
 *
 *   1. A pinned per-side binding, for the hand-built legacy scenarios.
 *   2. Otherwise "hier-{scenarioId}" — ONE hierarchy for the scenario, holding
 *      both sides, created on first use.
 *
 * `side` only matters in case 1. In case 2 both sides resolve to the same
 * hierarchy and no attach point is returned: parentage is the reconciler's
 * business, not the writer's.
 */
export function resolveScenarioOrbat(
  scenarioId: string,
  scenarioName: string,
  side: Side,
): Promise<ResolvedSideOrbat> {
  const pinned = isPinnedScenario(scenarioId);
  const cacheKey = pinned ? `${scenarioId}::${side}` : scenarioId;
  const cached = _resolved.get(cacheKey);
  if (cached) return cached;

  const promise = (async (): Promise<ResolvedSideOrbat> => {
    const binding = SCENARIO_BINDINGS[scenarioId];
    const operationKey = binding?.operationKey ?? DEFAULT_OPERATION_KEY;

    // 1. Pinned per-side hierarchy (legacy, hand-built).
    const sideBinding = binding?.[side];
    if (sideBinding) {
      return {
        operationKey,
        hierarchyKey: sideBinding.hierarchyKey,
        parentUnitKey:
          sideBinding.rootUnitKey ?? (await findHierarchyRoot(sideBinding.hierarchyKey)),
      };
    }

    // 2. The scenario's own hierarchy.
    const hierarchyKey = scenarioHierarchyKey(scenarioId);

    // Reuse it when it is already there.
    //
    // createNxgUnitHierarchy rejects a duplicate primary key, so "try to create
    // and treat the failure as fine" cannot tell an existing hierarchy from a
    // real problem — the comment here used to claim that was happening while
    // the code below rethrew everything. The effect was that the FIRST Define
    // ORBAT in a scenario worked and every one after it failed, because the
    // hierarchy it had just created now existed. Ask first instead.
    const existing = await client(NxgUnitHierarchy)
      .fetchOne(hierarchyKey)
      .catch(() => undefined);
    if (existing !== undefined) {
      return { operationKey, hierarchyKey };
    }

    try {
      await client(createNxgUnitHierarchy).applyAction({
        primaryKey: hierarchyKey,
        name: scenarioHierarchyName(scenarioName),
        operationKey,
        validFrom: ontologyDate(),
        // validTo is deliberately not sent: a scenario's ORBAT hierarchy is
        // open-ended. The action was pinned to createNxgUnitHierarchy 0.1.1,
        // which declared validTo REQUIRED, so every call here was rejected
        // with FunctionInvalidInput before the function body ran — the action
        // now binds 0.4.0, where it is optional.
      });
      console.log(`[scenarioOrbat] created hierarchy ${hierarchyKey} for ${scenarioId}`);
    } catch (err) {
      // Anything reaching here is fatal and worth naming precisely: a bad
      // operationKey, and a stale function version pin, both fail exactly here.
      console.warn(
        `[scenarioOrbat] createNxgUnitHierarchy("${hierarchyKey}", operation "${operationKey}") ` +
          `failed: ${describeActionError(err)}`,
      );
      throw new Error(
        `Could not create the ORBAT hierarchy for this scenario ` +
          `(operation ${operationKey}): ${describeActionError(err)}`,
      );
    }
    return { operationKey, hierarchyKey };
  })();

  _resolved.set(cacheKey, promise);
  promise.catch(() => _resolved.delete(cacheKey));
  return promise;
}

/** Forget resolutions (tests, or after switching scenario). */
export function resetScenarioOrbatCache(): void {
  _resolved.clear();
}

// ─── Committing a placed unit's ORBAT ────────────────────────────────────────

export interface DefineOrbatResult {
  hierarchyKey: string;
  rootUnitKey: string;
  /** Total NxgUnit rows written (root + subordinates). */
  unitsCreated: number;
}

/**
 * Write a confirmed ORBAT tree for a placed unit into the scenario's hierarchy.
 *
 * The tree is supplied by the caller — the ORBAT screen passes what the planner
 * actually built and confirmed. Nothing is written before that confirmation.
 *
 * This no longer attaches the tree to anything. Where the unit sits relative to
 * the rest of the force is derived and reconciled (hierarchy.ts / reconcile.ts);
 * deciding it here is what left stale edges behind when a more senior unit was
 * placed afterwards. Pinned scenarios still attach beneath their authored force
 * root, since nothing reconciles them.
 */
export async function commitOrbatForPlacement(params: {
  scenarioId: string;
  scenarioName: string;
  /** The confirmed tree. Its root becomes the placement's ORBAT root. */
  root: CompositionNode;
  side: Side;
  /** Placement position — the root unit's symbol is created here. */
  lat: number;
  lng: number;
  /** Label used in log output only. */
  unitLabel?: string;
}): Promise<DefineOrbatResult> {
  const { scenarioId, scenarioName, root, side, lat, lng } = params;
  const unitLabel = params.unitLabel ?? root.unitIdentifier;

  const target = await resolveScenarioOrbat(scenarioId, scenarioName, side);

  const result = await createCompositionInOntology(
    target.operationKey,
    target.hierarchyKey,
    root,
    lat,
    lng,
  );

  if (!result.rootUnitKey) {
    throw new Error("ORBAT was not created — the composition returned no root unit.");
  }

  // Only pinned scenarios carry an attach point (see resolveScenarioOrbat).
  // Non-fatal: the ORBAT is already written, it would just sit at top level.
  if (target.parentUnitKey) {
    try {
      await createEdgeFn({
        primaryKey: crypto.randomUUID(),
        hierarchyKey: target.hierarchyKey,
        parentUnitKey: target.parentUnitKey,
        childUnitKey: result.rootUnitKey,
        relationshipTypeKey: ORGANIC_RELATIONSHIP_KEY,
        validFrom: ontologyDate(),
      });
    } catch (err) {
      console.warn(
        `[scenarioOrbat] ORBAT ${result.rootUnitKey} created but could not be attached to ` +
          `${target.parentUnitKey}: ${describeActionError(err)}`,
      );
    }
  }

  console.log(
    `[scenarioOrbat] ORBAT for "${unitLabel}" → ${target.hierarchyKey}: ` +
      `root ${result.rootUnitKey}, ${result.createdUnitKeys.length} units, ` +
      `${result.createdEdgeKeys.length} edges`,
  );

  return {
    hierarchyKey: target.hierarchyKey,
    rootUnitKey: result.rootUnitKey,
    unitsCreated: result.createdUnitKeys.length,
  };
}
