// ── bgws/lib/orders.ts ─────────────────────────────────────────────────────
// What a BGWS unit can be ordered to do, and how each order becomes a call on
// hlamap's bridge client (the hla_* Commander functions).
//
// No new functions: BGWS takes the NETN v4 SMC tasking the bridge already
// sends (CONTRACT §1), addressed by the entity's NETN UniqueId — the
// `unique_id` column of the track stream. The calls go through
// hlamap/bridgeClient so its vocabulary mappings (map words → poster words:
// "move" → FASTEST, "once" → ONCE, …) stay in one place; this module only
// decides which method and which arguments, which is the part worth testing.
//
// Deliberately absent: set speed, set heading, set altitude. BGWS does not
// model them and refuses every one (ChangeSpeed/Heading/Altitude → Refused),
// so offering them would only teach operators that orders fail.

import type { LatLon } from "../types";

/** BGWS ROE words, with what BGWS does for each (CONTRACT §1). */
export type BgwsRoe = "hold_fire" | "return_fire" | "fire_at_will";

export const ROE_OPTIONS: ReadonlyArray<{ value: BgwsRoe; label: string; bgws: string }> = [
  { value: "hold_fire", label: "Hold fire", bgws: "never" },
  { value: "return_fire", label: "Return fire", bgws: "if fired upon" },
  { value: "fire_at_will", label: "Fire at will", bgws: "always" },
];

export type BgwsOrder =
  | { kind: "move"; to: LatLon }
  | { kind: "patrol"; waypoints: LatLon[] }
  | { kind: "magicMove"; to: LatLon; headingDeg: number }
  | { kind: "stop" }
  | { kind: "cancel" }
  | { kind: "roe"; roe: BgwsRoe }
  | { kind: "fireAtEntity"; targetUniqueId: string }
  | { kind: "fireAtLocation"; at: LatLon; durationS: number };

export type OrderKind = BgwsOrder["kind"];

/** Orders BGWS refuses; listed so the UI and docs can say why they are missing. */
export const REFUSED_BY_BGWS = ["hla_set_speed", "hla_set_heading", "hla_set_altitude"] as const;

/**
 * A call on hlamap's `bridge`, as data. The argument tuples follow the bridge
 * method signatures exactly, so the dispatcher can spread them.
 */
export type OrderCall =
  | { method: "moveToLocation"; args: [entity: string, lat: number, lon: number, moveType: "move"] }
  | { method: "patrol"; args: [entity: string, waypoints: LatLon[], patrolType: "once"] }
  | { method: "magicMove"; args: [entity: string, lat: number, lon: number, headingDeg: number, altitudeM?: number] }
  | { method: "stopEntity"; args: [entity: string] }
  | { method: "cancelTasks"; args: [entity: string] }
  | { method: "setRoe"; args: [entity: string, roe: BgwsRoe] }
  | { method: "fireAtEntity"; args: [entity: string, target: string, durationS: number] }
  | { method: "fireAtLocation"; args: [entity: string, lat: number, lon: number, durationS: number] };

/** The Commander function each bridge method ends up calling. */
export const FUNCTION_FOR_METHOD: Record<OrderCall["method"], string> = {
  moveToLocation: "hla_move_to_location",
  patrol: "hla_patrol",
  magicMove: "hla_magic_move",
  stopEntity: "hla_stop_entity",
  cancelTasks: "hla_cancel_tasks",
  setRoe: "hla_set_roe",
  fireAtEntity: "hla_fire_at_entity",
  fireAtLocation: "hla_fire_at_location",
};

/** How long a direct-fire engagement is asked to last. BGWS decides when it ends; this is an upper bound. */
export const DIRECT_FIRE_DURATION_S = 60;
export const DEFAULT_INDIRECT_FIRE_DURATION_S = 60;

/** hla-command-poster rejects anything that is not a UUID (`_require_uuid`). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** The unit being ordered: only what addressing needs. */
export interface OrderSubject {
  uniqueId?: string;
  callsign?: string;
  altitudeMeters?: number;
}

export type OrderPlan = { ok: true; call: OrderCall; label: string } | { ok: false; error: string };

