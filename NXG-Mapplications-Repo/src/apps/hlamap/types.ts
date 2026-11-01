// ── hlamap/types.ts ────────────────────────────────────────────────────────
// Tasking-side shapes for the live federation map.
//
// The entity model itself now lives in shared/hla/types — the analysis replay
// draws the same entities from the same feed, so HlaEntity and friends are not
// this app's to own. They are re-exported here so the rest of hlamap can go on
// importing from "../types".
//
// What *is* this app's: everything describing a command you can issue to a
// running federation. A replay has nothing to point a fire mission at.

export type {
  AggregateState,
  DamageState,
  Force,
  HlaEntity,
  LatLon,
  Roe,
  Simulator,
} from "@/shared/hla/types";

import type { LatLon } from "@/shared/hla/types";
import type { Roe } from "@/shared/hla/types";

export type MoveType = "move" | "assault" | "withdraw";
export type PatrolType = "loop" | "pingpong" | "once";
export type ResourceType = "fuel" | "ammo" | "personnel";
export type ObstacleType = "minefield" | "roadblock" | "wire";

export interface ObstacleMarker {
  id: string;
  type: ObstacleType;
  lat: number;
  lon: number;
}

export interface CommsZone {
  id: string;
  lat: number;
  lon: number;
  radiusKm: number;
  enabled: boolean;
}

export type LogLevel = "info" | "success" | "error";

export interface LogEntry {
  id: string;
  time: string;
  level: LogLevel;
  message: string;
}

export interface BridgeStatusInfo {
  connected: boolean;
  federationName: string;
  simTime: number;
  entityCount: number;
}

/** What the map is currently waiting for a click (or unit click) to supply. */
export type PickMode =
  | { kind: "none" }
  | { kind: "move"; entityId: string; moveType: MoveType }
  | { kind: "magicMove"; entityId: string; heading: number }
  | { kind: "fireAtLocation"; entityId: string; duration: number }
  | { kind: "patrol"; entityId: string; patrolType: PatrolType; waypoints: LatLon[] }
  | { kind: "obstacle"; obstacleType: ObstacleType }
  | { kind: "disruptComms"; radiusKm: number; enabled: boolean }
  | { kind: "fireAtEntity"; entityId: string };

/** Actions the command panel can request from the app shell. */
export type CommandAction =
  | { type: "move"; entityId: string; moveType: MoveType }
  | { type: "patrolStart"; entityId: string; patrolType: PatrolType }
  | { type: "patrolAddDone" }
  | { type: "magicMove"; entityId: string; heading: number }
  | { type: "fireAtLocation"; entityId: string; duration: number }
  | { type: "fireAtEntityStart"; entityId: string }
  | { type: "setRoe"; entityId: string; roe: Roe }
  | { type: "cancelTasks"; entityId: string }
  | { type: "injectSupplies"; entityId: string; resourceType: ResourceType }
  | { type: "toggleAggregate"; entityId: string }
  | { type: "obstacleStart"; obstacleType: ObstacleType }
  | { type: "commsStart"; radiusKm: number; enabled: boolean }
  | { type: "pickCancel" };
