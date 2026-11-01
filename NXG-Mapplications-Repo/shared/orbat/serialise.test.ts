import { describe, expect, it } from "vitest";
import type { CompositionNode } from "../../types";
import type { PlacedUnit } from "../../apps/scenarioPlanner/map/types";
import { buildOrbatSkeleton } from "./skeleton";
import {
  countPlacementsWithoutOrbat,
  serialiseComposition,
} from "./serialise";

function node(
  unitIdentifier: string,
  overrides: Partial<CompositionNode> = {},
): CompositionNode {
  return {
    id: unitIdentifier,
    unitIdentifier,
    echelon: "Battalion",
    sidc: "SFGPUCIZ---F---",
    entityType: "organisation",
    militaryService: "Army",
    affiliation: "Friend",
    allegiance: "FRIENDLY",
    owningSimulator: "SCENARIO_PLANNER",
    canonicalAssetKey: null,
    simulatorIdentifierCode: null,
    unitTypeKey: null,
    equipmentTypeKey: null,
    quantity: 1,
    children: [],
    ...overrides,
  };
}

/** Deterministic keys, so the assertions can name them. */
function counter(prefix = "U") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function placement(id: string, overrides: Partial<PlacedUnit> = {}): PlacedUnit {
  return {
    id,
    templateId: "mech-infantry",
    label: id,
    sidc: "SFGPUCIZ---F---",
    lat: 54.1,
    lng: 20.5,
    ...overrides,
  } as PlacedUnit;
}

describe("serialiseComposition", () => {
  it("flattens a tree into units and parent → child edges", () => {
    const tree = node("1 Mech Bn", {
      children: [node("A Coy", { echelon: "Company" }), node("B Coy", { echelon: "Company" })],
    });
    const result = serialiseComposition(tree, {
      lat: 54.14,
      lng: 20.28,
      validFrom: "2026-09-15",
      newKey: counter(),
    });

    expect(result.rootUnitKey).toBe("U-1");
    expect(result.units.map((u) => u.unitIdentifier)).toEqual([
      "1 Mech Bn",
      "A Coy",
      "B Coy",
    ]);
    expect(result.edges).toEqual([
      {
        parentUnitKey: "U-1",
        childUnitKey: "U-2",
        relationshipTypeKey: "RELTYPE-ORGANIC",
        validFrom: "2026-09-15",
      },
      {
        parentUnitKey: "U-1",
        childUnitKey: "U-3",
        relationshipTypeKey: "RELTYPE-ORGANIC",
        validFrom: "2026-09-15",
      },
    ]);
  });

  it("puts the placement's position on the root only", () => {
    const tree = node("1 Mech Bn", { children: [node("A Coy")] });
    const { units } = serialiseComposition(tree, {
      lat: 54.14,
      lng: 20.28,
      newKey: counter(),
    });
    expect(units[0]).toMatchObject({ latitude: 54.14, longitude: 20.28 });
    expect(units[1]).toMatchObject({ latitude: null, longitude: null });
  });

  it("expands quantity into numbered units, as the per-object writer did", () => {
    const tree = node("Rifle Section", { quantity: 3 });
    const { units } = serialiseComposition(tree, { lat: 0, lng: 0, newKey: counter() });
    expect(units.map((u) => u.unitIdentifier)).toEqual([
      "Rifle Section 1",
      "Rifle Section 2",
      "Rifle Section 3",
    ]);
  });

  it("carries the node's simulator, model and asset through to the reconcile", () => {
    // These three used to be hardcoded to "none" / omitted, which threw away
    // every SWORD formation the generator had just matched. A generated ORBAT
    // arrived structural no matter how good the match was.
    const { units } = serialiseComposition(
      node("A Coy", {
        owningSimulator: "sword",
        simulatorIdentifierCode: "ARMOR.Heavy tank company|automat",
        canonicalAssetKey: "12.1.225.3.2.0.1",
      }),
      { lat: 0, lng: 0, newKey: counter() },
    );
    expect(units[0]).toMatchObject({
      owningSimulator: "sword",
      simulatorIdentifierCode: "ARMOR.Heavy tank company|automat",
      dis6Code: "12.1.225.3.2.0.1",
    });
  });

  it("still says 'none' for a node with no simulator, which the ontology requires", () => {
    const { units } = serialiseComposition(node("1 Mech Bn", { owningSimulator: "" }), {
      lat: 0,
      lng: 0,
      newKey: counter(),
    });
    expect(units[0].owningSimulator).toBe("none");
  });

  it("produces one payload for a whole BALTIC SHIELD-sized ORBAT", () => {
    // A battalion two levels deep — what a placement generates by default.
    const tree = buildOrbatSkeleton(placement("1 Mech Bn (West)"), { depth: 2 });
    const { units, edges } = serialiseComposition(tree, {
      lat: 54.14,
      lng: 20.28,
      newKey: counter(),
    });
    expect(units.length).toBeGreaterThan(5);
    // Every unit except the root has exactly one parent edge.
    expect(edges).toHaveLength(units.length - 1);
    const children = new Set(edges.map((e) => e.childUnitKey));
    expect(children.size).toBe(edges.length);
  });
});

describe("countPlacementsWithoutOrbat", () => {
  it("counts land units with no ORBAT, once each across phases", () => {
    const placements = [
      placement("bs-bg-west"),
      placement("bs-bg-west"), // same unit, next phase
      placement("bs-armour", { templateId: "armour" }),
      placement("bs-linked", { orbatRootUnitKey: "U-EXISTING" }),
      placement("bs-dd", { templateId: "destroyer", sidc: "SFSPCLDD-------" }),
    ];
    expect(countPlacementsWithoutOrbat(placements)).toBe(2);
  });

  it("is zero when everything land-based already has one", () => {
    expect(
      countPlacementsWithoutOrbat([placement("bs-bg-west", { orbatRootUnitKey: "U-1" })]),
    ).toBe(0);
  });
});
