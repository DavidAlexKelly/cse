// ============================================================
//  Serialiser for the CSE validation compute-module function.
//
//  The server-side `cse_validate_orbat` function expects `orbatContent` as a
//  JSON string in the same shape produced by the Workshop-side helper that
//  intakes an NXG Operation primary key and emits a SWORD / APP-6C style
//  organisation tree.  Sample output from that helper:
//
//    {
//      "id":         "<operation uuid>",
//      "lastEdit":   "2026-07-06T15:11:15.745422+00:00",
//      "started":    "2026-10-01T06:00:00+00:00",
//      "ended":      "2026-10-15T18:00:00+00:00",
//      "title":      "OP-THUNDER-FORGE-2026",
//      "terrainName":"northnordic2",
//      "entities": [
//        {
//          "$type":       "organisation",
//          "id":          15,
//          "name":        "Thunder Forge Battle Group",
//          "sidc":        "SFGPUCI----F---",
//          "isExpanded":  true,
//          "children":    [ … same shape recursively … ],
//          "sword":       { "controllable": false, "class": null }
//        }
//      ]
//    }
//
//  Key observations that drive this serialiser:
//    • SIDC is APP-6C / MIL-STD-2525C — a 15-character code, NOT the 30-digit
//      APP-6E code produced by our internal symbolBuilder.  We derive fresh.
//    • `id` on each entity is a NUMBER, not the internal string UUID.  We
//      allocate dense integers by depth-first walk.
//    • `entities[]` is the root/top-level array; children nest recursively.
//    • `sword` is a required object on every entity — we always emit the
//      "not controllable" default because our units don't carry SWORD state.
//    • `title` corresponds to the operation/project name.
//    • `terrainName` is passed in from the caller when known (matches the
//      Foundry `NxgOperation.terrainName` field).
//    • ISO timestamps use `+00:00` form, not `Z`.  We mirror that.
// ============================================================

import type {
  UnitNode,
  StandardIdentity,
  EchelonLevel,
} from "./types.js";

// ─── APP-6C SIDC construction ────────────────────────────────────────────────
//
//  15-character format:
//    [1]   scheme         S (warfighting)
//    [2]   affiliation    F/H/N/U/P/A/S (mapped from standard identity)
//    [3]   battle dim.    G/A/S/… (mapped from icon)
//    [4]   status         P (present)
//    [5-10] function id   6 chars — main icon meaning
//    [11-12] modifier     '--' (unused)
//    [13]  reserved       '-'
//    [14]  echelon        A..M single letter
//    [15]  reserved       '-'

const APP6C_AFFILIATION: Record<StandardIdentity, string> = {
  friend:        "F",
  hostile:       "H",
  neutral:       "N",
  unknown:       "U",
  pending:       "P",
  assumedFriend: "A",
  suspect:       "S",
};

/** APP-6C battle dimension (char 3) inferred from icon domain. */
function battleDimensionFor(icon: string): string {
  switch (icon) {
    case "airForce":
    case "aviation":
      return "A"; // Air
    case "naval":
      return "S"; // Sea Surface
    default:
      return "G"; // Ground
  }
}

/**
 * Function/entity code (chars 5-10) chosen to match APP-6C entity codes as
 * closely as possible for each of our internal icon values.  Uses '-' padding
 * where fewer than 6 significant chars apply.  The workshop helper's sample
 * shows codes like "UCI---" (infantry), "UCA---" (armour), "UUR---" (recce),
 * "UCF---" (field artillery), "UH-----" collapses to "H----" in HQ contexts.
 */
const APP6C_FUNCTION_CODE: Record<string, string> = {
  infantry:            "UCI---",
  armour:              "UCA---",
  mechanisedInfantry:  "UCIZ--",
  artillery:           "UCF---",
  rocketArtillery:     "UCFR--",
  mortar:              "UCFHE-",
  aviation:            "IMH---",
  airForce:            "IM----",
  reconnaissance:      "UUR---",
  cavalry:             "UCA---",
  engineer:            "UCE---",
  pioneer:             "UCEC--",
  signals:             "UUS---",
  cyber:               "UUSC--",
  ew:                  "UUSE--",
  logistics:           "USS---",
  maintenance:         "USM---",
  medical:             "USM---",
  airDefence:          "UCD---",
  specialForces:       "UUS---",
  sniper:              "UCIS--",
  antiTank:            "UCAT--",
  naval:               "------",
  cbrn:                "UUAB--",
  military_police:     "UUL---",
  headquarters:        "H-----",
  generic:             "U-----",
};

