// src/apps/scenarioPlanner/map/orbatLevelLayer.ts
//
// One GeoJSON symbol layer that draws the phase ORBAT at the selected level —
// the frontier from shared/orbat/orbatLevels.ts — with APP-6 symbols from
// milsymbol and a label under each.
//
// Why a layer and not DOM markers (which placed units use): a division at
// company level is hundreds of symbols, and hundreds of DOM markers re-laid on
// every frame of a zoom is what makes a map stutter. One layer is one draw.
//
// Robustness, learnt the hard way on this map:
//   • Never return early because the style is "not loaded yet" and hope to be
//     called again — draw now, retry once on `idle`, and re-add after any
//     style swap (`styledata`). The basemap swaps styles; layers do not survive
//     that on their own.
//   • Drag previews are done here, on the cached GeoJSON, not through React:
//     a mousemove-rate React update of a 3,000-node forest is not free.
import type maplibregl from "maplibre-gl";
import ms from "milsymbol";

export const ORBAT_LEVEL_SOURCE = "orbat-level";
export const ORBAT_LEVEL_LAYER = "orbat-level-symbols";
const HALO_LAYER = "orbat-level-halo";
const LABEL_LAYER = "orbat-level-labels";
const SYMBOL_SIZE = 26;

export interface OrbatLevelFeature {
  key: string;
  label: string;
  sidc: string;
  lat: number;
  lng: number;
  selected?: boolean;
}

export interface OrbatLevelHandlers {
  onClick?: (key: string, point: { x: number; y: number }) => void;
  onContext?: (key: string, point: { x: number; y: number }) => void;
  /** Fired once on release after a drag. Not fired for a plain click. */
  onDrop?: (key: string, lat: number, lng: number) => void;
}

interface LayerState {
  features: OrbatLevelFeature[];
  font: string[];
  draggable: boolean;
  handlers: { current: OrbatLevelHandlers };
  detach: () => void;
}

const states = new WeakMap<maplibregl.Map, LayerState>();

function imageId(sidc: string): string {
  return `orbat-sym-${sidc}`;
}

/**
 * Register the symbol image for a SIDC.
 *
 * milsymbol's anchor (the centre of the frame's octagon) is not the image
 * centre — an echelon glyph or HQ staff adds height on one side. The symbol is
 * re-drawn onto a canvas padded so the anchor IS the centre, which lets the
 * layer use a plain centred icon with no per-feature offset.
 */
function ensureImage(map: maplibregl.Map, sidc: string): void {
  const id = imageId(sidc);
  if (map.hasImage(id)) return;
  try {
    const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const sym = new ms.Symbol(sidc || "SUGP-----------", { size: SYMBOL_SIZE });
    const anchor = sym.getOctagonAnchor();
    const size = sym.getSize();
    const source = sym.asCanvas(ratio);
    const halfW = Math.max(anchor.x, size.width - anchor.x);
    const halfH = Math.max(anchor.y, size.height - anchor.y);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(2 * halfW * ratio);
    canvas.height = Math.ceil(2 * halfH * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(source, (halfW - anchor.x) * ratio, (halfH - anchor.y) * ratio);
    map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
  } catch (err) {
    console.warn(`[orbatLevelLayer] could not draw symbol ${sidc}:`, err);
  }
}

function toGeoJson(map: maplibregl.Map, features: OrbatLevelFeature[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => {
      ensureImage(map, f.sidc);
      return {
        type: "Feature",
        id: f.key,
        geometry: { type: "Point", coordinates: [f.lng, f.lat] },
        properties: {
          key: f.key,
          label: f.label,
          icon: imageId(f.sidc),
          selected: !!f.selected,
        },
      };
    }),
  };
}

