// components/CompositionMapPlacer.tsx
/**
 * CompositionMapPlacer — lightweight map for clicking a placement point.
 * Reuses the same MapLibre + PMTiles setup as OrbatMap.
 * Shows a single draggable marker for the root unit position,
 * plus ghost markers for child units auto-offset around it.
 */
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import ms from "milsymbol";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CompositionNode } from "../../../types";
import {
  initMgrsOverlay,
  removeMgrsOverlay,
  lngLatToMgrs,
} from "../../Map/MgrsOverlay";
import type { BasemapHandle } from "@acc/decho-basemap";
import { createTheatreBasemap } from "../../../shared/map/dechoBasemapSetup";

interface Props {
  placementLat: number | null;
  placementLng: number | null;
  compositionRoot: CompositionNode;
  onMapClick: (lat: number, lng: number) => void;
}

const DEFAULT_CENTRE: [number, number] = [25.95, 59.26]; // Tapa, Estonia
const DEFAULT_ZOOM = 11;

// Auto-offset child units in a ring around the root
function computeChildOffsets(
  root: CompositionNode,
  rootLat: number,
  rootLng: number
): Array<{ node: CompositionNode; lat: number; lng: number }> {
  const results: Array<{ node: CompositionNode; lat: number; lng: number }> =
    [];
  const count = root.children.length;
  if (count === 0) return results;

  const radiusDeg = 0.002; // ~200m
  root.children.forEach((child, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    const lat = rootLat + radiusDeg * Math.sin(angle);
    const lng =
      rootLng +
      (radiusDeg / Math.cos((rootLat * Math.PI) / 180)) * Math.cos(angle);
    results.push({ node: child, lat, lng });
  });
  return results;
}

const MILITARY_TOPO = {
  ...namedFlavor("light"),
  background: "#d6d3c4",
  earth: "#d6d3c4",
  water: "#8ab4cc",
  wood_a: "#b5c99a",
  wood_b: "#a8bc8d",
};

// This component used to register its own copy of the "foundry-pmtiles"
// protocol inline, bypassing the shared registration entirely — so whichever
// of the two ran last won, and neither knew about the other. It now uses the
// same refcounted registration as every other map in the app.

export function CompositionMapPlacer({
  placementLat,
  placementLng,
  compositionRoot,
  onMapClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rootMarkerRef = useRef<maplibregl.Marker | null>(null);
  const childMarkersRef = useRef<maplibregl.Marker[]>([]);
  const [mgrsCoord, setMgrsCoord] = useState("");
  const [initError, setInitError] = useState<string | null>(null);

  // ── Init map ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let basemapHandle: BasemapHandle | null = null;

    (async () => {
      try {
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
        map.addControl(
          new maplibregl.ScaleControl({ maxWidth: 160, unit: "metric" }),
          "bottom-right"
        );

        initMgrsOverlay(map);

        map.on("mousemove", (e) => {
          setMgrsCoord(lngLatToMgrs(e.lngLat.lng, e.lngLat.lat));
        });

        map.on("click", (e) => {
          onMapClick(e.lngLat.lat, e.lngLat.lng);
        });

        mapRef.current = map;
      } catch (err) {
        if (!cancelled)
          setInitError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      // This component previously registered its protocol inline and never
      // released it, so the registration outlived every mount.
      basemapHandle?.dispose();
      if (mapRef.current) {
        removeMgrsOverlay(mapRef.current);
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync root marker ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old child markers
    childMarkersRef.current.forEach((m) => m.remove());
    childMarkersRef.current = [];

    if (placementLat === null || placementLng === null) {
      rootMarkerRef.current?.remove();
      rootMarkerRef.current = null;
      return;
    }

    // Root marker
    if (rootMarkerRef.current) {
      rootMarkerRef.current.setLngLat([placementLng, placementLat]);
    } else {
      const el = makeMarkerEl(compositionRoot.sidc, true);
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([placementLng, placementLat])
        .addTo(map);
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat();
        onMapClick(lat, lng);
      });
      rootMarkerRef.current = marker;
    }

    // Child ghost markers
    const offsets = computeChildOffsets(
      compositionRoot,
      placementLat,
      placementLng
    );
    offsets.forEach(({ node, lat, lng }) => {
      const el = makeMarkerEl(node.sidc, false);
      el.style.opacity = "0.5";
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
      childMarkersRef.current.push(m);
    });

    // Fly to placement
    map.flyTo({
      center: [placementLng, placementLat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 600,
    });
  }, [placementLat, placementLng, compositionRoot, onMapClick]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {initError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#1a2733",
            color: "#ef9a9a",
            fontSize: 13,
            padding: 24,
            textAlign: "center",
            zIndex: 5,
          }}
        >
          Map error: {initError}
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Click hint */}
      {placementLat === null && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(21,101,192,0.9)",
            color: "#fff",
            padding: "6px 14px",
            borderRadius: 4,
            fontSize: 13,
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          Click map to set placement point
        </div>
      )}

      {/* MGRS readout */}
      {mgrsCoord && (
        <div
          style={{
            position: "absolute",
            bottom: 32,
            left: 8,
            background: "rgba(0,0,0,0.75)",
            color: "#ff6600",
            fontFamily: "monospace",
            fontSize: 12,
            padding: "3px 8px",
            borderRadius: 3,
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          {mgrsCoord}
        </div>
      )}
    </div>
  );
}

function makeMarkerEl(sidc: string, isRoot: boolean): HTMLDivElement {
  const size = isRoot ? 32 : 22;
  const el = document.createElement("div");
  el.style.cursor = isRoot ? "move" : "default";
  try {
    const sym = new ms.Symbol(sidc, {
      size,
      strokeWidth: isRoot ? 2.5 : 1.5,
    });
    el.innerHTML = sym.asSVG();
  } catch {
    el.innerHTML = `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="#1976d2" stroke="#fff" stroke-width="2"/></svg>`;
  }
  return el;
}
