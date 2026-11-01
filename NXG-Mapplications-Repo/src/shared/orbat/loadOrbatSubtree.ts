// src/shared/orbat/loadOrbatSubtree.ts
//
// Reads an ORBAT sub-tree back out of the ontology.
//
// A unit's ORBAT is stored as NxgUnit nodes joined by NxgUnitHierachyEdge rows
// (parentUnitKey → childUnitKey) inside one NxgUnitHierarchy. This rebuilds the
// CompositionNode tree from a given root, which is the shape both apps already
// speak: the Scenario Planner sidebar renders it, and the ORBAT Manager turns
// it into a session Hierarchy when deep-linked from the planner.

import { client } from "@/client";
import {
  NxgUnit,
  NxgUnitHierachyEdge,
} from "@nxg-simulation-execution-testing/sdk";
import type { CompositionNode } from "@/shared/types";

/** Guard against a cycle or a pathological tree bringing the UI down. */
const MAX_NODES = 2000;
const MAX_DEPTH = 12;

export interface OrbatSubtree {
  root: CompositionNode;
  /** Total nodes including the root. */
  nodeCount: number;
  /** True when the walk stopped early on MAX_NODES / MAX_DEPTH. */
  truncated: boolean;
}

function toCompositionNode(
  unit: Pick<
    NxgUnit.Props,
    | "primaryKey_"
    | "unitIdentifier"
    | "echelon"
    | "sidc"
    | "entityType"
    | "militaryService"
    | "affiliation"
    | "allegiance"
    | "owningSimulator"
    | "unitTypeKey"
    | "equipmentTypeKey"
    | "dis6Code"
    | "simulatorIdentifierCode"
  >,
): CompositionNode {
  return {
    id: unit.primaryKey_,
    unitIdentifier: unit.unitIdentifier ?? unit.primaryKey_,
    echelon: unit.echelon ?? "",
    sidc: unit.sidc ?? "",
    entityType: (unit.entityType as CompositionNode["entityType"]) ?? "organisation",
    militaryService: unit.militaryService ?? "Army",
    affiliation: unit.affiliation ?? "Friend",
    allegiance: unit.allegiance ?? "",
    owningSimulator: unit.owningSimulator ?? "",
    // dis6Code IS the canonical asset foreign key, and simulatorIdentifierCode
    // is the chosen model. Both were hardcoded to null here, so an ORBAT read
    // back out of the ontology showed no asset however well linked it was —
    // and re-saving it dropped the links. Same defect loadUnits had.
    canonicalAssetKey: unit.dis6Code ?? null,
    simulatorIdentifierCode: unit.simulatorIdentifierCode ?? null,
    unitTypeKey: unit.unitTypeKey ?? null,
    equipmentTypeKey: unit.equipmentTypeKey ?? null,
    quantity: 1,
    children: [],
  };
}

/** Fetch units by primary key, chunked so the $in filter stays reasonable. */
async function fetchUnits(keys: string[]): Promise<Map<string, NxgUnit.OsdkInstance>> {
  const byKey = new Map<string, NxgUnit.OsdkInstance>();
  const CHUNK = 100;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const page = await client(NxgUnit)
      .where({ primaryKey_: { $in: slice } })
      .fetchPage({ $pageSize: CHUNK });
    for (const u of page.data) byKey.set(u.primaryKey_, u);
  }
  return byKey;
}

/**
 * Rebuild the CompositionNode tree rooted at `rootUnitKey` within
 * `hierarchyKey`. Returns null when the root unit no longer exists (e.g. the
 * ORBAT was deleted in the ORBAT Manager but the map still references it).
 */
