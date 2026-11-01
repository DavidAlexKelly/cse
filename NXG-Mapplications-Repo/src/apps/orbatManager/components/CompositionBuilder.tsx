// components/CompositionBuilder.tsx
//
// Pure canvas + node editor. All template/force navigation is handled by the
// App sidebar. This component renders:
//   - The React Flow graph (full width)
//   - A slide-in right panel showing the CompositionNodeEditor for the
//     currently selected node
//   - A slim toolbar at the top for hint text and node count

import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { v4 as uuidv4 } from "uuid";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ms from "milsymbol";
import type { CompositionNode, HierarchyTemplate, UnitTemplate, GroupTemplate, GroupTemplateNode, OSimAsset, SimTarget, ValidationIssue } from "@/shared/types";
import { SIM_TARGET_LABELS } from "@/shared/types";
import { useCompositionData, type CompositionRefData } from "@/shared/hooks/useCompositionData";
import {
  assetRequiredForEntityType,
  candidateSimulators,
  facetValues,
  selectableAssetsForEntityType,
  simulatorForModel,
  validateComposition,
} from "../../../shared/orbat/assetEligibility";
import { loadSimAssetsForTargets } from "@/shared/lib/foundry";
import { CompositionNodeEditor } from "./CompositionNodeEditor";
import {
  makeSidc,
  echelonFromSidc,
  affiliationFromSidc,
  SIDC_AFF_CODES,
  ECHELON_TO_SIDC_CHAR,
  SIDC_CHAR_TO_ECHELON,
} from "../lib/sidc";

// Re-export so App.tsx and other callers can import from one place
export { makeSidc, echelonFromSidc, affiliationFromSidc, SIDC_AFF_CODES, ECHELON_TO_SIDC_CHAR, SIDC_CHAR_TO_ECHELON };

interface Props {
  root: CompositionNode;
  onRootChange: (root: CompositionNode) => void;
  hierarchyTemplates?: HierarchyTemplate[];
  onSaveHierarchyTemplate?: (input: Record<string, unknown>) => Promise<void>;
  onDeleteHierarchyTemplate?: (id: string) => Promise<void>;
  unitTemplates?: UnitTemplate[];
  groupTemplates?: GroupTemplate[];
  readOnly?: boolean;
  /** Lifted selected node ID — kept in sync with the tree view */
  selectedId?: string;
  onSelectedIdChange?: (id: string) => void;
  /** Called once the internal focusNode function is ready, so the parent can trigger it */
  onFocusNodeReady?: (fn: (id: string) => void) => void;
}

// SIDC helpers are imported from ../lib/sidc — see re-exports above

// ── Blank node factory ───────────────────────────────────────────────────────
export function blankNode(overrides?: Partial<CompositionNode>): CompositionNode {
  // Resolve final echelon + affiliation first so SIDC can reflect them correctly
  const echelon     = overrides?.echelon     ?? "Battalion";
  const affiliation  = overrides?.affiliation  ?? "Friend";
  const computedSidc = overrides?.sidc ?? makeSidc("infantry", echelon, affiliation);
  const node: CompositionNode = {
    id: uuidv4(),
    unitIdentifier: "",
    echelon,
    sidc: computedSidc,
    entityType: "organisation",
    militaryService: "Army",
    affiliation,
    allegiance: "GBR",
    owningSimulator: "vbs4",
    canonicalAssetKey: null,
    simulatorIdentifierCode: null,
    unitTypeKey: null,
    equipmentTypeKey: null,
    quantity: 1,
    children: [],
    ...overrides,
  };
  // Ensure sidc always reflects echelon/affiliation unless caller supplied one
  if (!overrides?.sidc) node.sidc = computedSidc;
  return node;
}

// ── Immutable tree helpers ───────────────────────────────────────────────────
function updateNodeInTree(node: CompositionNode, id: string, fn: (n: CompositionNode) => CompositionNode): CompositionNode {
  if (node.id === id) return fn(node);
  return { ...node, children: node.children.map((c) => updateNodeInTree(c, id, fn)) };
}
// Exported so App.tsx addChildToNode calls work with the same helpers
export function addChildToNode(node: CompositionNode, parentId: string, child: CompositionNode): CompositionNode {
  if (node.id === parentId) return { ...node, children: [...node.children, child] };
  return { ...node, children: node.children.map((c) => addChildToNode(c, parentId, child)) };
}
function removeNodeFromTree(node: CompositionNode, id: string): CompositionNode | null {
  if (node.id === id) return null;
  return { ...node, children: node.children.map((c) => removeNodeFromTree(c, id)).filter((c): c is CompositionNode => c !== null) };
}
export function findNode(node: CompositionNode, id: string): CompositionNode | null {
  if (node.id === id) return node;
  for (const c of node.children) { const f = findNode(c, id); if (f) return f; }
  return null;
}
function countNodes(node: CompositionNode): number {
  return node.quantity + node.children.reduce((s, c) => s + countNodes(c), 0);
}

// (duplicate SIDC constants removed — makeSidc and maps are defined above)

// ── GroupTemplateNode → CompositionNode ───────────────────────────────────────
// Exported so App.tsx can use them to implement Insert actions from the sidebar
export function groupTplNodeToComposition(tn: GroupTemplateNode, affiliation: string): CompositionNode {
  return {
    id: uuidv4(),
    unitIdentifier: tn.name,
    echelon: tn.echelon,
    sidc: makeSidc(tn.icon, tn.echelon, affiliation),
    entityType: "organisation",
    militaryService: "Army",
    affiliation,
    allegiance: "GBR",
    owningSimulator: "vbs4",
    canonicalAssetKey: null,
    simulatorIdentifierCode: null,
    unitTypeKey: null,
    equipmentTypeKey: null,
    quantity: 1,
    children: tn.children.map((c) => groupTplNodeToComposition(c, affiliation)),
  };
}

// ── UnitTemplate → CompositionNode (single leaf, no children) ────────────────
// Exported so App.tsx can use them to implement Insert actions from the sidebar
export function unitTplToComposition(t: UnitTemplate, affiliation: string): CompositionNode {
  return {
    id: uuidv4(),
    unitIdentifier: t.name,
    echelon: t.echelon,
    sidc: makeSidc((t.symbol.icon as string) ?? "infantry", t.echelon, affiliation),
    entityType: "organisation",
    militaryService: "Army",
    affiliation,
    allegiance: "GBR",
    owningSimulator: "vbs4",
    canonicalAssetKey: null,
    simulatorIdentifierCode: null,
    unitTypeKey: null,
    equipmentTypeKey: null,
    quantity: 1,
    children: [],
  };
}

// ── Tree → React Flow layout ─────────────────────────────────────────────────
const NODE_W         = 160;
const NODE_H         = 64;
const H_GAP          = 16;  // gap between org siblings (same parent)
const H_GAP_ASSET    = 48;  // gap between asset groups from different parent orgs

// Non-org entity types that sit inside an echelon band
const ASSET_TYPES = new Set(["vehicle", "human", "aircraft"]);

// ── Echelon depth rank (org hierarchy depth, 0 = root level) ─────────────────
const ECHELON_DEPTH: Record<string, number> = {
  "army group": 0, "field army": 1, "corps": 2, "division": 3,
  "brigade": 4,  "wing": 4,
  "regiment": 5, "group": 5,
  "battalion": 6, "squadron": 6,
  "company": 7,  "battery": 7, "troop": 7,
  "platoon": 8,  "flight": 8,
  "squad": 9,    "section": 9,
  "fireteam": 10,"team": 10,   "element": 10,
  "crew": 11,    "gun": 11,
};

