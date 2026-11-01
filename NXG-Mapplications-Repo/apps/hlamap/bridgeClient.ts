// ── hlamap/bridgeClient.ts ─────────────────────────────────────────────────
// Thin wrapper over the HLA commander compute-module Functions (hla_*).
//
// These replaced the old bridge_* functions, and the execution model changed
// with them. bridge_* called the Java federate's REST API synchronously, so a
// response meant the task had been sent to the RTI. hla_* instead writes a row
// to the command input stream; the HLA streamer picks it up, executes it
// against the federate, and writes the result to the command output stream.
//
// So a successful return here means **accepted for execution**, not executed.
// A task can still be refused by the federation a moment later, and that
// refusal appears in the command output stream — not in this response. The
// event log's tick therefore means "queued", and the UI has no confirmation of
// the outcome until something reads the outcome stream.
//
// Read operations are gone entirely: the hla_* set is commands only. Entities,
// status and connection state come from the entity track stream (see
// hooks/useEntityTrackStream), which is why bridge_get_entities and friends
// have no counterpart below.

import { client } from "@/client";
import {
  hlaAggregate,
  hlaCancelTasks,
  hlaCreateObstacle,
  hlaDisaggregate,
  hlaDisconnect,
  hlaDisruptComms,
  hlaFireAtEntity,
  hlaFireAtLocation,
  hlaInjectSupplies,
  hlaMagicMove,
  hlaMoveToLocation,
  hlaPatrol,
  hlaReconnect,
  hlaSetAltitude,
  hlaSetHeading,
  hlaSetRoe,
  hlaSetSpeed,
  hlaSimPause,
  hlaSimStart,
  hlaSimStop,
  hlaStopEntity,
} from "@nxg-simulation-execution-testing/sdk";
import type {
  LatLon,
  MoveType,
  PatrolType,
  ResourceType,
  ObstacleType,
  Roe,
} from "./types";

/**
 * Values the hla_* functions require but the map has no field for.
 *
 * Every one of these is a required parameter on the new functions that the old
 * bridge_* equivalents either defaulted server-side or didn't have at all.
 * They're named and grouped here rather than inlined at the call sites so the
 * guesses are visible and easy to correct — several are placeholders that
 * should be driven by the command panel once it has inputs for them.
 */
export const HLA_DEFAULTS = {
  /**
   * Ground speed for a move order, m/s (~36 km/h).
   *
   * Deliberately not taken from the entity's current speed: a stationary unit
   * reports 0, and a move order at 0 m/s would be accepted and never arrive.
   */
  moveSpeedMetersPerSecond: 10,
  /** Altitude used when the map has no better value, metres above the ellipsoid. */
  altitudeMeters: 0,
  /** How long a fire mission runs when the panel doesn't ask, seconds. */
  fireDurationSeconds: 30,
  /** Movement style used for the legs of a patrol, in poster vocabulary. */
  patrolMoveType: "FASTEST",
  /** Total patrol duration, seconds. */
  patrolDurationSeconds: 3600,
  /** Gap between patrol legs, seconds. */
  patrolIntervalSeconds: 60,
  /** Quantity for a supply injection — unit depends on the resource. */
  supplyQuantity: 100,
  /** Obstacle radius, km. Note the new function takes km; bridge_* took metres. */
  obstacleRadiusKm: 0.1,
  /** Comms network affected by a disruption. */
  commsNetwork: "all",
  /** Whether aggregating/disaggregating also removes the subordinate units. */
  removeSubunits: false,
  /** Fallback federate name when the entity's simulator is unknown. */
  federate: "sword",
} as const;

/**
 * The map's vocabularies are not the commander's.
 *
 * hla-command-poster validates these fields against fixed sets and raises
 * CommandRejected — surfacing as an HTTP 400 from the query execute endpoint —
 * before anything reaches the command stream. It upper-cases first, so case
 * isn't the issue: the *values* differ. Sending the map's own `move`/`assault`
 * enum straight through fails every move order.
 *
 * Three of these mappings are judgement calls, marked below: the map offers
 * tactical intents the poster's vocabulary has no word for.
 */
const MOVE_TYPE_BY_UI: Record<MoveType, string> = {
  move: "FASTEST", // the poster's own default
  assault: "TACTICAL", // judgement call
  withdraw: "DIRECT", // judgement call — no "withdraw" concept in MOVE_TYPES
};

const PATROL_TYPE_BY_UI: Record<PatrolType, string> = {
  loop: "REPEATING",
  pingpong: "REPEATING", // judgement call — PATROL_TYPES has no ping-pong
  once: "ONCE",
};

