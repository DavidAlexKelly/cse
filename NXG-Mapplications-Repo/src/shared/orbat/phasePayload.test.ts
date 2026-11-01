import { describe, expect, it } from "vitest";
import type { CompositionNode } from "@/shared/types";
import { type ForestNode, indexForest } from "./orbatLevels";
import {
  type PhaseHierarchyRef,
  changeParentPayload,
  cloneSubtreePayloadParts,
  generateBeneathPayload,
  phasePlacementParentage,
  pinSubtrees,
  placeUnitPayload,
  treeViewOf,
} from "./phasePayload";

const REF: PhaseHierarchyRef = {
  operationKey: "OPERATION-BALTIC-SHIELD",
  hierarchyKey: "hier-scenario_operation_baltic_shield--obs_phase_01",
  hierarchyName: "Operation BALTIC SHIELD — Phase 1 ORBAT",
  phaseKey: "obs_phase_01",
};

function counter() {
  let n = 0;
  return () => `u${++n}`;
}

function comp(label: string, echelon: string, children: CompositionNode[] = []): CompositionNode {
  return {
    id: label,
    unitIdentifier: label,
    echelon,
    sidc: "SFGPUCI----F---",
    entityType: "organisation",
    militaryService: "Army",
    affiliation: "Friend",
    allegiance: "FRIENDLY",
    owningSimulator: "none",
    canonicalAssetKey: null,
    simulatorIdentifierCode: null,
    unitTypeKey: null,
    equipmentTypeKey: null,
    quantity: 1,
    children,
  };
}

describe("placeUnitPayload", () => {
  it("writes the unit, its parent edge and adoptions in one payload stamped with the phase", () => {
    const { payload, rootUnitKey, unitCount } = placeUnitPayload(REF, {
      tree: comp("2 Bde", "Brigade", [comp("1 Bn", "Battalion")]),
      lat: 54.7,
      lng: 20.5,
      phaseId: "obs_phase_01",
      parentKey: "obs_phase_01--div",
      adopteeKeys: ["obs_phase_01--bnX"],
      landingDepth: 1,
      validFrom: "2026-11-01",
      uuid: counter(),
    });
    expect(rootUnitKey).toBe("obs_phase_01--u1");
    expect(unitCount).toBe(2);
    expect(payload.unitHierarchy).toMatchObject({ phaseKey: "obs_phase_01" });
    expect(payload.units.every((u) => u.primaryKey.startsWith("obs_phase_01--"))).toBe(true);
    expect(payload.units.every((u) => u.latitude !== null)).toBe(true);
    const pairs = payload.unitHierarchyEdges.map((e) => `${e.parentUnitKey}>${e.childUnitKey}`);
    expect(pairs).toEqual(
      expect.arrayContaining([
        "obs_phase_01--div>obs_phase_01--u1",
        "obs_phase_01--u1>obs_phase_01--u2",
        "obs_phase_01--u1>obs_phase_01--bnX",
      ]),
    );
    // The new unit and its adoptee are managed, so stale parent edges go.
    expect(payload.managedChildUnitKeys).toEqual(["obs_phase_01--bnX", "obs_phase_01--u1"]);
  });
});

describe("generateBeneathPayload", () => {
  it("never rewrites the existing unit", () => {
    const { payload, rootUnitKey } = generateBeneathPayload(REF, {
      existingKey: "obs_phase_01--bn",
      tree: comp("1 Bn", "Battalion", [comp("A Coy", "Company"), comp("B Coy", "Company")]),
      lat: 54.7,
      lng: 20.5,
      phaseId: "obs_phase_01",
      depth: 1,
      uuid: counter(),
    });
    expect(rootUnitKey).toBe("obs_phase_01--bn");
    expect(payload.units.map((u) => u.primaryKey)).toEqual([
      "obs_phase_01--u1",
      "obs_phase_01--u2",
    ]);
    expect(payload.managedChildUnitKeys).not.toContain("obs_phase_01--bn");
    expect(payload.unitHierarchyEdges.every((e) => e.parentUnitKey === "obs_phase_01--bn")).toBe(
      true,
    );
  });
});

