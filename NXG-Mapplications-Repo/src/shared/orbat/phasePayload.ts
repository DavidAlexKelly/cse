// src/shared/orbat/phasePayload.ts
//
// Building the reconcile payloads for per-phase ORBAT writes — pure.
//
// Every phase ORBAT write goes through ONE call to [NXG-O] Reconcile Scenario
// Orbat (reconcile_scenario_orbat in the Translator): the unit rows, their
// internal structure and the parent edges that place them in the phase tree,
// applied as a single transaction. This module decides what goes in that call;
// phaseOrbat.ts sends it. Split so the decisions are testable without a
// Foundry client (the same reason serialise.ts is separate from generate.ts).
//
// `managedChildUnitKeys` is the lever: it lists the units whose parentage the
// call owns, and the reconcile deletes any OTHER parent edge those units have
// in the hierarchy. Placing a brigade that adopts two battalions manages the
// battalions too, so their old position as roots — or under someone else —
// is cleared in the same transaction.
import type { CompositionNode } from "@/shared/types";
import type { PlacedUnit } from "../../apps/scenarioPlanner/map/types";
import {
  type OrbatMember,
  type ReconcileEdge,
  type ReconcilePayload,
  type ReconcileUnit,
  desiredParentage,
  memberWithKey,
} from "./hierarchy";
import { ORGANIC_RELATIONSHIP_KEY, ontologyDate } from "./model";
import type { ForestIndex } from "./orbatLevels";
import { newPhaseUnitKey } from "./phaseKeys";
import { serialiseComposition } from "./serialise";

/** Where a phase write lands. */
export interface PhaseHierarchyRef {
  operationKey: string;
  hierarchyKey: string;
  hierarchyName: string;
  /** NxgPhase.phaseId — what the Translator and CSE validation select on. */
  phaseKey: string;
}

/** The reconcile payload plus phaseKey, so the hierarchy is stamped with its phase. */
export interface PhaseReconcilePayload extends ReconcilePayload {
  unitHierarchy: ReconcilePayload["unitHierarchy"] & { phaseKey: string };
}

export function withPhaseKey(payload: ReconcilePayload, phaseKey: string): PhaseReconcilePayload {
  return { ...payload, unitHierarchy: { ...payload.unitHierarchy, phaseKey } };
}

function edge(parentUnitKey: string, childUnitKey: string, validFrom: string): ReconcileEdge {
  return { parentUnitKey, childUnitKey, relationshipTypeKey: ORGANIC_RELATIONSHIP_KEY, validFrom };
}

/** A payload with explicit edges — no derived parentage. */
export function explicitPayload(
  ref: PhaseHierarchyRef,
  parts: {
    units: ReconcileUnit[];
    edges: ReconcileEdge[];
    managedChildUnitKeys: string[];
    validFrom?: string;
  },
): PhaseReconcilePayload {
  const validFrom = parts.validFrom ?? ontologyDate();
  return {
    operation: { primaryKey: ref.operationKey },
    unitHierarchy: {
      primaryKey: ref.hierarchyKey,
      name: ref.hierarchyName,
      validFrom,
      phaseKey: ref.phaseKey,
    },
    units: parts.units,
    unitHierarchyEdges: [...parts.edges].sort(
      (a, b) =>
        a.childUnitKey.localeCompare(b.childUnitKey) ||
        a.parentUnitKey.localeCompare(b.parentUnitKey),
    ),
    managedChildUnitKeys: [...new Set(parts.managedChildUnitKeys)].sort((a, b) =>
      a.localeCompare(b),
    ),
  };
}

// ─── Place a unit ────────────────────────────────────────────────────────────

