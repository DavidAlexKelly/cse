import type { Node, Edge } from "@xyflow/react";
import type { TaskNodeData } from "./data.js";
import type { PhaseRecord } from "../../shared/hooks/useNxgPhases.js";

// ── Auto-layout algorithms for reorganizing the graph ───────────────────

const NODE_WIDTH = 260;
const NODE_HEIGHT = 160;
const H_GAP = 60;
const V_GAP = 40;

/**
 * Horizontal left-to-right layout (default)
 * Groups nodes by dependency depth (topological sort)
 */
export function layoutHorizontal(
  nodes: Node<TaskNodeData>[],
  edges: Edge[],
): Node<TaskNodeData>[] {
  const depths = computeDepths(nodes, edges);
  const columns = groupByDepth(nodes, depths);

  const result: Node<TaskNodeData>[] = [];
  let xOffset = 0;

  for (const col of columns) {
    const totalHeight = col.length * NODE_HEIGHT + (col.length - 1) * V_GAP;
    let yOffset = -totalHeight / 2;

    for (const node of col) {
      result.push({
        ...node,
        position: { x: xOffset, y: yOffset },
      });
      yOffset += NODE_HEIGHT + V_GAP;
    }
    xOffset += NODE_WIDTH + H_GAP;
  }

  return result;
}

/**
 * Vertical top-to-bottom layout
 */
export function layoutVertical(
  nodes: Node<TaskNodeData>[],
  edges: Edge[],
): Node<TaskNodeData>[] {
  const depths = computeDepths(nodes, edges);
  const rows = groupByDepth(nodes, depths);

  const result: Node<TaskNodeData>[] = [];
  let yOffset = 0;

  for (const row of rows) {
    const totalWidth = row.length * NODE_WIDTH + (row.length - 1) * H_GAP;
    let xOffset = -totalWidth / 2;

    for (const node of row) {
      result.push({
        ...node,
        position: { x: xOffset, y: yOffset },
      });
      xOffset += NODE_WIDTH + H_GAP;
    }
    yOffset += NODE_HEIGHT + V_GAP;
  }

  return result;
}

/**
 * Grid layout (equal spacing)
 */
export function layoutGrid(nodes: Node<TaskNodeData>[]): Node<TaskNodeData>[] {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  return nodes.map((node, i) => ({
    ...node,
    position: {
      x: (i % cols) * (NODE_WIDTH + H_GAP),
      y: Math.floor(i / cols) * (NODE_HEIGHT + V_GAP),
    },
  }));
}

/**
 * Phase swimlane layout.
 * Each phase is a horizontal band. Tasks within the same phase
 * are placed left-to-right. Phases stack top-to-bottom in sequence order.
 * Tasks with no matching phase are placed in a final "unphased" band.
 */
export function layoutByPhase(
  nodes: Node<TaskNodeData>[],
  phases: PhaseRecord[],
): Node<TaskNodeData>[] {
  if (phases.length === 0) return layoutHorizontal(nodes, []);

  const BAND_PADDING_TOP = 20;
  const BAND_PADDING_BOTTOM = 40;
  const X_PADDING = 20;

  // Group nodes by the category field which is set to the phaseName
  const phaseNameToPhase = new Map(phases.map(p => [p.phaseName, p]));

  const phaseGroups: Map<string, Node<TaskNodeData>[]> = new Map();
  const unphased: Node<TaskNodeData>[] = [];

  for (const node of nodes) {
    const phaseName = (node.data as TaskNodeData).category;
    const phase = phaseNameToPhase.get(phaseName);
    if (phase) {
      if (!phaseGroups.has(phase.phaseId)) phaseGroups.set(phase.phaseId, []);
      phaseGroups.get(phase.phaseId)!.push(node);
    } else {
      unphased.push(node);
    }
  }

  const result: Node<TaskNodeData>[] = [];
  let yBandStart = 0;

  const orderedPhases = [...phases].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  for (const phase of orderedPhases) {
    const group = phaseGroups.get(phase.phaseId) ?? [];
    let xOffset = X_PADDING;

    for (const node of group) {
      result.push({
        ...node,
        position: { x: xOffset, y: yBandStart + BAND_PADDING_TOP },
      });
      xOffset += NODE_WIDTH + H_GAP;
    }

    yBandStart += NODE_HEIGHT + BAND_PADDING_TOP + BAND_PADDING_BOTTOM;
  }

  // Unphased nodes at the bottom
  if (unphased.length > 0) {
    let xOffset = X_PADDING;
    for (const node of unphased) {
      result.push({
        ...node,
        position: { x: xOffset, y: yBandStart + BAND_PADDING_TOP },
      });
      xOffset += NODE_WIDTH + H_GAP;
    }
  }

  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function computeDepths(nodes: Node<TaskNodeData>[], edges: Edge[]): Map<string, number> {
  const depths = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    adj.set(n.id, []);
    inDegree.set(n.id, 0);
    depths.set(n.id, 0);
  }

  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  // BFS topological
  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depths.get(current) ?? 0;
    for (const next of adj.get(current) ?? []) {
      const newDepth = currentDepth + 1;
      if (newDepth > (depths.get(next) ?? 0)) {
        depths.set(next, newDepth);
      }
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      if ((inDegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }

  return depths;
}

function groupByDepth(
  nodes: Node<TaskNodeData>[],
  depths: Map<string, number>,
): Node<TaskNodeData>[][] {
  const maxDepth = Math.max(...depths.values(), 0);
  const groups: Node<TaskNodeData>[][] = Array.from({ length: maxDepth + 1 }, () => []);

  for (const node of nodes) {
    const d = depths.get(node.id) ?? 0;
    groups[d].push(node);
  }

  return groups.filter((g) => g.length > 0);
}