const RESOURCE_TYPE_BY_UI: Record<ResourceType, string> = {
  fuel: "FUEL",
  ammo: "AMMUNITION",
  personnel: "RATIONS", // judgement call — RESOURCE_TYPES has no personnel
};

const queryMap = {
  hlaAggregate,
  hlaCancelTasks,
  hlaCreateObstacle,
  hlaDisaggregate,
  hlaDisconnect,
  hlaDisruptComms,
  hlaFireAtEntity,
  hlaFireAtLocation,
  hlaInjectSupplies,
  hlaMagicMove,
  hlaMoveToLocation,
  hlaPatrol,
  hlaReconnect,
  hlaSetAltitude,
  hlaSetHeading,
  hlaSetRoe,
  hlaSetSpeed,
  hlaSimPause,
  hlaSimStart,
  hlaSimStop,
  hlaStopEntity,
} as const;

type HlaFunctionName = keyof typeof queryMap;

export interface BridgeResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Turn a command error payload into something worth reading.
 *
 * The commander reports failures as `{"error": "...", "detail": "<body>"}`,
 * where the detail is often nested JSON carrying the real message. Surfacing
 * only the `error` field reduced every failure to a bare status code and threw
 * away the one sentence that says what went wrong.
 */
function describeBridgeError(parsed: object): string {
  const payload = parsed as { error?: unknown; detail?: unknown };
  const status = String(payload.error ?? "Command call failed");
  if (payload.detail === undefined) return status;

  const detail =
    typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);

  try {
    const inner = JSON.parse(detail) as { error?: unknown };
    if (inner && typeof inner === "object" && inner.error !== undefined) {
      return `${status} — ${String(inner.error)}`;
    }
  } catch {
    // Not JSON; fall through and show it raw.
  }
  return `${status} — ${detail}`;
}

async function callHla<T = unknown>(
  name: HlaFunctionName,
  params: Record<string, unknown> = {}
): Promise<BridgeResult<T>> {
  const query = queryMap[name];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await (client(query as any) as any).executeFunction(params);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return { ok: false, error: describeBridgeError(parsed), data: parsed as T };
    }
    return { ok: true, data: parsed as T };
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Command call failed";
    return { ok: false, error: message };
  }
}

