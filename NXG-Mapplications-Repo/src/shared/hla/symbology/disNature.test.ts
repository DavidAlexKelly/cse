// ── shared/hla/symbology/disNature.test.ts ─────────────────────────────────
// The DIS codes the live federation actually publishes, and the ones it must
// refuse to interpret.

import ms from "milsymbol";
import { describe, expect, it } from "vitest";
import { buildSidc, functionIdForNature } from "./app6";
import { DIS_NATURES, natureFromDis } from "./disNature";

/** The SVG milsymbol draws for a SIDC. */
function draw(sidc: string): string {
  return new ms.Symbol(sidc, { size: 22, frame: true }).asSVG();
}

/** The same symbol with its function ID stripped — frame, affiliation, no icon. */
function bareFrameOf(sidc: string): string {
  return draw(sidc.slice(0, 4) + "------" + sidc.slice(10));
}

describe("natureFromDis — codes seen on the live feed", () => {
  // Every code below was taken from the tracks dataset, not invented: these are
  // the distinct dis_type values across the entities in the most recent
  // sessions, which is the set that was drawing as empty frames.
  const LIVE: ReadonlyArray<readonly [string, string]> = [
    ["1.1.225.2.1.9.0", "ground track/unit/combat/armor"],
    ["1.1.222.2.3.0.0", "ground track/unit/combat/armor"],
    ["1.1.222.2.13.1.0", "ground track/unit/combat/armor"],
    ["1.1.222.4.29.0.0", "ground track/unit/combat/field artillery"],
    ["1.1.222.4.48.0.0", "ground track/unit/combat/field artillery"],
    ["1.1.225.7.19.5.0", "ground track/unit/combat service support/transportation"],
    ["1.1.222.28.22.3.0", "ground track/unit/combat/air defense"],
    ["1.1.222.28.12.3.0", "ground track/unit/combat/air defense"],
    ["1.3.71.6.3.1.0", "sea surface track/combatant/line/frigate"],
    ["1.2.225.1.12.1.0", "air track/military/fixed wing/fighter"],
    ["3.1.222.11.5.10.76", "ground track/unit/combat/infantry"],
    ["3.1.225.11.5.42.76", "ground track/unit/combat/infantry"],
    ["3.1.225.12.35.0.0", "ground track/unit/combat/infantry"],
    ["9.1.222.2.2.3.0", "ground track/unit/combat support"],
  ];

  for (const [disType, nature] of LIVE) {
    it(`reads ${disType} as ${nature}`, () => {
      expect(natureFromDis(disType)).toBe(nature);
    });
  }

  it("gives every one of them a real function ID", () => {
    // The whole point: none of these may come back as dashes, which is what
    // milsymbol draws as an empty frame.
    for (const [disType] of LIVE) {
      const nature = natureFromDis(disType);
      expect(nature).not.toBeNull();
      expect(functionIdForNature(nature!)).not.toBe("------");
    }
  });
});

describe("every nature this module can return draws something", () => {
  // A nature that resolves to a function ID milsymbol has no icon for would
  // leave the symbol exactly as broken as it was, while looking mapped. This
  // walks the whole table rather than a sample, so adding a category that
  // happens to land on an undrawable code fails here rather than in front of an
  // analyst.
  it.each([...DIS_NATURES])("%s", (nature) => {
    const functionId = functionIdForNature(nature);
    expect(functionId).not.toBe("------");

    const sidc = buildSidc({
      name: "EntityId:1-100-1000",
      affiliation: "FRIEND",
      catalogue: { natureApp6: nature, echelonLevel: null },
    });

    expect(sidc.slice(4, 10)).toBe(functionId);
    expect(draw(sidc)).not.toBe(bareFrameOf(sidc));
  });
});

