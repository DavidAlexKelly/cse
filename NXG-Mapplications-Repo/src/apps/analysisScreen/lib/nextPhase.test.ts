import { describe, expect, it } from "vitest";
import type { MapPhaseState } from "../../scenarioPlanner/phaseCreator/types";
import { actualStartState, nextPhaseName } from "./nextPhase";

const SOURCE: MapPhaseState = {
  units: [
    {
      id: "bn",
      label: "1 Mech Bn",
      sidc: "SFGPUCIZ---F---",
      lat: 54.1,
      lng: 20.2,
      orbatRootUnitKey: "p1--bn",
      orbatHierarchyKey: "hier-s--p1",
    },
    { id: "bty", label: "AD Bty", sidc: "SFGPUCDM---E---", lat: 54.0, lng: 20.4 },
    { id: "res", label: "3 Armd Bn", sidc: "SFGPUCA----F---", lat: 54.1, lng: 21.8 },
  ],
  arrows: [
    { id: "a1", fromLat: 0, fromLng: 0, toLat: 1, toLng: 1, colour: "#fff", assignedUnitId: "bn" },
  ],
  objectives: [{ id: "obj", name: "OBJ GOLD", lat: 54.3, lng: 20.4, colour: "#fc0" }],
};

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

describe("actualStartState", () => {
  const result = actualStartState(
    SOURCE,
    { predictedEndState: [{ id: "bty", label: "AD Bty", lat: 54.05, lng: 20.45, force: "blue" }] },
    new Map([["bn", "H-1"]]),
    new Map([
      [
        "H-1",
        [
          { tSec: 0, lat: 54.1, lon: 20.2 },
          { tSec: 3600, lat: 54.31, lon: 20.41 },
        ],
      ],
    ]),
    counter(),
  );

  it("puts observed units where they ended the run", () => {
    expect(result.state.units[0]).toMatchObject({ label: "1 Mech Bn", lat: 54.31, lng: 20.41 });
    expect(result.observed).toBe(1);
  });

  it("falls back to the prediction, then the start, and reports both", () => {
    expect(result.state.units[1]).toMatchObject({ lat: 54.05, lng: 20.45 });
    expect(result.state.units[2]).toMatchObject({ lat: 54.1, lng: 21.8 });
    expect(result.notObserved).toEqual([
      { label: "AD Bty", from: "predicted" },
      { label: "3 Armd Bn", from: "start" },
    ]);
  });

  it("keeps the ORBAT link, gives fresh ids, clears orders, keeps objectives", () => {
    expect(result.state.units[0]).toMatchObject({ id: "new-1", orbatRootUnitKey: "p1--bn" });
    expect(result.state.arrows).toEqual([]);
    expect(result.state.objectives).toEqual([
      { id: "new-4", name: "OBJ GOLD", lat: 54.3, lng: 20.4, colour: "#fc0" },
    ]);
  });
});

describe("nextPhaseName", () => {
  it("counts phases on", () => {
    expect(nextPhaseName("Phase 1 — Secure the Reinforcement Corridor")).toBe("Phase 2");
    expect(nextPhaseName("Reception")).toBe("Reception (next)");
  });
});

describe("next phase from the mock Baltic Shield run", async () => {
  const { BALTIC_SHIELD_PLAN } = await import("@/shared/hla/balticShieldPlan");
  const { sampleMockTrack } = await import("./sampleMockTrack");

  it("places every unit the federation published from observation, and reports the rest", () => {
    const source: MapPhaseState = {
      units: BALTIC_SHIELD_PLAN.units.map((u) => ({
        id: u.id,
        label: u.label,
        sidc: u.sidc,
        lat: u.lat,
        lng: u.lng,
      })),
      arrows: [],
      objectives: [],
    };
    const entityFor = new Map(
      BALTIC_SHIELD_PLAN.units.flatMap((u) => (u.entityId ? [[u.id, u.entityId] as const] : [])),
    );
    const result = actualStartState(source, BALTIC_SHIELD_PLAN, entityFor, sampleMockTrack());
    expect(result.observed).toBe(entityFor.size);
    expect(result.notObserved).toHaveLength(BALTIC_SHIELD_PLAN.units.length - entityFor.size);
    // The advance moved somebody: the next phase does not simply restart the last.
    const moved = result.state.units.filter(
      (u, i) => u.lat !== source.units[i].lat || u.lng !== source.units[i].lng,
    );
    expect(moved.length).toBeGreaterThan(0);
  });
});
