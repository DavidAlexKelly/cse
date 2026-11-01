// ── shared/hla/symbology/disNature.ts ──────────────────────────────────────
// APP-6 nature from a DIS entity type, for entities the catalogue cannot name.
//
// Why this exists
// ---------------
// buildSidc resolves what a unit *is* from the SWORD asset catalogue, keyed on
// the entity's name ("ARMOR.Heavy tank platoon [265]_309" → "Heavy tank
// platoon" → a nature path). That works for a SWORD federation and fails
// completely for anything else, because the fallback chain — catalogue, then
// base type, then name patterns, then SWORD family prefix — is name-based from
// end to end. With no nature, buildSidc emits "------" for the function ID and
// milsymbol draws a correctly shaped, correctly coloured, completely empty
// frame.
//
// That is exactly what the live federation looks like. Its entities are named
// `EntityId:1-100-1016`, `HLA.GroundVehicle1104`, `HLA.Human3123` — no asset
// type in them at all — so every symbol on the live map is a bare outline,
// while the mock laydown looks right because its seeds carry natureApp6
// explicitly.
//
// What is left to go on
// ---------------------
// Not symbol_id: the column exists and analysisScreen selects it, but it is the
// empty string or null on all 35.7M rows of the tracks dataset — a filter for
// anything else returns nothing at all. It cannot be relied on until the bridge
// starts populating it, and if it ever does it should be preferred over
// everything here.
//
// dis_type, on the other hand, is populated on 34.5M of those rows and is real:
// `1.1.225.2.1.9.0`, `3.1.222.11.5.10.76`, `1.3.71.6.3.1.0`. That is a genuine
// SISO-REF-010 enumeration — kind, domain, country, category, subcategory,
// specific, extra — and kind, domain and category between them say enough to
// pick a sensible symbol.
//
// How much is claimed
// -------------------
// Only what the standard actually pins down. An unmapped category returns null
// and keeps its bare frame rather than being guessed at: on a tactical display a
// confidently wrong symbol is worse than an obviously unresolved one, because
// nobody thinks to double-check a symbol that looks fine.
//
// This also has to stay defensive about SWORD, whose DIS codes are not standard
// at all (its "kind 12" is not a DIS kind, and one code covers both a tank
// platoon and an AEW&C aircraft — see app6.ts). Only the kinds below are
// mapped, so a SWORD code falls through to null and the catalogue keeps its
// authority over SWORD entities.

/** Land platform categories (kind 1, domain 1). */
const LAND_PLATFORM: Readonly<Record<number, string>> = {
  1: "ground track/unit/combat/armor", // tank
  2: "ground track/unit/combat/armor", // armoured fighting vehicle
  3: "ground track/unit/combat/infantry", // armoured utility — carries infantry
  4: "ground track/unit/combat/field artillery", // self-propelled artillery
  5: "ground track/unit/combat/field artillery", // towed artillery
  6: "ground track/unit/combat service support/transportation", // small wheeled utility
  7: "ground track/unit/combat service support/transportation", // large wheeled utility
  8: "ground track/unit/combat service support/transportation", // small tracked utility
  9: "ground track/unit/combat service support/transportation", // large tracked utility
  10: "ground track/unit/combat/field artillery", // mortar
  11: "ground track/unit/combat/engineer", // mine plough
  12: "ground track/unit/combat/engineer", // mine rake
  13: "ground track/unit/combat/engineer", // mine roller
  18: "ground track/unit/combat/engineer", // engineer equipment
  28: "ground track/unit/combat/air defense", // air / missile defence equipment
};

/** Air platform categories (kind 1, domain 2). */
const AIR_PLATFORM: Readonly<Record<number, string>> = {
  1: "air track/military/fixed wing/fighter",
  2: "air track/military/fixed wing", // attack / strike
  3: "air track/military/fixed wing/bomber",
  4: "air track/military/fixed wing", // cargo / tanker
  5: "air track/military/fixed wing", // ASW / patrol / observation
  6: "air track/military/fixed wing", // electronic warfare
  7: "air track/military/fixed wing", // reconnaissance
  8: "air track/military/fixed wing", // surveillance / C2
  20: "air track/military/rotary wing", // attack helicopter
  21: "air track/military/rotary wing", // utility helicopter
  22: "air track/military/rotary wing", // ASW / patrol helicopter
  23: "air track/military/rotary wing", // cargo helicopter
  24: "air track/military/rotary wing", // observation helicopter
  25: "air track/military/rotary wing", // special operations helicopter
};

