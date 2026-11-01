// ── hlamap/index.tsx ───────────────────────────────────────────────────────
// HLA Map: live view of the entities in the HLA federation, with hla_*
// commands (move, patrol, magic-move, fires, ROE, umpire actions, obstacles,
// comms disruption, scenario start/pause/stop) issued against the [NXG]
// Commander compute module.
//
// The two halves are now separate streams. Entities come from the entity track
// stream (useEntityTrackStream) and the simulation owns their state; commands
// are written to the command input stream by hla_*, executed by the HLA
// streamer against the federate, and their outcome written to the command
// output stream. Nothing is moved optimistically, so a task the federation
// refuses looks refused rather than appearing to work — but note that refusal
// now surfaces on the outcome stream, which this app does not yet read.

import { type FC, useEffect, useMemo, useState } from "react";
import { bridge as realBridge } from "./bridgeClient";
import CommandPanel from "./components/CommandPanel";
import EventLog from "./components/EventLog";
import MapView from "./components/MapView";
import TopBar from "./components/TopBar";
import { UI } from "./components/ui";
import { useEntityTrackStream } from "./hooks/useEntityTrackStream";
import { useMockSimulation } from "./hooks/useMockSimulation";
import { useWorkshopContext } from "@osdk/workshop-iframe-custom-widget";
import { HLAMAP_CONFIG } from "./hlamapConfig";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadedBool(field: any): boolean | null {
  return field?.fieldValue?.status === "LOADED"
    ? (field.fieldValue.value as boolean) ?? null
    : null;
}
import type {
  CommandAction,
  CommsZone,
  HlaEntity,
  LatLon,
  LogEntry,
  ObstacleMarker,
  PickMode,
} from "./types";

let logSeq = 0;

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour12: false });
}

interface SimpleResult {
  ok: boolean;
  error?: string;
}

