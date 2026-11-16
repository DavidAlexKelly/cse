// ── bgws/components/LiveMap.tsx ────────────────────────────────────────────
// The live map: shared/hla/EntityMap drawing the track stream, plus what only
// this screen needs — the loaded scenario's area and objectives for context,
// the click routing for orders that take a point or a target, a patrol
// preview, and a marker on the event last clicked in the events panel.

import L from "leaflet";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import EntityMap from "@/shared/hla/EntityMap";
import { MAP } from "@/shared/hla/ui";
import type { Area, HlaEntity, LatLon, ScenarioObjective } from "../types";
import { sideColour } from "../lib/symbols";

export type PickMode =
  | { kind: "none" }
  | { kind: "move" }
  | { kind: "patrol"; waypoints: LatLon[] }
  | { kind: "magicMove"; headingDeg: number }
  | { kind: "fireAtLocation"; durationS: number }
  | { kind: "fireAtEntity" };

interface Props {
  entities: HlaEntity[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Dim entities that are not BGWS's when everything is shown. */
  isFaded?: (entity: HlaEntity) => boolean;
  pickMode: PickMode;
  onPickPoint: (at: LatLon) => void;
  onPickTarget: (entity: HlaEntity) => void;
  area: Area | null;
  objectives: ScenarioObjective[];
  /** A point to fly to and mark (from the events panel); changes key re-fly. */
  focus: { at: LatLon; key: number } | null;
}

const LiveMap: FC<Props> = ({
  entities,
  selectedId,
  onSelect,
  isFaded,
  pickMode,
  onPickPoint,
  onPickTarget,
  area,
  objectives,
  focus,
}) => {
  const [map, setMap] = useState<L.Map | null>(null);
  const contextLayers = useRef<L.Layer[]>([]);
  const patrolLine = useRef<L.Polyline | null>(null);
  const focusMarker = useRef<L.CircleMarker | null>(null);

  const pickRef = useRef(pickMode);
  pickRef.current = pickMode;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const handleEntityClick = useCallback(
    (entity: HlaEntity) => {
      if (pickRef.current.kind === "fireAtEntity") {
        if (entity.id !== selectedRef.current) onPickTarget(entity);
        return;
      }
      onSelect(selectedRef.current === entity.id ? null : entity.id);
    },
    [onPickTarget, onSelect],
  );

  const handleMapClick = useCallback(
    (at: LatLon) => {
      const kind = pickRef.current.kind;
      if (kind === "none" || kind === "fireAtEntity") return;
      onPickPoint(at);
    },
    [onPickPoint],
  );

  const isTargetable = useCallback(
    (entity: HlaEntity) => pickMode.kind === "fireAtEntity" && entity.id !== selectedId,
    [pickMode.kind, selectedId],
  );

  // ── Scenario context: area box and objectives ─────────────────────────────
  useEffect(() => {
    if (!map) return;
    contextLayers.current.forEach((l) => l.remove());
    const layers: L.Layer[] = [];
    if (area) {
      layers.push(
        L.rectangle(
          [
            [area.south, area.west],
            [area.north, area.east],
          ],
          { color: MAP.accent, weight: 1, dashArray: "6 6", fill: false, interactive: false },
        ),
      );
    }
    for (const o of objectives) {
      layers.push(
        L.circle([o.lat, o.lon], {
          radius: o.radiusM,
          color: sideColour(o.side),
          weight: 1.5,
          dashArray: "4 4",
          fillOpacity: 0.05,
          interactive: false,
        }).bindTooltip(o.label, { permanent: true, direction: "center", className: "", opacity: 0.8 }),
      );
    }
    layers.forEach((l) => l.addTo(map));
    contextLayers.current = layers;
  }, [map, area, objectives]);

  // Frame the scenario area the first time there is one and nothing else to frame.
  const framedRef = useRef(false);
  useEffect(() => {
    if (!map || !area || framedRef.current || entities.length > 0) return;
    framedRef.current = true;
    map.fitBounds(
      [
        [area.south, area.west],
        [area.north, area.east],
      ],
      { padding: [40, 40] },
    );
  }, [map, area, entities.length]);

  // ── Patrol preview ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    patrolLine.current?.remove();
    patrolLine.current = null;
    if (pickMode.kind === "patrol" && pickMode.waypoints.length > 0) {
      const start = entities.find((e) => e.id === selectedId);
      const points: L.LatLngExpression[] = [
        ...(start ? [[start.lat, start.lon] as L.LatLngExpression] : []),
        ...pickMode.waypoints.map((w): L.LatLngExpression => [w.lat, w.lon]),
      ];
      patrolLine.current = L.polyline(points, { color: MAP.amber, weight: 2, dashArray: "4 4" }).addTo(map);
    }
  }, [map, pickMode, entities, selectedId]);

  // ── Focus on an event ────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !focus) return;
    focusMarker.current?.remove();
    focusMarker.current = L.circleMarker([focus.at.lat, focus.at.lon], {
      radius: 14,
      color: MAP.amber,
      weight: 2,
      fillOpacity: 0.15,
      interactive: false,
    }).addTo(map);
    map.flyTo([focus.at.lat, focus.at.lon], Math.max(map.getZoom(), 13), { duration: 0.6 });
  }, [map, focus]);

  const banner =
    pickMode.kind === "none"
      ? undefined
      : pickMode.kind === "fireAtEntity"
        ? "CLICK THE TARGET UNIT"
        : pickMode.kind === "patrol"
          ? `CLICK WAYPOINTS (${pickMode.waypoints.length}) — THEN “SEND PATROL”`
          : "CLICK THE MAP TO SET THE LOCATION";

  return (
    <EntityMap
      entities={entities}
      selectedId={selectedId}
      onEntityClick={handleEntityClick}
      isTargetable={isTargetable}
      isFaded={isFaded}
      rollupDisabled={pickMode.kind === "fireAtEntity"}
      onMapClick={handleMapClick}
      crosshair={pickMode.kind !== "none"}
      rolledUpHint="zoom in to order them"
      banner={banner}
      onMapReady={setMap}
    />
  );
};

export default LiveMap;
