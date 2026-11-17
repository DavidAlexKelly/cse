// ── bgws/components/BuilderMap.tsx ─────────────────────────────────────────
// The builder's map: the area of operations as a box you drag out, placed
// units as draggable APP-6 symbols, objectives as draggable circles.
//
// Built on shared/hla/EntityMap so the basemap, controls and resize handling
// are the live map's own — with no entities, it is just the map — and the
// builder's layers are hung off its Leaflet instance through onMapReady, the
// same way hlamap's MapView adds obstacles and patrol lines. EntityMap's
// markers are not draggable, and placed units are not HLA entities yet, so
// they are drawn here.

import L from "leaflet";
import ms from "milsymbol";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import EntityMap from "@/shared/hla/EntityMap";
import { MAP } from "@/shared/hla/ui";
import type { Area, DraftObjective, LatLon, ScenarioUnit } from "../types";
import { areaFromCorners } from "../lib/geo";
import { sideColour, sidcForPlatform } from "../lib/symbols";

export type BuilderTool = "select" | "area" | "unit" | "objective";

interface Props {
  area: Area | null;
  units: ScenarioUnit[];
  objectives: DraftObjective[];
  selectedId: string | null;
  tool: BuilderTool;
  /** Changes whenever the map should re-frame on the area (load, import). */
  fitToken: number;
  onArea: (area: Area) => void;
  onPlace: (at: LatLon) => void;
  onSelect: (id: string | null) => void;
  onMoveUnit: (id: string, at: LatLon) => void;
  onMoveObjective: (id: string, at: LatLon) => void;
}

const iconCache = new Map<string, { html: string; w: number; h: number; ax: number; ay: number }>();

