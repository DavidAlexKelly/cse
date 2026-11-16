// ── bgws/components/UnitPanel.tsx ──────────────────────────────────────────
// The selected unit, the orders it can be given, and how those orders went.
//
// Only orders BGWS carries out are offered (lib/orders): move, patrol, magic
// move, stop, cancel, ROE, direct fire, indirect fire. Speed, heading and
// altitude are refused by BGWS and so are not here at all.

import { type FC, type ReactNode, useState } from "react";
import type { HlaEntity, IssuedCommand, OutcomeSummary } from "../types";
import { ROE_OPTIONS, DEFAULT_INDIRECT_FIRE_DURATION_S, isUuid, type BgwsOrder, type BgwsRoe } from "../lib/orders";
import type { PickMode } from "./LiveMap";
import OutcomeTrail from "./OutcomeTrail";
import { heading, input, mono, panel, row, section, UI } from "./styles";

export interface OrderEntry {
  command: IssuedCommand;
  summary: OutcomeSummary | null;
}

interface Props {
  entity: HlaEntity | null;
  isBgws: boolean;
  pickMode: PickMode;
  onPickMode: (mode: PickMode) => void;
  onOrder: (order: BgwsOrder) => void;
  onSendPatrol: () => void;
  /** Every order this screen has issued, newest first. */
  orders: OrderEntry[];
}

