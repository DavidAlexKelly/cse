// ── analysisScreen/lib/runStatistics.test.ts ───────────────────────────────
// Movement and contact measured from a hand-built track, and the separation
// between what is measured and what is scripted.
//
// Geometry around 54°N: 0.1° of latitude is 11.12 km.

import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/shared/hla/runEvents";
import { computeRunStatistics, CONTACT_RANGE_KM, type Roster } from "./runStatistics";
import type { SampledTrack, TrackSample } from "./sampleMockTrack";

const RUN_SEC = 600;
const CADENCE = 60;

function samples(points: [number, number][]): TrackSample[] {
  // Walks the polyline in equal time, as both the mock and the real feed do.
  const legs = Math.max(1, points.length - 1);
  const out: TrackSample[] = [];
  for (let tSec = 0; tSec <= RUN_SEC; tSec += CADENCE) {
    const scaled = (tSec / RUN_SEC) * legs;
    const index = Math.min(legs - 1, Math.floor(scaled));
    const within = scaled - index;
    const [fromLat, fromLon] = points[index];
    const [toLat, toLon] = points[index + 1];
    out.push({
      tSec,
      lat: fromLat + (toLat - fromLat) * within,
      lon: fromLon + (toLon - fromLon) * within,
    });
  }
  return out;
}

function track(entries: Record<string, [number, number][]>): SampledTrack {
  return new Map(Object.entries(entries).map(([id, points]) => [id, samples(points)]));
}

const roster: Roster = new Map([
  ["blue-1", { label: "1 Mech Bn", force: "BLUE" }],
  ["blue-2", { label: "CSS Hub", force: "BLUE" }],
  ["red-1", { label: "22nd AC", force: "RED" }],
]);

function event(overrides: Partial<RunEvent> = {}): RunEvent {
  return {
    id: "e",
    ts: 1_700_000_000,
    tSec: 100,
    kind: "engagement",
    provenance: "scripted",
    force: "RED",
    label: "Engagement",
    detail: "",
    ...overrides,
  };
}

describe("computeRunStatistics — movement", () => {
  it("totals ground covered per side and finds the furthest advance", () => {
    const stats = computeRunStatistics({
      runDurationSec: RUN_SEC,
      roster,
      track: track({
        // 0.2° north, then back 0.1° south: 33.4 km covered, 11.1 km displaced.
        "blue-1": [
          [54.0, 20.0],
          [54.2, 20.0],
          [54.1, 20.0],
        ],
        "blue-2": [
          [54.0, 20.5],
          [54.0, 20.5],
        ],
        "red-1": [
          [54.5, 20.0],
          [54.2, 20.0],
        ],
      }),
    });

    const [blue, red] = stats.movement;

    expect(blue.unitCount).toBe(2);
    expect(blue.totalDistanceKm).toBeCloseTo(33.4, 0);
    expect(blue.furthestAdvanceUnit).toBe("1 Mech Bn");
    expect(blue.furthestAdvanceKm).toBeCloseTo(11.1, 0);
    // The logistics hub never moved.
    expect(blue.staticUnits).toBe(1);

    expect(red.unitCount).toBe(1);
    expect(red.totalDistanceKm).toBeCloseTo(33.4, 0);
    expect(red.staticUnits).toBe(0);
  });

  it("leaves a unit nobody can place on a side out of both forces", () => {
    // Counting it into either would quietly bias that side's totals.
    const stats = computeRunStatistics({
      runDurationSec: RUN_SEC,
      roster,
      track: track({
        "blue-1": [
          [54.0, 20.0],
          [54.1, 20.0],
        ],
        "unknown-9": [
          [54.0, 21.0],
          [54.9, 21.0],
        ],
      }),
    });

    expect(stats.movement[0].unitCount).toBe(1);
    expect(stats.movement[1].unitCount).toBe(0);
    expect(stats.movement[0].totalDistanceKm).toBeCloseTo(11.1, 0);
  });
});

