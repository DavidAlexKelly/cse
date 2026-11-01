import { describe, it, expect } from "vitest";
import rules from "./__fixtures__/rules.json";

import {
  assertNoDoubleCounting,
  findDoubleCountedDescendants,
  isSelfContained,
  representationOf,
  type Representation,
} from "./representation";

// SHARED CASE TABLE — the one file both this suite and the Translator's Python
// suite run (src/shared/orbat/__fixtures__/rules.json, vendored from
// NXG-Translator tests/shared/rules_fixture.json). Add cases there.

interface Case {
  name: string;
  entityType: string;
  code: string | null;
  expected: Representation;
}

const CASES: Case[] = rules.representation as Case[];

describe("representationOf", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(
        representationOf({ entityType: c.entityType, simulatorIdentifierCode: c.code }),
      ).toBe(c.expected);
    });
  }

  it("treats an unknown entityType as structure rather than guessing", () => {
    // Defensive: entityType is free text in the ontology, so a typo must not
    // silently become an entity and get a platform demanded of it.
    expect(representationOf({ entityType: "vehicles", simulatorIdentifierCode: null })).toBe(
      "aggregate",
    );
  });
});

describe("isSelfContained", () => {
  it("is true for the two representations SWORD builds internally", () => {
    expect(isSelfContained("automat")).toBe(true);
    expect(isSelfContained("subformation")).toBe(true);
  });

  it("is false for structure and for entities", () => {
    expect(isSelfContained("aggregate")).toBe(false);
    expect(isSelfContained("entity")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The tree assertion. The first fixture is the live ontology, unmodified:
// "Air Defence Battery" is a SWORD automat with three VBS4 vehicles beneath it.
// ─────────────────────────────────────────────────────────────────────────────

const AIR_DEFENCE_BATTERY = {
  id: "adb",
  unitIdentifier: "Air Defence Battery",
  entityType: "organisation",
  simulatorIdentifierCode: "AAA.Surface to air battery|automat",
  children: [
    {
      id: "cp",
      unitIdentifier: "AD Battery CP Vehicle",
      entityType: "vehicle",
      simulatorIdentifierCode: "CP.Armored vehicle|AAA.Surface to air battery|1.1.225.2.5.33.0|equipment",
      children: [],
    },
    {
      id: "aat",
      unitIdentifier: "Anti-aircraft Tank Alpha",
      entityType: "vehicle",
      simulatorIdentifierCode: "vbs_us_army_m163_vulcan_grn_x",
      children: [],
    },
    {
      id: "tdv",
      unitIdentifier: "Target Detection Vehicle Alpha",
      entityType: "vehicle",
      simulatorIdentifierCode: "AAA.Target Detection Vehicle|AAA.Surface to air battery|1.1.225.7.12.8.0|equipment",
      children: [],
    },
  ],
};

describe("findDoubleCountedDescendants", () => {
  it("finds every vehicle under a live automat, not just the first", () => {
    const found = findDoubleCountedDescendants(AIR_DEFENCE_BATTERY);
    expect(found.map((f) => f.node.unitIdentifier)).toEqual([
      "AD Battery CP Vehicle",
      "Anti-aircraft Tank Alpha",
      "Target Detection Vehicle Alpha",
    ]);
    expect(found.every((f) => f.ancestor.unitIdentifier === "Air Defence Battery")).toBe(true);
  });

  it("names both units and says what to do", () => {
    const [first] = findDoubleCountedDescendants(AIR_DEFENCE_BATTERY);
    expect(first.message).toContain("AD Battery CP Vehicle");
    expect(first.message).toContain("Air Defence Battery");
    expect(first.message).toContain("twice");
  });

  it("is quiet when the automat is a leaf, which is what generation now produces", () => {
    expect(
      findDoubleCountedDescendants({ ...AIR_DEFENCE_BATTERY, children: [] }),
    ).toEqual([]);
  });

  it("is quiet when the same tree hangs off a structural brigade", () => {
    // Clearing the automat's SWORD code is one of the two fixes the message
    // offers; it must actually silence the finding.
    const brigade = {
      id: "bde",
      unitIdentifier: "1 Armoured Brigade",
      entityType: "organisation",
      simulatorIdentifierCode: null,
      children: [{ ...AIR_DEFENCE_BATTERY, simulatorIdentifierCode: null }],
    };
    expect(findDoubleCountedDescendants(brigade)).toEqual([]);
  });

  it("reports through an intervening organisation, because depth does not fix it", () => {
    const battery = {
      ...AIR_DEFENCE_BATTERY,
      children: [
        {
          id: "tp",
          unitIdentifier: "1 Troop",
          entityType: "organisation",
          simulatorIdentifierCode: null,
          children: [AIR_DEFENCE_BATTERY.children[1]],
        },
      ],
    };
    const found = findDoubleCountedDescendants(battery);
    expect(found).toHaveLength(1);
    expect(found[0].node.unitIdentifier).toBe("Anti-aircraft Tank Alpha");
    expect(found[0].ancestor.unitIdentifier).toBe("Air Defence Battery");
  });

  it("does not report crew inside a vehicle: they move with the platform", () => {
    const company = {
      id: "coy",
      unitIdentifier: "A Company",
      entityType: "organisation",
      simulatorIdentifierCode: null,
      children: [
        {
          id: "wr",
          unitIdentifier: "Warrior 1",
          entityType: "vehicle",
          simulatorIdentifierCode: "vbs2_ukf_warrior_gr",
          children: [
            {
              id: "drv",
              unitIdentifier: "Driver",
              entityType: "human",
              simulatorIdentifierCode: "vbs2_ukf_soldier",
              children: [],
            },
          ],
        },
      ],
    };
    expect(findDoubleCountedDescendants(company)).toEqual([]);
  });

  it("reports beneath a sub-formation too: SWORD builds its equipment itself", () => {
    const platoon = {
      id: "pl",
      unitIdentifier: "1 Platoon",
      entityType: "organisation",
      simulatorIdentifierCode: "INF.Rifle platoon|unit",
      children: [
        {
          id: "sec",
          unitIdentifier: "Rifleman",
          entityType: "human",
          simulatorIdentifierCode: "vbs2_ukf_soldier",
          children: [],
        },
      ],
    };
    expect(findDoubleCountedDescendants(platoon)).toHaveLength(1);
  });
});

describe("assertNoDoubleCounting", () => {
  it("throws, counts the offenders and names the tree", () => {
    expect(() => assertNoDoubleCounting(AIR_DEFENCE_BATTERY)).toThrow(
      /Cannot write "Air Defence Battery": 3 unit\(s\) are counted twice/,
    );
  });

  it("does not throw on a clean tree", () => {
    expect(() => assertNoDoubleCounting({ ...AIR_DEFENCE_BATTERY, children: [] })).not.toThrow();
  });
});