const DAMAGE: Record<HlaEntity["damageState"], { label: string; colour: string }> = {
  NoDamage: { label: "no damage", colour: UI.green },
  SlightDamage: { label: "slight damage", colour: UI.amber },
  ModerateDamage: { label: "moderate damage", colour: UI.amber },
  Destroyed: { label: "destroyed", colour: UI.red },
};

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, padding: "1px 0" }}>
      <span style={{ color: UI.textDim }}>{label}</span>
      <span style={{ textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}

const UnitPanel: FC<Props> = ({ entity, isBgws, pickMode, onPickMode, onOrder, onSendPatrol, orders }) => {
  const [headingDeg, setHeadingDeg] = useState(0);
  const [durationS, setDurationS] = useState(DEFAULT_INDIRECT_FIRE_DURATION_S);
  const [roe, setRoe] = useState<BgwsRoe>("return_fire");

  const picking = pickMode.kind !== "none";
  const taskable = !!entity && isUuid(entity.uniqueId) && entity.damageState !== "Destroyed";
  const unitOrders = entity?.uniqueId ? orders.filter((o) => o.command.unitUniqueId === entity.uniqueId) : [];

  const pickButton = (kind: PickMode["kind"], label: string, mode: PickMode, title: string) =>
    pickMode.kind === kind ? (
      <button type="button" className="mil-btn mil-btn--sm mil-btn--danger" onClick={() => onPickMode({ kind: "none" })}>
        Cancel {label.toLowerCase()}
      </button>
    ) : (
      <button
        type="button"
        className="mil-btn mil-btn--sm mil-btn--default"
        disabled={!taskable || picking}
        title={title}
        onClick={() => onPickMode(mode)}
      >
        {label}
      </button>
    );

  return (
    <div style={panel(320)}>
      {!entity ? (
        <div style={{ ...section, fontSize: 11, color: UI.textDim }}>
          Select a unit on the map, or click an event that names one.
        </div>
      ) : (
        <>
          <div style={section}>
            <div style={heading}>{isBgws ? "BGWS unit" : "Federation entity"}</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{entity.callsign}</div>
            <Fact label="Side" value={<span style={{ color: entity.force === "RED" ? UI.red : UI.blue }}>{entity.force}</span>} />
            <Fact label="Type" value={entity.unit || "—"} />
            <Fact label="DIS" value={<span style={mono}>{entity.sisoType}</span>} />
            <Fact label="Damage" value={<span style={{ color: DAMAGE[entity.damageState].colour }}>{DAMAGE[entity.damageState].label}</span>} />
            <Fact label="Speed" value={<span style={mono}>{entity.speed.toFixed(1)} km/h</span>} />
            <Fact label="Heading" value={<span style={mono}>{Math.round(entity.heading)}°</span>} />
            <Fact label="Position" value={<span style={mono}>{entity.lat.toFixed(5)}, {entity.lon.toFixed(5)}</span>} />
            {entity.altitudeMeters !== undefined && <Fact label="Altitude" value={<span style={mono}>{Math.round(entity.altitudeMeters)} m</span>} />}
            <Fact label="UUID" value={<span style={{ ...mono, fontSize: 10 }}>{entity.uniqueId ?? "none — cannot be ordered"}</span>} />
          </div>

          <div style={section}>
            <div style={heading}>Orders</div>
            {!taskable && (
              <div style={{ fontSize: 11, color: UI.amber, marginBottom: 6 }}>
                {entity.damageState === "Destroyed"
                  ? "Destroyed units take no orders."
                  : "This entity publishes no NETN UniqueId, so it cannot be ordered."}
              </div>
            )}
            {taskable && !isBgws && (
              <div style={{ fontSize: 11, color: UI.textDim, marginBottom: 6 }}>
                Not a BGWS unit: orders go to whichever simulator owns it.
              </div>
            )}
            <div style={row}>
              {pickButton("move", "Move here", { kind: "move" }, "Click the destination on the map (hla_move_to_location)")}
              {pickMode.kind === "patrol" ? (
                <>
                  <button type="button" className="mil-btn mil-btn--sm mil-btn--primary" disabled={pickMode.waypoints.length === 0} onClick={onSendPatrol}>
                    Send patrol ({pickMode.waypoints.length})
                  </button>
                  <button type="button" className="mil-btn mil-btn--sm mil-btn--danger" onClick={() => onPickMode({ kind: "none" })}>
                    Cancel
                  </button>
                </>
              ) : (
                pickButton("patrol", "Patrol", { kind: "patrol", waypoints: [] }, "Click waypoints in order; the unit moves through them, then holds (hla_patrol)")
              )}
            </div>
            <div style={{ ...row, marginTop: 6 }}>
              <button type="button" className="mil-btn mil-btn--sm mil-btn--ghost" disabled={!taskable || picking} onClick={() => onOrder({ kind: "stop" })} title="Stop and hold where it is (hla_stop_entity)">
                ■ Stop
              </button>
              <button type="button" className="mil-btn mil-btn--sm mil-btn--ghost" disabled={!taskable || picking} onClick={() => onOrder({ kind: "cancel" })} title="Drop its orders and hold (hla_cancel_tasks)">
                Cancel tasks
              </button>
            </div>

            <div style={{ ...row, marginTop: 10 }}>
              <select style={{ ...input, flex: 1, width: "auto" }} value={roe} onChange={(e) => setRoe(e.target.value as BgwsRoe)} disabled={!taskable}>
                {ROE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} (BGWS: {o.bgws})
                  </option>
                ))}
              </select>
              <button type="button" className="mil-btn mil-btn--sm mil-btn--default" disabled={!taskable || picking} onClick={() => onOrder({ kind: "roe", roe })}>
                Set ROE
              </button>
            </div>

            <div style={{ ...row, marginTop: 10 }}>
              <label style={{ fontSize: 10, color: UI.textDim, display: "flex", gap: 4, alignItems: "center" }}>
                Heading
                <input style={{ ...input, width: 56 }} type="number" min={0} max={359} value={headingDeg} onChange={(e) => setHeadingDeg(Number(e.target.value))} />
              </label>
              {pickButton("magicMove", "Magic move", { kind: "magicMove", headingDeg }, "Teleport to a clicked point (hla_magic_move) — an umpire action")}
            </div>

            <div style={{ ...row, marginTop: 10 }}>
              {pickButton("fireAtEntity", "Fire at unit", { kind: "fireAtEntity" }, "Click the target unit (hla_fire_at_entity)")}
            </div>
            <div style={{ ...row, marginTop: 6 }}>
              <label style={{ fontSize: 10, color: UI.textDim, display: "flex", gap: 4, alignItems: "center" }}>
                Duration (s)
                <input style={{ ...input, width: 56 }} type="number" min={1} value={durationS} onChange={(e) => setDurationS(Number(e.target.value))} />
              </label>
              {pickButton("fireAtLocation", "Fire mission", { kind: "fireAtLocation", durationS }, "Click the point: a fire mission for the unit's side (hla_fire_at_location)")}
            </div>
            <div style={{ fontSize: 10, color: UI.textFaint, marginTop: 8 }}>
              Speed, heading and altitude orders are not offered: BGWS refuses them.
            </div>
          </div>

          <div style={section}>
            <div style={heading}>This unit’s orders</div>
            {unitOrders.length === 0 && <div style={{ fontSize: 11, color: UI.textFaint }}>None from this screen.</div>}
            {unitOrders.slice(0, 8).map((o) => (
              <OrderRow key={o.command.id} entry={o} />
            ))}
          </div>
        </>
      )}

      <div style={{ ...section, borderBottom: "none" }}>
        <div style={heading}>All orders ({orders.length})</div>
        {orders.length === 0 && <div style={{ fontSize: 11, color: UI.textFaint }}>No orders issued yet.</div>}
        {orders.slice(0, 30).map((o) => (
          <OrderRow key={o.command.id} entry={o} />
        ))}
      </div>
    </div>
  );
};

const OrderRow: FC<{ entry: OrderEntry }> = ({ entry }) => (
  <div style={{ padding: "4px 0", borderBottom: `1px dashed ${UI.border}` }} title={entry.summary?.detail ?? entry.command.commandId ?? ""}>
    <div style={{ fontSize: 11, display: "flex", justifyContent: "space-between", gap: 6 }}>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.command.label}</span>
      <span style={{ ...mono, fontSize: 10, color: UI.textFaint }}>{entry.command.issuedAt.slice(11, 19)}</span>
    </div>
    <div style={{ marginTop: 3 }}>
      <OutcomeTrail summary={entry.summary} error={entry.command.error} />
    </div>
  </div>
);

export default UnitPanel;
