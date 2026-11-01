// ── hlamap/components/CommandPanel.tsx ────────────────────────────────────
// Right-hand sidebar: global map/environment commands when nothing is
// selected, per-unit HLA bridge commands when a unit is selected.

import { type CSSProperties, type FC, useState } from "react";
import type {
  CommandAction,
  HlaEntity,
  MoveType,
  ObstacleType,
  PatrolType,
  PickMode,
  ResourceType,
} from "../types";
import { UI, tint } from "./ui";

const section: CSSProperties = {
  padding: "10px 12px",
  borderBottom: `1px solid ${UI.border}`,
};
const label: CSSProperties = {
  fontSize: 10,
  color: UI.textFaint,
  letterSpacing: 1,
  marginBottom: 6,
  textTransform: "uppercase",
};
const row: CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" };
const select: CSSProperties = {
  width: "100%",
  background: UI.bg2,
  border: `1px solid ${UI.border}`,
  color: UI.text,
  fontFamily: UI.fontSans,
  fontSize: 11,
  padding: "5px 6px",
  marginBottom: 6,
};

function btn(color: string, disabled = false): CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${tint(color, 40)}`,
    color: disabled ? UI.textFaint : color,
    fontFamily: UI.fontSans,
    fontSize: 11,
    padding: "5px 10px",
    cursor: disabled ? "default" : "pointer",
    letterSpacing: 0.5,
  };
}

interface Props {
  entity: HlaEntity | null;
  entities: HlaEntity[];
  pickMode: PickMode;
  onAction: (action: CommandAction) => void;
}

const CommandPanel: FC<Props> = ({ entity, entities, pickMode, onAction }) => {
  const [moveType, setMoveType] = useState<MoveType>("move");
  const [patrolType, setPatrolType] = useState<PatrolType>("loop");
  const [heading, setHeading] = useState(90);
  const [duration, setDuration] = useState(10);
  const [obstacleType, setObstacleType] = useState<ObstacleType>("minefield");
  const [commsRadius, setCommsRadius] = useState(5);
  const [commsEnabled, setCommsEnabled] = useState(true);

  const picking = pickMode.kind !== "none";
  const pickingThis = (kind: PickMode["kind"]) =>
    pickMode.kind === kind && "entityId" in pickMode && entity && pickMode.entityId === entity.id;

  // ── Nothing selected: global map/environment commands ────────────────────
  if (!entity) {
    return (
      <div
        style={{
          width: 280,
          background: UI.bg1,
          borderLeft: `1px solid ${UI.border}`,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ ...section, fontSize: 11, color: UI.text, fontWeight: 700 }}>MAP / ENVIRONMENT</div>

        <div style={section}>
          <div style={label}>Create obstacle</div>
          <select style={select} value={obstacleType} onChange={(e) => setObstacleType(e.target.value as ObstacleType)}>
            <option value="minefield">Minefield</option>
            <option value="roadblock">Roadblock</option>
            <option value="wire">Wire</option>
          </select>
          {pickMode.kind === "obstacle" ? (
            <button style={btn(UI.red)} onClick={() => onAction({ type: "pickCancel" })}>Cancel pick</button>
          ) : (
            <button
              disabled={picking}
              style={btn(UI.accent, picking)}
              onClick={() => onAction({ type: "obstacleStart", obstacleType })}
            >
              📍 Pick location
            </button>
          )}
        </div>

        <div style={section}>
          <div style={label}>Disrupt comms</div>
          <div style={row}>
            <input
              type="number"
              min={1}
              max={50}
              value={commsRadius}
              onChange={(e) => setCommsRadius(Number(e.target.value))}
              style={{ ...select, width: 64, marginBottom: 0 }}
            />
            <label style={{ fontSize: 11, color: UI.textDim, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={commsEnabled} onChange={(e) => setCommsEnabled(e.target.checked)} />
              disrupt (off = restore)
            </label>
          </div>
          {pickMode.kind === "disruptComms" ? (
            <button style={{ ...btn(UI.red), marginTop: 6 }} onClick={() => onAction({ type: "pickCancel" })}>
              Cancel pick
            </button>
          ) : (
            <button
              disabled={picking}
              style={{ ...btn(UI.accent, picking), marginTop: 6 }}
              onClick={() => onAction({ type: "commsStart", radiusKm: commsRadius, enabled: commsEnabled })}
            >
              📍 Pick location
            </button>
          )}
        </div>

        <div style={{ ...section, color: UI.textFaint, fontSize: 11, lineHeight: 1.6 }}>
          Select a unit on the map to issue movement, fires, ROE, and umpire commands.
        </div>
      </div>
    );
  }

  // ── Selected, but not addressable ─────────────────────────────────────────
  // Bridge tasking addresses entities by NETN UniqueId (see addressOf in
  // index.tsx): the HLA object handle is issued per federate, per session, so
  // the handle carried by the track stream means nothing to the commander
  // federate that would execute the command. SWORD publishes no UniqueId for a
  // large share of its aggregates, and those units cannot be commanded at all.
  //
  // Say so plainly rather than presenting a full command panel whose every
  // button would be refused — or worse, silently accepted against some other
  // unit that happens to hold the same handle number in the commander.
  if (!entity.uniqueId) {
    return (
      <div
        style={{
          width: 280,
          background: UI.bg1,
          borderLeft: `1px solid ${UI.border}`,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ ...section, display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: entity.force === "BLUE" ? UI.blue : UI.red }}>
            {entity.callsign}
          </div>
          <div style={{ fontSize: 10, color: UI.textFaint }}>
            {entity.unit} · {entity.force} · {entity.simulator}
          </div>
        </div>

        <div style={section}>
          <div style={{ ...label, color: UI.amber }}>Not taskable</div>
          <div style={{ fontSize: 11, color: UI.textDim, lineHeight: 1.6 }}>
            This unit publishes no NETN UniqueId, so the bridge has no stable way
            to address it. Commands are disabled rather than sent against an HLA
            handle, which would identify a different unit in the commander
            federate.
          </div>
          <div
            style={{
              fontSize: 10,
              color: UI.textFaint,
              fontFamily: UI.fontMono,
              marginTop: 8,
            }}
          >
            handle {entity.id}
          </div>
        </div>
      </div>
    );
  }

  // ── Unit selected: per-unit commands ──────────────────────────────────────
  const others = entities.filter((e) => e.id !== entity.id);

  return (
    <div
      style={{
        width: 280,
        background: UI.bg1,
        borderLeft: `1px solid ${UI.border}`,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ ...section, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: entity.force === "BLUE" ? UI.blue : UI.red }}>
          {entity.callsign}
        </div>
        <div style={{ fontSize: 10, color: UI.textFaint }}>
          {entity.unit} · {entity.force} · {entity.simulator}
        </div>
        <div style={{ fontSize: 10, color: UI.textDim, fontFamily: UI.fontMono, marginTop: 4 }}>
          dmg: {entity.damageState} · roe: {entity.roe} · {entity.aggregateState}
        </div>
      </div>

      {/* Move */}
      <div style={section}>
        <div style={label}>Move to location</div>
        <select style={select} value={moveType} onChange={(e) => setMoveType(e.target.value as MoveType)}>
          <option value="move">Move</option>
          <option value="assault">Assault</option>
          <option value="withdraw">Withdraw</option>
        </select>
        {pickingThis("move") ? (
          <button style={btn(UI.red)} onClick={() => onAction({ type: "pickCancel" })}>Cancel pick</button>
        ) : (
          <button
            disabled={picking}
            style={btn(UI.accent, picking)}
            onClick={() => onAction({ type: "move", entityId: entity.id, moveType })}
          >
            📍 Pick destination
          </button>
        )}
      </div>

      {/* Patrol */}
      <div style={section}>
        <div style={label}>Patrol</div>
        <select style={select} value={patrolType} onChange={(e) => setPatrolType(e.target.value as PatrolType)}>
          <option value="loop">Loop</option>
          <option value="pingpong">Ping-pong</option>
          <option value="once">Once</option>
        </select>
        {pickingThis("patrol") && pickMode.kind === "patrol" ? (
          <div style={row}>
            <span style={{ fontSize: 11, color: UI.amber }}>{pickMode.waypoints.length} pt(s)</span>
            <button style={btn(UI.green)} onClick={() => onAction({ type: "patrolAddDone" })}>Done</button>
            <button style={btn(UI.red)} onClick={() => onAction({ type: "pickCancel" })}>Cancel</button>
          </div>
        ) : (
          <button
            disabled={picking}
            style={btn(UI.accent, picking)}
            onClick={() => onAction({ type: "patrolStart", entityId: entity.id, patrolType })}
          >
            📍 Click waypoints on map
          </button>
        )}
      </div>

      {/* Magic move */}
      <div style={section}>
        <div style={label}>Magic move (teleport)</div>
        <input
          type="number"
          min={0}
          max={359}
          value={heading}
          onChange={(e) => setHeading(Number(e.target.value))}
          style={select}
          placeholder="heading °"
        />
        {pickingThis("magicMove") ? (
          <button style={btn(UI.red)} onClick={() => onAction({ type: "pickCancel" })}>Cancel pick</button>
        ) : (
          <button
            disabled={picking}
            style={btn(UI.accent, picking)}
            onClick={() => onAction({ type: "magicMove", entityId: entity.id, heading })}
          >
            📍 Pick location
          </button>
        )}
      </div>

      {/* Fire at location */}
      <div style={section}>
        <div style={label}>Fire at location</div>
        <input
          type="number"
          min={1}
          max={120}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          style={select}
          placeholder="duration (s)"
        />
        {pickingThis("fireAtLocation") ? (
          <button style={btn(UI.red)} onClick={() => onAction({ type: "pickCancel" })}>Cancel pick</button>
        ) : (
          <button
            disabled={picking}
            style={btn(UI.amber, picking)}
            onClick={() => onAction({ type: "fireAtLocation", entityId: entity.id, duration })}
          >
            🎯 Pick target point
          </button>
        )}
      </div>

      {/* Fire at entity */}
      <div style={section}>
        <div style={label}>Fire at entity</div>
        {pickingThis("fireAtEntity") ? (
          <button style={btn(UI.red)} onClick={() => onAction({ type: "pickCancel" })}>
            Cancel — click a unit on the map
          </button>
        ) : (
          <button
            disabled={picking || others.length === 0}
            style={btn(UI.red, picking || others.length === 0)}
            onClick={() => onAction({ type: "fireAtEntityStart", entityId: entity.id })}
          >
            🎯 Pick target unit
          </button>
        )}
      </div>

      {/* ROE */}
      <div style={section}>
        <div style={label}>Rules of engagement</div>
        <div style={row}>
          {(["hold_fire", "return_fire", "fire_at_will"] as const).map((roe) => (
            <button
              key={roe}
              disabled={picking}
              style={btn(entity.roe === roe ? UI.amber : UI.textDim, picking)}
              onClick={() => onAction({ type: "setRoe", entityId: entity.id, roe })}
            >
              {roe.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Cancel tasks / aggregate */}
      <div style={section}>
        <div style={row}>
          <button disabled={picking} style={btn(UI.textDim, picking)} onClick={() => onAction({ type: "cancelTasks", entityId: entity.id })}>
            Cancel tasks
          </button>
          <button
            disabled={picking}
            style={btn(UI.textDim, picking)}
            onClick={() => onAction({ type: "toggleAggregate", entityId: entity.id })}
          >
            {entity.aggregateState === "aggregated" ? "Disaggregate" : "Aggregate"}
          </button>
        </div>
      </div>

      {/* Inject supplies */}
      <div style={section}>
        <div style={label}>Inject supplies</div>
        <div style={row}>
          {(["fuel", "ammo", "personnel"] as const satisfies readonly ResourceType[]).map((r) => (
            <button
              key={r}
              disabled={picking}
              style={btn(UI.accent, picking)}
              onClick={() => onAction({ type: "injectSupplies", entityId: entity.id, resourceType: r })}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CommandPanel;
