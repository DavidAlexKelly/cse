import { describe, expect, it } from "vitest";
import {
  isNativeToPhase,
  parsePhaseHierarchyKey,
  newPhaseUnitKey,
  partitionPhasePlacements,
  phaseHierarchyKey,
  phaseHierarchyName,
  phaseOfUnitKey,
} from "./phaseKeys";

describe("phase key formats", () => {
  it("names the phase hierarchy after scenario and phase", () => {
    expect(phaseHierarchyKey("scenario_operation_baltic_shield", "obs_phase_01")).toBe(
      "hier-scenario_operation_baltic_shield--obs_phase_01",
    );
    expect(phaseHierarchyName("Operation BALTIC SHIELD", "Phase 1 — Reception")).toBe(
      "Operation BALTIC SHIELD — Phase 1 — Reception ORBAT",
    );
  });

  it("prefixes unit keys with the phase", () => {
    expect(newPhaseUnitKey("obs_phase_01", () => "abc")).toBe("obs_phase_01--abc");
  });

  it("tells native keys from inherited and legacy ones", () => {
    expect(isNativeToPhase("obs_phase_01--abc", "obs_phase_01")).toBe(true);
    expect(isNativeToPhase("obs_phase_02--abc", "obs_phase_01")).toBe(false);
    // A phase id that is a prefix of another must not match it.
    expect(isNativeToPhase("obs_phase_011--abc", "obs_phase_01")).toBe(false);
    expect(isNativeToPhase("4f0c-legacy-uuid", "obs_phase_01")).toBe(false);
    expect(isNativeToPhase(undefined, "obs_phase_01")).toBe(false);
  });

  it("recovers the phase from a key", () => {
    expect(phaseOfUnitKey("obs_phase_02--abc")).toBe("obs_phase_02");
    expect(phaseOfUnitKey("4f0c1a2b-uuid")).toBeNull();
  });
});

describe("partitionPhasePlacements", () => {
  const land = { templateId: "mech-infantry", sidc: "SFGPUCIZ---F---" };
  it("sorts placements into native, foreign and missing; ignores non-land", () => {
    const placements = [
      { ...land, id: "a", orbatRootUnitKey: "p1--x" },
      { ...land, id: "b", orbatRootUnitKey: "p0--y" },
      { ...land, id: "c", orbatRootUnitKey: "legacy-uuid" },
      { ...land, id: "d" },
      { id: "e", templateId: "destroyer", sidc: "SFSPCLDD-------" },
    ];
    const out = partitionPhasePlacements(placements, "p1");
    expect(out.native.map((p) => p.id)).toEqual(["a"]);
    expect(out.foreign.map((p) => p.id)).toEqual(["b", "c"]);
    expect(out.missing.map((p) => p.id)).toEqual(["d"]);
  });
});

describe("parsePhaseHierarchyKey", () => {
  it("inverts phaseHierarchyKey", () => {
    expect(parsePhaseHierarchyKey(phaseHierarchyKey("scenario_x", "obs_phase_01"))).toEqual({
      scenarioId: "scenario_x",
      phaseId: "obs_phase_01",
    });
  });
  it("rejects keys that are not phase hierarchies", () => {
    expect(parsePhaseHierarchyKey("hier-scenario_x")).toBeNull();
    expect(parsePhaseHierarchyKey("OP-NEXGEN-2026-FRIENDLY")).toBeNull();
    expect(parsePhaseHierarchyKey(null)).toBeNull();
  });
});
