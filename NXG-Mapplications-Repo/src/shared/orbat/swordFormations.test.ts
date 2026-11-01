import { describe, it, expect } from "vitest";

import {
  buildSwordFormationIndex,
  echelonWordIn,
  matchSwordFormation,
  natureFromText,
  parseSwordFormation,
  type OSwordFormationRow,
} from "./swordFormations";

// Real rows from the SWORD catalogue, glyphs included — note that a tank
// company and a tank platoon both report "ooo", which is exactly why matching
// uses the echelon word rather than the glyph.
const ROWS: OSwordFormationRow[] = [
  { identifier: "ARMOR.Heavy tank company|automat", displayName: "Heavy tank company", disCode: "12.1.225.3.2.0.1", echelonLevel: "ooo" },
  { identifier: "ARMOR.Medium tank company|automat", displayName: "Medium tank company", disCode: "12.1.225.3.2.0.2", echelonLevel: "ooo" },
  { identifier: "ARMOR.Armored company CP|unit", displayName: "Armored company CP", disCode: "1.1.225.5.20.0.0", echelonLevel: "ooo" },
  { identifier: "ARMOR.Heavy tank platoon|unit", displayName: "Heavy tank platoon", disCode: "1.1.225.3.4.0.1", echelonLevel: "ooo" },
  { identifier: "ARMOR.Scout platoon|automat", displayName: "Scout platoon", disCode: "12.1.225.3.9.0.1", echelonLevel: "oo" },
  { identifier: "ARMOR.Antitank section|unit", displayName: "Antitank section", disCode: "1.1.225.3.7.0.1", echelonLevel: "oo" },
  { identifier: "INF.Rifle company|automat", displayName: "Rifle company", disCode: "12.1.225.5.5.0.10", echelonLevel: "ooo" },
  { identifier: "INF.Rifle platoon|unit", displayName: "Rifle platoon", disCode: "1.1.225.3.3.0.0", echelonLevel: "oo" },
  { identifier: "ART.Guns firing battery|automat", displayName: "Guns firing battery", disCode: "12.1.225.4.2.1", echelonLevel: "ooo" },
  { identifier: "ART.Guns firing platoon|unit", displayName: "Guns firing platoon", disCode: "1.1.225.4.2.1.0", echelonLevel: "ooo" },
  // Unlinkable: no DIS code, so it must never be chosen.
  { identifier: "INF.Sniper platoon|automat", displayName: "Sniper platoon", disCode: "", echelonLevel: "oo" },
];

const INDEX = buildSwordFormationIndex(ROWS);

describe("parseSwordFormation", () => {
  it("splits nature, name and level out of the identifier", () => {
    const f = parseSwordFormation(ROWS[0]);
    expect(f.nature).toBe("ARMOR");
    expect(f.echelonWord).toBe("company");
    expect(f.level).toBe("automat");
    expect(f.disCode).toBe("12.1.225.3.2.0.1");
  });

  it("recognises unit-level rows", () => {
    expect(parseSwordFormation(ROWS[3]).level).toBe("unit");
  });
});

describe("echelonWordIn", () => {
  it("reads the echelon from the name, which the glyph does not give reliably", () => {
    expect(echelonWordIn("Heavy tank company")).toBe("company");
    expect(echelonWordIn("Heavy tank platoon")).toBe("platoon");
    expect(echelonWordIn("Antitank section")).toBe("section");
    expect(echelonWordIn("Guns firing battery")).toBe("battery");
  });

  it("returns null when the name carries no echelon", () => {
    expect(echelonWordIn("Militia")).toBeNull();
  });
});

describe("the echelon glyph is not usable for matching", () => {
  it("gives the same glyph to a company and a platoon", () => {
    // Pinning the reason this module parses names instead. If SWORD ever fixes
    // its glyphs, this test failing is the signal that the simpler approach
    // has become available.
    const company = parseSwordFormation(ROWS[0]);
    const platoon = parseSwordFormation(ROWS[3]);
    expect(company.echelonGlyph).toBe(platoon.echelonGlyph);
    expect(company.echelonWord).not.toBe(platoon.echelonWord);
  });
});

describe("natureFromText", () => {
  it("reads nature out of a unit name", () => {
    expect(natureFromText("A Squadron", "Challenger 2 tank squadron")).toBe("ARMOR");
    expect(natureFromText("1 Battery, Royal Artillery")).toBe("ART");
    expect(natureFromText("Air Defence Battery")).toBe("AAA");
    expect(natureFromText("Cargo helicopters flight")).toBe("AAVN");
    expect(natureFromText("D Company (Mechanised Infantry)")).toBe("INF");
  });

  it("falls back to infantry rather than guessing", () => {
    expect(natureFromText("A Company")).toBe("INF");
    expect(natureFromText(undefined)).toBe("INF");
  });
});

// isAutomat moved to representation.ts, where the whole vocabulary lives and
// is mirrored in Python. Its tests moved with it, to representation.test.ts.

describe("matchSwordFormation", () => {
  it("matches a company to an automat of the right nature", () => {
    const match = matchSwordFormation(INDEX, "Company", "ARMOR");
    expect(match?.identifier).toBe("ARMOR.Heavy tank company|automat");
  });

  it("matches a platoon to a platoon, not to the same-glyph company", () => {
    const match = matchSwordFormation(INDEX, "Platoon", "ARMOR");
    expect(match?.echelonWord).toBe("platoon");
  });

  it("prefers an automat over a unit at the same echelon", () => {
    // Scout platoon is an automat; Heavy tank platoon is a unit.
    const match = matchSwordFormation(INDEX, "Platoon", "ARMOR");
    expect(match?.level).toBe("automat");
  });

  it("prefers the plain type over a specialised variant", () => {
    // "Heavy tank company" over "Armored company CP".
    expect(matchSwordFormation(INDEX, "Company", "ARMOR")?.displayName).toBe("Heavy tank company");
  });

  it("never returns a row that cannot be linked", () => {
    // INF.Sniper platoon is the only INF platoon automat and has no DIS code,
    // so the linkable INF.Rifle platoon unit must win.
    const match = matchSwordFormation(INDEX, "Platoon", "INF");
    expect(match?.identifier).toBe("INF.Rifle platoon|unit");
    expect(match?.disCode).not.toBe("");
  });

  it("returns null above company level, where SWORD has no equivalent", () => {
    // A brigade is a composition of automats in SWORD, not a catalogue entry.
    expect(matchSwordFormation(INDEX, "Brigade", "ARMOR")).toBeNull();
    expect(matchSwordFormation(INDEX, "Division", "INF")).toBeNull();
    expect(matchSwordFormation(INDEX, "Battalion", "INF")).toBeNull();
  });

  it("returns null for a nature the catalogue does not cover", () => {
    expect(matchSwordFormation(INDEX, "Company", "NAVY")).toBeNull();
  });

  it("is deterministic", () => {
    const a = matchSwordFormation(INDEX, "Company", "ARMOR");
    const b = matchSwordFormation(INDEX, "Company", "ARMOR");
    expect(a?.identifier).toBe(b?.identifier);
  });
});
