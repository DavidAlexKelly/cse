// src/shared/orbat/swordFormations.ts
//
// Matching a generated ORBAT node to a SWORD formation.
//
// Doctrine-generated skeletons are organisations all the way down, and
// organisations resolve against SWORD. This module decides which SWORD
// formation a given node should be: an armoured "A Company" wants
// "ARMOR.Heavy tank company", a rifle platoon wants "INF.Rifle platoon".
//
// Two things about the catalogue drove this design, both checked against the
// data rather than assumed.
//
// 1. THE ECHELON GLYPH CANNOT BE TRUSTED.
//    NxgOSwordAssetCatalogue.echelonLevel holds SWORD's own glyph, and it does
//    not reliably encode the echelon:
//
//        ooo   ARMOR.Heavy tank company      ← company
//        ooo   ARMOR.Heavy tank platoon      ← platoon, same glyph
//        oo    ARMOR.Scout platoon           ← platoon, different glyph
//        oo    ARMOR.Antitank section        ← section
//        o     ART.Firefinder radar section  ← section, different again
//        none  AIR.Bomber section
//
//    Matching on the glyph would put company assets on platoons. The echelon
//    word inside the identifier is the reliable signal, so that is what is
//    parsed; the glyph is kept for display only.
//
// 2. THE IDENTIFIER ENCODES NATURE AND ROW TYPE.
//    "ARMOR.Heavy tank company|automat" is <nature>.<name>|<level>, where
//    level is "automat" (the formation SWORD orders, mostly companies) or
//    "unit" (what an automat is made of — platoons, sections, CPs).

/** The fields this module needs from a SWORD catalogue row. */
export interface OSwordFormationRow {
  identifier: string;
  displayName?: string;
  disCode?: string;
  echelonLevel?: string;
  /**
   * On an automat: what it is made of.
   *
   * Pipe-delimited, each entry "<name>#<min>#<max>" — a unit name plus the
   * min-occurs / max-occurs Automats.xml states for it. A bare "<name>" is
   * accepted too: the catalogue carried names alone until the transform was
   * taught to keep the counts, and a stale build must still parse.
   */
  constituentUnits?: string;
  /** On an automat: which constituent is its command post. */
  commandPostUnit?: string;
  /** On a unit: the equipment SWORD fills it with, e.g. "ARMOR.Main Battle Tank". */
  majorEquipmentType?: string;
  /** On a unit: how many of that equipment. Numeric, held as a string. */
  majorEquipmentCount?: string;
  /** On a unit: crew per item of that equipment. Numeric, held as a string. */
  requiredCrew?: string;
}

/** What SWORD puts inside one of its units. */
export interface SwordEquipment {
  /** SWORD's own equipment type, e.g. "ARMOR.Main Battle Tank". */
  type: string;
  /** How many. */
  count: number;
  /** Crew per item. */
  crewPerItem: number;
}

/** One entry in an automat's composition, before the name is resolved. */
export interface ConstituentSpec {
  /** Unit name as Automats.xml writes it, e.g. "ARMOR.Heavy tank platoon". */
  name: string;
  /** min-occurs. 1 when the catalogue does not say. */
  min: number;
  /** max-occurs. Falls back to min when absent — "at least n" becomes "n". */
  max: number;
}

/** A SWORD formation, parsed into the parts that matter for matching. */
export interface SwordFormation {
  /** Full catalogue identifier, e.g. "ARMOR.Heavy tank company|automat". */
  identifier: string;
  /** Human-readable name, for display. */
  displayName: string;
  /** Nature prefix: ARMOR, INF, ART, AAA, AAVN, LOG, NAVY, … */
  nature: string;
  /** Echelon word parsed from the name, lower case, or null when absent. */
  echelonWord: string | null;
  /** "automat" — the formation SWORD orders — or "unit", its constituents. */
  level: "automat" | "unit" | "other";
  /** Canonical asset key. Empty when this row cannot be linked. */
  disCode: string;
  /** SWORD's echelon glyph. Display only — see the note above. */
  echelonGlyph: string;
  /** On an automat: its constituents, in catalogue order. Empty on a unit. */
  constituents: ConstituentSpec[];
  /** On an automat: the name of its command post. "" when none is marked. */
  commandPostUnit: string;
  /** On a unit: what SWORD fills it with. Null for single-platform units. */
  equipment: SwordEquipment | null;
}

export interface SwordFormationIndex {
  all: SwordFormation[];
  /** Keyed "<nature>|<echelonWord>". */
  byNatureAndEchelon: Map<string, SwordFormation[]>;
  /** Keyed by full catalogue identifier, for resolving constituents by name. */
  byIdentifier: Map<string, SwordFormation>;
}

/**
 * Echelon words in SWORD identifiers, mapped from the app's echelon vocabulary.
 *
 * Several app echelons are deliberately absent: SWORD has no "brigade" or
 * "division" formation, because those are compositions of automats rather than
 * catalogue entries. They simply do not match, which is correct — the node
 * stays structural.
 */