describe("natureFromDis — aircraft with a non-standard category", () => {
  it("still calls a military aircraft a military aircraft", () => {
    // The live feed's aircraft use category 50, which is not in SISO-REF-010.
    // The domain is still trustworthy, so the answer is vague rather than absent.
    expect(natureFromDis("1.2.225.50.34.1.0")).toBe("air track/military");
    expect(natureFromDis("1.2.101.50.8.0.0")).toBe("air track/military");
  });

  it("picks rotary wing out when the category does say so", () => {
    expect(natureFromDis("1.2.225.20.0.0.0")).toBe("air track/military/rotary wing");
  });
});

describe("natureFromDis — what it refuses", () => {
  it("does not interpret SWORD's non-standard kinds", () => {
    // 12 is not a DIS kind. SWORD uses it for aggregates, and the asset
    // catalogue — not this table — is authoritative for SWORD entities.
    expect(natureFromDis("12.1.225.3.2.0.0")).toBeNull();
  });

  it("does not give unit symbology to things that are not units", () => {
    expect(natureFromDis("2.1.225.1.1.0.0")).toBeNull(); // munition
    expect(natureFromDis("6.1.225.1.0.0.0")).toBeNull(); // supply
    expect(natureFromDis("8.1.225.1.0.0.0")).toBeNull(); // expendable
  });

  it("guesses nothing about a ground platform of unknown category", () => {
    // A land platform could be a tank or a fuel truck; there is no honest
    // generic between them, so it keeps its bare frame.
    expect(natureFromDis("1.1.225.99.0.0.0")).toBeNull();
  });

  it("handles absent and malformed codes without throwing", () => {
    expect(natureFromDis(null)).toBeNull();
    expect(natureFromDis(undefined)).toBeNull();
    expect(natureFromDis("")).toBeNull();
    expect(natureFromDis("   ")).toBeNull();
    expect(natureFromDis("1.1.225")).toBeNull();
    expect(natureFromDis("not.a.dis.code")).toBeNull();
  });
});

describe("buildSidc with no catalogue entry", () => {
  it("draws a real symbol for a live entity the catalogue cannot name", () => {
    // This is the regression. `EntityId:1-100-1016` resolves to nothing by
    // name, and before the DIS fallback produced "SFGP------*****" — a frame
    // with no icon in it.
    const sidc = buildSidc({
      name: "EntityId:1-100-1016",
      affiliation: "FRIEND",
      disType: "1.1.222.28.22.3.0",
      catalogue: null,
    });

    expect(sidc.slice(4, 10)).toBe("UCD---"); // air defence
    expect(sidc.slice(0, 4)).toBe("SFGP"); // friendly ground, present
  });

  it("draws infantry for a dismounted life form", () => {
    const sidc = buildSidc({
      name: "HLA.Human3123",
      affiliation: "HOSTILE",
      disType: "3.1.222.11.5.10.76",
      catalogue: null,
    });

    expect(sidc.slice(4, 10)).toBe("UCI---");
    expect(sidc.slice(0, 4)).toBe("SHGP");
  });

  it("still prefers the catalogue when it has an answer", () => {
    // A SWORD entity whose DIS code is meaningless must keep the catalogue's
    // nature, not acquire a wrong one from its entity type.
    const sidc = buildSidc({
      name: "ARMOR.Heavy tank platoon [265]_309",
      affiliation: "FRIEND",
      disType: "1.2.225.1.12.1.0", // would read as a fighter on its own
      catalogue: { natureApp6: "ground track/unit/combat/armor", echelonLevel: null },
    });

    expect(sidc.slice(4, 10)).toBe("UCA---"); // armour, from the catalogue
    expect(sidc[2]).toBe("G"); // and a ground frame, not an air one
  });

  it("leaves a bare frame when nothing can say what the entity is", () => {
    const sidc = buildSidc({
      name: "HLA.Aircraft102",
      affiliation: "FRIEND",
      disType: "12.9.0.0.0.0.0",
      catalogue: null,
    });

    expect(sidc.slice(4, 10)).toBe("------");
  });
});
