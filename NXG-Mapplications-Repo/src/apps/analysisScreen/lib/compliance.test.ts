// ── analysisScreen/lib/compliance.test.ts ──────────────────────────────────
// The geometry and the status rules, against tracks built by hand.
//
// Every fixture below is a straight-line move around 54°N/20°E, so the
// expected distances are checkable on paper: 0.1° of latitude is 11.12 km, and
// 0.1° of longitude at this latitude is 6.54 km.

import { describe, expect, it } from "vitest";
import type { PhasePlan, PlanPoint, PlannedOrder } from "@/shared/hla/balticShieldPlan";
import {
  assessPlanCompliance,
  DEFAULT_ARRIVAL_RADIUS_KM,
  nearestPointOnRoute,
  plannedDurationSecFor,
  statusTone,
  summariseCompliance,
  type OrderCompliance,
  type RunCompliance,
} from "./compliance";
import type { SampledTrack, TrackSample } from "./sampleMockTrack";

const RUN_SEC = 3600;
const CADENCE_SEC = 15;

/** Start of every test route. */
const A: PlanPoint = { lat: 54.0, lng: 20.0 };
/** 22.24 km due north of A. */
const B: PlanPoint = { lat: 54.2, lng: 20.0 };
/** Halfway between them. */
const MID: PlanPoint = { lat: 54.1, lng: 20.0 };
/** 19.6 km due east of A — well off the A→B axis. */
const EAST: PlanPoint = { lat: 54.0, lng: 20.3 };

/**
 * A two-hour phase, so that the planner's estimate lands inside the replay
 * rather than in the first few seconds of it. The real plan spans 48 h; that
 * ratio is exercised in balticShieldPlan.test.ts against the real data.
 */
const PHASE_HOURS = 2;

function order(overrides: Partial<PlannedOrder> & Pick<PlannedOrder, "id">): PlannedOrder {
  return {
    unitId: "unit-1",
    entityId: "unit-1",
    unitLabel: "Test Bn",
    force: "blue",
    taskLabel: "Move",
    // Armour: 15 km/h cross-country, so the 22.24 km A→B axis is planned at
    // 1.483 h — 74% of a two-hour phase, or T+2669s on the replay clock.
    category: "Armour",
    route: [A, B],
    ...overrides,
  };
}

function plan(orders: PlannedOrder[]): PhasePlan {
  return {
    phaseId: "test-phase",
    scenarioId: "test-scenario",
    phaseName: "Test Phase",
    objectiveStatement: "",
    startOffset: "D+0",
    endOffset: "D+1",
    phaseDurationHours: PHASE_HOURS,
    units: [],
    orders,
    objectives: [],
    controlMeasures: [],
    predictedEndState: [],
  };
}

/**
 * Walk a polyline in equal time per leg, exactly as the scripted advance does,
 * and sample it at the same cadence sampleMockTrack uses.
 */
function buildTrack(entityId: string, legs: PlanPoint[], runSec = RUN_SEC): SampledTrack {
  const samples: TrackSample[] = [];
  const legCount = Math.max(1, legs.length - 1);

  for (let tSec = 0; tSec <= runSec; tSec += CADENCE_SEC) {
    const scaled = (tSec / runSec) * legCount;
    const index = Math.min(legCount - 1, Math.floor(scaled));
    const within = scaled - index;
    const from = legs[index];
    const to = legs[index + 1];
    samples.push({
      tSec,
      lat: from.lat + (to.lat - from.lat) * within,
      lon: from.lng + (to.lng - from.lng) * within,
    });
  }

  return new Map([[entityId, samples]]);
}

function assess(orders: PlannedOrder[], track: SampledTrack) {
  return assessPlanCompliance(plan(orders), track, RUN_SEC);
}

describe("plannedDurationSecFor", () => {
  it("uses a terrain-routed duration when the planner computed one", () => {
    expect(plannedDurationSecFor(22.24, "Armour", 900)).toBe(900);
  });

  it("otherwise derives it from the route length and the category rate", () => {
    // 22.24 km at Armour's 15 km/h cross-country rate.
    expect(plannedDurationSecFor(22.24, "Armour")).toBeCloseTo((22.24 / 15) * 3600, 0);
    // Infantry is far slower, so the same axis is planned much longer.
    expect(plannedDurationSecFor(22.24, "Infantry")).toBeGreaterThan(
      plannedDurationSecFor(22.24, "Armour"),
    );
  });
});

