/**
 * sidc.ts — shared SIDC constants and helpers for the ORBAT manager.
 *
 * Verified against the milsymbol 3.x library.
 *
 * 15-char APP-6D letter-SIDC layout (0-indexed):
 *   pos  0   : S  (warfighting scheme)
 *   pos  1   : affiliation  (F/H/N/U/A/S)
 *   pos  2-3 : battle dimension  (GP=ground, AP=air, SS=sea surface, SU=subsurface)
 *   pos  4-9 : function ID, 6 chars padded with dashes  e.g. "UCI---"
 *   pos  10  : separator  (always '-')
 *   pos  11  : echelon modifier  (A-M or '-')   ← key position
 *   pos 12-14: trailing dashes "---"
 *
 * Example: "SFGPUCI----F---"
 *   S = warfighting, F = Friend, GP = Ground, UCI--- = infantry, F = Battalion/squadron
 */

// ── Affiliation ────────────────────────────────────────────────────────────

export const SIDC_AFF_CODES: Record<string, string> = {
  "Friend":         "F",
  "Hostile":        "H",
  "Neutral":        "N",
  "Unknown":        "U",
  "Assumed Friend": "A",
  "Suspect":        "S",
};

export const SIDC_AFF_FROM_CODE: Record<string, string> = {
  "F": "Friend",
  "H": "Hostile",
  "N": "Neutral",
  "U": "Unknown",
  "A": "Assumed Friend",
  "S": "Suspect",
};

// ── Battle dimension ────────────────────────────────────────────────────────

export const ENTITY_BATTLE_DIM: Record<string, string> = {
  "organisation": "GP",
  "vehicle":      "GP",
  "human":        "GP",
  "aircraft":     "AP",
};

// ── Function IDs ───────────────────────────────────────────────────────────

/** 6-char function ID (positions 4-9 in 15-char SIDC), padded with dashes */
export const ICON_FUNC6: Record<string, string> = {
  infantry:              "UCI---",
  armour:                "UCA---",
  armor:                 "UCA---",   // US spelling alias
  mechanisedInfantry:    "UCIZ--",
  mechanizedInfantry:    "UCIZ--",   // US spelling alias
  artillery:             "UCF---",
  rocketArtillery:       "UCF---",
  mortar:                "UCF---",
  aviation:              "UCA---",
  airForce:              "MFF---",
  reconnaissance:        "UCR---",
  recce:                 "UCR---",
  cavalry:               "UCA---",
  engineer:              "UCE---",
  engineers:             "UCE---",
  pioneer:               "UCE---",
  signals:               "USS---",
  signal:                "USS---",
  cyber:                 "USC---",
  ew:                    "USE---",
  electronicWarfare:     "USE---",
  logistics:             "USM---",
  logistic:              "USM---",
  maintenance:           "USM---",
  medical:               "UMC---",
  airDefence:            "UAA---",
  airDefense:            "UAA---",   // US spelling alias
  specialForces:         "UUS---",
  specialOperations:     "UUS---",
  sniper:                "UUI---",
  antiTank:              "UCA---",
  naval:                 "SS----",
  cbrn:                  "UXC---",
  military_police:       "UMP---",
  militaryPolice:        "UMP---",
  headquarters:          "UH----",
  hq:                    "UH----",
  generic:               "UCI---",
  // Additional icons the LLM commonly produces
  airborne:              "UCI---",
  amphibious:            "UCI---",
  antiAircraft:          "UAA---",
  apc:                   "UCIZ--",   // armoured personnel carrier → mechanised
  armoured:              "UCA---",
  armouredInfantry:      "UCIZ--",
  combat:                "UCI---",
  commandPost:           "UH----",
  drone:                 "MFF---",
  fieldArtillery:        "UCF---",
  heavyMortars:          "UCF---",
  helicopterAssault:     "MFA---",
  lightInfantry:         "UCI---",
  mechanised:            "UCIZ--",
  mechanized:            "UCIZ--",
  motorised:             "UCI---",
  motorized:             "UCI---",
  recon:                 "UCR---",
  rocket:                "UCF---",
  support:               "USM---",
  sustainment:           "USM---",
  tank:                  "UCA---",
  transport:             "USM---",
};

export const ENTITY_DEFAULT_FUNC6: Record<string, string> = {
  "organisation": "UCI---",
  "vehicle":      "UCIZ--",
  "human":        "UCI---",
  "aircraft":     "MFF---",
};

// ── Echelon ─────────────────────────────────────────────────────────────────

/**
 * Echelon string → single char at SIDC position 11.
 * Verified against milsymbol 3.x getMetadata().echelon output.
 *
 * milsymbol echelon map (from getMetadata):
 *   A → Team/Crew           B → Squad
 *   C → Section             D → Platoon/detachment
 *   E → Company/battery/troop   F → Battalion/squadron
 *   G → Regiment/group      H → Brigade
 *   I → Division            J → Corps/MEF
 *   K → Army                L → Army Group/front
 *   M → Region/Theater      - → (none)
 */