function unitIcon(unit: ScenarioUnit, selected: boolean): L.DivIcon {
  const sidc = sidcForPlatform(unit.platform, unit.side);
  let rendered = iconCache.get(sidc);
  if (!rendered) {
    try {
      const sym = new ms.Symbol(sidc, { size: 22, frame: true });
      const size = sym.getSize();
      rendered = {
        html: sym.asSVG(),
        w: size.width || 44,
        h: size.height || 44,
        ax: sym.getAnchor().x,
        ay: sym.getAnchor().y,
      };
    } catch {
      const c = sideColour(unit.side);
      rendered = {
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="10" fill="${c}" stroke="white"/></svg>`,
        w: 22,
        h: 22,
        ax: 11,
        ay: 11,
      };
    }
    iconCache.set(sidc, rendered);
  }
  const ring = selected
    ? `<div style="position:absolute;inset:-4px;border:2px dashed #fbbf24;border-radius:4px;pointer-events:none;"></div>`
    : "";
  const count =
    unit.count > 1
      ? `<div style="position:absolute;top:-4px;right:-8px;min-width:13px;height:13px;padding:0 2px;border-radius:7px;
           background:rgba(14,18,25,0.92);border:1px solid ${sideColour(unit.side)};color:${sideColour(unit.side)};
           font:700 9px/13px ${MAP.font};text-align:center;">×${unit.count}</div>`
      : "";
  return L.divIcon({
    html: `<div style="position:relative;display:inline-block;cursor:grab;">${ring}${rendered.html}${count}</div>`,
    iconSize: [rendered.w, rendered.h],
    iconAnchor: [rendered.ax, rendered.ay],
    className: "",
  });
}

function objectiveIcon(o: DraftObjective, selected: boolean): L.DivIcon {
  const c = sideColour(o.side);
  const html = `<div style="display:flex;align-items:center;gap:4px;cursor:grab;white-space:nowrap;">
      <div style="width:12px;height:12px;transform:rotate(45deg);border:2px solid ${selected ? "#fbbf24" : c};background:rgba(14,18,25,0.85);"></div>
      <span style="font:700 10px ${MAP.font};color:${c};text-shadow:0 0 3px #000;">${o.label.replace(/</g, "&lt;")}</span>
    </div>`;
  return L.divIcon({ html, iconSize: [0, 0], iconAnchor: [7, 7], className: "" });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const BuilderMap: FC<Props> = ({
  area,
  units,
  objectives,
  selectedId,
  tool,
  fitToken,
  onArea,
  onPlace,
  onSelect,
  onMoveUnit,
  onMoveObjective,
}) => {
  const [map, setMap] = useState<L.Map | null>(null);
  const areaLayer = useRef<L.Rectangle | null>(null);
  const unitMarkers = useRef(new Map<string, { marker: L.Marker; sig: string }>());
  const objectiveLayers = useRef(new Map<string, { marker: L.Marker; circle: L.Circle; sig: string }>());

  // Handlers through refs: Leaflet listeners outlive renders.
  const cb = useRef({ onArea, onPlace, onSelect, onMoveUnit, onMoveObjective, tool });
  cb.current = { onArea, onPlace, onSelect, onMoveUnit, onMoveObjective, tool };

  // ── Drag out the area ─────────────────────────────────────────────────────
  // Map panning is switched off for the duration of the drag, or the gesture
  // would pan the map instead of drawing.
  useEffect(() => {
    if (!map) return;
    let start: L.LatLng | null = null;
    let preview: L.Rectangle | null = null;
    const down = (e: L.LeafletMouseEvent) => {
      if (cb.current.tool !== "area") return;
      start = e.latlng;
      map.dragging.disable();
      preview?.remove();
      preview = L.rectangle(L.latLngBounds(start, start), {
        color: MAP.amber,
        weight: 2,
        dashArray: "6 4",
        fillOpacity: 0.05,
        interactive: false,
      }).addTo(map);
    };
    const move = (e: L.LeafletMouseEvent) => {
      if (start && preview) preview.setBounds(L.latLngBounds(start, e.latlng));
    };
    const up = (e: L.LeafletMouseEvent) => {
      if (!start) return;
      const a = { lat: start.lat, lon: start.lng };
      const b = { lat: e.latlng.lat, lon: e.latlng.lng };
      start = null;
      preview?.remove();
      preview = null;
      map.dragging.enable();
      // A click without a drag is not an area.
      if (Math.abs(a.lat - b.lat) > 1e-4 && Math.abs(a.lon - b.lon) > 1e-4) cb.current.onArea(areaFromCorners(a, b));
    };
    map.on("mousedown", down);
    map.on("mousemove", move);
    map.on("mouseup", up);
    return () => {
      map.off("mousedown", down);
      map.off("mousemove", move);
      map.off("mouseup", up);
      preview?.remove();
      map.dragging.enable();
    };
  }, [map]);

  // ── Area box ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    areaLayer.current?.remove();
    areaLayer.current = null;
    if (area) {
      areaLayer.current = L.rectangle(
        [
          [area.south, area.west],
          [area.north, area.east],
        ],
        { color: MAP.accent, weight: 2, fillOpacity: 0.04, interactive: false },
      ).addTo(map);
    }
  }, [map, area]);

  // ── Re-frame on request ───────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !area) return;
    map.fitBounds(
      [
        [area.south, area.west],
        [area.north, area.east],
      ],
      { padding: [40, 40] },
    );
    // Only on an explicit request, never on every edit of the area.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitToken]);

  // ── Units ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    const held = unitMarkers.current;
    const ids = new Set(units.map((u) => u.id));
    for (const [id, { marker }] of held) {
      if (!ids.has(id)) {
        marker.remove();
        held.delete(id);
      }
    }
    for (const unit of units) {
      if (!Number.isFinite(unit.lat) || !Number.isFinite(unit.lon)) continue;
      const selected = unit.id === selectedId;
      const sig = `${unit.platform}|${unit.side}|${unit.count}|${selected}|${unit.label}`;
      const existing = held.get(unit.id);
      if (existing) {
        existing.marker.setLatLng([unit.lat, unit.lon]);
        if (existing.sig !== sig) {
          existing.marker.setIcon(unitIcon(unit, selected));
          existing.marker.setTooltipContent(escapeHtml(unit.label));
          existing.sig = sig;
        }
        continue;
      }
      const marker = L.marker([unit.lat, unit.lon], { icon: unitIcon(unit, selected), draggable: true, bubblingMouseEvents: false })
        .addTo(map)
        .bindTooltip(escapeHtml(unit.label));
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        cb.current.onSelect(unit.id);
      });
      marker.on("dragstart", () => cb.current.onSelect(unit.id));
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        cb.current.onMoveUnit(unit.id, { lat: p.lat, lon: p.lng });
      });
      held.set(unit.id, { marker, sig });
    }
  }, [map, units, selectedId]);

  // ── Objectives ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    const held = objectiveLayers.current;
    const ids = new Set(objectives.map((o) => o.id));
    for (const [id, layer] of held) {
      if (!ids.has(id)) {
        layer.marker.remove();
        layer.circle.remove();
        held.delete(id);
      }
    }
    for (const o of objectives) {
      if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
      const selected = o.id === selectedId;
      const sig = `${o.side}|${o.label}|${selected}`;
      const existing = held.get(o.id);
      if (existing) {
        existing.marker.setLatLng([o.lat, o.lon]);
        existing.circle.setLatLng([o.lat, o.lon]);
        existing.circle.setRadius(Math.max(1, o.radiusM));
        if (existing.sig !== sig) {
          existing.marker.setIcon(objectiveIcon(o, selected));
          existing.circle.setStyle({ color: sideColour(o.side) });
          existing.sig = sig;
        }
        continue;
      }
      const circle = L.circle([o.lat, o.lon], {
        radius: Math.max(1, o.radiusM),
        color: sideColour(o.side),
        weight: 1.5,
        dashArray: "4 4",
        fillOpacity: 0.06,
        interactive: false,
      }).addTo(map);
      const marker = L.marker([o.lat, o.lon], { icon: objectiveIcon(o, selected), draggable: true, bubblingMouseEvents: false }).addTo(map);
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        cb.current.onSelect(o.id);
      });
      marker.on("drag", () => circle.setLatLng(marker.getLatLng()));
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        cb.current.onMoveObjective(o.id, { lat: p.lat, lon: p.lng });
      });
      held.set(o.id, { marker, circle, sig });
    }
  }, [map, objectives, selectedId]);

  // Teardown when the map goes (EntityMap removes the map; drop our handles).
  useEffect(() => {
    if (map) return;
    unitMarkers.current.clear();
    objectiveLayers.current.clear();
    areaLayer.current = null;
  }, [map]);

  const handleMapClick = useCallback((at: LatLon) => {
    const t = cb.current.tool;
    if (t === "unit" || t === "objective") cb.current.onPlace(at);
    else if (t === "select") cb.current.onSelect(null);
  }, []);

  const banner =
    tool === "area"
      ? "DRAG A BOX TO SET THE AREA OF OPERATIONS"
      : tool === "unit"
        ? "CLICK TO PLACE A UNIT"
        : tool === "objective"
          ? "CLICK TO PLACE AN OBJECTIVE"
          : !area
            ? "DRAW THE AREA FIRST — CHOOSE “AREA” ABOVE"
            : undefined;

  return (
    <EntityMap
      entities={[]}
      selectedId={null}
      onEntityClick={() => undefined}
      onMapClick={handleMapClick}
      crosshair={tool !== "select"}
      banner={banner}
      onMapReady={setMap}
    />
  );
};

export default BuilderMap;
