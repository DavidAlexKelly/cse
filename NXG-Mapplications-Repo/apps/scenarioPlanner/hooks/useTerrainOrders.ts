import { useEffect, useCallback, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { useOrderPlacementStore } from '../store/useOrderPlacementStore';
import type { TiledRouter } from '@/shared/routing/tiledRouter';
import type { OSRMRoute } from '@/shared/routing/types';
import { getTimeBudgetSec } from '../lib/unitMobility';
import { routeToGraphic } from '../lib/routeToGraphic';
import type { PlacedUnit } from '../map/types';
import type { PlacedArrow } from '../map/ScenarioMap';

interface UseTerrainOrdersConfig {
  router: TiledRouter | null;
  map: maplibregl.Map | null;
  currentPhaseStartOffset: number; // days
  currentPhaseEndOffset: number;   // days
  arrows: PlacedArrow[];
  onAddArrow: (arrow: PlacedArrow) => void;
}

export function useTerrainOrders(config: UseTerrainOrdersConfig) {
  const { router, map, currentPhaseStartOffset, currentPhaseEndOffset, arrows, onAddArrow } = config;
  const store = useOrderPlacementStore();
  const configRef = useRef(config);
  configRef.current = config;

  // ── Trigger isochrone computation when step changes to 'computingIsochrone' ──
  useEffect(() => {
    if (store.step !== 'computingIsochrone') return;
    if (!router || !store.selectedUnit || !store.mobilityClass) return;

    const unit = store.selectedUnit;
    const mobility = store.mobilityClass;
    const timeBudget = getTimeBudgetSec(currentPhaseStartOffset, currentPhaseEndOffset);

    // For air units, skip terrain routing — use simple circle
    if (mobility === 'air') {
      // Import createCirclePolygon inline
      import('@/shared/routing/envelopeGeometry').then(({ createCirclePolygon }) => {
        const radiusKm = (800 * timeBudget) / 3600;
        const envelope = createCirclePolygon([unit.lng, unit.lat], radiusKm, 64);
        store.setIsochrone({
          reachableNodes: [],
          envelope,
          impassableWithinEnvelope: null,
          contours: [],
          sourceLat: unit.lat,
          sourceLon: unit.lng,
          timeBudgetSec: timeBudget,
          mobilityClass: mobility,
        });
      });
      return;
    }

    // Ground units — use terrain router
    router.preloadTilesAround([[unit.lat, unit.lng]])
      .then(() => router.fetchIsochrone(
        unit.lat, unit.lng,
        mobility,
        timeBudget,
        [3600, 7200, 14400, 28800] // 1h, 2h, 4h, 8h contours
      ))
      .then(result => {
        if (result) {
          store.setIsochrone(result);
        } else {
          console.warn('[TerrainOrders] No reachable nodes from unit position');
          store.cancel();
        }
      })
      .catch(err => {
        console.error('[TerrainOrders] Isochrone computation failed:', err);
        store.cancel();
      });
  }, [store.step, router, currentPhaseStartOffset, currentPhaseEndOffset]);

  // ── Handle confirmed destination — create PlacedArrow ──
  useEffect(() => {
    if (store.step !== 'confirming') return;
    if (!store.confirmedRoute || !store.confirmedDestination || !store.selectedUnit || !store.selectedOrder || !map) return;

    const unit = store.selectedUnit;
    const order = store.selectedOrder;
    const route = store.confirmedRoute;
    const dest = store.confirmedDestination;

    // Generate MilX graphic parameters from route
    const graphic = routeToGraphic({
      route,
      orderKey: order.key,
      unitId: unit.id,
      unitLat: unit.lat,
      unitLng: unit.lng,
      destLat: dest[0],
      destLng: dest[1],
      mapProject: (lngLat) => map.project(lngLat as [number, number]),
      echelonChar: unit.sidc?.[11],
    });

    // Create PlacedArrow
    const newArrow: PlacedArrow = {
      id: crypto.randomUUID(),
      fromLat: unit.lat,
      fromLng: unit.lng,
      toLat: dest[0],
      toLng: dest[1],
      colour: getCategoryColour(order.category),
      tacticSidc: order.sidc,
      tacticLabel: order.label,
      assignedUnitId: unit.id,
      milxParams: graphic.milxParams,
      milxScale: graphic.milxScale,
      milxUnitAnchors: graphic.milxUnitAnchors,
      // Route data
      routeWaypoints: route.waypoints,
      routeDistanceKm: route.distanceKm,
      routeDurationSec: route.durationSec,
      routeMobilityClass: store.mobilityClass ?? undefined,
      isTerrainRouted: true,
    };

    onAddArrow(newArrow);

    // Stay on the unit for more orders (go back to selectingOrder)
    const screenPos = store.unitScreenPosition;
    if (screenPos) {
      store.selectUnit(unit, screenPos);
    } else {
      store.reset();
    }
  }, [store.step, map, onAddArrow]);

  // ── Unit click handler ──
  const handleUnitClick = useCallback((unit: PlacedUnit, screenPos: { x: number; y: number }) => {
    store.selectUnit(unit, screenPos);
  }, []);

  // ── Route confirmed callback (from RoutePreview) ──
  const handleRouteConfirmed = useCallback((route: OSRMRoute, destination: [number, number]) => {
    store.confirmDestination(destination, route);
  }, []);

  // ── Get existing orders for the selected unit ──
  const existingOrders = store.selectedUnit
    ? arrows
        .filter(a => a.assignedUnitId === store.selectedUnit?.id && a.tacticLabel)
        .map(a => ({ orderKey: a.tacticSidc ?? '', orderLabel: a.tacticLabel ?? '', targetName: undefined }))
    : [];

  // ── Determine order category for colour coding ──
  const orderCategory = store.selectedOrder
    ? categoriseOrder(store.selectedOrder.category)
    : 'offensive';

  return {
    store,
    handleUnitClick,
    handleRouteConfirmed,
    existingOrders,
    orderCategory,
  };
}

function getCategoryColour(category: string): string {
  switch (category.toLowerCase()) {
    case 'offensive': return '#DC3232';
    case 'defensive': return '#3278DC';
    case 'manoeuvre': case 'maneuver': return '#DCB432';
    case 'fire support': case 'fire-support': return '#DC6432';
    case 'security': return '#32B478';
    default: return '#888888';
  }
}

function categoriseOrder(category: string): string {
  const lower = category.toLowerCase();
  if (lower.includes('offensive') || lower.includes('attack')) return 'offensive';
  if (lower.includes('defensive') || lower.includes('defend')) return 'defensive';
  if (lower.includes('manoeuvre') || lower.includes('maneuver') || lower.includes('retrograde')) return 'manoeuvre';
  if (lower.includes('fire') || lower.includes('support')) return 'fire-support';
  if (lower.includes('security') || lower.includes('screen') || lower.includes('guard')) return 'security';
  return 'offensive';
}