export interface PlaceUnitParts {
  /** The tree for the placed unit — just the root unless generating beneath. */
  tree: CompositionNode;
  lat: number;
  lng: number;
  phaseId: string;
  /** Chosen parent (placeIntoOrbat.chooseParent), or null for a new root. */
  parentKey: string | null;
  /** Same-side roots it now commands (placeIntoOrbat.adoptees). */
  adopteeKeys: string[];
  /** Depth the new unit lands at, so its subordinates get the right ring radii. */
  landingDepth: number;
  maxUnits?: number;
  validFrom?: string;
  /** Injectable for tests. */
  uuid?: () => string;
}

export interface PlaceUnitPayload {
  payload: PhaseReconcilePayload;
  rootUnitKey: string;
  unitCount: number;
  truncated: boolean;
}

/**
 * Unit + optional generated ORBAT + parent edge + adoption edges, in one call.
 * Adoptees are managed, so whatever they hung from before is pruned.
 */
export function placeUnitPayload(ref: PhaseHierarchyRef, parts: PlaceUnitParts): PlaceUnitPayload {
  const validFrom = parts.validFrom ?? ontologyDate();
  const serialised = serialiseComposition(parts.tree, {
    lat: parts.lat,
    lng: parts.lng,
    validFrom,
    layout: "ring",
    rootDepth: parts.landingDepth,
    maxUnits: parts.maxUnits,
    newKey: () => newPhaseUnitKey(parts.phaseId, parts.uuid),
  });
  const root = serialised.rootUnitKey;
  const edges = [...serialised.edges];
  if (parts.parentKey) edges.push(edge(parts.parentKey, root, validFrom));
  for (const adoptee of parts.adopteeKeys) {
    if (adoptee !== parts.parentKey) edges.push(edge(root, adoptee, validFrom));
  }
  return {
    payload: explicitPayload(ref, {
      units: serialised.units,
      edges,
      managedChildUnitKeys: [root, ...parts.adopteeKeys.filter((k) => k !== parts.parentKey)],
      validFrom,
    }),
    rootUnitKey: root,
    unitCount: serialised.units.length,
    truncated: serialised.truncated,
  };
}

// ─── Generate beneath an existing unit ───────────────────────────────────────

/**
 * Expand a generated tree beneath a unit that already exists. The existing
 * unit's row is never rewritten — only its new subordinates and their edges.
 */
export function generateBeneathPayload(
  ref: PhaseHierarchyRef,
  parts: {
    existingKey: string;
    tree: CompositionNode;
    lat: number;
    lng: number;
    phaseId: string;
    depth: number;
    maxUnits?: number;
    validFrom?: string;
    uuid?: () => string;
  },
): PlaceUnitPayload {
  const validFrom = parts.validFrom ?? ontologyDate();
  const serialised = serialiseComposition(parts.tree, {
    lat: parts.lat,
    lng: parts.lng,
    validFrom,
    layout: "ring",
    rootDepth: parts.depth,
    // +1: the omitted root row does not count against the cap.
    maxUnits: parts.maxUnits === undefined ? undefined : parts.maxUnits + 1,
    omitRootUnit: true,
    keyFor: (_node, { isRoot }) => (isRoot ? parts.existingKey : undefined),
    newKey: () => newPhaseUnitKey(parts.phaseId, parts.uuid),
  });
  return {
    payload: explicitPayload(ref, {
      units: serialised.units,
      edges: serialised.edges,
      // Only the new units: the existing one keeps its parent.
      managedChildUnitKeys: serialised.edges.map((e) => e.childUnitKey),
      validFrom,
    }),
    rootUnitKey: parts.existingKey,
    unitCount: serialised.units.length,
    truncated: serialised.truncated,
  };
}

// ─── Change parent ───────────────────────────────────────────────────────────

