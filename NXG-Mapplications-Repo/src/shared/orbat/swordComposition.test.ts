import { describe, it, expect } from "vitest";

import { representationOf } from "./representation";
import { buildOrbatSkeleton } from "./skeleton";
import {
  automatComposition,
  constituentEchelon,
  constituentQuantity,
  describeEquipment,
  expandAutomat,
  expandAutomatsInTree,
} from "./swordComposition";
import { buildSwordFormationIndex, parseConstituents, type OSwordFormationRow } from "./swordFormations";
import type { CompositionNode } from "../types/index";
import type { PlacedUnit } from "../../apps/scenarioPlanner/map/types";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CASE TABLE — keep comparable with the Python mirror:
//   [NXG] Translator → python-functions/python/tests/test_sword_composition.py
// Same cases, same order, same names.
//
// Rows are real: identifiers, constituents, command posts, equipment types and
// counts are all as the SWORD catalogue holds them. The "#min#max" annotations
// are what the transform now writes.
// ─────────────────────────────────────────────────────────────────────────────

const ROWS: OSwordFormationRow[] = [
  {
    identifier: "ART.Guns firing battery|automat",
    displayName: "Guns firing battery",
    disCode: "12.1.225.4.2.1",
    echelonLevel: "ooo",
    constituentUnits: "ART.Battery CP#1#1|ART.Guns firing platoon#3#3",
    commandPostUnit: "ART.Battery CP",
  },
  {
    identifier: "ART.Battery CP|unit",
    displayName: "Battery CP",
    disCode: "1.1.225.5.20.0.0",
    echelonLevel: "ooo",
    majorEquipmentType: "CP.Armored vehicle",
    majorEquipmentCount: "1",
    requiredCrew: "3",
  },
  {
    identifier: "ART.Guns firing platoon|unit",
    displayName: "Guns firing platoon",
    disCode: "1.1.225.4.2.1.0",
    echelonLevel: "ooo",
    majorEquipmentType: "ART.Gun 155mm",
    majorEquipmentCount: "4",
    requiredCrew: "5",
  },
  {
    identifier: "ARMOR.Heavy tank company|automat",
    displayName: "Heavy tank company",
    disCode: "12.1.225.3.2.0.1",
    echelonLevel: "ooo",
    constituentUnits: "ARMOR.Armored company CP#1#1|ARMOR.Heavy tank platoon#3#3",
    commandPostUnit: "ARMOR.Armored company CP",
  },
  {
    identifier: "ARMOR.Armored company CP|unit",
    displayName: "Armored company CP",
    disCode: "1.1.225.5.20.0.0",
    echelonLevel: "ooo",
    majorEquipmentType: "CP.Armored vehicle",
    majorEquipmentCount: "2",
    requiredCrew: "4",
  },
  {
    identifier: "ARMOR.Heavy tank platoon|unit",
    displayName: "Heavy tank platoon",
    disCode: "1.1.225.3.4.0.1",
    echelonLevel: "ooo",
    majorEquipmentType: "ARMOR.Main Battle Tank",
    majorEquipmentCount: "4",
    requiredCrew: "3",
  },
  // A constituent that is not in the catalogue, so `unresolved` has something
  // to report. Not the case in the data today — all 81 automats resolve.
  {
    identifier: "AAA.Surface to air battery|automat",
    displayName: "Surface to air battery",
    disCode: "12.1.225.7.1.0",
    echelonLevel: "ooo",
    constituentUnits: "AAA.Surface to air battery CP#1#1|AAA.Ghost platoon#2#2",
    commandPostUnit: "AAA.Surface to air battery CP",
  },
  {
    identifier: "AAA.Surface to air battery CP|unit",
    displayName: "Surface to air battery CP",
    disCode: "1.1.225.5.21.0.0",
    echelonLevel: "ooo",
    majorEquipmentType: "CP.Armored vehicle",
    majorEquipmentCount: "2",
    requiredCrew: "2",
  },
  // A single-platform unit: no equipment block at all, as 21 of the 163 rows
  // have none (a fighter jet is the platform, not a grouping of them).
  {
    identifier: "AIR.Fighter jet|unit",
    displayName: "Fighter jet",
    disCode: "",
    echelonLevel: "",
  },
  // Real, and awkward: INF.Mechanised platoon has a catalogue row but NO DIS
  // code, so it links to no canonical asset. 21 of the 163 unit rows are like
  // this. SWORD still owns it.
  {
    identifier: "INF.Mechanised company|automat",
    displayName: "Mechanised company",
    disCode: "12.1.225.3.11.2",
    echelonLevel: "ooo",
    constituentUnits: "INF.Company CP#1#1|INF.Mechanised platoon#3#3",
    commandPostUnit: "INF.Company CP",
  },
  {
    identifier: "INF.Company CP|unit",
    displayName: "Infantry company CP",
    disCode: "1.1.225.3.11.2.11",
    echelonLevel: "ooo",
    majorEquipmentType: "CP.Armored vehicle",
    majorEquipmentCount: "1",
    requiredCrew: "3",
  },
  {
    identifier: "INF.Mechanised platoon|unit",
    displayName: "Infantry platoon",
    disCode: "",
    echelonLevel: "oo",
    majorEquipmentType: "INF.Rifleman",
    majorEquipmentCount: "21",
    requiredCrew: "1",
  },
];

