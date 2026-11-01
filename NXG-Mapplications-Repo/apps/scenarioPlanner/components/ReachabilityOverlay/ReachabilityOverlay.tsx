import React, { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { createReachabilityMask } from '@/shared/routing/envelopeGeometry';
import type { GeoJSONPolygonFeature } from '@/shared/routing/envelopeGeometry';
import type { GeoJsonFeature } from '@/shared/routing/types';

/* ------------------------------------------------------------------ */
/*  Colours                                                            */
/*  - Red mask outside the envelope (unreachable)                      */
/*  - Blue transparent fill inside (reachable terrain visible through) */
/* ------------------------------------------------------------------ */

const REACHABLE_FILL = 'rgba(40, 120, 255, 0.25)';
const REACHABLE_BORDER = '#1a75ff';
const CONTOUR_COLOUR = 'rgba(255, 255, 255, 0.9)';
const UNREACHABLE_FILL = 'rgba(160, 20, 20, 0.4)';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ReachabilityOverlayProps {
  map: maplibregl.Map | null;
  envelope: GeoJSONPolygonFeature | GeoJsonFeature | null;
  impassableWithinEnvelope?: GeoJsonFeature | null;
  contours: (GeoJSONPolygonFeature | GeoJsonFeature)[];
  isActive: boolean;
  orderCategory?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const ReachabilityOverlay: React.FC<ReachabilityOverlayProps> = ({
  map,
  envelope,
  impassableWithinEnvelope,
  contours,
  isActive,
}) => {
  const addedRef = useRef<{ layers: string[]; sources: string[] }>({
    layers: [],
    sources: [],
  });

  useEffect(() => {
    if (!map) return;

    const cleanup = () => {
      const { layers, sources } = addedRef.current;
      try {
        for (let i = layers.length - 1; i >= 0; i--) {
          if (map.getLayer(layers[i])) map.removeLayer(layers[i]);
        }
        for (let i = sources.length - 1; i >= 0; i--) {
          if (map.getSource(sources[i])) map.removeSource(sources[i]);
        }
      } catch { /* map may be disposed */ }
      addedRef.current = { layers: [], sources: [] };
    };

    if (!isActive || !envelope) {
      cleanup();
      return;
    }

    // Clean up previous layers before adding new ones
    cleanup();

    const layers: string[] = [];
    const sources: string[] = [];

    /* ── 1. Red mask — everything OUTSIDE the envelope ─────────── */
    const coords = envelope.geometry.type === 'Polygon'
      ? envelope.geometry.coordinates
      : envelope.geometry.coordinates[0]; // MultiPolygon — use first polygon
    const mask = createReachabilityMask(coords as [number, number][][]);
    map.addSource('reach-mask', { type: 'geojson', data: mask as GeoJSON.Feature });
    sources.push('reach-mask');

    map.addLayer({
      id: 'reach-mask-fill',
      type: 'fill',
      source: 'reach-mask',
      paint: { 'fill-color': UNREACHABLE_FILL },
    });
    layers.push('reach-mask-fill');

    /* ── 2. Blue fill — the reachable envelope ─────────────────── */
    map.addSource('reach-env', { type: 'geojson', data: envelope as GeoJSON.Feature });
    sources.push('reach-env');

    map.addLayer({
      id: 'reach-fill',
      type: 'fill',
      source: 'reach-env',
      paint: { 'fill-color': REACHABLE_FILL },
    });
    layers.push('reach-fill');

    map.addLayer({
      id: 'reach-border',
      type: 'line',
      source: 'reach-env',
      paint: {
        'line-color': REACHABLE_BORDER,
        'line-width': 3,
      },
    });
    layers.push('reach-border');

    /* ── 2b. Red fill — impassable areas within envelope ──────── */
    if (impassableWithinEnvelope) {
      map.addSource('reach-impassable', {
        type: 'geojson',
        data: impassableWithinEnvelope as unknown as GeoJSON.Feature,
      });
      sources.push('reach-impassable');

      map.addLayer({
        id: 'reach-impassable-fill',
        type: 'fill',
        source: 'reach-impassable',
        paint: { 'fill-color': UNREACHABLE_FILL },
      });
      layers.push('reach-impassable-fill');
    }

    /* ── 3. Contour time rings ─────────────────────────────────── */
    contours.forEach((contour, i) => {
      const sid = `reach-contour-${i}`;
      const lid = `reach-contour-line-${i}`;
      map.addSource(sid, { type: 'geojson', data: contour as GeoJSON.Feature });
      sources.push(sid);
      map.addLayer({
        id: lid,
        type: 'line',
        source: sid,
        paint: {
          'line-color': CONTOUR_COLOUR,
          'line-width': 1.5,
          'line-dasharray': [6, 4],
        },
      });
      layers.push(lid);
    });

    addedRef.current = { layers, sources };
    return cleanup;
  }, [map, envelope, impassableWithinEnvelope, contours, isActive]);

  return null;
};

export default ReachabilityOverlay;
