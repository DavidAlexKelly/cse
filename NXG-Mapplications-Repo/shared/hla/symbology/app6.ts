// ── shared/hla/symbology/app6.ts ───────────────────────────────────────────────
// Build APP-6 / MIL-STD-2525C SIDCs for HLA entities, for milsymbol to render.
//
// Why not from the DIS entity type — for SWORD
// --------------------------------------------
// The obvious route — DIS kind.domain.country.category.subcategory → symbol —
// does not work against a SWORD federation, and the stream proves it:
//
//   * SWORD emits kind 12, which is not a DIS kind at all (1–11 are defined).
//     Empirically it marks aggregates: 12.1.225.3.2.0.0 is "ARMOR.Heavy tank
//     company" while 1.1.225.3.2.0.0 is "ARMOR.Heavy tank platoon".
//   * The same code is reused across unrelated things: 1.1.225.3.2.0.0 covers
//     both a heavy tank platoon and an "AEW&C aircraft".
//
// So any table derived from SISO-REF-010 would mismap SWORD however correct the
// table is. What *is* authoritative for SWORD is the [NXG-O] Sword Asset
// Catalogue, which carries an APP-6 nature path per asset type — "ground track/
// unit/combat/armor/wheeled" — plus SWORD's echelon notation. This module maps
// that path to a SIDC; useSwordCatalogue looks the path up by entity name.
//
// …and why from DIS for everything else
// -------------------------------------
// That reasoning was written against SWORD and then applied to the whole feed,
// which was a mistake. The catalogue is keyed on the asset type inside a SWORD
// name, so for a federation that does not publish SWORD names it can never
// match — and the live federation publishes `EntityId:1-100-1016`,
// `HLA.GroundVehicle1104`, `HLA.Human3123`. Every one of those fell through the
// entire name-based chain to a "------" function ID, which milsymbol draws as a
// correctly shaped, completely empty frame. That is what the live map was: all
// outlines, no icons.
//
// Those entities do publish honest DIS, so symbology/disNature reads a nature
// from it — guarded so that SWORD's non-standard kinds still fall through and
// the catalogue keeps its authority. The catalogue is still tried first.
//
// On confidence
// -------------
// 2525C function IDs are hierarchical and dash-padded, so a *parent* code is
// always a valid symbol — just less specific. Where the exact leaf code is not
// certain, this table deliberately emits the nearest ancestor rather than a
// guess: a correct armour icon beats a wrong "armoured wheeled recovery
// vehicle" icon, and both beat a symbol milsymbol cannot parse. Nature paths
// with no sensible warfighting equivalent (the civil "emergency/*" family, which
// belongs to a different 2525C scheme entirely) render as a bare frame of the
// right affiliation and dimension.

import { natureFromDis } from "./disNature";

export type Affiliation = "FRIEND" | "HOSTILE" | "NEUTRAL" | "UNKNOWN";

/** What the catalogue tells us about an asset type. */
export interface CatalogueEntry {
  /** APP-6 nature path, e.g. "ground track/unit/combat/armor/wheeled". */
  natureApp6?: string | null;
  /** SWORD echelon notation: o, oo, ooo, i, ii, iii, none. */
  echelonLevel?: string | null;
}

const AFFILIATION_CODE: Record<Affiliation, string> = {
  FRIEND: "F",
  HOSTILE: "H",
  NEUTRAL: "N",
  UNKNOWN: "U",
};

/** Battle dimension (SIDC position 3) from the root of the nature path. */
function dimensionFromNature(nature: string): string | null {
  if (nature.startsWith("ground track")) return "G";
  if (nature.startsWith("air track")) return "A";
  if (nature.startsWith("sea surface track")) return "S";
  if (nature.startsWith("subsurface")) return "U";
  if (nature.startsWith("space track")) return "P";
  return null;
}

/** Battle dimension from the DIS domain field, used when there is no catalogue hit. */
function dimensionFromDis(disType: string | undefined): string {
  const domain = (disType ?? "").split(".")[1];
  switch (domain) {
    case "1":
      return "G";
    case "2":
      return "A";
    case "3":
      return "S";
    case "4":
      return "U";
    case "5":
      return "P";
    default:
      return "Z"; // unknown dimension — milsymbol draws the "unknown" frame
  }
}