export async function loadOrbatSubtree(
  hierarchyKey: string,
  rootUnitKey: string,
): Promise<OrbatSubtree | null> {
  // ── 1. All edges in the hierarchy ────────────────────────────────────────
  // One query for the whole hierarchy, then walk in memory: hierarchies are
  // small (hundreds of edges) and this avoids a query per level.
  const childrenByParent = new Map<string, string[]>();
  let cursor: string | undefined;
  do {
    const page = await client(NxgUnitHierachyEdge)
      .where({ hierarchyKey: { $eq: hierarchyKey } })
      .fetchPage({ $pageSize: 1000, $nextPageToken: cursor });
    for (const e of page.data) {
      if (!e.parentUnitKey || !e.childUnitKey) continue;
      const list = childrenByParent.get(e.parentUnitKey);
      if (list) list.push(e.childUnitKey);
      else childrenByParent.set(e.parentUnitKey, [e.childUnitKey]);
    }
    cursor = page.nextPageToken;
  } while (cursor);

  // ── 2. Collect the keys reachable from the root ──────────────────────────
  const wanted: string[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const collect = (key: string, depth: number): void => {
    if (seen.has(key)) return; // cycle guard
    if (wanted.length >= MAX_NODES || depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    seen.add(key);
    wanted.push(key);
    for (const child of childrenByParent.get(key) ?? []) collect(child, depth + 1);
  };
  collect(rootUnitKey, 0);

  // ── 3. Fetch the units and assemble ──────────────────────────────────────
  const units = await fetchUnits(wanted);
  const rootUnit = units.get(rootUnitKey);
  if (!rootUnit) return null;

  const build = (key: string, depth: number): CompositionNode | null => {
    const unit = units.get(key);
    if (!unit) return null;
    const node = toCompositionNode(unit);
    if (depth < MAX_DEPTH) {
      for (const childKey of childrenByParent.get(key) ?? []) {
        const child = build(childKey, depth + 1);
        if (child) node.children.push(child);
      }
    }
    return node;
  };

  const root = build(rootUnitKey, 0)!;
  return { root, nodeCount: wanted.length, truncated };
}

export interface OrbatForest {
  /** Every tree in the hierarchy, ordered by root unit identifier. */
  trees: OrbatSubtree[];
  /** Root unit keys, in the same order. */
  rootUnitKeys: string[];
  /** Total nodes across all trees. */
  nodeCount: number;
  truncated: boolean;
}

/**
 * Read a whole hierarchy back, not just one sub-tree.
 *
 * A scenario hierarchy is a FOREST: one tree per side, each rooted on a real
 * unit. Anything that assumes a single root — as findHierarchyRoot does, and
 * as this module's only entry point used to — sees the friendly force and
 * silently loses the enemy one.
 *
 * Roots are parents that are never a child. Isolated units (no edges at all)
 * are not visible here: without an edge there is nothing to find them by.
 */
export async function loadOrbatForest(hierarchyKey: string): Promise<OrbatForest> {
  const childrenByParent = new Map<string, string[]>();
  const parents = new Set<string>();
  const children = new Set<string>();

  let cursor: string | undefined;
  do {
    const page = await client(NxgUnitHierachyEdge)
      .where({ hierarchyKey: { $eq: hierarchyKey } })
      .fetchPage({ $pageSize: 1000, $nextPageToken: cursor });
    for (const e of page.data) {
      if (!e.parentUnitKey || !e.childUnitKey) continue;
      parents.add(e.parentUnitKey);
      children.add(e.childUnitKey);
      const list = childrenByParent.get(e.parentUnitKey);
      if (list) list.push(e.childUnitKey);
      else childrenByParent.set(e.parentUnitKey, [e.childUnitKey]);
    }
    cursor = page.nextPageToken;
  } while (cursor);

  const rootKeys = [...parents].filter((p) => !children.has(p));
  if (rootKeys.length === 0) {
    return { trees: [], rootUnitKeys: [], nodeCount: 0, truncated: false };
  }

  // One loadOrbatSubtree per root, which re-reads the hierarchy's edges each
  // time. Deliberate: a scenario has two roots and a few hundred edges, so the
  // duplicated read costs less than a second copy of the tree-building code
  // that could drift from the one the planner and the manager already use.
  const trees: OrbatSubtree[] = [];
  for (const rootKey of rootKeys) {
    const subtree = await loadOrbatSubtree(hierarchyKey, rootKey);
    if (subtree) trees.push(subtree);
  }
  trees.sort((a, b) => a.root.unitIdentifier.localeCompare(b.root.unitIdentifier));

  return {
    trees,
    rootUnitKeys: trees.map((t) => t.root.id),
    nodeCount: trees.reduce((sum, t) => sum + t.nodeCount, 0),
    truncated: trees.some((t) => t.truncated),
  };
}

/** Flatten a tree to depth-ordered rows — handy for list rendering. */
export function flattenOrbat(
  node: CompositionNode,
  depth = 0,
): { node: CompositionNode; depth: number }[] {
  return [
    { node, depth },
    ...node.children.flatMap((c) => flattenOrbat(c, depth + 1)),
  ];
}