const ECHELON_WORDS: Record<string, string[]> = {
  Company: ["company"],
  Battery: ["battery"],
  Troop: ["troop"],
  Squadron: ["squadron"],
  Flight: ["flight", "patrol"],
  Platoon: ["platoon"],
  Section: ["section"],
  Squad: ["squad", "team"],
  Team: ["team", "squad"],
  Crew: ["crew"],
  Detachment: ["detachment"],
  // Unmapped on purpose: Battalion, Regiment, Brigade, Division, Corps, Army,
  // Army Group — 5 of 244 rows sit at battalion or above.
};

/** Words that identify an echelon when scanning a SWORD name. */
const ALL_ECHELON_WORDS = [
  "company",
  "battery",
  "squadron",
  "battalion",
  "regiment",
  "platoon",
  "section",
  "patrol",
  "flight",
  "troop",
  "squad",
  "team",
  "crew",
  "detachment",
];

/**
 * Nature inferred from free text — a unit's name, usually.
 *
 * Deliberately small and explicit. Falling back to INF (much the most common
 * ground formation) is better than guessing cleverly and quietly putting a
 * logistics automat under a tank squadron.
 */
const NATURE_HINTS: Array<[RegExp, string]> = [
  [/(armou?r|tank|mbt|cavalry|scout|recce|reconnaissance)/i, "ARMOR"],
  [/(artillery|guns?|mortar|howitzer|fires|mlrs|rocket)/i, "ART"],
  [/(air ?defen[cs]e|ada|sam|surface to air|anti-?aircraft)/i, "AAA"],
  [/(aviation|helicopter|heli|rotary|aavn)/i, "AAVN"],
  [/(logistic|supply|maintenance|repair|resupply|sustainment)/i, "LOG"],
  [/(engineer|sapper|cbrn|nbc)/i, "CBRN"],
  [/(intelligence|isr|uav|drone|surveillance)/i, "INT"],
  [/(transport|convoy|haulage)/i, "TRANS"],
  [/(naval|ship|frigate|destroyer|maritime)/i, "NAVY"],
  [/(police|medical|fire|safety)/i, "SAFETY"],
  [/(militia|insurgent|irregular)/i, "ASY"],
  [/(infantry|rifle|mechanised|mechanized|grenadier)/i, "INF"],
];

export const DEFAULT_NATURE = "INF";

/** Split "ARMOR.Heavy tank company|automat" into its parts. */
export function parseSwordFormation(row: OSwordFormationRow): SwordFormation {
  const identifier = row.identifier ?? "";
  const [beforeBar, levelPart] = identifier.split("|");
  const dotIndex = beforeBar.indexOf(".");
  const nature = dotIndex > 0 ? beforeBar.slice(0, dotIndex) : "";
  const name = dotIndex > 0 ? beforeBar.slice(dotIndex + 1) : beforeBar;

  const level: SwordFormation["level"] =
    levelPart === "automat" ? "automat" : levelPart === "unit" ? "unit" : "other";

  return {
    identifier,
    displayName: row.displayName || name || identifier,
    nature,
    echelonWord: echelonWordIn(name),
    level,
    disCode: row.disCode ?? "",
    echelonGlyph: row.echelonLevel ?? "",
    constituents: parseConstituents(row.constituentUnits),
    commandPostUnit: (row.commandPostUnit ?? "").trim(),
    equipment: parseEquipment(row),
  };
}

/**
 * Split an automat's constituentUnits field.
 *
 * Two encodings are accepted on purpose. The catalogue transform now writes
 * "<name>#<min>#<max>" per entry, but a dataset built before that change holds
 * bare names, and the object type is reindexed on its own schedule — so both
 * have to parse or the app breaks for however long the two are out of step.
 *
 * A missing count means one. A missing max means "exactly min": Automats.xml
 * leaves max-occurs off for an unbounded constituent, and generating an
 * unbounded number of platoons is not a useful reading of that.
 */
export function parseConstituents(raw: string | undefined): ConstituentSpec[] {
  const text = (raw ?? "").trim();
  if (!text) return [];

  const specs: ConstituentSpec[] = [];
  for (const entry of text.split("|")) {
    const [rawName, rawMin, rawMax] = entry.split("#");
    const name = (rawName ?? "").trim();
    if (!name) continue;
    const min = positiveInt(rawMin, 1);
    specs.push({ name, min, max: positiveInt(rawMax, min) });
  }
  return specs;
}

/** The equipment block on a unit row, or null when it carries none. */
function parseEquipment(row: OSwordFormationRow): SwordEquipment | null {
  const type = (row.majorEquipmentType ?? "").trim();
  if (!type) return null;
  return {
    type,
    count: positiveInt(row.majorEquipmentCount, 1),
    crewPerItem: positiveInt(row.requiredCrew, 1),
  };
}