function fmt(p: LatLon): string {
  return `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
}

function validPoint(p: LatLon): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}

/**
 * Turn an order for a unit into a bridge call, or say why it cannot be sent.
 *
 * Refuses rather than guesses: a unit with no NETN UniqueId is never addressed
 * by its HLA handle (see hlamap's addressOf for why that can task the wrong
 * unit), and the poster would reject a non-UUID anyway.
 */
export function planOrder(subject: OrderSubject, order: BgwsOrder): OrderPlan {
  const who = subject.callsign || subject.uniqueId || "unit";
  const id = subject.uniqueId;
  if (!isUuid(id)) {
    return { ok: false, error: `${who} publishes no NETN UniqueId, so it cannot be ordered.` };
  }

  switch (order.kind) {
    case "move":
      if (!validPoint(order.to)) return { ok: false, error: "Move: invalid destination." };
      return {
        ok: true,
        label: `Move ${who} → ${fmt(order.to)}`,
        // BGWS has one kind of move; the poster's FASTEST ("move" in map words)
        // reaches the bridge as roads-and-cross-country.
        call: { method: "moveToLocation", args: [id, order.to.lat, order.to.lon, "move"] },
      };

    case "patrol": {
      const points = order.waypoints.filter(validPoint);
      if (points.length === 0) return { ok: false, error: "Patrol: pick at least one waypoint." };
      if (points.length !== order.waypoints.length) return { ok: false, error: "Patrol: a waypoint is invalid." };
      return {
        ok: true,
        label: `Patrol ${who} via ${points.length} point${points.length === 1 ? "" : "s"}`,
        // BGWS moves through the waypoints in order and then holds: "once".
        // Loop and ping-pong would be accepted by the poster and then played
        // as once, so they are not offered.
        call: { method: "patrol", args: [id, points, "once"] },
      };
    }

    case "magicMove": {
      if (!validPoint(order.to)) return { ok: false, error: "Magic move: invalid destination." };
      const heading = ((Math.round(order.headingDeg) % 360) + 360) % 360;
      const args: [string, number, number, number, number?] = [id, order.to.lat, order.to.lon, heading];
      // Keep the unit's altitude when the stream has reported one, so a
      // teleported aircraft is not dropped to the ground.
      if (typeof subject.altitudeMeters === "number" && Number.isFinite(subject.altitudeMeters)) {
        args.push(subject.altitudeMeters);
      }
      return {
        ok: true,
        label: `Magic move ${who} → ${fmt(order.to)} hdg ${heading}°`,
        call: { method: "magicMove", args },
      };
    }

    case "stop":
      return { ok: true, label: `Stop ${who}`, call: { method: "stopEntity", args: [id] } };

    case "cancel":
      return { ok: true, label: `Cancel tasks ${who}`, call: { method: "cancelTasks", args: [id] } };

    case "roe": {
      const option = ROE_OPTIONS.find((o) => o.value === order.roe);
      if (!option) return { ok: false, error: `Unknown ROE "${order.roe}".` };
      return {
        ok: true,
        label: `ROE ${who} → ${option.label.toLowerCase()}`,
        call: { method: "setRoe", args: [id, order.roe] },
      };
    }

    case "fireAtEntity":
      if (!isUuid(order.targetUniqueId)) {
        return { ok: false, error: "Fire: the target publishes no NETN UniqueId." };
      }
      if (order.targetUniqueId.toLowerCase() === id.toLowerCase()) {
        return { ok: false, error: "Fire: a unit cannot engage itself." };
      }
      return {
        ok: true,
        label: `Fire ${who} → ${order.targetUniqueId.slice(0, 8)}`,
        call: { method: "fireAtEntity", args: [id, order.targetUniqueId, DIRECT_FIRE_DURATION_S] },
      };

    case "fireAtLocation": {
      if (!validPoint(order.at)) return { ok: false, error: "Fire mission: invalid location." };
      // The poster requires a positive duration.
      const duration = Math.max(1, Math.round(order.durationS));
      return {
        ok: true,
        label: `Fire mission ${who} @ ${fmt(order.at)} (${duration}s)`,
        call: { method: "fireAtLocation", args: [id, order.at.lat, order.at.lon, duration] },
      };
    }
  }
}
