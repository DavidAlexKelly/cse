// ── hlamap/symbology/rollup.test.ts ────────────────────────────────────────
// The fixtures below are real rows from the HLA track stream, coordinates
// unrounded, not invented ones. The roll-up is pure geometry against thresholds
// tuned to how SWORD actually lays a formation out, so a test built on
// plausible-looking made-up positions would prove nothing.

import { describe, expect, it } from "vitest";
import { planRollup, type RollupCandidate } from "./rollup";

interface Unit extends RollupCandidate {
  name: string;
}

const nameOf = (unit: Unit) => unit.name;

/**
 * One armoured company as the federation publishes it: the company aggregate,
 * a command post on its exact coordinates, four tank platoons and a support
 * section, all inside about 250 m.
 */
const ARMOURED_COMPANY: Unit[] = [
  { id: "335", name: "SWORD_74450030_ARMOR.Armored company CP [298]_335", lat: 58.42666, lon: 24.45757 },
  { id: "340", name: "SWORD_74450030_ARMOR.Armored direct support section [303]_340", lat: 58.42696, lon: 24.45595 },
  { id: "334", name: "SWORD_74450030_ARMOR.Medium tank company [297]_334", lat: 58.42666, lon: 24.45757 },
  { id: "336", name: "SWORD_74450030_ARMOR.Medium tank platoon [299]_336", lat: 58.42756, lon: 24.4576 },
  { id: "337", name: "SWORD_74450030_ARMOR.Medium tank platoon [300]_337", lat: 58.42693, lon: 24.45921 },
  { id: "338", name: "SWORD_74450030_ARMOR.Medium tank platoon [301]_338", lat: 58.42593, lon: 24.45855 },
  { id: "339", name: "SWORD_74450030_ARMOR.Medium tank platoon [302]_339", lat: 58.42595, lon: 24.45653 },
];

/** A second, unrelated company ~25 km away — it must never merge with the first. */
const MECHANISED_COMPANY: Unit[] = [
  { id: "483", name: "SWORD_74450030_INF.Mechanised company [425]_483", lat: 58.53313, lon: 24.12097 },
  { id: "484", name: "SWORD_74450030_INF.Company CP [426]_484", lat: 58.53313, lon: 24.12097 },
  { id: "486", name: "SWORD_74450030_INF.Mechanised platoon [428]_486", lat: 58.53339, lon: 24.12261 },
  { id: "487", name: "SWORD_74450030_INF.Mechanised platoon [429]_487", lat: 58.53239, lon: 24.12196 },
  { id: "488", name: "SWORD_74450030_INF.Mechanised platoon [430]_488", lat: 58.53241, lon: 24.11994 },
  { id: "485", name: "SWORD_74450030_INF.Mortar section [427]_485", lat: 58.53403, lon: 24.12099 },
  { id: "489", name: "SWORD_74450030_INF.Anti-tank section [431]_489", lat: 58.53342, lon: 24.11934 },
];

/** Platform tracks: no echelon in the name, no formation to belong to. */
const PLATFORMS: Unit[] = [
  { id: "149", name: "Aircraft carrier_149", lat: 58.9, lon: 22.4 },
  { id: "1103", name: "HLA.Aircraft1103", lat: 58.43, lon: 24.46 },
];

const idsOf = (plan: { entity: Unit }[]) => plan.map((r) => r.entity.id).sort();

describe("planRollup", () => {
  it("draws one symbol for a company at the zoom the map opens on", () => {
    const plan = planRollup(ARMOURED_COMPANY, nameOf, 11);

    expect(plan).toHaveLength(1);
    const [company] = plan;
    expect(company.entity.id).toBe("334"); // the company aggregate, not the CP
    // Four platoons and the support section; the CP is not counted, it is
    // represented by the staff on the frame instead.
    expect(company.rolledUp).toHaveLength(5);
    expect(company.headquarters).toBe(true);
  });

  it("does not fold anything back out when zoomed further out", () => {
    // Regression: below zoom 11 the company is itself a roll-up candidate, so
    // it was missing from the anchor set and its platoons all drew themselves —
    // the wide view came out busier than the close one.
    const wide = planRollup(ARMOURED_COMPANY, nameOf, 9);
    const mid = planRollup(ARMOURED_COMPANY, nameOf, 11);

    expect(wide.length).toBeLessThanOrEqual(mid.length);
    expect(idsOf(wide)).toEqual(["334"]);
  });

  it("shows the subordinates once they can be told apart", () => {
    const plan = planRollup(ARMOURED_COMPANY, nameOf, 13);

    // Everything except the command post, which is drawn on top of its company
    // at every zoom and can never be seen or clicked on its own.
    expect(idsOf(plan)).toEqual(["334", "336", "337", "338", "339", "340"]);
    const company = plan.find((r) => r.entity.id === "334");
    expect(company?.headquarters).toBe(true);
    expect(company?.rolledUp).toHaveLength(0);
  });

  it("keeps formations 25 km apart separate", () => {
    const plan = planRollup([...ARMOURED_COMPANY, ...MECHANISED_COMPANY], nameOf, 11);

    expect(idsOf(plan)).toEqual(["334", "483"]);
    for (const formation of plan) {
      expect(formation.rolledUp).toHaveLength(5);
      expect(formation.headquarters).toBe(true);
    }
  });

  it("never hides a track that has no echelon", () => {
    // Ships, aircraft and the drone mockups are not part of a ground formation.
    // The aircraft here sits directly over the armoured company and must still
    // draw: it is not one of its platoons.
    const plan = planRollup([...ARMOURED_COMPANY, ...PLATFORMS], nameOf, 9);

    expect(idsOf(plan)).toEqual(["1103", "149", "334"]);
  });

  it("keeps the selected unit on the map", () => {
    // A platoon that vanishes when the map is nudged, while the command panel
    // still shows it, reads as a bug rather than as a level of detail.
    const plan = planRollup(ARMOURED_COMPANY, nameOf, 11, { pinnedId: "338" });

    expect(idsOf(plan)).toContain("338");
    expect(plan.find((r) => r.entity.id === "334")?.rolledUp).toHaveLength(4);
  });

  it("draws everything while a fire mission is picking a target", () => {
    const plan = planRollup(ARMOURED_COMPANY, nameOf, 11, { disabled: true });

    expect(plan).toHaveLength(ARMOURED_COMPANY.length);
    // Including the command post: hidden here would mean untargetable.
    expect(idsOf(plan)).toContain("335");
  });

  it("gives a command post its own marker once it leaves its formation", () => {
    const detached = ARMOURED_COMPANY.map((unit) =>
      unit.id === "335" ? { ...unit, lat: 58.4, lon: 24.4 } : unit
    );
    const plan = planRollup(detached, nameOf, 13);

    expect(idsOf(plan)).toContain("335");
    expect(plan.find((r) => r.entity.id === "334")?.headquarters).toBe(false);
  });
});
