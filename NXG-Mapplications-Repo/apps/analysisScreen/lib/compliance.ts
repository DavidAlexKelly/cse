// ── analysisScreen/lib/compliance.ts ───────────────────────────────────────
// Plan against execution: what each order asked for, and what the run did.
//
// Pure — no React, no network, no Leaflet. Everything it needs is the plan
// (shared/hla/balticShieldPlan) and a per-entity track (lib/sampleMockTrack).
// That is deliberate: this is the only part of the feature with real geometry
// in it, and geometry wants tests more than it wants a render tree.
//
// Observation, not prediction
// ---------------------------
// The planner has its own verdict vocabulary — OrderFeasibility in
// phaseCreator/resolveOrders.ts, with values like "infeasible-time". Those are
// *forecasts* made before the run. What is computed here is a *measurement*
// made after it. The two must not share a vocabulary, or a panel showing both
// would be unable to say which is which, so ComplianceStatus below is its own
// closed set.
//
// Time in this engine
// -------------------
// A planned phase and a replay are on different clocks: OP-BALTIC-SHIELD Phase
// 1 is planned across 48 real hours, and the mock advance compresses it into an
// hour. Comparing "the plan said 3.2 h" against "the replay took 20 min" would
// be arithmetic on two different units.
//
// So every timing here is a FRACTION OF THE PHASE, converted for display:
//   · the planner's estimate, in real hours (its own number, reproduced with
//     its own distance function and its own rate table)
//   · the observed arrival, expressed as the equivalent point in the phase
// A delta between those two is meaningful; a delta between wall clocks is not.

import {
  distanceKm,
  movementRateKmh,
} from "@/apps/scenarioPlanner/shared/timeScale";
import type {
  PhasePlan,
  PlanPoint,
  PlannedCategory,
  PlannedOrder,
} from "@/shared/hla/balticShieldPlan";
import type { SampledTrack, TrackSample } from "./sampleMockTrack";

// ── Tuning ──────────────────────────────────────────────────────────────────

/**
 * How close counts as "reached it".
 *
 * 2 km against this plan, where the shortest ordered move is the Iskander
 * brigade's 5.6 km repositioning: comfortably under half the shortest move, so
 * arrival cannot be satisfied simply by standing still at the start point, and
 * generous enough for battalion- and brigade-sized objectives that are an area
 * rather than a point.
 */
export const DEFAULT_ARRIVAL_RADIUS_KM = 2;

/**
 * How long it has to stay there.
 *
 * Without this, a unit whose axis happens to pass over its objective scores an
 * arrival on the way past. Sixty seconds of run time is four samples at the
 * default cadence — enough to tell "arrived" from "drove through".
 */
export const DEFAULT_ARRIVAL_DWELL_SEC = 60;

/** Below this much total movement, a unit did not go anywhere. */
export const DEFAULT_STATIONARY_THRESHOLD_KM = 0.5;

/** Perpendicular distance from the ordered axis that stops counting as "roughly along it". */
export const DEFAULT_OFF_ROUTE_THRESHOLD_KM = 5;

/** Shorter than this and an order carries no axis to measure against at all. */
const MIN_MEASURABLE_ROUTE_KM = 0.05;

export interface ComplianceOptions {
  arrivalRadiusKm?: number;
  arrivalDwellSec?: number;
  stationaryThresholdKm?: number;
  offRouteThresholdKm?: number;
}

// ── Result shapes ───────────────────────────────────────────────────────────

export type ComplianceStatus =
  /** Reached the ordered destination, at or before the point in the phase the plan implied. */
  | "ACHIEVED_ON_TIME"
  /** Reached it, but later in the phase than planned. */
  | "ACHIEVED_LATE"
  /** Moved, stayed roughly on the axis, still short of the destination at run end. */
  | "EN_ROUTE_AT_END"
  /** Never left its start position. */
  | "NEVER_MOVED"
  /** Moved, but left the ordered axis by more than the threshold and never arrived. */
  | "OFF_ROUTE"
  /** The assigned unit never appeared in the federation. */
  | "NOT_OBSERVED"
  /** The order has no axis long enough to measure — typically drawn on the unit's own position. */
  | "NO_PLANNED_ROUTE";

