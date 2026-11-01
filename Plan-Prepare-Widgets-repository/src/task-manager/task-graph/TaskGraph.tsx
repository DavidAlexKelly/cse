/* eslint-disable react-refresh/only-export-components */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  MarkerType,
  addEdge,
} from "@xyflow/react";
import type { NodeMouseHandler, Connection } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@blueprintjs/core";
import { TaskNodeComponent } from "./TaskNodeComponent.js";
import { PhaseGroupNode } from "./PhaseGroupNode.js";
import { PhaseNode } from "./PhaseNode.js";
import type { PhaseNodeData } from "./PhaseNode.js";
import { taskNodes, taskEdges } from "./data.js";
import type { TaskNodeData, TaskEdgeData } from "./data.js";
import { reconcileGraph } from "./graphEngine.js";
import { TaskDetailPanel } from "./TaskDetailPanel.js";
import { pageContentMap } from "./pageContent.js";
import { AddNodeModal } from "./AddNodeModal.js";
import { layoutHorizontal, layoutVertical, layoutGrid, layoutByPhase } from "./layoutUtils.js";
import type { PhaseRecord } from "../../shared/hooks/useNxgPhases.js";
import "../../shared/styling/index.css";
import "./taskGraph.css";

// ── Custom node type registry ──────────────────────────────────────────
const nodeTypes = {
  taskNode: TaskNodeComponent,
  phaseGroup: PhaseGroupNode,
  phaseNode: PhaseNode,
};

// ── Default edge options ───────────────────────────────────────────────
const defaultEdgeOptions = {
  type: "smoothstep" as const,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: "#2f3860",
  },
  style: {
    stroke: "#2f3860",
    strokeWidth: 2,
  },
};

type LayoutMode = "horizontal" | "vertical" | "grid" | "phase";

// ── Phase colour palette ──────────────────────────────────────────────────
export const PHASE_COLOURS = [
  "#6c5ce7",
  "#4c7ef3",
  "#7157d9",
  "#f0a83c",
  "#ef4d4d",
  "#8b7cf6",
];

// ── Build graph nodes from live tasks ─────────────────────────────────────
export type LiveTask = {
  id: string;
  title: string;
  description: string;
  section: string;
  phaseId: string | null;
  owner: string | null;
  approver: string | null;
  status: string;
  subTasks?: { id: string; label: string; done: boolean }[];
};

export function buildNodesFromTasks(
  tasks: LiveTask[],
  phases: PhaseRecord[],
): typeof taskNodes {
  const statusMap: Record<string, TaskNodeData["status"]> = {
    assigned: "in-review",
    "in-review": "in-review",
    pending: "pending",
    approved: "approved",
  };

  return tasks.map((t, i) => {
    const phase = phases.find(p => p.phaseId === t.phaseId);
    return {
      id: t.id,
      type: "taskNode" as const,
      position: { x: i * 300, y: 0 }, // layout overrides this
      data: {
        label: t.title,
        description: t.description,
        assignee: t.owner ?? "",
        reviewer: t.approver ?? "",
        status: statusMap[t.status] ?? "pending",
        priority: (t.status === "assigned" ? "active" : t.status === "in-review" ? "warning" : "grey") as TaskNodeData["priority"],
        progress: 0,
        category: phase?.phaseName ?? t.section,
        subtasks: (t.subTasks ?? []).map(st => ({
          id: st.id,
          label: st.label,
          done: st.done,
        })),
      },
    };
  });
}