/**
 * Nature path prefix → 2525C function ID (SIDC positions 5–10).
 *
 * Ordered longest-prefix-first; the first match wins. Every entry below is
 * reachable from the 62 distinct nature paths present in the Sword Asset
 * Catalogue, so this table is derived from the data rather than from the
 * standard's full tree.
 */
const FUNCTION_IDS: ReadonlyArray<readonly [string, string]> = [
  // ── Ground, combat ──────────────────────────────────────────────────────
  ["ground track/unit/combat/anti armor", "UCAA--"],
  ["ground track/unit/combat/armor", "UCA---"],
  ["ground track/unit/combat/infantry", "UCI---"],
  ["ground track/unit/combat/reconnaissance", "UCR---"],
  ["ground track/unit/combat/aviation/rotary wing", "UCVR--"],
  // UAV sits under aviation; the leaf code is not certain, so stop at aviation.
  ["ground track/unit/combat/aviation", "UCV---"],
  ["ground track/unit/combat/field artillery", "UCF---"],
  ["ground track/unit/combat/air defense", "UCD---"],
  ["ground track/unit/combat/engineer", "UCE---"],
  // Internal security forces have no clean warfighting equivalent; generic combat.
  ["ground track/unit/combat/internal security forces", "UC----"],
  ["ground track/unit/combat", "UC----"],

  // ── Ground, combat support ──────────────────────────────────────────────
  ["ground track/unit/combat support/signal unit", "UUS---"],
  ["ground track/unit/combat support/military intelligence", "UUM---"],
  ["ground track/unit/combat support/nbc", "UUA---"],
  ["ground track/unit/combat support", "UU----"],

  // ── Ground, combat service support ──────────────────────────────────────
  ["ground track/unit/combat service support/supply", "USS---"],
  ["ground track/unit/combat service support/maintenance", "USM---"],
  ["ground track/unit/combat service support/transportation", "UST---"],
  // Medical and mortuary leaves are uncertain — generic CSS rather than a guess.
  ["ground track/unit/combat service support", "US----"],

  // ── Air ─────────────────────────────────────────────────────────────────
  ["air track/military/fixed wing/bomber", "MFB---"],
  ["air track/military/fixed wing/fighter", "MFF---"],
  ["air track/military/fixed wing", "MF----"],
  ["air track/military/rotary wing", "MH----"],
  ["air track/military", "M-----"],

  // ── Sea surface ─────────────────────────────────────────────────────────
  ["sea surface track/combatant/line/carrier", "CLCV--"],
  ["sea surface track/combatant/line/destroyer", "CLDD--"],
  ["sea surface track/combatant/line/frigate", "CLFF--"],
  ["sea surface track/combatant/line", "CL----"],
  ["sea surface track/combatant", "C-----"],
  ["sea surface track/non military", "N-----"],

  // "ground track/unit/emergency/*" is deliberately absent: those are civil
  // responders, which 2525C places in the Emergency Management scheme rather
  // than Warfighting. They fall through to a bare frame.
];

/**
 * Longest prefix first.
 *
 * Written order is not enough: "ground track/unit/combat support/signal unit"
 * also starts with "ground track/unit/combat", so a table read top-to-bottom
 * classified every combat-support and CSS unit as generic combat. Sorting by
 * length makes the table order-insensitive, so adding an entry later cannot
 * silently shadow another.
 */
const FUNCTION_IDS_BY_SPECIFICITY = [...FUNCTION_IDS].sort(
  (a, b) => b[0].length - a[0].length
);

/** The 6-character function ID for a nature path, or dashes when unmapped. */
export function functionIdForNature(nature: string): string {
  const path = nature.trim().toLowerCase();
  for (const [prefix, functionId] of FUNCTION_IDS_BY_SPECIFICITY) {
    if (path.startsWith(prefix)) return functionId;
  }
  return "------";
}