export interface OrderCompliance {
  orderId: string;
  unitId: string;
  entityId?: string;
  unitLabel: string;
  force: "blue" | "red";
  taskLabel: string;
  status: ComplianceStatus;

  /** Length of the ordered axis. */
  routeLengthKm: number;

  // ── Timing, all in phase terms — see the header ──
  /** What the planner's own rate table implies this move should take, in real hours. */
  plannedDurationHours: number;
  /** That, as a fraction of the phase (0–1). */
  plannedPhaseFraction: number;
  /**
   * Where the planned deadline falls on the replay clock, in seconds after run
   * start.
   *
   * Assumes the order is live from the start of the phase, which is true of
   * every order in this plan — the planner draws them against the phase's start
   * state and the stored map state carries no per-order H-hour. An order with
   * its own start time would need that added here rather than measured from
   * zero, or it would be reported late by however long it was waiting.
   */
  plannedRunSec: number;
  /** When it actually got there, in seconds after run start. Null → never did. */
  actualArrivalSec: number | null;
  /** That arrival expressed as the equivalent point in the phase, in real hours. */
  actualArrivalPhaseHours: number | null;
  /** actual − planned, in phase hours. Positive is late. Null → never arrived. */
  deltaPhaseHours: number | null;

  // ── Movement ──
  /** Furthest along the axis it ever got, 0–100. */
  maxProgressPct: number;
  /** How far along it was when the run ended, 0–100. */
  finalProgressPct: number;
  /** Total ground covered, however indirectly. */
  distanceTravelledKm: number;
  /** Straight-line distance from its final position to the ordered destination. */
  finalDistanceToDestinationKm: number | null;

  // ── Adherence to the axis ──
  meanCrossTrackKm: number;
  maxCrossTrackKm: number;
  /** When the worst deviation happened, in seconds after run start. */
  maxCrossTrackAtSec: number | null;

  /** Reached the destination and then left it again before the run ended. */
  withdrewAfterArrival: boolean;
  /** Other orders in the plan assigned to the same unit. */
  conflictingOrderIds: string[];

  /**
   * Distance between its final observed position and where the plan predicted
   * it would end up. Null when the plan predicts nothing for this unit.
   */
  predictedEndDistanceKm: number | null;
}

export interface RunCompliance {
  phaseId: string;
  phaseName: string;
  phaseDurationHours: number;
  runDurationSec: number;
  orders: OrderCompliance[];
  /** Orders whose assigned unit never appeared in the feed. */
  notObservedCount: number;
}

// ── Geometry ────────────────────────────────────────────────────────────────
//
// Distances along and between points use distanceKm — the planner's own
// haversine — so that "the plan assumed N hours" here reproduces exactly the
// number resolveOrders would have produced, rather than being a second opinion
// about the same move.
//
// The perpendicular decomposition (how far off the axis, how far along it)
// needs a flat plane, so it is done in a local equirectangular frame anchored
// on the order's own start point. Over axes of this length — the longest here
// is 50 km — the projection error is under a metre, and it keeps cross-track
// honest: measuring to the nearest *vertex* of a polyline instead of the
// nearest point on its *segments* is the classic version of this bug and would
// report kilometres of imaginary deviation halfway along a long leg.

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;

interface PlanarPoint {
  x: number;
  y: number;
}

function planarProjector(origin: PlanPoint): (point: PlanPoint) => PlanarPoint {
  const lngScale = Math.cos(origin.lat * DEG_TO_RAD) * DEG_TO_RAD * EARTH_RADIUS_KM;
  const latScale = DEG_TO_RAD * EARTH_RADIUS_KM;
  return (point) => ({
    x: (point.lng - origin.lng) * lngScale,
    y: (point.lat - origin.lat) * latScale,
  });
}