describe("assessPlanCompliance — statuses", () => {
  it("reports a unit that follows the axis and arrives inside the planned window", () => {
    // A → B over the first half of the run, then holds.
    const result = assess([order({ id: "o1" })], buildTrack("unit-1", [A, B, B]));
    const [o] = result.orders;

    expect(o.status).toBe("ACHIEVED_ON_TIME");
    expect(o.actualArrivalSec).not.toBeNull();
    expect(o.actualArrivalSec!).toBeLessThan(o.plannedRunSec);
    expect(o.maxCrossTrackKm).toBeLessThan(0.01);
    expect(o.maxProgressPct).toBeCloseTo(100, 0);
    expect(o.finalProgressPct).toBeCloseTo(100, 0);
    expect(o.withdrewAfterArrival).toBe(false);
  });

  it("reports a unit that arrives later in the phase than planned", () => {
    // Sits at A for the first half, then moves — arrival lands past the
    // planner's deadline.
    const result = assess([order({ id: "o1" })], buildTrack("unit-1", [A, A, B]));
    const [o] = result.orders;

    expect(o.status).toBe("ACHIEVED_LATE");
    expect(o.actualArrivalSec!).toBeGreaterThan(o.plannedRunSec);
    expect(o.deltaPhaseHours!).toBeGreaterThan(0);
  });

  it("reports a unit that stops short", () => {
    const result = assess([order({ id: "o1" })], buildTrack("unit-1", [A, MID, MID]));
    const [o] = result.orders;

    expect(o.status).toBe("EN_ROUTE_AT_END");
    expect(o.actualArrivalSec).toBeNull();
    expect(o.maxProgressPct).toBeCloseTo(50, 0);
    expect(o.finalDistanceToDestinationKm!).toBeCloseTo(11.12, 1);
  });

  it("reports a unit that never left its start position", () => {
    const result = assess([order({ id: "o1" })], buildTrack("unit-1", [A, A]));
    const [o] = result.orders;

    expect(o.status).toBe("NEVER_MOVED");
    expect(o.distanceTravelledKm).toBeLessThan(0.01);
    expect(o.maxProgressPct).toBeCloseTo(0, 1);
  });

  it("reports a unit that moved but left the ordered axis", () => {
    const result = assess([order({ id: "o1" })], buildTrack("unit-1", [A, EAST, EAST]));
    const [o] = result.orders;

    expect(o.status).toBe("OFF_ROUTE");
    expect(o.maxCrossTrackKm).toBeGreaterThan(15);
    expect(o.actualArrivalSec).toBeNull();
  });

  it("reports an order whose unit never appeared in the federation", () => {
    const result = assess(
      [order({ id: "o1", entityId: "never-published" })],
      buildTrack("unit-1", [A, B]),
    );
    const [o] = result.orders;

    expect(o.status).toBe("NOT_OBSERVED");
    expect(result.notObservedCount).toBe(1);
  });

  it("reports an order drawn on the unit's own position as unmeasurable", () => {
    const result = assess([order({ id: "o1", route: [A, A] })], buildTrack("unit-1", [A, B]));
    expect(result.orders[0].status).toBe("NO_PLANNED_ROUTE");
  });
});

describe("assessPlanCompliance — arrival rules", () => {
  it("counts a unit still on the objective when the run ends, even without the full dwell", () => {
    // A → B across the whole run: it only enters the radius in the last few
    // samples, so the dwell can never be satisfied — but it plainly arrived.
    const result = assess([order({ id: "o1" })], buildTrack("unit-1", [A, B]));
    expect(result.orders[0].actualArrivalSec).not.toBeNull();
  });

  it("does not count a unit that merely passes over the objective", () => {
    // 333 km in an hour — inside the 2 km radius for well under the dwell, and
    // far away again by the end.
    const result = assess(
      [order({ id: "o1" })],
      buildTrack("unit-1", [A, { lat: 57.0, lng: 20.0 }]),
    );
    expect(result.orders[0].actualArrivalSec).toBeNull();
  });

  it("flags a unit that reached the objective and then left it", () => {
    const result = assess([order({ id: "o1" })], buildTrack("unit-1", [A, B, A]));
    const [o] = result.orders;

    expect(o.actualArrivalSec).not.toBeNull();
    expect(o.withdrewAfterArrival).toBe(true);
    expect(o.maxProgressPct).toBeCloseTo(100, 0);
    expect(o.finalProgressPct).toBeLessThan(5);
    expect(o.finalDistanceToDestinationKm!).toBeGreaterThan(DEFAULT_ARRIVAL_RADIUS_KM);
  });
});

