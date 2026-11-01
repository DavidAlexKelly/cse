// src/map/ScenarioPlanning/components/MapWrapper/MapWrapper.tsx
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  forwardRef,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { ScenarioMap } from "../../map/ScenarioMap";
import type { PlacedArrow, PlacedObjective } from "../../map/ScenarioMap";
// ── Terrain-aware routing ──────────────────────────────────────────────────
import { DEFAULT_TERRAIN, type TerrainDatasets } from "../../../../shared/routing/terrainDatasets";
import { useRouter } from "../../../../shared/routing/useRouter";
import { useTerrainRaster } from "../../../../shared/routing/useTerrainRaster";
import { foundryFileClient } from "../../../../shared/routing/foundryFileClient";
import type { PlacedUnit, UnitTemplate } from "../../map/types";
import { withAffiliation } from "../../map/unitTemplates";
import { getPhaseColour } from "../../shared/phaseColours";
import { MapContextMenu } from "../MapContextMenu/MapContextMenu";
import type { ArrowStyle } from "../MapItemSidebar/MapItemSidebar";
import { isMilxOrder, milxFromForAnchorClick } from "@acc/app6d/core";
import { APP_CATALOG } from "../../shared/appCatalog";
import { OrderAssignmentPanel } from "../OrderAssignmentPanel/OrderAssignmentPanel";
import type {
  MapArrowPlacement,
  MapObjectivePlacement,
  MapPhaseState,
  MapUnitPlacement,
} from "../../phaseCreator/types";
import { resolveOrders } from "../../phaseCreator/resolveOrders";
import { useOrderPlacementStore } from "../../store/useOrderPlacementStore";

interface Props {
  selectedPhaseIndex: number;
  selectedPhaseId: string | null;
  onSelectPhase: (phaseId: string) => void;
  onOpenTimeline?: () => void;
  readOnly?: boolean;
  phaseDurationHours?: number;
  previewMap?: MapPhaseState | null;
  onPreviewMapEdit?: (next: MapPhaseState) => void;
  /**
   * Fired (debounced) whenever the ORBAT for a phase changes — a unit is
   * placed / moved / removed / edited, an arrow is drawn or assigned, an
   * objective is added, etc.
   *
   * The App layer uses this to persist the phase's start state back to the
   * [NXG-P] Phase Map State ontology object so map edits survive a reload.
   * Not fired in preview mode or when `readOnly` is set.
   */
  onPhaseMapEdited?: (phaseId: string, state: MapPhaseState) => void;
  /** Debounce window (ms) applied before `onPhaseMapEdited` fires. */
  editDebounceMs?: number;
  /**
   * Fired from a unit's right-click menu to define (or edit) the ORBAT graph
   * rooted at that placement. Omit to hide the menu item.
   */
  onDefineOrbat?: (unit: PlacedUnit) => void;
  /**
   * Fires when the map selection changes, so the right-hand bar can show the
   * selected unit's ORBAT. Null when the selection is cleared.
   */
  onSelectedUnitChange?: (unit: PlacedUnit | null) => void;
  /**
   * Fired when a NEW unit is placed on the map (palette or right-click menu).
   * The App layer uses this to create the unit's basic ORBAT in the ontology.
   * Not fired for units that arrive via applyPhaseMapState (ontology loads,
   * phase inheritance, clones) — those already have an ORBAT.
   */
  onUnitPlaced?: (unit: PlacedUnit) => void;
  /**
   * Terrain the scenario is fought on — the cost raster and pathfinding graph
   * to route against. Defaults to the default scenario's; see
   * shared/routing/terrainDatasets.ts.
   */
  terrain?: TerrainDatasets;
}

export interface MapWrapperHandle {
  clonePhaseItems: (
    sourcePhaseId: string,
    newPhaseId: string,
    newPhaseIndex: number,
  ) => void;

  readPhaseMapState: (phaseId: string) => MapPhaseState;
  /**
   * Attach an ORBAT graph to a placed unit (clears its "no ORBAT" badge).
   * Called by the App layer once the graph has been written to the ontology.
   */
  setUnitOrbat: (
    unitId: string,
    keys: {
      orbatRootUnitKey: string;
      orbatHierarchyKey: string;
      /** True for the auto-generated basic ORBAT. */
      orbatIsBasic?: boolean;
    },
  ) => void;
  /**
   * Override (or clear, with null) the parent the reconciler would derive for
   * a placement. Applies to every phase the unit appears in — a unit has one
   * place in the force, not one per phase.
   */
  setUnitParent: (unitId: string, parentUnitKey: string | null) => void;
  applyPhaseMapState: (
    phaseId: string,
    state: MapPhaseState,
    phaseIndex: number,
  ) => void;
  deletePhaseItems: (phaseId: string) => void;
}

type MapTool = "select" | "placeUnit" | "drawArrow" | "placeMilx" | "placeObjective" | "eraser" | "assignOrder";

interface PhaseUnit extends PlacedUnit {
  phaseId?: string;
  phaseColour?: string;
}

type ObjectivePending = { lat: number; lng: number } | null;

// Trimmed-down view of a PlacedArrow that MapPhaseState's arrow list
// actually carries. Kept in one place so the preview-mode arrow payload
// built in `finishArrow` below can't drift out of sync with the
// MapArrowPlacement shape. NOTE: preview-mode arrows have never carried
// tacticSidc/tacticLabel/docSidc — this is intentional and unchanged; the
// Phase Creator's MAP_REVIEW preview only needs geometry + style, not
// doctrinal metadata.
type PreviewArrowPayload = Pick<
  MapArrowPlacement,
  "id" | "fromLat" | "fromLng" | "toLat" | "toLng" | "colour" | "lineStyle" | "endpointStyle"
>;

function computeEndState(
  units: PhaseUnit[],
  arrows: PlacedArrow[],
  objectives: PlacedObjective[],
  durationHours: number,
): { units: PhaseUnit[]; objectives: PlacedObjective[] } {
  const mapUnits: MapUnitPlacement[] = units.map((u) => ({
    id: u.id,
    templateId: u.templateId,
    label: u.label,
    sidc: u.sidc,
    lat: u.lat,
    lng: u.lng,
    force: u.sidc[1] === "H" ? ("red" as const) : ("blue" as const),
  }));
  const mapArrows: MapArrowPlacement[] = arrows.map((a) => ({
    id: a.id,
    fromLat: a.fromLat,
    fromLng: a.fromLng,
    toLat: a.toLat,
    toLng: a.toLng,
    colour: a.colour,
    lineStyle: a.lineStyle,
    endpointStyle: a.endpointStyle,
    tacticSidc: a.tacticSidc,
    tacticLabel: a.tacticLabel,
    docSidc: a.docSidc,
    assignedUnitId: a.assignedUnitId,
    targetObjectiveId: a.targetObjectiveId,
    label: a.tacticLabel,
  }));
  const mapObjectives: MapObjectivePlacement[] = objectives.map((o) => ({
    id: o.id,
    lat: o.lat,
    lng: o.lng,
    name: o.name,
    colour: o.colour,
  }));
  const resolutions = resolveOrders(mapUnits, mapArrows, mapObjectives, durationHours);

  const unitPositions = new Map<string, { lat: number; lng: number }>();
  for (const r of resolutions) {
    if (!r.assignedUnitId) continue;
    const arrow = arrows.find((a) => a.id === r.orderId);
    if (!arrow) continue;
    const unit = units.find((u) => u.id === r.assignedUnitId);
    if (!unit) continue;
    const targetObj = arrow.targetObjectiveId
      ? objectives.find((o) => o.id === arrow.targetObjectiveId)
      : undefined;
    const target = targetObj
      ? { lat: targetObj.lat, lng: targetObj.lng }
      : { lat: arrow.toLat, lng: arrow.toLng };
    if (r.feasibility === "achieved") {
      unitPositions.set(r.assignedUnitId, target);
    } else if (r.feasibility === "partial" && r.etaHours && r.etaHours > 0) {
      const progress = Math.min(1, durationHours / r.etaHours);
      unitPositions.set(r.assignedUnitId, {
        lat: unit.lat + (target.lat - unit.lat) * progress,
        lng: unit.lng + (target.lng - unit.lng) * progress,
      });
    }
  }
  const resolvedUnits: PhaseUnit[] = units.map((u) => {
    const newPos = unitPositions.get(u.id);
    return newPos ? { ...u, lat: newPos.lat, lng: newPos.lng } : u;
  });
  return { units: resolvedUnits, objectives };
}