interface RouteProjection {
  /** Perpendicular distance from the polyline, km. */
  crossTrackKm: number;
  /** Distance from the start of the polyline to the nearest point on it, km. */
  alongTrackKm: number;
  /** Which segment the nearest point fell on. */
  segmentIndex: number;
  /** How far along that segment, 0–1. */
  segmentFraction: number;
}

interface PreparedRoute {
  points: PlanPoint[];
  planar: PlanarPoint[];
  /** Haversine length of each segment. */
  segmentKm: number[];
  /** Cumulative haversine length at the start of each segment. */
  cumulativeKm: number[];
  totalKm: number;
  project: (point: PlanPoint) => PlanarPoint;
}

function prepareRoute(points: PlanPoint[]): PreparedRoute {
  const project = planarProjector(points[0]);
  const planar = points.map(project);

  const segmentKm: number[] = [];
  const cumulativeKm: number[] = [];
  let running = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    cumulativeKm.push(running);
    const length = distanceKm(points[i], points[i + 1]);
    segmentKm.push(length);
    running += length;
  }

  return { points, planar, segmentKm, cumulativeKm, totalKm: running, project };
}

/** Nearest point on the polyline to `point`, decomposed into across and along. */
function projectOntoRoute(route: PreparedRoute, point: PlanPoint): RouteProjection {
  const p = route.project(point);

  let bestCross = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let bestSegment = 0;
  let bestT = 0;

  for (let i = 0; i < route.planar.length - 1; i += 1) {
    const a = route.planar[i];
    const b = route.planar[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;

    // Degenerate segment (repeated vertex): fall back to the vertex itself.
    const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));

    const closestX = a.x + t * dx;
    const closestY = a.y + t * dy;
    const cross = Math.hypot(p.x - closestX, p.y - closestY);

    if (cross < bestCross) {
      bestCross = cross;
      // Scale the within-segment fraction by the segment's haversine length, so
      // "percent along the route" stays consistent with routeLengthKm.
      bestAlong = route.cumulativeKm[i] + t * route.segmentKm[i];
      bestSegment = i;
      bestT = t;
    }
  }

  return {
    crossTrackKm: bestCross,
    alongTrackKm: bestAlong,
    segmentIndex: bestSegment,
    segmentFraction: bestT,
  };
}

/**
 * The point on an ordered axis a unit is closest to, and how far off it is.
 *
 * The map draws a band between the two, which is the only way to see a
 * deviation as a deviation rather than as a unit that happens to be over there.
 *
 * The projection is affine in (lat, lng), so the point at fraction t along a
 * segment in the planar frame is the point at fraction t in degrees — no
 * inverse projection needed, just an interpolation between the two vertices.
 */
export function nearestPointOnRoute(
  route: PlanPoint[],
  point: PlanPoint,
): { point: PlanPoint; crossTrackKm: number } | null {
  if (route.length < 2) return null;

  const prepared = prepareRoute(route);
  const { crossTrackKm, segmentIndex, segmentFraction } = projectOntoRoute(prepared, point);

  const from = route[segmentIndex];
  const to = route[segmentIndex + 1];

  return {
    point: {
      lat: from.lat + (to.lat - from.lat) * segmentFraction,
      lng: from.lng + (to.lng - from.lng) * segmentFraction,
    },
    crossTrackKm,
  };
}

/** Track samples use `lon`; the plan uses `lng`. Convert once, here. */
function toPlanPoint(sample: TrackSample): PlanPoint {
  return { lat: sample.lat, lng: sample.lon };
}

// ── Timing ──────────────────────────────────────────────────────────────────

/**
 * How long the planner thought this move would take, in seconds.
 *
 * Terrain-routed orders carry the answer (routeDurationSec). Everything else
 * gets the estimate resolveOrders would have made: the route's length over the
 * cross-country rate for the unit's category. Cross-country rather than road
 * because that is what resolveOrders uses for order feasibility, and the point
 * of this number is to reproduce the planner's own expectation rather than to
 * improve on it.
 */