/**
 * SWORD echelon notation → 2525C echelon (SIDC position 12).
 *
 * SWORD writes echelon as repeated glyphs: "o"/"oo"/"ooo" for the small
 * echelons and "i"/"ii"/"iii" for the larger ones. The catalogue pairs them with
 * names — "Firefinder radar section" is o, "Anti-tank platoon" oo, "Engineer
 * company" ooo, "Brigade support battalion CT" i, "Battle group CP" ii, "Major
 * units CP" iii — which is what this mapping follows. Note SWORD is loose about
 * it: "Anti-tank section" is also oo, so section and platoon share a code.
 */
export function echelonCode(swordEchelon: string | null | undefined): string {
  switch ((swordEchelon ?? "").trim().toLowerCase()) {
    case "o":
      return "B"; // squad
    case "oo":
      return "D"; // platoon / detachment
    case "ooo":
      return "E"; // company / battery / troop
    case "i":
      return "F"; // battalion / squadron
    case "ii":
      return "H"; // brigade
    case "iii":
      return "I"; // division
    default:
      return "-";
  }
}

/**
 * Whether this is a headquarters, which 2525C shows as a staff on the frame
 * (SIDC position 11).
 *
 * SWORD names command posts explicitly — "INF.Company CP [419]", "Battle group
 * CP" — and the catalogue marks their nature as a signal unit doing "command
 * operations".
 */
export function isHeadquarters(name: string, nature: string): boolean {
  return containsWord(name, "cp") || nature.toLowerCase().includes("command operations");
}

/** Whether a character would be part of a word, for containsWord below. */
function isWordCharacter(character: string): boolean {
  return (
    character !== "" &&
    ((character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9") ||
      character === "_")
  );
}

/**
 * Whether `word` appears in `text` as a word of its own, case-insensitively.
 *
 * A scan rather than the obvious /\bcp\b/i: the code scanner blocks any regex
 * tested against a value from outside the app, and these names come off the
 * federation. The regex was harmless, but this is not worth a suppression when
 * an indexOf loop says the same thing and cannot backtrack at all.
 */
function containsWord(text: string, word: string): boolean {
  const haystack = text.toLowerCase();
  for (let from = 0; from <= haystack.length - word.length; ) {
    const at = haystack.indexOf(word, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : haystack.charAt(at - 1);
    const after = haystack.charAt(at + word.length);
    if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
    from = at + 1;
  }
  return false;
}

// ── Resolving an entity name to a catalogue row ─────────────────────────────
//
// The catalogue lists *parent* types only. It has "rifle company", "heavy tank
// company", "mechanised company", "mortar firing battery" — and no "rifle
// platoon", "heavy tank platoon" or "company CP", which is most of what the
// federation actually publishes. Matching on the full name alone therefore
// missed the majority of entities and drew bare frames.
//
// The resolution below separates the two questions a symbol answers. *What it
// is* comes from the type family, which the parent row supplies; *how big it is*
// comes from the echelon word in the entity's own name. A "Heavy tank platoon"
// is armour (from "Heavy tank company") drawn at platoon echelon — which is both
// correct and what an operator expects.

/** Echelon words as they appear in SWORD names → 2525C echelon. */
const NAME_ECHELONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bteams?\b|\bcrews?\b/i, "A"],
  [/\bsquads?\b/i, "B"],
  [/\bsections?\b/i, "C"],
  [/\bplatoons?\b|\bdetachments?\b|\bflights?\b/i, "D"],
  [/\bcompan(y|ies)\b|\bbatter(y|ies)\b|\btroops?\b/i, "E"],
  [/\bbattalions?\b|\bsquadrons?\b/i, "F"],
  [/\bregiments?\b|\bgroups?\b/i, "G"],
  [/\bbrigades?\b/i, "H"],
  [/\bdivisions?\b/i, "I"],
];

/** The echelon a name states, or "-" when it states none. */
export function echelonFromName(name: string): string {
  for (const [pattern, code] of NAME_ECHELONS) {
    if (pattern.test(name)) return code;
  }
  return "-";
}

/**
 * A name with its echelon, command-post and identifier noise removed, so that
 * "Heavy tank platoon" and "Heavy tank company" both reduce to "heavy tank".
 */
