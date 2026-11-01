// ── analysisScreen/components/AnalysisMap.tsx ──────────────────────────────
// The replay map, plus the plan drawn over it.
//
// Same relationship to shared/hla/EntityMap that hlamap's MapView has: the
// basemap, the APP-6 symbols, the echelon roll-up and the selection all come
// from EntityMap, and everything specific to this screen is attached as extra
// Leaflet layers through its `onMapReady` handle. EntityMap deliberately knows
// nothing about plans — it is shared with the live map, where there is no plan
// to draw.
//
// What is drawn, and when it is rebuilt
// -------------------------------------
// The objectives, the ordered axes, ROUTE BLUE and the predicted end state are
// all static for the whole run, so they are built once per (plan, compliance)
// and never touched again. Only the deviation band follows the playhead, and
// it mutates one polyline's coordinates rather than being removed and re-added
// — the replay interpolates at 15 Hz, and tearing down a layer that often is
// what makes markers stop tracking the basemap during a pan.

import L from "leaflet";
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import EntityMap from "@/shared/hla/EntityMap";
import type { HlaEntity, LatLon } from "@/shared/hla/types";
import type { PhasePlan, PlanPoint } from "@/shared/hla/balticShieldPlan";
import {
  nearestPointOnRoute,
  statusTone,
  type OrderCompliance,
  type RunCompliance,
} from "../lib/compliance";
import { UI } from "./ui";

/** Which plan layers are showing. An overlay you cannot switch off buries the track. */
export interface PlanLayerToggles {
  objectives: boolean;
  axes: boolean;
  predicted: boolean;
  corridor: boolean;
}

export const DEFAULT_PLAN_LAYERS: PlanLayerToggles = {
  objectives: true,
  axes: true,
  predicted: false,
  corridor: true,
};

const TONE_COLOUR: Record<ReturnType<typeof statusTone>, string> = {
  good: UI.green,
  warn: UI.amber,
  bad: UI.red,
  muted: UI.textFaint,
};