export function plannedDurationSecFor(
  routeLengthKm: number,
  category: PlannedCategory,
  routeDurationSec?: number,
): number {
  if (routeDurationSec != null && routeDurationSec > 0) return routeDurationSec;
  const rateKmh = movementRateKmh(category, "crossCountry");
  if (!(rateKmh > 0)) return Number.POSITIVE_INFINITY;
  return (routeLengthKm / rateKmh) * 3600;
}

// ── Arrival ─────────────────────────────────────────────────────────────────

interface Arrival {
  tSec: number;
  sampleIndex: number;
}

/**
 * When the unit got to the destination and stayed.
 *
 * Returns the moment it first entered the radius on the visit that stuck, not
 * the moment the dwell was satisfied — an analyst asking "when did it get
 * there" means the former.
 *
 * A unit still inside the radius when the run ends counts as arrived even if
 * the dwell was not met, because there was no more run in which to dwell. The
 * dwell test exists to reject fly-throughs, and a unit that is still there at
 * the end plainly did not fly through.
 */
function findArrival(
  samples: TrackSample[],
  destination: PlanPoint,
  radiusKm: number,
  dwellSec: number,
): Arrival | null {
  let entryIndex: number | null = null;

  for (let i = 0; i < samples.length; i += 1) {
    const inside = distanceKm(toPlanPoint(samples[i]), destination) <= radiusKm;

    if (!inside) {
      entryIndex = null;
      continue;
    }

    if (entryIndex == null) entryIndex = i;

    const dwelled = samples[i].tSec - samples[entryIndex].tSec >= dwellSec;
    const atRunEnd = i === samples.length - 1;
    if (dwelled || atRunEnd) {
      return { tSec: samples[entryIndex].tSec, sampleIndex: entryIndex };
    }
  }

  return null;
}

// ── The engine ──────────────────────────────────────────────────────────────

function emptyCompliance(
  order: PlannedOrder,
  status: ComplianceStatus,
  routeLengthKm: number,
  plannedDurationHours: number,
  plannedPhaseFraction: number,
  plannedRunSec: number,
  conflictingOrderIds: string[],
): OrderCompliance {
  return {
    orderId: order.id,
    unitId: order.unitId,
    entityId: order.entityId,
    unitLabel: order.unitLabel,
    force: order.force,
    taskLabel: order.taskLabel,
    status,
    routeLengthKm,
    plannedDurationHours,
    plannedPhaseFraction,
    plannedRunSec,
    actualArrivalSec: null,
    actualArrivalPhaseHours: null,
    deltaPhaseHours: null,
    maxProgressPct: 0,
    finalProgressPct: 0,
    distanceTravelledKm: 0,
    finalDistanceToDestinationKm: null,
    meanCrossTrackKm: 0,
    maxCrossTrackKm: 0,
    maxCrossTrackAtSec: null,
    withdrewAfterArrival: false,
    conflictingOrderIds,
    predictedEndDistanceKm: null,
  };
}

/**
 * Measure every order in a plan against what the run actually did.
 *
 * `runDurationSec` is the replay's own length; the plan's phaseDurationHours is
 * what it was planned across. The two are related only proportionally — see the
 * header.
 */