const INITIAL_UNITS: PhaseUnit[] = [];
const INITIAL_ARROWS: PlacedArrow[] = [];
const INITIAL_OBJECTIVES: PlacedObjective[] = [];

export const MapWrapper = forwardRef<MapWrapperHandle, Props>(function MapWrapper({
  selectedPhaseIndex,
  selectedPhaseId,
  onSelectPhase,
  onOpenTimeline,
  readOnly,
  phaseDurationHours = 48,
  previewMap,
  onPreviewMapEdit,
  onPhaseMapEdited,
  editDebounceMs = 1500,
  onDefineOrbat,
  onSelectedUnitChange,
  onUnitPlaced,
  terrain = DEFAULT_TERRAIN,
}, ref) {
  // ── Terrain-aware router (singleton, initialised once) ──────────────────
  // The file client is shared with the App layer (which needs the same raster
  // singleton to validate AI-generated orders) — see shared/routing.
  const { router: terrainRouter, isReady: routerReady } = useRouter(
    foundryFileClient,
    terrain.routingRid,
  );
  const { raster: terrainRaster } = useTerrainRaster(foundryFileClient, terrain.rasterRid);

  const [activeTool, setActiveTool] = useState<MapTool>("select");
  const activeToolRef = useRef<MapTool>("select");
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  const [viewMode, setViewMode] = useState<"planning" | "resolved">("planning");

  const [selectedOrderArrow, setSelectedOrderArrow] = useState<PlacedArrow | null>(null);
  const [orderPanelAnchor, setOrderPanelAnchor] = useState<{ x: number; y: number } | null>(null);

  const [affiliation, setAffiliation] = useState<"friend" | "hostile">("friend");
  const affiliationRef = useRef<"friend" | "hostile">("friend");
  useEffect(() => { affiliationRef.current = affiliation; }, [affiliation]);
  const _handleToggleAffiliation = useCallback(() => {
    setAffiliation((prev) => (prev === "friend" ? "hostile" : "friend"));
  }, []);
  void _handleToggleAffiliation;

  const [placedUnits, setPlacedUnits] = useState<PhaseUnit[]>(INITIAL_UNITS);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [placingTemplate, setPlacingTemplate] = useState<UnitTemplate | null>(null);

  // ── Right-click context menu state ──────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ lat: number; lng: number; screenX: number; screenY: number } | null>(null);

  const handleMapContextMenu = useCallback((lat: number, lng: number, screenX: number, screenY: number) => {
    if (readOnly) return;
    setContextMenu({ lat, lng, screenX, screenY });
  }, [readOnly]);

  const handleContextPlaceUnit = useCallback((template: UnitTemplate, lat: number, lng: number) => {
    const sidcWithAff = withAffiliation(template.sidc, affiliationRef.current);
    const unit: PhaseUnit = {
      id: uuidv4(),
      templateId: template.id,
      label: template.label,
      sidc: sidcWithAff,
      lat,
      lng,
      phaseId: selectedPhaseIdRef.current ?? undefined,
      phaseColour: phaseColourRef.current,
    };
    setPlacedUnits((prev) => [...prev, unit]);
    setSelectedUnitId(unit.id);
    onUnitPlacedRef.current?.(unit);
  }, []);

  const handleContextPlaceDrawing = useCallback((style: ArrowStyle, lat: number, lng: number) => {
    const id = uuidv4();
    const colour = phaseColourRef.current;
    // For milx-style graphics, place as a single-point graphic
    const newArrow: PlacedArrow = {
      id,
      fromLat: lat,
      fromLng: lng,
      toLat: lat,
      toLng: lng,
      colour,
      lineStyle: style.line,
      endpointStyle: style.endpoint,
      tacticSidc: style.tacticSidc,
      tacticLabel: style.tacticLabel,
      docSidc: style.docSidc,
      phaseId: selectedPhaseIdRef.current ?? undefined,
    };
    setArrows((prev) => [...prev, newArrow]);
  }, []);
  const [arrows, setArrows] = useState<PlacedArrow[]>(INITIAL_ARROWS);
  const arrowStartRef = useRef<{ lat: number; lng: number } | null>(null);
  const [arrowDrawing, setArrowDrawing] = useState(false);
  const arrowDrawingRef = useRef(false);
  useEffect(() => { arrowDrawingRef.current = arrowDrawing; }, [arrowDrawing]);
  const arrowFromUnitIdRef = useRef<string | null>(null);
  const [arrowStyle, _setArrowStyle] = useState<ArrowStyle>({ line: "solid", endpoint: "arrow-filled" });
  void _setArrowStyle;
  const arrowStyleRef = useRef<ArrowStyle>({ line: "solid", endpoint: "arrow-filled" });
  useEffect(() => { arrowStyleRef.current = arrowStyle; }, [arrowStyle]);

  const [objectives, setObjectives] = useState<PlacedObjective[]>(INITIAL_OBJECTIVES);
  const [pendingObjective, setPendingObjective] = useState<ObjectivePending>(null);
  const [objectiveName, setObjectiveName] = useState("");
  const phaseColour = selectedPhaseId ? getPhaseColour(selectedPhaseIndex) : "#4a90d9";
  const phaseColourRef = useRef(phaseColour);
  useEffect(() => { phaseColourRef.current = phaseColour; }, [phaseColour]);
  const selectedPhaseIdRef = useRef(selectedPhaseId);
  useEffect(() => { selectedPhaseIdRef.current = selectedPhaseId; }, [selectedPhaseId]);

  const placedUnitsRef = useRef(placedUnits);
  const arrowsRef = useRef(arrows);
  const objectivesRef = useRef(objectives);
  useEffect(() => { placedUnitsRef.current = placedUnits; }, [placedUnits]);
  useEffect(() => { arrowsRef.current = arrows; }, [arrows]);
  useEffect(() => { objectivesRef.current = objectives; }, [objectives]);

  // ── Phase-scoped snapshot ─────────────────────────────────────────────
  // Single source of truth for "what does this phase's map look like right
  // now". Used by the imperative handle (readPhaseMapState) AND by the edit
  // notifier below, so the persisted state can never drift from what the
  // COMPOSITION tab / publish pipeline sees.
  const buildPhaseMapState = useCallback((phaseId: string): MapPhaseState => {
    const units: MapUnitPlacement[] = placedUnitsRef.current
      .filter((u) => u.phaseId === phaseId)
      .map((u) => ({
        id: u.id,
        templateId: u.templateId,
        label: u.label,
        sidc: u.sidc,
        lat: u.lat,
        lng: u.lng,
        force: u.sidc[1] === "H" ? "red" : "blue",
        // ORBAT link travels with the placement so it is persisted and can be
        // inherited by later phases.
        orbatRootUnitKey: u.orbatRootUnitKey,
        orbatHierarchyKey: u.orbatHierarchyKey,
        orbatIsBasic: u.orbatIsBasic,
        orbatParentUnitKey: u.orbatParentUnitKey,
      }));
    const outArrows: MapArrowPlacement[] = arrowsRef.current
      .filter((a) => a.phaseId === phaseId)
      .map((a) => ({
        id: a.id,
        fromLat: a.fromLat,
        fromLng: a.fromLng,
        toLat: a.toLat,
        toLng: a.toLng,
        colour: a.colour,
        lineStyle: a.lineStyle,
        endpointStyle: a.endpointStyle,
        tacticSidc: a.tacticSidc,
        tacticLabel: a.tacticLabel,
        docSidc: a.docSidc,
        milxScale: a.milxScale,
        assignedUnitId: a.assignedUnitId,
        targetObjectiveId: a.targetObjectiveId,
      }));
    const outObjectives: MapObjectivePlacement[] = objectivesRef.current
      .filter((o) => o.phaseId === phaseId)
      .map((o) => ({
        id: o.id,
        lat: o.lat,
        lng: o.lng,
        name: o.name,
        colour: o.colour,
      }));
    return { units, arrows: outArrows, objectives: outObjectives };
  }, []);

  // ── Debounced edit notification ───────────────────────────────────────
  // Previously the app had no way of knowing the map had changed, so start
  // states were never written back to the ontology. Now every mutation of
  // units / arrows / objectives schedules a single debounced callback with
  // the phase's full snapshot.
  const onUnitPlacedRef = useRef(onUnitPlaced);
  useEffect(() => { onUnitPlacedRef.current = onUnitPlaced; }, [onUnitPlaced]);
  const onPhaseMapEditedRef = useRef(onPhaseMapEdited);
  useEffect(() => { onPhaseMapEditedRef.current = onPhaseMapEdited; }, [onPhaseMapEdited]);
  /** Last snapshot we notified for (per phase) — dedupes no-op re-renders. */
  const lastNotifiedRef = useRef<Map<string, string>>(new Map());
  /** Phases whose next change came from the app, not the user. */
  const suppressedPhasesRef = useRef<Set<string>>(new Set());
  /**
   * Pending debounce timer per phase. Keyed by phaseId (rather than a single
   * timer) so switching phase mid-edit can't cancel an unsaved write for the
   * phase the planner just left.
   */
  const editTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clear any pending timers on unmount (don't fire — the component is gone).
  useEffect(() => () => {
    for (const t of editTimersRef.current.values()) clearTimeout(t);
    editTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (readOnly || previewMap || !selectedPhaseId) return;
    if (!onPhaseMapEditedRef.current) return;

    const phaseId = selectedPhaseId;
    const snapshot = buildPhaseMapState(phaseId);
    const signature = JSON.stringify(snapshot);

    // Nothing actually changed for this phase.
    if (lastNotifiedRef.current.get(phaseId) === signature) return;

    // ── Never persist an "empty" state we were never given ────────────────
    // On mount (and while the ontology fetch is in flight) the map legitimately
    // holds no items for the phase. Writing that snapshot would overwrite the
    // real start state in the ontology with an empty one and wipe the phase.
    // We only allow an empty snapshot through once a baseline exists for the
    // phase — i.e. after applyPhaseMapState has delivered its loaded state —
    // which is exactly the case where the planner really has erased everything.
    const isEmpty =
      snapshot.units.length === 0 &&
      snapshot.arrows.length === 0 &&
      snapshot.objectives.length === 0;
    if (isEmpty && !lastNotifiedRef.current.has(phaseId)) return;

    // Change originated from the app (ontology load / inheritance / LLM push):
    // record it as the baseline but don't echo it straight back out.
    if (suppressedPhasesRef.current.has(phaseId)) {
      suppressedPhasesRef.current.delete(phaseId);
      lastNotifiedRef.current.set(phaseId, signature);
      return;
    }

    const pending = editTimersRef.current.get(phaseId);
    if (pending) clearTimeout(pending);
    editTimersRef.current.set(
      phaseId,
      setTimeout(() => {
        editTimersRef.current.delete(phaseId);
        lastNotifiedRef.current.set(phaseId, signature);
        onPhaseMapEditedRef.current?.(phaseId, snapshot);
      }, editDebounceMs),
    );
  }, [
    placedUnits,
    arrows,
    objectives,
    selectedPhaseId,
    readOnly,
    previewMap,
    editDebounceMs,
    buildPhaseMapState,
  ]);

  // ── Eager tile preloading ─────────────────────────────────────────────
  // When units exist and the router is ready, preload tiles in a generous
  // area around ALL unit positions. Uses the fastest ground speed (road @
  // 60 km/h) × phase duration to compute the preload radius, ensuring
  // tiles are cached before any unit is clicked for orders.
  const preloadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!terrainRouter || !routerReady) return;

    // Build a fingerprint so we only preload once per unit set
    const unitPositions: [number, number][] = placedUnits
      .filter(u => u.lat != null && u.lng != null)
      .map(u => [u.lat, u.lng]);
    if (unitPositions.length === 0) return;

    const fingerprint = `${unitPositions.length}-${selectedPhaseId ?? 'none'}`;
    if (preloadedRef.current === fingerprint) return;
    preloadedRef.current = fingerprint;

    // Compute a sensible bounding box around all units.
    // 10km buffer — minimal preload since the raster handles isochrones now.
    // The tiled graph is only needed for route preview (A* from unit to destination).
    const maxDistKm = 10;
    const latBuf = maxDistKm / 111.32;

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [lat, lon] of unitPositions) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }

    // Only preload tiles near the CENTROID of units (not the full spread).
    // The raster handles isochrones now — tiled graph only needed for route A*.
    const centroidLat = unitPositions.reduce((s, p) => s + p[0], 0) / unitPositions.length;
    const centroidLon = unitPositions.reduce((s, p) => s + p[1], 0) / unitPositions.length;
    const preloadPositions: [number, number][] = [
      [centroidLat, centroidLon],
    ];

    console.log(`[MapWrapper] preloading tiles around centroid [${centroidLat.toFixed(2)}, ${centroidLon.toFixed(2)}] (±${latBuf.toFixed(2)}° lat)`);
    terrainRouter.preloadTilesAround(preloadPositions).then(() => {
      console.log('[MapWrapper] tile preload complete');
    }).catch(e => {
      console.warn('[MapWrapper] tile preload failed:', e);
    });
  }, [terrainRouter, routerReady, placedUnits, selectedPhaseId, phaseDurationHours]);

  const previewMapRef = useRef(previewMap);
  const onPreviewMapEditRef = useRef(onPreviewMapEdit);
  const mapInstanceRef = useRef<import("maplibre-gl").Map | null>(null);
  useEffect(() => { previewMapRef.current = previewMap; }, [previewMap]);
  useEffect(() => { onPreviewMapEditRef.current = onPreviewMapEdit; }, [onPreviewMapEdit]);

  useImperativeHandle(
    ref,
    () => ({
      clonePhaseItems: (sourcePhaseId, newPhaseId, newPhaseIndex) => {
        const newColour = getPhaseColour(newPhaseIndex);
        setPlacedUnits((prev) => {
          const clones: PhaseUnit[] = prev
            .filter((u) => u.phaseId === sourcePhaseId)
            .map((u) => ({
              ...u,
              id: uuidv4(),
              phaseId: newPhaseId,
              phaseColour: newColour,
            }));
          return clones.length > 0 ? [...prev, ...clones] : prev;
        });
        setArrows((prev) => {
          // Spread (`...a`) preserves docSidc automatically — no explicit
          // field needed here.
          const clones: PlacedArrow[] = prev
            .filter((a) => a.phaseId === sourcePhaseId)
            .map((a) => ({
              ...a,
              id: uuidv4(),
              phaseId: newPhaseId,
              colour: newColour,
            }));
          return clones.length > 0 ? [...prev, ...clones] : prev;
        });
        setObjectives((prev) => {
          const clones: PlacedObjective[] = prev
            .filter((o) => o.phaseId === sourcePhaseId)
            .map((o) => ({
              ...o,
              id: uuidv4(),
              phaseId: newPhaseId,
              colour: newColour,
            }));
          return clones.length > 0 ? [...prev, ...clones] : prev;
        });
      },
      readPhaseMapState: (phaseId: string): MapPhaseState =>
        buildPhaseMapState(phaseId),
      setUnitOrbat: (unitId, keys) => {
        setPlacedUnits((prev) =>
          prev.map((u) =>
            u.id === unitId
              ? {
                  ...u,
                  orbatRootUnitKey: keys.orbatRootUnitKey,
                  orbatHierarchyKey: keys.orbatHierarchyKey,
                  orbatIsBasic: keys.orbatIsBasic ?? false,
                }
              : u,
          ),
        );
      },
      setUnitParent: (unitId, parentUnitKey) => {
        // Match on the ORBAT root as well as the placement id: the same unit
        // carries different placement ids in different phases, and its parent
        // is a property of the force, not of one phase's map.
        setPlacedUnits((prev) => {
          const target = prev.find((u) => u.id === unitId);
          const rootKey = target?.orbatRootUnitKey;
          return prev.map((u) =>
            u.id === unitId || (rootKey && u.orbatRootUnitKey === rootKey)
              ? { ...u, orbatParentUnitKey: parentUnitKey ?? undefined }
              : u,
          );
        });
      },
      applyPhaseMapState: (
        phaseId: string,
        state: MapPhaseState,
        phaseIndex: number,
      ) => {
        // App-driven push — don't bounce it straight back to the ontology.
        suppressedPhasesRef.current.add(phaseId);
        // Cancel any pending user-edit write for this phase: the app is
        // replacing the state wholesale, so a queued older snapshot must not
        // land on top of it afterwards.
        const pendingWrite = editTimersRef.current.get(phaseId);
        if (pendingWrite) {
          clearTimeout(pendingWrite);
          editTimersRef.current.delete(phaseId);
        }
        const phaseColourForNew = getPhaseColour(phaseIndex);
        setPlacedUnits((prev) => {
          const withoutOld = prev.filter((u) => u.phaseId !== phaseId);
          const next: PhaseUnit[] = state.units.map((u) => ({
            id: u.id,
            templateId: u.templateId ?? "UTYPE-MECH-INFANTRY-PLT",
            label: u.label,
            sidc: u.sidc,
            lat: u.lat,
            lng: u.lng,
            phaseId,
            phaseColour: phaseColourForNew,
            orbatRootUnitKey: u.orbatRootUnitKey,
            orbatHierarchyKey: u.orbatHierarchyKey,
            orbatIsBasic: u.orbatIsBasic,
            orbatParentUnitKey: u.orbatParentUnitKey,
          }));
          return [...withoutOld, ...next];
        });
        setArrows((prev) => {
          const withoutOld = prev.filter((a) => a.phaseId !== phaseId);
          const next: PlacedArrow[] = state.arrows.map((a) => ({
            id: a.id,
            fromLat: a.fromLat,
            fromLng: a.fromLng,
            toLat: a.toLat,
            toLng: a.toLng,
            colour: phaseColourForNew,
            phaseId,
            lineStyle: a.lineStyle ?? "solid",
            endpointStyle: a.endpointStyle ?? "arrow-filled",
            tacticSidc: a.tacticSidc,
            tacticLabel: a.tacticLabel,
            docSidc: a.docSidc,
            assignedUnitId: a.assignedUnitId,
            targetObjectiveId: a.targetObjectiveId,
            // Preserve terrain routing so AI/terrain orders keep drawing along
            // their real path rather than snapping back to a straight line.
            routeWaypoints: a.routeWaypoints,
            routeDistanceKm: a.routeDistanceKm,
            routeDurationSec: a.routeDurationSec,
            isTerrainRouted: a.isTerrainRouted,
          }));
          return [...withoutOld, ...next];
        });
        setObjectives((prev) => {
          const withoutOld = prev.filter((o) => o.phaseId !== phaseId);
          const next: PlacedObjective[] = state.objectives.map((o) => ({
            id: o.id,
            lat: o.lat,
            lng: o.lng,
            name: o.name,
            colour: phaseColourForNew,
            phaseId,
          }));
          return [...withoutOld, ...next];
        });
      },
      deletePhaseItems: (phaseId: string) => {
        suppressedPhasesRef.current.add(phaseId);
        lastNotifiedRef.current.delete(phaseId);
        setPlacedUnits((prev) => prev.filter((u) => u.phaseId !== phaseId));
        setArrows((prev) => prev.filter((a) => a.phaseId !== phaseId));
        setObjectives((prev) => prev.filter((o) => o.phaseId !== phaseId));
      },
    }),
    [buildPhaseMapState],
  );

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlacingTemplate(null);
        setArrowDrawing(false);
        arrowStartRef.current = null;
        setPendingObjective(null);
        setActiveTool("select");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const previewActive = !!previewMap;
  const visibleUnits: PlacedUnit[] = previewActive
    ? (previewMap!.units.map((u) => ({
        id: u.id,
        templateId: u.templateId ?? "UTYPE-MECH-INFANTRY-PLT",
        label: u.label,
        sidc: u.sidc,
        lat: u.lat,
        lng: u.lng,
        orbatRootUnitKey: u.orbatRootUnitKey,
        orbatHierarchyKey: u.orbatHierarchyKey,
        orbatIsBasic: u.orbatIsBasic,
        orbatParentUnitKey: u.orbatParentUnitKey,
      })) as PlacedUnit[])
    : selectedPhaseId
    ? placedUnits.filter((u) => u.phaseId === selectedPhaseId)
    : placedUnits;

  const visibleArrows: PlacedArrow[] = previewActive
    ? previewMap!.arrows.map((a) => ({
        id: a.id,
        fromLat: a.fromLat,
        fromLng: a.fromLng,
        toLat: a.toLat,
        toLng: a.toLng,
        colour: a.colour,
        lineStyle: a.lineStyle ?? "solid",
        endpointStyle: a.endpointStyle ?? "arrow-filled",
        tacticSidc: a.tacticSidc,
        tacticLabel: a.tacticLabel,
        docSidc: a.docSidc,
        milxScale: a.milxScale,
        assignedUnitId: a.assignedUnitId,
        targetObjectiveId: a.targetObjectiveId,
      }))
    : selectedPhaseId
    // Exact match only. The old `!a.phaseId ||` clause meant an arrow with no
    // phaseId showed up in EVERY phase while `readPhaseMapState` (exact match)
    // never saved or published it — visible but permanently unpersisted.
    // Every creation path now stamps phaseId, so exact matching is safe.
    ? arrows.filter((a) => a.phaseId === selectedPhaseId)
    : arrows;

  const visibleObjectives: PlacedObjective[] = previewActive
    ? previewMap!.objectives.map((o) => ({
        id: o.id,
        lat: o.lat,
        lng: o.lng,
        name: o.name,
        colour: o.colour,
      }))
    : selectedPhaseId
    // Exact match — see the note on visibleArrows above.
    ? objectives.filter((o) => o.phaseId === selectedPhaseId)
    : objectives;

  const endState = useMemo(() => {
    if (viewMode !== "resolved") return null;
    return computeEndState(
      visibleUnits as PhaseUnit[],
      visibleArrows,
      visibleObjectives,
      phaseDurationHours,
    );
  }, [viewMode, visibleUnits, visibleArrows, visibleObjectives, phaseDurationHours]);

  const mapUnits = endState ? endState.units : visibleUnits;
  const mapArrows = endState ? [] as PlacedArrow[] : visibleArrows;
  const mapObjectives = endState ? endState.objectives : visibleObjectives;
  const isResolved = viewMode === "resolved";
  const isPhaseEmpty =
    !previewActive &&
    !isResolved &&
    !!selectedPhaseId &&
    !placingTemplate &&
    visibleUnits.length === 0 &&
    visibleArrows.length === 0 &&
    visibleObjectives.length === 0;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSelectTool = useCallback((tool: MapTool) => {
    setActiveTool(tool);
    if (tool !== "placeUnit") setPlacingTemplate(null);
    if (tool !== "drawArrow" && tool !== "placeMilx") {
      arrowStartRef.current = null;
      setArrowDrawing(false);
    }
    if (tool !== "placeObjective") setPendingObjective(null);
    if (tool !== "select") {
      setSelectedOrderArrow(null);
      setOrderPanelAnchor(null);
    }
  }, []);
  void handleSelectTool;

  const handleArrowClick = useCallback((arrow: PlacedArrow) => {
    setSelectedOrderArrow(arrow);
    setOrderPanelAnchor({ x: window.innerWidth / 2 - 160, y: 120 });
  }, []);

  const closeOrderPanel = useCallback(() => {
    setSelectedOrderArrow(null);
    setOrderPanelAnchor(null);
  }, []);

  const handleAssignUnit = useCallback((unitId: string | undefined) => {
    setSelectedOrderArrow((prev) => {
      if (!prev) return prev;
      const next = { ...prev, assignedUnitId: unitId };
      setArrows((all) => all.map((a) => (a.id === prev.id ? next : a)));
      return next;
    });
  }, []);

  const handleAssignObjective = useCallback((objectiveId: string | undefined) => {
    setSelectedOrderArrow((prev) => {
      if (!prev) return prev;
      const next = { ...prev, targetObjectiveId: objectiveId };
      setArrows((all) => all.map((a) => (a.id === prev.id ? next : a)));
      return next;
    });
  }, []);

  // Kept for potential future use (keyboard shortcuts, etc.)
  const _handleSelectUnitTemplate = useCallback((template: UnitTemplate) => {
    setPlacingTemplate(template);
    setActiveTool("placeUnit");
  }, []);
  void _handleSelectUnitTemplate;

  const handlePlace = useCallback(
    (lat: number, lng: number) => {
      if (!placingTemplate) return;
      const sidcWithAff = withAffiliation(placingTemplate.sidc, affiliationRef.current);
      if (previewMap && onPreviewMapEdit) {
        const newUnit: MapUnitPlacement = {
          id: uuidv4(),
          templateId: placingTemplate.id,
          label: placingTemplate.label,
          sidc: sidcWithAff,
          lat,
          lng,
        };
        onPreviewMapEdit({
          ...previewMap,
          units: [...previewMap.units, newUnit],
        });
        return;
      }
      const unit: PhaseUnit = {
        id: uuidv4(),
        templateId: placingTemplate.id,
        label: placingTemplate.label,
        sidc: sidcWithAff,
        lat,
        lng,
        phaseId: selectedPhaseIdRef.current ?? undefined,
        phaseColour: phaseColourRef.current,
      };
      setPlacedUnits((prev) => [...prev, unit]);
      setSelectedUnitId(unit.id);
      onUnitPlacedRef.current?.(unit);
    },
    [placingTemplate, previewMap, onPreviewMapEdit],
  );

  const handleUnitSelect = useCallback(
    (id: string | null) => {
      setSelectedUnitId(id);
      if (!id) {
        onSelectedUnitChange?.(null);
        return;
      }
      // Resolve within the CURRENT phase first. Map states persisted or seeded
      // before ids were made unique per phase can contain the same unit id in
      // more than one phase; picking the first match could then report a phase
      // other than the one on screen (which closes the detail panel and
      // filters the map to that other phase).
      const currentPhaseId = selectedPhaseIdRef.current;
      const unit =
        (currentPhaseId
          ? placedUnits.find((u) => u.id === id && u.phaseId === currentPhaseId)
          : undefined) ?? placedUnits.find((u) => u.id === id);
      onSelectedUnitChange?.(unit ?? null);
      if (unit?.phaseId && unit.phaseId !== currentPhaseId) {
        onSelectPhase(unit.phaseId);
      }
    },
    [placedUnits, onSelectPhase, onSelectedUnitChange],
  );

  const finishArrow = useCallback((toLat: number, toLng: number, toUnitId?: string) => {
    const start = arrowStartRef.current;
    if (!start) return;
    const id = uuidv4();
    const colour = phaseColourRef.current;
    const lineStyle = arrowStyleRef.current.line;
    const endpointStyle = arrowStyleRef.current.endpoint;
    const fromUnitId = arrowFromUnitIdRef.current ?? undefined;

    if (previewMapRef.current && onPreviewMapEditRef.current) {
      const previewArrow: PreviewArrowPayload = {
        id,
        fromLat: start.lat,
        fromLng: start.lng,
        toLat,
        toLng,
        colour,
        lineStyle,
        endpointStyle,
      };
      onPreviewMapEditRef.current({
        ...previewMapRef.current,
        arrows: [...previewMapRef.current.arrows, previewArrow],
      });
    } else {
      const newArrow: PlacedArrow = {
        id,
        fromLat: start.lat,
        fromLng: start.lng,
        toLat,
        toLng,
        colour,
        lineStyle,
        endpointStyle,
        tacticSidc: arrowStyleRef.current.tacticSidc,
        tacticLabel: arrowStyleRef.current.tacticLabel,
        docSidc: arrowStyleRef.current.docSidc,
        fromUnitId,
        toUnitId,
        phaseId: selectedPhaseIdRef.current ?? undefined,
      };
      setArrows((prev) => [...prev, newArrow]);
    }
    arrowStartRef.current = null;
    arrowFromUnitIdRef.current = null;
    setArrowDrawing(false);
  }, []);

  const handleUnitClick = useCallback((unit: PlacedUnit) => {
    const tool = activeToolRef.current;

    // Terrain flow: reachability envelope shown → clicking a unit uses that
    // unit's position as the destination. RoutePreview normally handles map
    // clicks, but unit marker stopPropagation prevents the MapLibre event
    // reaching it. We forward it here by synthesising a destination at the
    // unit's position. The store will route to it and confirm as normal.
    if (useOrderPlacementStore.getState().step === "reachabilityShown") {
      // Let RoutePreview's own click logic run by dispatching a synthetic
      // map click at this unit's position via the store directly.
      // We do this by confirming the destination with a zero-length route
      // (the unit is already within the envelope; RoutePreview would have
      // done the same routing). We emit via handleMapClick so the existing
      // RoutePreview pointer-event path picks it up.
      handleMapClick(unit.lat, unit.lng);
      return;
    }

    // New flow: tactic selected → click unit → order placed & assigned
    if (tool === "assignOrder") {
      const style = arrowStyleRef.current;
      if (!style.tacticSidc && !style.tacticLabel) return;
      const id = uuidv4();
      const colour = phaseColourRef.current;
      const isMilx = style.tacticSidc ? isMilxOrder(APP_CATALOG, style.tacticSidc) : false;

      // For MilX symbols: place at unit position with fixed anchor adjustment
      // For plain arrows: place a zero-length arrow at the unit (can be resized later)
      let fromLat = unit.lat;
      let fromLng = unit.lng;

      if (isMilx && style.tacticSidc) {
      const map = mapInstanceRef.current;
      if (map) {
          const clickPx = map.project([unit.lng, unit.lat]);
          const adjustedPx = milxFromForAnchorClick(APP_CATALOG, style.tacticSidc, { x: clickPx.x, y: clickPx.y }, map.getZoom());
        const adjustedGeo = map.unproject([adjustedPx.x, adjustedPx.y]);
        fromLat = adjustedGeo.lat;
        fromLng = adjustedGeo.lng;
      }
      }

        const newArrow: PlacedArrow = {
          id,
          fromLat,
          fromLng,
        toLat: unit.lat,
        toLng: unit.lng,
          colour,
        lineStyle: style.line,
        endpointStyle: style.endpoint,
        tacticSidc: style.tacticSidc,
        tacticLabel: style.tacticLabel,
        docSidc: style.docSidc,
        assignedUnitId: unit.id,
          phaseId: selectedPhaseIdRef.current ?? undefined,
        };
        setArrows((prev) => [...prev, newArrow]);

      // Stay in assignOrder mode so the user can quickly assign the same
      // order to more units. Escape or selecting another tool exits.
      return;
    }

    if (tool === "drawArrow") {
      if (!arrowDrawingRef.current) {
        arrowStartRef.current = { lat: unit.lat, lng: unit.lng };
        arrowFromUnitIdRef.current = unit.id;
        setArrowDrawing(true);
      } else {
        finishArrow(unit.lat, unit.lng, unit.id);
      }
        return;
      }
    handleUnitSelect(unit.id);
  }, [handleUnitSelect, finishArrow]);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    const tool = activeToolRef.current;
    if (tool === "placeMilx") {
      const id = uuidv4();
      const colour = phaseColourRef.current;
      const tacticSidc = arrowStyleRef.current.tacticSidc;
      const tacticLabel = arrowStyleRef.current.tacticLabel;
      const docSidc = arrowStyleRef.current.docSidc;
      if (!tacticSidc || !isMilxOrder(APP_CATALOG, tacticSidc)) return;

      const map = mapInstanceRef.current;
      let fromLat = lat;
      let fromLng = lng;
      if (map) {
        const clickPx = map.project([lng, lat]);
        const adjustedPx = milxFromForAnchorClick(APP_CATALOG, tacticSidc, { x: clickPx.x, y: clickPx.y }, map.getZoom());
        const adjustedGeo = map.unproject([adjustedPx.x, adjustedPx.y]);
        fromLat = adjustedGeo.lat;
        fromLng = adjustedGeo.lng;
      }

      if (previewMapRef.current && onPreviewMapEditRef.current) {
        onPreviewMapEditRef.current({
          ...previewMapRef.current,
          arrows: [
            ...previewMapRef.current.arrows,
            { id, fromLat, fromLng, toLat: fromLat, toLng: fromLng, colour, lineStyle: "solid", endpointStyle: "none" },
          ],
        });
      } else {
        const newArrow: PlacedArrow = {
          id,
          fromLat,
          fromLng,
          toLat: fromLat,
          toLng: fromLng,
          colour,
          lineStyle: "solid",
          endpointStyle: "none",
          tacticSidc,
          tacticLabel,
          docSidc,
          phaseId: selectedPhaseIdRef.current ?? undefined,
        };
        setArrows((prev) => [...prev, newArrow]);
      }
        return;
      }

    if (tool === "drawArrow") {
      if (!arrowDrawingRef.current) {
        arrowStartRef.current = { lat, lng };
        arrowFromUnitIdRef.current = null;
        setArrowDrawing(true);
      } else {
        finishArrow(lat, lng, undefined);
      }
    }

    if (tool === "placeObjective") {
      setPendingObjective({ lat, lng });
      setObjectiveName("");
    }
  }, [finishArrow]);

  const handleConfirmObjective = useCallback(() => {
    if (!pendingObjective) return;
    if (previewMap && onPreviewMapEdit) {
        onPreviewMapEdit({
          ...previewMap,
        objectives: [
          ...previewMap.objectives,
          {
            id: uuidv4(),
            lat: pendingObjective.lat,
            lng: pendingObjective.lng,
            name: objectiveName || "Objective",
            colour: phaseColourRef.current,
          },
        ],
      });
    } else {
      setObjectives((prev) => [
        ...prev,
        {
          id: uuidv4(),
          lat: pendingObjective.lat,
          lng: pendingObjective.lng,
          name: objectiveName || "Objective",
          phaseId: selectedPhaseIdRef.current ?? undefined,
          colour: phaseColourRef.current,
        },
      ]);
    }
    setPendingObjective(null);
    setObjectiveName("");
  }, [pendingObjective, objectiveName, previewMap, onPreviewMapEdit]);

  function handleObjectiveNameChange(e: ChangeEvent<HTMLInputElement>) {
    setObjectiveName(e.target.value);
  }
  function handleObjectiveKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleConfirmObjective();
  }
  const handleMove = useCallback(
    (id: string, lat: number, lng: number) => {
      if (previewMap && onPreviewMapEdit) {
        onPreviewMapEdit({
          ...previewMap,
          units: previewMap.units.map((u) =>
            u.id === id ? { ...u, lat, lng } : u,
          ),
        });
        return;
      }
      setPlacedUnits((prev) =>
        prev.map((u) => (u.id === id ? { ...u, lat, lng } : u)),
      );
      setArrows((prev) =>
        prev.map((a) => {
          if (a.milxUnitAnchors) {
            const isAnchor = Object.values(a.milxUnitAnchors).includes(id);
            if (isAnchor) return a;
          }
          if (a.fromUnitId === id && a.toUnitId === id) {
            return { ...a, fromLat: lat, fromLng: lng, toLat: lat, toLng: lng };
          }
          if (a.fromUnitId === id) {
            return { ...a, fromLat: lat, fromLng: lng };
          }
          if (a.toUnitId === id) {
            return { ...a, toLat: lat, toLng: lng };
          }
          return a;
        }),
      );
    },
    [previewMap, onPreviewMapEdit],
  );

  const handleRemove = useCallback(
    (id: string) => {
      if (previewMap && onPreviewMapEdit) {
        onPreviewMapEdit({
          ...previewMap,
          units: previewMap.units.filter((u) => u.id !== id),
        });
        setSelectedUnitId((prev) => (prev === id ? null : prev));
        return;
      }
      setPlacedUnits((prev) => prev.filter((u) => u.id !== id));
      setSelectedUnitId((prev) => (prev === id ? null : prev));
    },
    [previewMap, onPreviewMapEdit],
  );

  // ── Unit attribute editing (label / SIDC / affiliation) ─────────────────
  // Backs the UnitEditDialog. Previously the dialog's Save handler only called
  // onMove with the unchanged position, so label/SIDC/affiliation edits were
  // silently dropped.
  const handleUpdateUnit = useCallback(
    (
      id: string,
      updates: { label?: string; sidc?: string; affiliation?: "friend" | "hostile" },
    ) => {
      if (readOnly) return;
      const patchSidc = (current: string): string => {
        const base = updates.sidc ?? current;
        return updates.affiliation ? withAffiliation(base, updates.affiliation) : base;
      };

      if (previewMap && onPreviewMapEdit) {
        onPreviewMapEdit({
          ...previewMap,
          units: previewMap.units.map((u) =>
            u.id === id
              ? { ...u, label: updates.label ?? u.label, sidc: patchSidc(u.sidc) }
              : u,
          ),
        });
        return;
      }

      setPlacedUnits((prev) =>
        prev.map((u) =>
          u.id === id
            ? {
                ...u,
                label: updates.label ?? u.label,
                sidc: patchSidc(u.sidc),
                affiliation: updates.affiliation ?? u.affiliation,
              }
            : u,
        ),
      );
    },
    [previewMap, onPreviewMapEdit, readOnly],
  );

  const handleRemoveArrow = useCallback(
    (id: string) => {
      if (previewMap && onPreviewMapEdit) {
        onPreviewMapEdit({
          ...previewMap,
          arrows: previewMap.arrows.filter((a) => a.id !== id),
        });
        return;
      }
      setArrows((prev) => prev.filter((a) => a.id !== id));
    },
    [previewMap, onPreviewMapEdit],
  );

  const handleMoveArrowEnd = useCallback(
    (arrowId: string, end: "from" | "to" | "mid", lat: number, lng: number) => {
      const patch = (a: (typeof arrows)[number]) => {
        if (a.id !== arrowId) return a;
        if (end === "from") return { ...a, fromLat: lat, fromLng: lng };
        if (end === "to") return { ...a, toLat: lat, toLng: lng };
        return { ...a, midLat: lat, midLng: lng };
      };
      if (previewMap && onPreviewMapEdit) {
        onPreviewMapEdit({ ...previewMap, arrows: previewMap.arrows.map(patch) });
        return;
      }
      setArrows((prev) => prev.map(patch));
    },
    [previewMap, onPreviewMapEdit],
  );

  const handleRemoveObjective = useCallback(
    (id: string) => {
      if (previewMap && onPreviewMapEdit) {
        onPreviewMapEdit({
          ...previewMap,
          objectives: previewMap.objectives.filter((o) => o.id !== id),
        });
        return;
      }
      setObjectives((prev) => prev.filter((o) => o.id !== id));
    },
    [previewMap, onPreviewMapEdit],
  );

  // ── Terrain-routed arrow creation handler ─────────────────────────────
  const handleAddTerrainArrow = useCallback(
    (arrow: PlacedArrow) => {
      const enriched: PlacedArrow = {
        ...arrow,
        phaseId: selectedPhaseIdRef.current ?? undefined,
        lineStyle: "solid",
        endpointStyle: "arrow-filled",
      };
      if (previewMap && onPreviewMapEdit) {
        onPreviewMapEdit({
          ...previewMap,
          arrows: [...previewMap.arrows, {
            id: enriched.id,
            fromLat: enriched.fromLat,
            fromLng: enriched.fromLng,
            toLat: enriched.toLat,
            toLng: enriched.toLng,
            colour: enriched.colour,
            lineStyle: enriched.lineStyle,
            endpointStyle: enriched.endpointStyle,
            tacticSidc: enriched.tacticSidc,
            tacticLabel: enriched.tacticLabel,
            assignedUnitId: enriched.assignedUnitId,
          }],
        });
      } else {
        setArrows((prev) => [...prev, enriched]);
      }
    },
    [previewMap, onPreviewMapEdit],
  );

  // ── Terrain order store (read step for onUnitClick wiring) ──────────────
  const terrainOrderStep = useOrderPlacementStore((s) => s.step);

  const cursorOverride =
    activeTool === "drawArrow" || activeTool === "placeMilx" || activeTool === "placeObjective"
      ? "crosshair"
      : undefined;

  // Update draw hint to cover the new mode
  let drawHint: string | null = null;
  if (activeTool === "assignOrder")
    drawHint = `Click a unit to assign: ${arrowStyleRef.current.tacticLabel ?? "order"}`;
  else if (activeTool === "placeMilx")
    drawHint = "Click map to place symbol";
  else if (activeTool === "drawArrow" && !arrowDrawing)
    drawHint = "Click a unit or the map to set the arrow start";
  else if (activeTool === "drawArrow" && arrowDrawing)
    drawHint = "Now click a unit or the map to set the arrow end";
  else if (activeTool === "placeObjective")
    drawHint = "Click map to place objective";

  return (
    <div className={"sp-body"}>
      {/* MapItemSidebar removed — units/drawings now placed via right-click context menu */}
      <div className={"sp-map-fill"}>
        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', gap: 0, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
          <button
            onClick={() => setViewMode('planning')}
            style={{ padding: '4px 12px', fontSize: 12, border: 'none', cursor: 'pointer', background: viewMode === 'planning' ? 'var(--accent-primary)' : '#1a1f2e', color: '#fff' }}
          >
            Start State
          </button>
          <button
            onClick={() => setViewMode('resolved')}
            style={{ padding: '4px 12px', fontSize: 12, border: 'none', cursor: 'pointer', background: viewMode === 'resolved' ? 'var(--accent-primary)' : '#1a1f2e', color: '#fff' }}
          >
            End State
          </button>
        </div>
        <ScenarioMap
          placedUnits={mapUnits}
          placingTemplate={isResolved ? null : (activeTool === "placeUnit" ? placingTemplate : null)}
          selectedUnitId={isResolved ? null : selectedUnitId}
          onPlace={isResolved ? (() => {}) : handlePlace}
          onMapClick={isResolved ? undefined : handleMapClick}
          onMapContextMenu={isResolved ? undefined : handleMapContextMenu}
          onMove={isResolved ? (() => {}) : handleMove}
          onSelect={isResolved ? (() => {}) : handleUnitSelect}
          onRemove={isResolved ? (() => {}) : handleRemove}
          onUpdateUnit={isResolved || readOnly ? undefined : handleUpdateUnit}
          onDefineOrbat={isResolved || readOnly ? undefined : onDefineOrbat}
          onRemoveArrow={isResolved ? undefined : handleRemoveArrow}
          onRemoveObjective={isResolved ? undefined : handleRemoveObjective}
          onMoveArrowEnd={isResolved ? undefined : handleMoveArrowEnd}
          eraserActive={isResolved ? false : activeTool === "eraser"}
          onUnitClick={isResolved ? undefined : ((activeTool === "drawArrow" || activeTool === "assignOrder" || terrainOrderStep === "reachabilityShown") ? handleUnitClick : undefined)}
          onArrowClick={isResolved ? undefined : (activeTool === "select" ? handleArrowClick : undefined)}
          onMilxParamsChange={(arrowId, params) =>
            setArrows((prev) => prev.map((a) => a.id === arrowId ? { ...a, milxParams: params } : a))
          }
          onScaleArrow={(arrowId, newScale) => {
            setArrows((prev) => prev.map((a) =>
              a.id === arrowId ? { ...a, milxScale: newScale } : a
            ));
          }}
          onAssignUnitToOrder={(arrowId, unitId) => {
            setArrows((prev) => prev.map((a) =>
              a.id === arrowId ? { ...a, assignedUnitId: unitId } : a
            ));
          }}
          onAttachUnitToMilxHandle={(arrowId, handleId, unitId, params) => {
            setArrows((prev) => prev.map((a) => {
              if (a.id !== arrowId) return a;
              return {
                ...a,
                milxParams: params,
                milxUnitAnchors: { ...(a.milxUnitAnchors ?? {}), [handleId]: unitId },
                assignedUnitId: unitId,
              };
            }));
          }}
          onDetachUnitFromMilxHandle={(arrowId, handleId) => {
            setArrows((prev) => prev.map((a) => {
              if (a.id !== arrowId || !a.milxUnitAnchors) return a;
              const anchors = { ...a.milxUnitAnchors };
              delete anchors[handleId];
              return { ...a, milxUnitAnchors: Object.keys(anchors).length ? anchors : undefined };
            }));
          }}
          onMapReady={(map) => { mapInstanceRef.current = map; }}
          cursorOverride={cursorOverride}
          arrows={mapArrows}
          objectives={mapObjectives}
          arrowStart={arrowDrawing ? arrowStartRef.current : null}
          terrainRouter={terrainRouter}
          terrainRaster={terrainRaster}
          phaseStartOffset={0}
          phaseEndOffset={phaseDurationHours / 24}
          onAddTerrainArrow={isResolved ? undefined : handleAddTerrainArrow}
        />

        {selectedOrderArrow && orderPanelAnchor && (
          <OrderAssignmentPanel
            order={{
              id: selectedOrderArrow.id,
              tacticLabel: selectedOrderArrow.tacticLabel,
              tacticSidc: selectedOrderArrow.tacticSidc,
              assignedUnitId: selectedOrderArrow.assignedUnitId,
              targetObjectiveId: selectedOrderArrow.targetObjectiveId,
            }}
            units={placedUnitsRef.current
              .filter((u) => u.phaseId === selectedOrderArrow.phaseId)
              .map((u) => ({
                id: u.id,
                label: u.label,
                sidc: u.sidc,
                force: u.sidc[1] === "H" ? "red" : "blue",
              }))}
            objectives={objectivesRef.current
              .filter((o) => o.phaseId === selectedOrderArrow.phaseId)
              .map((o) => ({ id: o.id, name: o.name }))}
            anchor={orderPanelAnchor}
            onAssignUnit={handleAssignUnit}
            onAssignObjective={handleAssignObjective}
            onClose={closeOrderPanel}
            readOnly={readOnly}
          />
        )}

        {previewActive && (
          <div className={"sp-preview-banner"} aria-live="polite">
            <span className={"sp-preview-badge"}>✦ PREVIEW</span>
            Proposed positions for the new phase — drag / add / erase to
            adjust before submitting.
          </div>
        )}
        {isResolved && (
          // Positioned below the Start/End State toggle (which sits at
          // top: 8px, ~28px tall) so it doesn't overlap those buttons and
          // make them hard to click.
          <div
            className={"sp-preview-banner"}
            style={{ top: 48 }}
            aria-live="polite"
          >
            <span className={"sp-preview-badge"}>⊕ END STATE</span>
            Showing resolved unit positions after {phaseDurationHours}h phase.
            Arrows hidden — switch to Start State to edit.
          </div>
        )}
        {/* Empty phase. A phase with no saved NxgPhaseMapState row (every
            phase of a newly created scenario) loads with nothing on it, which
            used to look exactly like the map failing to render. Say so. */}
        {isPhaseEmpty && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 9,
              maxWidth: 360,
              padding: "14px 18px",
              background: "rgba(17,19,24,0.9)",
              border: "1px solid var(--border-default)",
              borderRadius: 4,
              color: "#c8cdd8",
              fontSize: 12,
              lineHeight: 1.5,
              textAlign: "center",
              pointerEvents: "none",
              backdropFilter: "blur(4px)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e8ecf4", marginBottom: 4 }}>
              Nothing on the map for this phase yet
            </div>
            {readOnly
              ? "No units, orders or objectives have been saved for this phase."
              : "No units, orders or objectives have been saved for this phase. Right-click the map to place units and drawings — changes save automatically."}
          </div>
        )}
        {drawHint && !isResolved && (
          <div className={"sp-hint"} aria-live="polite">
            {drawHint}
          </div>
        )}
        {/* TIMELINE button — bottom-left of map, sits above the MGRS strip */}
        {onOpenTimeline && (
          <button
            type="button"
            onClick={onOpenTimeline}
            aria-label="Open timeline view"
            title="Open timeline view"
            style={{
              position: "absolute",
              bottom: 62,
              left: 8,
              zIndex: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              background: "rgba(17,19,24,0.88)",
              border: "1px solid var(--border-default)",
              borderRadius: 3,
              color: "#c8cdd8",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: "pointer",
              backdropFilter: "blur(4px)",
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#2fbf71";
              (e.currentTarget as HTMLButtonElement).style.color = "#5bad6f";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#2f3860";
              (e.currentTarget as HTMLButtonElement).style.color = "#c8cdd8";
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1, color: "inherit" }} aria-hidden="true">▤</span>
            TIMELINE
          </button>
        )}

        {/* Right-click context menu for placing units/drawings */}
        <MapContextMenu
          contextMenu={contextMenu}
          onClose={() => setContextMenu(null)}
          onPlaceUnit={handleContextPlaceUnit}
          onPlaceDrawing={handleContextPlaceDrawing}
        />

        {pendingObjective && (
          <div
            className="sp-map__obj-popup"
            style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",zIndex:30}}
            role="dialog"
            aria-modal="true"
            aria-label="Name objective"
          >
            <div className={"sp-map__obj-popup-label"}>Name Objective</div>
            <input
              className={"sp-map__obj-popup-input"}
              type="text"
              placeholder="e.g. Objective GOLD"
              value={objectiveName}
              onChange={handleObjectiveNameChange}
              onKeyDown={handleObjectiveKeyDown}
              autoFocus
              aria-label="Objective name"
            />
            <div className={"sp-map__obj-popup-actions"}>
              <button
                className={"sp-btn--sm sp-btn--outline"}
                onClick={() => setPendingObjective(null)}
              >
                Cancel
              </button>
              <button className={"sp-btn--sm sp-btn--primary"} onClick={handleConfirmObjective}>
                Place
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

