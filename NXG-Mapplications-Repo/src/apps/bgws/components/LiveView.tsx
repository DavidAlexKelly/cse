// ── bgws/components/LiveView.tsx ───────────────────────────────────────────
// The live half of the screen: events on the left, the map in the middle, the
// selected unit and its orders on the right.
//
// Owns only the order pick mode — which order is waiting for a map click or a
// target — because nothing outside this view needs it. Selection lives in the
// app shell, which publishes it to Workshop.

import { type FC, useCallback, useEffect, useState } from "react";
import type { Area, BgwsEventRow, HlaEntity, LatLon, ScenarioObjective } from "../types";
import type { TailState } from "../hooks/useStreamTail";
import type { BgwsOrder } from "../lib/orders";
import { eventPosition } from "../lib/events";
import EventsPanel from "./EventsPanel";
import LiveMap, { type PickMode } from "./LiveMap";
import UnitPanel, { type OrderEntry } from "./UnitPanel";
import { UI } from "./styles";

interface Props {
  /** Every track; the view filters or highlights BGWS's. */
  entities: HlaEntity[];
  isBgws: (entity: HlaEntity) => boolean;
  selected: HlaEntity | null;
  onSelect: (id: string | null) => void;
  events: BgwsEventRow[];
  eventsState: TailState;
  eventsError: string | null;
  federate: string;
  onOrder: (order: BgwsOrder, target?: HlaEntity) => void;
  orders: OrderEntry[];
  area: Area | null;
  objectives: ScenarioObjective[];
  tracksError: string | null;
}

const LiveView: FC<Props> = ({
  entities,
  isBgws,
  selected,
  onSelect,
  events,
  eventsState,
  eventsError,
  federate,
  onOrder,
  orders,
  area,
  objectives,
  tracksError,
}) => {
  const [pickMode, setPickMode] = useState<PickMode>({ kind: "none" });
  const [showAll, setShowAll] = useState(false);
  const [focus, setFocus] = useState<{ at: LatLon; key: number } | null>(null);

  // A pick belongs to the unit it was started for; changing unit abandons it.
  useEffect(() => setPickMode({ kind: "none" }), [selected?.id]);

  const bgwsCount = entities.filter(isBgws).length;
  const shown = showAll ? entities : entities.filter(isBgws);
  const isFaded = useCallback((e: HlaEntity) => showAll && !isBgws(e), [showAll, isBgws]);

  const onPickPoint = (at: LatLon) => {
    switch (pickMode.kind) {
      case "move":
        onOrder({ kind: "move", to: at });
        setPickMode({ kind: "none" });
        return;
      case "patrol":
        setPickMode({ kind: "patrol", waypoints: [...pickMode.waypoints, at] });
        return;
      case "magicMove":
        onOrder({ kind: "magicMove", to: at, headingDeg: pickMode.headingDeg });
        setPickMode({ kind: "none" });
        return;
      case "fireAtLocation":
        onOrder({ kind: "fireAtLocation", at, durationS: pickMode.durationS });
        setPickMode({ kind: "none" });
        return;
      default:
        return;
    }
  };

  const onPickTarget = (target: HlaEntity) => {
    if (pickMode.kind !== "fireAtEntity") return;
    onOrder({ kind: "fireAtEntity", targetUniqueId: target.uniqueId ?? "" }, target);
    setPickMode({ kind: "none" });
  };

  const onEventClick = (event: BgwsEventRow) => {
    const id = event.entity_unique_id?.toLowerCase();
    const unit = id ? entities.find((e) => e.uniqueId?.toLowerCase() === id) : undefined;
    if (unit) {
      onSelect(unit.id);
      if (!isBgws(unit)) setShowAll(true);
    }
    const at = eventPosition(event) ?? (unit ? { lat: unit.lat, lon: unit.lon } : null);
    if (at) setFocus((f) => ({ at, key: (f?.key ?? 0) + 1 }));
  };

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      <EventsPanel
        events={events}
        state={eventsState}
        error={eventsError}
        selectedUniqueId={selected?.uniqueId ?? null}
        federate={federate}
        onEventClick={onEventClick}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            padding: "4px 12px",
            fontSize: 11,
            color: UI.textDim,
            background: UI.bg1,
            borderBottom: `1px solid ${UI.border}`,
            fontFamily: UI.fontSans,
          }}
        >
          <div className="hc-seg" role="group" aria-label="Which entities">
            <button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>
              BGWS only ({bgwsCount})
            </button>
            <button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>
              All, BGWS highlighted ({entities.length})
            </button>
          </div>
          {!showAll && bgwsCount === 0 && entities.length > 0 && (
            <span style={{ color: UI.amber }}>
              No BGWS units{federate ? ` from ${federate}` : ""} in the track stream — {entities.length} other entities hidden.
            </span>
          )}
          {tracksError && <span style={{ color: UI.red }}>Track stream: {tracksError}</span>}
        </div>
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <LiveMap
            entities={shown}
            selectedId={selected?.id ?? null}
            onSelect={onSelect}
            isFaded={showAll ? isFaded : undefined}
            pickMode={pickMode}
            onPickPoint={onPickPoint}
            onPickTarget={onPickTarget}
            area={area}
            objectives={objectives}
            focus={focus}
          />
        </div>
      </div>
      <UnitPanel
        entity={selected}
        isBgws={selected ? isBgws(selected) : false}
        pickMode={pickMode}
        onPickMode={setPickMode}
        onOrder={(order) => onOrder(order)}
        onSendPatrol={() => {
          if (pickMode.kind === "patrol") onOrder({ kind: "patrol", waypoints: pickMode.waypoints });
          setPickMode({ kind: "none" });
        }}
        orders={orders}
      />
    </div>
  );
};

export default LiveView;
