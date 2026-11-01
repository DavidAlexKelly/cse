import { describe, expect, it } from "vitest";
import { collectPlaceableNodes, isPlaceableUnit, planComposition } from "./compositionPlan";
import { ORGANIC_RELATIONSHIP_KEY } from "../orbat/model";
import type { CompositionNode } from "../types/index";

/** Deterministic key generator so plans can be asserted exactly. */
function counter(prefix = "k"): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function node(partial: Partial<CompositionNode> & { unitIdentifier: string }): CompositionNode {
  return {
    id: partial.unitIdentifier,
    echelon: "SECTION",
    sidc: "10031000000000000000",
    entityType: "organisation",
    militaryService: "ARMY",
    affiliation: "FRIEND",
    allegiance: "NATO",
    owningSimulator: "vbs4",
    canonicalAssetKey: null,
    simulatorIdentifierCode: null,
    unitTypeKey: null,
    equipmentTypeKey: null,
    quantity: 1,
    children: [],
    ...partial,
  };
}

describe("planComposition", () => {
  it("creates an edge for every parent → child pair", () => {
    // The regression this guards: the forked data layer had createEdgeFn as a
    // no-op and used relationshipTypeKey "COMMAND", which matched no row in
    // NxgUnitHierarchyNodeRelationshipType. Compositions were written as a flat
    // list of orphaned units and reported success.
    const root = node({
      unitIdentifier: "1 PL",
      children: [
        node({ unitIdentifier: "1 SECT", entityType: "vehicle" }),
        node({ unitIdentifier: "2 SECT", entityType: "vehicle" }),
      ],
    });

    const plan = planComposition("HIER-1", root, 54.3, 18.2, counter());

    expect(plan.units).toHaveLength(3);
    expect(plan.edges).toHaveLength(2);
    expect(plan.edges.map((e) => e.childUnitKey)).toEqual(
      plan.units.slice(1).map((u) => u.primaryKey),
    );
    for (const edge of plan.edges) {
      expect(edge.parentUnitKey).toBe(plan.rootUnitKey);
      expect(edge.relationshipTypeKey).toBe(ORGANIC_RELATIONSHIP_KEY);
      expect(edge.hierarchyKey).toBe("HIER-1");
    }
  });

  it("never emits an edge referencing a unit it did not also create", () => {
    const root = node({
      unitIdentifier: "A COY",
      children: [
        node({
          unitIdentifier: "1 PL",
          quantity: 2,
          children: [node({ unitIdentifier: "VEH", entityType: "vehicle", quantity: 3 })],
        }),
      ],
    });

    const plan = planComposition("HIER-2", root, 0, 0, counter());
    const unitKeys = new Set(plan.units.map((u) => u.primaryKey));

    for (const edge of plan.edges) {
      expect(unitKeys.has(edge.parentUnitKey)).toBe(true);
      expect(unitKeys.has(edge.childUnitKey)).toBe(true);
    }
    // Every unit except the root is attached exactly once.
    expect(plan.edges).toHaveLength(plan.units.length - 1);
    expect(new Set(plan.edges.map((e) => e.childUnitKey)).size).toBe(plan.edges.length);
  });

  it("expands quantity into distinct, individually numbered units", () => {
    const root = node({ unitIdentifier: "RIFLEMAN", entityType: "human", quantity: 3 });
    const plan = planComposition("HIER-3", root, 0, 0, counter());

    expect(plan.units.map((u) => u.unitIdentifier)).toEqual([
      "RIFLEMAN 1",
      "RIFLEMAN 2",
      "RIFLEMAN 3",
    ]);
    expect(new Set(plan.units.map((u) => u.primaryKey)).size).toBe(3);
    // Quantity siblings are roots of their own right here — no parent to attach to.
    expect(plan.edges).toHaveLength(0);
  });

  it("gives a symbol to platforms and dismounts but not to crew or structure", () => {
    const root = node({
      unitIdentifier: "TROOP",
      children: [
        node({
          unitIdentifier: "TANK",
          entityType: "vehicle",
          // Crew inside a vehicle move with it, so they get no symbol — and
          // are not recursed into at all.
          children: [node({ unitIdentifier: "GUNNER", entityType: "human" })],
        }),
        node({ unitIdentifier: "SCOUT", entityType: "human" }),
      ],
    });

    const plan = planComposition("HIER-4", root, 54.3, 18.2, counter());

    // organisation root + tank + scout. The gunner is not created: the walk
    // does not descend into a vehicle's children.
    expect(plan.units.map((u) => u.unitIdentifier)).toEqual(["TROOP", "TANK", "SCOUT"]);
    expect(plan.symbols).toHaveLength(2);
    expect(plan.symbols.every((s) => s.latitude === 54.3 && s.longitude === 18.2)).toBe(true);
  });

  it("returns an empty plan shape for a single childless organisation", () => {
    const plan = planComposition("HIER-5", node({ unitIdentifier: "HQ" }), 0, 0, counter());
    expect(plan.units).toHaveLength(1);
    expect(plan.symbols).toHaveLength(0);
    expect(plan.edges).toHaveLength(0);
    expect(plan.rootUnitKey).toBe(plan.units[0].primaryKey);
  });
});

describe("isPlaceableUnit / collectPlaceableNodes", () => {
  it("treats a dismounted human as placeable but vehicle crew as not", () => {
    const human = node({ unitIdentifier: "X", entityType: "human" });
    expect(isPlaceableUnit(human, "organisation")).toBe(true);
    expect(isPlaceableUnit(human, "vehicle")).toBe(false);
    expect(isPlaceableUnit(human, "aircraft")).toBe(false);
  });

  it("stops at the platform when collecting placeable nodes", () => {
    const root = node({
      unitIdentifier: "TROOP",
      children: [
        node({
          unitIdentifier: "TANK",
          entityType: "vehicle",
          children: [node({ unitIdentifier: "GUNNER", entityType: "human" })],
        }),
      ],
    });
    expect(collectPlaceableNodes(root).map((n) => n.unitIdentifier)).toEqual(["TANK"]);
  });
});