describe("assessPlanCompliance — cross-track", () => {
  it("measures a parallel offset as the offset, and still allows the arrival", () => {
    // 0.0153° of longitude at 54°N is almost exactly 1 km.
    const offset = 0.0153;
    const result = assess(
      [order({ id: "o1" })],
      buildTrack("unit-1", [
        { lat: A.lat, lng: A.lng + offset },
        { lat: B.lat, lng: B.lng + offset },
        { lat: B.lat, lng: B.lng + offset },
      ]),
    );
    const [o] = result.orders;

    expect(o.maxCrossTrackKm).toBeGreaterThan(0.8);
    expect(o.maxCrossTrackKm).toBeLessThan(1.2);
    expect(o.meanCrossTrackKm).toBeGreaterThan(0.8);
    expect(o.status.startsWith("ACHIEVED")).toBe(true);
  });

  it("measures to the nearest point on a segment, not to the nearest vertex", () => {
    // An L-shaped axis. The unit sits on the middle of the first leg, ~9.8 km
    // from either end of it. A vertex-only implementation would call that a
    // 9.8 km deviation; it is zero.
    const dogleg = [A, { lat: 54.0, lng: 20.3 }, { lat: 54.2, lng: 20.3 }];
    const onFirstLeg: PlanPoint = { lat: 54.0, lng: 20.15 };

    const result = assess(
      [order({ id: "o1", route: dogleg })],
      buildTrack("unit-1", [onFirstLeg, onFirstLeg]),
    );

    expect(result.orders[0].maxCrossTrackKm).toBeLessThan(0.01);
    // Halfway along the first of two roughly equal legs.
    expect(result.orders[0].maxProgressPct).toBeGreaterThan(15);
    expect(result.orders[0].maxProgressPct).toBeLessThan(35);
  });

  it("stops measuring deviation once the order has been achieved", () => {
    // Arrives at B halfway through, then drives 19.6 km east on its next task.
    // That is not a deviation from an order it has already completed.
    const result = assess([order({ id: "o1" })], buildTrack("unit-1", [A, B, { lat: 54.2, lng: 20.3 }]));
    expect(result.orders[0].maxCrossTrackKm).toBeLessThan(0.5);
  });
});

describe("assessPlanCompliance — planning artefacts", () => {
  it("surfaces two orders held against the same unit rather than picking one", () => {
    const result = assess(
      [order({ id: "o1" }), order({ id: "o2", taskLabel: "Attack", route: [A, EAST] })],
      buildTrack("unit-1", [A, B, B]),
    );

    expect(result.orders[0].conflictingOrderIds).toEqual(["o2"]);
    expect(result.orders[1].conflictingOrderIds).toEqual(["o1"]);
  });

  it("measures the final position against the predicted end state when there is one", () => {
    const base = plan([order({ id: "o1" })]);
    const withPrediction: PhasePlan = {
      ...base,
      predictedEndState: [
        { id: "unit-1", entityId: "unit-1", label: "Test Bn", force: "blue", lat: B.lat, lng: B.lng },
      ],
    };

    const result = assessPlanCompliance(
      withPrediction,
      buildTrack("unit-1", [A, MID, MID]),
      RUN_SEC,
    );

    // Ended at MID; the plan predicted B, 11.12 km further on.
    expect(result.orders[0].predictedEndDistanceKm!).toBeCloseTo(11.12, 1);
  });

  it("reports no prediction distance when the plan predicts nothing for the unit", () => {
    const result = assess([order({ id: "o1" })], buildTrack("unit-1", [A, B, B]));
    expect(result.orders[0].predictedEndDistanceKm).toBeNull();
  });
});

describe("nearestPointOnRoute", () => {
  it("returns the foot of the perpendicular rather than a vertex", () => {
    // 0.05° of longitude east of the midpoint of A→B — about 3.27 km.
    const found = nearestPointOnRoute([A, B], { lat: 54.1, lng: 20.05 })!;

    expect(found.crossTrackKm).toBeCloseTo(3.27, 1);
    expect(found.point.lat).toBeCloseTo(54.1, 3);
    expect(found.point.lng).toBeCloseTo(20.0, 3);
  });

  it("clamps to the end of the axis for a point beyond it", () => {
    const found = nearestPointOnRoute([A, B], { lat: 54.3, lng: 20.0 })!;

    expect(found.point.lat).toBeCloseTo(B.lat, 6);
    expect(found.crossTrackKm).toBeCloseTo(11.12, 1);
  });

  it("has nothing to offer a route with no length", () => {
    expect(nearestPointOnRoute([A], { lat: 54.1, lng: 20.0 })).toBeNull();
  });
});