export function assessPlanCompliance(
  plan: PhasePlan,
  track: SampledTrack,
  runDurationSec: number,
  options: ComplianceOptions = {},
): RunCompliance {
  const arrivalRadiusKm = options.arrivalRadiusKm ?? DEFAULT_ARRIVAL_RADIUS_KM;
  const arrivalDwellSec = options.arrivalDwellSec ?? DEFAULT_ARRIVAL_DWELL_SEC;
  const stationaryThresholdKm = options.stationaryThresholdKm ?? DEFAULT_STATIONARY_THRESHOLD_KM;
  const offRouteThresholdKm = options.offRouteThresholdKm ?? DEFAULT_OFF_ROUTE_THRESHOLD_KM;

  const duration = Math.max(1, runDurationSec);
  const phaseSeconds = Math.max(1, plan.phaseDurationHours * 3600);

  // Two orders on one unit is a planning artefact worth surfacing rather than
  // silently resolving — resolveOrders picks the first and ignores the rest,
  // which is a reasonable thing for a forecast to do and a misleading thing for
  // a review to do.
  const ordersByUnit = new Map<string, string[]>();
  for (const order of plan.orders) {
    const existing = ordersByUnit.get(order.unitId);
    if (existing) existing.push(order.id);
    else ordersByUnit.set(order.unitId, [order.id]);
  }

  const predictedById = new Map(
    plan.predictedEndState.map((unit) => [unit.id, unit] as const),
  );

  const orders = plan.orders.map((order): OrderCompliance => {
    const conflictingOrderIds = (ordersByUnit.get(order.unitId) ?? []).filter(
      (id) => id !== order.id,
    );

    const route = prepareRoute(order.route);
    const routeLengthKm = route.totalKm;

    const plannedDurationSec = plannedDurationSecFor(
      routeLengthKm,
      order.category,
      order.routeDurationSec,
    );
    const plannedPhaseFraction = plannedDurationSec / phaseSeconds;
    const plannedRunSec = plannedPhaseFraction * duration;
    const plannedDurationHours = plannedDurationSec / 3600;

    const blank = (status: ComplianceStatus) =>
      emptyCompliance(
        order,
        status,
        routeLengthKm,
        plannedDurationHours,
        plannedPhaseFraction,
        plannedRunSec,
        conflictingOrderIds,
      );

    if (routeLengthKm < MIN_MEASURABLE_ROUTE_KM) return blank("NO_PLANNED_ROUTE");

    const samples = order.entityId ? track.get(order.entityId) : undefined;
    if (!samples || samples.length === 0) return blank("NOT_OBSERVED");

    const destination = order.route[order.route.length - 1];

    // ── Walk the track once ──
    let distanceTravelledKm = 0;
    let maxAlongKm = 0;
    for (let i = 1; i < samples.length; i += 1) {
      distanceTravelledKm += distanceKm(toPlanPoint(samples[i - 1]), toPlanPoint(samples[i]));
    }
    for (const sample of samples) {
      const { alongTrackKm } = projectOntoRoute(route, toPlanPoint(sample));
      if (alongTrackKm > maxAlongKm) maxAlongKm = alongTrackKm;
    }

    const finalSample = samples[samples.length - 1];
    const finalProjection = projectOntoRoute(route, toPlanPoint(finalSample));
    const finalDistanceToDestinationKm = distanceKm(toPlanPoint(finalSample), destination);

    const arrival = findArrival(samples, destination, arrivalRadiusKm, arrivalDwellSec);

    // ── Cross-track, over the part of the run the order was still live for ──
    // Past the arrival the unit is doing something else — usually its next
    // phase — and folding that into "did it follow its axis" would turn every
    // completed order into a deviation.
    const window = arrival ? samples.slice(0, arrival.sampleIndex + 1) : samples;
    let crossSum = 0;
    let maxCrossTrackKm = 0;
    let maxCrossTrackAtSec: number | null = null;
    for (const sample of window) {
      const { crossTrackKm } = projectOntoRoute(route, toPlanPoint(sample));
      crossSum += crossTrackKm;
      if (crossTrackKm > maxCrossTrackKm) {
        maxCrossTrackKm = crossTrackKm;
        maxCrossTrackAtSec = sample.tSec;
      }
    }
    const meanCrossTrackKm = window.length > 0 ? crossSum / window.length : 0;

    const predicted = predictedById.get(order.unitId);
    const predictedEndDistanceKm = predicted
      ? distanceKm(toPlanPoint(finalSample), { lat: predicted.lat, lng: predicted.lng })
      : null;

    const pct = (km: number) =>
      routeLengthKm > 0 ? Math.min(100, Math.max(0, (km / routeLengthKm) * 100)) : 0;

    let status: ComplianceStatus;
    if (arrival) {
      status = arrival.tSec <= plannedRunSec ? "ACHIEVED_ON_TIME" : "ACHIEVED_LATE";
    } else if (distanceTravelledKm < stationaryThresholdKm) {
      status = "NEVER_MOVED";
    } else if (maxCrossTrackKm > offRouteThresholdKm) {
      status = "OFF_ROUTE";
    } else {
      status = "EN_ROUTE_AT_END";
    }

    const actualArrivalPhaseHours =
      arrival != null ? (arrival.tSec / duration) * plan.phaseDurationHours : null;

    return {
      orderId: order.id,
      unitId: order.unitId,
      entityId: order.entityId,
      unitLabel: order.unitLabel,
      force: order.force,
      taskLabel: order.taskLabel,
      status,
      routeLengthKm,
      plannedDurationHours,
      plannedPhaseFraction,
      plannedRunSec,
      actualArrivalSec: arrival?.tSec ?? null,
      actualArrivalPhaseHours,
      deltaPhaseHours:
        actualArrivalPhaseHours != null ? actualArrivalPhaseHours - plannedDurationHours : null,
      maxProgressPct: pct(maxAlongKm),
      finalProgressPct: pct(finalProjection.alongTrackKm),
      distanceTravelledKm,
      finalDistanceToDestinationKm,
      meanCrossTrackKm,
      maxCrossTrackKm,
      maxCrossTrackAtSec,
      withdrewAfterArrival: arrival != null && finalDistanceToDestinationKm > arrivalRadiusKm,
      conflictingOrderIds,
      predictedEndDistanceKm,
    };
  });

  return {
    phaseId: plan.phaseId,
    phaseName: plan.phaseName,
    phaseDurationHours: plan.phaseDurationHours,
    runDurationSec: duration,
    orders,
    notObservedCount: orders.filter((order) => order.status === "NOT_OBSERVED").length,
  };
}