function nodeDepth(node: CompositionNode, parentDepth: number): number {
  if (ASSET_TYPES.has(node.entityType)) return parentDepth; // assets share parent depth slot
  const norm = (node.echelon ?? "").toLowerCase().trim();
  if (norm && ECHELON_DEPTH[norm] !== undefined) return ECHELON_DEPTH[norm];
  return parentDepth + 1;
}

// ── Pass 1: collect the maximum asset chain depth at each org echelon depth ──
// An "asset chain depth" is how many levels of non-org nodes hang off an org node.
// e.g. company → vehicle → human  =  chain depth 2
// This tells us how much extra vertical space each echelon row needs.

function collectAssetChainDepths(
  node: CompositionNode,
  orgDepth: number,
  maxAssetDepthPerOrgLevel: Map<number, number>,
): void {
  // Count max asset chain depth for children of this org node
  function assetChainDepth(n: CompositionNode): number {
    if (!ASSET_TYPES.has(n.entityType)) return 0;
    if (!n.children.length) return 1;
    return 1 + Math.max(...n.children.map(assetChainDepth));
  }

  const assetChildren = node.children.filter((c) => ASSET_TYPES.has(c.entityType));
  if (assetChildren.length > 0) {
    const maxChain = Math.max(...assetChildren.map(assetChainDepth));
    const existing = maxAssetDepthPerOrgLevel.get(orgDepth) ?? 0;
    maxAssetDepthPerOrgLevel.set(orgDepth, Math.max(existing, maxChain));
  }

  const orgChildren = node.children.filter((c) => !ASSET_TYPES.has(c.entityType));
  for (const child of orgChildren) {
    const childDepth = nodeDepth(child, orgDepth);
    collectAssetChainDepths(child, childDepth, maxAssetDepthPerOrgLevel);
  }
}

// ── Pass 2: compute cumulative Y for each org depth level ────────────────────
// Each org level gets:  NODE_H + V_GAP_ORG + (assetChainDepth * ASSET_ROW_H)
// where ASSET_ROW_H accounts for one asset node + gap.

const V_GAP_ORG   = 40;  // gap between an org node bottom and next org row top
const ASSET_ROW_H = NODE_H + 20; // height of one asset level (node + gap)

function buildOrgYTable(
  root: CompositionNode,
): Map<number, number> {
  // 1. find the full range of org depths in the tree
  function collectDepths(n: CompositionNode, d: number, depths: Set<number>) {
    if (!ASSET_TYPES.has(n.entityType)) depths.add(d);
    for (const c of n.children) collectDepths(c, nodeDepth(c, d), depths);
  }
  const depths = new Set<number>();
  const rootDepth = nodeDepth(root, 0);
  collectDepths(root, rootDepth, depths);

  // 2. collect max asset chain depth per org level
  const maxAssetDepth = new Map<number, number>();
  collectAssetChainDepths(root, rootDepth, maxAssetDepth);

  // 3. sort org depths and compute cumulative Y
  const sorted = [...depths].sort((a, b) => a - b);
  const yTable = new Map<number, number>(); // orgDepth → Y pixel
  let curY = 0;
  for (const d of sorted) {
    yTable.set(d, curY);
    const assetLevels = maxAssetDepth.get(d) ?? 0;
    const rowHeight = NODE_H + V_GAP_ORG + assetLevels * ASSET_ROW_H;
    curY += rowHeight;
  }
  return yTable;
}

// ── Pass 3: assign Y to every node ───────────────────────────────────────────
function assignYPositions(
  node: CompositionNode,
  orgDepth: number,
  yTable: Map<number, number>,
  yMap: Map<string, number>,
): void {
  const isAsset = ASSET_TYPES.has(node.entityType);
  // Assets are positioned below their parent org row
  const orgY = yTable.get(orgDepth) ?? 0;
  yMap.set(node.id, orgY);

  if (!node.children.length) return;

  // Separate children
  const assetChildren = node.children.filter((c) => ASSET_TYPES.has(c.entityType));
  const orgChildren   = node.children.filter((c) => !ASSET_TYPES.has(c.entityType));

  // Asset children: stack them below the current node with ASSET_ROW_H spacing
  function placeAssets(assets: CompositionNode[], startY: number) {
    const y = startY + NODE_H + 20;
    for (const a of assets) {
      yMap.set(a.id, y);
      // Asset's own asset children (e.g. human inside vehicle)
      const assetKids = a.children.filter((c) => ASSET_TYPES.has(c.entityType));
      const orgKids   = a.children.filter((c) => !ASSET_TYPES.has(c.entityType));
      if (assetKids.length) placeAssets(assetKids, y);
      // org children of an asset node get placed at their proper org level
      for (const ok of orgKids) {
        const d = nodeDepth(ok, orgDepth);
        assignYPositions(ok, d, yTable, yMap);
      }
    }
  }

  if (assetChildren.length) placeAssets(assetChildren, isAsset ? orgY : orgY);

  // Org children: look up their fixed Y from the table
  for (const child of orgChildren) {
    const childDepth = nodeDepth(child, orgDepth);
    assignYPositions(child, childDepth, yTable, yMap);
  }
}

// ── Step: compute subtree widths ─────────────────────────────────────────────
//
// TWO separate width functions, one for each context:
//
//  assetGroupWidth(node)  — width consumed by ONE asset node and all its
//                           own asset descendants (e.g. one vehicle + its humans).
//                           Children are separated by H_GAP (same vehicle group).
//
//  subtreeWidth(node)     — total width of an org node's full subtree.
//                           = max( assetRowTotal, orgChildrenTotal )
//                           Asset siblings at the org level are separated by
//                           H_GAP_SEP (different vehicle groups).
//                           Org siblings are separated by H_GAP + H_GAP_SEP.
//
// The placement code MUST use the exact same gaps as the width code, so they
// always agree and there can be no overlaps.

/** Width of one asset node plus its own asset descendants (H_GAP between them) */
function assetGroupWidth(node: CompositionNode): number {
  const assetKids = node.children.filter((c) => ASSET_TYPES.has(c.entityType));
  if (!assetKids.length) return NODE_W;
  const childTotal = assetKids.reduce((s, c) => s + assetGroupWidth(c), 0)
    + H_GAP * (assetKids.length - 1);
  return Math.max(NODE_W, childTotal);
}

/** Total width of all asset children of an org node, using H_GAP_ASSET between groups */
function assetRowTotalWidth(assetChildren: CompositionNode[]): number {
  if (!assetChildren.length) return 0;
  const widths = assetChildren.map(assetGroupWidth);
  return widths.reduce((s, w) => s + w, 0) + H_GAP_ASSET * (assetChildren.length - 1);
}

/** Full recursive subtree width for an org node */
function subtreeWidth(node: CompositionNode): number {
  const assetChildren = node.children.filter((c) => ASSET_TYPES.has(c.entityType));
  const orgChildren   = node.children.filter((c) => !ASSET_TYPES.has(c.entityType));

  const assetW = assetRowTotalWidth(assetChildren);

  // org siblings use H_GAP only
  const orgW = orgChildren.length > 0
    ? orgChildren.reduce((s, c) => s + subtreeWidth(c), 0) + H_GAP * (orgChildren.length - 1)
    : 0;

  return Math.max(NODE_W, assetW, orgW);
}

// ── Step: assign X positions ──────────────────────────────────────────────────
//
// Two mutually-recursive functions:
//   placeOrgNode  — places an org node + all its children (org and asset)
//   placeAssetNode — places one asset node + its asset children (H_GAP between them)
//
// Both receive `slotLeft` (the left edge of the allocated horizontal slot)
// and `slotWidth` (the width of that slot). The node is centred within the slot.

