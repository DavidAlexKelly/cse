import React, { useEffect, useRef, useCallback, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { TiledRouter } from '@/shared/routing/tiledRouter';
import type { TerrainRaster } from '@/shared/routing/terrainRaster';
import type { MobilityClass, OSRMRoute } from '@/shared/routing/types';
import type { GeoJSONPolygonFeature } from '@/shared/routing/envelopeGeometry';
import { formatDuration } from '../../lib/unitMobility';
import './RoutePreview.css';

/* ------------------------------------------------------------------ */
/*  Point-in-polygon (raycasting)                                      */
/* ------------------------------------------------------------------ */

function isPointInPolygon(
  x: number,
  y: number,
  polygon: [number, number][],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];
    if (
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface RoutePreviewProps {
  map: maplibregl.Map | null;
  /** The container div that wraps the map canvas — we attach the click
   *  intercept overlay here so it sits above all MapLibre/app6d layers. */
  mapContainer: HTMLDivElement | null;
  router: TiledRouter | TerrainRaster | null;
  unitPosition: [number, number]; // [lat, lng]
  mobilityClass: MobilityClass;
  envelope: GeoJSONPolygonFeature | import('@/shared/routing/types').GeoJsonFeature | null;
  isActive: boolean;
  onRouteConfirmed: (route: OSRMRoute, destination: [number, number]) => void;
  onCancel: () => void;
}

/* ------------------------------------------------------------------ */
/*  Tooltip state                                                      */
/* ------------------------------------------------------------------ */

interface TooltipState {
  x: number;
  y: number;
  distanceKm: number;
  durationSec: number;
}

/* ------------------------------------------------------------------ */
/*  Source / layer IDs                                                  */
/* ------------------------------------------------------------------ */

const ROUTE_SOURCE = 'route-preview';
const ROUTE_DOT_SOURCE = 'route-preview-dot';
const LAYER_CASING = 'route-preview-casing';
const LAYER_LINE = 'route-preview-line';
const LAYER_DOT = 'route-preview-dot';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const RoutePreview: React.FC<RoutePreviewProps> = ({
  map,
  mapContainer,
  router,
  unitPosition,
  mobilityClass,
  envelope,
  isActive,
  onRouteConfirmed,
  onCancel,
}) => {
  const [tooltipState, setTooltipState] = useState<TooltipState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedRef = useRef<boolean>(false);
  const lastRouteRef = useRef<OSRMRoute | null>(null);
  // Refs so handlers always see latest values without re-registering
  const envelopeRef = useRef(envelope);
  const unitPositionRef = useRef(unitPosition);
  const mobilityClassRef = useRef(mobilityClass);
  const onRouteConfirmedRef = useRef(onRouteConfirmed);
  const onCancelRef = useRef(onCancel);
  useEffect(() => { envelopeRef.current = envelope; }, [envelope]);
  useEffect(() => { unitPositionRef.current = unitPosition; }, [unitPosition]);
  useEffect(() => { mobilityClassRef.current = mobilityClass; }, [mobilityClass]);
  useEffect(() => { onRouteConfirmedRef.current = onRouteConfirmed; }, [onRouteConfirmed]);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  /* ── Cleanup helper ─────────────────────────────────────────────── */
  const cleanupMapLayers = useCallback(() => {
    if (!map) return;
    try {
      if (map.getLayer(LAYER_DOT)) map.removeLayer(LAYER_DOT);
      if (map.getLayer(LAYER_LINE)) map.removeLayer(LAYER_LINE);
      if (map.getLayer(LAYER_CASING)) map.removeLayer(LAYER_CASING);
      if (map.getSource(ROUTE_DOT_SOURCE)) map.removeSource(ROUTE_DOT_SOURCE);
      if (map.getSource(ROUTE_SOURCE)) map.removeSource(ROUTE_SOURCE);
    } catch { /* map may be disposed during unmount */ }

    addedRef.current = false;
  }, [map]);

  /* ── Ensure map sources & layers exist ──────────────────────────── */
  const ensureMapLayers = useCallback(() => {
    if (!map || addedRef.current) return;

    // Route line source
    map.addSource(ROUTE_SOURCE, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [] },
      },
    });

    // Cursor dot source
    map.addSource(ROUTE_DOT_SOURCE, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
    });

    // Casing layer
    map.addLayer({
      id: LAYER_CASING,
      type: 'line',
      source: ROUTE_SOURCE,
      paint: {
        'line-color': '#333',
        'line-width': 5,
        'line-opacity': 0.4,
      },
    });

    // Route line layer
    map.addLayer({
      id: LAYER_LINE,
      type: 'line',
      source: ROUTE_SOURCE,
      paint: {
        'line-color': '#fff',
        'line-width': 3,
        'line-opacity': 0.8,
        'line-dasharray': [2, 2],
      },
    });

    // Cursor dot layer
    map.addLayer({
      id: LAYER_DOT,
      type: 'circle',
      source: ROUTE_DOT_SOURCE,
      paint: {
        'circle-radius': 6,
        'circle-color': '#fff',
        'circle-stroke-color': '#333',
        'circle-stroke-width': 2,
        'circle-opacity': 0.9,
      },
    });

    addedRef.current = true;
  }, [map]);

  /* ── Update route preview line on map ───────────────────────────── */
  const updateRouteLine = useCallback(
    (waypoints: [number, number][]) => {
      if (!map) return;
      const source = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      // Waypoints are [lat, lon] from router — convert to [lon, lat] for GeoJSON
      const coordinates = waypoints.map(([lat, lon]) => [lon, lat]);

      source.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      });
    },
    [map],
  );

  /* ── Update cursor dot position ─────────────────────────────────── */
  const updateDotPosition = useCallback(
    (lon: number, lat: number) => {
      if (!map) return;
      const source = map.getSource(ROUTE_DOT_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      source.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [lon, lat] },
      });
    },
    [map],
  );

  /* ── Clear the route preview ────────────────────────────────────── */
  const clearPreview = useCallback(() => {
    updateRouteLine([]);
    updateDotPosition(0, 0);
    setTooltipState(null);
    lastRouteRef.current = null;
  }, [updateRouteLine, updateDotPosition]);

  /* ── Overlay effect: intercept container-level pointer events ───── */
  // We render an absolutely-positioned transparent div ON TOP of the entire
  // map+app6d stack. This div owns all pointer events while the envelope is
  // active, so no drag, no marker click, no tactic-graphics handle can steal
  // the click. It converts the pointer position to geo-coords via map.unproject.
  useEffect(() => {
    if (!isActive || !map || !mapContainer || !envelope || !router) {
      setTooltipState(null);
      return;
    }

    ensureMapLayers();

    const envelopeRing = (envelope.geometry.type === 'Polygon'
      ? envelope.geometry.coordinates[0]
      : envelope.geometry.coordinates[0]?.[0] ?? []) as [number, number][];

    // Track the last hovered destination so Enter can confirm it
    let lastHoverLat = 0;
    let lastHoverLon = 0;
    let hoverIsInside = false;

    /* ── Mousemove handler (MapLibre native — doesn't block pan/zoom) */
    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      const lngLat = e.lngLat;
      const ring = envelopeRef.current
        ? (envelopeRef.current.geometry.type === 'Polygon'
            ? envelopeRef.current.geometry.coordinates[0]
            : envelopeRef.current.geometry.coordinates[0]?.[0] ?? []) as [number, number][]
        : envelopeRing;
      const inside = isPointInPolygon(lngLat.lng, lngLat.lat, ring);

      if (!inside) {
        map.getCanvas().style.cursor = 'not-allowed';
        hoverIsInside = false;
        clearPreview();
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        return;
      }

      map.getCanvas().style.cursor = 'crosshair';
      hoverIsInside = true;
      lastHoverLat = lngLat.lat;
      lastHoverLon = lngLat.lng;
      updateDotPosition(lngLat.lng, lngLat.lat);

      // Draw a straight-line preview immediately
      const [unitLat, unitLng] = unitPositionRef.current;
      updateRouteLine([[unitLat, unitLng], [lngLat.lat, lngLat.lng]]);

      // Debounce the terrain route fetch
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        if (abortRef.current) abortRef.current.abort();
        abortRef.current = new AbortController();
        router.fetchRoute(unitLat, unitLng, lngLat.lat, lngLat.lng, mobilityClassRef.current)
          .then((route) => {
            if (!route) return;
            lastRouteRef.current = route;
            updateRouteLine(route.waypoints);
            const point = map.project(lngLat);
            const rect = map.getCanvas().getBoundingClientRect();
            setTooltipState({
              x: rect.left + point.x,
              y: rect.top + point.y,
              distanceKm: route.distanceKm,
              durationSec: route.durationSec,
            });
          })
          .catch(() => { /* silently ignore aborted / failed */ });
      }, 80);
    };

    /* ── Keyboard handler: Enter confirms, Escape cancels ─────────── */
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelRef.current();
        return;
      }

      if (e.key === 'Enter' && hoverIsInside) {
        e.preventDefault();
        const destLat = lastHoverLat;
        const destLon = lastHoverLon;
        const [unitLat, unitLng] = unitPositionRef.current;

        const makeFallback = (): import('@/shared/routing/types').OSRMRoute => {
          const dLat = destLat - unitLat;
          const dLng = destLon - unitLng;
          const distKm = Math.sqrt(
            (dLat * 111.32) ** 2 + (dLng * 111.32 * Math.cos(unitLat * Math.PI / 180)) ** 2,
          );
          return {
            waypoints: [[unitLat, unitLng], [destLat, destLon]],
            distanceKm: distKm,
            durationSec: (distKm / 5) * 3600,
          };
        };

        // Cancel pending fetches
        if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
        if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }

        // Use cached route if available, otherwise fetch fresh
        if (lastRouteRef.current) {
          onRouteConfirmedRef.current(lastRouteRef.current, [destLat, destLon]);
        } else {
          router.fetchRoute(unitLat, unitLng, destLat, destLon, mobilityClassRef.current)
            .then((route) => onRouteConfirmedRef.current(route ?? makeFallback(), [destLat, destLon]))
            .catch(() => onRouteConfirmedRef.current(makeFallback(), [destLat, destLon]));
        }
      }
    };

    map.on('mousemove', handleMouseMove);
    document.addEventListener('keydown', handleKeyDown);

    /* ── Cleanup ──────────────────────────────────────────────────── */
    return () => {
      map.off('mousemove', handleMouseMove);
      document.removeEventListener('keydown', handleKeyDown);
      map.getCanvas().style.cursor = '';

      // Cancel pending debounce & requests
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }

      clearPreview();
      cleanupMapLayers();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, map, mapContainer, envelope, router]);

  /* ── Render tooltip ─────────────────────────────────────────────── */
  return (
    <>
      {tooltipState && (
        <div
          className="route-preview-tooltip"
          style={{
            left: tooltipState.x + 15,
            top: tooltipState.y - 30,
            position: 'fixed',
            zIndex: 1001,
          }}
        >
          <div>📍 {tooltipState.distanceKm.toFixed(1)} km</div>
          <div>⏱ {formatDuration(tooltipState.durationSec)}</div>
        </div>
      )}
    </>
  );
};

export default RoutePreview;

