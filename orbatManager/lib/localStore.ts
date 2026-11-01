/**
 * localStore.ts
 *
 * Pure local (in-memory) state for the hierarchical map placement system.
 *
 * Design goals:
 * - No Foundry writes — everything is local placeholders.
 * - Each node's position is stored as an OFFSET from its parent.
 *   Absolute position = parent absolute position + offset.
 * - Moving a parent ripples down to all descendants (their offsets are unchanged,
 *   so they follow automatically).
 * - Moving a child only changes that child's offset from its parent.
 * - "Depth level" controls which layer of the hierarchy is currently visible on the map.
 *   Level 0 = roots only; Level 1 = children of roots; etc.
 */

import type { CompositionNode } from "../../../types";

// ── Types ────────────────────────────────────────────────────────────────────

/** Lat/lng pair */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Per-node position record.
 * We store the OFFSET from parent in lat/lng degrees.
 * Root nodes use offset from an imaginary origin (i.e. their absolute position).
 */
export interface NodePosition {
  /** Offset from parent's absolute position (for roots, this IS the absolute position) */
  offsetFromParent: LatLng;
}

export interface LocalOrbatState {
  /** Map of nodeId → NodePosition */
  positions: Map<string, NodePosition>;
  /**
   * The depth level currently shown on the map.
   * 0 = only root nodes shown
   * 1 = children of any placed root shown, etc.
   */
  visibleDepth: number;
  /**
   * Optional: if the user "drilled into" a specific node, only that node's
   * subtree at (visibleDepth - parentDepth) is shown.
   * null = show all roots at current depth.
   */
  focusedNodeId: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Walk the tree to find a node by id */
export function findNodeById(
  root: CompositionNode,
  id: string
): CompositionNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const found = findNodeById(c, id);
    if (found) return found;
  }
  return null;
}

/** Return the depth of a node within a tree (root = 0) */
export function nodeDepth(root: CompositionNode, id: string, depth = 0): number {
  if (root.id === id) return depth;
  for (const c of root.children) {
    const d = nodeDepth(c, id, depth + 1);
    if (d >= 0) return d;
  }
  return -1;
}

/** Collect all nodes at a given depth from a root */
export function nodesAtDepth(root: CompositionNode, targetDepth: number, currentDepth = 0): CompositionNode[] {
  if (currentDepth === targetDepth) return [root];
  return root.children.flatMap((c) => nodesAtDepth(c, targetDepth, currentDepth + 1));
}

/** Find the parent of a node */
export function parentOf(root: CompositionNode, id: string): CompositionNode | null {
  for (const c of root.children) {
    if (c.id === id) return root;
    const p = parentOf(c, id);
    if (p) return p;
  }
  return null;
}

/** Collect all ancestor ids (closest first) */
export function ancestorIds(root: CompositionNode, id: string): string[] {
  function walk(node: CompositionNode, target: string, acc: string[]): string[] | null {
    if (node.id === target) return acc;
    for (const c of node.children) {
      const res = walk(c, target, [node.id, ...acc]);
      if (res) return res;
    }
    return null;
  }
  return walk(root, id, []) ?? [];
}

/** Collect all descendant ids */
export function descendantIds(node: CompositionNode): string[] {
  const ids: string[] = [];
  function walk(n: CompositionNode) {
    ids.push(n.id);
    n.children.forEach(walk);
  }
  node.children.forEach(walk);
  return ids;
}

// ── Position computation ─────────────────────────────────────────────────────

/**
 * Compute the absolute lat/lng of a node given the current position store.
 * Walks up the ancestor chain summing offsets.
 */
export function absolutePosition(
  root: CompositionNode,
  nodeId: string,
  positions: Map<string, NodePosition>
): LatLng | null {
  // Build ancestor chain: [root, ..., parent, node]
  function buildChain(n: CompositionNode, target: string, chain: CompositionNode[]): CompositionNode[] | null {
    if (n.id === target) return [...chain, n];
    for (const c of n.children) {
      const res = buildChain(c, target, [...chain, n]);
      if (res) return res;
    }
    return null;
  }

  const chain = buildChain(root, nodeId, []);
  if (!chain) return null;

  // Sum up offsets along the chain
  let lat = 0;
  let lng = 0;
  for (const n of chain) {
    const pos = positions.get(n.id);
    if (pos) {
      lat += pos.offsetFromParent.lat;
      lng += pos.offsetFromParent.lng;
    }
  }
  return { lat, lng };
}

/**
 * Compute default child offsets around a parent position.
 * Arranges children in a horizontal row below the parent.
 */
export function defaultChildOffsets(
  childCount: number,
  _parentLat: number
): LatLng[] {
  if (childCount === 0) return [];

  // Space children evenly horizontally, offset ~200m below parent
  const VERTICAL_OFFSET_DEG = -0.005; // ~500m south
  const H_SPACING_DEG = 0.006;        // ~400m per child

  const offsets: LatLng[] = [];
  const totalWidth = H_SPACING_DEG * (childCount - 1);
  for (let i = 0; i < childCount; i++) {
    offsets.push({
      lat: VERTICAL_OFFSET_DEG,
      lng: -totalWidth / 2 + i * H_SPACING_DEG,
    });
  }
  return offsets;
}

// ── State factory ────────────────────────────────────────────────────────────

export function createEmptyState(): LocalOrbatState {
  return {
    positions: new Map(),
    visibleDepth: 0,
    focusedNodeId: null,
  };
}
