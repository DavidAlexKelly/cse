// ── hlamap/components/MapView.tsx ─────────────────────────────────────────
// The live federation map: shared/hla/EntityMap plus the things you can only
// do to a running federation.
//
// Basemap, APP-6 symbols, echelon roll-up, hover naming and selection all come
// from EntityMap, which the analysis replay uses too. What is left here is
// tasking: obstacle markers, comms-disruption zones, the patrol waypoint
// preview, and the pick-mode click routing that turns a map click into a
// command. Those are attached as extra Leaflet layers through EntityMap's
// `onMapReady` handle rather than being props EntityMap would have to know
// about.

import L from "leaflet";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import EntityMap from "@/shared/hla/EntityMap";
import type { HlaEntity } from "@/shared/hla/types";
import type { CommsZone, LatLon, ObstacleMarker, ObstacleType, PickMode } from "../types";
import { MAP } from "./ui";

function buildObstacleIcon(type: ObstacleType): L.DivIcon {
  const glyph = type === "minefield" ? "✱" : type === "roadblock" ? "▧" : "≈";
  const html = `<div style="width:20px;height:20px;border-radius:3px;background:${MAP.amber};border:1px solid #7a5a1e;display:flex;align-items:center;justify-content:center;font-size:12px;color:#1a1200;">${glyph}</div>`;
  return L.divIcon({ html, iconSize: [20, 20], iconAnchor: [10, 10], className: "" });
}

interface Props {
  entities: HlaEntity[];
  selectedId: string | null;
  onSelectEntity: (id: string | null) => void;
  pickMode: PickMode;
  onMapClick: (latlon: LatLon) => void;
  onEntityClickWhilePicking: (targetId: string) => void;
  obstacles: ObstacleMarker[];
  commsZones: CommsZone[];
}

const MapView: FC<Props> = ({
  entities,
  selectedId,
  onSelectEntity,
  pickMode,
  onMapClick,
  onEntityClickWhilePicking,
  obstacles,
  commsZones,
}) => {
  // The Leaflet instance EntityMap owns, so this component can hang its own
  // layers off it. State rather than a ref: the layer effects below have to
  // re-run once it exists.
  const [map, setMap] = useState<L.Map | null>(null);

  const obstacleLayerRef = useRef<L.Layer[]>([]);
  const commsLayerRef = useRef<L.Layer[]>([]);
  const patrolLineRef = useRef<L.Polyline | null>(null);

  const pickModeRef = useRef(pickMode);
  pickModeRef.current = pickMode;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // ── Click routing ─────────────────────────────────────────────────────────
  // While a fire mission is choosing a target, a click on another unit picks
  // it; a click on the firer itself does nothing (it cannot shoot itself, and
  // silently changing the selection mid-mission would lose the pick). Any other
  // time, a click toggles selection.
  const handleEntityClick = useCallback(
    (entity: HlaEntity) => {
      const pm = pickModeRef.current;
      if (pm.kind === "fireAtEntity") {
        if (entity.id !== pm.entityId) onEntityClickWhilePicking(entity.id);
        return;
      }
      onSelectEntity(selectedIdRef.current === entity.id ? null : entity.id);
    },
    [onEntityClickWhilePicking, onSelectEntity]
  );

  const handleMapClick = useCallback(
    (latlon: LatLon) => {
      const kind = pickModeRef.current.kind;
      if (kind === "none" || kind === "fireAtEntity") return;
      onMapClick(latlon);
    },
    [onMapClick]
  );

  const isTargetable = useCallback(
    (entity: HlaEntity) =>
      pickMode.kind === "fireAtEntity" && entity.id !== pickMode.entityId,
    [pickMode]
  );

  // ── Obstacle markers ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    obstacleLayerRef.current.forEach((l) => l.remove());
    obstacleLayerRef.current = obstacles.map((o) =>
      L.marker([o.lat, o.lon], { icon: buildObstacleIcon(o.type), zIndexOffset: -100 })
        .addTo(map)
        .bindTooltip(o.type.toUpperCase())
    );
  }, [obstacles, map]);

  // ── Comms disruption zones ────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    commsLayerRef.current.forEach((l) => l.remove());
    commsLayerRef.current = commsZones.map((z) =>
      L.circle([z.lat, z.lon], {
        radius: z.radiusKm * 1000,
        color: z.enabled ? MAP.red : MAP.green,
        weight: 1.5,
        dashArray: "6 4",
        fillOpacity: 0.08,
        fillColor: z.enabled ? MAP.red : MAP.green,
      })
        .addTo(map)
        .bindTooltip(z.enabled ? "COMMS DISRUPTED" : "COMMS RESTORED")
    );
  }, [commsZones, map]);

  // ── Patrol waypoint preview line ─────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    patrolLineRef.current?.remove();
    patrolLineRef.current = null;
    if (pickMode.kind === "patrol" && pickMode.waypoints.length > 0) {
      patrolLineRef.current = L.polyline(
        pickMode.waypoints.map((w): L.LatLngExpression => [w.lat, w.lon]),
        { color: MAP.amber, weight: 2, dashArray: "4 4" }
      ).addTo(map);
    }
  }, [pickMode, map]);

  return (
    <EntityMap
      entities={entities}
      selectedId={selectedId}
      onEntityClick={handleEntityClick}
      isTargetable={isTargetable}
      // While a fire mission is picking a target everything is drawn: a hidden
      // entity would be an untargetable one.
      rollupDisabled={pickMode.kind === "fireAtEntity"}
      onMapClick={handleMapClick}
      crosshair={pickMode.kind !== "none"}
      rolledUpHint="zoom in to task them"
      banner={
        pickMode.kind === "none"
          ? undefined
          : pickMode.kind === "fireAtEntity"
            ? "CLICK A TARGET UNIT"
            : "CLICK THE MAP TO SET A LOCATION"
      }
      onMapReady={setMap}
    />
  );
};

export default MapView;