export function baseType(name: string): string {
  return (
    catalogueKey(name)
      .replace(
        /\b(teams?|crews?|squads?|sections?|platoons?|detachments?|flights?|compan(?:y|ies)|batter(?:y|ies)|troops?|battalions?|squadrons?|regiments?|groups?|brigades?|divisions?)\b/gi,
        " "
      )
      .replace(/\bcp\b|\bhq\b|\bct\b/gi, " ")
      // Punctuation and spacing are not agreed between the two systems: the
      // catalogue says "Anti-tank section", SWORD says "ARMOR.Antitank section".
      // Comparing on letters and digits alone makes them the same key.
      .replace(/[^a-z0-9]+/g, "")
  );
}

/**
 * SWORD's functional prefix → nature, for entities with no catalogue row at all.
 *
 * Names are family-prefixed — "INF.Company CP [419]", "ARMOR.Scout section",
 * "AAA.Surface to air battery CP", "LOG.Combat train" — so even an unlisted type
 * still says what branch it belongs to. Coarse, but a correct infantry or
 * artillery icon beats an empty frame.
 */
const FAMILY_NATURES: Readonly<Record<string, string>> = {
  INF: "ground track/unit/combat/infantry",
  ARMOR: "ground track/unit/combat/armor",
  ARMOUR: "ground track/unit/combat/armor",
  ART: "ground track/unit/combat/field artillery",
  AAA: "ground track/unit/combat/air defense",
  LOG: "ground track/unit/combat service support",
  ENG: "ground track/unit/combat/engineer",
  RECO: "ground track/unit/combat/reconnaissance",
};

/**
 * Platform names → nature, for the ships and aircraft the catalogue does not
 * list.
 *
 * The catalogue covers naval and air *formations* — "Task group", "Carrier
 * strike group", "Support group", "Bomber flight" — while the federation
 * publishes individual platforms: "Aircraft carrier_149", "Multi-mission
 * frigate_97", "Fighter jet 2_140". Those have no catalogue row and no family
 * prefix, so without this they resolved to nothing.
 *
 * This also has to override the DIS fallback rather than sit behind it, because
 * the DIS domain is wrong for exactly these entities: "AEW&C aircraft" is
 * published as 1.1.225.3.2.0.0, domain 1 = land, which drew an aircraft as a
 * ground rectangle.
 *
 * Sea is tested before air deliberately: "Air defense destroyer" is a ship.
 * Terms are specific for the same reason — "air" alone would capture "Surface to
 * air battery", which is a ground air-defence unit.
 */
const NAME_NATURES: ReadonlyArray<readonly [RegExp, string]> = [
  // ── Sea surface ─────────────────────────────────────────────────────────
  [/\bcarriers?\b/i, "sea surface track/combatant/line/carrier"],
  [/\bdestroyers?\b/i, "sea surface track/combatant/line/destroyer"],
  [/\bfrigates?\b|\bcorvettes?\b/i, "sea surface track/combatant/line/frigate - corvette"],
  [/\blanding crafts?\b/i, "sea surface track/combatant/amphibious warfare ship/landing craft"],
  [/\bamphibious\b/i, "sea surface track/combatant/amphibious warfare ship/assault vessel"],
  [/\btrawlers?\b|\bfishing\b/i, "sea surface track/non military/fishing/trawler"],
  [/\bmerchants?\b|\bcargo ships?\b|\bcivilian ships?\b/i, "sea surface track/non military/merchant/cargo"],
  [/\bcruisers?\b|\bpatrol boats?\b|\bwarships?\b/i, "sea surface track/combatant"],
  // ── Air ─────────────────────────────────────────────────────────────────
  [/\bbombers?\b/i, "air track/military/fixed wing/bomber"],
  [/\bfighters?\b|\bfighter jets?\b|\bjets?\b/i, "air track/military/fixed wing/fighter"],
  [/\bhelicopters?\b|\bhelos?\b|\brotary\b/i, "air track/military/rotary wing"],
  [/\baew\b|\bawacs\b|\bearly warning\b|\bpatrol aircraft\b|\bsurveillance aircraft\b/i,
    "air track/military/fixed wing/reconnaissance"],
  [/\buavs?\b|\bdrones?\b|\bunmanned\b/i, "air track/military/fixed wing"],
  [/\baircrafts?\b|\bairplanes?\b/i, "air track/military/fixed wing"],
];

