import { describe, expect, it } from "vitest";
import { type ForestNode, indexForest } from "./orbatLevels";
import {
  adoptees,
  chooseParent,
  distanceKm,
  landingLevel,
  parentCandidates,
} from "./placeIntoOrbat";

function unit(
  key: string,
  echelon: string,
  lat: number,
  lng: number,
  parentKey: string | null = null,
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
    lat,
    lng,
  };
}

const AT = { lat: 54.7, lng: 20.5 };

describe("chooseParent", () => {
  const index = indexForest([
    unit("div", "Division", 54.9, 20.5),
    unit("bde-near", "Brigade", 54.72, 20.5, "div"),
    unit("bde-far", "Brigade", 55.2, 20.5, "div"),
    unit("red-bde", "Brigade", 54.7, 20.5, null, "red"),
  ]);

  it("takes the next echelon up, nearest first, on the same side", () => {
    expect(chooseParent(index, { echelon: "Battalion", side: "blue", ...AT })).toBe("bde-near");
  });

  it("skips past echelons nobody holds", () => {
    // No regiment exists, so a regiment-level unit goes under the division.
    expect(chooseParent(index, { echelon: "Brigade", side: "blue", ...AT })).toBe("div");
  });

  it("never parents across sides", () => {
    expect(chooseParent(index, { echelon: "Battalion", side: "red", ...AT })).toBe("red-bde");
    expect(chooseParent(index, { echelon: "Division", side: "red", ...AT })).toBeNull();
  });

  it("gives an unknown echelon no parent", () => {
    expect(chooseParent(index, { echelon: "", side: "blue", ...AT })).toBeNull();
  });
});

describe("adoptees", () => {
  const index = indexForest([
    unit("bn-close", "Battalion", 54.71, 20.5),
    unit("bn-far", "Battalion", 55.5, 20.5), // ~89 km away
    unit("coy-led", "Company", 54.7, 20.51, "bn-close"), // not a root
    unit("bde-peer", "Brigade", 54.7, 20.52),
    unit("red-bn", "Battalion", 54.7, 20.5, null, "red"),
  ]);

  it("adopts same-side roots it outranks within range, nearest first", () => {
    expect(adoptees(index, { echelon: "Brigade", side: "blue", ...AT })).toEqual(["bn-close"]);
  });

  it("adopts nothing it does not outrank", () => {
    expect(adoptees(index, { echelon: "Battalion", side: "blue", ...AT })).toEqual([]);
  });
});

describe("landing level and re-parent options", () => {
  const index = indexForest([
    unit("bde", "Brigade", 54.7, 20.5),
    unit("bn", "Battalion", 54.71, 20.5, "bde"),
    unit("coy", "Company", 54.72, 20.5, "bn"),
    unit("bde2", "Brigade", 54.8, 20.5),
  ]);

  it("lands one below the parent", () => {
    expect(landingLevel(index, "bn")).toBe(2);
    expect(landingLevel(index, null)).toBe(0);
  });

  it("offers senior same-side units outside the node's own subtree", () => {
    const options = parentCandidates(index, "bn", new Set(["bn", "coy"]));
    expect(options).toEqual(["bde", "bde2"]);
  });

  it("measures distance in km", () => {
    expect(distanceKm({ lat: 54, lng: 20 }, { lat: 55, lng: 20 })).toBeCloseTo(111.2, 0);
  });
});