function placeAssetNode(
  node: CompositionNode,
  slotLeft: number,
  slotWidth: number,
  yMap: Map<string, number>,
  selectedId: string,
  onSelect: (id: string) => void,
  edges: Edge[],
  nodes: Node[],
): void {
  const y = yMap.get(node.id) ?? 0;
  const nodeX = slotLeft + slotWidth / 2 - NODE_W / 2;

  nodes.push({
    id: node.id,
    type: "unitNode",
    position: { x: nodeX, y },
    data: { node, selected: node.id === selectedId, onSelect },
    style: { width: NODE_W, height: NODE_H },
  });

  const assetKids = node.children.filter((c) => ASSET_TYPES.has(c.entityType));
  if (assetKids.length) {
    const widths = assetKids.map(assetGroupWidth);
    const total  = widths.reduce((s, w) => s + w, 0) + H_GAP * (assetKids.length - 1);
    let ax = nodeX + NODE_W / 2 - total / 2;
    for (let i = 0; i < assetKids.length; i++) {
      const child = assetKids[i];
      const w     = widths[i];
      edges.push({ id: `e-${node.id}-${child.id}`, source: node.id, target: child.id, style: { stroke: "#2a4a6a", strokeWidth: 2 } });
      placeAssetNode(child, ax, w, yMap, selectedId, onSelect, edges, nodes);
      ax += w + H_GAP;
    }
  }

  // org children of an asset (unusual but handled)
  const orgKids = node.children.filter((c) => !ASSET_TYPES.has(c.entityType));
  for (const child of orgKids) {
    const cs = subtreeWidth(child);
    const cx = nodeX + NODE_W / 2 - cs / 2;
    edges.push({ id: `e-${node.id}-${child.id}`, source: node.id, target: child.id, style: { stroke: "#2a4a6a", strokeWidth: 2 } });
    placeOrgNode(child, cx, cs, yMap, selectedId, onSelect, edges, nodes);
  }
}

function placeOrgNode(
  node: CompositionNode,
  slotLeft: number,
  slotWidth: number,
  yMap: Map<string, number>,
  selectedId: string,
  onSelect: (id: string) => void,
  edges: Edge[],
  nodes: Node[],
): void {
  const y     = yMap.get(node.id) ?? 0;
  const nodeX = slotLeft + slotWidth / 2 - NODE_W / 2;

  nodes.push({
    id: node.id,
    type: "unitNode",
    position: { x: nodeX, y },
    data: { node, selected: node.id === selectedId, onSelect },
    style: { width: NODE_W, height: NODE_H },
  });

  const assetChildren = node.children.filter((c) => ASSET_TYPES.has(c.entityType));
  const orgChildren   = node.children.filter((c) => !ASSET_TYPES.has(c.entityType));

  // ── Asset children — spread with H_GAP_ASSET between groups, centred under nodeX
  if (assetChildren.length) {
    const assetWidths = assetChildren.map(assetGroupWidth);
    const assetTotal  = assetWidths.reduce((s, w) => s + w, 0) + H_GAP_ASSET * (assetChildren.length - 1);
    let ax = nodeX + NODE_W / 2 - assetTotal / 2;
    for (let i = 0; i < assetChildren.length; i++) {
      const child = assetChildren[i];
      const w     = assetWidths[i];
      edges.push({ id: `e-${node.id}-${child.id}`, source: node.id, target: child.id, style: { stroke: "#2a4a6a", strokeWidth: 2 } });
      placeAssetNode(child, ax, w, yMap, selectedId, onSelect, edges, nodes);
      ax += w + H_GAP_ASSET;
    }
  }

  // ── Org children — spread with H_GAP between siblings
  if (orgChildren.length) {
    const orgGap   = H_GAP;
    const orgTotal = orgChildren.reduce((s, c) => s + subtreeWidth(c), 0) + orgGap * (orgChildren.length - 1);
    let cx = slotLeft + slotWidth / 2 - orgTotal / 2;
    for (const child of orgChildren) {
      const cs = subtreeWidth(child);
      edges.push({ id: `e-${node.id}-${child.id}`, source: node.id, target: child.id, style: { stroke: "#2a4a6a", strokeWidth: 2 } });
      placeOrgNode(child, cx, cs, yMap, selectedId, onSelect, edges, nodes);
      cx += cs + orgGap;
    }
  }
}