describe("statusTone", () => {
  it("does not blame the unit for the plan's own gaps", () => {
    // An order whose unit was never published, or one drawn with no axis, is a
    // finding about the plan. Colouring those as failures points at the wrong
    // party, so they are muted rather than bad.
    expect(statusTone("NOT_OBSERVED")).toBe("muted");
    expect(statusTone("NO_PLANNED_ROUTE")).toBe("muted");
    expect(statusTone("NEVER_MOVED")).toBe("bad");
    expect(statusTone("ACHIEVED_ON_TIME")).toBe("good");
  });
});

describe("summariseCompliance", () => {
  function makeOrder(overrides: Partial<OrderCompliance>): OrderCompliance {
    return {
      orderId: "o",
      unitId: "u",
      unitLabel: "Unit",
      force: "blue",
      taskLabel: "Move",
      status: "ACHIEVED_ON_TIME",
      routeLengthKm: 10,
      plannedDurationHours: 1,
      plannedPhaseFraction: 0.5,
      plannedRunSec: 1800,
      actualArrivalSec: 1800,
      actualArrivalPhaseHours: 1,
      deltaPhaseHours: 0,
      maxProgressPct: 100,
      finalProgressPct: 100,
      distanceTravelledKm: 10,
      finalDistanceToDestinationKm: 0,
      meanCrossTrackKm: 0,
      maxCrossTrackKm: 0,
      maxCrossTrackAtSec: null,
      withdrewAfterArrival: false,
      conflictingOrderIds: [],
      predictedEndDistanceKm: null,
      ...overrides,
    };
  }

  function run(orders: OrderCompliance[]): RunCompliance {
    return {
      phaseId: "p",
      phaseName: "Phase",
      phaseDurationHours: 48,
      runDurationSec: RUN_SEC,
      orders,
      notObservedCount: orders.filter((order) => order.status === "NOT_OBSERVED").length,
    };
  }

  it("takes the median lateness of the arrivals that were late, and only those", () => {
    const summary = summariseCompliance(
      run([
        makeOrder({ orderId: "a", status: "ACHIEVED_LATE", deltaPhaseHours: 4 }),
        makeOrder({ orderId: "b", status: "ACHIEVED_LATE", deltaPhaseHours: 20 }),
        makeOrder({ orderId: "c", status: "ACHIEVED_LATE", deltaPhaseHours: 12 }),
        // On time, so it must not drag the median down.
        makeOrder({ orderId: "d", status: "ACHIEVED_ON_TIME", deltaPhaseHours: -6 }),
      ]),
    );

    expect(summary.lateCount).toBe(3);
    expect(summary.arrived).toBe(4);
    expect(summary.medianLatePhaseHours).toBe(12);
  });

  it("averages the middle pair when the late orders are even in number", () => {
    const summary = summariseCompliance(
      run([
        makeOrder({ orderId: "a", status: "ACHIEVED_LATE", deltaPhaseHours: 4 }),
        makeOrder({ orderId: "b", status: "ACHIEVED_LATE", deltaPhaseHours: 8 }),
      ]),
    );
    expect(summary.medianLatePhaseHours).toBe(6);
  });

  it("has no median when nothing arrived late", () => {
    expect(summariseCompliance(run([makeOrder({})])).medianLatePhaseHours).toBeNull();
  });

  it("excludes unmeasurable orders from the measurable count", () => {
    const summary = summariseCompliance(
      run([
        makeOrder({ orderId: "a" }),
        makeOrder({ orderId: "b", status: "NOT_OBSERVED", actualArrivalSec: null }),
        makeOrder({ orderId: "c", status: "NO_PLANNED_ROUTE", actualArrivalSec: null }),
      ]),
    );

    expect(summary.total).toBe(3);
    expect(summary.measurable).toBe(1);
  });

  it("counts units carrying more than one order once, not once per order", () => {
    const summary = summariseCompliance(
      run([
        makeOrder({ orderId: "a", unitId: "shared", conflictingOrderIds: ["b"] }),
        makeOrder({ orderId: "b", unitId: "shared", conflictingOrderIds: ["a"] }),
      ]),
    );
    expect(summary.conflictedUnitCount).toBe(1);
  });

  it("counts the units that reached an objective and then left it", () => {
    const summary = summariseCompliance(
      run([
        makeOrder({ orderId: "a", withdrewAfterArrival: true }),
        makeOrder({ orderId: "b" }),
      ]),
    );
    expect(summary.withdrewCount).toBe(1);
  });
});
