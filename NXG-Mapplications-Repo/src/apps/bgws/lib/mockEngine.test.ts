import { describe, expect, it } from "vitest";
import { BgwsMockEngine, MOCK_FEDERATE, mockUuid } from "./mockEngine";
import { latestStatuses, statusesForRequest } from "./events";
import { groupByCommand, summarise } from "./outcomes";
import { isUuid, planOrder } from "./orders";

const SCENARIO = JSON.stringify({
  format: "bgws.foundry",
  version: 1,
  name: "Mock test",
  seed: 1,
  durationMin: 90,
  startUtc: "2026-06-01T08:00:00Z",
  weather: "clear",
  area: { south: 54.65, west: 20.4, north: 54.75, east: 20.55 },
  terrain: "generated",
  command: { blue: "foundry", red: "foundry" },
  units: [
    { id: "b-1", label: "Blue 1", side: "blue", platform: "generic/mbt", count: 1, quality: "regular", lat: 54.66, lon: 20.41, headingDeg: 0 },
    { id: "r-1", label: "Red 1", side: "red", platform: "generic/mbt", count: 1, quality: "regular", lat: 54.74, lon: 20.54, headingDeg: 0 },
  ],
  objectives: [],
  breakpointPct: 60,
});

function rig() {
  let now = 1_000_000;
  const engine = new BgwsMockEngine(() => now);
  const advance = (ms: number, step = 250) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      engine.tick();
    }
  };
  return { engine, advance };
}

describe("BgwsMockEngine", () => {
  it("issues UUID-shaped, stable ids", () => {
    expect(isUuid(mockUuid("BGWS-1-1-1"))).toBe(true);
    expect(mockUuid("BGWS-1-1-1")).toBe(mockUuid("BGWS-1-1-1"));
    expect(mockUuid("BGWS-1-1-1")).not.toBe(mockUuid("BGWS-1-1-2"));
  });

  it("loads a scenario: SENT, then loading → ready answering the request, then units", () => {
    const { engine, advance } = rig();
    expect(engine.load(SCENARIO, "c-load")).toEqual({ ok: true, commandId: "c-load" });
    advance(6000);
    expect(summarise("c-load", groupByCommand(engine.outcomes).get("c-load") ?? []).state).toBe("sent");
    expect(statusesForRequest(engine.events, "c-load").map((s) => s.state)).toEqual(["loading", "ready"]);
    const units = engine.entities();
    expect(units.map((u) => u.unit)).toEqual([`${MOCK_FEDERATE}-1`, `${MOCK_FEDERATE}-2`]);
    expect(units[1].force).toBe("RED");
  });

  it("refuses a malformed scenario at the function, as the real one does", () => {
    const { engine } = rig();
    expect(engine.load("{}", "c").ok).toBe(false);
    expect(engine.load("nope", "c").ok).toBe(false);
  });

  it("runs, moves an ordered unit and completes the order", () => {
    const { engine, advance } = rig();
    engine.load(SCENARIO, "c-load");
    advance(6000);
    engine.control("start", "c-start");
    engine.control("speed", "c-speed", undefined, 50);
    advance(1500);
    expect(latestStatuses(engine.events)[0].state).toBe("running");

    const blue = engine.entities()[0];
    const plan = planOrder({ uniqueId: blue.uniqueId }, { kind: "move", to: { lat: 54.67, lon: 20.41 } });
    if (!plan.ok) throw new Error(plan.error);
    engine.order(plan.call, "c-move");
    advance(20_000);

    const s = summarise("c-move", groupByCommand(engine.outcomes).get("c-move") ?? []);
    expect(s.trail).toEqual(["queued", "sent", "accepted", "executing", "completed"]);
    const moved = engine.entities().find((e) => e.uniqueId === blue.uniqueId)!;
    expect(moved.lat).toBeCloseTo(54.67, 4);
  });

  it("refuses an order for an entity it does not have", () => {
    const { engine, advance } = rig();
    engine.order({ method: "stopEntity", args: [mockUuid("nobody")] }, "c-x");
    advance(1000);
    expect(summarise("c-x", engine.outcomes).state).toBe("refused");
  });

  it("answers control it cannot carry out with its current state", () => {
    const { engine, advance } = rig();
    engine.control("start", "c-start");
    advance(1500);
    const answer = statusesForRequest(engine.events, "c-start")[0];
    expect(answer).toMatchObject({ state: "idle" });
    expect(answer.message).toMatch(/Cannot start/);
  });

  it("stays silent when another federate is addressed", () => {
    const { engine, advance } = rig();
    engine.load(SCENARIO, "c-load", "BGWS-9-9");
    advance(6000);
    expect(statusesForRequest(engine.events, "c-load")).toEqual([]);
    expect(engine.entities()).toEqual([]);
  });
});