describe("changeParentPayload", () => {
  const node = (key: string, parentKey: string | null): ForestNode => ({
    key,
    parentKey,
    label: key,
    echelon: "Battalion",
    sidc: "",
    side: "blue",
    entityType: "organisation",
    lat: 0,
    lng: 0,
  });
  const index = indexForest([node("bde", null), node("bn", "bde"), node("coy", "bn")]);

  it("manages only the moved unit and writes one edge", () => {
    const payload = changeParentPayload(REF, "coy", "bde", index, "2026-11-01");
    expect(payload.managedChildUnitKeys).toEqual(["coy"]);
    expect(payload.unitHierarchyEdges).toEqual([
      expect.objectContaining({ parentUnitKey: "bde", childUnitKey: "coy" }),
    ]);
  });

  it("makes a root with no edge", () => {
    expect(changeParentPayload(REF, "bn", null, index).unitHierarchyEdges).toEqual([]);
  });

  it("refuses to put a unit under its own subordinate", () => {
    expect(() => changeParentPayload(REF, "bn", "coy", index)).toThrow(/own subordinates/);
  });
});

describe("phasePlacementParentage", () => {
  const placement = (label: string, templateId: string, orbatParentUnitKey?: string) => ({
    label,
    sidc: "SFGPUCI----F---",
    templateId,
    orbatParentUnitKey,
  });
  //   bde (placed root)    bn1 (placed, root)    bn2 (placed, under a generated coy-hq)
  const index = indexForest([
    {
      key: "p--bde",
      parentKey: null,
      label: "Bde",
      echelon: "Brigade",
      sidc: "",
      side: "blue",
      entityType: "organisation",
      lat: 0,
      lng: 0,
    },
    {
      key: "p--bn1",
      parentKey: null,
      label: "Bn 1",
      echelon: "Battalion",
      sidc: "",
      side: "blue",
      entityType: "organisation",
      lat: 0,
      lng: 0,
    },
    {
      key: "p--hq",
      parentKey: "p--bde",
      label: "HQ",
      echelon: "Company",
      sidc: "",
      side: "blue",
      entityType: "organisation",
      lat: 0,
      lng: 0,
    },
    {
      key: "p--bn2",
      parentKey: "p--hq",
      label: "Bn 2",
      echelon: "Battalion",
      sidc: "",
      side: "blue",
      entityType: "organisation",
      lat: 0,
      lng: 0,
    },
  ]);

  it("derives parents for current roots and never touches units already in the tree", () => {
    const payload = phasePlacementParentage(
      REF,
      [
        { placement: placement("Bde", "infantry__Brigade"), rootUnitKey: "p--bde" },
        { placement: placement("Bn 1", "infantry__Battalion"), rootUnitKey: "p--bn1" },
        { placement: placement("Bn 2", "infantry__Battalion"), rootUnitKey: "p--bn2" },
      ],
      treeViewOf(index),
      { validFrom: "2026-11-01" },
    );
    expect(payload.unitHierarchyEdges.map((e) => `${e.parentUnitKey}>${e.childUnitKey}`)).toEqual([
      "p--bde>p--bn1",
    ]);
    // bn2's parent (an unplaced HQ) is not in the payload, so it must not be managed.
    expect(payload.managedChildUnitKeys).toEqual(["p--bde", "p--bn1"]);
    expect(payload.unitHierarchy.phaseKey).toBe("obs_phase_01");
  });

  it("applies an explicit planner override even over the tree", () => {
    const payload = phasePlacementParentage(
      REF,
      [
        { placement: placement("Bde", "infantry__Brigade"), rootUnitKey: "p--bde" },
        { placement: placement("Bn 1", "infantry__Battalion"), rootUnitKey: "p--bn1" },
        { placement: placement("Bn 2", "infantry__Battalion", "p--bn1"), rootUnitKey: "p--bn2" },
      ],
      treeViewOf(index),
    );
    expect(payload.managedChildUnitKeys).toContain("p--bn2");
    expect(payload.unitHierarchyEdges).toContainEqual(
      expect.objectContaining({ parentUnitKey: "p--bn1", childUnitKey: "p--bn2" }),
    );
  });

  it("refuses a derived parent from inside the unit's own subtree", () => {
    // Bn 1 is a root; pretend the only senior unit sits beneath it.
    const cyclic = indexForest([
      {
        key: "a",
        parentKey: null,
        label: "a",
        echelon: "Battalion",
        sidc: "",
        side: "blue",
        entityType: "organisation",
        lat: 0,
        lng: 0,
      },
      {
        key: "b",
        parentKey: "a",
        label: "b",
        echelon: "Brigade",
        sidc: "",
        side: "blue",
        entityType: "organisation",
        lat: 0,
        lng: 0,
      },
    ]);
    const payload = phasePlacementParentage(
      REF,
      [
        { placement: placement("a", "infantry__Battalion"), rootUnitKey: "a" },
        { placement: placement("b", "infantry__Brigade"), rootUnitKey: "b" },
      ],
      treeViewOf(cyclic),
    );
    expect(payload.unitHierarchyEdges).toEqual([]);
  });
});

