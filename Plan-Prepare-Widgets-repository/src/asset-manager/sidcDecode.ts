// ============================================================
//  SIDC Decoder — letter-based (APP-6D / MIL-STD-2525C, 15-char)
// ============================================================
//
//  Decodes a 15-character letter-based Symbol Identification Code
//  into its constituent fields, using metadata from the milsymbol
//  library where useful. The letter format is:
//
//    Pos 1     Coding scheme    (S = warfighting, G = tactical graphics,
//                                W = weather, I = SIGINT, O = ops,
//                                E = emergency)
//    Pos 2     Standard identity (P/U/A/F/N/S/H/G/W/D/L/M/J/K)
//    Pos 3     Battle dimension  (P/A/G/S/U/F/X/Z)
//    Pos 4     Status            (A anticipated / P present /
//                                 C fully capable / D damaged /
//                                 X destroyed / F full to capacity)
//    Pos 5-10  Function ID       (icon-specific)
//    Pos 11-12 Symbol modifier   (echelon, headquarters, task force,
//                                 feint/dummy, installation, mobility)
//    Pos 13-14 Country code      (ISO 3166 or `--`)
//    Pos 15    Order of battle   (A air, E electronic, C civilian, ...)
//
//  We use milsymbol's Symbol.getMetadata() to translate positions
//  2, 3, 4, and 11-12 into human readable labels — that means the
//  decoder always tracks milsymbol's built-in dictionary.

import ms from "milsymbol";

// ─── Static lookups for fields milsymbol doesn't label directly ──

/** Position 1: coding scheme */
export const CODING_SCHEME: Record<string, string> = {
  S: "Warfighting",
  G: "Tactical Graphics",
  W: "Meteorological & Oceanographic",
  I: "Signals Intelligence",
  O: "Stability Operations",
  E: "Emergency Management",
};

/** Position 2: standard identity (letter) */
export const STANDARD_IDENTITY: Record<string, string> = {
  P: "Pending",
  U: "Unknown",
  A: "Assumed Friend",
  F: "Friend",
  N: "Neutral",
  S: "Suspect",
  H: "Hostile",
  G: "Exercise Pending",
  W: "Exercise Unknown",
  D: "Exercise Friend",
  L: "Exercise Neutral",
  M: "Exercise Assumed Friend",
  J: "Joker",
  K: "Faker",
};

/** Position 3: battle dimension */
export const BATTLE_DIMENSION: Record<string, string> = {
  P: "Space",
  A: "Air",
  G: "Ground",
  S: "Sea Surface",
  U: "Sea Subsurface",
  F: "SOF (Special Operations Forces)",
  X: "Other",
  Z: "Unknown",
};

/** Position 4: status / operational condition */
export const STATUS: Record<string, string> = {
  A: "Anticipated / Planned",
  P: "Present",
  C: "Present / Fully Capable",
  D: "Present / Damaged",
  X: "Present / Destroyed",
  F: "Present / Full to Capacity",
};

/** Position 11: HQ / task force / feint dummy indicator */
export const HQ_TF_DUMMY: Record<string, string> = {
  "-": "None",
  A: "Feint/Dummy",
  B: "Headquarters",
  C: "Feint/Dummy Headquarters",
  D: "Feint/Dummy Task Force HQ",
  E: "Task Force Headquarters",
  F: "Feint/Dummy Task Force",
  G: "Task Force",
  H: "Installation",
  M: "Mobility (see mobility code)",
  N: "Towed Array",
};

/** Position 12: echelon / size / mobility */
export const ECHELON_MOD: Record<string, string> = {
  "-": "None",
  A: "Team / Crew",
  B: "Squad",
  C: "Section",
  D: "Platoon / Detachment",
  E: "Company / Battery / Troop",
  F: "Battalion / Squadron",
  G: "Regiment / Group",
  H: "Brigade",
  I: "Division",
  J: "Corps / MEF",
  K: "Army",
  L: "Army Group / Front",
  M: "Region / Theater",
  N: "Command",
  // Equipment mobility codes
  O: "Wheeled Limited Cross-Country",
  P: "Wheeled Cross-Country",
  Q: "Tracked",
  R: "Wheeled & Tracked Combination",
  S: "Towed",
  T: "Rail",
  U: "Over-Snow (prime mover)",
  V: "Sled",
  W: "Pack Animals",
  X: "Barge",
  Y: "Amphibious",
};

/** Position 15: order of battle */
export const ORDER_OF_BATTLE: Record<string, string> = {
  "-": "Not Specified",
  A: "Air OB",
  E: "Electronic OB",
  C: "Civilian",
  G: "Ground OB",
  N: "Maritime OB",
  S: "Strategic Force Related",
};

// ─── Decoded result ──────────────────────────────────────────