describe("computeRunStatistics — contact", () => {
  it("finds the closest the two sides came, and between which units", () => {
    const stats = computeRunStatistics({
      runDurationSec: RUN_SEC,
      roster,
      track: track({
        "blue-1": [
          [54.0, 20.0],
          [54.0, 20.0],
        ],
        // Closes to 0.05° — about 5.6 km — and stops there.
        "red-1": [
          [54.5, 20.0],
          [54.05, 20.0],
        ],
      }),
    });

    expect(stats.contact.closestApproachKm).toBeCloseTo(5.6, 0);
    expect(stats.contact.closestApproachPair).toEqual(["1 Mech Bn", "22nd AC"]);
    expect(stats.contact.closestApproachAtSec).toBe(RUN_SEC);
    expect(stats.contact.firstContactSec).not.toBeNull();
    expect(stats.contact.secondsInContact).toBeGreaterThan(0);
  });

  it("reports no contact when the sides stay apart", () => {
    const stats = computeRunStatistics({
      runDurationSec: RUN_SEC,
      roster,
      track: track({
        "blue-1": [
          [54.0, 20.0],
          [54.0, 20.0],
        ],
        // Two degrees of latitude away throughout — far outside contact range.
        "red-1": [
          [56.0, 20.0],
          [56.0, 20.0],
        ],
      }),
    });

    expect(stats.contact.firstContactSec).toBeNull();
    expect(stats.contact.secondsInContact).toBe(0);
    expect(stats.contact.closestApproachKm).toBeGreaterThan(CONTACT_RANGE_KM);
  });
});

describe("computeRunStatistics — attrition", () => {
  const oneSided = track({
    "blue-1": [
      [54.0, 20.0],
      [54.0, 20.0],
    ],
  });

  it("is absent entirely when there is no event log", () => {
    // Absent and zero are very different claims: one is "no data", the other is
    // "nobody was hit". A real run can only honestly say the former.
    const stats = computeRunStatistics({
      runDurationSec: RUN_SEC,
      roster,
      track: oneSided,
    });
    expect(stats.attrition).toBeNull();
  });

  it("tallies losses and the exchange ratio from the log", () => {
    const stats = computeRunStatistics({
      runDurationSec: RUN_SEC,
      roster,
      track: oneSided,
      events: [
        event({ id: "a", tSec: 100, losses: { blue: 2, red: 0 } }),
        event({ id: "b", tSec: 200, kind: "loss", losses: { blue: 1, red: 6 } }),
        event({ id: "c", tSec: 300, kind: "detection" }),
      ],
    });

    expect(stats.attrition!.blueLosses).toBe(3);
    expect(stats.attrition!.redLosses).toBe(6);
    expect(stats.attrition!.exchangeRatio).toBe(2);
    expect(stats.attrition!.engagements).toBe(2);
    expect(stats.attrition!.firstEngagementSec).toBe(100);
    expect(stats.attrition!.heaviestExchange?.id).toBe("b");
  });

  it("has no exchange ratio to report when nothing was lost on our side", () => {
    const stats = computeRunStatistics({
      runDurationSec: RUN_SEC,
      roster,
      track: oneSided,
      events: [event({ losses: { blue: 0, red: 3 } })],
    });
    expect(stats.attrition!.exchangeRatio).toBeNull();
  });

  it("calls the tally scripted unless every event in it was observed", () => {
    const mixed = computeRunStatistics({
      runDurationSec: RUN_SEC,
      roster,
      track: oneSided,
      events: [event({ id: "a", provenance: "observed" }), event({ id: "b" })],
    });
    expect(mixed.attrition!.provenance).toBe("scripted");

    const observed = computeRunStatistics({
      runDurationSec: RUN_SEC,
      roster,
      track: oneSided,
      events: [event({ id: "a", provenance: "observed" })],
    });
    expect(observed.attrition!.provenance).toBe("observed");
  });
});
