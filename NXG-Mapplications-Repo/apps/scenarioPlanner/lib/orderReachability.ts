// src/apps/scenarioPlanner/lib/orderReachability.ts
//
// Terrain-aware validation for AI-generated orders.
//
// The LLM (nxgGenerateOrders) proposes a destination for every unit purely from
// text and coordinates — it has no idea where the rivers, marshes and roads
// are, so it happily orders a wheeled battalion across a lake or 200 km in an
// eight-hour phase. This module makes those orders honest by running them
// through the SAME terrain engine the manual order flow uses
// (TerrainRaster: A* over the tiled terrain grid, TERRAIN_SPEEDS per mobility
// class), so an AI order can never end somewhere the unit cannot actually get
// to within the phase.
//
// Two halves:
//
//   1. buildReachabilityContext() — prevention. A compact per-unit summary of
//      mobility, speeds and realistic range that is fed to the LLM up front so
//      most orders come back plausible.
//
//   2. constrainOrdersToTerrain() — enforcement. Every returned order is
//      routed on the terrain grid and, if necessary, corrected:
//        · impassable destination      → snapped to the nearest passable cell
//        · no route at all             → unit holds position
//        · route longer than the phase → truncated to how far it actually gets
//      Each correction is reported so the UI can explain what changed.

import type { TerrainRaster } from "../../../shared/routing/terrainRaster";
import type { OSRMRoute } from "../../../shared/routing/types";
import { TERRAIN_SPEEDS, TerrainFlag } from "../../../shared/routing/types";
import { getMobilityClass } from "./unitMobility";
import type {
  MapObjectiveOutput,
  MapPhaseState,
  MapUnitPlacement,
  UnitOrder,
} from "../phaseCreator/types";

// ─── Tuning ──────────────────────────────────────────────────────────────────

/**
 * Fraction of the phase a unit may spend moving. The remainder is the time it
 * needs to actually do something at the objective (assault, dig in, resupply).
 * Matches the 0.8 modifier used by the manual order flow (getTimeBudgetSec).
 */
const MOVE_TIME_FRACTION = 0.8;

/** How far (km) we search outward for a passable cell when a destination is in water. */
const MAX_SNAP_SEARCH_KM = 12;

/** Step used when spiralling outward looking for passable ground. */
const SNAP_STEP_KM = 0.4;

/** Destinations closer than this to the unit are treated as "hold in place". */
const MIN_MOVE_KM = 0.05;

// ─── Types ───────────────────────────────────────────────────────────────────

export type OrderAdjustmentKind =
  | "ok"
  | "destination-impassable"
  | "unreachable-in-phase"
  | "no-route"
  | "outside-terrain-data";

export interface OrderAdjustment {
  unitId: string;
  unitLabel: string;
  taskName: string;
  kind: OrderAdjustmentKind;
  /** Where the LLM wanted the unit to go. */
  requested: { lat: number; lng: number };
  /** Where the unit can actually be by the end of the phase. */
  applied: { lat: number; lng: number };
  /** Straight-line km between requested and applied. */
  shortfallKm: number;
  /** Terrain-following route distance in km (undefined when no route exists). */
  routeDistanceKm?: number;
  /** Terrain-following travel time in hours (undefined when no route exists). */
  routeHours?: number;
  /** Human-readable explanation, surfaced in the ORDERS tab. */
  note: string;
}

export interface ConstrainedOrders {
  orders: UnitOrder[];
  /** New objectives with any in-water positions nudged onto passable ground. */
  newObjectives: MapObjectiveOutput[];
  adjustments: OrderAdjustment[];
  /** Terrain-following routes per unit, for drawing the order arrows. */
  routes: Record<string, OSRMRoute>;
  /** True when no terrain data was available and nothing was validated. */
  skipped: boolean;
}

// ─── Geo helpers ─────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

