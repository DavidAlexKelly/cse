/**
 * OrbatMap — MapLibre GL JS map with Protomaps basemap.
 *
 * Tiles served from regional zoom-split PMTiles files in a Foundry dataset.
 *
 * File naming convention (SW corner of each cell):
 *   z0-z8.pmtiles              — full bbox, all zooms 0-8
 *   z9_{lon}E_{lat}N.pmtiles   — 2x2 grid
 *   z10_{lon}E_{lat}N.pmtiles  — 3x3 grid
 *   z11_{lon}E_{lat}N.pmtiles  — 4x4 grid
 *   z12_{lon}E_{lat}N.pmtiles  — 5x5 grid
 *
 * On each map move, we compute which regional cells overlap the viewport
 * and download only those files. Files are cached in memory after first download.
 *
 * Theatre bbox: 14-45°E, 44-72°N
 */

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import ms from "milsymbol";
import "maplibre-gl/dist/maplibre-gl.css";

import type { OUnit, OEdge, OSymbol, OSimulatorConfig } from "@/shared/types";
import { updateSymbolPositionFn } from "@/shared/lib/foundry";
import { initMgrsOverlay, removeMgrsOverlay, lngLatToMgrs, setGridEnabled } from "@/shared/components/MgrsOverlay";
import type { BasemapHandle } from "@acc/decho-basemap";
import { createTheatreBasemap } from "../../../shared/map/dechoBasemapSetup";

// ── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_CENTRE: [number, number] = [29.5, 69.5];
const DEFAULT_ZOOM = 8;
// MAX_ZOOM and BBOX used to be duplicated here to build the vector source by
// hand. Both now come from the library's THEATRE_STORE via styleFragment(),
// so the theatre extent is described in exactly one place.

// ── Military topographic flavor ─────────────────────────────────────────────

const MILITARY_TOPO = {
  ...namedFlavor("light"),
  background:             "#d6d3c4",
  earth:                  "#d6d3c4",
  wood_a:                 "#b5c99a",
  wood_b:                 "#a8bc8d",
  scrub_a:                "#c8d4a8",
  scrub_b:                "#bdc9a0",
  park_a:                 "#b8d4a8",
  park_b:                 "#aec9a0",
  beach:                  "#e8dfa0",
  glacier:                "#e8f0f8",
  military:               "#d4a0a0",
  water:                  "#8ab4cc",
  ocean_label:            "#4a7a9b",
  industrial:             "#c9bfb0",
  hospital:               "#f0d0d0",
  school:                 "#f0e8c0",
  highway:                "#d4892a",
  highway_casing_early:   "#b06820",
  highway_casing_late:    "#b06820",
  major:                  "#e8a840",
  major_casing_early:     "#c88820",
  major_casing_late:      "#c88820",
  minor_a:                "#d4c090",
  minor_b:                "#cdb880",
  minor_casing:           "#b8a070",
  boundaries:             "#8b5e3c",
  country_label:          "#3d2b1f",
  state_label:            "#5c3d2e",
  state_label_halo:       "#d6d3c4",
  city_label:             "#2c1f14",
  city_label_halo:        "#d6d3c4",
  roads_label_major:      "#5c3d1e",
  roads_label_major_halo: "#d6d3c4",
  roads_label_minor:      "#7a5c3e",
  roads_label_minor_halo: "#d6d3c4",
};

// (basemap protocols are registered by createTheatreBasemap, refcounted so
//  several maps can be alive at once)

// ─── Types ─────────────────────────────────────────────────────────────────

interface Props {
  units: Map<string, OUnit>;
  symbols: Map<string, OSymbol>;
  configs: Map<string, OSimulatorConfig>;
  edges: OEdge[];
  selectedUnitKey: string | null;
  placingUnitKey: string | null;
  onSelect: (unitKey: string) => void;
  onPositionUpdated: (unitKey: string, lat: number, lng: number) => void;
}

// ─── Milsymbol marker element ──────────────────────────────────────────────