/**
 * The nature a platform-style name implies, if any.
 *
 * Matched against the cleaned name rather than the raw one: SWORD appends an
 * instance id with an underscore, and `_` is a word character, so "\bcarrier\b"
 * does not match "Aircraft carrier_149" while it does match "Bomber 1_115" —
 * which had ships silently falling through to the DIS fallback while aircraft
 * classified correctly.
 */
export function natureFromName(name: string): string | null {
  const cleaned = catalogueKey(name);
  for (const [pattern, nature] of NAME_NATURES) {
    if (pattern.test(cleaned)) return nature;
  }
  return null;
}

/** The family prefix of a SWORD name, e.g. "ARMOR" in "ARMOR.Scout section". */
export function familyPrefix(name: string): string | null {
  const match = /^(?:SWORD_\d+_)?([A-Z]{2,})\./.exec(name.trim());
  return match ? match[1] : null;
}

/** Catalogue rows indexed for exact-name and base-type lookup. */
export interface CatalogueIndex {
  byName: Map<string, CatalogueEntry>;
  byBase: Map<string, CatalogueEntry>;
}

export function buildCatalogueIndex(
  rows: ReadonlyArray<{ name?: string | null; displayName?: string | null } & CatalogueEntry>
): CatalogueIndex {
  const byName = new Map<string, CatalogueEntry>();
  const byBase = new Map<string, CatalogueEntry>();

  for (const row of rows) {
    const entry: CatalogueEntry = {
      natureApp6: row.natureApp6,
      echelonLevel: row.echelonLevel,
    };
    for (const candidate of [row.name, row.displayName]) {
      if (!candidate) continue;
      const key = catalogueKey(candidate);
      if (key && !byName.has(key)) byName.set(key, entry);
      const base = baseType(candidate);
      // First writer wins: rows are alphabetical, and any row of a family
      // carries the same nature, which is all the base index is consulted for.
      if (base && !byBase.has(base)) byBase.set(base, entry);
    }
  }

  return { byName, byBase };
}

/**
 * The catalogue entry for an entity name: exact match, then base type, then the
 * longest base-type prefix ("surface to air defense" resolves via "surface to
 * air"), then the SWORD family prefix.
 */
export function lookupCatalogue(index: CatalogueIndex, name: string): CatalogueEntry | null {
  const exact = index.byName.get(catalogueKey(name));
  if (exact) return exact;

  const base = baseType(name);
  if (base) {
    const direct = index.byBase.get(base);
    if (direct) return direct;

    // Containment in both directions, because neither system is consistently
    // the more specific one: the entity may extend a catalogue type ("surface to
    // air defense" over "surface to air"), or the catalogue may extend the
    // entity ("mortar firing" over "mortar"). Prefer the longest match when we
    // are the longer string, and the shortest when the catalogue is — both mean
    // "closest relative".
    let extendsCatalogue: { length: number; entry: CatalogueEntry } | null = null;
    let extendedByCatalogue: { length: number; entry: CatalogueEntry } | null = null;
    for (const [candidate, entry] of index.byBase) {
      if (candidate.length < 4) continue;
      if (base.startsWith(candidate)) {
        if (!extendsCatalogue || candidate.length > extendsCatalogue.length) {
          extendsCatalogue = { length: candidate.length, entry };
        }
      } else if (base.length >= 5 && candidate.startsWith(base)) {
        if (!extendedByCatalogue || candidate.length < extendedByCatalogue.length) {
          extendedByCatalogue = { length: candidate.length, entry };
        }
      }
    }
    if (extendsCatalogue) return extendsCatalogue.entry;
    if (extendedByCatalogue) return extendedByCatalogue.entry;
  }

  // Platform names the catalogue does not carry — ships and aircraft. Ahead of
  // the family prefix because these names have none, and ahead of the DIS
  // fallback in buildSidc because the DIS domain is wrong for them.
  const byName = natureFromName(name);
  if (byName) return { natureApp6: byName, echelonLevel: null };

  const family = familyPrefix(name);
  const nature = family ? FAMILY_NATURES[family.toUpperCase()] : undefined;
  return nature ? { natureApp6: nature, echelonLevel: null } : null;
}

