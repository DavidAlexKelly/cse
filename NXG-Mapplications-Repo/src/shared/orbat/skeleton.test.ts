import { describe, expect, it } from "vitest";
import type { CompositionNode } from "@/shared/types";
import type { PlacedUnit } from "../../apps/scenarioPlanner/map/types";
import {
  autoOrbatCapFor,
  buildOrbatSkeleton,
  buildOrbatSkeletonWithReport,
  countNodes,
} from "./skeleton";
import { expandAutomat } from "./swordComposition";
import { buildSwordFormationIndex } from "./swordFormations";

const division: PlacedUnit = {
  id: "p1",
  templateId: "infantry__Division",
  label: "1 Inf Div",
  sidc: "SFGPUCI----I---",
  lat: 54.7,
  lng: 20.5,
};

/** Node count per depth. */
function levelSizes(root: CompositionNode): number[] {
  const sizes: number[] = [];
  const walk = (node: CompositionNode, depth: number) => {
    sizes[depth] = (sizes[depth] ?? 0) + 1;
    node.children.forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  return sizes;
}

describe("buildOrbatSkeleton", () => {
  it("keeps the default two-level tree", () => {
    const root = buildOrbatSkeleton(division);
    expect(levelSizes(root)).toEqual([1, 3, 9]);
    expect(root.children[0].unitIdentifier).toBe("1 Bde, 1 Inf Div");
  });

  it("drops a whole level rather than filling one branch when capped", () => {
    // 1 + 3 + 9 = 13 fits; the next level (27) would not.
    const report = buildOrbatSkeletonWithReport(division, { depth: Infinity, maxNodes: 30 });
    expect(levelSizes(report.root)).toEqual([1, 3, 9]);
    expect(report.unitCount).toBe(13);
    expect(report.truncated).toBe(true);
  });

  it("goes to the bottom of the ladder when the cap allows", () => {
    const platoon: PlacedUnit = { ...division, templateId: "infantry__Platoon", label: "1 Pl" };
    const report = buildOrbatSkeletonWithReport(platoon, { depth: Infinity, maxNodes: 500 });
    // Platoon → 3 sections → 2 squads each → 2 teams each.
    expect(levelSizes(report.root)).toEqual([1, 3, 6, 12]);
    expect(report.truncated).toBe(false);
  });

  it("counts an expanded automat's quantities against the cap", () => {
    const index = buildSwordFormationIndex([
      {
        identifier: "ARMOR.Heavy tank company|automat",
        displayName: "Heavy tank company",
        disCode: "12.1.225.3.2.0.1",
        constituentUnits: "ARMOR.Armored company CP#1#1|ARMOR.Heavy tank platoon#3#3",
        commandPostUnit: "ARMOR.Armored company CP",
      },
      {
        identifier: "ARMOR.Armored company CP|unit",
        displayName: "Armored company CP",
        disCode: "1.1.225.5.20.0.0",
      },
      {
        identifier: "ARMOR.Heavy tank platoon|unit",
        displayName: "Heavy tank platoon",
        disCode: "1.1.225.3.4.0.1",
      },
    ]);
    const battalion: PlacedUnit = {
      ...division,
      templateId: "armour__Battalion",
      label: "3 Armd Bn",
      sidc: "SFGPUCA----F---",
    };
    const options = {
      depth: Infinity,
      nature: "ARMOR",
      swordFormations: index,
      expandAutomat: (node: CompositionNode) => expandAutomat(node, index),
    };
    // Each company becomes CP ×1 + platoon ×3 under the (demoted) company: 5 units.
    const full = buildOrbatSkeletonWithReport(battalion, { ...options, maxNodes: 150 });
    expect(full.unitCount).toBe(1 + 3 * 5);
    expect(full.truncated).toBe(false);
    // The ladder stops at the automat: nothing below the SWORD constituents.
    expect(full.root.children[0].children.every((c) => c.children.length === 0)).toBe(true);

    const capped = buildOrbatSkeletonWithReport(battalion, { ...options, maxNodes: 10 });
    expect(capped.unitCount).toBe(1);
    expect(capped.truncated).toBe(true);
  });
});

describe("autoOrbatCapFor", () => {
  it("scales with the root echelon", () => {
    expect(autoOrbatCapFor("Division")).toBe(3000);
    expect(autoOrbatCapFor("Brigade")).toBe(1000);
    expect(autoOrbatCapFor("Battalion")).toBe(150);
    expect(autoOrbatCapFor("Company")).toBe(40);
    expect(autoOrbatCapFor(undefined)).toBe(500);
  });
});
