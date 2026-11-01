import { describe, expect, it } from "vitest";
import type { MapPhaseState } from "../../scenarioPlanner/phaseCreator/types";
import { assessPlanCompliance } from "./compliance";
import { categoryFor, parseMapState, phasePlanFromMapState, withEntityIds } from "./phasePlan";

const START: MapPhaseState = {
  units: [
    {
      id: "u-bn",
      templateId: "mech-infantry__Battalion",
      label: "1 Mech Bn",
      sidc: "SFGPUCIZ---F---",
      lat: 54.1,
      lng: 20.2,
    },
    {
      id: "u-red",
      templateId: "motor-rifle",
      label: "22nd MRBDE",
      sidc: "SHGPUCIM---H---",
      lat: 54.8,
      lng: 21.3,
    },
    {
      id: "u-ship",
      templateId: "destroyer",
      label: "DD",
      sidc: "SFSPCLDD-------",
      lat: 55,
      lng: 19.5,
    },
  ],
  arrows: [
    // Terrain-routed order: the route is the waypoints, not the straight line.
    {
      id: "o-1",
      fromLat: 54.1,
      fromLng: 20.2,
      toLat: 54.3,
      toLng: 20.4,
      colour: "#4a90d9",
      tacticLabel: "Advance to Contact",
      assignedUnitId: "u-bn",
      routeWaypoints: [
        [54.1, 20.2],
        [54.2, 20.25],
        [54.3, 20.4],
      ],
      routeDurationSec: 7200,
    },
    {
      id: "o-2",
      fromLat: 54.8,
      fromLng: 21.3,
      toLat: 54.5,
      toLng: 21.1,
      colour: "#e74c3c",
      tacticLabel: "Attack",
      assignedUnitId: "u-red",
    },
    // No unit → a control measure, not an order.
    {
      id: "cm-1",
      fromLat: 54,
      fromLng: 20,
      toLat: 54.5,
      toLng: 20,
      colour: "#ccc",
      tacticLabel: "Boundary",
    },
  ],
  objectives: [{ id: "obj", name: "OBJ GOLD", lat: 54.3, lng: 20.4, colour: "#fc0" }],
};

const plan = phasePlanFromMapState({
  scenarioId: "s",
  phaseId: "p1",
  phaseName: "Phase 1",
  objectiveStatement: "Secure the corridor",
  startOffset: "D+0",
  endOffset: "D+2",
  phaseDurationHours: 48,
  start: START,
  end: { units: [{ ...START.units[0], lat: 54.3, lng: 20.4 }], arrows: [], objectives: [] },
});

describe("phasePlanFromMapState", () => {
  it("turns placements, orders, control measures and the end state into a plan", () => {
    expect(plan.units.map((u) => [u.id, u.force, u.category])).toEqual([
      ["u-bn", "blue", "Infantry"],
      ["u-red", "red", "Infantry"],
      ["u-ship", "blue", "Naval"],
    ]);
    expect(plan.orders.map((o) => o.id)).toEqual(["o-1", "o-2"]);
    expect(plan.orders[0].route).toHaveLength(3);
    expect(plan.orders[0].routeDurationSec).toBe(7200);
    expect(plan.controlMeasures.map((c) => c.id)).toEqual(["cm-1"]);
    expect(plan.predictedEndState).toEqual([
      { id: "u-bn", label: "1 Mech Bn", lat: 54.3, lng: 20.4, force: "blue" },
    ]);
  });

  it("derives movement categories from the archetype, the template map or the SIDC", () => {
    expect(categoryFor({ templateId: "armour__Battalion", sidc: "" })).toBe("Armour");
    expect(categoryFor({ templateId: "cyber-ew", sidc: "" })).toBe("Signal");
    expect(categoryFor({ templateId: "", sidc: "SFAPMF--------" })).toBe("Aviation");
  });

  it("stamps entity matches onto units, orders and the predicted end", () => {
    const stamped = withEntityIds(plan, new Map([["u-bn", "H-7"]]));
    expect(stamped.units[0].entityId).toBe("H-7");
    expect(stamped.orders[0].entityId).toBe("H-7");
    expect(stamped.orders[1].entityId).toBeUndefined();
    expect(stamped.predictedEndState[0].entityId).toBe("H-7");
  });

  it("feeds the compliance engine directly", () => {
    const stamped = withEntityIds(plan, new Map([["u-bn", "H-7"]]));
    const track = new Map([
      [
        "H-7",
        [
          { tSec: 0, lat: 54.1, lon: 20.2 },
          { tSec: 1800, lat: 54.3, lon: 20.4 },
          { tSec: 3600, lat: 54.3, lon: 20.4 },
        ],
      ],
    ]);
    const result = assessPlanCompliance(stamped, track, 3600);
    const byId = new Map(result.orders.map((o) => [o.orderId, o.status]));
    expect(byId.get("o-2")).toBe("NOT_OBSERVED");
    expect(byId.get("o-1")).not.toBe("NOT_OBSERVED");
  });

  it("parses a stored map state, rejecting anything else", () => {
    expect(parseMapState(JSON.stringify(START))?.units).toHaveLength(3);
    expect(parseMapState('{"units": []}')).toBeNull();
    expect(parseMapState("nope")).toBeNull();
    expect(parseMapState(null)).toBeNull();
  });
});
