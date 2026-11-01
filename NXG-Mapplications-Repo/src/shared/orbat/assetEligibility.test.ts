import { describe, it, expect } from "vitest";

import {
  assertCompositionEligible,
  assetIneligibleReason,
  assetRequiredForEntityType,
  candidateSimulators,
  effectiveTargets,
  facetValues,
  filterSelectableAssets,
  isAssetAvailableForAny,
  isNodeEligible,
  needsSimulatorAsset,
  normaliseSimTarget,
  selectableAssetsForEntityType,
  simulatorForModel,
  validateComposition,
} from "./assetEligibility";
import type { AssetAvailability, CompositionNode, OCanonicalAsset } from "../types/index";

// ── Fixtures ────────────────────────────────────────────────────────────────

function asset(
  primaryKey: string,
  canonicalName: string,
  availability: Partial<AssetAvailability>,
  simulationClass = "Platform",
): OCanonicalAsset {
  return {
    primaryKey,
    canonicalName,
    nationality: "GBR",
    militaryDomain: "Land",
    simulationClass,
    assetCategory: "Armored Fighting Vehicle",
    subcategory: "Tank",
    branch: "",
    availability: { vbs4: 0, sword: 0, simworks: 0, ...availability },
  };
}

// Mirrors the real shape of the catalogue: VBS4-only platforms, SIMWORKS-only
// platforms, SWORD-only organisations, and assets nothing can spawn.
const CHALLENGER = asset("1.1.224.1.1.0", "Challenger 2", { vbs4: 4 });
const FRIGATE = asset("1.3.153.6.4.1", "F802 De Zeven Provincien", { simworks: 1 });
const RIFLE_COY = asset("12.1.225.5.5.0.10", "Rifle company", { sword: 1 }, "Organisation");
const ORPHAN = asset("1.1.999.0.0.0", "Ghost Platform", {});

const ASSETS = new Map([CHALLENGER, FRIGATE, RIFLE_COY, ORPHAN].map((a) => [a.primaryKey, a]));

function node(overrides: Partial<CompositionNode> = {}): CompositionNode {
  return {
    id: "n1",
    unitIdentifier: "1 Troop",
    echelon: "Troop",
    sidc: "SFGPUCA---E----",
    entityType: "vehicle",
    militaryService: "Army",
    affiliation: "Friend",
    allegiance: "GBR",
    owningSimulator: "vbs4",
    canonicalAssetKey: CHALLENGER.primaryKey,
    simulatorIdentifierCode: "vbs2_gb_army_challenger2_w_x",
    unitTypeKey: null,
    equipmentTypeKey: null,
    quantity: 1,
    children: [],
    ...overrides,
  };
}

// ── Simulator normalisation ─────────────────────────────────────────────────

describe("normaliseSimTarget", () => {
  it("accepts the spellings the ontology actually holds", () => {
    expect(normaliseSimTarget("Vbs4")).toBe("vbs4");
    expect(normaliseSimTarget("vbs4")).toBe("vbs4");
    expect(normaliseSimTarget("Simworks")).toBe("simworks");
    expect(normaliseSimTarget("simworks")).toBe("simworks");
    expect(normaliseSimTarget("sword")).toBe("sword");
  });

  it("treats unfederated and unknown values as no target", () => {
    expect(normaliseSimTarget("none")).toBeNull();
    expect(normaliseSimTarget("")).toBeNull();
    expect(normaliseSimTarget(undefined)).toBeNull();
    expect(normaliseSimTarget("arma")).toBeNull();
  });
});

// ── Which catalogue applies ─────────────────────────────────────────────────

describe("effectiveTargets", () => {
  it("routes platforms to VBS4/SIMWORKS and organisations to SWORD", () => {
    expect(effectiveTargets({ entityType: "vehicle", owningSimulator: "vbs4" })).toEqual(["vbs4"]);
    expect(effectiveTargets({ entityType: "organisation", owningSimulator: "sword" })).toEqual(["sword"]);
  });

  it("exempts an organisation in a VBS4 ORBAT — structure is the tree, not an entity", () => {
    expect(effectiveTargets({ entityType: "organisation", owningSimulator: "vbs4" })).toEqual([]);
  });

  it("exempts unfederated units", () => {
    expect(effectiveTargets({ entityType: "vehicle", owningSimulator: "none" })).toEqual([]);
  });

  it("prefers the exercise target set over the unit's own simulator", () => {
    expect(effectiveTargets({ entityType: "vehicle", owningSimulator: "vbs4" }, ["simworks"])).toEqual(["simworks"]);
  });
});