/**
 * A positive integer from a catalogue string, or the fallback.
 *
 * Every numeric field on this object type is typed `string`, so "", null,
 * "0" and "3" all arrive the same way and all have to be handled here rather
 * than at each call site.
 */
function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The app echelon a SWORD echelon word means — the inverse of ECHELON_WORDS.
 *
 * Built from that table rather than written out again, so the two cannot
 * disagree. Two passes because the mapping is not one-to-one: Squad lists
 * ["squad", "team"] and Team lists ["team", "squad"], so a single pass in
 * declaration order would resolve "team" to Squad. Pass one takes each
 * echelon's PRIMARY word, pass two fills in the aliases.
 */
const ECHELON_FOR_WORD: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [echelon, words] of Object.entries(ECHELON_WORDS)) {
    if (words[0] && !map.has(words[0])) map.set(words[0], echelon);
  }
  for (const [echelon, words] of Object.entries(ECHELON_WORDS)) {
    for (const word of words) if (!map.has(word)) map.set(word, echelon);
  }
  // Present in SWORD names but deliberately absent from ECHELON_WORDS, which
  // is a matching table: there is no SWORD automat at battalion or above, so
  // nothing should ever MATCH one. Reading one back off a name is a different
  // question and does happen — 5 of the 244 rows sit at these levels.
  map.set("battalion", "Battalion");
  map.set("regiment", "Regiment");
  return map;
})();

/** The app echelon named by a SWORD echelon word, or undefined. */
export function echelonForWord(word: string | null): string | undefined {
  return word ? ECHELON_FOR_WORD.get(word) : undefined;
}

/** The echelon word in a SWORD formation name, if any. */
export function echelonWordIn(name: string): string | null {
  const lower = name.toLowerCase();
  for (const word of ALL_ECHELON_WORDS) {
    if (lower.includes(word)) return word;
  }
  return null;
}

/** Infer a SWORD nature prefix from a unit's name or description. */
export function natureFromText(...texts: Array<string | undefined>): string {
  const haystack = texts.filter(Boolean).join(" ");
  for (const [pattern, nature] of NATURE_HINTS) {
    if (pattern.test(haystack)) return nature;
  }
  return DEFAULT_NATURE;
}

// The "is this node an automat?" test used to live here, reading the identifier
// suffix directly. It has moved to representation.ts, which states the whole
// vocabulary — aggregate / automat / subformation / entity — in one place and
// is mirrored in the translator. Import isAutomatNode from there.

export function buildSwordFormationIndex(rows: OSwordFormationRow[]): SwordFormationIndex {
  const all = rows.map(parseSwordFormation);
  const byNatureAndEchelon = new Map<string, SwordFormation[]>();
  const byIdentifier = new Map<string, SwordFormation>();
  for (const formation of all) {
    byIdentifier.set(formation.identifier, formation);
    if (!formation.echelonWord) continue;
    const key = `${formation.nature}|${formation.echelonWord}`;
    const bucket = byNatureAndEchelon.get(key);
    if (bucket) bucket.push(formation);
    else byNatureAndEchelon.set(key, [formation]);
  }
  return { all, byNatureAndEchelon, byIdentifier };
}

/**
 * Best SWORD formation for an ORBAT node, or null when there is none.
 *
 * Null is a good answer and the common one above company level: a brigade has
 * no SWORD equivalent, so the node stays structural rather than being given a
 * formation that means something else.
 *
 * Ordering is deterministic, so regenerating the same ORBAT twice gives the
 * same result:
 *   1. must be linkable (has a DIS code) — an unlinkable row would give the
 *      node a name but no canonical asset, which is the state this whole
 *      workstream has been digging out of
 *   2. prefer "automat", the formation SWORD actually orders
 *   3. then the shorter name, favouring the plain type over a variant
 *      ("ARMOR.Heavy tank company" over "ARMOR.Armored company CP")
 *   4. then alphabetical
 */
export function matchSwordFormation(
  index: SwordFormationIndex,
  echelon: string,
  nature: string,
): SwordFormation | null {
  const words = ECHELON_WORDS[echelon];
  if (!words || words.length === 0) return null;

  const candidates: SwordFormation[] = [];
  for (const word of words) {
    const bucket = index.byNatureAndEchelon.get(`${nature}|${word}`);
    if (bucket) candidates.push(...bucket);
  }

  const linkable = candidates.filter((c) => c.disCode.trim().length > 0);
  if (linkable.length === 0) return null;

  linkable.sort((a, b) => {
    if (a.level !== b.level) return a.level === "automat" ? -1 : 1;
    if (a.displayName.length !== b.displayName.length) {
      return a.displayName.length - b.displayName.length;
    }
    return a.identifier.localeCompare(b.identifier);
  });

  return linkable[0];
}
