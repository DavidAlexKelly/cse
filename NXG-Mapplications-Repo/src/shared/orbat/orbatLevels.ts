// src/shared/orbat/orbatLevels.ts
//
// The phase command tree, indexed by level — pure, no OSDK, no map.
//
// Rules (docs/PHASE_ORBAT_PLAN.md):
//
//   • Levels are ABSOLUTE per side. Level 0 is the most senior real unit(s) of
//     each side — the roots of that side's trees. There are no synthetic
//     "Blue Force" grouping nodes in this model (see hierarchy.ts), so every
//     root is a real unit and counts.
//   • At level N the map shows the FRONTIER: every node at depth N, plus any
//     branch that ends (a leaf) before reaching N. A recce troop that has no
//     subordinates stays on the map when you drill into battalions.
//   • A node with no position of its own is drawn at its nearest positioned
//     ancestor. Older ORBATs only positioned the root; this keeps them visible.
import type { Side } from "./model";

/** One unit in a phase forest, as the level view needs it. */
export interface ForestNode {
  key: string;
  /** Parent unit key, or null for a root. */
  parentKey: string | null;
  label: string;
  echelon: string;
  sidc: string;
  side: Side;
  entityType: string;
  lat: number | null;
  lng: number | null;
}

export interface ForestIndex {
  nodes: Map<string, ForestNode>;
  childrenOf: Map<string, string[]>;
  depthOf: Map<string, number>;
  /** Keys at each depth, in input order. levels[0] are the roots. */
  levels: string[][];
  roots: string[];
  /** Deepest level present; -1 for an empty forest. */
  maxDepth: number;
}

/**
 * Index a forest. Parents that are not in the set are treated as absent (the
 * node becomes a root) rather than dropping the node; a cycle — which the
 * reconcile function refuses to write, but data can be hand-edited — breaks at
 * the first repeated node.
 */
export function indexForest(input: ForestNode[]): ForestIndex {
  const nodes = new Map<string, ForestNode>();
  for (const node of input) nodes.set(node.key, node);

  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const node of input) {
    const parent = node.parentKey && node.parentKey !== node.key ? node.parentKey : null;
    if (parent && nodes.has(parent)) {
      const list = childrenOf.get(parent);
      if (list) list.push(node.key);
      else childrenOf.set(parent, [node.key]);
    } else {
      roots.push(node.key);
    }
  }

  const depthOf = new Map<string, number>();
  const levels: string[][] = [];
  const queue: Array<[string, number]> = roots.map((r) => [r, 0]);
  for (let i = 0; i < queue.length; i++) {
    const [key, depth] = queue[i];
    if (depthOf.has(key)) continue;
    depthOf.set(key, depth);
    (levels[depth] ??= []).push(key);
    for (const child of childrenOf.get(key) ?? []) queue.push([child, depth + 1]);
  }

  // Nodes never reached are in a cycle with no way in. Surface them as roots
  // so they are at least visible and fixable.
  for (const node of input) {
    if (depthOf.has(node.key)) continue;
    roots.push(node.key);
    depthOf.set(node.key, 0);
    (levels[0] ??= []).push(node.key);
  }

  return { nodes, childrenOf, depthOf, levels, roots, maxDepth: levels.length - 1 };
}

/** Every key below `key`, depth-first. Excludes `key` itself. */
export function descendantsOf(index: ForestIndex, key: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([key]);
  const stack = [...(index.childrenOf.get(key) ?? [])].reverse();
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    const children = index.childrenOf.get(next) ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return out;
}

/** Ancestors of `key`, nearest first. */
export function ancestorsOf(index: ForestIndex, key: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([key]);
  let parent = index.nodes.get(key)?.parentKey ?? null;
  while (parent && index.nodes.has(parent) && !seen.has(parent)) {
    out.push(parent);
    seen.add(parent);
    parent = index.nodes.get(parent)?.parentKey ?? null;
  }
  return out;
}

/** True when the node has no children in the forest. */
export function isLeaf(index: ForestIndex, key: string): boolean {
  return (index.childrenOf.get(key)?.length ?? 0) === 0;
}

/**
 * Where to draw a node: its own position, else its nearest positioned
 * ancestor's. Null when nothing in its chain has a position.
 */
export function effectivePosition(
  index: ForestIndex,
  key: string,
): { lat: number; lng: number } | null {
  const own = index.nodes.get(key);
  if (own && own.lat != null && own.lng != null) return { lat: own.lat, lng: own.lng };
  for (const ancestor of ancestorsOf(index, key)) {
    const node = index.nodes.get(ancestor)!;
    if (node.lat != null && node.lng != null) return { lat: node.lat, lng: node.lng };
  }
  return null;
}

/**
 * The frontier at `level`: every node at that depth, plus leaves that end
 * above it. Order follows the levels (shallow first), then input order.
 */
export function frontierAt(index: ForestIndex, level: number): ForestNode[] {
  const out: ForestNode[] = [];
  const target = Math.max(0, Math.min(level, index.maxDepth));
  for (let depth = 0; depth <= target; depth++) {
    for (const key of index.levels[depth] ?? []) {
      if (depth === target || isLeaf(index, key)) out.push(index.nodes.get(key)!);
    }
  }
  return out;
}

/** Most common echelon at a level — the tooltip on the level control. */
export function dominantEchelonAt(index: ForestIndex, level: number): string | null {
  const counts = new Map<string, number>();
  for (const key of index.levels[level] ?? []) {
    const echelon = index.nodes.get(key)?.echelon || "";
    if (!echelon) continue;
    counts.set(echelon, (counts.get(echelon) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [echelon, count] of counts) {
    if (count > bestCount) {
      best = echelon;
      bestCount = count;
    }
  }
  return best;
}

export type PositionMap = Map<string, { lat: number; lng: number }>;

/**
 * Move a node and every POSITIONED descendant by the same offset, so the
 * subtree keeps its shape. Returns only the nodes whose stored position
 * changes; descendants without a position follow implicitly through
 * effectivePosition.
 */
export function translateSubtree(
  index: ForestIndex,
  key: string,
  to: { lat: number; lng: number },
): PositionMap {
  const moves: PositionMap = new Map();
  const from = effectivePosition(index, key);
  if (!from) {
    moves.set(key, to);
    return moves;
  }
  const dLat = to.lat - from.lat;
  const dLng = to.lng - from.lng;
  for (const k of [key, ...descendantsOf(index, key)]) {
    const node = index.nodes.get(k);
    if (!node) continue;
    if (node.lat == null || node.lng == null) {
      // Only the dragged node gets a position it didn't have — it is what
      // the planner put somewhere. Its unpositioned descendants inherit.
      if (k === key) moves.set(k, to);
      continue;
    }
    moves.set(k, { lat: node.lat + dLat, lng: node.lng + dLng });
  }
  return moves;
}

/** A copy of the nodes with position overrides applied. */
export function withPositionOverrides(nodes: ForestNode[], overrides: PositionMap): ForestNode[] {
  if (overrides.size === 0) return nodes;
  return nodes.map((node) => {
    const o = overrides.get(node.key);
    return o ? { ...node, lat: o.lat, lng: o.lng } : node;
  });
}
