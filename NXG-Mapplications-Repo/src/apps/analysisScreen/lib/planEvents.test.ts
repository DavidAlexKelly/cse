// ── analysisScreen/lib/planEvents.test.ts ──────────────────────────────────
// Which moments earn a marker on the scrub track, and which do not.

import { describe, expect, it } from "vitest";
import type { OrderCompliance } from "./compliance";
import { planKeyEvents } from "./planEvents";

const RUN_START_S = 1_700_000_000;

function makeOrder(overrides: Partial<OrderCompliance> = {}): OrderCompliance {
  return {
    orderId: "bs-p1-armour",
    unitId: "bs-armour",
    entityId: "bs-armour",
    unitLabel: "3 Armd Bn (Reserve)",
    force: "blue",
    taskLabel: "Move to Assembly Area",
    status: "ACHIEVED_LATE",
    routeLengthKm: 16.6,
    plannedDurationHours: 1.1,
    plannedPhaseFraction: 0.023,
    plannedRunSec: 83,
    actualArrivalSec: 1065,
    actualArrivalPhaseHours: 14.2,
    deltaPhaseHours: 13.1,
    maxProgressPct: 100,
    finalProgressPct: 0,
    distanceTravelledKm: 50,
    finalDistanceToDestinationKm: 28.1,
    meanCrossTrackKm: 0.4,
    maxCrossTrackKm: 2.3,
    maxCrossTrackAtSec: 400,
    withdrewAfterArrival: true,
    conflictingOrderIds: [],
    predictedEndDistanceKm: null,
    ...overrides,
  };
}

function kinds(events: ReturnType<typeof planKeyEvents>): string[] {
  return events.map((event) => event.kind);
}

describe("planKeyEvents", () => {
  it("places the deadline, the arrival and the worst deviation on the run clock", () => {
    const events = planKeyEvents(makeOrder(), RUN_START_S);

    expect(kinds(events).sort()).toEqual(["arrival", "deviation", "plan"]);

    const byKind = new Map(events.map((event) => [event.kind, event]));
    expect(byKind.get("plan")!.ts).toBe(RUN_START_S + 83);
    expect(byKind.get("arrival")!.ts).toBe(RUN_START_S + 1065);
    expect(byKind.get("deviation")!.ts).toBe(RUN_START_S + 400);
  });

  it("says how late the arrival was", () => {
    const events = planKeyEvents(makeOrder(), RUN_START_S);
    const arrival = events.find((event) => event.kind === "arrival")!;
    expect(arrival.label).toContain("13.1 h late");
  });

  it("says how early an arrival was, rather than calling it negative lateness", () => {
    const events = planKeyEvents(makeOrder({ deltaPhaseHours: -2.5 }), RUN_START_S);
    const arrival = events.find((event) => event.kind === "arrival")!;
    expect(arrival.label).toContain("2.5 h early");
  });

  it("emits nothing at all when no order is selected", () => {
    expect(planKeyEvents(null, RUN_START_S)).toEqual([]);
  });

  it("has no arrival marker for an order that never arrived", () => {
    const events = planKeyEvents(
      makeOrder({ status: "EN_ROUTE_AT_END", actualArrivalSec: null, deltaPhaseHours: null }),
      RUN_START_S,
    );
    expect(kinds(events)).not.toContain("arrival");
    expect(kinds(events)).toContain("plan");
  });

  it("ignores a deviation too small to be the reason anyone is looking", () => {
    // Every track wanders a few hundred metres off a straight line; marking
    // that would put a badge on the timeline for nothing.
    const events = planKeyEvents(makeOrder({ maxCrossTrackKm: 0.4 }), RUN_START_S);
    expect(kinds(events)).not.toContain("deviation");
  });

  it("draws no deadline for an order there was nothing to measure", () => {
    // Neither of these has anything on the track to relate a deadline to.
    for (const status of ["NOT_OBSERVED", "NO_PLANNED_ROUTE"] as const) {
      const events = planKeyEvents(
        makeOrder({
          status,
          actualArrivalSec: null,
          maxCrossTrackAtSec: null,
          maxCrossTrackKm: 0,
        }),
        RUN_START_S,
      );
      expect(events).toEqual([]);
    }
  });
});
