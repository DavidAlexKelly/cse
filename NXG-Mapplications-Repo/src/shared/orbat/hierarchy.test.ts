import { describe, expect, it } from "vitest";
import type { PlacedUnit } from "../../apps/scenarioPlanner/map/types";
import {
  buildReconcilePayload,
  desiredParentage,
  echelonRank,
  membersForScenario,
  sideRoot,
  type OrbatMember,
} from "./hierarchy";

/**
 * Fixtures are the real BALTIC SHIELD phase-1 placements (obs_phase_01), with
 * an ORBAT root key added per unit as the planner would have written one. The
 * three naval units and the satellite are included so the tests prove they are
 * dropped rather than parented.
 */
function placement(
  id: string,
  templateId: string,
  label: string,
  sidc: string,
  orbatRootUnitKey?: string,
): PlacedUnit {
  return {
    id,
    templateId,
    label,
    sidc,
    lat: 54.1,
    lng: 20.5,
    ...(orbatRootUnitKey ? { orbatRootUnitKey } : {}),
  } as PlacedUnit;
}

const BALTIC_SHIELD_PHASE_1: PlacedUnit[] = [
  placement("bs-arg", "amphibious", "Amphibious Ready Group", "SFSPCLAM---H---", "U-ARG"),
  placement("bs-dd-north", "destroyer", "DD Escort (North)", "SFSPCLDD-------", "U-DDN"),
  placement("bs-dd-port", "destroyer", "DD Escort (Port Approaches)", "SFSPCLDD-------", "U-DDP"),
  placement("bs-port-isr", "recce-ground-sensor", "CA / Port ISR", "SFGPUUR----E---", "U-PORT-ISR"),
  placement("bs-port-css", "logistics", "Port of Entry - Reception", "SFGPUSS----F---", "U-PORT-CSS"),
  placement("bs-bg-west", "mech-infantry", "1 Mech Bn (West)", "SFGPUCIZ---F---", "U-BG-WEST"),
  placement("bs-css-hub", "logistics", "CSS Logistics Hub", "SFGPUSS----F---", "U-CSS-HUB"),
  placement("bs-bg-centre", "mech-infantry", "2 Mech Bn (Centre)", "SFGPUCIZ---F---", "U-BG-CENTRE"),
  placement("bs-armour", "armour", "3 Armd Bn (Reserve)", "SFGPUCA----F---", "U-ARMOUR"),
  placement("bs-css-fsa", "logistics", "CSS Forward Staging Area", "SFGPUSS----F---", "U-CSS-FSA"),
  placement("bs-gbad", "air-defence-sam", "AD Bty (Corridor Cover)", "SFGPUCDM---E---", "U-GBAD"),
  placement("bs-sat-isr", "satellite-isr", "Adversary ISR Satellite", "SHPPSS---------", "U-SAT"),
  placement("bs-bastion", "coastal-defence-missile", "BASTION-P Coastal Defence", "SHGPUCFC---E---", "U-BASTION"),
  placement("bs-lr-arty", "rocket-artillery", "Long-Range Artillery", "SHGPUCFR---H---", "U-LR-ARTY"),
  placement("bs-iskander", "srbm", "ISKANDER-M SRBM BDE", "SHGPUCFS---H---", "U-ISKANDER"),
  placement("bs-s400", "air-defence-sam", "S-400 SAM BDE", "SHGPUCDM---H---", "U-S400"),
  placement("bs-ew-bn", "cyber|-ew", "EW BATTALION", "SHGPUSC----F---", "U-EW-BN"),
  placement("bs-22ac", "motor-rifle", "22nd AC MRBDE", "SHGPUCIM---H---", "U-22AC"),
  placement("bs-1gmrd", "motor-rifle", "1st GMRD MRBDE", "SHGPUCIM---H---", "U-1GMRD"),
];

function member(
  unitKey: string,
  echelon: OrbatMember["echelon"],
  side: OrbatMember["side"],
  opts: { label?: string; isHeadquarters?: boolean } = {},
): OrbatMember {
  return {
    unitKey,
    label: opts.label ?? unitKey,
    echelon,
    side,
    isHeadquarters: opts.isHeadquarters ?? false,
  };
}