describe("cloneSubtreePayloadParts", () => {
  it("copies with fresh phase keys and re-lays every unit at the new position", () => {
    const tree = comp("1 Bn", "Battalion", [comp("A Coy", "Company")]);
    const parts = cloneSubtreePayloadParts(tree, { lat: 54.8, lng: 20.6 }, "obs_phase_02", {
      uuid: counter(),
    });
    expect(parts.rootUnitKey).toBe("obs_phase_02--u1");
    expect(parts.units[0]).toMatchObject({ latitude: 54.8, longitude: 20.6 });
    expect(parts.units[1].latitude).not.toBe(54.8);
    expect(parts.edges).toEqual([
      expect.objectContaining({
        parentUnitKey: "obs_phase_02--u1",
        childUnitKey: "obs_phase_02--u2",
      }),
    ]);
  });
});

describe("inheriting nested placements", () => {
  it("maps every source unit to its copy, so nested placements link instead of re-cloning", () => {
    const tree = comp("Bde", "Brigade", [comp("1 Bn", "Battalion", [comp("A Coy", "Company")])]);
    tree.id = "src-bde";
    tree.children[0].id = "src-bn";
    tree.children[0].children[0].id = "src-coy";
    const parts = cloneSubtreePayloadParts(tree, { lat: 54.7, lng: 20.5 }, "p2", {
      uuid: counter(),
    });
    expect([...parts.idMap.keys()]).toEqual(["src-bde", "src-bn", "src-coy"]);
    expect(parts.idMap.get("src-bn")).toBe("p2--u2");
  });

  it("pins each placed unit where it ended, carrying its subtree, outer pins first", () => {
    const tree = comp("Bde", "Brigade", [comp("1 Bn", "Battalion", [comp("A Coy", "Company")])]);
    const parts = cloneSubtreePayloadParts(tree, { lat: 54.7, lng: 20.5 }, "p2", {
      uuid: counter(),
    });
    const [bde, bn, coy] = parts.units;
    const coyOffset = { lat: coy.latitude! - bn.latitude!, lng: coy.longitude! - bn.longitude! };
    // Inner pin listed first on purpose: order must not matter.
    pinSubtrees(
      parts.units,
      parts.edges,
      new Map([
        [bn.primaryKey, { lat: 55.0, lng: 21.0 }],
        [bde.primaryKey, { lat: 54.9, lng: 20.9 }],
      ]),
    );
    expect(bde).toMatchObject({ latitude: 54.9, longitude: 20.9 });
    expect(bn.latitude).toBeCloseTo(55.0, 9);
    expect(bn.longitude).toBeCloseTo(21.0, 9);
    // The company keeps its offset from its battalion.
    expect(coy.latitude! - bn.latitude!).toBeCloseTo(coyOffset.lat, 9);
    expect(coy.longitude! - bn.longitude!).toBeCloseTo(coyOffset.lng, 9);
  });
});
