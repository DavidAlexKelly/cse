/**
 * HierarchyMap.tsx — hierarchical drill-down map placement.
 *
 * - Place top-level nodes on the map by clicking.
 * - Select a node → "Break down" replaces it with its children, evenly spread
 *   around where the parent was. The parent disappears.
 * - "Roll up" removes the children and restores the parent.
 * - Drag any marker to reposition. Children follow their parent because
 *   positions are stored as offsets from parent.
 *
 * All state is local only — no Foundry writes.
 * The `orbatExport` variable is recomputed whenever placement changes and
 * reflects the full placed hierarchy in the standard ORBAT JSON format.
 * It is logged to console, passed to the optional `onExport` prop, and
 * copyable via the "Copy JSON" toolbar button.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import ms from "milsymbol";
import "maplibre-gl/dist/maplibre-gl.css";

import type { CompositionNode } from "../../../types";
import {
  type LatLng,
  type NodePosition,
  absolutePosition,
  findNodeById,
  parentOf,
} from "../lib/localStore";
import type { BasemapHandle } from "@acc/decho-basemap";
import { createTheatreBasemap } from "../../../shared/map/dechoBasemapSetup";
import {
  initMgrsOverlay,
  removeMgrsOverlay,
  lngLatToMgrs,
  setGridEnabled,
} from "../../Map/MgrsOverlay";

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_CENTRE: [number, number] = [29.5, 69.5];
const DEFAULT_ZOOM = 8;

const MILITARY_TOPO = {
  ...namedFlavor("light"),
  background: "#d6d3c4", earth: "#d6d3c4",
  wood_a: "#b5c99a", wood_b: "#a8bc8d", water: "#8ab4cc",
  highway: "#d4892a", major: "#e8a840", boundaries: "#8b5e3c",
  country_label: "#3d2b1f", city_label: "#2c1f14",
};

// ENTITY_COLOURS removed — marker size is now driven by SIDC affiliation character
// (hostile symbols use a diamond frame so are scaled up ~28% vs friendly ones).

// ── Export types ──────────────────────────────────────────────────────────────

export interface OrbatExportUnit {
  primaryKey: string;
  unitIdentifier: string;
  entityType: string;
  affiliation: string;
  allegiance: string;
  echelon: string | null;
  militaryService: string;
  dis6Code: string | null;
  simulatorIdentifierCode: string | null;
  equipmentTypeKey: string | null;
  unitTypeKey: string | null;
  sidc: string | null;
  latitude: number | null;
  longitude: number | null;
  owningSimulator: string;
  canControlDrones: boolean;
}

export interface OrbatExportEdge {
  primaryKey: string;
  parentUnitKey: string;
  childUnitKey: string;
  relationshipTypeKey: string;
  validFrom: string;
  validTo: string | null;
}

export interface OrbatExport {
  operation: {
    primaryKey: string;
    startTime: string;
    endTime: string | null;
    terrainName: string;
  };
  unitHierarchy: {
    primaryKey: string;
    name: string;
    operationKey: string;
    validFrom: string;
    validTo: string | null;
  };
  units: OrbatExportUnit[];
  unitHierarchyEdges: OrbatExportEdge[];
}

// ── Placeholder operation / hierarchy (swap for real data when persisting) ────

const PLACEHOLDER_OPERATION: OrbatExport["operation"] = {
  primaryKey: "OP-PLACEHOLDER",
  startTime: new Date().toISOString(),
  endTime: null,
  terrainName: "unknown",
};

const PLACEHOLDER_HIERARCHY: OrbatExport["unitHierarchy"] = {
  primaryKey: "HIER-PLACEHOLDER",
  name: "Placeholder Hierarchy",
  operationKey: "OP-PLACEHOLDER",
  validFrom: new Date().toISOString().slice(0, 10),
  validTo: null,
};

// ── Build export from composition tree + placement positions ──────────────────

function buildOrbatExport(
  roots: CompositionNode[],
  positions: Map<string, NodePosition>,
): OrbatExport {
  const units: OrbatExportUnit[] = [];
  const edges: OrbatExportEdge[] = [];

  /**
   * Walk the tree, inheriting the parent's absolute position.
   * A node that has its own entry in `positions` uses that (absolute for roots,
   * offset-from-parent for drilled-down children). A node with no entry
   * inherits the parent's position (it hasn't been broken down yet, so it
   * sits on top of its parent — the user can drag it later).
   */
  function walkNode(
    treeRoot: CompositionNode,
    node: CompositionNode,
    parentId: string | null,
    inheritedPos: LatLng | null,
  ) {
    // Compute this node's absolute position
    const absPos = absolutePosition(treeRoot, node.id, positions) ?? inheritedPos;

    units.push({
      primaryKey: node.id,
      unitIdentifier: node.unitIdentifier,
      entityType: node.entityType,
      affiliation: node.affiliation,
      allegiance: node.allegiance,
      echelon: node.echelon || null,
      militaryService: node.militaryService,
      dis6Code: null,                 // populated when persisted to ontology
      simulatorIdentifierCode: null,  // populated when persisted to ontology
      equipmentTypeKey: node.equipmentTypeKey,
      unitTypeKey: node.unitTypeKey,
      sidc: node.sidc || null,
      latitude: absPos ? Math.round(absPos.lat * 1e6) / 1e6 : null,
      longitude: absPos ? Math.round(absPos.lng * 1e6) / 1e6 : null,
      owningSimulator: node.owningSimulator,
      canControlDrones: false,
    });

    if (parentId !== null) {
      edges.push({
        primaryKey: `EDGE-${parentId.slice(-8)}-${node.id.slice(-8)}`,
        parentUnitKey: parentId,
        childUnitKey: node.id,
        relationshipTypeKey: "RELTYPE-ORGANIC",
        validFrom: PLACEHOLDER_HIERARCHY.validFrom,
        validTo: null,
      });
    }

    for (const child of node.children) {
      walkNode(treeRoot, child, node.id, absPos);
    }
  }

  for (const root of roots) {
    if (!positions.has(root.id)) continue; // only include trees placed on the map
    const rootPos = absolutePosition(root, root.id, positions);
    walkNode(root, root, null, rootPos);
  }

  return {
    operation: PLACEHOLDER_OPERATION,
    unitHierarchy: PLACEHOLDER_HIERARCHY,
    units,
    unitHierarchyEdges: edges,
  };
}

// (protocol registration is now handled centrally in TileLoader via registerPmtilesProtocol)

// ── Marker helper ─────────────────────────────────────────────────────────────

/**
 * Derive a render size for a milsymbol marker.
 *
 * Hostile / Unknown / Suspect symbols use a diamond frame whose inscribed
 * area is smaller than the rectangular frame used by friendly units at the
 * same `size` value.  We compensate by rendering them ~25% larger so all
 * symbols look visually equivalent on the map.
 */
function markerSize(sidc: string, entityType: string): number {
  const base = entityType === "organisation" ? 36 : 28;
  // Characters at positions 1-2 of a SIDC encode affiliation:
  //   S = standard identity; position 2: F=Friend, H=Hostile, U=Unknown, N=Neutral, S=Suspect, etc.
  const affChar = sidc.length > 1 ? sidc[1].toUpperCase() : "F";
  const isHostileFrame = affChar === "H" || affChar === "U" || affChar === "S" || affChar === "J" || affChar === "K";
  return isHostileFrame ? Math.round(base * 1.28) : base;
}

function makeMarkerEl(sidc: string, selected: boolean, entityType: string): HTMLDivElement {
  const size = markerSize(sidc, entityType);
  const el = document.createElement("div");
  el.style.cursor = "pointer";
  el.style.filter = selected ? "drop-shadow(0 0 5px #4fc3f7)" : "none";
  el.innerHTML = buildMarkerSvg(sidc, selected, size);
  return el;
}

function buildMarkerSvg(sidc: string, selected: boolean, size: number): string {
  try {
    const svg = new ms.Symbol(sidc, { size, square: true, strokeWidth: selected ? 3 : 1.5 }).asSVG();
    if (svg && svg.length > 50) {
      return `<img src="data:image/svg+xml;base64,${btoa(svg)}" width="${size}" height="${size}" style="display:block;pointer-events:none"/>`;
    }
  } catch { /* fall through */ }
  // Fallback circle — colour by SIDC affiliation character
  const affChar = sidc.length > 1 ? sidc[1].toUpperCase() : "F";
  const fallbackColour = affChar === "H" || affChar === "J" || affChar === "K" ? "#C62828"
    : affChar === "U" || affChar === "S" ? "#F9A825"
    : "#1565C0";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2-2}" fill="${fallbackColour}" stroke="#fff" stroke-width="2"/></svg>`;
}

// ── Spread children evenly around a centre position ───────────────────────────

/**
 * Find the angle at the centre of the widest gap in the currently-occupied
 * angle set.  Used to place newly-added subordinates so they don't stack on
 * top of siblings the user has already positioned.
 *
 * Falls back to a fanned-out sequence (12, 3, 6, 9 o'clock) when there are
 * no occupied angles or when several new children are being inserted at
 * once — the `iterationHint` biases each subsequent call to a slightly
 * different angle so a burst of new children still spreads out.
 */
