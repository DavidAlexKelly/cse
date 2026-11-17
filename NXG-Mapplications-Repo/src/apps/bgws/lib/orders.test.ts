import { describe, expect, it } from "vitest";
import { FUNCTION_FOR_METHOD, REFUSED_BY_BGWS, isUuid, planOrder, type BgwsOrder } from "./orders";

const UUID = "0f8fad5b-d9cb-569f-a165-70867728950e";
const TARGET = "7c9e6679-7425-50de-944b-e07fc1f90ae7";
const unit = { uniqueId: UUID, callsign: "1 Pl Tank 2" };

function call(order: BgwsOrder, subject: Parameters<typeof planOrder>[0] = unit) {
  const plan = planOrder(subject, order);
  if (!plan.ok) throw new Error(plan.error);
  return plan.call;
}

describe("planOrder", () => {
  it("refuses a unit with no NETN UniqueId, never addressing it by handle", () => {
    const plan = planOrder({ callsign: "X" }, { kind: "stop" });
    expect(plan).toEqual({ ok: false, error: "X publishes no NETN UniqueId, so it cannot be ordered." });
    expect(planOrder({ uniqueId: "ObjectInstanceHandle<12>" }, { kind: "stop" }).ok).toBe(false);
  });

  it("move → moveToLocation with the bridge's 'move' (FASTEST) type", () => {
    expect(call({ kind: "move", to: { lat: 54.7, lon: 20.5 } })).toEqual({
      method: "moveToLocation",
      args: [UUID, 54.7, 20.5, "move"],
    });
  });

  it("patrol → patrol 'once': BGWS goes through the points then holds", () => {
    const waypoints = [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }];
    expect(call({ kind: "patrol", waypoints })).toEqual({ method: "patrol", args: [UUID, waypoints, "once"] });
    expect(planOrder(unit, { kind: "patrol", waypoints: [] }).ok).toBe(false);
  });

  it("magic move normalises heading and keeps a known altitude", () => {
    expect(call({ kind: "magicMove", to: { lat: 1, lon: 2 }, headingDeg: -90 })).toEqual({
      method: "magicMove",
      args: [UUID, 1, 2, 270],
    });
    expect(call({ kind: "magicMove", to: { lat: 1, lon: 2 }, headingDeg: 370 }, { ...unit, altitudeMeters: 1500 })).toEqual({
      method: "magicMove",
      args: [UUID, 1, 2, 10, 1500],
    });
  });

  it("stop, cancel and ROE map one to one", () => {
    expect(call({ kind: "stop" })).toEqual({ method: "stopEntity", args: [UUID] });
    expect(call({ kind: "cancel" })).toEqual({ method: "cancelTasks", args: [UUID] });
    expect(call({ kind: "roe", roe: "hold_fire" })).toEqual({ method: "setRoe", args: [UUID, "hold_fire"] });
    expect(planOrder(unit, { kind: "roe", roe: "weapons_free" as never }).ok).toBe(false);
  });

  it("fire at entity needs a UUID target that is not the firer", () => {
    expect(call({ kind: "fireAtEntity", targetUniqueId: TARGET })).toEqual({
      method: "fireAtEntity",
      args: [UUID, TARGET, 60],
    });
    expect(planOrder(unit, { kind: "fireAtEntity", targetUniqueId: UUID.toUpperCase() }).ok).toBe(false);
    expect(planOrder(unit, { kind: "fireAtEntity", targetUniqueId: "" }).ok).toBe(false);
  });

  it("fire at location rounds the duration up to the poster's positive minimum", () => {
    expect(call({ kind: "fireAtLocation", at: { lat: 1, lon: 2 }, durationS: 0 })).toEqual({
      method: "fireAtLocation",
      args: [UUID, 1, 2, 1],
    });
  });

  it("rejects points off the globe", () => {
    expect(planOrder(unit, { kind: "move", to: { lat: 91, lon: 0 } }).ok).toBe(false);
    expect(planOrder(unit, { kind: "move", to: { lat: Number.NaN, lon: 0 } }).ok).toBe(false);
  });

  it("never plans an order BGWS refuses", () => {
    const methods = Object.values(FUNCTION_FOR_METHOD);
    for (const refused of REFUSED_BY_BGWS) expect(methods).not.toContain(refused);
  });
});

describe("isUuid", () => {
  it("accepts UUIDs in either case only", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid(UUID.toUpperCase())).toBe(true);
    expect(isUuid("BGWS-1-1-7")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