const INDEX = buildSwordFormationIndex(ROWS);

// Deterministic keys so the trees can be compared exactly.
function keyGen(): () => string {
  let n = 0;
  return () => `k${++n}`;
}

describe("parseConstituents", () => {
  it("reads name, min and max", () => {
    expect(parseConstituents("ART.Battery CP#1#1|ART.Guns firing platoon#3#3")).toEqual([
      { name: "ART.Battery CP", min: 1, max: 1 },
      { name: "ART.Guns firing platoon", min: 3, max: 3 },
    ]);
  });

  it("accepts bare names, so a catalogue built before the counts still parses", () => {
    expect(parseConstituents("ART.Battery CP|ART.Guns firing platoon")).toEqual([
      { name: "ART.Battery CP", min: 1, max: 1 },
      { name: "ART.Guns firing platoon", min: 1, max: 1 },
    ]);
  });

  it("treats a missing max-occurs as exactly min, not as unbounded", () => {
    // Automats.xml leaves max-occurs off for 43 of the 81 automats. Reading
    // that as "no limit" and generating without one is not a useful answer.
    expect(parseConstituents("ART.Guns firing platoon#3#")).toEqual([
      { name: "ART.Guns firing platoon", min: 3, max: 3 },
    ]);
  });

  it("is empty for an empty field, and skips empty entries", () => {
    expect(parseConstituents("")).toEqual([]);
    expect(parseConstituents(undefined)).toEqual([]);
    expect(parseConstituents("A#1#1||B#1#1").map((c) => c.name)).toEqual(["A", "B"]);
  });
});

describe("constituentQuantity", () => {
  it("generates the establishment, not the maximum", () => {
    // "1..4 anti-tank sections" means one, reinforceable to four. Generating
    // four hands a planner half again the force they asked for.
    expect(constituentQuantity({ name: "x", min: 1, max: 4 })).toBe(1);
    expect(constituentQuantity({ name: "x", min: 3, max: 3 })).toBe(3);
  });

  it("never generates none", () => {
    expect(constituentQuantity({ name: "x", min: 0, max: 0 })).toBe(1);
  });
});

describe("automatComposition", () => {
  it("takes a battery apart the way the catalogue describes it", () => {
    const composition = automatComposition(INDEX, "ART.Guns firing battery|automat");
    expect(composition).not.toBeNull();
    expect(composition!.constituents.map((c) => [c.name, c.quantity, c.isCommandPost])).toEqual([
      ["ART.Battery CP", 1, true],
      ["ART.Guns firing platoon", 3, false],
    ]);
    expect(composition!.unresolved).toEqual([]);
  });

  it("carries the equipment off the unit row", () => {
    const composition = automatComposition(INDEX, "ART.Guns firing battery|automat")!;
    const guns = composition.constituents[1];
    expect(guns.equipment).toEqual({ type: "ART.Gun 155mm", count: 4, crewPerItem: 5 });
    expect(describeEquipment(guns.equipment)).toBe("4 × ART.Gun 155mm, crew 5");
  });

  it("reports a constituent the catalogue does not have, and keeps the rest", () => {
    const composition = automatComposition(INDEX, "AAA.Surface to air battery|automat")!;
    expect(composition.unresolved).toEqual(["AAA.Ghost platoon"]);
    expect(composition.constituents).toHaveLength(2);
    expect(composition.constituents[1].formation).toBeNull();
  });

  it("is null for a unit row, an unknown identifier, or an automat with no composition", () => {
    expect(automatComposition(INDEX, "ARMOR.Heavy tank platoon|unit")).toBeNull();
    expect(automatComposition(INDEX, "NOPE.Nothing|automat")).toBeNull();
    expect(automatComposition(INDEX, "")).toBeNull();
  });
});