/** Typed helpers for every hla_* function, matching the published parameter names. */
export const bridge = {
  // ── Federation / scenario control ───────────────────────────────────────
  startScenario: () => callHla("hlaSimStart"),
  pauseScenario: () => callHla("hlaSimPause"),
  stopScenario: () => callHla("hlaSimStop"),

  /** Drops the commander federate out of the federation. */
  disconnect: () => callHla("hlaDisconnect"),
  /** Rejoins after a disconnect. */
  reconnect: () => callHla("hlaReconnect"),

  // ── Movement ────────────────────────────────────────────────────────────
  moveToLocation: (
    entityId: string,
    lat: number,
    lon: number,
    moveType: MoveType,
    speedMetersPerSecond: number = HLA_DEFAULTS.moveSpeedMetersPerSecond
  ) =>
    callHla("hlaMoveToLocation", {
      entity_id: entityId,
      latitude: lat,
      longitude: lon,
      move_type: MOVE_TYPE_BY_UI[moveType],
      speed_meters_per_second: speedMetersPerSecond,
    }),

  /**
   * Patrol a route.
   *
   * The waypoints are now a structured array rather than a JSON string, and
   * each leg carries its own speed.
   */
  patrol: (
    entityId: string,
    waypoints: LatLon[],
    patrolType: PatrolType,
    speedMetersPerSecond: number = HLA_DEFAULTS.moveSpeedMetersPerSecond
  ) =>
    callHla("hlaPatrol", {
      entity_id: entityId,
      patrol_type: PATROL_TYPE_BY_UI[patrolType],
      move_type: HLA_DEFAULTS.patrolMoveType,
      duration_seconds: HLA_DEFAULTS.patrolDurationSeconds,
      interval_seconds: HLA_DEFAULTS.patrolIntervalSeconds,
      waypoints: waypoints.map((w) => ({
        latitude: w.lat,
        longitude: w.lon,
        speed_meters_per_second: speedMetersPerSecond,
      })),
    }),

  /** Teleport, preserving the entity's altitude where the caller knows it. */
  magicMove: (
    entityId: string,
    lat: number,
    lon: number,
    headingDegrees: number,
    altitudeMeters: number = HLA_DEFAULTS.altitudeMeters
  ) =>
    callHla("hlaMagicMove", {
      entity_id: entityId,
      latitude: lat,
      longitude: lon,
      heading_degrees: headingDegrees,
      altitude_meters: altitudeMeters,
    }),

  /** Not yet wired to the command panel. */
  setHeading: (entityId: string, headingDegrees: number) =>
    callHla("hlaSetHeading", { entity_id: entityId, heading_degrees: headingDegrees }),

  /** Not yet wired to the command panel. */
  setSpeed: (entityId: string, speedMetersPerSecond: number) =>
    callHla("hlaSetSpeed", {
      entity_id: entityId,
      speed_meters_per_second: speedMetersPerSecond,
    }),

  /** Not yet wired to the command panel. */
  setAltitude: (entityId: string, altitudeMeters: number) =>
    callHla("hlaSetAltitude", { entity_id: entityId, altitude_meters: altitudeMeters }),

  /** Halt an entity where it stands. Not yet wired to the command panel. */
  stopEntity: (entityId: string) => callHla("hlaStopEntity", { entity_id: entityId }),

  // ── Fires ───────────────────────────────────────────────────────────────
  fireAtLocation: (
    entityId: string,
    lat: number,
    lon: number,
    durationSeconds: number,
    altitudeMeters: number = HLA_DEFAULTS.altitudeMeters
  ) =>
    callHla("hlaFireAtLocation", {
      entity_id: entityId,
      latitude: lat,
      longitude: lon,
      duration_seconds: durationSeconds,
      altitude_meters: altitudeMeters,
    }),

  fireAtEntity: (
    entityId: string,
    targetId: string,
    durationSeconds: number = HLA_DEFAULTS.fireDurationSeconds
  ) =>
    callHla("hlaFireAtEntity", {
      entity_id: entityId,
      target_id: targetId,
      duration_seconds: durationSeconds,
    }),

  setRoe: (entityId: string, roe: Roe) => callHla("hlaSetRoe", { entity_id: entityId, roe }),

  cancelTasks: (entityId: string) => callHla("hlaCancelTasks", { entity_id: entityId }),

  // ── Umpire actions ──────────────────────────────────────────────────────
  /**
   * Inject supplies.
   *
   * `resource_type` and `supply_type` are both required and the distinction
   * between them isn't documented on the function; the same value is sent for
   * both until the commander's semantics are confirmed.
   */
  injectSupplies: (
    entityId: string,
    resourceType: ResourceType,
    quantity: number = HLA_DEFAULTS.supplyQuantity
  ) =>
    callHla("hlaInjectSupplies", {
      entity_id: entityId,
      resource_type: RESOURCE_TYPE_BY_UI[resourceType],
      supply_type: RESOURCE_TYPE_BY_UI[resourceType],
      quantity,
    }),

  aggregate: (
    entityId: string,
    federate: string = HLA_DEFAULTS.federate,
    removeSubunits: boolean = HLA_DEFAULTS.removeSubunits
  ) =>
    callHla("hlaAggregate", {
      entity_id: entityId,
      federate,
      remove_subunits: removeSubunits,
    }),

  disaggregate: (
    entityId: string,
    federate: string = HLA_DEFAULTS.federate,
    removeSubunits: boolean = HLA_DEFAULTS.removeSubunits
  ) =>
    callHla("hlaDisaggregate", {
      entity_id: entityId,
      federate,
      remove_subunits: removeSubunits,
    }),

  // ── Environment ─────────────────────────────────────────────────────────
  /**
   * CreateObstacle is an ETR *task*, so the FOM requires a Taskee: an engineer
   * entity has to be nominated.
   *
   * Note the radius is now in kilometres — bridge_create_obstacle took metres.
   */
  createObstacle: (
    entityId: string,
    obstacleType: ObstacleType,
    lat: number,
    lon: number,
    radiusKm: number = HLA_DEFAULTS.obstacleRadiusKm
  ) =>
    callHla("hlaCreateObstacle", {
      entity_id: entityId,
      obstacle_type: obstacleType,
      latitude: lat,
      longitude: lon,
      radius_km: radiusKm,
    }),

  /** Also a task — needs the entity performing the disruption (the EW asset). */
  disruptComms: (
    entityId: string,
    lat: number,
    lon: number,
    radiusKm: number,
    enabled: boolean,
    network: string = HLA_DEFAULTS.commsNetwork
  ) =>
    callHla("hlaDisruptComms", {
      entity_id: entityId,
      latitude: lat,
      longitude: lon,
      radius_km: radiusKm,
      enabled,
      network,
    }),
};