describe("needsSimulatorAsset", () => {
  it("does not ask structural organisations for an asset", () => {
    expect(needsSimulatorAsset(node({ entityType: "organisation", owningSimulator: "vbs4" }))).toBe(false);
  });

  it("does not ask crew inside a vehicle for their own asset", () => {
    expect(needsSimulatorAsset(node({ entityType: "human" }), "vehicle")).toBe(false);
    expect(needsSimulatorAsset(node({ entityType: "human" }), "organisation")).toBe(true);
  });
});

// ── Selection ───────────────────────────────────────────────────────────────

describe("filterSelectableAssets", () => {
  it("offers only assets the target simulator can spawn", () => {
    const visible = filterSelectableAssets(ASSETS.values(), "vehicle", ["vbs4"]);
    expect(visible.map((a) => a.primaryKey)).toEqual([CHALLENGER.primaryKey]);
  });

  it("offers SWORD organisations when the ORBAT targets SWORD", () => {
    const visible = filterSelectableAssets(ASSETS.values(), "organisation", ["sword"]);
    expect(visible.map((a) => a.primaryKey)).toEqual([RIFLE_COY.primaryKey]);
  });

  it("never falls back to the unfiltered catalogue when nothing matches", () => {
    // The old pickers did `filtered.length ? filtered : all`, which is how
    // unusable assets got into ORBATs. An empty list must stay empty.
    const visible = filterSelectableAssets([ORPHAN], "vehicle", ["vbs4"]);
    expect(visible).toEqual([]);
  });

  it("offers everything when the node needs no catalogue at all", () => {
    const visible = filterSelectableAssets(ASSETS.values(), "vehicle", []);
    expect(visible).toHaveLength(ASSETS.size);
  });
});

// ── Property-led selection ──────────────────────────────────────────────────
//
// What a node IS decides which catalogues can model it, and the simulator
// follows from the model chosen — the planner never picks a simulator.

describe("candidateSimulators", () => {
  it("sends organisations to SWORD and everything else to VBS4/SIMWORKS", () => {
    expect(candidateSimulators("organisation")).toEqual(["sword"]);
    expect(candidateSimulators("vehicle")).toEqual(["vbs4", "simworks"]);
    expect(candidateSimulators("human")).toEqual(["vbs4", "simworks"]);
    expect(candidateSimulators("aircraft")).toEqual(["vbs4", "simworks"]);
  });
});

describe("selectableAssetsForEntityType", () => {
  it("offers a vehicle anything VBS4 or SIMWORKS can spawn", () => {
    // Needs ANY of the candidates, not all: requiring both would leave only
    // the 48 dual-catalogue assets on offer out of 1,602.
    const visible = selectableAssetsForEntityType(ASSETS.values(), "vehicle");
    expect(visible.map((a) => a.primaryKey).sort()).toEqual(
      [CHALLENGER.primaryKey, FRIGATE.primaryKey].sort(),
    );
  });

  it("offers an organisation only SWORD automats", () => {
    const visible = selectableAssetsForEntityType(ASSETS.values(), "organisation");
    expect(visible.map((a) => a.primaryKey)).toEqual([RIFLE_COY.primaryKey]);
  });

  it("never offers an asset no simulator carries", () => {
    const visible = selectableAssetsForEntityType(ASSETS.values(), "vehicle");
    expect(visible.map((a) => a.primaryKey)).not.toContain(ORPHAN.primaryKey);
  });
});

describe("isAssetAvailableForAny", () => {
  it("is satisfied by one simulator, unlike the every-target check", () => {
    expect(isAssetAvailableForAny(CHALLENGER, ["vbs4", "simworks"])).toBe(true);
    expect(isAssetAvailableForAny(FRIGATE, ["vbs4", "simworks"])).toBe(true);
    expect(isAssetAvailableForAny(ORPHAN, ["vbs4", "simworks"])).toBe(false);
    expect(isAssetAvailableForAny(undefined, ["vbs4"])).toBe(false);
  });
});

describe("simulatorForModel", () => {
  it("derives the owning simulator from the chosen model", () => {
    // The point of deriving: the asset alone is ambiguous for the 48 assets in
    // both catalogues, the model never is.
    expect(simulatorForModel({ simulator: "vbs4" })).toBe("vbs4");
    expect(simulatorForModel({ simulator: "simworks" })).toBe("simworks");
    expect(simulatorForModel({ simulator: "sword" })).toBe("sword");
  });
});

describe("assetRequiredForEntityType", () => {
  it("requires an asset for entities but not for organisations", () => {
    expect(assetRequiredForEntityType("vehicle")).toBe(true);
    expect(assetRequiredForEntityType("human")).toBe(true);
    expect(assetRequiredForEntityType("aircraft")).toBe(true);
    // 62 SWORD automats against 136 organisation types — requiring one would
    // block any VBS4-only ORBAT, where formations are structural.
    expect(assetRequiredForEntityType("organisation")).toBe(false);
  });
});

