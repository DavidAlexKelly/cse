import { describe, expect, it } from "vitest";
import type { BgwsEventRow, HlaEntity } from "../types";
import {
  estimateSimTime,
  eventFamily,
  familiesIn,
  federateStatusOf,
  filterEvents,
  formatSimTime,
  isBgwsEntity,
  latestStatuses,
  mergeEvents,
  statusesForRequest,
  uniqueIdsInEvents,
  DEFAULT_EVENT_FILTER,
} from "./events";

const U1 = "0f8fad5b-d9cb-569f-a165-70867728950e";
const U2 = "7c9e6679-7425-50de-944b-e07fc1f90ae7";

let seq = 0;
function ev(kind: string, extra: Partial<BgwsEventRow> = {}): BgwsEventRow {
  seq += 1;
  return { event_id: `e${seq}`, bridge_seq: seq, kind, source: "bgws", federate: "BGWS-1-1", ...extra };
}
function status(state: string, extra: Record<string, unknown> = {}, row: Partial<BgwsEventRow> = {}): BgwsEventRow {
  return ev("federate.status", { data: JSON.stringify({ state, simTimeS: 12, speed: 2, units: 15, ...extra }), ...row });
}

describe("federate status", () => {
  it("reads federate.status data", () => {
    expect(federateStatusOf(status("running", { requestId: "r1", message: "go", scenario: "Op" }))).toMatchObject({
      federate: "BGWS-1-1",
      state: "running",
      requestId: "r1",
      simTimeS: 12,
      speed: 2,
      units: 15,
      message: "go",
      scenario: "Op",
    });
    expect(federateStatusOf(ev("fire.hit"))).toBeNull();
  });

  it("survives malformed data", () => {
    expect(federateStatusOf(ev("federate.status", { data: "{nope", sim_time_s: 4 }))).toMatchObject({ state: "unknown", simTimeS: 4 });
  });

  it("keeps the latest per federate, in stream order", () => {
    const rows = [status("loading"), status("ready", {}, { federate: "BGWS-2-1" }), status("running")];
    // Read out of order: the later one must still win.
    const latest = latestStatuses([rows[2], rows[0], rows[1]]);
    expect(latest.map((s) => [s.federate, s.state])).toEqual([
      ["BGWS-1-1", "running"],
      ["BGWS-2-1", "ready"],
    ]);
  });

  it("finds BGWS's answers to one request", () => {
    const rows = [status("loading", { requestId: "c1" }), status("idle"), status("ready", { requestId: "c1" })];
    expect(statusesForRequest(rows, "c1").map((s) => s.state)).toEqual(["loading", "ready"]);
  });
});

describe("filterEvents", () => {
  const rows = [
    status("running"),
    ev("fire.hit", { side: "blue", entity_unique_id: U1, target_unique_id: U2, text: "1 Pl hits T-72", entity_callsign: "1 Pl" }),
    ev("unit.destroyed", { side: "red", entity_unique_id: U2, text: "T-72 destroyed" }),
    ev("sense.detect", { side: "red", federate: "BGWS-2-1", text: "spotted" }),
  ];

  it("hides federate.status unless asked", () => {
    expect(filterEvents(rows, DEFAULT_EVENT_FILTER)).toHaveLength(3);
    expect(filterEvents(rows, { ...DEFAULT_EVENT_FILTER, includeStatus: true })).toHaveLength(4);
  });
  it("filters by family", () => {
    expect(filterEvents(rows, { ...DEFAULT_EVENT_FILTER, families: ["fire", "unit"] }).map((r) => r.kind)).toEqual(["fire.hit", "unit.destroyed"]);
  });
  it("filters by side", () => {
    expect(filterEvents(rows, { ...DEFAULT_EVENT_FILTER, side: "red" }).map((r) => r.kind)).toEqual(["unit.destroyed", "sense.detect"]);
  });
  it("filters by unit, as actor or target, case-insensitively", () => {
    expect(filterEvents(rows, { ...DEFAULT_EVENT_FILTER, unitUniqueId: U2.toUpperCase() }).map((r) => r.kind)).toEqual(["fire.hit", "unit.destroyed"]);
  });
  it("filters by text and federate", () => {
    expect(filterEvents(rows, { ...DEFAULT_EVENT_FILTER, text: "1 pl" })).toHaveLength(1);
    expect(filterEvents(rows, { ...DEFAULT_EVENT_FILTER, federate: "BGWS-2-1" }).map((r) => r.kind)).toEqual(["sense.detect"]);
  });
  it("lists families by frequency, without status", () => {
    expect(familiesIn([...rows, ev("fire.miss")])).toEqual(["fire", "sense", "unit"]);
    expect(eventFamily("victory")).toBe("victory");
    expect(eventFamily(null)).toBe("other");
  });
});