// ── Reading the result ──────────────────────────────────────────────────────

/** Short label for a status. */
export const STATUS_LABEL: Record<ComplianceStatus, string> = {
  ACHIEVED_ON_TIME: "ON TIME",
  ACHIEVED_LATE: "LATE",
  EN_ROUTE_AT_END: "EN ROUTE",
  NEVER_MOVED: "NO MOVE",
  OFF_ROUTE: "OFF ROUTE",
  NOT_OBSERVED: "NOT SEEN",
  NO_PLANNED_ROUTE: "NO AXIS",
};

/**
 * How a status should read, without saying in what colour.
 *
 * "muted" is for the two statuses that are not a judgement on the unit at all:
 * an order whose unit was never published, and one drawn with no axis, are
 * findings about the *plan*, and coding them as failures would blame the wrong
 * party.
 */
export type ComplianceTone = "good" | "warn" | "bad" | "muted";

export function statusTone(status: ComplianceStatus): ComplianceTone {
  switch (status) {
    case "ACHIEVED_ON_TIME":
      return "good";
    case "ACHIEVED_LATE":
    case "EN_ROUTE_AT_END":
      return "warn";
    case "NEVER_MOVED":
    case "OFF_ROUTE":
      return "bad";
    case "NOT_OBSERVED":
    case "NO_PLANNED_ROUTE":
      return "muted";
  }
}

export interface ComplianceSummary {
  total: number;
  /** Orders with both an axis and an observed unit — the ones actually measured. */
  measurable: number;
  byStatus: Record<ComplianceStatus, number>;
  arrived: number;
  lateCount: number;
  /** Median lateness across the orders that arrived late, in phase hours. */
  medianLatePhaseHours: number | null;
  withdrewCount: number;
  /** Units carrying more than one order. */
  conflictedUnitCount: number;
}

/**
 * The run in aggregate.
 *
 * This exists because of what the real plan produces: every order that arrives
 * arrives late, because the planner's estimate is distance over a rate table
 * and the execution is paced by something else entirely. Fourteen rows each
 * saying "late" is not fourteen findings, it is one — that the plan's movement
 * assumptions do not match the executed tempo. The panel leads with this so the
 * individually interesting rows are not buried under it.
 */