/** Re-parent one unit; its subtree comes with it. null makes it a root. */
export function changeParentPayload(
  ref: PhaseHierarchyRef,
  unitKey: string,
  newParentKey: string | null,
  index?: ForestIndex,
  validFrom = ontologyDate(),
): PhaseReconcilePayload {
  if (newParentKey === unitKey) throw new Error("A unit cannot be its own parent.");
  if (index && newParentKey) {
    // The reconcile rejects a cycle server-side and the whole call with it;
    // say why here instead.
    let walker: string | null = newParentKey;
    const seen = new Set<string>();
    while (walker && !seen.has(walker)) {
      if (walker === unitKey) {
        throw new Error("That would put the unit under one of its own subordinates.");
      }
      seen.add(walker);
      walker = index.nodes.get(walker)?.parentKey ?? null;
    }
  }
  return explicitPayload(ref, {
    units: [],
    edges: newParentKey ? [edge(newParentKey, unitKey, validFrom)] : [],
    managedChildUnitKeys: [unitKey],
    validFrom,
  });
}

// ─── Parentage among placed units ────────────────────────────────────────────

export interface PlacementRoot {
  placement: Pick<PlacedUnit, "label" | "sidc" | "templateId" | "orbatParentUnitKey">;
  rootUnitKey: string;
}

/** What the parentage pass needs to know about the tree as it stands. */
export interface TreeView {
  /** Current parent in the phase tree, or null for a root / unknown unit. */
  parentOf: (unitKey: string) => string | null;
  /** True when `maybeDescendant` is somewhere below `ancestor`. */
  isBelow: (maybeDescendant: string, ancestor: string) => boolean;
}

/**
 * Parentage for the phase's placed units, honouring the tree as it stands.
 *
 * Only two kinds of unit are MANAGED (and so may lose an edge):
 *   • placed roots that are currently roots in the phase tree — they get a
 *     derived parent (hierarchy.ts rule B) or stay roots;
 *   • placed roots whose planner override differs from their tree parent.
 * Anything already parented in the tree is left exactly as it is — it was put
 * there deliberately (Place dialog, Change parent, a previous save) and its
 * parent may be a unit that is not itself placed on the map, which the
 * derived rule cannot see.
 *
 * A derived parent from inside the unit's own subtree is refused, so this can
 * never write a cycle the reconcile's own check (which sees only the payload)
 * would miss.
 */
export function phasePlacementParentage(
  ref: PhaseHierarchyRef,
  roots: PlacementRoot[],
  tree: TreeView,
  extra: { units?: ReconcileUnit[]; edges?: ReconcileEdge[]; validFrom?: string } = {},
): PhaseReconcilePayload {
  const validFrom = extra.validFrom ?? ontologyDate();
  const byKey = new Map<string, { member: OrbatMember; managed: boolean }>();
  for (const { placement, rootUnitKey } of roots) {
    if (byKey.has(rootUnitKey)) continue;
    const member = memberWithKey(
      { ...placement, id: rootUnitKey, lat: 0, lng: 0 } as PlacedUnit,
      rootUnitKey,
    );
    const treeParent = tree.parentOf(rootUnitKey);
    const override = placement.orbatParentUnitKey;
    member.parentOverrideKey = override ?? treeParent ?? undefined;
    const managed = !treeParent || (!!override && override !== treeParent);
    byKey.set(rootUnitKey, { member, managed });
  }

  const { parentByChild } = desiredParentage([...byKey.values()].map((m) => m.member));
  const edges: ReconcileEdge[] = [...(extra.edges ?? [])];
  const managedKeys: string[] = [];
  for (const [key, { managed }] of byKey) {
    if (!managed) continue;
    managedKeys.push(key);
    const parent = parentByChild[key];
    if (parent && parent !== key && !tree.isBelow(parent, key))
      edges.push(edge(parent, key, validFrom));
  }

  return explicitPayload(ref, {
    units: extra.units ?? [],
    edges,
    managedChildUnitKeys: managedKeys,
    validFrom,
  });
}

/** TreeView over a forest index. */
export function treeViewOf(index: ForestIndex): TreeView {
  return {
    parentOf: (key) => index.nodes.get(key)?.parentKey ?? null,
    isBelow: (maybeDescendant, ancestor) => {
      let walker = index.nodes.get(maybeDescendant)?.parentKey ?? null;
      const seen = new Set<string>();
      while (walker && !seen.has(walker)) {
        if (walker === ancestor) return true;
        seen.add(walker);
        walker = index.nodes.get(walker)?.parentKey ?? null;
      }
      return false;
    },
  };
}

