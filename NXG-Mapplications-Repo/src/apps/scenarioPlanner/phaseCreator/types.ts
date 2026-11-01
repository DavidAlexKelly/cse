// src/apps/scenarioPlanner/phaseCreator/types.ts
//
// Types for the Phase Creator (v3 — sidebar-driven flow):
//   1. The planner lays out the ORBAT on the map.
//   2. "Generate Orders"    → AIP Logic `nxgGenerateOrders`.
//   3. "Generate End State" → AIP Logic `nxgGeneratePhaseMap`, pre-resolved by
//      the deterministic engine in `resolveOrders.ts`.
//
// The v2 draft-wizard state machine (SEED → DRAFT_REVIEW → MAP_REVIEW →
// COMMIT) and its output types were removed along with the unreachable
// PhaseCreatorDrawer / orchestrator / usePhaseDraft / draftStore /
// buildContext / commitToOntology modules.
import type { OrderResolution } from "./resolveOrders";

// ─── LLM objective output ───────────────────────────────────────────────────
// Shared by nxgGenerateOrders (newObjectives) and nxgGeneratePhaseMap.
export interface MapObjectiveOutput {
  id: string;
  name: string;
  lat: number;
  lng: number;
  colour: string;
}

// ─── Map state types ────────────────────────────────────────────────────────
export interface MapUnitPlacement {
  id: string;
  templateId?: string;
  label: string;
  sidc: string;
  lat: number;
  lng: number;
  role?: string;
  force?: "blue" | "red";
  // ── ORBAT linkage ──────────────────────────────────────────────────────────
  // A placed unit is the ROOT of a real ORBAT graph held in the ontology as
  // NxgUnit nodes + NxgUnitHierachyEdge edges — not a template blob. These two
  // keys are the link, and they persist inside
  // NxgPhaseMapState.startStateMapJson alongside the position, so the ORBAT
  // survives reloads and follows the unit when a phase inherits it.
  //
  // Absent → this placement has no ORBAT yet, and the map shows a red "!".
  /** primaryKey of the root NxgUnit of this placement's ORBAT. */
  orbatRootUnitKey?: string;
  /** primaryKey of the NxgUnitHierarchy holding it (one per side per scenario). */
  orbatHierarchyKey?: string;
  /**
   * True when the ORBAT is the auto-generated BASIC one (created from the unit
   * type when the unit was placed) rather than one a planner has defined and
   * saved. Drives the yellow "using basic ORBAT" badge on the map.
   */
  orbatIsBasic?: boolean;
  /**
   * Parent chosen explicitly by the planner, overriding the one the reconciler
   * would derive from echelon (see shared/orbat/hierarchy.ts).
   *
   * Persisted with the placement so the choice survives a reload and is not
   * quietly undone the next time the hierarchy is rebuilt. Absent → derived.
   */
  orbatParentUnitKey?: string;
}

export interface MapArrowPlacement {
  id: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  colour: string;
  lineStyle?: "solid" | "dashed" | "dotted" | "double" | "zigzag" | "blocky";
  endpointStyle?: "none" | "arrow" | "arrow-filled" | "circle" | "square" | "bar";
  label?: string;
  /** APP-6 tactical graphic label (e.g. "Breach") — set when drawn from the Map
   * Items palette. */
  tacticLabel?: string;
  /** @acc/app6d's synthetic renderer key for the drawn graphic
   * (e.g. "SVGOCCUPY"). NOT a real SIDC — see shared/docSidc.ts for that. */
  tacticSidc?: string;
  /** Real doctrinal APP-6D / MIL-STD-2525 SIDC for this task (e.g.
   * "GFTPO---------G"), resolved from tacticLabel via the library's
   * doctrinal task catalog. May be undefined for pure control-measure
   * graphics or visual variants with no single canonical doctrinal code. */
  docSidc?: string;
  /** Per-arrow scale multiplier for tactic graphics (default 1.0). */
  milxScale?: number;
  /** The unit tasked with executing this order. Required for resolveOrders(). */
  assignedUnitId?: string;
  /** Optional id of a MapObjectivePlacement this order targets. */
  targetObjectiveId?: string;
  // ── Terrain-routed order fields ────────────────────────────────────────────
  // Populated for orders whose path was computed on the terrain grid (manual
  // terrain orders and AI orders that passed through the reachability check).
  // Lets the map draw the real route instead of a straight line.
  /** Route polyline as [lat, lng] pairs. */
  routeWaypoints?: [number, number][];
  /** Route length in km over the terrain. */
  routeDistanceKm?: number;
  /** Route travel time in seconds for the assigned unit's mobility class. */
  routeDurationSec?: number;
  /** True when the destination was validated against the terrain grid. */
  isTerrainRouted?: boolean;
}

export interface MapObjectivePlacement {
  id: string;
  lat: number;
  lng: number;
  name: string;
  colour: string;
}

export interface MapPhaseState {
  units: MapUnitPlacement[];
  arrows: MapArrowPlacement[];
  objectives: MapObjectivePlacement[];
}

/** Resolved end state for a phase (see resolveOrders.resolveToEndState). */
export interface PhaseMapEndState {
  units: MapUnitPlacement[];
  objectives: MapObjectivePlacement[];
  resolutions: OrderResolution[];
}

// ─── Order types (v3 — sidebar-driven generate-orders / generate-end-state) ─
export interface UnitOrder {
  unitId: string;
  taskName: string;
  toLat: number;
  toLng: number;
  targetObjectiveId: string;
  rationale: string;
}
export interface GenerateOrdersOutput {
  orders: UnitOrder[];
  newObjectives: MapObjectiveOutput[];
  summary: string;
}
export interface EndStateUnit {
  unitId: string;
  label: string;
  sidc: string;
  force: "blue" | "red";
  lat: number;
  lng: number;
  status: "operational" | "degraded" | "combat-ineffective" | "destroyed";
  resolution: string;
}
export interface EndStateEngagement {
  location: { lat: number; lng: number };
  blueUnits: string[];
  redUnits: string[];
  outcome: "blue-favoured" | "even" | "red-favoured";
  description: string;
}
export interface GenerateEndStateOutput {
  units: EndStateUnit[];
  objectives: MapObjectiveOutput[];
  engagements: EndStateEngagement[];
  summary: string;
}