describe("facetValues", () => {
  it("derives filter options from the assets on offer, so none empties the list", () => {
    const vehicles = selectableAssetsForEntityType(ASSETS.values(), "vehicle");
    expect(facetValues(vehicles, "nationality")).toEqual(["GBR"]);
    expect(facetValues(vehicles, "subcategory")).toEqual(["Tank"]);
    expect(facetValues([], "assetCategory")).toEqual([]);
  });
});

// ── Node-level verdicts ─────────────────────────────────────────────────────

describe("assetIneligibleReason", () => {
  it("passes a fully linked unit", () => {
    expect(assetIneligibleReason(node(), ASSETS)).toBeNull();
    expect(isNodeEligible(node(), ASSETS)).toBe(true);
  });

  it("rejects a unit with no asset", () => {
    const reason = assetIneligibleReason(node({ canonicalAssetKey: null }), ASSETS);
    expect(reason).toMatch(/no catalogue asset/i);
  });

  it("rejects an asset the target simulator does not carry", () => {
    const reason = assetIneligibleReason(
      node({ canonicalAssetKey: FRIGATE.primaryKey, owningSimulator: "vbs4" }),
      ASSETS,
    );
    expect(reason).toMatch(/no VBS4 entry/i);
  });

  it("rejects an asset that is not in the catalogue at all", () => {
    const reason = assetIneligibleReason(node({ canonicalAssetKey: "1.2.3.4.5.6" }), ASSETS);
    expect(reason).toMatch(/not in the catalogue/i);
  });

  it("flags a resolvable asset with no specific model chosen", () => {
    const reason = assetIneligibleReason(node({ simulatorIdentifierCode: null }), ASSETS);
    expect(reason).toMatch(/no specific VBS4 model/i);
  });
});

// ── Tree validation ─────────────────────────────────────────────────────────

describe("validateComposition", () => {
  const tree = node({
    id: "root",
    entityType: "organisation",
    unitIdentifier: "A Squadron",
    canonicalAssetKey: null,
    simulatorIdentifierCode: null,
    children: [
      node({ id: "tank-ok" }),
      node({ id: "tank-no-asset", canonicalAssetKey: null, simulatorIdentifierCode: null }),
      node({ id: "tank-no-model", simulatorIdentifierCode: null }),
    ],
  });

  it("ignores the structural root and reports only the broken children", () => {
    const issues = validateComposition(tree, ASSETS);
    expect(issues.map((i) => i.unitKey).sort()).toEqual(["tank-no-asset", "tank-no-model"]);
  });

  it("separates unusable (ERROR) from unchosen (WARNING)", () => {
    const issues = validateComposition(tree, ASSETS);
    const byKey = new Map(issues.map((i) => [i.unitKey, i]));
    expect(byKey.get("tank-no-asset")?.severity).toBe("ERROR");
    expect(byKey.get("tank-no-asset")?.code).toBe("SIM_ASSET_UNRESOLVABLE");
    expect(byKey.get("tank-no-model")?.severity).toBe("WARNING");
    expect(byKey.get("tank-no-model")?.code).toBe("SIM_ASSET_NOT_CHOSEN");
  });

  it("assertCompositionEligible throws on errors but tolerates warnings", () => {
    expect(() => assertCompositionEligible(tree, ASSETS)).toThrow(
      /cannot be simulated as written/i,
    );

    const warnOnly = node({ id: "root2", children: [node({ id: "c", simulatorIdentifierCode: null })] });
    expect(() => assertCompositionEligible(warnOnly, ASSETS)).not.toThrow();
  });

  // The opposite failure to the ones above: every unit here resolves perfectly
  // well, and the tree is still wrong, because the battery and the tank inside
  // it are the same force counted twice. See representation.ts.
  it("reports a vehicle beneath a SWORD automat as an error", () => {
    const battery = node({
      id: "battery",
      entityType: "organisation",
      unitIdentifier: "Air Defence Battery",
      owningSimulator: "sword",
      canonicalAssetKey: RIFLE_COY.primaryKey,
      simulatorIdentifierCode: "AAA.Surface to air battery|automat",
      children: [node({ id: "tank-ok" })],
    });

    const issues = validateComposition(battery, ASSETS);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ unitKey: "tank-ok", severity: "ERROR", code: "DOUBLE_COUNTED" });
    expect(() => assertCompositionEligible(battery, ASSETS)).toThrow(/counted twice|twice/i);
  });
});