function buildFlowNodes(
  root: CompositionNode,
  yMap: Map<string, number>,
  selectedId: string,
  onSelect: (id: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const rootSlot = subtreeWidth(root);
  placeOrgNode(root, 0, rootSlot, yMap, selectedId, onSelect, edges, nodes);
  return { nodes, edges };
}

// ── Entry point ───────────────────────────────────────────────────────────────
function buildLayout(
  root: CompositionNode,
  selectedId: string,
  onSelect: (id: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const rootDepth = nodeDepth(root, 0);
  // Pass 1+2: build the global Y table for org levels
  const yTable = buildOrgYTable(root);
  // Pass 3: assign Y to every node
  const yMap = new Map<string, number>();
  assignYPositions(root, rootDepth, yTable, yMap);
  // Pass 4: assign X and build react-flow nodes/edges
  return buildFlowNodes(root, yMap, selectedId, onSelect);
}

// ── Custom node ──────────────────────────────────────────────────────────────
const ENTITY_COLOURS: Record<string, string> = {
  organisation: "#3B5BA5", vehicle: "#2E7D32", aircraft: "#E65100", human: "#CE93D8",
};

function UnitFlowNode({ data }: NodeProps) {
  const { node, selected, onSelect } = data as {
    node: CompositionNode;
    selected: boolean;
    onSelect: (id: string) => void;
  };

  const iconUri = useMemo(() => {
    try {
      const svg = new ms.Symbol(node.sidc, { size: 26, square: true, strokeWidth: 1.5 }).asSVG();
      if (svg && svg.length > 50) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch { /* fall through */ }
    return "";
  }, [node.sidc]);

  const colour = ENTITY_COLOURS[node.entityType] ?? "#37474f";

  // An unspawnable unit is marked on the node itself: the planner has to be
  // able to see the problem on the tree, not only after opening the editor.
  const issue = React.useContext(AssetIssueContext).get(node.id);
  const issueColour = issue?.severity === "ERROR" ? "#ef5350" : "#ffb74d";
  const assetLabel = React.useContext(AssetLabelContext).get(node.id);

  return (
    <div
      onClick={() => onSelect(node.id)}
      title={issue?.message}
      style={{
        width: NODE_W, height: NODE_H,
        background: selected ? "#1a3a5c" : "#0f2030",
        border: `2px solid ${selected ? "#4fc3f7" : issue ? issueColour : colour}`,
        borderRadius: 6, display: "flex", alignItems: "center", gap: 6,
        padding: "0 10px", cursor: "pointer", boxSizing: "border-box", userSelect: "none",
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#2a4a6a", border: "none", width: 8, height: 8 }} />
      {iconUri && <img src={iconUri} width={28} height={28} alt={node.sidc} style={{ flexShrink: 0, pointerEvents: "none" }} />}
      <div style={{ flex: 1, minWidth: 0, pointerEvents: "none" }}>
        <div style={{ fontSize: 11, color: "#e0e0e0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: selected ? 600 : 400 }}>
          {node.unitIdentifier || "(unnamed)"}
        </div>
        <div style={{ fontSize: 10, color: colour, marginTop: 2 }}>
          {node.echelon ? `${node.echelon} · ` : ""}{node.entityType}
          {node.quantity > 1 && <span style={{ color: "#90a4ae" }}> ×{node.quantity}</span>}
          </div>
        {/* The assigned asset, on the node itself. Organisations are structural
            and usually carry none, so the line is only rendered when there is
            something to say. */}
        {assetLabel && (
          <div
            title={assetLabel}
            style={{
              fontSize: 9, color: "#78909c", marginTop: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {assetLabel}
          </div>
        )}
      </div>
      {issue && (
        <span
          style={{
            position: "absolute", top: -7, right: -7, width: 16, height: 16, borderRadius: "50%",
            background: issueColour, color: "#0a1520", fontSize: 11, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
          }}
        >
          !
        </span>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: "#2a4a6a", border: "none", width: 8, height: 8 }} />
    </div>
  );
}

const nodeTypes = { unitNode: UnitFlowNode };

/**
 * Asset problems for the tree currently on the canvas, keyed by node id.
 *
 * Passed by context rather than through the layout functions: the layout pass
 * is four mutually-recursive functions deep and threading a map through all of
 * them for a badge is not worth the churn.
 */
const AssetIssueContext = React.createContext<Map<string, ValidationIssue>>(new Map());

/**
 * Canonical asset name per node id, for display on the node itself.
 *
 * The asset used to be visible only in the editor panel, and only once a node
 * was selected — so a planner looking at a 40-node ORBAT had no way to see
 * what was assigned without clicking every node in turn.
 */
const AssetLabelContext = React.createContext<Map<string, string>>(new Map());

// ── Inner canvas (must live inside ReactFlowProvider) ────────────────────────
// Receives fresh nodes/edges each render so callbacks are never stale.
function FlowCanvas({
  flowNodes,
  flowEdges,
  onFitView,
  onFocusNode,
}: {
  flowNodes: Node[];
  flowEdges: Edge[];
  onFitView: (fn: () => void) => void;
  onFocusNode: (fn: (id: string) => void) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);
  const { fitView } = useReactFlow();

  // Push a fitView handle up so the parent can trigger it after adding nodes
  useEffect(() => { onFitView(() => fitView({ padding: 0.15, duration: 300, minZoom: 0.05 })); }, [fitView, onFitView]);

  // Register the focusNode function with the parent on mount.
  // This fires every time FlowCanvas mounts (i.e. when graph tab becomes active).
  useEffect(() => {
    const fn = (id: string) => {
      fitView({ nodes: [{ id }], duration: 400, padding: 0.5, minZoom: 0.5, maxZoom: 1.5 });
    };
    onFocusNode(fn);
    // Intentionally NOT including fitView/onFocusNode in deps so this only
    // fires once on mount — that's exactly when we need to drain the pending request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync nodes/edges whenever the source-of-truth tree changes
  useEffect(() => { setNodes(flowNodes); }, [flowNodes, setNodes]);
  useEffect(() => { setEdges(flowEdges); }, [flowEdges, setEdges]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15, minZoom: 0.05 }}
      minZoom={0.05}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={true}
      selectNodesOnDrag={false}
      onNodeClick={(_e, rfNode) => {
        // Bridge React Flow's node click into our own selection handler
        const cb = (rfNode.data as { onSelect?: (id: string) => void }).onSelect;
        cb?.(rfNode.id);
      }}
      style={{ background: "#0a1520", width: "100%", height: "100%" }}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#1a2b3c" gap={24} />
      <Controls style={{ background: "#0f2030", border: "1px solid #1e3a4a" }} />
    </ReactFlow>
  );
}

// ── Echelon hierarchy rules ───────────────────────────────────────────────────
//
// Each entry is [ echelonName, validChildEchelons[] ].
// "null" / empty string echelon = no echelon set (wildcard — can go anywhere).
// A parent with no echelon set can receive any child.
// A child echelon must appear in the parent's allowed-children list.
//
// Structure (from the spec):
//   Combined Arms chain:
//     Army Group → Field Army → Corps → Division → Brigade →
//     Infantry Regiment → Battalion → Company → Platoon → Squad → Fireteam/Team/Crew
//
//   Artillery:
//     Regiment → Battalion → Battery → Platoon → Section → Gun/Crew
//
//   Cavalry/Armor:
//     Regiment → Squadron → Troop → Platoon → Section → Crew
//
//   Aviation:
//     Wing → Group → Squadron → Flight → Element/Section → Crew
//
// We normalise everything to lowercase for matching.

interface EchelonRule {
  /** Echelons that are valid CHILDREN of this echelon (lowercase) */
  validChildren: string[];
  /** Display label */
  label: string;
}

const ECHELON_RULES: Record<string, EchelonRule> = {
  // ── Combined arms chain ───────────────────────────────────────────────────
  "army group":   { label: "Army Group",   validChildren: ["field army", "corps"] },
  "field army":   { label: "Field Army",   validChildren: ["corps"] },
  "corps":        { label: "Corps",        validChildren: ["division"] },
  "division":     { label: "Division",     validChildren: ["brigade", "regiment", "squadron", "wing"] },
  "brigade":      { label: "Brigade",      validChildren: ["regiment", "battalion", "squadron", "group", "wing"] },
  "regiment":     { label: "Regiment",     validChildren: ["battalion", "squadron", "battery", "troop", "group"] },
  "battalion":    { label: "Battalion",    validChildren: ["company", "battery", "squadron", "flight", "troop"] },
  "company":      { label: "Company",      validChildren: ["platoon", "flight"] },
  "platoon":      { label: "Platoon",      validChildren: ["squad", "section", "element", "crew"] },
  "squad":        { label: "Squad",        validChildren: ["fireteam", "team", "crew", "section"] },
  "fireteam":     { label: "Fireteam",     validChildren: ["crew"] },
  "team":         { label: "Team",         validChildren: ["crew"] },
  // ── Artillery-specific ───────────────────────────────────────────────────
  "battery":      { label: "Battery",      validChildren: ["platoon", "section"] },
  "section":      { label: "Section",      validChildren: ["gun", "crew", "fireteam", "team"] },
  "gun":          { label: "Gun/Crew",     validChildren: [] },
  // ── Cavalry/Armor ─────────────────────────────────────────────────────────
  "squadron":     { label: "Squadron",     validChildren: ["troop", "flight", "platoon"] },
  "troop":        { label: "Troop",        validChildren: ["platoon", "section"] },
  // ── Aviation ─────────────────────────────────────────────────────────────
  "wing":         { label: "Wing",         validChildren: ["group", "squadron"] },
  "group":        { label: "Group",        validChildren: ["squadron"] },
  "flight":       { label: "Flight",       validChildren: ["element", "section", "crew"] },
  "element":      { label: "Element",      validChildren: ["crew"] },
  // ── Leaf ─────────────────────────────────────────────────────────────────
  "crew":         { label: "Crew",         validChildren: [] },
  "":             { label: "— None —",     validChildren: [] }, // filled below
};

// All known echelon names (for the wildcard / no-echelon case)
const ALL_ECHELONS = Object.keys(ECHELON_RULES).filter((k) => k !== "");

// Fill the wildcard after the object is fully constructed
ECHELON_RULES[""].validChildren = ALL_ECHELONS;

/** Given a parent echelon, return the list of echelon labels valid for a child */
function validChildEchelons(parentEchelon: string): string[] {
  const norm = (parentEchelon ?? "").toLowerCase().trim();
  const rule = ECHELON_RULES[norm];
  if (!rule || rule.validChildren.length === 0) return [];
  return rule.validChildren.map((k) => ECHELON_RULES[k]?.label ?? k);
}

/** Check whether childEchelon is a valid child of parentEchelon */
function isValidChild(parentEchelon: string, childEchelon: string): boolean {
  const pNorm = (parentEchelon ?? "").toLowerCase().trim();
  const cNorm = (childEchelon ?? "").toLowerCase().trim();
  if (!pNorm) return true; // parent has no echelon — anything allowed
  if (!cNorm) return true; // child has no echelon — always allowed
  const rule = ECHELON_RULES[pNorm];
  if (!rule) return true;  // unknown parent echelon — don't block
  return rule.validChildren.includes(cNorm);
}

// ── Add Child Dialog ─────────────────────────────────────────────────────────
const AFFILIATIONS_LIST = ["Friend", "Hostile", "Neutral", "Unknown", "Assumed Friend", "Suspect"];
const ENTITY_TYPES_LIST = ["organisation", "vehicle", "human", "aircraft"];

function AddChildDialog({
  parentNode,
  templates,
  refData,
  onConfirm,
  onClose,
}: {
  parentNode: CompositionNode;
  templates: HierarchyTemplate[];
  refData: CompositionRefData;
  onConfirm: (child: CompositionNode) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"new" | "template">("new");
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState(parentNode.affiliation ?? "Friend");
  const [entityType, setEntityType] = useState<CompositionNode["entityType"]>("organisation");
  const [militaryService, setMilitaryService] = useState(parentNode.militaryService ?? "Army");
  const [allegiance, setAllegiance] = useState(parentNode.allegiance ?? "GBR");
  const [selectedTplId, setSelectedTplId] = useState(templates[0]?.id ?? "");
  const [search, setSearch] = useState("");

  // Compute valid child echelons for the parent
  const allowedEchelons = useMemo(() => validChildEchelons(parentNode.echelon), [parentNode.echelon]);
  const [echelon, setEchelon] = useState(allowedEchelons[0] ?? "");

  // ── Asset selection ───────────────────────────────────────────────────────
  //
  // A unit that no simulator can spawn is not a unit, so for entity types that
  // have to exist in a simulator the asset is picked HERE, at the point of
  // adding, rather than being left null and discovered at export time. The
  // list only ever contains assets the target simulator actually carries.
  const [canonicalAssetKey, setCanonicalAssetKey] = useState<string | null>(null);
  const [simulatorIdentifierCode, setSimulatorIdentifierCode] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [simAssets, setSimAssets] = useState<OSimAsset[]>([]);
  const [simLoading, setSimLoading] = useState(false);

  // ── Property-led selection ────────────────────────────────────────────────
  //
  // What the unit IS decides which catalogues can model it, and the simulator
  // is derived from the model chosen — the planner never picks a simulator.
  // Organisations resolve against SWORD automats, everything else against VBS4
  // and SIMWORKS, and the cascading filters below narrow by the catalogue's own
  // properties (category, then subcategory, then nationality).
  const targets = useMemo(() => candidateSimulators(entityType), [entityType]);
  const targetLabel = useMemo(() => targets.map((t) => SIM_TARGET_LABELS[t]).join(" or "), [targets]);
  const assetRequired = assetRequiredForEntityType(entityType);

  const [filterCategory, setFilterCategory] = useState("");
  const [filterSubcategory, setFilterSubcategory] = useState("");
  const [filterNationality, setFilterNationality] = useState("");

  /** Everything the candidate simulators can spawn for this entity type. */
  const assetsForType = useMemo(
    () => selectableAssetsForEntityType(refData.canonicalAssets.values(), entityType),
    [refData.canonicalAssets, entityType],
  );

  // Each filter's options come from what is still on offer after the filters
  // before it, so no option can ever empty the list.
  const categoryOptions = useMemo(() => facetValues(assetsForType, "assetCategory"), [assetsForType]);

  const afterCategory = useMemo(
    () => (filterCategory ? assetsForType.filter((a) => a.assetCategory === filterCategory) : assetsForType),
    [assetsForType, filterCategory],
  );
  const subcategoryOptions = useMemo(() => facetValues(afterCategory, "subcategory"), [afterCategory]);

  const afterSubcategory = useMemo(
    () => (filterSubcategory ? afterCategory.filter((a) => a.subcategory === filterSubcategory) : afterCategory),
    [afterCategory, filterSubcategory],
  );
  const nationalityOptions = useMemo(() => facetValues(afterSubcategory, "nationality"), [afterSubcategory]);

  const selectableAssets = useMemo(
    () => (filterNationality ? afterSubcategory.filter((a) => a.nationality === filterNationality) : afterSubcategory),
    [afterSubcategory, filterNationality],
  );

  const visibleAssets = useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    const list = q
      ? selectableAssets.filter(
          (a) =>
            a.canonicalName.toLowerCase().includes(q) ||
            a.nationality?.toLowerCase().includes(q) ||
            a.assetCategory?.toLowerCase().includes(q),
        )
      : selectableAssets;
    // The catalogue has 1,600 rows; rendering them all into a <select> makes
    // the dialog crawl, and nobody scrolls past the first screen anyway.
    return list.slice(0, 250);
  }, [selectableAssets, assetSearch]);

  /**
   * The simulator that will own this unit, taken from the model chosen.
   *
   * Not a question the planner is asked: they pick what the unit is and which
   * model represents it, and that determines the federation. Null until a model
   * is chosen, which for a structural organisation is for ever — hence "none".
   */
  const [derivedSimulator, setDerivedSimulator] = useState<SimTarget | null>(null);

  // Changing what the unit is changes which catalogue applies, so the asset,
  // the model, the derived simulator and the property filters all reset.
  useEffect(() => {
    setCanonicalAssetKey(null);
    setSimulatorIdentifierCode(null);
    setDerivedSimulator(null);
    setFilterCategory("");
    setFilterSubcategory("");
    setFilterNationality("");
  }, [entityType]);

  useEffect(() => {
    if (!canonicalAssetKey || !targets.length) { setSimAssets([]); return; }
    let cancelled = false;
    setSimLoading(true);
    loadSimAssetsForTargets(canonicalAssetKey, targets)
      .then((assets) => {
        if (cancelled) return;
        const sorted = assets.sort((a, b) => a.identifier.localeCompare(b.identifier));
        setSimAssets(sorted);
        // One model available? Choosing it for the user removes a pointless
        // click — most canonical assets map to exactly one catalogue row.
        if (sorted.length === 1) {
          setSimulatorIdentifierCode(sorted[0].identifier);
          setDerivedSimulator(simulatorForModel(sorted[0]));
        }
      })
      .catch(() => { if (!cancelled) setSimAssets([]); })
      .finally(() => { if (!cancelled) setSimLoading(false); });
    return () => { cancelled = true; };
  }, [canonicalAssetKey, targets]);

  const selectedAsset = canonicalAssetKey ? refData.canonicalAssets.get(canonicalAssetKey) : null;
  const assetReady = !assetRequired || Boolean(canonicalAssetKey && simulatorIdentifierCode);

  // Filter templates to only those whose root echelon is valid for the parent
  const filteredTemplates = (search.trim()
    ? templates.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : templates
  ).filter((t) => isValidChild(parentNode.echelon, t.root.echelon));

  // Re-ID the whole template tree with fresh UUIDs and override affiliation
  function reIdTree(n: CompositionNode, aff: string): CompositionNode {
    return { ...n, id: uuidv4(), affiliation: aff, children: n.children.map((c) => reIdTree(c, aff)) };
  }

  const handleConfirm = () => {
    if (mode === "template") {
      const tpl = templates.find((t) => t.id === selectedTplId);
      if (!tpl) return;
      onConfirm(reIdTree(tpl.root, affiliation));
    } else {
      if (!name.trim() || !assetReady) return;
      onConfirm(blankNode({
        unitIdentifier: name.trim(),
        echelon,
        affiliation,
        entityType,
        militaryService,
        allegiance,
        // Derived from the chosen model, so it can never contradict the asset.
        // "none" for a structural organisation with no automat — which the XML
        // never asks about, since owningSimulator is a UnitType attribute only.
        owningSimulator: derivedSimulator ?? "none",
        canonicalAssetKey,
        simulatorIdentifierCode,
        // SIDC is computed by blankNode from echelon+affiliation
      }));
    }
  };

  const MILITARY_SERVICES_LIST = ["Army", "Navy", "Air Force", "Marines", "Coast Guard", "Special Operations Force", "Joint"];

  const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" };
  const box: React.CSSProperties = { background: "#0f2030", border: "1px solid #1e3a4a", borderRadius: 8, width: 460, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" };
  const inp: React.CSSProperties = { padding: "5px 8px", background: "#1a2b3c", border: "1px solid #2a4a5a", borderRadius: 4, color: "#e0e0e0", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" };
  const label10: React.CSSProperties = { fontSize: 10, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 3 };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={box}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #1e3a4a", flexShrink: 0 }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#e0e0e0" }}>
            Add child to <em style={{ color: "#4fc3f7" }}>{parentNode.unitIdentifier || "(unnamed)"}</em>
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#607d8b", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1e3a4a", flexShrink: 0 }}>
          {([["new", "New unit"], ["template", `From template (${templates.length})`]] as const).map(([id, lbl]) => (
            <button key={id} onClick={() => setMode(id)}
              style={{ flex: 1, padding: "8px 4px", background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, color: mode === id ? "#4fc3f7" : "#607d8b", borderBottom: mode === id ? "2px solid #4fc3f7" : "2px solid transparent" }}>
              {lbl}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {mode === "new" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Name */}
              <div>
                <label style={label10}>Unit Name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 1 Platoon" style={inp} autoFocus />
              </div>

              {/* Echelon + Entity Type */}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label10}>
                    Echelon
                    {parentNode.echelon && <span style={{ color: "#37474f", marginLeft: 4, fontSize: 9 }}>(valid under {parentNode.echelon})</span>}
                  </label>
                  {allowedEchelons.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#ef9a9a", padding: "4px 0" }}>
                      ⚠ No valid child echelons for a {parentNode.echelon || "root"} unit
                    </div>
                  ) : (
                    <select value={echelon} onChange={(e) => setEchelon(e.target.value)} style={inp}>
                      {allowedEchelons.map((e) => <option key={e} value={e}>{e}</option>)}
                    </select>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label10}>Entity Type</label>
                  <select value={entityType} onChange={(e) => setEntityType(e.target.value as CompositionNode["entityType"])} style={inp}>
                    {ENTITY_TYPES_LIST.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Affiliation + Military Service */}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label10}>Affiliation</label>
                  <select value={affiliation} onChange={(e) => setAffiliation(e.target.value)} style={inp}>
                    {AFFILIATIONS_LIST.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label10}>Military Service</label>
                  <select value={militaryService} onChange={(e) => setMilitaryService(e.target.value)} style={inp}>
                    {MILITARY_SERVICES_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Allegiance. The owning simulator is no longer asked for — it
                  is derived from the model chosen below, so it cannot disagree
                  with the asset. */}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label10}>Allegiance (3-letter)</label>
                  <input value={allegiance} onChange={(e) => setAllegiance(e.target.value.toUpperCase().slice(0, 3))} placeholder="GBR" maxLength={3} style={inp} />
                </div>
              </div>

              {/* ── Asset, chosen by what the unit is ──────────────────────
                  A vehicle must have a model or it is not in the exercise. An
                  organisation may take a SWORD automat but is not required to:
                  in a VBS4 or SIMWORKS ORBAT the formation is the tree, not a
                  spawned entity. */}
              {(assetRequired || assetsForType.length > 0) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4, borderTop: "1px solid #14293c" }}>
                  {/* Cascading property filters. Each one's options come from
                      what survives the filters above it, so no choice here can
                      empty the list below. */}
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <label style={label10}>Category</label>
                      <select value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setFilterSubcategory(""); setFilterNationality(""); }} style={inp}>
                        <option value="">Any</option>
                        {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    {subcategoryOptions.length > 1 && (
                      <div style={{ flex: 1 }}>
                        <label style={label10}>Subcategory</label>
                        <select value={filterSubcategory} onChange={(e) => { setFilterSubcategory(e.target.value); setFilterNationality(""); }} style={inp}>
                          <option value="">Any</option>
                          {subcategoryOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    )}
                    {nationalityOptions.length > 1 && (
                      <div style={{ width: 90 }}>
                        <label style={label10}>Nation</label>
                        <select value={filterNationality} onChange={(e) => setFilterNationality(e.target.value)} style={inp}>
                          <option value="">Any</option>
                          {nationalityOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  <div>
                    <label style={label10}>
                      {entityType === "organisation" ? "SWORD Automat" : "Asset"}{assetRequired ? " *" : " (optional)"}
                      <span style={{ color: "#37474f", marginLeft: 4, fontSize: 9 }}>
                        ({selectableAssets.length} of {assetsForType.length} in {targetLabel})
                      </span>
                    </label>

                    {selectableAssets.length === 0 ? (
                      <div style={{ fontSize: 11, color: "#ef9a9a", padding: "4px 0", lineHeight: 1.45 }}>
                        ⚠ Nothing in the catalogue can be spawned as a {entityType} in {targetLabel}.
                        Change the entity type or the owning simulator.
                      </div>
                    ) : (
                      <>
                        <input
                          value={assetSearch}
                          onChange={(e) => setAssetSearch(e.target.value)}
                          placeholder="Search assets…"
                          style={{ ...inp, marginBottom: 4 }}
                        />
                        <select
                          value={canonicalAssetKey ?? ""}
                          onChange={(e) => {
                            setCanonicalAssetKey(e.target.value || null);
                            setSimulatorIdentifierCode(null);
                            // Name the unit after the asset unless the planner
                            // has already typed something of their own.
                            const asset = refData.canonicalAssets.get(e.target.value);
                            if (asset && !name.trim()) setName(asset.canonicalName);
                          }}
                          style={{ ...inp, height: 90 }}
                          size={5}
                        >
                          <option value="">— Choose an asset —</option>
                          {visibleAssets.map((a) => (
                            <option key={a.primaryKey} value={a.primaryKey}>
                              {a.canonicalName}{a.nationality ? ` · ${a.nationality}` : ""}
                            </option>
                          ))}
                        </select>
                        {visibleAssets.length < selectableAssets.length && (
                          <div style={{ fontSize: 9, color: "#607d8b", marginTop: 2 }}>
                            Showing {visibleAssets.length} of {selectableAssets.length} — refine the search.
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {canonicalAssetKey && (
                    <div>
                      <label style={label10}>
                        {targetLabel} Model *
                        {simLoading && <span style={{ color: "#37474f", marginLeft: 4, fontSize: 9 }}>(loading…)</span>}
                      </label>
                      {simAssets.length > 0 ? (
                        <select
                          value={simulatorIdentifierCode ?? ""}
                          onChange={(e) => {
                            const chosen = simAssets.find((a) => a.identifier === e.target.value);
                            setSimulatorIdentifierCode(chosen?.identifier ?? null);
                            // The model decides the federation — this is the
                            // only place owningSimulator gets set.
                            setDerivedSimulator(chosen ? simulatorForModel(chosen) : null);
                          }}
                          style={inp}
                        >
                          <option value="">— Choose a model —</option>
                          {simAssets.map((a) => (
                            <option key={`${a.simulator}:${a.identifier}`} value={a.identifier}>
                              {SIM_TARGET_LABELS[a.simulator]} · {a.displayName}{a.description ? ` — ${a.description}` : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div style={{ fontSize: 11, color: simLoading ? "#607d8b" : "#ef9a9a", padding: "4px 0" }}>
                          {simLoading
                            ? "Loading…"
                            : `No ${targetLabel} model is linked to ${selectedAsset?.canonicalName ?? "this asset"}.`}
                        </div>
                      )}
                      {derivedSimulator && (
                        <div style={{ fontSize: 9, color: "#607d8b", marginTop: 2 }}>
                          Will be spawned by {SIM_TARGET_LABELS[derivedSimulator]}.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === "template" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates…" style={inp} />
              {filteredTemplates.length === 0 && (
                <div style={{ fontSize: 11, color: "#607d8b" }}>
                  {templates.length === 0
                    ? "No templates available."
                    : `No templates with a valid echelon under ${parentNode.echelon || "this unit"}.`}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {filteredTemplates.map((tpl) => (
                  <div key={tpl.id} onClick={() => setSelectedTplId(tpl.id)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 4, cursor: "pointer", background: selectedTplId === tpl.id ? "#1a3a5c" : "#0f2030", border: `1px solid ${selectedTplId === tpl.id ? "#4fc3f7" : "#1e3a4a"}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#e0e0e0", fontWeight: selectedTplId === tpl.id ? 700 : 400 }}>{tpl.name}</div>
                      <div style={{ fontSize: 10, color: "#607d8b" }}>{tpl.root.echelon} · {1 + tpl.root.children.length} nodes (top level)</div>
                    </div>
                  </div>
                ))}
              </div>
              {templates.length > 0 && (
                <div>
                  <label style={label10}>Affiliation override</label>
                  <select value={affiliation} onChange={(e) => setAffiliation(e.target.value)} style={inp}>
                    {AFFILIATIONS_LIST.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid #1e3a4a", flexShrink: 0, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "6px 16px", background: "#1a2b3c", border: "1px solid #2a4a5a", borderRadius: 4, color: "#90a4ae", fontSize: 12, cursor: "pointer" }}>Cancel</button>
          {/* Blocked rather than warned: an entity unit with no simulator model
              cannot be exported, so there is nothing useful about letting it
              into the tree and finding out later. */}
          {(() => {
            const canAdd = mode === "new"
              ? Boolean(name.trim()) && allowedEchelons.length > 0 && assetReady
              : Boolean(selectedTplId);
            const why = mode !== "new" || canAdd
              ? undefined
              : !name.trim()
                ? "Give the unit a name"
                : allowedEchelons.length === 0
                  ? "No valid child echelon"
                  : !canonicalAssetKey
                    ? `Choose a ${targetLabel} asset`
                    : `Choose a ${targetLabel} model`;
            return (
              <button
                onClick={handleConfirm}
                disabled={!canAdd}
                title={why}
                style={{ padding: "6px 18px", background: canAdd ? "#1565C0" : "#1a2b3c", border: "none", borderRadius: 4, color: canAdd ? "#fff" : "#607d8b", fontSize: 12, cursor: canAdd ? "pointer" : "not-allowed", fontWeight: 600 }}>
                Add unit
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ── Exported node editor sidebar panel ───────────────────────────────────────

export interface NodeEditorSidebarProps {
  root: CompositionNode;
  selectedNode: CompositionNode;
  parentNode: CompositionNode | null;
  onClose: () => void;
  onRemove?: (id: string) => void;
  onUpdate: (id: string, updates: Partial<CompositionNode>) => void;
  onSelectNode: (id: string) => void;
  onAddChild?: (parentId: string) => void;
  onFocusNode?: (id: string) => void;
  readOnly?: boolean;
  refData: import("@/shared/hooks/useCompositionData").CompositionRefData;
  addChildParentId: string | null;
  setAddChildParentId: (id: string | null) => void;
  hierarchyTemplates: HierarchyTemplate[];
  onAddChildConfirm: (parentId: string, child: CompositionNode) => void;
}

export function NodeEditorSidebar({
  root,
  selectedNode,
  parentNode,
  onClose,
  onRemove,
  onUpdate,
  onSelectNode,
  onAddChild,
  onFocusNode,
  readOnly = false,
  refData,
  addChildParentId,
  setAddChildParentId,
  hierarchyTemplates,
  onAddChildConfirm,
}: NodeEditorSidebarProps) {
  return (
    <div style={{
      width: 300,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      borderLeft: "1px solid #1e3a4a",
      background: "#0a1520",
      overflow: "hidden",
    }}>
      {/* Symbol banner */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "14px 12px 10px", background: "#071018", borderBottom: "1px solid #1e3a4a", flexShrink: 0, gap: 6 }}>
        {(() => {
          try {
            const svg = new ms.Symbol(selectedNode.sidc, { size: 56, square: true, strokeWidth: 1.5 }).asSVG();
            if (svg && svg.length > 50) return <img src={`data:image/svg+xml;base64,${btoa(svg)}`} width={56} height={56} alt={selectedNode.sidc} style={{ display: "block" }} />;
          } catch { /* fall through */ }
          return <div style={{ width: 56, height: 56, borderRadius: 4, background: "#1a2b3c" }} />;
        })()}
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0e0", textAlign: "center", wordBreak: "break-word", lineHeight: 1.3 }}>
          {selectedNode.unitIdentifier || "(unnamed)"}
        </div>
        {selectedNode.echelon && (
          <div style={{ fontSize: 10, color: "#607d8b" }}>{selectedNode.echelon} · {selectedNode.entityType}</div>
        )}
      </div>

      {/* Action buttons row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid #1e3a4a", flexShrink: 0 }}>
        {onFocusNode && (
          <button
            onClick={() => onFocusNode(selectedNode.id)}
            title="Focus on this node in the graph"
            style={{ padding: "3px 10px", background: "#0d2137", border: "1px solid #1e3a4a", borderRadius: 3, color: "#4fc3f7", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
            ⊕ Focus on graph
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          title="Close panel"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#607d8b", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
      </div>

      {/* Add child button */}
      {!readOnly && onAddChild && (
        <div style={{ padding: "6px 12px", borderBottom: "1px solid #1e3a4a", flexShrink: 0 }}>
          <button
            onClick={() => { setAddChildParentId(selectedNode.id); onAddChild(selectedNode.id); }}
            style={{ width: "100%", padding: "5px", background: "#1565C0", border: "none", borderRadius: 3, color: "#fff", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
            + Add child unit
          </button>
        </div>
      )}

      {/* Node properties */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <CompositionNodeEditor
          node={selectedNode}
          refData={refData}
          onChange={readOnly ? () => {} : (u) => onUpdate(selectedNode.id, u)}
          parentEchelon={parentNode?.echelon}
          parentNode={parentNode ?? undefined}
          onSelectNode={onSelectNode}
        />
      </div>

      {/* Footer: Remove button */}
      {!readOnly && onRemove && selectedNode.id !== root.id && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid #1e3a4a", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => onRemove(selectedNode.id)}
            title="Remove this node"
            style={{ background: "rgba(176,58,46,0.2)", border: "1px solid rgba(176,58,46,0.4)", borderRadius: 3, color: "#ef9a9a", cursor: "pointer", fontSize: 11, padding: "4px 12px" }}>
            ✕ Remove
          </button>
        </div>
      )}

      {/* Add Child Dialog */}
      {addChildParentId && (() => {
        const pNode = findNode(root, addChildParentId);
        if (!pNode) return null;
        return (
          <AddChildDialog
            parentNode={pNode}
            templates={hierarchyTemplates}
            refData={refData}
            onConfirm={(child) => onAddChildConfirm(addChildParentId, child)}
            onClose={() => setAddChildParentId(null)}
          />
        );
      })()}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function CompositionBuilder({
  root,
  onRootChange,
  hierarchyTemplates = [],
  readOnly = false,
  selectedId: externalSelectedId,
  onSelectedIdChange,
  onFocusNodeReady,
}: Props) {
  const { refData, loading, error } = useCompositionData();

  const [internalSelectedId, setInternalSelectedId] = useState<string>(root.id);
  const selectedId = externalSelectedId ?? internalSelectedId;
  const setSelectedId = useCallback((id: string) => {
    setInternalSelectedId(id);
    onSelectedIdChange?.(id);
  }, [onSelectedIdChange]);

  const [editorOpen, setEditorOpen] = useState(true);
  const [addChildParentId, setAddChildParentId] = useState<string | null>(null);

  // fitView handle — set once FlowCanvas mounts
  const fitViewRef = React.useRef<(() => void) | null>(null);
  const registerFitView = useCallback((fn: () => void) => { fitViewRef.current = fn; }, []);

  // focusNode handle — zooms to a specific node by id
  const focusNodeRef = React.useRef<((id: string) => void) | null>(null);
  const registerFocusNode = useCallback((fn: (id: string) => void) => {
    focusNodeRef.current = fn;
    onFocusNodeReady?.(fn);
  }, [onFocusNodeReady]);

  // Keep selectedId valid if root is replaced
  useEffect(() => {
    if (!findNode(root, selectedId)) setSelectedId(root.id);
  }, [root, selectedId]);

  const selectedNode = useMemo(() => findNode(root, selectedId), [root, selectedId]);

  /** Find the direct parent of a node by id */
  function findParent(node: CompositionNode, targetId: string): CompositionNode | null {
    for (const child of node.children) {
      if (child.id === targetId) return node;
      const found = findParent(child, targetId);
      if (found) return found;
    }
    return null;
  }
  const parentNode = useMemo(() => findParent(root, selectedId), [root, selectedId]);
  const totalEntities = useMemo(() => countNodes(root), [root]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setEditorOpen(true);
  }, []);

  const handleAddChildConfirm = useCallback((parentId: string, child: CompositionNode) => {
    onRootChange(addChildToNode(root, parentId, child));
    setSelectedId(child.id);
    setEditorOpen(true);
    setAddChildParentId(null);
    setTimeout(() => fitViewRef.current?.(), 100);
  }, [root, onRootChange]);

  const handleRemove = useCallback((nodeId: string) => {
    if (readOnly || nodeId === root.id) return;
    onRootChange(removeNodeFromTree(root, nodeId) ?? root);
    setSelectedId(root.id);
    setEditorOpen(false);
  }, [root, onRootChange, readOnly]);

  const handleUpdateNode = useCallback((id: string, updates: Partial<CompositionNode>) => {
    if (readOnly) return;
    onRootChange(updateNodeInTree(root, id, (n) => ({ ...n, ...updates })));
  }, [root, onRootChange, readOnly]);

  // Build flow nodes — no action buttons on nodes themselves
  const { nodes: flowNodes, edges: flowEdges } = useMemo(
    () => buildLayout(root, selectedId, handleSelect),
    [root, selectedId, handleSelect],
  );

  // Which units in the current tree cannot be spawned. Existing ORBATs (and
  // anything arriving from a template or the AI generator) predate the gate on
  // adding, so they are flagged in place rather than blocked — the hard stop
  // is at the point of writing, in createCompositionInOntology.
  const assetIssues = useMemo(
    () => validateComposition(root, refData.canonicalAssets),
    [root, refData.canonicalAssets],
  );
  const assetIssuesById = useMemo(
    () => new Map(assetIssues.map((i) => [i.unitKey, i])),
    [assetIssues],
  );

  // Asset name per node, so the canvas shows what each unit is mapped to.
  const assetLabelsById = useMemo(() => {
    const labels = new Map<string, string>();
    const walk = (node: CompositionNode): void => {
      if (node.canonicalAssetKey) {
        const asset = refData.canonicalAssets.get(node.canonicalAssetKey);
        // Fall back to the key: an asset that is no longer in the catalogue is
        // worth showing as the raw code rather than as nothing at all.
        labels.set(node.id, asset?.canonicalName ?? node.canonicalAssetKey);
      }
      node.children.forEach(walk);
    };
    walk(root);
    return labels;
  }, [root, refData.canonicalAssets]);
  const errorCount = assetIssues.filter((i) => i.severity === "ERROR").length;
  const warningCount = assetIssues.length - errorCount;

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#4fc3f7", fontSize: 14 }}>
      Loading reference data...
    </div>
  );
  if (error) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#ef9a9a", fontSize: 14, padding: 24 }}>
      Error loading catalogue: {error}
    </div>
  );

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden", background: "#0d1b2a", position: "relative" }}>

      {/* ── React Flow canvas (full width) ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Top hint bar */}
        <div style={{ position: "absolute", top: 8, left: 8, right: editorOpen ? 330 : 8, zIndex: 10, pointerEvents: "none" }}>
          <span style={{ fontSize: 11, color: "#607d8b", fontFamily: "monospace" }}>
            {totalEntities} {totalEntities === 1 ? "node" : "nodes"}
            {errorCount > 0 && (
              <span style={{ color: "#ef5350" }}>
                {" "}· {errorCount} cannot be spawned
              </span>
            )}
            {warningCount > 0 && (
              <span style={{ color: "#ffb74d" }}>
                {" "}· {warningCount} with no model chosen
              </span>
            )}
            {!readOnly && " · click to select & edit · + to add child · × to remove"}
            {readOnly && " · read-only — use \"Use as Force\" to edit"}
          </span>
        </div>

        <AssetIssueContext.Provider value={assetIssuesById}>
          <AssetLabelContext.Provider value={assetLabelsById}>
            <ReactFlowProvider>
              <FlowCanvas flowNodes={flowNodes} flowEdges={flowEdges} onFitView={registerFitView} onFocusNode={registerFocusNode} />
            </ReactFlowProvider>
          </AssetLabelContext.Provider>
        </AssetIssueContext.Provider>
      </div>

      {/* ── Slide-in node editor panel (right side) ── */}
      {editorOpen && selectedNode && (
        <NodeEditorSidebar
          root={root}
          selectedNode={selectedNode}
          parentNode={parentNode ?? null}
          onClose={() => setEditorOpen(false)}
          onRemove={readOnly ? undefined : handleRemove}
          onUpdate={handleUpdateNode}
          onSelectNode={handleSelect}
          onAddChild={readOnly ? undefined : () => setAddChildParentId(selectedNode.id)}
          onFocusNode={(id) => {
            focusNodeRef.current?.(id);
          }}
          readOnly={readOnly}
          refData={refData}
          addChildParentId={addChildParentId}
          setAddChildParentId={setAddChildParentId}
          hierarchyTemplates={hierarchyTemplates}
          onAddChildConfirm={handleAddChildConfirm}
        />
      )}
    </div>
  );
}

// ── Exported helpers ──────────────────────────────────────────────────────────
export function smallBtn(bg: string): React.CSSProperties {
  return { padding: "3px 10px", background: bg, color: "#e0e0e0", border: "none", borderRadius: 3, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" };
}

// Keep SectionHeader exported in case other components use it
export function SectionHeader({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div style={{ padding: "6px 12px", fontSize: 11, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #1e3a4a", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {action}
    </div>
  );
}


