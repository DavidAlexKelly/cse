import { describe, expect, it } from "vitest";
import { battleDimension, isOrbatEligible, orbatIneligibleReason } from "./eligibility";

// Fixtures are the real placements from Operation BALTIC SHIELD phase 1
// (NxgPhaseMapState.startStateMapJson for obs_phase_01) — 19 units, of which
// three are naval and one is a satellite.
const BALTIC_SHIELD_PHASE_1 = [
  { templateId: "amphibious", label: "Amphibious Ready Group", sidc: "SFSPCLAM---H---" },
  { templateId: "destroyer", label: "DD Escort (North)", sidc: "SFSPCLDD-------" },
  { templateId: "destroyer", label: "DD Escort (Port Approaches)", sidc: "SFSPCLDD-------" },
  { templateId: "recce-ground-sensor", label: "CA / Port ISR", sidc: "SFGPUUR----E---" },
  { templateId: "logistics", label: "Port of Entry - Reception", sidc: "SFGPUSS----F---" },
  { templateId: "mech-infantry", label: "1 Mech Bn (West)", sidc: "SFGPUCIZ---F---" },
  { templateId: "logistics", label: "CSS Logistics Hub", sidc: "SFGPUSS----F---" },
  { templateId: "mech-infantry", label: "2 Mech Bn (Centre)", sidc: "SFGPUCIZ---F---" },
  { templateId: "armour", label: "3 Armd Bn (Reserve)", sidc: "SFGPUCA----F---" },
  { templateId: "logistics", label: "CSS Forward Staging Area", sidc: "SFGPUSS----F---" },
  { templateId: "air-defence-sam", label: "AD Bty (Corridor Cover)", sidc: "SFGPUCDM---E---" },
  { templateId: "satellite-isr", label: "Adversary ISR Satellite", sidc: "SHPPSS---------" },
  { templateId: "coastal-defence-missile", label: "BASTION-P Coastal Defence", sidc: "SHGPUCFC---E---" },
  { templateId: "rocket-artillery", label: "Long-Range Artillery", sidc: "SHGPUCFR---H---" },
  { templateId: "srbm", label: "ISKANDER-M SRBM BDE", sidc: "SHGPUCFS---H---" },
  { templateId: "air-defence-sam", label: "S-400 SAM BDE", sidc: "SHGPUCDM---H---" },
  // NB: this templateId really is malformed in the seeded data — the pipe means
  // no archetype matches, so the dimension has to come from the SIDC.
  { templateId: "cyber|-ew", label: "EW BATTALION", sidc: "SHGPUSC----F---" },
  { templateId: "motor-rifle", label: "22nd AC MRBDE", sidc: "SHGPUCIM---H---" },
  { templateId: "motor-rifle", label: "1st GMRD MRBDE", sidc: "SHGPUCIM---H---" },
];

describe("battleDimension", () => {
  it("reads the dimension from the archetype behind the templateId", () => {
    expect(battleDimension({ templateId: "destroyer", sidc: "" })).toBe("S");
    expect(battleDimension({ templateId: "satellite-isr", sidc: "" })).toBe("P");
    expect(battleDimension({ templateId: "mech-infantry", sidc: "" })).toBe("G");
  });

  it("accepts the flat UNIT_TEMPLATES id form", () => {
    expect(battleDimension({ templateId: "destroyer__Vessel" })).toBe("S");
  });

  it("falls back to SIDC position 3 when the templateId resolves to nothing", () => {
    expect(battleDimension({ templateId: "cyber|-ew", sidc: "SHGPUSC----F---" })).toBe("G");
    expect(battleDimension({ templateId: "not-a-template", sidc: "SFSPCLDD-------" })).toBe("S");
  });

  it("returns null when neither source resolves", () => {
    expect(battleDimension({ templateId: "nope", sidc: "" })).toBeNull();
  });
});

describe("isOrbatEligible", () => {
  it("keeps the 15 land units of BALTIC SHIELD phase 1 and drops the 4 others", () => {
    const eligible = BALTIC_SHIELD_PHASE_1.filter(isOrbatEligible).map((u) => u.label);
    const excluded = BALTIC_SHIELD_PHASE_1.filter((u) => !isOrbatEligible(u)).map((u) => u.label);

    expect(excluded).toEqual([
      "Amphibious Ready Group",
      "DD Escort (North)",
      "DD Escort (Port Approaches)",
      "Adversary ISR Satellite",
    ]);
    expect(eligible).toHaveLength(15);
  });

  it("excludes air platforms too, while ORBATs are land-only", () => {
    expect(isOrbatEligible({ templateId: "helo-attack" })).toBe(false);
  });

  it("treats an unresolvable unit as land rather than silently dropping it", () => {
    expect(isOrbatEligible({ templateId: "mystery", sidc: "" })).toBe(true);
  });
});

describe("orbatIneligibleReason", () => {
  it("names the unit and why it has no ORBAT", () => {
    expect(
      orbatIneligibleReason({ templateId: "destroyer", label: "DD Escort (North)" }),
    ).toContain("DD Escort (North) is a surface vessel");
  });

  it("is null for land units", () => {
    expect(orbatIneligibleReason({ templateId: "armour", label: "3 Armd Bn" })).toBeNull();
  });
});
