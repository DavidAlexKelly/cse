// ── shared/hla/balticShieldEvents.test.ts ──────────────────────────────────
// The scripted log stays honest and stays attached to the movement it narrates.

import { describe, expect, it } from "vitest";
import { ADVANCE_DURATION_S, BALTIC_SHIELD_ENTITIES, laydownAt } from "./balticShield";
import { balticShieldRunEvents } from "./balticShieldEvents";
import { tallyLosses } from "./runEvents";

const RUN_START_S = 1_700_000_000;
const ENTITY_IDS = new Set(BALTIC_SHIELD_ENTITIES.map((entity) => entity.id));

const events = balticShieldRunEvents(RUN_START_S, ADVANCE_DURATION_S);

describe("balticShieldRunEvents", () => {
  it("marks every event as scripted", () => {
    // Nothing in this log is derived from the feed, and a debrief that showed
    // it alongside measured numbers has to be able to tell them apart.
    expect(events.every((event) => event.provenance === "scripted")).toBe(true);
  });

  it("only refers to units the federation actually publishes", () => {
    for (const event of events) {
      if (event.actor?.entityId) expect(ENTITY_IDS.has(event.actor.entityId)).toBe(true);
      if (event.target?.entityId) expect(ENTITY_IDS.has(event.target.entityId)).toBe(true);
    }
  });

  it("places every event inside the run, in order", () => {
    for (const event of events) {
      expect(event.tSec).toBeGreaterThanOrEqual(0);
      expect(event.tSec).toBeLessThanOrEqual(ADVANCE_DURATION_S);
      expect(event.ts).toBe(RUN_START_S + event.tSec);
    }

    const times = events.map((event) => event.tSec);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("puts each event where its unit actually was at that moment", () => {
    // Positions are looked up from the laydown rather than authored, so editing
    // a unit's legs moves its events with it instead of stranding them.
    const withActor = events.filter((event) => event.actor?.entityId && event.location);
    expect(withActor.length).toBeGreaterThan(5);

    for (const event of withActor) {
      const progress = event.tSec / ADVANCE_DURATION_S;
      const entity = laydownAt(progress).find(
        (candidate) => candidate.id === event.actor!.entityId,
      );
      expect(entity).toBeDefined();
      expect(event.location!.lat).toBeCloseTo(entity!.lat, 5);
      expect(event.location!.lon).toBeCloseTo(entity!.lon, 5);
    }
  });

  it("gives the acting side the same affiliation the federation gives that unit", () => {
    for (const event of events) {
      if (event.actor) expect(event.actor.force).toBe(event.force);
    }
  });

  it("costs both sides something, so the exchange is not a walkover", () => {
    const losses = tallyLosses(events);
    expect(losses.blue).toBeGreaterThan(0);
    expect(losses.red).toBeGreaterThan(0);
  });

  it("gives every event a line for the timeline and a paragraph for the debrief", () => {
    for (const event of events) {
      expect(event.label.length).toBeGreaterThan(10);
      expect(event.detail.length).toBeGreaterThan(60);
    }
  });

  it("attributes a means to everything that caused a loss", () => {
    for (const event of events) {
      const cost = (event.losses?.blue ?? 0) + (event.losses?.red ?? 0);
      if (cost > 0) expect(event.means).toBeTruthy();
    }
  });

  it("opens and closes with a phase boundary", () => {
    expect(events[0].kind).toBe("phase");
    expect(events[events.length - 1].kind).toBe("phase");
  });

  it("scales onto a run of a different length", () => {
    const shorter = balticShieldRunEvents(0, 600);
    expect(shorter).toHaveLength(events.length);
    expect(shorter[shorter.length - 1].tSec).toBeLessThanOrEqual(600);
  });
});