describe("echelonRank", () => {
  it("ranks larger formations above smaller ones", () => {
    expect(echelonRank("Division")).toBeGreaterThan(echelonRank("Brigade"));
    expect(echelonRank("Brigade")).toBeGreaterThan(echelonRank("Battalion"));
    expect(echelonRank("Battalion")).toBeGreaterThan(echelonRank("Company"));
  });

  it("treats an unknown or missing echelon as unranked", () => {
    expect(echelonRank(undefined)).toBe(0);
    expect(echelonRank("" as OrbatMember["echelon"])).toBe(0);
    // Not on the ladder — naval/air echelons and "Other" are unranked.
    expect(echelonRank("Vessel")).toBe(0);
  });
});

describe("membersForScenario", () => {
  it("keeps land units that have an ORBAT, drops ships, satellites and un-ORBATed units", () => {
    const members = membersForScenario(BALTIC_SHIELD_PHASE_1);
    expect(members).toHaveLength(15);
    expect(members.map((m) => m.unitKey)).not.toContain("U-ARG");
    expect(members.map((m) => m.unitKey)).not.toContain("U-SAT");

    const noOrbat = placement("bs-new", "armour", "4 Armd Bn", "SFGPUCA----F---");
    expect(membersForScenario([noOrbat])).toHaveLength(0);
  });

  it("collapses the same unit appearing in several phases", () => {
    // Fresh placement ids per phase, same ORBAT root — see the note in
    // membersForScenario.
    const phase1 = placement("p1-bg", "mech-infantry", "1 Mech Bn", "SFGPUCIZ---F---", "U-BG");
    const phase2 = placement("p2-bg", "mech-infantry", "1 Mech Bn", "SFGPUCIZ---F---", "U-BG");
    expect(membersForScenario([phase1, phase2])).toHaveLength(1);
  });

  it("reads echelon through a malformed templateId via the SIDC", () => {
    const members = membersForScenario(BALTIC_SHIELD_PHASE_1);
    const ew = members.find((m) => m.unitKey === "U-EW-BN");
    expect(ew?.echelon).toBe("Battalion");
  });
});

describe("sideRoot", () => {
  it("takes the most senior unit on the side", () => {
    const members = [
      member("U-BN", "Battalion", "blue"),
      member("U-DIV", "Division", "blue"),
      member("U-BDE", "Brigade", "blue"),
      member("U-RED-DIV", "Division", "red"),
    ];
    expect(sideRoot(members, "blue")?.unitKey).toBe("U-DIV");
    expect(sideRoot(members, "red")?.unitKey).toBe("U-RED-DIV");
  });

  it("prefers a headquarters when the top echelon ties", () => {
    const members = [
      member("U-BDE-A", "Brigade", "blue"),
      member("U-BDE-HQ", "Brigade", "blue", { isHeadquarters: true }),
    ];
    expect(sideRoot(members, "blue")?.unitKey).toBe("U-BDE-HQ");
  });

  it("falls back to placement order, so the result is deterministic", () => {
    const members = [
      member("U-BDE-SECOND", "Brigade", "blue", { label: "A first alphabetically" }),
      member("U-BDE-FIRST", "Brigade", "blue", { label: "Z last alphabetically" }),
    ];
    expect(sideRoot(members, "blue")?.unitKey).toBe("U-BDE-SECOND");
  });

  it("is undefined for a side with no members", () => {
    expect(sideRoot([member("U-BN", "Battalion", "blue")], "red")).toBeUndefined();
  });
});