export interface SidcDecoded {
  /** The original code, upper-cased and padded to 15 chars. */
  code: string;
  /** True if the input parsed cleanly to exactly 15 letters/digits. */
  isValid: boolean;
  /** Warning shown when the length wasn't exactly 15 chars. */
  warning: string | null;

  parts: {
    codingScheme: string;     // [1]
    standardIdentity: string; // [2]
    battleDimension: string;  // [3]
    status: string;           // [4]
    functionId: string;       // [5-10]
    hqTfDummy: string;        // [11]
    echelonMobility: string;  // [12]
    countryCode: string;      // [13-14]
    orderOfBattle: string;    // [15]
  };

  labels: {
    codingScheme: string | null;
    standardIdentity: string | null;
    battleDimension: string | null;
    status: string | null;
    functionId: string | null;
    hqTfDummy: string | null;
    echelonMobility: string | null;
    orderOfBattle: string | null;
  };

  /** One-line human summary. */
  summary: string;

  /** True if milsymbol reports this SIDC as valid (icon + geometry). */
  milsymbolValid: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────

export function normaliseSidc(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = String(input).replace(/\s+/g, "").toUpperCase();
  if (raw.length === 0) return null;
  if (raw.length >= 15) return raw.slice(0, 15);
  return raw.padEnd(15, "-");
}

/**
 * Decode a letter-based SIDC and enrich it with metadata from
 * milsymbol (echelon label, function id, milsymbolValid flag).
 */
export function decodeSidc(input: string | null | undefined): SidcDecoded | null {
  const code = normaliseSidc(input);
  if (!code) return null;

  const rawLen = (input ?? "").replace(/\s+/g, "").length;
  let warning: string | null = null;
  if (rawLen === 0) warning = "Empty code";
  else if (rawLen < 15)
    warning = `Only ${rawLen} chars — padded with '-' to reach 15.`;
  else if (rawLen > 15)
    warning = `${rawLen} chars provided — extra trailing chars ignored.`;

  const parts = {
    codingScheme: code.charAt(0),
    standardIdentity: code.charAt(1),
    battleDimension: code.charAt(2),
    status: code.charAt(3),
    functionId: code.slice(4, 10),
    hqTfDummy: code.charAt(10),
    echelonMobility: code.charAt(11),
    countryCode: code.slice(12, 14),
    orderOfBattle: code.charAt(14),
  };

  // Try to enrich via milsymbol — its getMetadata() gives us live
  // labels for echelon/mobility that stay in sync with the library.
  let msEchelonLabel: string | null = null;
  let msFunctionId: string | null = null;
  let milsymbolValid = false;
  try {
    ms.setStandard("APP6");
    const sym = new ms.Symbol(code, { size: 30, standard: "APP6" });
    const meta = sym.getMetadata();
    milsymbolValid = Boolean(sym.isValid(false));
    msEchelonLabel = meta.echelon || null;
    if (meta.mobility) msEchelonLabel = meta.mobility;
    msFunctionId = meta.functionid || null;
  } catch {
    // ignore — fall back to static lookups
  }

  const labels = {
    codingScheme: CODING_SCHEME[parts.codingScheme] ?? null,
    standardIdentity: STANDARD_IDENTITY[parts.standardIdentity] ?? null,
    battleDimension: BATTLE_DIMENSION[parts.battleDimension] ?? null,
    status: STATUS[parts.status] ?? null,
    functionId: msFunctionId,
    hqTfDummy: HQ_TF_DUMMY[parts.hqTfDummy] ?? null,
    echelonMobility: msEchelonLabel ?? ECHELON_MOD[parts.echelonMobility] ?? null,
    orderOfBattle: ORDER_OF_BATTLE[parts.orderOfBattle] ?? null,
  };

  const summaryParts: string[] = [];
  if (labels.codingScheme) summaryParts.push(labels.codingScheme);
  if (labels.standardIdentity) summaryParts.push(labels.standardIdentity);
  if (labels.battleDimension) summaryParts.push(labels.battleDimension);
  if (labels.status && parts.status !== "P")
    summaryParts.push(labels.status);
  if (labels.hqTfDummy && parts.hqTfDummy !== "-")
    summaryParts.push(labels.hqTfDummy);
  if (labels.echelonMobility && parts.echelonMobility !== "-")
    summaryParts.push(labels.echelonMobility);
  if (labels.orderOfBattle && parts.orderOfBattle !== "-")
    summaryParts.push(labels.orderOfBattle);
  if (parts.countryCode !== "--")
    summaryParts.push(`Country: ${parts.countryCode}`);

  return {
    code,
    isValid: rawLen === 15,
    warning,
    parts,
    labels,
    summary: summaryParts.join(" · "),
    milsymbolValid,
  };
}