function toLatLng(point: PlanPoint): L.LatLngExpression {
  return [point.lat, point.lng];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface Props {
  entities: HlaEntity[];
  selectedId: string | null;
  onEntityClick: (entity: HlaEntity) => void;
  isFaded?: (entity: HlaEntity) => boolean;
  trail?: LatLon[] | null;
  planKey?: string | number;
  fitKey?: string | number;

  /** The plan to draw. Absent → this is an ordinary replay with nothing to compare. */
  plan?: PhasePlan;
  /** How the run measured up against it. */
  compliance?: RunCompliance;
  /** The order selected in the compliance panel, if any. */
  selectedOrderId?: string | null;
  /** A planned axis was clicked. */
  onSelectOrder?: (orderId: string | null) => void;
  layers: PlanLayerToggles;
  onLayersChange: (layers: PlanLayerToggles) => void;
}

const AnalysisMap: FC<Props> = ({
  entities,
  selectedId,
  onEntityClick,
  isFaded,
  trail,
  planKey,
  fitKey,
  plan,
  compliance,
  selectedOrderId,
  onSelectOrder,
  layers,
  onLayersChange,
}) => {
  // State rather than a ref: the layer effects below have to re-run once the
  // map exists.
  const [map, setMap] = useState<L.Map | null>(null);

  const staticLayersRef = useRef<L.Layer[]>([]);
  const deviationRef = useRef<L.Polyline | null>(null);

  const onSelectOrderRef = useRef(onSelectOrder);
  onSelectOrderRef.current = onSelectOrder;

  const complianceByOrderId = useMemo(() => {
    const byId = new Map<string, OrderCompliance>();
    for (const order of compliance?.orders ?? []) byId.set(order.orderId, order);
    return byId;
  }, [compliance]);

  // ── Static plan layers ────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;

    for (const layer of staticLayersRef.current) layer.remove();
    staticLayersRef.current = [];
    if (!plan) return;

    const added: L.Layer[] = [];

    if (layers.corridor) {
      for (const measure of plan.controlMeasures) {
        // A control measure the planner collapsed onto a single point has no
        // geometry to draw; skipping it is honest, inventing a length is not.
        if (measure.route.length < 2) continue;
        if (measure.route[0].lat === measure.route[1].lat && measure.route[0].lng === measure.route[1].lng) {
          continue;
        }
        added.push(
          L.polyline(measure.route.map(toLatLng), {
            color: measure.colour,
            weight: 3,
            opacity: 0.5,
            dashArray: "10 6",
            interactive: false,
          })
            .addTo(map)
            .bindTooltip(escapeHtml(measure.label ?? "control measure"), { sticky: true }),
        );
      }
    }

    if (layers.axes) {
      for (const order of plan.orders) {
        if (order.route.length < 2) continue;
        const result = complianceByOrderId.get(order.id);
        const colour = result ? TONE_COLOUR[statusTone(result.status)] : UI.textDim;
        const isSelected = selectedOrderId === order.id;

        const line = L.polyline(order.route.map(toLatLng), {
          color: colour,
          weight: isSelected ? 4 : 2,
          opacity: isSelected ? 0.95 : 0.6,
          dashArray: "6 5",
        })
          .addTo(map)
          .bindTooltip(
            `<div style="font-family:'Courier New';font-size:10px;line-height:1.45;">` +
              `<div style="font-weight:700;">${escapeHtml(order.unitLabel)}</div>` +
              `<div>PLANNED — ${escapeHtml(order.taskLabel)}</div>` +
              `</div>`,
          )
          .on("click", (event: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(event);
            onSelectOrderRef.current?.(isSelected ? null : order.id);
          });
        added.push(line);

        // A small ring at the ordered destination, so an axis reads as going
        // somewhere rather than just pointing.
        added.push(
          L.circleMarker(toLatLng(order.route[order.route.length - 1]), {
            radius: 4,
            color: colour,
            weight: 1.5,
            fillOpacity: 0,
            interactive: false,
          }).addTo(map),
        );
      }
    }

    if (layers.objectives) {
      for (const objective of plan.objectives) {
        added.push(
          L.marker(toLatLng(objective), {
            interactive: false,
            icon: L.divIcon({
              className: "",
              iconSize: [12, 12],
              iconAnchor: [6, 6],
              html:
                `<div style="position:relative;width:12px;height:12px;">` +
                `<div style="position:absolute;inset:0;border:2px solid ${objective.colour};` +
                `transform:rotate(45deg);background:rgba(14,18,25,0.6);"></div>` +
                `<div style="position:absolute;left:14px;top:-3px;white-space:nowrap;` +
                `font-family:'Courier New';font-size:9px;letter-spacing:1px;` +
                `color:${objective.colour};text-shadow:0 0 3px #0e1219;">` +
                `${escapeHtml(objective.name)}</div></div>`,
            }),
          }).addTo(map),
        );
      }
    }

    if (layers.predicted) {
      for (const predicted of plan.predictedEndState) {
        added.push(
          L.circleMarker(toLatLng(predicted), {
            radius: 5,
            color: UI.textDim,
            weight: 1,
            dashArray: "2 2",
            fillColor: UI.bg0,
            fillOpacity: 0.35,
            interactive: true,
          })
            .addTo(map)
            .bindTooltip(
              `<div style="font-family:'Courier New';font-size:10px;">` +
                `<div style="font-weight:700;">${escapeHtml(predicted.label)}</div>` +
                `<div>PREDICTED END POSITION</div></div>`,
            ),
        );
      }
    }

    staticLayersRef.current = added;
  }, [map, plan, layers, complianceByOrderId, selectedOrderId]);

  // Drop every plan layer on unmount — the effect above only cleans up when its
  // own dependencies change.
  useEffect(
    () => () => {
      for (const layer of staticLayersRef.current) layer.remove();
      staticLayersRef.current = [];
      deviationRef.current?.remove();
      deviationRef.current = null;
    },
    [],
  );

  // ── Deviation band for the selected order ────────────────────────────────
  // The one layer that moves with the playhead: a line from where the unit is
  // to the nearest point on the axis it was given. Without it a unit off its
  // route just looks like a unit that is somewhere.
  const selectedOrder = useMemo(
    () => plan?.orders.find((order) => order.id === selectedOrderId) ?? null,
    [plan, selectedOrderId],
  );

  useEffect(() => {
    if (!map) return;

    const entity = selectedOrder?.entityId
      ? entities.find((candidate) => candidate.id === selectedOrder.entityId)
      : undefined;

    const nearest =
      entity && selectedOrder
        ? nearestPointOnRoute(selectedOrder.route, { lat: entity.lat, lng: entity.lon })
        : null;

    if (!entity || !nearest) {
      deviationRef.current?.remove();
      deviationRef.current = null;
      return;
    }

    const coordinates: L.LatLngExpression[] = [
      [entity.lat, entity.lon],
      [nearest.point.lat, nearest.point.lng],
    ];

    if (deviationRef.current) {
      deviationRef.current.setLatLngs(coordinates);
      deviationRef.current.setTooltipContent(`${nearest.crossTrackKm.toFixed(1)} km off axis`);
    } else {
      deviationRef.current = L.polyline(coordinates, {
        color: UI.amber,
        weight: 1.5,
        opacity: 0.9,
        dashArray: "3 4",
        interactive: false,
      })
        .addTo(map)
        .bindTooltip(`${nearest.crossTrackKm.toFixed(1)} km off axis`);
    }
  }, [map, entities, selectedOrder]);

  const toggle = useCallback(
    (key: keyof PlanLayerToggles) => onLayersChange({ ...layers, [key]: !layers[key] }),
    [layers, onLayersChange],
  );

  return (
    <EntityMap
      entities={entities}
      selectedId={selectedId}
      onEntityClick={onEntityClick}
      isFaded={isFaded}
      trail={trail}
      planKey={planKey}
      fitKey={fitKey}
      onMapClick={() => onSelectOrderRef.current?.(null)}
      onMapReady={setMap}
    >
      {plan && (
        <div
          style={{
            position: "absolute",
            // Clear of Leaflet's zoom control, which sits at top-left.
            top: 10,
            left: 52,
            zIndex: 1000,
            background: "rgba(14,18,25,0.88)",
            border: `1px solid ${UI.border}`,
            padding: "6px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          <div
            style={{
              fontFamily: UI.fontMono,
              fontSize: 9,
              color: UI.textDim,
              letterSpacing: 1,
              marginBottom: 2,
            }}
          >
            PLAN OVERLAY
          </div>
          {(
            [
              ["objectives", "objectives"],
              ["axes", "ordered axes"],
              ["corridor", "control measures"],
              ["predicted", "predicted end state"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontFamily: UI.fontMono,
                fontSize: 10,
                color: layers[key] ? UI.text : UI.textDim,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => toggle(key)}
                style={{ accentColor: UI.accent, width: 11, height: 11, cursor: "pointer" }}
              />
              {label}
            </label>
          ))}
        </div>
      )}
    </EntityMap>
  );
};

export default AnalysisMap;