export const ECHELON_TO_SIDC_CHAR: Record<string, string> = {
  // no echelon
  "": "-",
  // lowercase domain values
  "team": "A", "fireteam": "A", "element": "A", "crew": "A", "gun": "A",
  "squad": "B",
  "section": "C",
  "platoon": "D", "detachment": "D",
  "company": "E", "battery": "E", "troop": "E",
  "battalion": "F", "squadron": "F",
  "regiment": "G", "group": "G",
  "brigade": "H", "wing": "H",
  "division": "I",
  "corps": "J", "field army": "J", "mef": "J",
  "army": "K",
  "army group": "L", "front": "L",
  "region": "M", "theater": "M", "theatre": "M",
  // Title-case values (from dropdowns / milsymbol labels)
  "Team": "A", "Fireteam": "A", "Element": "A", "Crew": "A", "Gun": "A",
  "Squad": "B",
  "Section": "C",
  "Platoon": "D", "Detachment": "D", "Platoon/detachment": "D",
  "Company": "E", "Battery": "E", "Troop": "E", "Company/battery/troop": "E",
  "Battalion": "F", "Squadron": "F", "Battalion/squadron": "F",
  "Regiment": "G", "Group": "G", "Regiment/group": "G",
  "Brigade": "H", "Wing": "H",
  "Division": "I",
  "Corps": "J", "Corps/MEF": "J", "Field Army": "J",
  "Army": "K",
  "Army Group": "L", "Army Group/front": "L",
  "Region": "M", "Theater": "M", "Theatre": "M", "Region/Theater": "M",
};

/** Reverse map: SIDC position-11 char → canonical echelon label used in this app */
export const SIDC_CHAR_TO_ECHELON: Record<string, string> = {
  "-": "",
  "A": "Team",
  "B": "Squad",
  "C": "Section",
  "D": "Platoon",
  "E": "Company",
  "F": "Battalion",
  "G": "Regiment",
  "H": "Brigade",
  "I": "Division",
  "J": "Corps",
  "K": "Army",
  "L": "Army Group",
  "M": "Theatre",
};

// ── SIDC builders / parsers ─────────────────────────────────────────────────

/**
 * Build a valid 15-char APP-6D letter-SIDC.
 *
 * Format: S[aff][dim2][func6]-[echelon]---
 *
 * Examples:
 *   makeSidc("infantry", "Battalion", "Friend")            → SFGPUCI----F---
 *   makeSidc("armour",   "Brigade",   "Hostile", "vehicle") → SHGPUCA----H---
 *   makeSidc("airForce", "Squadron",  "Friend",  "aircraft")→ SFAPMFF----F---
 */
export function makeSidc(
  icon: string,
  echelon: string,
  affiliation: string,
  entityType = "organisation",
): string {
  const aff  = SIDC_AFF_CODES[affiliation] ?? "F";
  const dim  = ENTITY_BATTLE_DIM[entityType] ?? "GP";
  const func = ICON_FUNC6[icon] ?? "UCI---";
  const ech  = ECHELON_TO_SIDC_CHAR[echelon]
            ?? ECHELON_TO_SIDC_CHAR[echelon?.toLowerCase()]
            ?? "-";
  return `S${aff}${dim}${func}-${ech}---`;
}

/**
 * Read the echelon string from a 15-char SIDC (position 11).
 * Returns our canonical label (e.g. "Battalion") or "" if none set.
 */
export function echelonFromSidc(sidc: string): string {
  if (!sidc || sidc.length < 12) return "";
  return SIDC_CHAR_TO_ECHELON[sidc[11]] ?? "";
}

/**
 * Read the affiliation string from a 15-char SIDC (position 1).
 */
export function affiliationFromSidc(sidc: string): string {
  if (!sidc || sidc.length < 2) return "Friend";
  return SIDC_AFF_FROM_CODE[sidc[1]] ?? "Unknown";
}

/**
 * Parse a 15-char APP-6D letter-SIDC into its component parts.
 * Returns null if the string is too short.
 */
export function parseSidc(sidc: string) {
  if (!sidc || sidc.length < 12) return null;
  return {
    affiliation: sidc[1],          // pos 1
    battleDim:   sidc.slice(2, 4), // pos 2-3
    functionId:  sidc.slice(4, 10),// pos 4-9 (6 chars)
    echelonChar: sidc[11] ?? "-",  // pos 11
  };
}

/**
 * Rebuild a 15-char SIDC from parts.
 * funcId6 will be padded/trimmed to exactly 6 chars.
 */
export function buildSidc(
  affCode: string,
  battleDim: string,
  funcId6: string,
  echelonChar: string,
): string {
  const func = funcId6.padEnd(6, "-").slice(0, 6);
  return `S${affCode}${battleDim}${func}-${echelonChar}---`;
}
