import { describe, expect, it } from "vitest";
import {
  type ForestNode,
  ancestorsOf,
  descendantsOf,
  dominantEchelonAt,
  effectivePosition,
  frontierAt,
  indexForest,
  translateSubtree,
  withPositionOverrides,
} from "./orbatLevels";

function node(
  key: string,
  parentKey: string | null,
  echelon: string,
  pos: [number, number] | null = null,
  side: "blue" | "red" = "blue",
): ForestNode {
  return {
    key,
    parentKey,
    label: key,
    echelon,
    sidc: "SFGPUCI----E---",
    side,
    entityType: "organisation",
    lat: pos?.[0] ?? null,
    lng: pos?.[1] ?? null,
  };
}

//   bde ─┬─ bn1 ─┬─ coyA
//        │       └─ coyB
//        ├─ bn2            (leaf at depth 1)
//        └─ recce ── tp    (unpositioned child)
//   red-bde                (lone root, other side)
const FOREST: ForestNode[] = [
  node("bde", null, "Brigade", [54.7, 20.5]),
  node("bn1", "bde", "Battalion", [54.73, 20.5]),
  node("bn2", "bde", "Battalion", [54.67, 20.5]),
  node("recce", "bde", "Battalion", [54.7, 20.55]),
  node("coyA", "bn1", "Company", [54.74, 20.5]),
  node("coyB", "bn1", "Company", [54.72, 20.5]),
  node("tp", "recce", "Company"),
  node("red-bde", null, "Brigade", [54.9, 21.0], "red"),
];

describe("indexForest", () => {
  const index = indexForest(FOREST);

  it("assigns absolute depths per tree with every root at level 0", () => {
    expect(index.levels[0]).toEqual(["bde", "red-bde"]);
    expect(index.levels[1]).toEqual(["bn1", "bn2", "recce"]);
    expect(index.levels[2]).toEqual(["coyA", "coyB", "tp"]);
    expect(index.maxDepth).toBe(2);
  });

  it("treats a missing parent as a root rather than dropping the node", () => {
    const orphaned = indexForest([node("x", "gone", "Company")]);
    expect(orphaned.roots).toEqual(["x"]);
  });

  it("survives a cycle", () => {
    const cyclic = indexForest([node("a", "b", "Company"), node("b", "a", "Company")]);
    expect(cyclic.nodes.size).toBe(2);
    expect(cyclic.levels[0].length).toBeGreaterThan(0);
  });

  it("walks up and down the tree", () => {
    expect(descendantsOf(index, "bde")).toEqual(["bn1", "coyA", "coyB", "bn2", "recce", "tp"]);
    expect(ancestorsOf(index, "coyA")).toEqual(["bn1", "bde"]);
  });

  it("names the dominant echelon at a level", () => {
    expect(dominantEchelonAt(index, 1)).toBe("Battalion");
  });
});

describe("frontierAt", () => {
  const index = indexForest(FOREST);
  const keys = (level: number) => frontierAt(index, level).map((n) => n.key);

  it("shows the roots at level 0", () => {
    expect(keys(0)).toEqual(["bde", "red-bde"]);
  });

  it("keeps branches that end above the level", () => {
    // red-bde has no subordinates; bn2 ends at depth 1.
    expect(keys(2)).toEqual(["red-bde", "bn2", "coyA", "coyB", "tp"]);
  });

  it("clamps levels beyond the tree", () => {
    expect(keys(9)).toEqual(keys(2));
  });
});

describe("positions", () => {
  const index = indexForest(FOREST);

  it("draws an unpositioned node at its nearest positioned ancestor", () => {
    expect(effectivePosition(index, "tp")).toEqual({ lat: 54.7, lng: 20.55 });
  });

  it("moves a subtree by one offset, keeping its shape", () => {
    const moves = translateSubtree(index, "bn1", { lat: 54.83, lng: 20.6 });
    expect([...moves.keys()]).toEqual(["bn1", "coyA", "coyB"]);
    expect(moves.get("coyA")!.lat).toBeCloseTo(54.84, 9);
    expect(moves.get("coyA")!.lng).toBeCloseTo(20.6, 9);
  });

  it("does not invent positions for unpositioned descendants", () => {
    const moves = translateSubtree(index, "recce", { lat: 54.8, lng: 20.6 });
    expect([...moves.keys()]).toEqual(["recce"]);
  });

  it("applies overrides without mutating the input", () => {
    const moved = withPositionOverrides(FOREST, new Map([["bn2", { lat: 1, lng: 2 }]]));
    expect(moved.find((n) => n.key === "bn2")).toMatchObject({ lat: 1, lng: 2 });
    expect(FOREST.find((n) => n.key === "bn2")).toMatchObject({ lat: 54.67, lng: 20.5 });
  });
});