// ── Derive sequential edges for live tasks (phase-order flow) ─────────────
// When there are no ontology-defined edges, connect tasks within each phase
// sequentially (by title order) and connect the last task of each phase
// to the first task of the next phase.
function buildLiveEdges(
  tasks: LiveTask[],
  phases: PhaseRecord[],
): typeof taskEdges {
  const edges: typeof taskEdges = [];

  if (phases.length === 0) {
    // No phases — just connect all tasks in sequence
    for (let i = 0; i < tasks.length - 1; i++) {
      edges.push({
        id: `e-seq-${i}`,
        source: tasks[i].id,
        target: tasks[i + 1].id,
        data: { kind: "active" },
      });
    }
    return edges;
  }

  const orderedPhases = [...phases].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  // Group tasks by phase, sorted alphabetically within each phase
  const tasksByPhase = new Map<string, LiveTask[]>();
  for (const phase of orderedPhases) {
    const phaseTasks = tasks
      .filter(t => t.phaseId === phase.phaseId)
      .sort((a, b) => a.title.localeCompare(b.title));
    if (phaseTasks.length > 0) tasksByPhase.set(phase.phaseId, phaseTasks);
  }

  // Connect within each phase sequentially
  for (const [, phaseTasks] of tasksByPhase) {
    for (let i = 0; i < phaseTasks.length - 1; i++) {
      edges.push({
        id: `e-${phaseTasks[i].id}-${phaseTasks[i + 1].id}`,
        source: phaseTasks[i].id,
        target: phaseTasks[i + 1].id,
        data: { kind: "active" },
      });
    }
  }

  // Connect last task of each phase to first task of the next phase
  const phaseList = orderedPhases.filter(p => tasksByPhase.has(p.phaseId));
  for (let pi = 0; pi < phaseList.length - 1; pi++) {
    const currentTasks = tasksByPhase.get(phaseList[pi].phaseId)!;
    const nextTasks = tasksByPhase.get(phaseList[pi + 1].phaseId)!;
    const lastCurrent = currentTasks[currentTasks.length - 1];
    const firstNext = nextTasks[0];
    edges.push({
      id: `e-phase-${phaseList[pi].phaseId}-to-${phaseList[pi + 1].phaseId}`,
      source: lastCurrent.id,
      target: firstNext.id,
      data: { kind: "active" },
    });
  }

  return edges;
}

// ── Build phase background group nodes ───────────────────────────────────
const NODE_WIDTH = 260;
const NODE_HEIGHT = 160;
const BAND_PADDING_TOP = 20;
const BAND_PADDING_BOTTOM = 40;
const BAND_SIDE_PADDING = 20;

function buildPhaseGroupNodes(
  taskNodeList: typeof taskNodes,
  phases: PhaseRecord[],
) {
  const orderedPhases = [...phases].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  // Group task nodes by phaseName (set as category)
  const phaseNameToPhase = new Map(phases.map(p => [p.phaseName, p]));
  const phaseTaskNodes = new Map<string, typeof taskNodes>();
  for (const node of taskNodeList) {
    const phase = phaseNameToPhase.get((node.data as TaskNodeData).category);
    if (phase) {
      if (!phaseTaskNodes.has(phase.phaseId)) phaseTaskNodes.set(phase.phaseId, []);
      phaseTaskNodes.get(phase.phaseId)!.push(node);
    }
  }

  const groupNodes: {
    id: string;
    type: "phaseGroup";
    position: { x: number; y: number };
    style: { width: number; height: number };
    data: { label: string; colour: string; sequenceNumber: number; startOffset: string; endOffset: string };
    zIndex: number;
    selectable: boolean;
    draggable: boolean;
  }[] = [];

  for (let i = 0; i < orderedPhases.length; i++) {
    const phase = orderedPhases[i];
    const nodes = phaseTaskNodes.get(phase.phaseId) ?? [];
    if (nodes.length === 0) continue;

    const xs = nodes.map(n => n.position.x);
    const ys = nodes.map(n => n.position.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs) + NODE_WIDTH;
    const maxY = Math.max(...ys) + NODE_HEIGHT;

    const colour = PHASE_COLOURS[i % PHASE_COLOURS.length];

    groupNodes.push({
      id: `phase-group-${phase.phaseId}`,
      type: "phaseGroup",
      position: {
        x: minX - BAND_SIDE_PADDING,
        y: minY - BAND_PADDING_TOP,
      },
      style: {
        width: maxX - minX + BAND_SIDE_PADDING * 2,
        height: maxY - minY + BAND_PADDING_TOP + BAND_PADDING_BOTTOM,
      },
      data: {
        label: phase.phaseName,
        colour,
        sequenceNumber: phase.sequenceNumber || i + 1,
        startOffset: phase.startOffset,
        endOffset: phase.endOffset,
      },
      zIndex: -1,
      selectable: false,
      draggable: false,
    });
  }

  return groupNodes;
}