function ensureLayers(map: maplibregl.Map, state: LayerState): void {
  if (!map.getSource(ORBAT_LEVEL_SOURCE)) {
    map.addSource(ORBAT_LEVEL_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getLayer(HALO_LAYER)) {
    map.addLayer({
      id: HALO_LAYER,
      type: "circle",
      source: ORBAT_LEVEL_SOURCE,
      filter: ["==", ["get", "selected"], true],
      paint: {
        "circle-radius": SYMBOL_SIZE * 0.85,
        "circle-color": "#2fbf71",
        "circle-opacity": 0.25,
        "circle-stroke-color": "#2fbf71",
        "circle-stroke-width": 2,
      },
    });
  }
  if (!map.getLayer(ORBAT_LEVEL_LAYER)) {
    map.addLayer({
      id: ORBAT_LEVEL_LAYER,
      type: "symbol",
      source: ORBAT_LEVEL_SOURCE,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }
  if (!map.getLayer(LABEL_LAYER)) {
    map.addLayer({
      id: LABEL_LAYER,
      type: "symbol",
      source: ORBAT_LEVEL_SOURCE,
      minzoom: 8,
      layout: {
        "text-field": ["get", "label"],
        "text-font": state.font,
        "text-size": 10,
        "text-offset": [0, 1.9],
        "text-anchor": "top",
        "text-max-width": 10,
        "text-optional": true,
      },
      paint: {
        "text-color": "#e8ecf4",
        "text-halo-color": "rgba(10,14,20,0.85)",
        "text-halo-width": 1.4,
      },
    });
  }
}

function draw(map: maplibregl.Map, state: LayerState): void {
  try {
    ensureLayers(map, state);
    const source = map.getSource(ORBAT_LEVEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(toGeoJson(map, state.features));
  } catch (err) {
    // Typically "style is not done loading": the idle/styledata hooks retry.
    console.debug("[orbatLevelLayer] draw deferred:", err);
  }
}

function attach(map: maplibregl.Map, state: LayerState): () => void {
  const keyAt = (e: maplibregl.MapLayerMouseEvent): string | null =>
    (e.features?.[0]?.properties?.key as string | undefined) ?? null;

  const onClick = (e: maplibregl.MapLayerMouseEvent) => {
    const key = keyAt(e);
    if (key) state.handlers.current.onClick?.(key, e.point);
  };
  const onContext = (e: maplibregl.MapLayerMouseEvent) => {
    const key = keyAt(e);
    if (!key) return;
    e.preventDefault();
    state.handlers.current.onContext?.(key, e.point);
  };
  const onEnter = () => {
    map.getCanvas().style.cursor = state.draggable ? "grab" : "pointer";
  };
  const onLeave = () => {
    map.getCanvas().style.cursor = "";
  };

  // ── Drag ──────────────────────────────────────────────────────────────────
  let dragging: { key: string; moved: boolean } | null = null;
  const onDown = (e: maplibregl.MapLayerMouseEvent) => {
    if (!state.draggable || e.originalEvent.button !== 0) return;
    const key = keyAt(e);
    if (!key) return;
    e.preventDefault();
    dragging = { key, moved: false };
    map.dragPan.disable();
    map.getCanvas().style.cursor = "grabbing";
    map.on("mousemove", onMove);
    map.once("mouseup", onUp);
  };
  const onMove = (e: maplibregl.MapMouseEvent) => {
    if (!dragging) return;
    dragging.moved = true;
    const f = state.features.find((x) => x.key === dragging!.key);
    if (!f) return;
    f.lat = e.lngLat.lat;
    f.lng = e.lngLat.lng;
    draw(map, state);
  };
  const onUp = (e: maplibregl.MapMouseEvent) => {
    map.off("mousemove", onMove);
    map.dragPan.enable();
    map.getCanvas().style.cursor = "";
    const done = dragging;
    dragging = null;
    if (done?.moved) state.handlers.current.onDrop?.(done.key, e.lngLat.lat, e.lngLat.lng);
  };

  const onIdleOnce = () => draw(map, state);
  const onStyleData = () => {
    if (!map.getLayer(ORBAT_LEVEL_LAYER)) draw(map, state);
  };

  map.on("click", ORBAT_LEVEL_LAYER, onClick);
  map.on("contextmenu", ORBAT_LEVEL_LAYER, onContext);
  map.on("mouseenter", ORBAT_LEVEL_LAYER, onEnter);
  map.on("mouseleave", ORBAT_LEVEL_LAYER, onLeave);
  map.on("mousedown", ORBAT_LEVEL_LAYER, onDown);
  map.on("styledata", onStyleData);
  map.once("idle", onIdleOnce);

  return () => {
    map.off("click", ORBAT_LEVEL_LAYER, onClick);
    map.off("contextmenu", ORBAT_LEVEL_LAYER, onContext);
    map.off("mouseenter", ORBAT_LEVEL_LAYER, onEnter);
    map.off("mouseleave", ORBAT_LEVEL_LAYER, onLeave);
    map.off("mousedown", ORBAT_LEVEL_LAYER, onDown);
    map.off("styledata", onStyleData);
    map.off("idle", onIdleOnce);
    map.off("mousemove", onMove);
  };
}

/**
 * Draw (or update) the level layer. Safe to call on every render: listeners
 * are attached once per map, data is replaced in place.
 */
export function syncOrbatLevelLayer(
  map: maplibregl.Map,
  features: OrbatLevelFeature[],
  options: { font: string[]; draggable: boolean; handlers: { current: OrbatLevelHandlers } },
): void {
  let state = states.get(map);
  if (!state) {
    state = {
      features: [],
      font: options.font,
      draggable: options.draggable,
      handlers: options.handlers,
      detach: () => {},
    };
    state.detach = attach(map, state);
    states.set(map, state);
  }
  // Copies: the drag preview mutates these in place.
  state.features = features.map((f) => ({ ...f }));
  state.draggable = options.draggable;
  state.handlers = options.handlers;
  draw(map, state);
}

/** Remove the layer and its listeners (e.g. the level view is switched off). */
export function clearOrbatLevelLayer(map: maplibregl.Map): void {
  const state = states.get(map);
  if (!state) return;
  state.detach();
  states.delete(map);
  for (const id of [LABEL_LAYER, ORBAT_LEVEL_LAYER, HALO_LAYER]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(ORBAT_LEVEL_SOURCE)) map.removeSource(ORBAT_LEVEL_SOURCE);
}

/** True when a screen point hits a level-view unit — map-wide handlers should ignore it. */
export function hitsOrbatLevelLayer(map: maplibregl.Map, point: maplibregl.PointLike): boolean {
  if (!map.getLayer(ORBAT_LEVEL_LAYER)) return false;
  return map.queryRenderedFeatures(point, { layers: [ORBAT_LEVEL_LAYER] }).length > 0;
}