/** Surface platform categories (kind 1, domain 3). */
const SURFACE_PLATFORM: Readonly<Record<number, string>> = {
  1: "sea surface track/combatant/line/carrier",
  3: "sea surface track/combatant/line/destroyer", // guided missile cruiser
  4: "sea surface track/combatant/line/destroyer", // guided missile destroyer
  5: "sea surface track/combatant/line/destroyer",
  6: "sea surface track/combatant/line/frigate", // guided missile frigate
  7: "sea surface track/combatant/line/frigate", // light / patrol craft
};

/**
 * The fallback for a platform in a domain we understand but a category we do
 * not.
 *
 * Deliberately vague, and deliberately only two domains. "A military aircraft"
 * and "a surface combatant" are safe claims about anything a federation is
 * tracking in those domains, and both resolve to a real function ID — which
 * matters here, because the live feed's aircraft use a category (50) that is
 * not in the standard at all.
 *
 * Land is absent on purpose: a ground platform of unknown category could as
 * easily be a supply truck as a tank, and there is no honest generic between
 * them.
 */
const DOMAIN_FALLBACK: Readonly<Record<number, string>> = {
  2: "air track/military",
  3: "sea surface track/combatant",
};

/** A person on the ground (kind 3, domain 1). */
const LIFE_FORM_NATURE = "ground track/unit/combat/infantry";

/** A sensor or emitter on the ground (kind 9, domain 1). */
const SENSOR_NATURE = "ground track/unit/combat support";

/**
 * Every nature path this module can return.
 *
 * Exported for the tests, which assert that each one resolves to a function ID
 * that milsymbol actually draws something for. A nature that renders as a bare
 * frame would leave the symbol exactly as broken as it was before, while
 * looking mapped — so the guarantee is worth holding mechanically rather than
 * by eye.
 */
export const DIS_NATURES: readonly string[] = [
  ...new Set([
    ...Object.values(LAND_PLATFORM),
    ...Object.values(AIR_PLATFORM),
    ...Object.values(SURFACE_PLATFORM),
    ...Object.values(DOMAIN_FALLBACK),
    LIFE_FORM_NATURE,
    SENSOR_NATURE,
  ]),
];

/**
 * The APP-6 nature path a DIS entity type implies, or null when it implies
 * nothing worth drawing.
 *
 * Format is `kind.domain.country.category.subcategory.specific.extra`; only the
 * first, second and fourth fields are read.
 */
export function natureFromDis(disType: string | null | undefined): string | null {
  const raw = String(disType ?? "").trim();
  if (raw === "") return null;

  const parts = raw.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length < 4 || parts.some((part) => !Number.isFinite(part))) return null;

  const [kind, domain, , category] = parts;

  switch (kind) {
    // Platform.
    case 1:
      if (domain === 1) return LAND_PLATFORM[category] ?? null;
      if (domain === 2) return AIR_PLATFORM[category] ?? DOMAIN_FALLBACK[2];
      if (domain === 3) return SURFACE_PLATFORM[category] ?? DOMAIN_FALLBACK[3];
      // Subsurface and space platforms: the dimension is already right from the
      // DIS domain, and the function-ID table has no entries for either, so
      // there is nothing useful to add.
      return null;

    // Life form. Domain 1 is a person on the ground, which is infantry for
    // symbol purposes whatever they are carrying — the subcategory encodes the
    // weapon, not the role.
    case 3:
      return domain === 1 ? LIFE_FORM_NATURE : null;

    // Sensor or emitter. Generic combat support rather than military
    // intelligence: a radar on the ground might be an air-defence,
    // artillery-locating or ISTAR asset, and the code does not say which.
    case 9:
      return domain === 1 ? SENSOR_NATURE : null;

    // Munitions, environmentals, cultural features, supplies, radios and
    // expendables are not units and should not be given unit symbology.
    // SWORD's non-standard kinds land here too, which is what keeps the
    // catalogue authoritative for SWORD entities.
    default:
      return null;
  }
}

export default natureFromDis;