describe("desiredParentage — rule B, nearest higher echelon", () => {
  it("attaches a unit to the lowest formation that still outranks it", () => {
    const { parentByChild, roots } = desiredParentage([
      member("U-DIV", "Division", "blue"),
      member("U-BDE", "Brigade", "blue"),
      member("U-BN", "Battalion", "blue"),
    ]);
    expect(roots.blue).toBe("U-DIV");
    // Battalion under the brigade, NOT straight to the division.
    expect(parentByChild).toEqual({ "U-BDE": "U-DIV", "U-BN": "U-BDE" });
  });

  it("sends a unit to the side root when candidates tie", () => {
    const { parentByChild, roots } = desiredParentage([
      member("U-BDE-A", "Brigade", "blue"),
      member("U-BDE-B", "Brigade", "blue"),
      member("U-BN", "Battalion", "blue"),
    ]);
    expect(roots.blue).toBe("U-BDE-A");
    // Two brigades outrank the battalion equally — root, not a coin toss.
    expect(parentByChild["U-BN"]).toBe("U-BDE-A");
    expect(parentByChild["U-BDE-B"]).toBe("U-BDE-A");
  });

  it("re-parents when a more senior unit is placed later", () => {
    const battalions = [
      member("U-BN-1", "Battalion", "blue"),
      member("U-BN-2", "Battalion", "blue"),
      member("U-BN-3", "Battalion", "blue"),
    ];
    const before = desiredParentage(battalions);
    expect(before.roots.blue).toBe("U-BN-1");

    const after = desiredParentage([...battalions, member("U-DIV", "Division", "blue")]);
    expect(after.roots.blue).toBe("U-DIV");
    expect(after.parentByChild).toEqual({
      "U-BN-1": "U-DIV",
      "U-BN-2": "U-DIV",
      "U-BN-3": "U-DIV",
    });
  });

  it("never proposes a parent that outranks nothing, and never a cycle", () => {
    const members = membersForScenario(BALTIC_SHIELD_PHASE_1);
    const { parentByChild } = desiredParentage(members);
    const rankOf = new Map(members.map((m) => [m.unitKey, echelonRank(m.echelon)]));
    for (const [child, parent] of Object.entries(parentByChild)) {
      // A parent strictly outranks its child, which is what makes the graph
      // acyclic by construction. Equal-rank parents only happen via the root.
      expect(rankOf.get(parent)!).toBeGreaterThanOrEqual(rankOf.get(child)!);
      expect(child).not.toBe(parent);
    }
  });

  it("keeps the two sides separate", () => {
    const { parentByChild, roots } = desiredParentage([
      member("U-BLUE-BDE", "Brigade", "blue"),
      member("U-BLUE-BN", "Battalion", "blue"),
      member("U-RED-BDE", "Brigade", "red"),
      member("U-RED-BN", "Battalion", "red"),
    ]);
    expect(roots).toEqual({ blue: "U-BLUE-BDE", red: "U-RED-BDE" });
    expect(parentByChild["U-BLUE-BN"]).toBe("U-BLUE-BDE");
    expect(parentByChild["U-RED-BN"]).toBe("U-RED-BDE");
  });
});

describe("desiredParentage — parent overrides", () => {
  it("uses the planner's choice over the derived one", () => {
    const { parentByChild } = desiredParentage([
      member("U-BDE", "Brigade", "blue"),
      member("U-BN-A", "Battalion", "blue"),
      // Would derive to U-BDE; the planner says otherwise.
      { ...member("U-COY", "Company", "blue"), parentOverrideKey: "U-BN-A" },
    ]);
    expect(parentByChild["U-COY"]).toBe("U-BN-A");
  });

  it("ignores an override whose target has left the scenario", () => {
    const { parentByChild } = desiredParentage([
      member("U-BDE", "Brigade", "blue"),
      { ...member("U-BN", "Battalion", "blue"), parentOverrideKey: "U-DELETED" },
    ]);
    expect(parentByChild["U-BN"]).toBe("U-BDE");
  });

  it("breaks a cycle two overrides would create, rather than failing the call", () => {
    // A under B and B under A. The reconcile function rejects a cyclic request
    // outright, which would block every other correction in the same run.
    const { parentByChild, roots } = desiredParentage([
      member("U-BDE", "Brigade", "blue"),
      { ...member("U-BN-A", "Battalion", "blue"), parentOverrideKey: "U-BN-B" },
      { ...member("U-BN-B", "Battalion", "blue"), parentOverrideKey: "U-BN-A" },
    ]);
    expect(roots.blue).toBe("U-BDE");
    // One of the two keeps its override, the other falls back to the root —
    // whichever, the result is a tree.
    const chain = (start: string) => {
      const seen = new Set<string>([start]);
      let node = start;
      while (parentByChild[node]) {
        node = parentByChild[node];
        expect(seen.has(node)).toBe(false);
        seen.add(node);
      }
      return node;
    };
    expect(chain("U-BN-A")).toBe("U-BDE");
    expect(chain("U-BN-B")).toBe("U-BDE");
  });
});