export function summariseCompliance(run: RunCompliance): ComplianceSummary {
  const byStatus: Record<ComplianceStatus, number> = {
    ACHIEVED_ON_TIME: 0,
    ACHIEVED_LATE: 0,
    EN_ROUTE_AT_END: 0,
    NEVER_MOVED: 0,
    OFF_ROUTE: 0,
    NOT_OBSERVED: 0,
    NO_PLANNED_ROUTE: 0,
  };

  const lateness: number[] = [];
  const conflictedUnits = new Set<string>();
  let arrived = 0;
  let withdrewCount = 0;

  for (const order of run.orders) {
    byStatus[order.status] += 1;
    if (order.actualArrivalSec != null) arrived += 1;
    if (order.withdrewAfterArrival) withdrewCount += 1;
    if (order.conflictingOrderIds.length > 0) conflictedUnits.add(order.unitId);
    if (order.status === "ACHIEVED_LATE" && order.deltaPhaseHours != null) {
      lateness.push(order.deltaPhaseHours);
    }
  }

  lateness.sort((a, b) => a - b);
  const middle = Math.floor(lateness.length / 2);
  const medianLatePhaseHours =
    lateness.length === 0
      ? null
      : lateness.length % 2 === 1
        ? lateness[middle]
        : (lateness[middle - 1] + lateness[middle]) / 2;

  return {
    total: run.orders.length,
    measurable:
      run.orders.length - byStatus.NOT_OBSERVED - byStatus.NO_PLANNED_ROUTE,
    byStatus,
    arrived,
    lateCount: byStatus.ACHIEVED_LATE,
    medianLatePhaseHours,
    withdrewCount,
    conflictedUnitCount: conflictedUnits.size,
  };
}

// ── Narrative ───────────────────────────────────────────────────────────────

function hours(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value >= 10 ? `${value.toFixed(0)} h` : `${value.toFixed(1)} h`;
}

/**
 * One line an analyst can read without the table around it.
 *
 * Kept next to the engine rather than in a component because it is the same
 * sentence whether it is going into a panel, a tooltip, or an exported AAR.
 */
export function describeCompliance(compliance: OrderCompliance): string {
  const head = `${compliance.unitLabel} — ${compliance.taskLabel.toUpperCase()}`;
  const planned = `plan assumed ${hours(compliance.plannedDurationHours)} of the phase`;

  switch (compliance.status) {
    case "NOT_OBSERVED":
      return `${head}: ordered, but the unit never appeared in the federation — nothing to measure.`;
    case "NO_PLANNED_ROUTE":
      return `${head}: drawn on the unit's own position, so there is no axis to measure against.`;
    case "NEVER_MOVED":
      return `${head}: ${planned}; the unit never left its start position.`;
    case "OFF_ROUTE":
      return (
        `${head}: ${planned}; the unit reached ${compliance.maxProgressPct.toFixed(0)}% along the ` +
        `axis but strayed up to ${compliance.maxCrossTrackKm.toFixed(1)} km off it and never arrived.`
      );
    case "EN_ROUTE_AT_END":
      return (
        `${head}: ${planned}; the unit was still ` +
        `${(compliance.finalDistanceToDestinationKm ?? 0).toFixed(1)} km short at the end of the run, ` +
        `${compliance.finalProgressPct.toFixed(0)}% along the axis.`
      );
    case "ACHIEVED_ON_TIME":
    case "ACHIEVED_LATE": {
      const actual = hours(compliance.actualArrivalPhaseHours ?? 0);
      const delta = compliance.deltaPhaseHours ?? 0;
      const timing =
        compliance.status === "ACHIEVED_ON_TIME"
          ? `arrived at ${actual}`
          : `arrived at ${actual} — ${hours(Math.abs(delta))} late`;
      const withdrew = compliance.withdrewAfterArrival
        ? ` It did not hold: by the end of the run it was ${(compliance.finalDistanceToDestinationKm ?? 0).toFixed(1)} km away again.`
        : "";
      return `${head}: ${planned}; ${timing}.${withdrew}`;
    }
  }
}
