// src/map/ScenarioPlanning/types.ts
// Shared types for the Scenario Planning widget.
// Re-exports from the unified shared/types module.
// Kept for backward-compatibility with components that import from here.
export type {
  PhaseStatus,
  Phase,
  ExerciseMeta,
  MapUnit,
  MovementArrow,
  Objective,
  Operation,
  DrawingTool,
  ArrowDraft,
  AssetCatalogueItem,
  UnitAffiliation,
} from "./shared/types";

// Legacy local-only types (still used by MapWrapper if needed)
// Extended PlacedUnit that carries phase membership & colour.
// Extends the existing scenarioPlanning PlacedUnit shape so
// ScenarioMap can remain backward-compatible.
export interface ScenarioPlacedUnit {
  id: string;
  templateId: string;
  label: string;
  sidc: string;
  lat: number;
  lng: number;
  phaseId?: string;
  phaseColour?: string;
}

export interface PlacedArrow {
  id: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  phaseId?: string;
  phaseColour?: string;
}

export interface PlacedObjective {
  id: string;
  lat: number;
  lng: number;
  name: string;
  phaseId?: string;
  phaseColour?: string;
}

export type MapTool = "select" | "placeUnit" | "drawArrow" | "placeObjective";