function createMarkerElement(sidc: string, selected: boolean, entityType: string): HTMLDivElement {
  const size = entityType === "organisation" ? 32 : 24;
  const wrapper = document.createElement("div");
  wrapper.style.cursor = "pointer";
  wrapper.style.filter = selected ? "drop-shadow(0 0 4px #4fc3f7)" : "none";
  try {
    const sym = new ms.Symbol(sidc, { size, strokeWidth: selected ? 3 : 1.5 });
    wrapper.innerHTML = sym.asSVG();
  } catch {
    wrapper.innerHTML = `<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2-2}" fill="#1976d2" stroke="#fff" stroke-width="2"/></svg>`;
  }
  return wrapper;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function OrbatMap({ units, symbols, configs, edges, selectedUnitKey, placingUnitKey, onSelect, onPositionUpdated }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const symbolsRef = useRef(symbols);
  useEffect(() => { symbolsRef.current = symbols; }, [symbols]);
  const placingRef = useRef<string | null>(null);
  // Tracks positions updated via drag before the parent re-renders with new symbol data.
  // Prevents the sync-markers effect snapping markers back to stale coordinates.
  const pendingPositionsRef = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const [initError, setInitError] = useState<string | null>(null);
  const [mgrsCoord, setMgrsCoord] = useState<string>("");
  const [showGrid, setShowGrid] = useState(true);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);

  useEffect(() => { placingRef.current = placingUnitKey; }, [placingUnitKey]);

  // ── Initialise map once ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    // Owned by this effect so teardown is exact.
    let basemapHandle: BasemapHandle | null = null;
    let detachPrefetch: (() => void) | null = null;
    let unsubscribeStatus: (() => void) | null = null;

    (async () => {
      try {
        // Resolves the theatre store and registers the tile protocol AND the
        // glyph/sprite protocols. styleFragment() below supplies the source
        // plus the glyphs/sprite keys, which used to be a separate (and
        // easily forgotten) registerMapAssetProtocols call.
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

        // MGRS grid overlay
        initMgrsOverlay(map);

        // Live MGRS coordinate display
        map.on("mousemove", (e) => {
          setMgrsCoord(lngLatToMgrs(e.lngLat.lng, e.lngLat.lat));
        });
        map.on("mouseleave", () => setMgrsCoord(""));

        // Bounded neighbour prefetch, debounced internally. Replaces the
        // hand-rolled moveend/zoomend priority updates.
        detachPrefetch = basemap.attach(map);

        // Downloading indicator. onStatus hands back its own unsubscribe,
        // which is what makes the teardown below correct: the previous code
        // called offStatusChange with a NEWLY CONSTRUCTED arrow function, so
        // it never matched the registered listener and never removed it —
        // every mount leaked a listener that went on calling setLoadingFile
        // after unmount.
        unsubscribeStatus = basemap.onStatus((path, status) =>
          setLoadingFile(status === "downloading" ? path : null),
        );

        map.on("click", (e) => {
          const unitKey = placingRef.current;
          if (!unitKey) return;
          const { lat, lng } = e.lngLat;
          const symbol = symbols.get(unitKey);
          if (symbol) updateSymbolPositionFn(symbol.primaryKey, lat, lng).catch(console.error);
          onPositionUpdated(unitKey, lat, lng);
        });

        mapRef.current = map;
      } catch (err) {
        if (!cancelled) setInitError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) removeMgrsOverlay(mapRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current.clear();
      unsubscribeStatus?.();
      detachPrefetch?.();
      basemapHandle?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Build adjacency: parentUnitKey → direct child unit keys
    const directChildren = new Map<string, string[]>();
    for (const edge of edges) {
      const list = directChildren.get(edge.parentUnitKey) ?? [];
      list.push(edge.childUnitKey);
      directChildren.set(edge.parentUnitKey, list);
    }

    // For a sim-linked unit, recursively collect ALL descendants that should
    // appear in its hover popup (i.e. every descendant until we hit another
    // sim-linked unit, which gets its own marker).
    function collectSubordinatesForPopup(unitKey: string): OUnit[] {
      const results: OUnit[] = [];
      for (const childKey of directChildren.get(unitKey) ?? []) {
        const child = units.get(childKey);
        if (!child) continue;
        results.push(child);
        if (!child.simulatorIdentifierCode) {
          // Not sim-linked: keep recursing to collect its descendants too
          results.push(...collectSubordinatesForPopup(childKey));
        }
        // Sim-linked child: listed in popup but its subtree belongs to it
      }
      return results;
    }

    // Build the popup subordinate list for every sim-linked unit
    const childrenByUnit = new Map<string, OUnit[]>();
    for (const [unitKey, unit] of units) {
      if (unit.simulatorIdentifierCode) {
        childrenByUnit.set(unitKey, collectSubordinatesForPopup(unitKey));
      }
    }

    // Build the set of all unit keys that are "owned" by a sim-linked ancestor.
    // These must NOT get their own marker — they appear only in their owner's popup.
    const suppressedKeys = new Set<string>();
    function markSuppressed(unitKey: string): void {
      for (const childKey of directChildren.get(unitKey) ?? []) {
        suppressedKeys.add(childKey);
        const child = units.get(childKey);
        // Keep suppressing unless this child is itself sim-linked (it owns its subtree)
        if (!child?.simulatorIdentifierCode) {
          markSuppressed(childKey);
        }
      }
    }
    for (const [unitKey, unit] of units) {
      if (unit.simulatorIdentifierCode) {
        markSuppressed(unitKey);
      }
    }

    const existingKeys = new Set(markersRef.current.keys());
    const currentKeys = new Set<string>();

    for (const [unitKey, symbol] of symbols) {
      if (symbol.latitude === null || symbol.longitude === null) continue;
      if (symbol.latitude === 0 && symbol.longitude === 0) continue;

      const unit = units.get(unitKey);
      const config = configs.get(unitKey);
      if (!unit) continue;

      // Only show markers for sim-linked units that are not suppressed by a
      // sim-linked ancestor. Suppressed units appear in their ancestor's hover.
      if (!unit.simulatorIdentifierCode) continue;
      if (suppressedKeys.has(unitKey)) continue;

      const entityType = config?.entityType ?? unit.entityType ?? "vehicle";

      currentKeys.add(unitKey);
      const isSelected = unitKey === selectedUnitKey;
      const existingMarker = markersRef.current.get(unitKey);

      // Use the locally-dragged position if the parent hasn't caught up yet
      const pending = pendingPositionsRef.current.get(unitKey);
      const displayLat = pending?.lat ?? symbol.latitude;
      const displayLng = pending?.lng ?? symbol.longitude;
      // Once the parent's symbol data matches the dragged position, clear the pending entry
      if (pending && Math.abs(symbol.latitude - pending.lat) < 1e-8 && Math.abs(symbol.longitude - pending.lng) < 1e-8) {
        pendingPositionsRef.current.delete(unitKey);
      }

      // Build popup HTML — shared between new and existing markers
      const subordinates = childrenByUnit.get(unitKey) ?? [];
      const subordinatesHtml = subordinates.length > 0
        ? `<div style="margin-top:5px;border-top:1px solid #c0cad0;padding-top:4px;">
             <div style="font-size:10px;color:#3a5060;font-weight:600;margin-bottom:2px;">Subordinates (${subordinates.length})</div>
             ${subordinates.map((c) => `<div style="font-size:10px;color:#2a3a4a;padding-left:6px;">&middot; ${c.unitIdentifier || c.primaryKey}</div>`).join("")}
           </div>`
        : "";
      const assetHtml = unit.simulatorIdentifierCode
        ? `<div style="font-size:10px;color:#4a6070;margin-top:2px;">${unit.simulatorIdentifierCode}</div>`
        : "";
      const popupHtml = `<div style="font-size:12px;color:#1a2733;font-family:sans-serif;max-width:220px;">
        <strong>${unit.unitIdentifier}</strong>
        <br/><span style="font-size:10px;">${entityType} · ${config?.owningSimulator ?? ""}</span>
        ${assetHtml}${subordinatesHtml}
      </div>`;

      if (existingMarker) {
        existingMarker.setLngLat([displayLng, displayLat]);
        // Update element in-place (replaceWith detaches MapLibre's reference)
        const el = existingMarker.getElement() as HTMLDivElement;
        el.style.filter = isSelected ? "drop-shadow(0 0 4px #4fc3f7)" : "none";
        try {
          const sym = new ms.Symbol(unit.sidc, { size: 24, strokeWidth: isSelected ? 3 : 1.5 });
          el.innerHTML = sym.asSVG();
        } catch { /* leave existing SVG */ }
        // Rebuild popup so subordinate list stays current
        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 25 })
          .setHTML(popupHtml);
        el.onmouseenter = () => popup.addTo(map).setLngLat([displayLng, displayLat]);
        el.onmouseleave = () => popup.remove();
      } else {
        const el = createMarkerElement(unit.sidc, isSelected, entityType);
        el.addEventListener("click", (e) => { e.stopPropagation(); onSelect(unitKey); });

        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([displayLng, displayLat])
          .addTo(map);

        marker.on("dragend", () => {
          const { lat, lng } = marker.getLngLat();
          pendingPositionsRef.current.set(unitKey, { lat, lng });
          const currentSymbol = symbolsRef.current.get(unitKey);
          if (currentSymbol) updateSymbolPositionFn(currentSymbol.primaryKey, lat, lng).catch(console.error);
          onPositionUpdated(unitKey, lat, lng);
        });

        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 25 })
          .setHTML(popupHtml);

        el.addEventListener("mouseenter", () => popup.addTo(map).setLngLat([displayLng, displayLat]));
        el.addEventListener("mouseleave", () => popup.remove());

        markersRef.current.set(unitKey, marker);
      }
    }

    for (const key of existingKeys) {
      if (!currentKeys.has(key)) {
        markersRef.current.get(key)?.remove();
        markersRef.current.delete(key);
      }
    }
  }, [units, symbols, configs, selectedUnitKey, onSelect, onPositionUpdated]);

  // ── Fly to selected unit ─────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedUnitKey || !mapRef.current) return;
    const symbol = symbols.get(selectedUnitKey);
    if (!symbol?.latitude || !symbol?.longitude) return;
    if (symbol.latitude === 0 && symbol.longitude === 0) return;
    mapRef.current.flyTo({ center: [symbol.longitude, symbol.latitude], zoom: Math.max(mapRef.current.getZoom(), 12), duration: 800 });
  }, [selectedUnitKey, symbols]);

  // ── Cursor change when placing ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = placingUnitKey ? "crosshair" : "";
  }, [placingUnitKey]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {initError && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#1a2733", color: "#ef9a9a", fontSize: 13, padding: 24, textAlign: "center", zIndex: 5 }}>
          Map error: {initError}
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* MGRS coordinate display */}
      {mgrsCoord && (
        <div style={{
          position: "absolute", bottom: 32, left: 8,
          background: "rgba(0,0,0,0.75)", color: "#ff6600",
          fontFamily: "monospace", fontSize: 12,
          padding: "3px 8px", borderRadius: 3,
          pointerEvents: "none", zIndex: 10,
          letterSpacing: "0.05em",
        }}>
          {mgrsCoord}
        </div>
      )}

      {/* Tile loading indicator */}
      {loadingFile && (
        <div style={{
          position: "absolute", bottom: 32, right: 50,
          background: "rgba(0,0,0,0.7)", color: "#aaa",
          fontFamily: "monospace", fontSize: 11,
          padding: "3px 8px", borderRadius: 3,
          pointerEvents: "none", zIndex: 10,
        }}>
          ↓ {loadingFile}
        </div>
      )}

      {/* MGRS grid toggle */}
      <button
        onClick={() => {
          const next = !showGrid;
          setShowGrid(next);
          if (mapRef.current) setGridEnabled(mapRef.current, next);
        }}
        style={{
          position: "absolute", top: 120, right: 8,
          background: showGrid ? "rgba(255,102,0,0.85)" : "rgba(0,0,0,0.6)",
          color: "#fff", border: "none", borderRadius: 4,
          padding: "4px 8px", fontSize: 11, cursor: "pointer",
          fontFamily: "monospace", zIndex: 10,
        }}
        title="Toggle MGRS grid"
      >
        MGRS
      </button>

      {placingUnitKey && (
        <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", background: "#1565C0", color: "#fff", padding: "6px 14px", borderRadius: 4, fontSize: 13, pointerEvents: "none", zIndex: 10 }}>
          Click map to place: <strong>{units.get(placingUnitKey)?.unitIdentifier ?? placingUnitKey}</strong>
        </div>
      )}
    </div>
  );
}