// ── Build overview (one node per phase) ───────────────────────────────────
const PHASE_NODE_WIDTH  = 220;
const PHASE_NODE_H_GAP  = 80;

function buildOverviewGraph(
  tasks: LiveTask[],
  phases: PhaseRecord[],
  onExplore: (phaseId: string) => void,
): { nodes: any[]; edges: any[] } {
  const ordered = [...phases].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const nodes = ordered.map((phase, i) => {
    const phaseTasks  = tasks.filter(t => t.phaseId === phase.phaseId);
    const assigned    = phaseTasks.filter(t => t.status === "assigned" || t.status === "in-review").length;
    const pending     = phaseTasks.filter(t => t.status === "pending").length;
    const colour      = PHASE_COLOURS[i % PHASE_COLOURS.length];
    return {
      id:       `overview-${phase.phaseId}`,
      type:     "phaseNode",
      position: { x: i * (PHASE_NODE_WIDTH + PHASE_NODE_H_GAP), y: 0 },
      data: {
        phaseId:        phase.phaseId,
        phaseName:      phase.phaseName,
        sequenceNumber: phase.sequenceNumber ?? i + 1,
        startOffset:    phase.startOffset,
        endOffset:      phase.endOffset,
        taskCount:      phaseTasks.length,
        assignedCount:  assigned,
        pendingCount:   pending,
        colour,
        onExplore,
      } as PhaseNodeData,
    };
  });

  const edges = ordered.slice(0, -1).map((phase, i) => ({
    id:     `ov-edge-${i}`,
    source: `overview-${phase.phaseId}`,
    target: `overview-${ordered[i + 1].phaseId}`,
    type:   "smoothstep",
    markerEnd: {
      type:  MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: "#2f3860",
    },
    style: { stroke: "#2f3860", strokeWidth: 2 },
  }));

  return { nodes, edges };
}

// ── Initial state: run reconciliation on initial data ──────────────────
const initialState = reconcileGraph(taskNodes, taskEdges);

export interface TaskGraphProps {
  /** When true the component's own header is hidden (used when embedded in TaskAssignment) */
  embedded?: boolean;
  /** Phases injected from parent (TaskAssignment) when embedded */
  phases?: PhaseRecord[];
  /** Live tasks injected from parent when embedded */
  liveTasks?: LiveTask[];
}