// ─── Clone an inherited ORBAT into the phase ─────────────────────────────────

/**
 * Copy an ORBAT that lives in another phase (or the legacy scenario-wide
 * hierarchy) into this phase: fresh phase keys, every unit re-laid on rings
 * around the placement's CURRENT position. The source is never modified —
 * phases hold copies, not shared rows.
 *
 * `idMap` maps each source unit key (CompositionNode.id, as loadOrbatSubtree
 * returns it) to its copy, so a placement nested inside this tree can be
 * linked to its copy rather than cloned a second time.
 */
export function cloneSubtreePayloadParts(
  tree: CompositionNode,
  at: { lat: number; lng: number },
  phaseId: string,
  options: { validFrom?: string; uuid?: () => string; maxUnits?: number } = {},
): {
  rootUnitKey: string;
  units: ReconcileUnit[];
  edges: ReconcileEdge[];
  truncated: boolean;
  idMap: Map<string, string>;
} {
  const idMap = new Map<string, string>();
  const serialised = serialiseComposition(
    // Rows read back from the ontology are already one per unit.
    normaliseQuantities(tree),
    {
      lat: at.lat,
      lng: at.lng,
      validFrom: options.validFrom,
      layout: "ring",
      maxUnits: options.maxUnits,
      keyFor: (node) => {
        const key = newPhaseUnitKey(phaseId, options.uuid);
        idMap.set(node.id, key);
        return key;
      },
    },
  );
  return {
    rootUnitKey: serialised.rootUnitKey,
    units: serialised.units,
    edges: serialised.edges,
    truncated: serialised.truncated,
    idMap,
  };
}

/**
 * Move pinned units — and everything below them — to fixed positions, keeping
 * each subtree's shape. Outer pins are applied before inner ones, so a pinned
 * battalion inside a pinned brigade ends up exactly where its own pin says.
 *
 * Used when a phase inherits: every PLACED unit lands where it ended the
 * previous phase, not wherever the ring layout around its superior puts it.
 * Mutates `units` in place.
 */
export function pinSubtrees(
  units: ReconcileUnit[],
  edges: ReconcileEdge[],
  pins: ReadonlyMap<string, { lat: number; lng: number }>,
): void {
  const byKey = new Map(units.map((u) => [u.primaryKey, u]));
  const children = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const e of edges) {
    parentOf.set(e.childUnitKey, e.parentUnitKey);
    const list = children.get(e.parentUnitKey);
    if (list) list.push(e.childUnitKey);
    else children.set(e.parentUnitKey, [e.childUnitKey]);
  }
  const depth = (key: string): number => {
    let d = 0;
    const seen = new Set<string>();
    for (let k = parentOf.get(key); k && !seen.has(k); k = parentOf.get(k)) {
      seen.add(k);
      d++;
    }
    return d;
  };
  const ordered = [...pins.keys()].filter((k) => byKey.has(k)).sort((a, b) => depth(a) - depth(b));
  for (const key of ordered) {
    const unit = byKey.get(key)!;
    const to = pins.get(key)!;
    if (unit.latitude == null || unit.longitude == null) {
      unit.latitude = to.lat;
      unit.longitude = to.lng;
      continue;
    }
    const dLat = to.lat - unit.latitude;
    const dLng = to.lng - unit.longitude;
    const stack = [key];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const k = stack.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      const u = byKey.get(k);
      if (u && u.latitude != null && u.longitude != null) {
        u.latitude += dLat;
        u.longitude += dLng;
      }
      stack.push(...(children.get(k) ?? []));
    }
  }
}

function normaliseQuantities(node: CompositionNode): CompositionNode {
  return { ...node, quantity: 1, children: node.children.map(normaliseQuantities) };
}