describe("constituentEchelon", () => {
  it("reads the echelon off the constituent's name", () => {
    expect(
      constituentEchelon({ name: "ARMOR.Heavy tank platoon", isCommandPost: false }, "Company"),
    ).toBe("Platoon");
  });

  it("does not let a company's own CP become a second company", () => {
    // "ARMOR.Armored company CP" contains the word "company". Reading the
    // echelon off the name would put a company inside a company.
    expect(
      constituentEchelon({ name: "ARMOR.Armored company CP", isCommandPost: true }, "Company"),
    ).toBe("Platoon");
  });

  it("gives a CP its siblings' echelon when the parent is off the ladder", () => {
    // Battery is NOT in ECHELON_LADDER, so childEchelon() is undefined and the
    // fallback would be the parent's own echelon — a battery CP labelled
    // Battery, level with the battery it belongs to. Real: ART.Guns firing
    // battery holds ART.Battery CP and ART.Guns firing platoon.
    expect(
      constituentEchelon({ name: "ART.Battery CP", isCommandPost: true }, "Battery", "Platoon"),
    ).toBe("Platoon");
    expect(
      constituentEchelon({ name: "ART.Battery CP", isCommandPost: true }, "Battery"),
    ).toBe("Battery");
  });

  it("falls back to the ladder when a name has no echelon word", () => {
    expect(
      constituentEchelon({ name: "LOG.SUP.Cargo", isCommandPost: false }, "Company"),
    ).toBe("Platoon");
  });

  it("refuses an echelon that would outrank the parent", () => {
    expect(
      constituentEchelon({ name: "INF.Rifle battalion", isCommandPost: false }, "Company"),
    ).toBe("Platoon");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Expansion
// ─────────────────────────────────────────────────────────────────────────────

function automatNode(overrides: Partial<CompositionNode> = {}): CompositionNode {
  return {
    id: "battery",
    unitIdentifier: "A Bty, 1 RHA",
    // Battery, not Company — the real echelon, and deliberately one that is
    // NOT on ECHELON_LADDER, so these tests cover the off-ladder path.
    echelon: "Battery",
    sidc: "SFGPUCF---E----",
    entityType: "organisation",
    militaryService: "Army",
    affiliation: "Friend",
    allegiance: "GBR",
    owningSimulator: "sword",
    canonicalAssetKey: "12.1.225.4.2.1",
    simulatorIdentifierCode: "ART.Guns firing battery|automat",
    unitTypeKey: null,
    equipmentTypeKey: null,
    quantity: 1,
    children: [],
    ...overrides,
  };
}

describe("expandAutomat", () => {
  it("gives the battery its real composition", () => {
    const expanded = expandAutomat(automatNode(), INDEX, { newKey: keyGen() })!;
    expect(expanded.children.map((c) => [c.unitIdentifier, c.quantity, c.echelon])).toEqual([
      ["Battery CP, A Bty", 1, "Platoon"],
      ["Guns firing platoon, A Bty", 3, "Platoon"],
    ]);
  });

  it("demotes the automat to structure — it cannot be the aggregate AND contain it", () => {
    const before = automatNode();
    expect(representationOf(before)).toBe("automat");

    const after = expandAutomat(before, INDEX, { newKey: keyGen() })!;
    expect(representationOf(after)).toBe("aggregate");
    expect(after.simulatorIdentifierCode).toBeNull();
    expect(after.canonicalAssetKey).toBeNull();
    expect(after.owningSimulator).toBe("none");
  });

  it("moves the SWORD assets down onto the constituents", () => {
    const expanded = expandAutomat(automatNode(), INDEX, { newKey: keyGen() })!;
    expect(expanded.children.map((c) => c.simulatorIdentifierCode)).toEqual([
      "ART.Battery CP|unit",
      "ART.Guns firing platoon|unit",
    ]);
    expect(expanded.children.map((c) => c.canonicalAssetKey)).toEqual([
      "1.1.225.5.20.0.0",
      "1.1.225.4.2.1.0",
    ]);
    expect(expanded.children.every((c) => representationOf(c) === "subformation")).toBe(true);
  });

  it("does not mutate the node it was given", () => {
    const before = automatNode();
    expandAutomat(before, INDEX, { newKey: keyGen() });
    expect(before.children).toEqual([]);
    expect(before.simulatorIdentifierCode).toBe("ART.Guns firing battery|automat");
  });

  it("leaves a constituent the catalogue does not have as structure, not as a broken link", () => {
    const node = automatNode({
      simulatorIdentifierCode: "AAA.Surface to air battery|automat",
      canonicalAssetKey: "12.1.225.7.1.0",
    });
    const ghost = expandAutomat(node, INDEX, { newKey: keyGen() })!.children[1];
    expect(ghost.simulatorIdentifierCode).toBeNull();
    expect(ghost.canonicalAssetKey).toBeNull();
    expect(ghost.owningSimulator).toBe("none");
  });

  it("keeps children a planner already added, after the constituents", () => {
    const existing: CompositionNode = { ...automatNode(), id: "existing", unitIdentifier: "Attached FST" };
    const expanded = expandAutomat(
      automatNode({ children: [existing] }),
      INDEX,
      { newKey: keyGen() },
    )!;
    expect(expanded.children.map((c) => c.unitIdentifier)).toEqual([
      "Battery CP, A Bty",
      "Guns firing platoon, A Bty",
      "Attached FST",
    ]);
  });

  it("keeps a battery's CP at its siblings' echelon, not the battery's own", () => {
    // Battery is off the ladder, so without the sibling rule the CP would come
    // back as Battery — level with the battery it belongs to.
    const expanded = expandAutomat(automatNode(), INDEX, { newKey: keyGen() })!;
    expect(expanded.children.map((c) => c.echelon)).toEqual(["Platoon", "Platoon"]);
  });

  it("still says SWORD owns a sub-formation that has no canonical asset", () => {
    // INF.Mechanised platoon has a catalogue row but no DIS code. Withholding
    // "sword" would leave a node carrying a SWORD model while claiming no
    // simulator owns it.
    const company = automatNode({
      unitIdentifier: "D Company",
      echelon: "Company",
      simulatorIdentifierCode: "INF.Mechanised company|automat",
      canonicalAssetKey: "12.1.225.3.11.2",
    });
    const platoon = expandAutomat(company, INDEX, { newKey: keyGen() })!.children[1];
    expect(platoon.simulatorIdentifierCode).toBe("INF.Mechanised platoon|unit");
    expect(platoon.owningSimulator).toBe("sword");
    expect(platoon.canonicalAssetKey).toBeNull();
    expect(platoon.quantity).toBe(3);
  });

  it("returns null when the node is not an automat", () => {
    expect(expandAutomat(automatNode({ simulatorIdentifierCode: null }), INDEX)).toBeNull();
    expect(expandAutomat(automatNode({ entityType: "vehicle" }), INDEX)).toBeNull();
  });

  it("returns null when the catalogue cannot describe the automat", () => {
    expect(
      expandAutomat(automatNode({ simulatorIdentifierCode: "NOPE.Nothing|automat" }), INDEX),
    ).toBeNull();
  });
});

describe("expandAutomatsInTree", () => {
  it("expands an automat wherever it sits", () => {
    const brigade: CompositionNode = {
      ...automatNode({ id: "bde", unitIdentifier: "1 Bde", echelon: "Brigade" }),
      owningSimulator: "none",
      canonicalAssetKey: null,
      simulatorIdentifierCode: null,
      children: [automatNode()],
    };
    const expanded = expandAutomatsInTree(brigade, INDEX, { newKey: keyGen() });
    expect(expanded.children[0].children.map((c) => c.unitIdentifier)).toEqual([
      "Battery CP, A Bty",
      "Guns firing platoon, A Bty",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The generator
// ─────────────────────────────────────────────────────────────────────────────

const PLACED_BATTALION: PlacedUnit = {
  id: "p1",
  label: "1 RTR",
  templateId: "armoured-battalion",
  sidc: "SFGPUCA---F----",
  lat: 54.1,
  lng: 21.2,
} as PlacedUnit;

describe("buildOrbatSkeleton with a SWORD composition expander", () => {
  const expander = (node: CompositionNode) => expandAutomat(node, INDEX);

  it("stops at the automat when there is no depth left for its composition", () => {
    const tree = buildOrbatSkeleton(PLACED_BATTALION, {
      depth: 1,
      nature: "ARMOR",
      swordFormations: INDEX,
      expandAutomat: expander,
    });
    const company = tree.children[0];
    expect(representationOf(company)).toBe("automat");
    expect(company.children).toEqual([]);
  });

  it("replaces the automat with its real composition when there is", () => {
    const tree = buildOrbatSkeleton(PLACED_BATTALION, {
      depth: 2,
      nature: "ARMOR",
      swordFormations: INDEX,
      expandAutomat: expander,
    });
    const company = tree.children[0];
    expect(representationOf(company)).toBe("aggregate");
    expect(company.children.map((c) => [c.unitIdentifier.split(",")[0], c.quantity])).toEqual([
      ["Armored company CP", 1],
      ["Heavy tank platoon", 3],
    ]);
  });

  it("never produces a double-counted tree, at either depth", async () => {
    const { findDoubleCountedDescendants } = await import("./representation");
    for (const depth of [0, 1, 2, 3]) {
      const tree = buildOrbatSkeleton(PLACED_BATTALION, {
        depth,
        nature: "ARMOR",
        swordFormations: INDEX,
        expandAutomat: expander,
      });
      expect(findDoubleCountedDescendants(tree)).toEqual([]);
    }
  });

  it("keeps the automat as a leaf when no expander is supplied", () => {
    const tree = buildOrbatSkeleton(PLACED_BATTALION, {
      depth: 3,
      nature: "ARMOR",
      swordFormations: INDEX,
    });
    const company = tree.children[0];
    expect(representationOf(company)).toBe("automat");
    expect(company.children).toEqual([]);
  });
});