function findWidestGapAngle(taken: number[], iterationHint = 0): number {
  if (taken.length === 0) {
    // Fanned-out sequence: north, east, south, west, then diagonals.  Keeps
    // early adds visually pleasant even when placed one by one.
    const seq = [-Math.PI / 2, 0, Math.PI / 2, Math.PI, -Math.PI / 4, 3 * Math.PI / 4, Math.PI / 4, -3 * Math.PI / 4];
    return seq[iterationHint % seq.length];
  }

  // Sort the taken angles into [0, 2π), then find the largest gap between
  // consecutive entries (including the wrap-around gap).  Return the angle
  // at the midpoint of that gap.
  const norm = taken.map((a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
  let bestGap = 0;
  let bestMid = 0;
  for (let i = 0; i < norm.length; i++) {
    const a = norm[i];
    const b = i + 1 < norm.length ? norm[i + 1] : norm[0] + 2 * Math.PI;
    const gap = b - a;
    if (gap > bestGap) {
      bestGap = gap;
      bestMid = (a + b) / 2;
    }
  }
  // Convert back to (-π, π] range consistent with atan2 output
  return bestMid > Math.PI ? bestMid - 2 * Math.PI : bestMid;
}

/**
 * Compute the bounding box of a set of absolute lat/lng positions.
 * Returns null for an empty input.  Used by the auto-centre feature to
 * fit the map to a force's placed units.
 */
function boundsForPositions(positions: LatLng[]): { sw: LatLng; ne: LatLng } | null {
  if (positions.length === 0) return null;
  let minLat = positions[0].lat, maxLat = positions[0].lat;
  let minLng = positions[0].lng, maxLng = positions[0].lng;
  for (const p of positions) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { sw: { lat: minLat, lng: minLng }, ne: { lat: maxLat, lng: maxLng } };
}

// ── Props ─────────────────────────────────────────────────────────────────────

export type NodePositionMap = Map<string, NodePosition>;

/** An item available to add to the map — either a saved Force or a Template */
export interface MapAvailableItem {
  id: string;
  name: string;
  sidc: string;
  affiliation: string;
  echelon: string;
  nodeCount: number;
  kind: "force" | "template";
  root: CompositionNode;
  /** Present only when kind === "template" and it came from phase-ORBAT ingest */
  phaseOrigin?: {
    templateId: string;
    operationKey?: string | null;
    phaseIndex?: number | null;
    phaseName?: string | null;
    positionsById: Record<string, NodePosition>;
    relationshipsByEdgeId?: Record<string, string>;
  };
}

/** Minimal phase-group view model — no phaseGroupStore types leaked into HierarchyMap */
export interface PhaseGroupSlotView {
  id: string;
  phaseName: string;
  phaseIndex: number;
  templateId: string | null;
}
export interface PhaseGroupView {
  id: string;
  operationKey: string;
  slots: PhaseGroupSlotView[];
}


export interface CseValidationError {
  type?: string;
  message?: string;
  description?: string;
  isWarning?: boolean;
  path?: string;
}

export type CseValidationStatus = "idle" | "running" | "done" | "error";

interface Props {
  roots: CompositionNode[];
  positions: NodePositionMap;
  onPositionsChange: (positions: NodePositionMap) => void;
  onExport?: (data: OrbatExport) => void;
  availableItems?: MapAvailableItem[];
  onAddToMap?: (item: MapAvailableItem) => void;
  onRemoveFromMap?: (rootId: string) => void;
  cseErrors?: CseValidationError[];
  cseStatus?: CseValidationStatus;
  /** Phase groups for the manual builder in the Phases sidebar tab */
  phaseGroups?: PhaseGroupView[];
  selectedPhaseSlotId?: string | null;
  onSelectPhaseSlot?: (slotId: string) => void;
  onCreatePhaseGroup?: (operationKey: string, templateIds: string[]) => void;
  onAssignTemplateToSlot?: (groupId: string, slotId: string, templateId: string) => void;
  onRenamePhaseSlot?: (groupId: string, slotId: string, newName: string) => void;
  onRemovePhaseGroup?: (groupId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HierarchyMap({ roots, positions, onPositionsChange, onExport, availableItems = [], onAddToMap, onRemoveFromMap, cseErrors = [], cseStatus = "idle", phaseGroups: _phaseGroups = [], selectedPhaseSlotId: _selectedPhaseSlotId = null, onSelectPhaseSlot: _onSelectPhaseSlot, onCreatePhaseGroup: _onCreatePhaseGroup, onAssignTemplateToSlot: _onAssignTemplateToSlot, onRenamePhaseSlot: _onRenamePhaseSlot, onRemovePhaseGroup: _onRemovePhaseGroup }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  // positions are now lifted to parent — helper that accepts an updater function or direct value
  const setPositions = useCallback(
    (updater: NodePositionMap | ((prev: NodePositionMap) => NodePositionMap)) => {
      if (typeof updater === "function") {
        onPositionsChange(updater(positions));
      } else {
        onPositionsChange(updater);
      }
    },
    [onPositionsChange, positions],
  );
  // ── Two orthogonal state axes ─────────────────────────────────────────────
  //
  // viewStack  — what is ON THE MAP (the "camera" into the hierarchy).
  //              []        = top level, one marker per placed root.
  //              [id, …]   = broken down to that node; map shows it + children.
  //              Only "Break down" and "Roll up" buttons change this.
  //
  // selectedId — what the SIDEBAR PANEL shows (the "inspector").
  //              Any node can be previewed by clicking it (map OR sidebar rows)
  //              without changing the map view at all.
  //              Changing selectedId NEVER moves the camera.
  const [viewStack, setViewStack] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placingRootId, setPlacingRootId] = useState<string | null>(null);
  const [mgrsCoord, setMgrsCoord] = useState("");
  const [showGrid, setShowGrid] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  /**
   * When the user clicks "Expand all", we want to show EVERY positioned node
   * in the subtree simultaneously — not just the focused node + its direct
   * children.  This flag switches visibleNodes into "show all descendants"
   * mode.  It is cleared whenever the user navigates away (roll-up, breadcrumb
   * click, top-level, or a fresh break-down).
   *
   * expandAllRootId — the nodeId that was passed to handleExpandAll so we know
   * which tree to show all descendants of.
   */
  const [expandAllRootId, setExpandAllRootId] = useState<string | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const treeRootOf = useCallback((nodeId: string): CompositionNode | null => {
    for (const root of roots) {
      if (findNodeById(root, nodeId)) return root;
    }
    return null;
  }, [roots]);

  const getAbsPos = useCallback((nodeId: string): LatLng | null => {
    const treeRoot = treeRootOf(nodeId);
    if (!treeRoot) return null;
    return absolutePosition(treeRoot, nodeId, positions);
  }, [treeRootOf, positions]);

  // ── ORBAT export — recomputed and debounced after drag stops ─────────────
  // We do NOT compute during drag (expensive + causes re-render jank).
  // Instead we wait 400ms after the last position change, then build + emit.

  const onExportRef = useRef(onExport);
  useEffect(() => { onExportRef.current = onExport; }, [onExport]);

  // Stable ref to latest positions so the debounced callback always reads fresh data
  const positionsForExportRef = useRef(positions);
  useEffect(() => { positionsForExportRef.current = positions; }, [positions]);
  const rootsForExportRef = useRef(roots);
  useEffect(() => { rootsForExportRef.current = roots; }, [roots]);

  // orbatExport is kept in a ref — only updated after debounce, then triggers a
  // single state update for the toolbar unit count
  const [placedUnitCount, setPlacedUnitCount] = useState(0);
  const orbatExportRef = useRef<OrbatExport | null>(null);

  // Debounced export emitter — 400ms after last position change
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Don't fire while dragging
    if (draggingIdRef.current !== null) return;

    if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    exportTimerRef.current = setTimeout(() => {
      const built = buildOrbatExport(rootsForExportRef.current, positionsForExportRef.current);
      orbatExportRef.current = built;
      setPlacedUnitCount(built.units.length);
      if (built.units.length > 0) {
        onExportRef.current?.(built);
      }
    }, 400);
    return () => {
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, roots]);

  // ── Visible nodes ──────────────────────────────────────────────────────────

  // ── Which nodes show as markers on the map ────────────────────────────────
  //
  // At top level every placed root appears as a marker — one per force.
  //
  // When drilled into a specific node (viewStack non-empty) we show:
  //   • The focused node + its direct children  (the "camera" view)
  //   • PLUS the roots of all OTHER placed forces, so they remain visible
  //     while the user is drilling into one of them.  These other-force roots
  //     are rendered at their own positions and remain interactive.
  const visibleNodes = useMemo<CompositionNode[]>(() => {
    if (viewStack.length === 0) {
      // Top-level: one marker per placed root hierarchy
      return roots.filter((r) => positions.has(r.id));
    }

    // ── Expand-all mode: show every positioned node in the whole subtree ──
    if (expandAllRootId !== null) {
      const tr = treeRootOf(expandAllRootId);
      const startNode = tr ? findNodeById(tr, expandAllRootId) : null;
      if (startNode && tr) {
        // Collect every node in the subtree that has an absolute position
        const subtreeNodes: CompositionNode[] = [];
        const collectPositioned = (n: CompositionNode) => {
          const pos = absolutePosition(tr, n.id, positions);
          if (pos) subtreeNodes.push(n);
          for (const c of n.children) collectPositioned(c);
        };
        collectPositioned(startNode);

        // Keep other placed force roots visible too
        const subtreeIds = new Set(subtreeNodes.map((n) => n.id));
        const otherRoots = roots.filter(
          (r) => positions.has(r.id) && !subtreeIds.has(r.id) && r.id !== tr.id,
        );
        return [...subtreeNodes, ...otherRoots];
      }
    }

    // ── Normal drill-down mode ─────────────────────────────────────────────
    // Drilled in: show the focused node + its direct children
    const focusId = viewStack[viewStack.length - 1];
    const tr = treeRootOf(focusId);
    const focusNode = tr ? findNodeById(tr, focusId) : null;
    const focusedNodes: CompositionNode[] = focusNode
      ? [focusNode, ...focusNode.children]
      : [];

    // Also keep other placed roots visible so all forces stay on the map
    const focusedIds = new Set(focusedNodes.map((n) => n.id));
    const otherRoots = roots.filter(
      (r) => positions.has(r.id) && !focusedIds.has(r.id) && r.id !== tr?.id,
    );

    return [...focusedNodes, ...otherRoots];
  }, [viewStack, expandAllRootId, roots, positions, treeRootOf]);

  // Auto-assign child positions when drilling down OR when new subordinates
  // are added to the currently-focused parent.
  //
  // IMPORTANT — this effect must NEVER overwrite a child that already has a
  // position.  The `next.has(child.id)` guard is what preserves the positions
  // of siblings when the user adds a new subordinate or drags one around.
  //
  // We depend on `roots` (not just viewStack) so that when the composition
  // tree grows — e.g. the user adds a subordinate via the detail panel while
  // drilled in — the new child immediately gets an offset instead of stacking
  // invisibly on top of its parent.
  useEffect(() => {
    // Determine which parent nodes we need to seed children for.
    //   - Drilled in: only the currently-focused node (existing behaviour).
    //   - Top level: every placed root — so newly placed forces immediately
    //     show all their sub-units on the map with sensible offsets.
    const parentIds: string[] = [];
    if (viewStack.length === 0) {
      for (const r of roots) {
        if (positions.has(r.id)) parentIds.push(r.id);
      }
    } else {
      parentIds.push(viewStack[viewStack.length - 1]);
    }
    if (parentIds.length === 0) return;

    const RADIUS_BY_DEPTH = [0.0006, 0.0004, 0.00025]; // outer rings shrink for deeper units
    let mutated = false;
    const nextMap = new Map(positions);

    // Seed offsets for a single parent (only touching UN-positioned children).
    const seedParent = (parentNode: CompositionNode, depth: number) => {
      if (parentNode.children.length === 0) return;
      const positioned: CompositionNode[] = [];
      const missing:    CompositionNode[] = [];
      for (const c of parentNode.children) {
        (nextMap.has(c.id) ? positioned : missing).push(c);
      }
      if (missing.length === 0) return;
      const radius = RADIUS_BY_DEPTH[Math.min(depth, RADIUS_BY_DEPTH.length - 1)];
      const takenAngles: number[] = positioned
        .map((sib) => nextMap.get(sib.id)?.offsetFromParent)
        .filter((o): o is LatLng => !!o)
        .map((o) => Math.atan2(o.lat, o.lng));
      missing.forEach((child, i) => {
        if (nextMap.has(child.id)) return;
        const angle = takenAngles.length === 0
          ? (2 * Math.PI * i) / missing.length - Math.PI / 2
          : findWidestGapAngle(takenAngles, i);
        takenAngles.push(angle);
        nextMap.set(child.id, {
          offsetFromParent: {
            lat: radius * Math.sin(angle),
            lng: radius * Math.cos(angle),
          },
        });
        mutated = true;
      });
    };

    for (const parentId of parentIds) {
      const tr = treeRootOf(parentId);
      const focusNode = tr ? findNodeById(tr, parentId) : null;
      if (!focusNode) continue;
      // Ensure the parent itself has an absolute anchor to hang offsets from.
      if (!absolutePosition(tr!, parentId, nextMap)) continue;
      // Only seed direct children of this parent — do NOT recurse further.
      // Each level is seeded lazily as the user drills down, which prevents
      // every unit in the whole ORBAT from appearing on the map at once.
      seedParent(focusNode, 0);
    }

    if (mutated) setPositions(() => nextMap);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStack, roots, positions]);

  // ── Map init ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let basemapHandle: BasemapHandle | null = null;

    (async () => {
      try {
        // Registers the tile protocol AND glyphs/sprite, and resolves the
        // theatre store; styleFragment() supplies the source and those keys.
        const basemap = await createTheatreBasemap(maplibregl);
        basemapHandle = basemap;
        if (cancelled) { basemap.dispose(); return; }

        const map = new maplibregl.Map({
          container: containerRef.current!,
          style: {
            version: 8,
            ...basemap.styleFragment(),
            layers: protomapsLayers("protomaps", MILITARY_TOPO),
          },
          center: DEFAULT_CENTRE,
          zoom: DEFAULT_ZOOM,
        });

        map.addControl(new maplibregl.NavigationControl(), "top-right");
        map.addControl(new maplibregl.ScaleControl({ maxWidth: 200, unit: "metric" }), "bottom-right");
        initMgrsOverlay(map);
        map.on("mousemove", (e) => setMgrsCoord(lngLatToMgrs(e.lngLat.lng, e.lngLat.lat)));
        map.on("mouseleave", () => setMgrsCoord(""));

        map.on("click", (e) => {
          if (!placingRootIdRef.current) return;
          const id = placingRootIdRef.current;
          const { lat, lng } = e.lngLat;
          setPositions((prev) => {
            const next = new Map(prev);
            next.set(id, { offsetFromParent: { lat, lng } });
            return next;
          });
          setPlacingRootId(null);
          setSelectedId(id);
          // Auto-centre on the newly placed force so it's framed in view.
          // Uses flyTo (not fitBounds) — the force only has one placed node at
          // this point, so a fit would over-zoom.
          map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13), duration: 700 });
        });

        mapRef.current = map;
      } catch (err) {
        if (!cancelled) setInitError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) { removeMgrsOverlay(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
      markersRef.current.clear();
      basemapHandle?.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placingRootIdRef = useRef<string | null>(null);
  useEffect(() => {
    placingRootIdRef.current = placingRootId;
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = placingRootId ? "crosshair" : "";
  }, [placingRootId]);

  const positionsRef = useRef(positions);
  useEffect(() => { positionsRef.current = positions; }, [positions]);

  // Track which node is currently being dragged so we skip repositioning it
  // and suppress mid-drag export recalculation
  const draggingIdRef = useRef<string | null>(null);

  // ── Auto-centre helpers ─────────────────────────────────────────────────────

  /**
   * Fit the map to a whole tree rooted at `treeRoot`, using every node in
   * that tree that currently has a position (whether or not it's visible on
   * screen).  Used by:
   *   - the "⌖" button next to each placed force in the sidebar
   *   - drilling into a subordinate view (auto-centre on the visible group)
   */
  const centerOnTree = useCallback((treeRoot: CompositionNode) => {
    const map = mapRef.current;
    if (!map) return;

    const collect: LatLng[] = [];
    const walk = (n: CompositionNode) => {
      const pos = absolutePosition(treeRoot, n.id, positionsRef.current);
      if (pos) collect.push(pos);
      n.children.forEach(walk);
    };
    walk(treeRoot);

    if (collect.length === 0) return;
    if (collect.length === 1) {
      map.flyTo({ center: [collect[0].lng, collect[0].lat], zoom: Math.max(map.getZoom(), 13), duration: 700 });
      return;
    }
    const b = boundsForPositions(collect);
    if (!b) return;
    map.fitBounds(
      [[b.sw.lng, b.sw.lat], [b.ne.lng, b.ne.lat]],
      { padding: 80, maxZoom: 15, duration: 700 },
    );
  }, []);

  /**
   * Fit the map to a specific set of nodes (used when drilling into a
   * subordinate view so the visible group fills the frame without changing
   * the positions of unrelated units).
   */
  const centerOnNodes = useCallback((nodes: CompositionNode[]) => {
    const map = mapRef.current;
    if (!map || nodes.length === 0) return;

    const collect: LatLng[] = [];
    for (const n of nodes) {
      const tr = treeRootOf(n.id);
      if (!tr) continue;
      const pos = absolutePosition(tr, n.id, positionsRef.current);
      if (pos) collect.push(pos);
    }
    if (collect.length === 0) return;
    if (collect.length === 1) {
      map.flyTo({ center: [collect[0].lng, collect[0].lat], zoom: Math.max(map.getZoom(), 14), duration: 700 });
      return;
    }
    const b = boundsForPositions(collect);
    if (!b) return;
    map.fitBounds(
      [[b.sw.lng, b.sw.lat], [b.ne.lng, b.ne.lat]],
      { padding: 100, maxZoom: 16, duration: 700 },
    );
  }, [treeRootOf]);

  // Auto-centre when drilling deeper into the hierarchy, OR when expand-all
  // fires — brings the newly visible nodes into view.
  const prevViewStackLen = useRef(viewStack.length);
  const prevExpandAllRootId = useRef(expandAllRootId);
  useEffect(() => {
    const expandAllJustActivated =
      expandAllRootId !== null && prevExpandAllRootId.current !== expandAllRootId;

    if (expandAllJustActivated && expandAllRootId) {
      // Centre on the whole expanded subtree after positions are seeded
      const t = setTimeout(() => {
        const tr = treeRootOf(expandAllRootId);
        const root = tr ? findNodeById(tr, expandAllRootId) : null;
        if (root && tr) {
          const allNodes: CompositionNode[] = [];
          const collect = (n: CompositionNode) => { allNodes.push(n); n.children.forEach(collect); };
          collect(root);
          centerOnNodes(allNodes.filter((n) => {
            const pos = absolutePosition(tr, n.id, positionsRef.current);
            return pos !== null;
          }));
        }
      }, 80);
      prevViewStackLen.current = viewStack.length;
      prevExpandAllRootId.current = expandAllRootId;
      return () => clearTimeout(t);
    }

    if (viewStack.length > prevViewStackLen.current && viewStack.length > 0 && expandAllRootId === null) {
      const focusId = viewStack[viewStack.length - 1];
      const tr = treeRootOf(focusId);
      const focusNode = tr ? findNodeById(tr, focusId) : null;
      if (focusNode) {
        // Small delay so the "assign missing positions" effect runs first
        // and the new children have absolute positions to fit around.
        const t = setTimeout(() => centerOnNodes(focusNode.children), 60);
        prevViewStackLen.current = viewStack.length;
        prevExpandAllRootId.current = expandAllRootId;
        return () => clearTimeout(t);
      }
    }
    prevViewStackLen.current = viewStack.length;
    prevExpandAllRootId.current = expandAllRootId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStack, expandAllRootId]);

  // ── Sync markers ───────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(visibleNodes.map((n) => n.id));

    // Remove markers for nodes no longer visible
    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) { marker.remove(); markersRef.current.delete(id); }
    }

    for (const node of visibleNodes) {
      const pos = getAbsPos(node.id);
      if (!pos) continue;

      const isSelected = node.id === selectedId;
      const existing = markersRef.current.get(node.id);

      if (existing) {
        // Only reposition if this marker is NOT currently being dragged.
        if (draggingIdRef.current !== node.id) {
          existing.setLngLat([pos.lng, pos.lat]);
        }
        const el = existing.getElement() as HTMLDivElement;
        el.style.filter = isSelected ? "drop-shadow(0 0 5px #4fc3f7)" : "none";
      } else {
        const el = makeMarkerEl(node.sidc, isSelected, node.entityType);
        el.addEventListener("click", (e) => { e.stopPropagation(); setSelectedId(node.id); });

        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([pos.lng, pos.lat])
          .addTo(map);

        marker.on("drag", () => {
          draggingIdRef.current = node.id;
        });

        marker.on("dragend", () => {
          draggingIdRef.current = null;
          const newPos = marker.getLngLat();
          // Capture the tree root at drag-end time (not in closure) to avoid
          // stale `roots` reference — the roots array identity may have changed
          // since the marker was created.
          const tr = treeRootOf(node.id);
          if (!tr) return;
          const parent = parentOf(tr, node.id);
          // Use the ref for positions so we read the freshest values, not the
          // stale closure captured when the marker was first created.
          const currentPositions = positionsRef.current;
          let newOffset: LatLng;
          if (parent) {
            const pPos = absolutePosition(tr, parent.id, currentPositions);
            newOffset = pPos
              ? { lat: newPos.lat - pPos.lat, lng: newPos.lng - pPos.lng }
              : { lat: newPos.lat, lng: newPos.lng };
          } else {
            newOffset = { lat: newPos.lat, lng: newPos.lng };
          }
          // Collect every node id that belongs to THIS tree so we only touch
          // positions belonging to the dragged hierarchy — never the other one.
          const thisTreeIds = new Set<string>();
          const collectIds = (n: CompositionNode) => { thisTreeIds.add(n.id); n.children.forEach(collectIds); };
          collectIds(tr);

          setPositions((prev) => {
            const next = new Map(prev);
            if (parent) {
              // Dragged a sub-unit: clear child offsets inside this tree only
              // so the seed effect re-spreads them around the new position.
              // The root anchor and all OTHER trees' positions are untouched.
              for (const id of thisTreeIds) {
                if (id !== tr.id && id !== node.id) next.delete(id);
              }
            }
            // Root drag: children keep their relative offsets — no reset needed.
            next.set(node.id, { offsetFromParent: newOffset });
            return next;
          });
        });

        markersRef.current.set(node.id, marker);
      }
    }
  }, [visibleNodes, positions, selectedId, getAbsPos, treeRootOf]);

  // ── Map-level navigation actions ──────────────────────────────────────────
  // These are the ONLY things that change what's visible on the map.
  // Clicking a parent/child row in the sidebar only changes selectedId — it
  // does NOT push/pop the viewStack.

  /** Break down: push nodeId onto the viewStack so its children appear on map */
  const handleBreakDown = useCallback((nodeId: string) => {
    setExpandAllRootId(null); // leave expand-all mode when stepping normally
    setViewStack((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === nodeId) return prev;
      return [...prev, nodeId];
    });
    setSelectedId(nodeId);
  }, []);

  /**
   * Expand all: simultaneously show every unit in the subtree rooted at
   * `nodeId` on the map.
   *
   * Two things happen:
   * 1. Positions are seeded for every descendant that doesn't have one yet
   *    (using progressively smaller radii at each depth level).
   * 2. `expandAllRootId` is set, which switches `visibleNodes` into
   *    "show-all-descendants" mode — every node in the subtree that has an
   *    absolute position becomes a marker at the same time.
   *
   * The viewStack is set to the path from the tree root to `nodeId` so the
   * breadcrumb correctly reflects the drill depth.  Roll-up and breadcrumb
   * clicks both clear expandAllRootId, returning to normal step-by-step mode.
   */
  const handleExpandAll = useCallback((nodeId: string) => {
    const tr = treeRootOf(nodeId);
    const startNode = tr ? findNodeById(tr, nodeId) : null;
    if (!startNode || !tr) return;

    // Guard: start node must already have a position (be placed on the map)
    if (!positions.has(startNode.id) && startNode.id !== tr.id) return;

    // ── 1. Seed positions for every unpositioned descendant ───────────────
    const RADIUS_BY_DEPTH = [0.0006, 0.0004, 0.00025, 0.00015, 0.0001];
    const nextPositions = new Map(positions);
    let mutated = false;

    const seedAllDescendants = (parent: CompositionNode, depth: number) => {
      if (parent.children.length === 0) return;
      const positioned: CompositionNode[] = [];
      const missing:    CompositionNode[] = [];
      for (const c of parent.children) {
        (nextPositions.has(c.id) ? positioned : missing).push(c);
      }
      if (missing.length > 0) {
        const radius = RADIUS_BY_DEPTH[Math.min(depth, RADIUS_BY_DEPTH.length - 1)];
        const takenAngles: number[] = positioned
          .map((s) => nextPositions.get(s.id)?.offsetFromParent)
          .filter((o): o is LatLng => !!o)
          .map((o) => Math.atan2(o.lat, o.lng));
        missing.forEach((child, i) => {
          if (nextPositions.has(child.id)) return;
          const angle = takenAngles.length === 0
            ? (2 * Math.PI * i) / missing.length - Math.PI / 2
            : findWidestGapAngle(takenAngles, i);
          takenAngles.push(angle);
          nextPositions.set(child.id, {
            offsetFromParent: {
              lat: radius * Math.sin(angle),
              lng: radius * Math.cos(angle),
            },
          });
          mutated = true;
        });
      }
      for (const c of parent.children) seedAllDescendants(c, depth + 1);
    };

    seedAllDescendants(startNode, 0);
    if (mutated) setPositions(() => nextPositions);

    // ── 2. Build viewStack = path from tree root to nodeId ────────────────
    const pathToNode: string[] = [];
    const buildPath = (n: CompositionNode, target: string, acc: string[]): boolean => {
      acc.push(n.id);
      if (n.id === target) return true;
      for (const c of n.children) {
        if (buildPath(c, target, acc)) return true;
      }
      acc.pop();
      return false;
    };
    buildPath(tr, nodeId, pathToNode);

    // ── 3. Switch into expand-all display mode ────────────────────────────
    setViewStack(pathToNode);
    setExpandAllRootId(nodeId);
    setSelectedId(nodeId);
  }, [treeRootOf, positions, setPositions]);

  /** Roll up: pop one level off the viewStack (or leave expand-all mode first) */
  const handleRollUp = useCallback(() => {
    // If we're in expand-all mode, first click just collapses back to
    // normal drill-down at the same viewStack depth (the startNode level).
    // Second click then pops a level as normal.
    if (expandAllRootId !== null) {
      setExpandAllRootId(null);
      // viewStack is already at the correct depth (path to expandAllRootId),
      // so no need to pop — just leave normal mode at that level.
      return;
    }
    setViewStack((prev) => {
      if (prev.length === 0) return prev;
      const newStack = prev.slice(0, -1);
      // Select the new focus node (parent level)
      const newFocusId = newStack.length > 0 ? newStack[newStack.length - 1] : null;
      if (newFocusId) {
        setSelectedId(newFocusId);
      } else {
        // Back at top level — select the tree root so the panel stays open
        const tr = treeRootOf(prev[0]);
        setSelectedId(tr ? tr.id : null);
      }
      return newStack;
    });
  }, [treeRootOf, expandAllRootId]);


  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedNode = useMemo(() => {
    if (!selectedId) return null;
    const tr = treeRootOf(selectedId);
    return tr ? findNodeById(tr, selectedId) : null;
  }, [selectedId, treeRootOf]);

  const breadcrumb = useMemo<CompositionNode[]>(() => {
    return viewStack.map((id) => {
      const tr = roots.find((r) => findNodeById(r, id));
      return tr ? findNodeById(tr, id) : null;
    }).filter((n): n is CompositionNode => n !== null);
  }, [viewStack, roots]);

  const currentFocusLabel = viewStack.length > 0
    ? (() => {
        const id = viewStack[viewStack.length - 1];
        const tr = roots.find((r) => findNodeById(r, id));
        return tr ? (findNodeById(tr, id)?.unitIdentifier || "(unnamed)") : "";
      })()
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: "#0d1b2a" }}>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "#0a1520", borderBottom: "1px solid #1e3a4a", flexShrink: 0, flexWrap: "wrap" }}>

        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "hidden" }}>
          <button
            onClick={() => { setViewStack([]); setSelectedId(null); setExpandAllRootId(null); }}
            style={{ background: viewStack.length === 0 ? "#1565C0" : "transparent", color: viewStack.length === 0 ? "#fff" : "#90a4ae", border: "none", borderRadius: 3, padding: "2px 7px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Top level
          </button>
          {breadcrumb.map((n, i) => (
            <React.Fragment key={n.id}>
              <span style={{ color: "#2a4a6a", fontSize: 12 }}>{">"}</span>
              <button
                onClick={() => { setExpandAllRootId(null); setViewStack((prev) => prev.slice(0, i + 1)); setSelectedId(null); }}
                style={{ background: i === breadcrumb.length - 1 ? "#1565C0" : "transparent", color: i === breadcrumb.length - 1 ? "#fff" : "#90a4ae", border: "none", borderRadius: 3, padding: "2px 7px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {n.unitIdentifier || "(unnamed)"}
              </button>
            </React.Fragment>
          ))}
        </div>

        {currentFocusLabel && (
          <span style={{ fontSize: 11, color: "#607d8b", whiteSpace: "nowrap" }}>
            Subordinates of <strong style={{ color: "#e0e0e0" }}>{currentFocusLabel}</strong>
          </span>
        )}

        {placedUnitCount > 0 && (
          <span style={{ fontSize: 11, color: "#a5d6a7", marginLeft: "auto" }}>✓ {placedUnitCount} units</span>
        )}

        <button
          onClick={() => { const next = !showGrid; setShowGrid(next); if (mapRef.current) setGridEnabled(mapRef.current, next); }}
          style={{ ...toolBtn(showGrid ? "rgba(255,102,0,0.8)" : "rgba(0,0,0,0.5)"), ...(placedUnitCount === 0 ? { marginLeft: "auto" } : {}) }}
        >MGRS</button>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Map */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {initError && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#1a2733", color: "#ef9a9a", fontSize: 13, padding: 24, textAlign: "center", zIndex: 5 }}>
              Map error: {initError}
            </div>
          )}
          <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

          {placingRootId && (
            <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", background: "#e65100", color: "#fff", padding: "6px 14px", borderRadius: 4, fontSize: 13, pointerEvents: "none", zIndex: 10 }}>
              Click map to place: <strong>{roots.find((r) => r.id === placingRootId)?.unitIdentifier ?? "unit"}</strong>
            </div>
          )}

          {mgrsCoord && (
            <div style={{ position: "absolute", bottom: 32, left: 8, background: "rgba(0,0,0,0.75)", color: "#ff6600", fontFamily: "monospace", fontSize: 12, padding: "3px 8px", borderRadius: 3, pointerEvents: "none", zIndex: 10 }}>
              {mgrsCoord}
            </div>
          )}

          {roots.length > 0 && visibleNodes.length === 0 && !placingRootId && viewStack.length === 0 && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "rgba(10,21,32,0.85)", color: "#90a4ae", padding: "14px 20px", borderRadius: 6, fontSize: 13, textAlign: "center", pointerEvents: "none", zIndex: 10, maxWidth: 280 }}>
              Select a unit and click <strong style={{ color: "#4fc3f7" }}>Place</strong> to put it on the map.
            </div>
          )}

          {roots.length === 0 && availableItems.length === 0 && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "rgba(10,21,32,0.85)", color: "#90a4ae", padding: "14px 20px", borderRadius: 6, fontSize: 13, textAlign: "center", pointerEvents: "none", zIndex: 10, maxWidth: 280 }}>
              Create forces in the <strong style={{ color: "#4fc3f7" }}>Forces</strong> tab, then add them to the map using the sidebar.
            </div>
          )}
          {roots.length === 0 && availableItems.length > 0 && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "rgba(10,21,32,0.85)", color: "#90a4ae", padding: "14px 20px", borderRadius: 6, fontSize: 13, textAlign: "center", pointerEvents: "none", zIndex: 10, maxWidth: 280 }}>
              Use the sidebar to <strong style={{ color: "#4fc3f7" }}>Add</strong> a force, then click <strong style={{ color: "#4fc3f7" }}>Place</strong> to position it.
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div style={{ width: 260, flexShrink: 0, borderLeft: "1px solid #1e3a4a", display: "flex", flexDirection: "column", overflow: "hidden", background: "#0a1520" }}>

          {selectedId && selectedNode ? (
            /* ── Unit detail panel — preview any node without moving the camera ── */
            <UnitDetailPanel
              node={selectedNode}
              treeRoot={treeRootOf(selectedId)}
              mapFocusId={viewStack.length > 0 ? viewStack[viewStack.length - 1] : null}
              isExpandAllActive={expandAllRootId !== null}
              onClose={() => { setSelectedId(null); }}
              onCenter={() => {
                if (expandAllRootId !== null) {
                  // Centre on the whole expanded subtree
                  const tr = treeRootOf(expandAllRootId);
                  const root = tr ? findNodeById(tr, expandAllRootId) : null;
                  if (root && tr) {
                    const allNodes: CompositionNode[] = [];
                    const collect = (n: CompositionNode) => { allNodes.push(n); n.children.forEach(collect); };
                    collect(root);
                    centerOnNodes(allNodes.filter((n) => {
                      const pos = absolutePosition(tr, n.id, positionsRef.current);
                      return pos !== null;
                    }));
                  }
                } else {
                  centerOnNodes(selectedNode.children.length > 0
                    ? [selectedNode, ...selectedNode.children]
                    : [selectedNode]);
                }
              }}
              onSelectNode={(id) => {
                // Preview a parent or child row — only changes sidebar, NOT the map
                setSelectedId(id);
              }}
              onBreakDown={() => handleBreakDown(selectedNode.id)}
              onRollUp={handleRollUp}
              onExpandAll={() => handleExpandAll(selectedNode.id)}
            />
          ) : (
            /* ── Force list (nothing selected) ── */
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                <AddToMapSection
                  availableItems={availableItems}
                  placedRootIds={new Set(roots.map((r) => r.id))}
                  onAdd={(item) => onAddToMap?.(item)}
                />
                {roots.length > 0 && (
                  <OnMapPanel
                    roots={roots}
                    positions={positions}
                    placingRootId={placingRootId}
                    selectedId={selectedId}
                    onPlace={(id) => { setPlacingRootId(id); setSelectedId(null); }}
                    onSelect={(id) => {
                      // Selecting a root previews it; returns map to top-level view
                      setSelectedId(id === selectedId ? null : id);
                      if (id !== selectedId) { setViewStack([]); setExpandAllRootId(null); }
                    }}
                    onRemove={(id) => {
                      onRemoveFromMap?.(id);
                      const tr = roots.find((r) => r.id === id);
                      if (tr && viewStack.some((sid) => findNodeById(tr, sid))) {
                        setViewStack([]); setSelectedId(null); setExpandAllRootId(null);
                      }
                    }}
                    onCenterTree={centerOnTree}
                    onCenterNode={(id) => {
                      const tr = treeRootOf(id);
                      if (!tr) return;
                      const target = findNodeById(tr, id);
                      if (target) centerOnNodes([target]);
                    }}
                  />
                )}
                {cseStatus !== "idle" && (
                  <CseValidationSection cseErrors={cseErrors} cseStatus={cseStatus} />
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function toolBtn(bg: string): React.CSSProperties {
  return { padding: "3px 10px", background: bg, color: "#e0e0e0", border: "none", borderRadius: 4, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 };
}

// ── Inline milsymbol image ─────────────────────────────────────────────────────

function MilSymbolImg({ sidc, size = 24 }: { sidc: string; size?: number }) {
  try {
    const svg = new ms.Symbol(sidc, { size, square: true, strokeWidth: 1.5 }).asSVG();
    if (svg && svg.length > 50) {
      return <img src={`data:image/svg+xml;base64,${btoa(svg)}`} width={size} height={size} alt="" style={{ display: "block", flexShrink: 0 }} />;
    }
  } catch { /* fall through */ }
  return <div style={{ width: size, height: size, borderRadius: 2, background: "#1a2b3c", flexShrink: 0 }} />;
}

// ── Unit detail panel ─────────────────────────────────────────────────────────

function buildAncestorPath(root: CompositionNode, targetId: string): CompositionNode[] {
  function search(node: CompositionNode, path: CompositionNode[]): CompositionNode[] | null {
    const next = [...path, node];
    if (node.id === targetId) return next;
    for (const child of node.children) {
      const found = search(child, next);
      if (found) return found;
    }
    return null;
  }
  return search(root, []) ?? [];
}

/**
 * UnitDetailPanel
 *
 * Shows one node in context: its direct parent, itself (highlighted), and its
 * direct children. Clicking any parent or child row just previews that node in
 * the sidebar — it does NOT change the map. Break down / Roll up are the
 * explicit buttons that move the map camera.
 *
 * Props:
 *   mapFocusId — the id currently at the top of the viewStack (or null if at
 *                top level). Used to show whether Roll up is possible and to
 *                highlight which node is the current map focus.
 */
function UnitDetailPanel({
  node,
  treeRoot,
  mapFocusId,
  isExpandAllActive,
  onClose,
  onCenter,
  onSelectNode,
  onBreakDown,
  onRollUp,
  onExpandAll,
}: {
  node: CompositionNode;
  treeRoot: CompositionNode | null;
  /** ID of the node currently focused on the map (top of viewStack), or null */
  mapFocusId: string | null;
  /** True when expand-all mode is currently active */
  isExpandAllActive: boolean;
  onClose: () => void;
  onCenter: () => void;
  /** Preview a different node in the sidebar (parent or child click) */
  onSelectNode: (id: string) => void;
  /** Move the map camera down into this node's children */
  onBreakDown: () => void;
  /** Move the map camera up one level */
  onRollUp: () => void;
  /** Expand all: seed positions for every descendant and show them all at once */
  onExpandAll: () => void;
}) {
  const fullPath = treeRoot ? buildAncestorPath(treeRoot, node.id) : [node];
  const directParent = fullPath.length >= 2 ? fullPath[fullPath.length - 2] : null;

  // Roll up: enabled when drilled in OR when expand-all is active.
  // Break down: enabled when the selected node has children AND we're NOT already showing all.
  // Expand all: enabled when there are children and expand-all is not yet active.
  const canRollUp    = mapFocusId !== null || isExpandAllActive;
  const canBreakDown = node.children.length > 0 && !isExpandAllActive;
  const canExpandAll = node.children.length > 0 && !isExpandAllActive;
  // Is this node currently the map-focused node?
  const isMapFocus = node.id === mapFocusId;

  const AFF_COLOURS: Record<string, string> = {
    Friend: "#5B9BD5", Hostile: "#E74C3C", Neutral: "#27AE60",
    Unknown: "#F1C40F", "Assumed Friend": "#9ab8d8", Suspect: "#e07070",
  };
  const affColor = AFF_COLOURS[node.affiliation] ?? "#607d8b";

  // Shared row style — highlighted for the selected node
  const rowBase: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8,
    padding: "7px 12px",
    borderLeft: "3px solid transparent",
  };

  // Clickable row (parent / child preview) — subtle hover
  function ClickRow({ n, icon, dim, onClick }: { n: CompositionNode; icon: React.ReactNode; dim?: boolean; onClick: () => void }) {
    const [hov, setHov] = React.useState(false);
    return (
      <div
        style={{ ...rowBase, cursor: "pointer", opacity: dim ? 0.7 : 1, background: hov ? "rgba(255,255,255,0.04)" : "transparent" }}
        onClick={onClick}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
      >
        <span style={{ fontSize: 10, color: "#37474f", flexShrink: 0 }}>{icon}</span>
        <MilSymbolImg sidc={n.sidc} size={20} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "#90a4ae", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {n.unitIdentifier || "(unnamed)"}
          </div>
          <div style={{ fontSize: 9, color: "#546e7a" }}>
            {n.echelon || "—"}
            {n.children.length > 0 && <span style={{ marginLeft: 5, color: "#37474f" }}>{n.children.length} sub</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 10px", borderBottom: "1px solid #1e3a4a", flexShrink: 0, background: "#060e18" }}>
        <MilSymbolImg sidc={node.sidc} size={22} />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "#e0e0e0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.unitIdentifier || "(unnamed)"}
        </span>
        <button onClick={onCenter} title="Centre map on this unit" style={{ background: "none", border: "none", cursor: "pointer", color: "#4fc3f7", fontSize: 13, padding: "0 3px", lineHeight: 1 }}>⌖</button>
        <button onClick={onClose} title="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "#607d8b", fontSize: 13, padding: "0 2px", lineHeight: 1 }}>✕</button>
      </div>

      {/* ── Map camera controls ────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "7px 10px 6px", borderBottom: "1px solid #1a2b3c", flexShrink: 0, background: "#080f18" }}>
        {/* Row 1: Roll up + Break down (step-by-step) */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onRollUp}
            disabled={!canRollUp}
            title="Roll up: show parent level on map"
            style={{
              flex: 1, padding: "4px 0", border: "1px solid",
              borderColor: canRollUp ? "#37474f" : "#1a2b3c",
              borderRadius: 3, background: canRollUp ? "#1a2b3c" : "transparent",
              color: canRollUp ? "#90a4ae" : "#37474f",
              fontSize: 10, cursor: canRollUp ? "pointer" : "default", fontWeight: 700,
            }}
          >
            ▲ Roll up
          </button>
          <button
            onClick={onBreakDown}
            disabled={!canBreakDown}
            title="Break down: show immediate subordinates on map"
            style={{
              flex: 1, padding: "4px 0", border: "none",
              borderRadius: 3, background: canBreakDown ? "#1565C0" : "#0d1a2a",
              color: canBreakDown ? "#fff" : "#37474f",
              fontSize: 10, cursor: canBreakDown ? "pointer" : "default", fontWeight: 700,
            }}
          >
            ▼ Break down
          </button>
        </div>
        {/* Row 2: Expand all (full subtree) — glows when active */}
        <button
          onClick={onExpandAll}
          disabled={!canExpandAll}
          title={
            isExpandAllActive
              ? "All subordinates are shown — use ▲ Roll up to collapse"
              : "Expand all: show every unit in this subtree on the map at once"
          }
          style={{
            width: "100%", padding: "4px 0", border: "1px solid",
            borderColor: isExpandAllActive
              ? "#4fc3f7"
              : canExpandAll ? "rgba(79,195,247,0.4)" : "#1a2b3c",
            borderRadius: 3,
            background: isExpandAllActive
              ? "rgba(79,195,247,0.22)"
              : canExpandAll ? "rgba(79,195,247,0.12)" : "transparent",
            color: isExpandAllActive ? "#4fc3f7" : canExpandAll ? "#4fc3f7" : "#37474f",
            fontSize: 10, cursor: canExpandAll ? "pointer" : "default", fontWeight: 700,
            letterSpacing: "0.03em",
            boxShadow: isExpandAllActive ? "0 0 6px rgba(79,195,247,0.35)" : "none",
          }}
        >
          {isExpandAllActive ? "▼▼ All expanded" : "▼▼ Expand all"}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* ── Parent section ─────────────────────────────────────────────── */}
        <div style={{ padding: "5px 12px 2px", fontSize: 9, fontWeight: 700, color: "#546e7a", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Parent
        </div>
        {directParent ? (
          <ClickRow
            n={directParent}
            icon="▲"
            onClick={() => onSelectNode(directParent.id)}
          />
        ) : (
          <div style={{ padding: "5px 12px 6px", fontSize: 10, color: "#37474f", fontStyle: "italic" }}>
            Top of hierarchy
          </div>
        )}

        {/* ── Divider ────────────────────────────────────────────────────── */}
        <div style={{ height: 1, background: "#1e3a4a", margin: "3px 0" }} />

        {/* ── This unit (selected) ───────────────────────────────────────── */}
        <div style={{ padding: "5px 12px 2px", fontSize: 9, fontWeight: 700, color: "#4fc3f7", textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 6 }}>
          <span>Selected</span>
          {isMapFocus && (
            <span style={{ fontSize: 8, padding: "0 4px", borderRadius: 2, background: "rgba(79,195,247,0.15)", color: "#4fc3f7", border: "1px solid rgba(79,195,247,0.3)" }}>
              map level
            </span>
          )}
        </div>
        <div style={{ ...rowBase, background: "rgba(21,101,192,0.18)", borderLeft: "3px solid #4fc3f7" }}>
          <MilSymbolImg sidc={node.sidc} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#e0e0e0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.unitIdentifier || "(unnamed)"}
            </div>
            <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 2, flexWrap: "wrap" }}>
              {node.echelon && (
                <span style={{ fontSize: 9, padding: "0 5px", borderRadius: 2, background: "rgba(79,195,247,0.12)", color: "#4fc3f7", border: "1px solid rgba(79,195,247,0.25)" }}>
                  {node.echelon}
                </span>
              )}
              <span style={{ fontSize: 9, color: affColor }}>{node.affiliation}</span>
            </div>
          </div>
        </div>

        {/* ── Divider ────────────────────────────────────────────────────── */}
        <div style={{ height: 1, background: "#1e3a4a", margin: "3px 0" }} />

        {/* ── Children ──────────────────────────────────────────────────── */}
        <div style={{ padding: "5px 12px 2px", fontSize: 9, fontWeight: 700, color: "#546e7a", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Subordinates ({node.children.length})
        </div>
        {node.children.length === 0 ? (
          <div style={{ padding: "5px 12px 8px", fontSize: 10, color: "#37474f", fontStyle: "italic" }}>No subordinates</div>
        ) : (
          node.children.map((child) => (
            <ClickRow
              key={child.id}
              n={child}
              icon="▼"
              dim
              onClick={() => onSelectNode(child.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── CSE Validation section ────────────────────────────────────────────────────

function CseValidationSection({ cseErrors, cseStatus }: { cseErrors: CseValidationError[]; cseStatus: CseValidationStatus }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const blocking = cseErrors.filter((e) => !e.isWarning);
  const warnings = cseErrors.filter((e) => e.isWarning);

  const headerColor =
    cseStatus === "running" ? "#4fc3f7"
    : cseStatus === "error"   ? "#ffa198"
    : blocking.length > 0     ? "#ffa198"
    : warnings.length > 0     ? "#e3b341"
    : "#56d364";

  const statusLabel =
    cseStatus === "running" ? "⟳ Running…"
    : cseStatus === "error"   ? "✗ Call failed"
    : blocking.length > 0     ? `✗ ${blocking.length} error${blocking.length !== 1 ? "s" : ""}${warnings.length > 0 ? `, ${warnings.length} warn` : ""}`
    : warnings.length > 0     ? `⚠ ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}`
    : "✓ Passed";

  return (
    <div style={{ borderBottom: "1px solid #1e3a4a", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "5px 10px 4px" }}>
        <button onClick={() => setCollapsed((v) => !v)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#607d8b", fontSize: 9, padding: "0 3px 0 0" }}>
          {collapsed ? "▶" : "▼"}
        </button>
        <span style={{ fontSize: 9, fontWeight: 700, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.08em", flex: 1 }}>
          CSE Validation
        </span>
        <span style={{ fontSize: 9, color: headerColor, fontFamily: "monospace", flexShrink: 0 }}>{statusLabel}</span>
      </div>

      {!collapsed && (
        <div style={{ maxHeight: 240, overflowY: "auto" }}>
          {cseStatus === "running" && (
            <div style={{ padding: "8px 12px", color: "#607d8b", fontSize: 10, fontStyle: "italic" }}>Validating…</div>
          )}
          {cseStatus === "error" && (
            <div style={{ padding: "8px 12px", color: "#ffa198", fontSize: 10 }}>Validation call failed. Check console.</div>
          )}
          {cseStatus === "done" && cseErrors.length === 0 && (
            <div style={{ padding: "8px 12px", color: "#56d364", fontSize: 10 }}>All checks passed</div>
          )}
          {cseStatus === "done" && cseErrors.length > 0 && (
            <>
              {blocking.map((err, i) => (
                <div key={`e${i}`} style={{
                  padding: "6px 10px",
                  borderBottom: "1px solid #111a27",
                  borderLeft: "2px solid #f85149",
                  background: "#1a0c0c",
                }}>
                  {err.type && (
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#ffa198", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
                      {err.type}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "#ffa198", lineHeight: 1.4, wordBreak: "break-word", fontFamily: "monospace" }}>
                    {err.message ?? err.description ?? "(no message)"}
                  </div>
                  {err.path && (
                    <div style={{ fontSize: 9, color: "#607d8b", marginTop: 2, fontFamily: "monospace", wordBreak: "break-all" }}>
                      {err.path}
                    </div>
                  )}
                </div>
              ))}
              {warnings.map((warn, i) => (
                <div key={`w${i}`} style={{
                  padding: "6px 10px",
                  borderBottom: "1px solid #111a27",
                  borderLeft: "2px solid #d29922",
                  background: "#160f02",
                }}>
                  {warn.type && (
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#e3b341", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
                      {warn.type}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "#e3b341", lineHeight: 1.4, wordBreak: "break-word", fontFamily: "monospace" }}>
                    {warn.message ?? warn.description ?? "(no message)"}
                  </div>
                  {warn.path && (
                    <div style={{ fontSize: 9, color: "#607d8b", marginTop: 2, fontFamily: "monospace", wordBreak: "break-all" }}>
                      {warn.path}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add-to-map section ────────────────────────────────────────────────────────

const AFF_COLOURS: Record<string, string> = {
  "Friend": "#5B9BD5", "Hostile": "#E74C3C", "Neutral": "#27AE60",
  "Unknown": "#F1C40F", "Assumed Friend": "#9ab8d8", "Suspect": "#e07070",
};

// ── OnMapPanel ────────────────────────────────────────────────────────────────
// (SidebarTabs was removed — the Map Placement tab no longer has a Phases
// sub-tab. Phase groups live in the Hierarchy tab now.)

// ── OnMapChildRow — one node inside the expanded subordinate tree ────────────
function OnMapChildRow({
  node, depth, selectedId, onSelect, onCenter, hasSavedPosition,
}: {
  node: CompositionNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCenter: (id: string) => void;
  /** Whether this specific node has a saved offset in the positions map */
  hasSavedPosition: (id: string) => boolean;
}) {
  const [open, setOpen] = React.useState(depth < 1); // first level auto-open
  const [showInfo, setShowInfo] = React.useState(false);
  const hasChildren = node.children.length > 0;
  const isSel = node.id === selectedId;
  const hasLoc = hasSavedPosition(node.id);
  return (
    <div>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "3px 8px 3px",
          paddingLeft: 8 + depth * 14,
          cursor: "pointer",
          background: isSel ? "#1a3a5c" : "transparent",
          borderLeft: isSel ? "2px solid #4fc3f7" : "2px solid transparent",
        }}
        onClick={() => onSelect(node.id)}
        onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#0d1e2d"; }}
        onMouseLeave={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); if (hasChildren) setOpen((v) => !v); }}
          style={{
            width: 10, height: 10, flexShrink: 0,
            background: "none", border: "none",
            cursor: hasChildren ? "pointer" : "default",
            color: hasChildren ? "#607d8b" : "transparent",
            fontSize: 8, padding: 0, lineHeight: 1,
          }}
        >
          {hasChildren ? (open ? "▼" : "▶") : ""}
        </button>
        <MilSymbolImg sidc={node.sidc} size={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, color: isSel ? "#e0e0e0" : "#c8d0da",
            fontWeight: isSel ? 700 : 400,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {node.unitIdentifier || "(unnamed)"}
          </div>
          {node.echelon && (
            <div style={{ fontSize: 8, color: "#607d8b" }}>{node.echelon}</div>
          )}
        </div>

        {/* ── Right-side action cluster ────────────────────────────────── */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Location indicator — filled pin if the unit has a saved offset,
              outline pin otherwise. Serves as the "small icon that shows
              extra information". Clicking it toggles a details popover. */}
          <button
            onClick={(e) => { e.stopPropagation(); setShowInfo((v) => !v); }}
            title={hasLoc
              ? "Has explicit location — click for details"
              : "Auto-positioned (no saved location) — click for details"}
            style={{
              width: 14, height: 14, flexShrink: 0,
              background: "none", border: "none", cursor: "pointer",
              color: hasLoc ? "#66bb6a" : "#546e7a",
              fontSize: 11, padding: 0, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {hasLoc ? "●" : "○"}
          </button>

          {/* Centre-on-map — only when the unit has a resolvable position */}
          <button
            onClick={(e) => { e.stopPropagation(); onCenter(node.id); }}
            title="Centre map on this unit"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#4fc3f7", fontSize: 11, padding: "0 2px", lineHeight: 1,
            }}
          >⌖</button>

          {hasChildren && (
            <span style={{ fontSize: 8, color: "#607d8b" }}>{node.children.length}</span>
          )}
        </div>
      </div>

      {/* Info popover — a compact fact strip shown under the row */}
      {showInfo && (
        <div style={{
          margin: `0 6px 4px ${8 + depth * 14 + 20}px`,
          padding: "5px 8px",
          background: "#0a1a26",
          border: "1px solid #1e3a4a",
          borderRadius: 3,
          fontSize: 9,
          color: "#8a92a8",
          lineHeight: 1.5,
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          <div>
            <span style={{ color: "#607d8b" }}>Affiliation:</span>{" "}
            <span style={{ color: "#c8d0da" }}>{node.affiliation || "—"}</span>
          </div>
          <div>
            <span style={{ color: "#607d8b" }}>Type:</span>{" "}
            <span style={{ color: "#c8d0da" }}>{node.entityType}</span>
            {node.militaryService && (
              <>
                <span style={{ color: "#607d8b" }}> · </span>
                <span style={{ color: "#c8d0da" }}>{node.militaryService}</span>
              </>
            )}
          </div>
          <div>
            <span style={{ color: "#607d8b" }}>Location:</span>{" "}
            <span style={{ color: hasLoc ? "#66bb6a" : "#e3b341" }}>
              {hasLoc ? "explicit" : "auto-positioned"}
            </span>
          </div>
          {node.allegiance && (
            <div>
              <span style={{ color: "#607d8b" }}>Allegiance:</span>{" "}
              <span style={{ color: "#c8d0da" }}>{node.allegiance}</span>
            </div>
          )}
          {node.canonicalAssetKey && (
            <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ color: "#607d8b" }}>Asset:</span>{" "}
              <span style={{ color: "#c8d0da", fontFamily: "monospace", fontSize: 8 }}>
                {node.canonicalAssetKey}
              </span>
            </div>
          )}
        </div>
      )}

      {hasChildren && open && node.children.map((child) => (
        <OnMapChildRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onCenter={onCenter}
          hasSavedPosition={hasSavedPosition}
        />
      ))}
    </div>
  );
}

function OnMapPanel({
  roots, positions, placingRootId, selectedId,
  onPlace, onSelect, onRemove, onCenterTree, onCenterNode,
}: {
  roots: CompositionNode[];
  positions: NodePositionMap;
  placingRootId: string | null;
  selectedId: string | null;
  onPlace: (id: string) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onCenterTree: (root: CompositionNode) => void;
  /** Centre the map on a specific node (any depth in the tree). */
  onCenterNode: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  // Per-root "show subordinates" toggle. Auto-expand when a subordinate of
  // this root is currently selected so users can see where they are.
  const [expandedRoots, setExpandedRoots] = React.useState<Set<string>>(() => new Set());

  // Auto-expand a root if the selection lives inside its subtree.
  React.useEffect(() => {
    if (!selectedId) return;
    for (const root of roots) {
      if (root.id === selectedId) continue; // selecting the root itself doesn't force-open
      // Walk the tree looking for selectedId
      const findsSelection = (n: CompositionNode): boolean => {
        if (n.id === selectedId) return true;
        for (const c of n.children) if (findsSelection(c)) return true;
        return false;
      };
      if (findsSelection(root)) {
        setExpandedRoots((prev) => {
          if (prev.has(root.id)) return prev;
          const next = new Set(prev);
          next.add(root.id);
          return next;
        });
      }
    }
  }, [selectedId, roots]);

  return (
    <div style={{ borderBottom: "1px solid #1e3a4a", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "5px 10px 4px" }}>
        <button onClick={() => setCollapsed((v) => !v)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#607d8b", fontSize: 9, padding: "0 4px 0 0" }}>
          {collapsed ? "▶" : "▼"}
        </button>
        <span style={{ fontSize: 9, fontWeight: 700, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.08em", flex: 1 }}>
          On map ({roots.length})
        </span>
      </div>
      {!collapsed && roots.map((root) => {
        const isPlaced  = positions.has(root.id);
        const isPlacing = placingRootId === root.id;
        const isSel     = selectedId === root.id;
        const isExpanded = expandedRoots.has(root.id);
        const hasChildren = root.children.length > 0;

        const toggleExpanded = () => {
          setExpandedRoots((prev) => {
            const next = new Set(prev);
            if (next.has(root.id)) next.delete(root.id);
            else next.add(root.id);
            return next;
          });
        };

        return (
          <div key={root.id} style={{ borderBottom: "1px solid #0d1520" }}>
            {/* Root row */}
            <div
              onClick={() => onSelect(root.id)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", cursor: "pointer",
                background: isSel ? "#111e30" : "transparent",
                borderLeft: isSel ? "3px solid #4fc3f7" : "3px solid transparent" }}>
              {/* Expand/collapse toggle — only shown when placed and has children */}
              {hasChildren && isPlaced ? (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleExpanded(); }}
                  title={isExpanded ? "Hide subordinates" : "Show subordinates"}
                  style={{
                    width: 12, height: 12, flexShrink: 0,
                    background: "none", border: "none", cursor: "pointer",
                    color: "#607d8b", fontSize: 9, padding: 0, lineHeight: 1,
                  }}
                >
                  {isExpanded ? "▼" : "▶"}
                </button>
              ) : (
                <span style={{ width: 12, flexShrink: 0 }} />
              )}
              <MilSymbolImg sidc={root.sidc} size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#e0e0e0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{root.unitIdentifier || "(unnamed)"}</div>
                <div style={{ fontSize: 9, color: isPlaced ? "#56d364" : "#e3b341", marginTop: 1 }}>
                  {isPlacing ? "click map…" : isPlaced ? "placed" : "unplaced"}
                  {hasChildren && <span style={{ color: "#607d8b", marginLeft: 4 }}>· {root.children.length} sub</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 3, flexShrink: 0, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                {isPlaced && (
                  <button onClick={() => onCenterTree(root)} title="Centre" style={{ background: "none", border: "none", cursor: "pointer", color: "#4fc3f7", fontSize: 13, padding: "0 1px" }}>⌖</button>
                )}
                <button onClick={() => onPlace(root.id)}
                  style={{ padding: "2px 6px", background: isPlacing ? "#e65100" : isPlaced ? "#1a2b3c" : "#1565C0",
                    border: isPlaced && !isPlacing ? "1px solid #1e3a4a" : "none", borderRadius: 3,
                    color: isPlacing ? "#fff" : isPlaced ? "#90a4ae" : "#fff", fontSize: 9, cursor: "pointer", fontWeight: 600 }}>
                  {isPlacing ? "Cancel" : isPlaced ? "Move" : "Place"}
                </button>
                <button onClick={() => onRemove(root.id)} title="Remove" style={{ background: "none", border: "none", cursor: "pointer", color: "#607d8b", fontSize: 13, padding: "0 1px" }}>✕</button>
              </div>
            </div>

            {/* Expanded subordinate tree */}
            {isPlaced && isExpanded && hasChildren && (
              <div style={{ background: "#08111d", borderTop: "1px solid #0d1520", paddingTop: 2, paddingBottom: 3 }}>
                {root.children.map((child) => (
                  <OnMapChildRow
                    key={child.id}
                    node={child}
                    depth={0}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onCenter={onCenterNode}
                    hasSavedPosition={(id) => positions.has(id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


/** Determine whether an item is friendly, hostile, or unknown by affiliation. */
function mapItemSide(aff: string): "allied" | "hostile" | "unknown" {
  const a = (aff || "").trim();
  if (a === "Hostile" || a === "Suspect") return "hostile";
  if (a === "Friend" || a === "Assumed Friend" || a === "Neutral") return "allied";
  return "unknown";
}

const SIDE_LABEL_MAP: Record<string, string> = {
  allied:  "🔵 Friendly Forces",
  hostile: "🔴 Enemy Forces",
  unknown: "Unknown Forces",
};
const SIDE_COLOUR_MAP: Record<string, string> = {
  allied:  "#5B9BD5",
  hostile: "#E74C3C",
  unknown: "#F1C40F",
};

function AddToMapSection({
  availableItems,
  placedRootIds,
  onAdd,
}: {
  availableItems: MapAvailableItem[];
  placedRootIds: Set<string>;
  onAdd: (item: MapAvailableItem) => void;
}) {
  const [search, setSearch]     = React.useState("");
  const [collapsed, setCollapsed] = React.useState(false);
  /** compact = one friendly + one hostile; all = every item grouped by side */
  const [viewMode, setViewMode] = React.useState<"compact" | "all">("compact");

  const q = search.trim().toLowerCase();
  const searchFiltered = availableItems.filter((i) =>
    !q || i.name.toLowerCase().includes(q) || i.affiliation.toLowerCase().includes(q),
  );

  // ── Compact: first allied + first hostile ────────────────────────────────
  const compactItems = (() => {
    let friendly: MapAvailableItem | null = null;
    let hostile:  MapAvailableItem | null = null;
    for (const i of searchFiltered) {
      const s = mapItemSide(i.affiliation);
      if (s === "allied"  && !friendly) friendly = i;
      if (s === "hostile" && !hostile)  hostile  = i;
      if (friendly && hostile) break;
    }
    if (!friendly && searchFiltered.length > 0) friendly = searchFiltered[0];
    if (!hostile  && searchFiltered.length > 1) hostile  = searchFiltered[1];
    return [friendly, hostile].filter((i): i is MapAvailableItem => i !== null);
  })();

  // ── All: grouped by side ─────────────────────────────────────────────────
  const allGroups = (() => {
    const map = new Map<string, MapAvailableItem[]>([
      ["allied", []], ["hostile", []], ["unknown", []],
    ]);
    for (const i of searchFiltered) map.get(mapItemSide(i.affiliation))!.push(i);
    return (["allied", "hostile", "unknown"] as const)
      .map((side) => ({ side, items: map.get(side)! }))
      .filter((g) => g.items.length > 0);
  })();

  const visibleItems = viewMode === "compact" ? compactItems : searchFiltered;
  const hiddenCount  = searchFiltered.length - compactItems.length;

  const renderItem = (item: MapAvailableItem) => {
    const alreadyOnMap = placedRootIds.has(item.id);
    const affColor = AFF_COLOURS[item.affiliation] ?? "#607d8b";
    return (
      <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6,
        padding: "5px 10px", borderBottom: "1px solid #111a27" }}>
        <MilSymbolImg sidc={item.sidc} size={22} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "#e0e0e0", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
            {item.name}
          </div>
          <div style={{ fontSize: 9, display: "flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: affColor }}>{item.affiliation}</span>
            <span style={{ color: "#607d8b" }}>·</span>
            <span style={{ color: "#607d8b" }}>{item.echelon || "—"}</span>
            <span style={{ color: "#607d8b" }}>·</span>
            <span style={{ color: "#607d8b" }}>{item.nodeCount} nodes</span>
          </div>
        </div>
        {alreadyOnMap ? (
          // Already on map — show a dimmed "On map" label instead of blocking
          // the button, so the user can see the status at a glance.
          <span style={{ fontSize: 9, color: "#56d364", flexShrink: 0, padding: "2px 4px",
            background: "rgba(86,211,100,0.10)", border: "1px solid rgba(86,211,100,0.25)",
            borderRadius: 3, whiteSpace: "nowrap" }}>
            ✓ On map
          </span>
        ) : (
          <button onClick={() => onAdd(item)}
            title={`Add ${item.name} to map`}
            style={{ padding: "2px 8px", background: "#1565C0", border: "none",
              borderRadius: 3, color: "#fff", fontSize: 9, cursor: "pointer",
              fontWeight: 600, flexShrink: 0 }}>
            + Add
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ borderBottom: "1px solid #1e3a4a", flexShrink: 0 }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", padding: "5px 10px 4px" }}>
        <button onClick={() => setCollapsed((v) => !v)}
          style={{ background: "none", border: "none", cursor: "pointer",
            color: "#607d8b", fontSize: 9, padding: "0 3px 0 0" }}>
          {collapsed ? "▶" : "▼"}
        </button>
        <span style={{ fontSize: 9, fontWeight: 700, color: "#607d8b",
          textTransform: "uppercase", letterSpacing: "0.08em", flex: 1 }}>
          Forces ({viewMode === "compact" ? `${compactItems.length} shown` : searchFiltered.length})
        </span>
      </div>

      {!collapsed && (
        <>
          {/* View-mode toggle */}
          <div style={{ padding: "3px 8px 4px", display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ display: "flex", flex: 1, background: "#0d1b2a",
              border: "1px solid #1e3a4a", borderRadius: 3, overflow: "hidden" }}>
              <button
                onClick={() => setViewMode("compact")}
                title="Show one friendly and one enemy force"
                style={{ flex: 1, padding: "3px 0", border: "none", cursor: "pointer",
                  fontSize: 8, fontWeight: 700, letterSpacing: "0.04em",
                  background: viewMode === "compact" ? "#1565C0" : "transparent",
                  color:      viewMode === "compact" ? "#fff" : "#607d8b" }}>
                ⬡ FORCES
              </button>
              <div style={{ width: 1, background: "#1e3a4a", flexShrink: 0 }} />
              <button
                onClick={() => setViewMode("all")}
                title="Show all phase ORBATs grouped by side"
                style={{ flex: 1, padding: "3px 0", border: "none", cursor: "pointer",
                  fontSize: 8, fontWeight: 700, letterSpacing: "0.04em",
                  background: viewMode === "all" ? "#4a4f78" : "transparent",
                  color:      viewMode === "all" ? "#fff" : "#607d8b" }}>
                ≡ ALL PHASES
              </button>
            </div>
            {viewMode === "compact" && hiddenCount > 0 && (
              <button
                onClick={() => setViewMode("all")}
                title={`${hiddenCount} more force${hiddenCount !== 1 ? "s" : ""} hidden — click to show all`}
                style={{ flexShrink: 0, padding: "2px 6px",
                  background: "rgba(121,134,203,0.15)",
                  border: "1px solid rgba(121,134,203,0.35)",
                  borderRadius: 3, color: "#9fa8da",
                  fontSize: 8, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                +{hiddenCount} hidden
              </button>
            )}
          </div>

          {/* Search */}
          <div style={{ padding: "0 8px 4px" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search forces…"
              style={{ width: "100%", padding: "3px 6px", background: "#1a2b3c",
                border: "1px solid #2a4a5a", borderRadius: 2, color: "#e0e0e0",
                fontSize: 10, outline: "none", boxSizing: "border-box" as const }} />
          </div>

          {/* List */}
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {searchFiltered.length === 0 && (
              <div style={{ padding: "8px 12px", color: "#607d8b", fontSize: 10, fontStyle: "italic" }}>
                {availableItems.length === 0 ? "No forces loaded." : "No results."}
              </div>
            )}

            {viewMode === "compact" && visibleItems.map(renderItem)}

            {viewMode === "all" && allGroups.map((group) => {
              const sideColour = SIDE_COLOUR_MAP[group.side] ?? "#607d8b";
              const sideLabel  = SIDE_LABEL_MAP[group.side]  ?? group.side;
              return (
                <React.Fragment key={group.side}>
                  {/* Side header */}
                  <div style={{ padding: "4px 10px 3px",
                    fontSize: 8, fontWeight: 700, letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: sideColour,
                    background: `${sideColour}18`,
                    borderLeft: `3px solid ${sideColour}`,
                    borderBottom: "1px solid #111a27",
                    position: "sticky", top: 0, zIndex: 1 }}>
                    {sideLabel}
                    <span style={{ marginLeft: 5, fontSize: 7, fontWeight: 400, opacity: 0.7 }}>
                      ({group.items.length})
                    </span>
                  </div>
                  {group.items.map(renderItem)}
                </React.Fragment>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