const HlaMapApp: FC = () => {
  // mock-demo (Workshop, bidirectional): when true the federation is faked
  // client-side from the OP-BALTIC-SHIELD-2026 ORBAT, so the app is fully
  // demonstrable with no simulator, bridge or RTI available.
  const workshopCtxAsync = useWorkshopContext(HLAMAP_CONFIG);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = workshopCtxAsync.status === "LOADED" ? (workshopCtxAsync.value as any) : null;
  const mockDemo = loadedBool(ctx?.mockDemo) ?? false;

  // Both sources are called unconditionally, because React requires hooks to run
  // on every render, and the active one is selected below. The mock idles while
  // disabled. The live stream does keep polling the track dataset while mocking,
  // which is wasteful but harmless; suppressing it would mean adding an
  // `enabled` flag to useEntityTrackStream, deliberately left alone here.
  const liveStream = useEntityTrackStream();
  const mockStream = useMockSimulation(mockDemo);

  // Entities, status and connection state all come from the selected stream.
  const {
    entities: streamEntities,
    status,
    connState,
    error: streamError,
  } = mockDemo ? mockStream : liveStream;

  // Every command in this file goes through `bridge`, so selecting the mock
  // implementation here makes the whole app taskable against the fake
  // federation — command panel, map pick modes and scenario controls alike —
  // without touching a single call site. The mock applies the effect to its own
  // entity state; the real client puts it on the bridge command stream.
  const bridge = mockDemo ? mockStream.bridge : realBridge;

  /**
   * Locally requested ROE and aggregate state, by entity id.
   *
   * The federation reports neither back, so these were previously written
   * straight into the entity list. With the list owned by the stream, the
   * request is held separately and merged on read — which also makes the
   * distinction honest: these are requested, not observed, and the next tick
   * from the stream will not contradict them because it never carried them.
   */
  const [roeRequests, setRoeRequests] = useState<Record<string, HlaEntity["roe"]>>({});
  const [aggregateRequests, setAggregateRequests] = useState<
    Record<string, HlaEntity["aggregateState"]>
  >({});

  const entities = useMemo(
    () =>
      streamEntities.map((e) => {
        const roe = roeRequests[e.id];
        const aggregateState = aggregateRequests[e.id];
        if (!roe && !aggregateState) return e;
        return { ...e, ...(roe ? { roe } : {}), ...(aggregateState ? { aggregateState } : {}) };
      }),
    [streamEntities, roeRequests, aggregateRequests]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickMode, setPickMode] = useState<PickMode>({ kind: "none" });
  const [log, setLog] = useState<LogEntry[]>([]);
  const [obstacles, setObstacles] = useState<ObstacleMarker[]>([]);
  const [commsZones, setCommsZones] = useState<CommsZone[]>([]);


  const addLog = (level: LogEntry["level"], message: string) => {
    logSeq += 1;
    setLog((prev) => [...prev.slice(-49), { id: `log-${logSeq}`, time: nowTime(), level, message }]);
  };

  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === selectedId) ?? null,
    [entities, selectedId]
  );

  // ── Output: publish the selection to Workshop ─────────────────────────────
  // Id and callsign both, so a host page can key off the handle and still show
  // something a human recognises. Fired on change only; the event lets Workshop
  // react rather than poll.
  useEffect(() => {
    if (!ctx) return;
    ctx.selectedEntity?.setLoadedValue?.(selectedEntity?.id ?? "");
    ctx.selectedCallsign?.setLoadedValue?.(selectedEntity?.callsign ?? "");
    if (selectedEntity) ctx.onEntitySelected?.executeEvent?.(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntity?.id, selectedEntity?.callsign, !!ctx]);

  /**
   * How an entity is named in the event log. Shows the callsign plus a hint of
   * the UUID actually sent, and calls out entities with no UUID - those cannot
   * be tasked, and the log should say so rather than showing a handle that
   * looks like an identifier.
   */
  const describeEntity = (entityId: string): string => {
    const entity = entities.find((e) => e.id === entityId);
    if (!entity) return entityId;
    return entity.uniqueId
      ? `${entity.callsign} (${entity.uniqueId.slice(0, 8)})`
      : `${entity.callsign} [no UUID - not taskable]`;
  };

  /**
   * The identifier to put in a bridge command: the NETN UniqueId, or null.
   *
   * Deliberately never falls back to the HLA object handle. A handle is issued
   * by the RTI per federate, per session: the handles in the track stream come
   * from the HLA-ENTITY-STREAM-READER federate, while commands are executed by
   * HLA-ENTITY-COMMANDER — a different federate with its own, unrelated
   * numbering. Sending a stream handle to the commander either resolves to
   * nothing (404) or, because both federates allocate from the same small
   * range, silently resolves to a *different* unit and tasks that one instead.
   *
   * The UniqueId is the only identifier that means the same thing in both.
   */
  const addressOf = (entityId: string): string | null =>
    entities.find((e) => e.id === entityId)?.uniqueId ?? null;

  /**
   * Resolve the address for a command, logging a refusal when there isn't one.
   *
   * Returns null when the entity publishes no NETN UniqueId — SWORD does not
   * publish one for a large share of its aggregates — in which case the caller
   * sends nothing at all rather than addressing the command by handle.
   */
  const addressFor = (entityId: string, label: string): string | null => {
    const address = addressOf(entityId);
    if (address === null) {
      addLog(
        "error",
        `✗ ${label} — ${describeEntity(entityId)} publishes no NETN UniqueId. ` +
          "Bridge tasking addresses entities by UUID, so nothing was sent."
      );
    }
    return address;
  };

  // ── Stream read errors ────────────────────────────────────────────────────
  // Entities and status now come from the track stream (see
  // useEntityTrackStream), not from bridge_get_entities / bridge_get_status.
  // Only the failure is worth logging, and only when it changes — the poll runs
  // once a second and a broken stream would otherwise fill the log.
  useEffect(() => {
    if (streamError) addLog("error", `Track stream read failed — ${streamError}`);
  }, [streamError]);

  // ── Fire-and-log helper for any hla_* call ────────────────────────────────
  // A tick here means the command was accepted onto the command stream, not
  // that the federation carried it out. The outcome arrives asynchronously on
  // the command output stream, which this app does not read yet.
  const runBridge = async (label: string, fn: () => Promise<SimpleResult>) => {
    addLog("info", `▶ ${label}`);
    const res = await fn();
    addLog(res.ok ? "success" : "error", res.ok ? `✓ ${label}` : `✗ ${label} — ${res.error ?? "failed"}`);
  };

  // ── Map click resolution (fills in the point a pick-mode is waiting for) ─
  const handleMapClick = (latlon: LatLon) => {
    if (pickMode.kind === "none" || pickMode.kind === "fireAtEntity") return;

    if (pickMode.kind === "patrol") {
      const nextWaypoints = [...pickMode.waypoints, latlon];
      setPickMode({ ...pickMode, waypoints: nextWaypoints });
      addLog("info", `Waypoint ${nextWaypoints.length} set for ${pickMode.entityId}`);
      return;
    }

    // Note: no optimistic local movement. The simulator owns entity state, and
    // the 1 s entity poll reports where things actually are — moving the marker
    // ourselves would show a position the federation never agreed to, and would
    // mask a task that was silently refused.
    if (pickMode.kind === "move") {
      const { entityId, moveType } = pickMode;
      const label = `Move ${describeEntity(entityId)} → ${latlon.lat.toFixed(3)},${latlon.lon.toFixed(3)} (${moveType})`;
      const address = addressFor(entityId, label);
      if (address) {
        void runBridge(label, () =>
          bridge.moveToLocation(address, latlon.lat, latlon.lon, moveType)
        );
      }
      setPickMode({ kind: "none" });
      return;
    }

    if (pickMode.kind === "magicMove") {
      const { entityId, heading } = pickMode;
      const label = `Magic move ${describeEntity(entityId)} → ${latlon.lat.toFixed(3)},${latlon.lon.toFixed(3)}`;
      const address = addressFor(entityId, label);
      if (address) {
        // hla_magic_move requires an altitude. Reuse the entity's current one
        // so a teleport doesn't also slam an aircraft to ground level; the
        // client falls back to its default when the stream hasn't reported it.
        const altitudeMeters = entities.find((e) => e.id === entityId)?.altitudeMeters;
        void runBridge(label, () =>
          bridge.magicMove(address, latlon.lat, latlon.lon, heading, altitudeMeters)
        );
      }
      setPickMode({ kind: "none" });
      return;
    }

    if (pickMode.kind === "fireAtLocation") {
      const { entityId, duration } = pickMode;
      const label = `Fire ${describeEntity(entityId)} @ ${latlon.lat.toFixed(3)},${latlon.lon.toFixed(3)} (${duration}s)`;
      const address = addressFor(entityId, label);
      if (address) {
        void runBridge(label, () =>
          bridge.fireAtLocation(address, latlon.lat, latlon.lon, duration)
        );
      }
      setPickMode({ kind: "none" });
      return;
    }

    // CreateObstacle and DisruptCommunication are ETR tasks: the FOM requires a
    // Taskee, so an entity must be selected to carry them out (an engineer unit
    // and an EW asset respectively). There is no "from nowhere" variant.
    if (pickMode.kind === "obstacle") {
      if (!selectedEntity) {
        addLog("error", "Select the engineer entity that will build the obstacle first.");
        setPickMode({ kind: "none" });
        return;
      }
      const label = `Create ${pickMode.obstacleType} obstacle (by ${selectedEntity.callsign})`;
      const taskee = addressFor(selectedEntity.id, label);
      if (!taskee) {
        setPickMode({ kind: "none" });
        return;
      }
      const id = `obs-${Date.now()}`;
      setObstacles((prev) => [...prev, { id, type: pickMode.obstacleType, lat: latlon.lat, lon: latlon.lon }]);
      void runBridge(label, () =>
        bridge.createObstacle(taskee, pickMode.obstacleType, latlon.lat, latlon.lon)
      );
      setPickMode({ kind: "none" });
      return;
    }

    if (pickMode.kind === "disruptComms") {
      if (!selectedEntity) {
        addLog("error", "Select the entity that will carry out the comms disruption first.");
        setPickMode({ kind: "none" });
        return;
      }
      const label = `${pickMode.enabled ? "Disrupt" : "Restore"} comms r=${pickMode.radiusKm}km (by ${selectedEntity.callsign})`;
      const taskee = addressFor(selectedEntity.id, label);
      if (!taskee) {
        setPickMode({ kind: "none" });
        return;
      }
      const id = `comms-${Date.now()}`;
      setCommsZones((prev) => [
        ...prev,
        { id, lat: latlon.lat, lon: latlon.lon, radiusKm: pickMode.radiusKm, enabled: pickMode.enabled },
      ]);
      void runBridge(label, () =>
        bridge.disruptComms(taskee, latlon.lat, latlon.lon, pickMode.radiusKm, pickMode.enabled)
      );
      setPickMode({ kind: "none" });
    }
  };

  // ── Resolve "fire at entity" by clicking a unit marker ────────────────────
  const handleEntityClickWhilePicking = (targetId: string) => {
    if (pickMode.kind !== "fireAtEntity") return;
    const { entityId } = pickMode;
    const label = `Fire ${describeEntity(entityId)} → target ${describeEntity(targetId)}`;
    const shooter = addressFor(entityId, label);
    const target = addressFor(targetId, label);
    if (shooter && target) {
      void runBridge(label, () => bridge.fireAtEntity(shooter, target));
    }
    setPickMode({ kind: "none" });
  };

  // ── Command dispatch from the side panel ──────────────────────────────────
  const handleAction = (action: CommandAction) => {
    switch (action.type) {
      case "move":
        setPickMode({ kind: "move", entityId: action.entityId, moveType: action.moveType });
        break;

      case "patrolStart":
        setPickMode({ kind: "patrol", entityId: action.entityId, patrolType: action.patrolType, waypoints: [] });
        break;

      case "patrolAddDone": {
        if (pickMode.kind !== "patrol" || pickMode.waypoints.length === 0) {
          setPickMode({ kind: "none" });
          break;
        }
        const { entityId, patrolType, waypoints } = pickMode;
        const label = `Patrol ${describeEntity(entityId)} (${waypoints.length} pt(s), ${patrolType})`;
        const address = addressFor(entityId, label);
        if (address) {
          void runBridge(label, () => bridge.patrol(address, waypoints, patrolType));
        }
        setPickMode({ kind: "none" });
        break;
      }

      case "magicMove":
        setPickMode({ kind: "magicMove", entityId: action.entityId, heading: action.heading });
        break;

      case "fireAtLocation":
        setPickMode({ kind: "fireAtLocation", entityId: action.entityId, duration: action.duration });
        break;

      case "fireAtEntityStart":
        setPickMode({ kind: "fireAtEntity", entityId: action.entityId });
        break;

      // ROE and aggregate state are shown optimistically because the bridge
      // does not report either back — unlike position, there is nothing to
      // correct the guess later, so treat these as requested-not-confirmed.
      case "setRoe": {
        const label = `Set ROE ${describeEntity(action.entityId)} → ${action.roe}`;
        const address = addressFor(action.entityId, label);
        if (address) {
          setRoeRequests((prev) => ({ ...prev, [action.entityId]: action.roe }));
          void runBridge(label, () => bridge.setRoe(address, action.roe));
        }
        break;
      }

      case "cancelTasks": {
        const label = `Cancel tasks ${describeEntity(action.entityId)}`;
        const address = addressFor(action.entityId, label);
        if (address) {
          void runBridge(label, () => bridge.cancelTasks(address));
        }
        break;
      }

      case "injectSupplies": {
        const label = `Inject ${action.resourceType} → ${describeEntity(action.entityId)}`;
        const address = addressFor(action.entityId, label);
        if (address) {
          void runBridge(label, () => bridge.injectSupplies(address, action.resourceType));
        }
        break;
      }

      case "toggleAggregate": {
        const current = entities.find((e) => e.id === action.entityId);
        const next = current?.aggregateState === "aggregated" ? "disaggregated" : "aggregated";
        const label = `${next === "aggregated" ? "Aggregate" : "Disaggregate"} ${describeEntity(action.entityId)}`;
        const address = addressFor(action.entityId, label);
        if (address) {
          // hla_aggregate/hla_disaggregate require the owning federate. Take it
          // from the entity rather than guessing; "unknown" is not a federate
          // name, so fall through to the client's default in that case.
          const federate =
            current && current.simulator !== "unknown" ? current.simulator : undefined;
          setAggregateRequests((prev) => ({ ...prev, [action.entityId]: next }));
          void runBridge(label, () =>
            next === "aggregated"
              ? bridge.aggregate(address, federate)
              : bridge.disaggregate(address, federate)
          );
        }
        break;
      }

      case "obstacleStart":
        setPickMode({ kind: "obstacle", obstacleType: action.obstacleType });
        break;

      case "commsStart":
        setPickMode({ kind: "disruptComms", radiusKm: action.radiusKm, enabled: action.enabled });
        break;

      case "pickCancel":
        setPickMode({ kind: "none" });
        break;
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: UI.bg0,
        color: UI.text,
        fontFamily: UI.fontSans,
        overflow: "hidden",
      }}
    >
      <TopBar
        connState={connState}
        status={status}
        onStart={() => void runBridge("Start scenario", bridge.startScenario)}
        onPause={() => void runBridge("Pause scenario", bridge.pauseScenario)}
        onStop={() => void runBridge("Stop scenario", bridge.stopScenario)}
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <MapView
          entities={entities}
          selectedId={selectedId}
          onSelectEntity={setSelectedId}
          pickMode={pickMode}
          onMapClick={handleMapClick}
          onEntityClickWhilePicking={handleEntityClickWhilePicking}
          obstacles={obstacles}
          commsZones={commsZones}
        />
        <CommandPanel entity={selectedEntity} entities={entities} pickMode={pickMode} onAction={handleAction} />
      </div>
      <EventLog entries={log} />
    </div>
  );
};

export default HlaMapApp;