describe("desiredParentage — BALTIC SHIELD phase 1", () => {
  const members = membersForScenario(BALTIC_SHIELD_PHASE_1);
  const { parentByChild, roots } = desiredParentage(members);

  it("roots the friendly side on the first battalion placed, there being nothing above battalion", () => {
    expect(roots.blue).toBe("U-PORT-CSS");
  });

  it("roots the enemy side on the first brigade placed", () => {
    expect(roots.red).toBe("U-LR-ARTY");
  });

  it("puts every other friendly unit under the friendly root", () => {
    // Six battalions and two companies: the battalions have nothing above them
    // and the companies have six equal candidates, so the whole side is flat.
    // This is rule B degenerating honestly, not a bug.
    for (const key of [
      "U-PORT-ISR",
      "U-BG-WEST",
      "U-CSS-HUB",
      "U-BG-CENTRE",
      "U-ARMOUR",
      "U-CSS-FSA",
      "U-GBAD",
    ]) {
      expect(parentByChild[key]).toBe("U-PORT-CSS");
    }
  });

  it("puts the coastal defence battery under the EW battalion — the one real ladder on the enemy side", () => {
    // BASTION-P is a battery; the EW battalion is the ONLY enemy unit between
    // it and brigade level, so rule B pairs them. Doctrinally odd, and exactly
    // the case a parent override exists for.
    expect(parentByChild["U-BASTION"]).toBe("U-EW-BN");
  });

  it("puts the remaining enemy brigades and the EW battalion under the enemy root", () => {
    for (const key of ["U-ISKANDER", "U-S400", "U-22AC", "U-1GMRD", "U-EW-BN"]) {
      expect(parentByChild[key]).toBe("U-LR-ARTY");
    }
  });

  it("parents 13 of the 15 land units, the other two being the side roots", () => {
    expect(Object.keys(parentByChild)).toHaveLength(13);
  });
});

describe("buildReconcilePayload", () => {
  const members = membersForScenario(BALTIC_SHIELD_PHASE_1);
  const payload = buildReconcilePayload({
    operationKey: "OPERATION-BALTIC-SHIELD",
    hierarchyKey: "hier-scenario_operation_baltic_shield",
    hierarchyName: "Operation BALTIC SHIELD — Scenario ORBAT",
    members,
    validFrom: "2026-09-15",
  });

  it("names the operation and hierarchy the reconciler should converge on", () => {
    expect(payload.operation.primaryKey).toBe("OPERATION-BALTIC-SHIELD");
    expect(payload.unitHierarchy).toEqual({
      primaryKey: "hier-scenario_operation_baltic_shield",
      name: "Operation BALTIC SHIELD — Scenario ORBAT",
      validFrom: "2026-09-15",
    });
  });

  it("sends no units — they already exist and must not be overwritten", () => {
    expect(payload.units).toEqual([]);
  });

  it("uses a real relationship type key on every edge", () => {
    expect(payload.unitHierarchyEdges).toHaveLength(13);
    for (const edge of payload.unitHierarchyEdges) {
      expect(edge.relationshipTypeKey).toBe("RELTYPE-ORGANIC");
      expect(edge.validFrom).toBe("2026-09-15");
    }
  });

  it("manages every land unit, roots included, so a promoted root loses its old parent", () => {
    expect(payload.managedChildUnitKeys).toHaveLength(15);
    expect(payload.managedChildUnitKeys).toContain("U-PORT-CSS");
    expect(payload.managedChildUnitKeys).toContain("U-LR-ARTY");
  });

  it("is byte-identical run to run, so a no-op reconcile is visibly a no-op", () => {
    const again = buildReconcilePayload({
      operationKey: "OPERATION-BALTIC-SHIELD",
      hierarchyKey: "hier-scenario_operation_baltic_shield",
      hierarchyName: "Operation BALTIC SHIELD — Scenario ORBAT",
      members,
      validFrom: "2026-09-15",
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(payload));
  });
});