export interface SidcInput {
  /** The entity's display name, e.g. "ARMOR.Heavy tank platoon [265]_309". */
  name: string;
  affiliation: Affiliation;
  /** DIS entity type, used only when the catalogue has nothing to say. */
  disType?: string;
  /** The matching catalogue row, when the name resolved to one. */
  catalogue?: CatalogueEntry | null;
  /**
   * Force the headquarters staff on (or off), overriding what the name implies.
   *
   * Set by the roll-up when a command post published at the formation's own
   * coordinates has been folded into it: the CP no longer has a marker, so the
   * formation carries the staff on its behalf — which is what APP-6 means by it
   * anyway.
   */
  headquarters?: boolean;
}

/**
 * A 15-character 2525C SIDC.
 *
 *   1     scheme            S = warfighting
 *   2     affiliation       F/H/N/U
 *   3     battle dimension  G/A/S/U/P/Z
 *   4     status            P = present
 *   5-10  function ID
 *   11    HQ / task force / dummy
 *   12    echelon
 *   13-14 country
 *   15    order of battle
 */
export function buildSidc(input: SidcInput): string {
  // The catalogue first, then the DIS entity type. Everything ahead of this
  // point is keyed on the entity's *name*, which only a SWORD federation
  // publishes usefully — the live feed names its entities `EntityId:1-100-1016`
  // and `HLA.Human3123`, so the whole name-based chain misses and every symbol
  // came out as an empty frame. DIS is the only thing those entities carry that
  // says what they are. See symbology/disNature.
  //
  // The obvious refinement — only read DIS when the name is not SWORD-shaped,
  // since SWORD's DIS is unreliable — does not work, and is worth not trying
  // again: the live entities are named `HLA.Human3123`, which has exactly the
  // same FAMILY-dot shape as `ARMOR.Heavy tank platoon`, so that test would
  // suppress the fallback for most of the entities it exists for. The guard is
  // in disNature instead, on the DIS kinds themselves.
  const nature =
    (input.catalogue?.natureApp6?.trim() || natureFromDis(input.disType)) ?? "";
  const dimension = (nature && dimensionFromNature(nature)) || dimensionFromDis(input.disType);
  const functionId = nature ? functionIdForNature(nature) : "------";
  const hq = (input.headquarters ?? isHeadquarters(input.name, nature)) ? "A" : "-";
  // The name's own echelon wins over the catalogue's: the row that supplied the
  // nature is often the parent type, so a "Heavy tank platoon" resolved through
  // "Heavy tank company" must not be drawn as a company.
  const fromName = echelonFromName(input.name);
  const echelon = fromName !== "-" ? fromName : echelonCode(input.catalogue?.echelonLevel);

  return (
    "S" +
    AFFILIATION_CODE[input.affiliation] +
    dimension +
    "P" +
    functionId +
    hq +
    echelon +
    "---"
  );
}

/**
 * The catalogue key for a SWORD entity name.
 *
 * Names arrive as `SWORD_<session>_<FAMILY>.<asset type> [<template id>]_<id>`,
 * for example `SWORD_1683271227_ARMOR.Heavy tank platoon [265]_309`. The
 * catalogue is keyed on the asset type alone — "Heavy tank platoon" — so the
 * session prefix, the family prefix and the trailing identifiers all come off.
 * Non-SWORD names (the drone mockups publish "HLA.Aircraft1103") simply will not
 * match, which is the intended outcome: they fall back to a DIS-derived frame.
 */
export function catalogueKey(name: string): string {
  return name
    .replace(/^SWORD_\d+_/, "")
    .replace(/\s*\[\d+\]_\d+\s*$/, "")
    .replace(/_\d+\s*$/, "")
    .replace(/^[A-Z]{2,}\.\s*/, "")
    .trim()
    .toLowerCase();
}