describe("mergeEvents", () => {
  it("dedupes on event_id, keeps order and caps", () => {
    const a = ev("a");
    const b = ev("b");
    const c = ev("c");
    expect(mergeEvents([a, b], [b, c]).map((r) => r.kind)).toEqual(["a", "b", "c"]);
    expect(mergeEvents([c], [a, b]).map((r) => r.kind)).toEqual(["a", "b", "c"]);
    expect(mergeEvents([a, b], [c], 2).map((r) => r.kind)).toEqual(["b", "c"]);
  });
  it("returns the same array when nothing is new, so React can skip a render", () => {
    const held = [ev("a")];
    expect(mergeEvents(held, [held[0]])).toBe(held);
  });
});

describe("isBgwsEntity", () => {
  const entity = (unit: string, uniqueId?: string): Pick<HlaEntity, "unit" | "simulator" | "uniqueId"> => ({ unit, simulator: "unknown", uniqueId });

  it("recognises BGWS instance names", () => {
    expect(isBgwsEntity(entity("BGWS-1-1-7"))).toBe(true);
    expect(isBgwsEntity(entity("SWORD_123_ARMOR.Tank"))).toBe(false);
  });
  it("narrows to one federate's entities", () => {
    expect(isBgwsEntity(entity("BGWS-1-1-7"), "BGWS-1-1")).toBe(true);
    expect(isBgwsEntity(entity("BGWS-1-10-7"), "BGWS-1-1")).toBe(false);
    expect(isBgwsEntity(entity("BGWS-2-1-7"), "BGWS-1-1")).toBe(false);
  });
  it("also accepts entities BGWS events have named", () => {
    const ids = uniqueIdsInEvents([ev("fire.hit", { entity_unique_id: U1 }), ev("x", { source: "rpr", entity_unique_id: U2 })]);
    expect(isBgwsEntity(entity("HLA.GroundVehicle1", U1.toUpperCase()), "", ids)).toBe(true);
    // RPR fire is from any simulator, so it does not make a unit BGWS's.
    expect(isBgwsEntity(entity("HLA.GroundVehicle2", U2), "", ids)).toBe(false);
  });
});

describe("estimateSimTime", () => {
  const at = "2026-06-01T08:00:00.000Z";
  const t0 = Date.parse(at);
  it("runs the clock on at the reported speed while running", () => {
    expect(estimateSimTime({ federate: "f", state: "running", simTimeS: 100, speed: 4, receivedAt: at }, t0 + 10_000)).toBe(140);
  });
  it("holds it still otherwise", () => {
    expect(estimateSimTime({ federate: "f", state: "paused", simTimeS: 100, speed: 4, receivedAt: at }, t0 + 10_000)).toBe(100);
    expect(estimateSimTime({ federate: "f", state: "running" }, t0)).toBeUndefined();
  });
});

describe("formatSimTime", () => {
  it("formats hh:mm:ss", () => {
    expect(formatSimTime(3723.9)).toBe("01:02:03");
    expect(formatSimTime(undefined)).toBe("—");
  });
});