export const TaskGraph: React.FC<TaskGraphProps> = ({ embedded = false, phases = [], liveTasks = [] }) => {
  // ── View level: "overview" = phase nodes, "detail" = task nodes ───────
  const [viewLevel,        setViewLevel]        = useState<"overview" | "detail">("overview");
  const [activePhaseDrill, setActivePhaseDrill] = useState<string | null>(null); // phaseId being drilled

  const [nodes, setNodes, onNodesChange] = useNodesState(initialState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialState.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [layoutMode,     setLayoutMode]     = useState<LayoutMode>("phase");
  const [reconcileFlag,  setReconcileFlag]  = useState(0);
  // ── Explore a phase (overview → detail) ───────────────────────────────
  const handleExplorePhase = useCallback((phaseId: string) => {
    setActivePhaseDrill(phaseId);
    setViewLevel("detail");
  }, []);

  // ── Return to overview ──────────────────────────────────────────────
  const handleBackToOverview = useCallback(() => {
    setViewLevel("overview");
    setActivePhaseDrill(null);
      setSelectedNodeId(null);
  }, []);

  // ── Hydrate graph from live tasks whenever they change ─────────────
  useEffect(() => {
    const usingLive = liveTasks.length > 0;

    // ── Overview: one node per phase ──────────────────────────────────
    if (viewLevel === "overview" && phases.length > 0) {
      const { nodes: ovNodes, edges: ovEdges } = buildOverviewGraph(
        usingLive ? liveTasks : [],
        phases,
        handleExplorePhase,
  );
      setNodes(ovNodes);
      setEdges(ovEdges);
      return;
    }

    // ── Detail: all task nodes (optionally filtered to one phase) ─────
    const sourceNodes = usingLive ? buildNodesFromTasks(liveTasks, phases) : taskNodes;
    const sourceEdges = usingLive ? buildLiveEdges(liveTasks, phases) : taskEdges;

    // If drilled into a specific phase, only show that phase's tasks
    const filteredNodes = activePhaseDrill
      ? sourceNodes.filter(n => {
          const phase = phases.find(p => p.phaseId === activePhaseDrill);
          return phase && (n.data as TaskNodeData).category === phase.phaseName;
        })
      : sourceNodes;
    const filteredIds = new Set(filteredNodes.map(n => n.id));
    const filteredEdges = activePhaseDrill
      ? sourceEdges.filter(e => filteredIds.has(e.source) && filteredIds.has(e.target))
      : sourceEdges;

    const result = reconcileGraph(filteredNodes, filteredEdges);

    const mode: LayoutMode = phases.length > 0 ? "phase" : "horizontal";
      setLayoutMode(mode);

    const laidTaskNodes = mode === "phase"
      ? layoutByPhase(result.nodes, activePhaseDrill
          ? phases.filter(p => p.phaseId === activePhaseDrill)
          : phases)
      : layoutHorizontal(result.nodes, result.edges);

    // Build phase background group nodes after layout (positions are now set)
    const groupNodes = (phases.length > 0 && !activePhaseDrill)
        ? buildPhaseGroupNodes(laidTaskNodes, phases)
        : [];

    // Group nodes go FIRST so they render behind task nodes
    setNodes([...groupNodes as any[], ...laidTaskNodes]);
    setEdges(result.edges);
  // Re-run only when tasks/phases change identity
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTasks, phases, viewLevel, activePhaseDrill]);

  // ── Re-attach onExplore callbacks after overview node re-render ───────
  // (callbacks can't be stored in RF node data across re-renders)
  useEffect(() => {
    if (viewLevel !== "overview") return;
    setNodes(prev => prev.map(n => {
      if (n.type !== "phaseNode") return n;
      return { ...n, data: { ...n.data, onExplore: handleExplorePhase } };
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewLevel, handleExplorePhase]);

  // ── Reconcile whenever nodes/edges change meaningfully ─────────────
  // This re-derives progress, blocked subtasks, and edge styles
  useEffect(() => {
    // Only reconcile in detail view
    if (viewLevel === "overview") return;
    // Only reconcile task nodes (skip phase group nodes)
    const taskNodesCurrent = nodes.filter(n => n.type === "taskNode");
    const result = reconcileGraph(taskNodesCurrent as typeof taskNodes, edges);
    // Only update if derived data actually changed (avoid infinite loop)
    const nodesChanged = result.nodes.some((n, i) => {
      const cur = taskNodesCurrent[i];
      if (!cur) return true;
      return n.data.progress !== cur.data.progress ||
        JSON.stringify(n.data.subtasks) !== JSON.stringify(cur.data.subtasks);
    });
    const edgesChanged = result.edges.some((e, i) => {
      const cur = edges[i];
      if (!cur) return true;
      return e.animated !== cur.animated || JSON.stringify(e.style) !== JSON.stringify(cur.style);
    });
    if (nodesChanged) {
      setNodes(prev => prev.map(n => {
        if (n.type !== "taskNode") return n;
        const updated = result.nodes.find(r => r.id === n.id);
        return updated ?? n;
      }));
    }
    if (edgesChanged) setEdges(result.edges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconcileFlag]);

  // Trigger reconciliation
  const triggerReconcile = useCallback(() => setReconcileFlag(f => f + 1), []);

  const stats = useMemo(() => {
    const d = nodes.filter(n => n.type === "taskNode").map((n) => n.data as TaskNodeData);
    return {
      total: d.length,
      approved: d.filter((t) => t.status === "approved").length,
      inReview: d.filter((t) => t.status === "in-review" || t.status === "save").length,
      pending: d.filter((t) => t.status === "pending").length,
    };
  }, [nodes]);

  // ── Node click → open detail panel ─────────────────────────────────
  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === "phaseGroup" || node.type === "phaseNode") return; // ignore clicks on phase boxes
    setSelectedNodeId(node.id);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // ── Connect edges (drag from handle to handle) ─────────────────────
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          { ...connection, data: { kind: "active" } as TaskEdgeData },
          eds,
        ),
      );
      triggerReconcile();
    },
    [setEdges, triggerReconcile],
  );

  // ── Add new node ───────────────────────────────────────────────────
  const handleAddNode = useCallback(
    (data: TaskNodeData) => {
      const id = `node-${Date.now()}`;
      const taskNodesList = nodes.filter(n => n.type === "taskNode");
      const maxX = taskNodesList.reduce((max, n) => Math.max(max, n.position.x), 0);
      const maxY = taskNodesList.reduce((max, n) => Math.max(max, n.position.y), 0);
      setNodes((nds) => [
        ...nds,
        {
          id,
          type: "taskNode",
          position: { x: maxX + 300, y: maxY / 2 },
          data,
        },
      ]);
      setShowAddModal(false);
      triggerReconcile();
    },
    [nodes, setNodes, triggerReconcile],
  );

  // ── Delete selected node ───────────────────────────────────────────
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      // Also clear any blockedBy references pointing to this node
      setNodes((nds) =>
        nds
          .filter((n) => n.id !== nodeId)
          .map((n) => {
            if (n.type !== "taskNode") return n;
            const subtasks = (n.data as TaskNodeData).subtasks?.map((st) =>
              st.blockedBy === nodeId ? { ...st, blockedBy: undefined, blocked: false } : st,
            );
            return subtasks ? { ...n, data: { ...n.data, subtasks } } : n;
          }),
      );
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
      triggerReconcile();
    },
    [setNodes, setEdges, triggerReconcile],
  );

  // ── Status workflow transitions ────────────────────────────────────
  const handleStatusChange = useCallback(
    (nodeId: string, newStatus: TaskNodeData["status"]) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, status: newStatus } }
            : n,
        ),
      );
      // Reconcile to update edges + downstream blocked subtasks
      triggerReconcile();
    },
    [setNodes, triggerReconcile],
  );

  // ── Toggle subtask done ────────────────────────────────────────────
  const handleToggleSubtask = useCallback(
    (nodeId: string, subtaskId: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const subtasks = (n.data as TaskNodeData).subtasks?.map((st) =>
            st.id === subtaskId ? { ...st, done: !st.done } : st,
          );
          return { ...n, data: { ...n.data, subtasks } };
        }),
      );
      triggerReconcile();
    },
    [setNodes, triggerReconcile],
  );

  // ── Auto-layout ────────────────────────────────────────────────────
  const applyLayout = useCallback(
    (mode: LayoutMode) => {
      setLayoutMode(mode);
      const taskNodesCurrent = nodes.filter(n => n.type === "taskNode") as typeof taskNodes;
      const drillPhases = activePhaseDrill
        ? phases.filter(p => p.phaseId === activePhaseDrill)
        : phases;
      let laidTaskNodes: typeof taskNodes;
      switch (mode) {
        case "phase":
          laidTaskNodes = layoutByPhase(taskNodesCurrent, drillPhases);
          break;
        case "vertical":
          laidTaskNodes = layoutVertical(taskNodesCurrent, edges);
          break;
        case "grid":
          laidTaskNodes = layoutGrid(taskNodesCurrent);
          break;
        case "horizontal":
        default:
          laidTaskNodes = layoutHorizontal(taskNodesCurrent, edges);
          break;
      }
      const groupNodes = (mode === "phase" && phases.length > 0 && !activePhaseDrill)
        ? buildPhaseGroupNodes(laidTaskNodes, phases)
        : [];
      setNodes([...groupNodes as any[], ...laidTaskNodes]);
    },
    [nodes, edges, phases, activePhaseDrill, setNodes],
  );

  // ── Resolved phase name for breadcrumb ────────────────────────────────
  const activePhaseName = activePhaseDrill
    ? phases.find(p => p.phaseId === activePhaseDrill)?.phaseName
    : null;

  const activePageContent = selectedNodeId ? pageContentMap[selectedNodeId] : null;
  const selectedNodeData = selectedNodeId
    ? (nodes.find((n) => n.id === selectedNodeId)?.data as TaskNodeData | undefined)
    : undefined;

  const layoutToolbar = viewLevel === "detail" && (
    <div className="tg-btn-group">
      {phases.length > 0 && !activePhaseDrill && (
        <button
          className={`tg-btn ${layoutMode === "phase" ? "tg-btn--active" : ""}`}
          onClick={() => applyLayout("phase")}
          title="Phase swimlane layout"
        >
          ≡
        </button>
      )}
      <button
        className={`tg-btn ${layoutMode === "horizontal" ? "tg-btn--active" : ""}`}
        onClick={() => applyLayout("horizontal")}
        title="Horizontal layout"
      >
        ⬌
      </button>
      <button
        className={`tg-btn ${layoutMode === "vertical" ? "tg-btn--active" : ""}`}
        onClick={() => applyLayout("vertical")}
        title="Vertical layout"
      >
        ⬍
      </button>
      <button
        className={`tg-btn ${layoutMode === "grid" ? "tg-btn--active" : ""}`}
        onClick={() => applyLayout("grid")}
        title="Grid layout"
      >
        ⊞
      </button>
    </div>
  );

  return (
    <div className={`task-graph-wrapper bp5-dark ${embedded ? "task-graph-wrapper--embedded" : ""}`}>
      {/* ── Header — hidden when embedded, shown in standalone mode ──── */}
      {!embedded && (
        <div className="tg-header">
          <div className="tg-header__title">
            <svg
              className="tg-header__title-icon"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M2 2h5v5H2zM9 2h5v5H9zM5.5 9.5h5v5h-5zM7 7v2.5M4.5 7v3.5h1M11.5 7v3.5h-1" stroke="currentColor" fill="none" strokeWidth="1.5" />
            </svg>
            Task Graph
            <span className="tg-header__subtitle">
              {viewLevel === "overview"
                ? `Phase Overview · ${phases.length} phase${phases.length !== 1 ? "s" : ""}`
                : `${activePhaseName ?? "All Tasks"} · ${stats.total} task${stats.total !== 1 ? "s" : ""}`
              }
            </span>
          </div>

          {/* ── Toolbar actions ──────────────────────────────────────────── */}
          <div className="tg-header__actions">
            {layoutToolbar}
            {viewLevel === "detail" && (
              <button
                className="tg-btn tg-btn--primary"
                onClick={() => setShowAddModal(true)}
              >
                + Add Node
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Embedded toolbar (compact, no title) ─────────────────────── */}
      {embedded && (
        <div className="tg-embedded-toolbar">
          {layoutToolbar}
          {viewLevel === "detail" && (
            <button
              className="tg-btn tg-btn--primary"
              onClick={() => setShowAddModal(true)}
            >
              + Add Node
            </button>
          )}
        </div>
      )}

      {/* ── Breadcrumb / back bar (detail view) ───────────────────────── */}
      {viewLevel === "detail" && (
        <div className="tg-breadcrumb">
          <button className="tg-breadcrumb__back" onClick={handleBackToOverview}>
            <Icon icon="chevron-left" size={11} />
            Phase Overview
          </button>
          {activePhaseName && (
            <>
              <span className="tg-breadcrumb__sep">/</span>
              <span className="tg-breadcrumb__current">{activePhaseName}</span>
            </>
          )}
        </div>
      )}

      {/* ── React Flow Canvas ─────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.2}
          maxZoom={2}
          deleteKeyCode={viewLevel === "detail" ? "Delete" : null}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#1a1f36"
          />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) => n.type === "phaseGroup" ? "transparent" : "#1a1f36"}
            maskColor="rgba(108, 92, 231, 0.08)"
            style={{
              backgroundColor: "#0e1120",
              border: "1px solid #232a45",
              borderRadius: 3,
            }}
          />
        </ReactFlow>

        {/* ── Detail Panel (slides in from right) ─────────────────────── */}
        {selectedNodeId && viewLevel === "detail" && (
          <TaskDetailPanel
            nodeId={selectedNodeId}
            content={activePageContent ?? null}
            nodeData={selectedNodeData ?? null}
            onClose={handleClosePanel}
            onDelete={handleDeleteNode}
            onStatusChange={handleStatusChange}
            onToggleSubtask={handleToggleSubtask}
          />
        )}
      </div>

      {/* ── Legend / Status bar ────────────────────────────────────────── */}
      <div className="tg-legend">
        {viewLevel === "overview" ? (
          <>
            <div className="tg-legend__item">
              <Icon icon="info-sign" size={10} />
              Click &ldquo;Explore Phase&rdquo; on any node to drill into its tasks
            </div>
            {phases.map((p, i) => (
              <div key={p.phaseId} className="tg-legend__item">
                <div className="tg-legend__dot" style={{ background: PHASE_COLOURS[i % PHASE_COLOURS.length], borderRadius: 1 }} />
                {p.phaseName}
              </div>
            ))}
          </>
        ) : (
          <>
            {/* Status counts */}
            <div className="tg-legend__item">
              <div className="tg-legend__dot" style={{ background: "#6c5ce7" }} />
              {stats.approved} Approved
            </div>
            <div className="tg-legend__item">
              <div className="tg-legend__dot" style={{ background: "#f0a83c" }} />
              {stats.inReview} In Progress
            </div>
            <div className="tg-legend__item">
              <div className="tg-legend__dot" style={{ background: "#98a1c0" }} />
              {stats.pending} Pending
            </div>

            {/* Separator */}
            <div style={{ width: 1, height: 14, background: "#232a45", margin: "0 6px" }} />

            {/* Edge legend */}
            <div className="tg-legend__item">
              <svg width="24" height="6" viewBox="0 0 24 6">
                <line x1="0" y1="3" x2="24" y2="3" stroke="#6c5ce7" strokeWidth="2" />
              </svg>
              Ready
            </div>
            <div className="tg-legend__item">
              <svg width="24" height="6" viewBox="0 0 24 6">
                <line x1="0" y1="3" x2="24" y2="3" stroke="#2f3860" strokeWidth="2" />
              </svg>
              Active
            </div>
            <div className="tg-legend__item">
              <svg width="24" height="6" viewBox="0 0 24 6">
                <line x1="0" y1="3" x2="24" y2="3" stroke="#f0a83c" strokeWidth="2" strokeDasharray="4 3" />
              </svg>
              Blocked
            </div>
          </>
        )}
      </div>

      {/* ── Add Node Modal ────────────────────────────────────────────── */}
      {showAddModal && (
        <AddNodeModal onAdd={handleAddNode} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
};

