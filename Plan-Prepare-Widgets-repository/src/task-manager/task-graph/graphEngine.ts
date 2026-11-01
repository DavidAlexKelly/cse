import type { Node, Edge } from "@xyflow/react";
import type { TaskNodeData, Subtask, TaskEdgeData } from "./data.js";

// ============================================================
// Graph Engine — single source of truth for derived state
//
// This module computes:
// 1. Progress from subtasks (done / total)
// 2. Blocked subtask flags from upstream node readiness
// 3. Edge visual styles from source/target node status
//
// Rules:
//   - progress = subtasks.filter(done).length / subtasks.length
//     (if no subtasks, progress stays as manually set)
//   - A subtask is "blocked" if it has a blockedBy ref and that
//     node is NOT approved
//   - Edge categories (derived, never hardcoded):
//     READY   — source is approved → solid green
//     ACTIVE  — source is in-review or save → solid default
//     BLOCKED — source is pending (not started) → dashed amber
// ============================================================

// ── Edge category definitions ───────────────────────────────────────────
// These are the ONLY 3 edge categories. They are derived from the source
// node status at render time — never set manually.

export type DerivedEdgeCategory = "ready" | "active" | "blocked";

interface EdgeVisual {
  stroke: string;
  strokeDasharray?: string;
  animated: boolean;
  label: string;
  labelColor: string;
}

const EDGE_VISUALS: Record<DerivedEdgeCategory, EdgeVisual> = {
  ready: {
    stroke: "#6c5ce7",
    animated: false,
    label: "ready",
    labelColor: "#6c5ce7",
  },
  active: {
    stroke: "#2f3860",
    animated: false,
    label: "",
    labelColor: "#98a1c0",
  },
  blocked: {
    stroke: "#f0a83c",
    strokeDasharray: "6 4",
    animated: true,
    label: "blocked",
    labelColor: "#f0a83c",
  },
};

function deriveEdgeCategory(sourceStatus: TaskNodeData["status"]): DerivedEdgeCategory {
  switch (sourceStatus) {
    case "approved":
      return "ready";
    case "in-review":
    case "save":
      return "active";
    case "pending":
    default:
      return "blocked";
  }
}

// ── Compute progress from subtasks ──────────────────────────────────────
function computeProgress(subtasks: Subtask[] | undefined, fallback: number): number {
  if (!subtasks || subtasks.length === 0) return fallback;
  const done = subtasks.filter((s) => s.done).length;
  return done / subtasks.length;
}

// ── Derive blocked state for subtasks ───────────────────────────────────
function deriveSubtaskBlocked(
  subtasks: Subtask[] | undefined,
  nodeMap: Map<string, TaskNodeData>,
): Subtask[] | undefined {
  if (!subtasks) return undefined;
  return subtasks.map((st) => {
    if (!st.blockedBy) return { ...st, blocked: false };
    const blocker = nodeMap.get(st.blockedBy);
    // Blocked if the upstream node exists and is NOT approved
    const isBlocked = blocker ? blocker.status !== "approved" : false;
    return { ...st, blocked: isBlocked };
  });
}

// ── Main reconciliation function ────────────────────────────────────────
// Call this after every state change. It returns updated nodes and edges.

export function reconcileGraph(
  nodes: Node<TaskNodeData>[],
  edges: Edge<TaskEdgeData>[],
): { nodes: Node<TaskNodeData>[]; edges: Edge<TaskEdgeData>[] } {
  // Build lookup
  const nodeMap = new Map<string, TaskNodeData>();
  for (const n of nodes) {
    nodeMap.set(n.id, n.data);
  }

  // 1. Update nodes: derive subtask blocked flags + progress
  const updatedNodes = nodes.map((n) => {
    const d = n.data;
    const subtasks = deriveSubtaskBlocked(d.subtasks, nodeMap);
    const progress = computeProgress(subtasks, d.progress);
    return {
      ...n,
      data: { ...d, subtasks, progress },
    };
  });

  // 2. Update edges: derive visual style from source node status
  const updatedEdges = edges.map((e) => {
    const sourceData = nodeMap.get(e.source);
    if (!sourceData) return e;

    const category = deriveEdgeCategory(sourceData.status);
    const visual = EDGE_VISUALS[category];

    // Preserve any custom note from data
    const note = e.data?.note;

    return {
      ...e,
      animated: visual.animated,
      style: {
        stroke: visual.stroke,
        strokeWidth: 2,
        ...(visual.strokeDasharray ? { strokeDasharray: visual.strokeDasharray } : {}),
      },
      label: visual.label || undefined,
      labelStyle: visual.label
        ? { fill: visual.labelColor, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em" }
        : undefined,
      labelBgStyle: visual.label
        ? { fill: "#080a12", fillOpacity: 0.85 }
        : undefined,
      labelBgPadding: visual.label ? ([4, 6] as [number, number]) : undefined,
      labelBgBorderRadius: visual.label ? 2 : undefined,
      data: { kind: category as TaskEdgeData["kind"], note } as TaskEdgeData,
    };
  });

  return { nodes: updatedNodes, edges: updatedEdges };
}