/**
 * APP-6C echelon single-letter code (character 14).
 * Standard mapping — the sample shows E=company, D=platoon, F=battalion,
 * which matches MIL-STD-2525C table B-VI.
 */
const APP6C_ECHELON: Record<EchelonLevel, string> = {
  team:      "A",
  squad:     "B",
  section:   "C",
  platoon:   "D",
  company:   "E",
  battalion: "F",
  regiment:  "G",
  brigade:   "H",
  division:  "I",
  corps:     "J",
  army:      "K",
  armyGroup: "L",
  theatre:   "M",
};

/**
 * Compose a 15-character APP-6C SIDC from a UnitNode.
 *
 * If the unit already carries a stored 15-character SIDC we trust it.
 * Otherwise we derive one from scratch — deliberately NOT reusing the
 * 30-digit APP-6E code produced by our internal symbolBuilder, because
 * that's a different standard and mapping would be lossy.
 */
export function toApp6cSidc(node: UnitNode): string {
  const existing = node.symbol.sidc;
  if (typeof existing === "string" && existing.length === 15) {
    return existing;
  }

  const scheme = "S";
  const aff    = APP6C_AFFILIATION[node.symbol.standardIdentity] ?? "U";
  const dim    = battleDimensionFor(node.symbol.icon);
  const status = "P"; // present
  const func   = (APP6C_FUNCTION_CODE[node.symbol.icon] ?? "U-----")
                   .padEnd(6, "-")
                   .slice(0, 6);
  const mod12  = "--";
  const res13  = "-";
  const ech    = APP6C_ECHELON[node.echelon] ?? "-";
  const res15  = "-";
  return `${scheme}${aff}${dim}${status}${func}${mod12}${res13}${ech}${res15}`;
}

// ─── ISO timestamp helper ────────────────────────────────────────────────────

/** Convert `Date` → `2026-07-06T15:11:15.745Z`-style string with `+00:00`. */
function isoWithOffset(d: Date): string {
  const s = d.toISOString();
  return s.endsWith("Z") ? s.slice(0, -1) + "+00:00" : s;
}

// ─── SWORD-compatible orbat envelope ─────────────────────────────────────────

export interface SwordOrgEntity {
  $type: "organisation";
  id: number;
  name: string;
  sidc: string;
  isExpanded: boolean;
  children: SwordOrgEntity[];
  sword: { controllable: boolean; class: string | null };
}

export interface SwordOrbatPayload {
  id: string;
  lastEdit: string;
  started: string;
  ended: string;
  title: string;
  terrainName: string;
  entities: SwordOrgEntity[];
}

/** Options for tuning the emitted payload beyond the tree itself. */
export interface SerialiseOptions {
  /** Operation UUID — used as the top-level `id`.  Generated if omitted. */
  operationId?: string;
  /** Human-readable operation/project name (top-level `title`). */
  title?: string;
  /** Foundry terrain identifier for the operation. */
  terrainName?: string;
  /** Operation window — ISO strings preferred; Dates also accepted. */
  started?: string | Date;
  ended?:   string | Date;
}

/**
 * Convert a widget-side UnitNode tree into the SWORD / APP-6C envelope the
 * CSE compute-module function expects as `orbatContent`.
 *
 * The tree structure is preserved verbatim (parent → children).  Ids are
 * re-numbered as dense positive integers because the sample payload uses
 * numeric ids and there is no obvious mapping from our internal UUIDs.
 */
export function serialiseOrbatForValidation(
  units: UnitNode[],
  opts: SerialiseOptions = {},
): SwordOrbatPayload {
  // Depth-first sequential id allocation — matches the sample's ordering.
  let seq = 0;
  const toEntity = (node: UnitNode): SwordOrgEntity => {
    seq += 1;
    return {
      $type: "organisation",
      id: seq,
      name: node.name || "Unit",
      sidc: toApp6cSidc(node),
      isExpanded: true,
      children: node.children.map(toEntity),
      sword: { controllable: false, class: null },
    };
  };

  const entities = units.map(toEntity);

  const now = new Date();
  const started = opts.started
    ? (opts.started instanceof Date ? isoWithOffset(opts.started) : opts.started)
    : isoWithOffset(now);
  const ended = opts.ended
    ? (opts.ended instanceof Date ? isoWithOffset(opts.ended) : opts.ended)
    : isoWithOffset(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000));

  return {
    id: opts.operationId ?? crypto.randomUUID(),
    lastEdit: isoWithOffset(now),
    started,
    ended,
    title: opts.title || "Untitled Operation",
    terrainName: opts.terrainName || "",
    entities,
  };
}