export function haversineKm(
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const dLat = (bLat - aLat) * DEG;
  const dLng = (bLng - aLng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

/** Move `distanceKm` from a point along a bearing (degrees). */
function offset(lat: number, lng: number, bearingDeg: number, distanceKm: number) {
  const latKm = 110.574;
  const lngKm = 111.32 * Math.cos(lat * DEG) || 1e-6;
  return {
    lat: lat + (distanceKm * Math.cos(bearingDeg * DEG)) / latKm,
    lng: lng + (distanceKm * Math.sin(bearingDeg * DEG)) / lngKm,
  };
}

// ─── Prompt context (prevention) ─────────────────────────────────────────────

/**
 * Build the REACHABILITY block appended to the LLM's phase context.
 *
 * Deliberately compact — the logic client truncates context at 30k chars, and
 * the model only needs the rules plus a per-unit range budget.
 */
export function buildReachabilityContext(
  units: MapUnitPlacement[],
  durationHours: number,
  raster: TerrainRaster | null,
): string {
  if (units.length === 0) return "";

  const budgetHours = Math.max(0.1, durationHours * MOVE_TIME_FRACTION);
  const lines: string[] = [
    "TERRAIN REACHABILITY (hard constraint — destinations are validated against the terrain grid after you answer):",
    `- Units may spend at most ${budgetHours.toFixed(1)}h of this ${durationHours}h phase moving; the rest is needed on the objective.`,
    "- Movement is over real terrain: roads are fast, open ground is slower, forest and marsh are very slow, and deep water is impassable.",
    "- Wheeled units CANNOT cross marsh or water. Foot and tracked units can ford but very slowly. Only air units ignore terrain.",
    "- Any destination beyond a unit's range below will be pulled back along its route to the point it can actually reach, so prefer realistic objectives.",
    "",
    "Per-unit movement budget:",
  ];

  for (const u of units) {
    const mobility = getMobilityClass(u);
    const speeds = TERRAIN_SPEEDS[mobility];
    const roadKm = (speeds[TerrainFlag.Road] ?? 0) * budgetHours;
    const openKm = (speeds[TerrainFlag.Open] ?? 0) * budgetHours;
    const onLand = raster?.isLoaded ? raster.isPassable(u.lat, u.lng) : true;
    lines.push(
      `- ${u.label || u.id} [${mobility}] at ${u.lat.toFixed(4)},${u.lng.toFixed(4)}: ` +
        `up to ~${Math.round(roadKm)}km along roads, ~${Math.round(openKm)}km cross-country` +
        (mobility === "wheeled" ? " (no marsh/water)" : "") +
        (onLand ? "" : " — WARNING: this unit is currently on impassable terrain"),
    );
  }

  return lines.join("\n");
}

// ─── Route helpers ───────────────────────────────────────────────────────────

/** Cumulative distance (km) along a waypoint list. */
function cumulativeKm(waypoints: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < waypoints.length; i++) {
    out.push(
      out[i - 1] +
        haversineKm(waypoints[i - 1][0], waypoints[i - 1][1], waypoints[i][0], waypoints[i][1]),
    );
  }
  return out;
}

/**
 * Cut a route down to the portion travelable within `budgetSec`.
 * Travel time is assumed to be proportional to distance along the route, which
 * is a good approximation because the A* already priced every cell by terrain.
 */
function truncateRoute(route: OSRMRoute, budgetSec: number): OSRMRoute {
  if (route.durationSec <= budgetSec || route.waypoints.length < 2) return route;

  const fraction = Math.max(0, Math.min(1, budgetSec / route.durationSec));
  const cum = cumulativeKm(route.waypoints);
  const target = cum[cum.length - 1] * fraction;

  let i = 1;
  while (i < cum.length - 1 && cum[i] < target) i++;

  return {
    waypoints: route.waypoints.slice(0, i + 1),
    distanceKm: cum[i],
    durationSec: budgetSec,
  };
}

/**
 * Find the nearest passable point to a destination, spiralling outward.
 * Returns null when nothing passable is found within MAX_SNAP_SEARCH_KM.
 */
function nearestPassable(
  raster: TerrainRaster,
  lat: number,
  lng: number,
  /**
   * Optional bias point (usually the unit). The search fans out from the
   * bearing towards it, so a destination in a river snaps to the near bank
   * rather than the far one. Omit for an unbiased nearest-ground search.
   */
  fromLat?: number,
  fromLng?: number,
  maxSearchKm: number = MAX_SNAP_SEARCH_KM,
): { lat: number; lng: number } | null {
  if (raster.isPassable(lat, lng)) return { lat, lng };

  const biased = typeof fromLat === "number" && typeof fromLng === "number";
  // Preferred direction: back towards the bias point.
  const backBearing = biased
    ? (Math.atan2(fromLng! - lng, fromLat! - lat) * 180) / Math.PI
    : 0;

  for (let r = SNAP_STEP_KM; r <= maxSearchKm; r += SNAP_STEP_KM) {
    // Sweep bearings, starting with the preferred direction and fanning out.
    for (let delta = 0; delta <= 180; delta += 15) {
      for (const sign of delta === 0 ? [1] : [1, -1]) {
        const p = offset(lat, lng, backBearing + sign * delta, r);
        if (raster.isPassable(p.lat, p.lng)) return p;
      }
    }
  }
  return null;
}

// ─── Start-state sanity ──────────────────────────────────────────────────────

export interface SnappedPlacement {
  id: string;
  label: string;
  kind: "unit" | "objective";
  fromKm: number;
}

/**
 * Report (without moving anything) which placements in a state are on
 * impassable terrain. Used for ontology-authored states so bad data is
 * visible in the console instead of being silently "corrected".
 */
export function checkStateOnLand(
  raster: TerrainRaster | null,
  state: MapPhaseState,
): SnappedPlacement[] {
  if (!raster?.isLoaded) return [];
  const bad: SnappedPlacement[] = [];
  for (const u of state.units) {
    if (!raster.isPassable(u.lat, u.lng)) {
      bad.push({ id: u.id, label: u.label || u.id, kind: "unit", fromKm: 0 });
    }
  }
  for (const o of state.objectives) {
    if (!raster.isPassable(o.lat, o.lng)) {
      bad.push({ id: o.id, label: o.name || o.id, kind: "objective", fromKm: 0 });
    }
  }
  return bad;
}

// ─── Enforcement ─────────────────────────────────────────────────────────────

/**
 * Validate and correct AI-generated orders against the terrain grid.
 *
 * Never throws and never drops an order: an order that cannot be executed at
 * all becomes a hold-in-place order with an explanatory note, so the planner
 * always sees what the AI intended and what the terrain allows.
 */
export async function constrainOrdersToTerrain(
  raster: TerrainRaster | null,
  units: MapUnitPlacement[],
  orders: UnitOrder[],
  newObjectives: MapObjectiveOutput[],
  durationHours: number,
): Promise<ConstrainedOrders> {
  if (!raster?.isLoaded) {
    console.warn("[orderReachability] terrain raster unavailable — AI orders not validated");
    return { orders, newObjectives, adjustments: [], routes: {}, skipped: true };
  }

  const budgetSec = Math.max(60, durationHours * 3600 * MOVE_TIME_FRACTION);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const adjustments: OrderAdjustment[] = [];
  const routes: Record<string, OSRMRoute> = {};
  const outOrders: UnitOrder[] = [];

  for (const order of orders) {
    const unit = unitById.get(order.unitId);
    if (!unit) {
      // Order for a unit that isn't on the map — leave it untouched; the
      // caller filters these out when drawing arrows.
      outOrders.push(order);
      continue;
    }

    const label = unit.label || unit.id;
    const mobility = getMobilityClass(unit);
    const requested = { lat: order.toLat, lng: order.toLng };

    const record = (
      kind: OrderAdjustmentKind,
      applied: { lat: number; lng: number },
      note: string,
      route?: OSRMRoute,
    ) => {
      if (kind !== "ok") {
        adjustments.push({
          unitId: unit.id,
          unitLabel: label,
          taskName: order.taskName,
          kind,
          requested,
          applied,
          shortfallKm: haversineKm(requested.lat, requested.lng, applied.lat, applied.lng),
          routeDistanceKm: route?.distanceKm,
          routeHours: route ? route.durationSec / 3600 : undefined,
          note,
        });
      }
      if (route) routes[unit.id] = route;
      outOrders.push({
        ...order,
        toLat: applied.lat,
        toLng: applied.lng,
        // Drop the objective link on a corrected order. The deterministic
        // resolver (resolveOrders) prefers the TARGET OBJECTIVE's coordinates
        // over the order's destination, so leaving it in place would quietly
        // send the unit back to the position we just established it cannot
        // reach. The objective itself stays on the map.
        targetObjectiveId: kind === "ok" ? order.targetObjectiveId : "",
        rationale:
          kind === "ok" ? order.rationale : `${order.rationale} [TERRAIN] ${note}`,
      });
    };

    // Static / in-place orders need no routing.
    if (haversineKm(unit.lat, unit.lng, order.toLat, order.toLng) < MIN_MOVE_KM) {
      record("ok", { lat: order.toLat, lng: order.toLng }, "");
      continue;
    }

    // Air units ignore terrain entirely — straight line at air speed.
    if (mobility === "air") {
      const distKm = haversineKm(unit.lat, unit.lng, order.toLat, order.toLng);
      const airSpeed = TERRAIN_SPEEDS.air[0] ?? 800;
      const hours = distKm / airSpeed;
      if (hours * 3600 <= budgetSec) {
        record("ok", requested, "");
      } else {
        const reachKm = (budgetSec / 3600) * airSpeed;
        const bearing =
          (Math.atan2(order.toLng - unit.lng, order.toLat - unit.lat) * 180) / Math.PI;
        const applied = offset(unit.lat, unit.lng, bearing, reachKm);
        record(
          "unreachable-in-phase",
          applied,
          `${distKm.toFixed(0)}km exceeds the ${(budgetSec / 3600).toFixed(1)}h air movement budget — ` +
            `destination pulled back to ${reachKm.toFixed(0)}km.`,
          undefined,
        );
      }
      continue;
    }

    // ── Ground units: route on the terrain grid ─────────────────────────────
    let target = requested;
    let snapped = false;

    if (!raster.isPassable(target.lat, target.lng)) {
      const alt = nearestPassable(raster, target.lat, target.lng, unit.lat, unit.lng);
      if (!alt) {
        record(
          "destination-impassable",
          { lat: unit.lat, lng: unit.lng },
          `Ordered onto impassable terrain (water/blocked) with no passable ground within ` +
            `${MAX_SNAP_SEARCH_KM}km — ${label} holds position.`,
        );
        continue;
      }
      target = alt;
      snapped = true;
    }

    let route: OSRMRoute | null = null;
    try {
      route = await raster.fetchRoute(unit.lat, unit.lng, target.lat, target.lng, mobility);
    } catch (err) {
      console.warn(`[orderReachability] routing failed for ${label}:`, err);
    }

    if (!route) {
      record(
        "no-route",
        { lat: unit.lat, lng: unit.lng },
        `No ${mobility} route exists to the ordered position (blocked by water or impassable ` +
          `terrain) — ${label} holds position.`,
      );
      continue;
    }

    if (route.durationSec <= budgetSec) {
      const note = snapped
        ? `Destination was in impassable terrain — moved ${haversineKm(requested.lat, requested.lng, target.lat, target.lng).toFixed(1)}km onto passable ground ` +
          `(${route.distanceKm.toFixed(1)}km by road/track, ${(route.durationSec / 3600).toFixed(1)}h).`
        : "";
      record(snapped ? "destination-impassable" : "ok", target, note, route);
      continue;
    }

    // Reachable in principle, but not within this phase — truncate the route.
    const truncated = truncateRoute(route, budgetSec);
    const end = truncated.waypoints[truncated.waypoints.length - 1];
    const applied = { lat: end[0], lng: end[1] };
    record(
      "unreachable-in-phase",
      applied,
      `Ordered position is ${route.distanceKm.toFixed(1)}km by ${mobility} route ` +
        `(~${(route.durationSec / 3600).toFixed(1)}h) but only ${(budgetSec / 3600).toFixed(1)}h of movement ` +
        `fits in this phase — ${label} advances ${truncated.distanceKm.toFixed(1)}km along the route instead.`,
      truncated,
    );
  }

  // Objectives the LLM invented can also land in water — nudge them ashore so
  // the planner isn't left with an objective marker in the middle of a lake.
  const fixedObjectives = newObjectives.map((o) => {
    if (raster.isPassable(o.lat, o.lng)) return o;
    const nearestUnit = units[0];
    const alt = nearestPassable(
      raster,
      o.lat,
      o.lng,
      nearestUnit?.lat ?? o.lat,
      nearestUnit?.lng ?? o.lng,
    );
    if (!alt) return o;
    console.log(`[orderReachability] objective "${o.name}" moved onto passable ground`);
    return { ...o, lat: alt.lat, lng: alt.lng };
  });

  return {
    orders: outOrders,
    newObjectives: fixedObjectives,
    adjustments,
    routes,
    skipped: false,
  };
}

/** One-line summary of the corrections, for the CONOPS / orders summary. */
export function summariseAdjustments(adjustments: OrderAdjustment[]): string {
  if (adjustments.length === 0) return "";
  const byKind = new Map<OrderAdjustmentKind, number>();
  for (const a of adjustments) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
  const parts: string[] = [];
  const label: Record<OrderAdjustmentKind, string> = {
    "ok": "unchanged",
    "destination-impassable": "moved off impassable terrain",
    "unreachable-in-phase": "shortened to fit the phase",
    "no-route": "held in place (no route)",
    "outside-terrain-data": "unverified (outside terrain data)",
  };
  for (const [kind, count] of byKind) parts.push(`${count} ${label[kind]}`);
  return `Terrain check: ${parts.join(", ")}.`;
}
