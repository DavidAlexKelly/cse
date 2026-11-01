// src/shared/orbat/swordComposition.ts
//
// What is actually inside a SWORD automat, and how to put it in the tree.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE COMPOSITION RULE IS MIRRORED IN PYTHON.
// Any change to how constituents are read or counted must be made in:
//   [NXG] Translator → python-functions/python/src/sword_composition.py
// The two test files carry the same case table, in the same order, under the
// same names:
//   src/shared/orbat/swordComposition.test.ts
//   python-functions/python/tests/test_sword_composition.py
// ─────────────────────────────────────────────────────────────────────────────
//
// Where the echelon ladder stops being true
// -----------------------------------------
// buildOrbatSkeleton walks a doctrinal ladder: a division has brigades, a
// brigade has battalions, a battalion has companies, three of each. That is a
// reasonable guess and it is only a guess. Below company level it stops being
// one at all, because SWORD states the answer:
//
//   ART.Guns firing battery|automat
//     constituentUnits  ART.Battery CP#1#1 | ART.Guns firing platoon#3#3
//     commandPostUnit   ART.Battery CP
//
//   ART.Guns firing platoon|unit
//     majorEquipmentType   ART.Gun 155mm
//     majorEquipmentCount  4
//     requiredCrew         5
//
// A battery is one CP and three gun platoons of four guns each. The ladder
// would have produced three anonymous "1 Pl, A Bty" with nothing in them.
//
// Expansion REPLACES the automat
// ------------------------------
// This is the part that matters, and it follows directly from Phase 1.
//
// An automat is one thing SWORD spawns whole. Hanging its constituents
// underneath it while it keeps its automat code puts the same battery in the
// exercise twice — that is exactly the DOUBLE_COUNTED error representation.ts
// raises, and it is raised against live data today.
//
// So expanding is not "adding children". It is a change of representation:
// the node gives up its automat code and becomes plain structure, and the
// SWORD assets move down onto the constituents, which are sub-formations. One
// node, one representation, at every level. A planner who wants the aggregate
// back collapses it, and the code comes back with it.
//
// Where it stops: the sub-formation
// ---------------------------------
// The equipment inside a sub-formation is NOT expanded into vehicles, for two
// separate reasons, either of which would be enough:
//
//   1. It would double-count again. SWORD builds a Pion's equipment from its
//      own catalogue; four tank nodes beneath a tank platoon are four extra
//      tanks.
//   2. There is nowhere to point them. majorEquipmentType is a SWORD type
//      ("ARMOR.Main Battle Tank"), not a DIS code, and nothing in the ontology
//      maps the two — the mapping lives in component.xml, which is not
//      ingested. Units in the ontology that already carry codes of the form
//      "<equipment>|<automat>|<dis>|equipment" resolve to no catalogue row at
//      all.
//
// The equipment is carried on the sub-formation node instead, as fact rather
// than structure, so the UI can show "4 × ARMOR.Main Battle Tank, crew 3" and
// the export projection can use it when component.xml lands.

import type { UnitEchelon } from "../../apps/scenarioPlanner/map/types";
import type { CompositionNode } from "../types/index";
import { representationOf } from "./representation";
import { ECHELON_LADDER, childEchelon, withEchelonGlyph } from "./skeleton";
import {
  echelonForWord,
  echelonWordIn,
  type ConstituentSpec,
  type SwordEquipment,
  type SwordFormation,
  type SwordFormationIndex,
} from "./swordFormations";

/** One constituent of an automat, resolved against the catalogue. */
export interface AutomatConstituent {
  /** Name as the automat states it, e.g. "ARMOR.Heavy tank platoon". */
  name: string;
  /** The "|unit" row, when the catalogue has one. */
  formation: SwordFormation | null;
  /** True for the automat's command post. */
  isCommandPost: boolean;
  /** How many of it the automat holds. */
  quantity: number;
  /** What SWORD fills it with. Null for a single-platform unit. */
  equipment: SwordEquipment | null;
}

/** An automat, taken apart. */
export interface AutomatComposition {
  automat: SwordFormation;
  constituents: AutomatConstituent[];
  /**
   * Constituent names with no "|unit" row in the catalogue.
   *
   * Empty across all 81 automats today — every command post resolves, and the
   * names come from the same Units.xml the unit rows are built from — but a
   * partial catalogue load would show up here rather than as silently missing
   * sub-units.
   */
  unresolved: string[];
}

/**
 * How many of a constituent to generate, given its min-occurs and max-occurs.
 *
 * The minimum, deliberately. Automats.xml gives a permitted range and the
 * bottom of it is the establishment — "1..4 anti-tank sections" means a
 * battery has one and may be reinforced to four. Generating four would hand a
 * planner a force half again the size they asked for, and adding is easier
 * than noticing you have too much.
 */
export function constituentQuantity(spec: ConstituentSpec): number {
  return Math.max(1, Math.min(spec.min, spec.max));
}

/**
 * Take an automat apart, or return null when it is not an automat we know.
 *
 * Null is a normal answer: a formation index built from a partial catalogue,
 * or a "|unit" identifier passed in by mistake, should leave the tree alone
 * rather than produce an empty expansion.
 */
export function automatComposition(
  index: SwordFormationIndex,
  automatIdentifier: string,
): AutomatComposition | null {
  const automat = index.byIdentifier.get(automatIdentifier);
  if (!automat || automat.level !== "automat") return null;
  if (automat.constituents.length === 0) return null;

  const constituents: AutomatConstituent[] = [];
  const unresolved: string[] = [];

  for (const spec of automat.constituents) {
    const formation = index.byIdentifier.get(`${spec.name}|unit`) ?? null;
    if (!formation) unresolved.push(spec.name);
    constituents.push({
      name: spec.name,
      formation,
      isCommandPost: spec.name === automat.commandPostUnit,
      quantity: constituentQuantity(spec),
      equipment: formation?.equipment ?? null,
    });
  }

  return { automat, constituents, unresolved };
}

/**
 * The echelon to give a constituent of a formation at `parentEchelon`.
 *
 * Three rules, all about not letting a child outrank its parent:
 *
 *   ANYTHING BUT A CP uses the echelon word in its name, but only if that is
 *   junior to the parent. "INF.Mechanised platoon" inside a company gives
 *   Platoon, which is right; anything that came back level or senior is a
 *   parsing accident and falls back.
 *
 *   A COMMAND POST takes its siblings' echelon, passed in as
 *   `siblingEchelon`. Reading it off the name does not work — "ARMOR.Armored
 *   company CP" contains the word "company", which would make a company's own
 *   CP a second company sitting inside it. A CP is an element of the
 *   formation, not a peer, and it sits alongside the formation's sub-units.
 *
 *   NEITHER falls back to the ladder, then to the parent's own echelon.
 *
 * The sibling rule is not decoration. Many SWORD parents sit OFF the ladder —
 * Battery, Troop, Squadron, Flight are not in ECHELON_LADDER, so
 * childEchelon() returns undefined for them and the fallback would be the
 * parent's own echelon. "ART.Guns firing battery" would then give its CP the
 * echelon Battery: level with its parent, wrong on the map symbol, and
 * outranking nothing in hierarchy.ts's seniority comparison.
 */
export function constituentEchelon(
  constituent: Pick<AutomatConstituent, "name" | "isCommandPost">,
  parentEchelon: UnitEchelon,
  siblingEchelon?: UnitEchelon,
): UnitEchelon {
  const fallback = childEchelon(parentEchelon) ?? parentEchelon;
  if (constituent.isCommandPost) return siblingEchelon ?? fallback;

  const word = echelonForWord(echelonWordIn(constituent.name));
  if (!word) return siblingEchelon ?? fallback;

  const echelon = word as UnitEchelon;
  const parentRank = ECHELON_LADDER.indexOf(parentEchelon);
  const ownRank = ECHELON_LADDER.indexOf(echelon);
  // -1 means the echelon is off the ladder (Battery, Troop, Flight…). Those
  // are company-level variants and are accepted as-is; the ladder only exists
  // to catch a child claiming to be its parent's equal.
  if (parentRank >= 0 && ownRank >= 0 && ownRank <= parentRank) return fallback;
  return echelon;
}

/**
 * The most senior echelon among the constituents that are not command posts.
 *
 * What a CP is given, so it sits alongside the formation's sub-units rather
 * than level with the formation itself. "Most senior" rather than "first"
 * because a company holding platoons and sections should put its CP at
 * platoon level, whichever order the catalogue happens to list them in.
 */
export function seniorSiblingEchelon(
  constituents: readonly AutomatConstituent[],
  parentEchelon: UnitEchelon,
): UnitEchelon | undefined {
  let best: UnitEchelon | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const constituent of constituents) {
    if (constituent.isCommandPost) continue;
    const echelon = constituentEchelon(constituent, parentEchelon);
    const rank = ECHELON_LADDER.indexOf(echelon);
    if (rank >= 0 && rank < bestRank) {
      bestRank = rank;
      best = echelon;
    } else if (best === undefined) {
      best = echelon;
    }
  }
  return best;
}

/** Display name for a constituent node: "Heavy tank platoon, A Coy". */
function constituentLabel(constituent: AutomatConstituent, parentLabel: string): string {
  const own = constituent.formation?.displayName || constituent.name;
  // The parent's own designator, not its whole qualified name, matching the
  // convention buildOrbatSkeleton uses: "1 Pl, A Coy" rather than
  // "1 Pl, A Coy, 1 Bn, 1 Bde".
  const qualifier = parentLabel.split(",")[0]?.trim() ?? parentLabel;
  return qualifier ? `${own}, ${qualifier}` : own;
}

export interface ExpandAutomatOptions {
  /** Injectable for deterministic tests. */
  newKey?: () => string;
}

/**
 * Replace an automat node with its real SWORD composition.
 *
 * Returns a NEW tree — the input is not mutated — in which:
 *   • the node has given up its automat code and become plain structure
 *   • its constituents hang beneath it as sub-formations, each carrying the
 *     "|unit" catalogue row and its DIS code
 *   • anything already beneath the node is kept, after the constituents
 *
 * Returns null when the node is not an automat, or the catalogue does not
 * describe it — callers should leave the node alone in that case rather than
 * replacing it with something emptier.
 *
 * Keeping existing children is the cautious choice: they are a planner's work.
 * It can leave a tree that still fails the double-count check — a vehicle that
 * was under the automat is now under an aggregate, which is fine, but one that
 * was under a constituent is not — and that is the right outcome. The check
 * reports it, rather than this function silently deleting someone's units.
 */
export function expandAutomat(
  node: CompositionNode,
  index: SwordFormationIndex,
  options: ExpandAutomatOptions = {},
): CompositionNode | null {
  if (representationOf(node) !== "automat") return null;

  const composition = automatComposition(index, node.simulatorIdentifierCode ?? "");
  if (!composition) return null;

  const newKey = options.newKey ?? (() => crypto.randomUUID());

  const parentEchelon = node.echelon as UnitEchelon;
  const siblingEchelon = seniorSiblingEchelon(composition.constituents, parentEchelon);

  const children: CompositionNode[] = composition.constituents.map((constituent) => {
    const echelon = constituentEchelon(constituent, parentEchelon, siblingEchelon);
    const disCode = constituent.formation?.disCode ?? "";
    return {
      id: newKey(),
      unitIdentifier: constituentLabel(constituent, node.unitIdentifier),
      echelon,
      sidc: withEchelonGlyph(node.sidc, echelon),
      entityType: "organisation",
      militaryService: node.militaryService,
      affiliation: node.affiliation,
      allegiance: node.allegiance,
      // SWORD owns it if SWORD has a row for it. The canonical asset link is
      // a separate question: 21 of the 163 unit rows have no DIS code —
      // INF.Mechanised platoon and INF.Anti-tank section among them — and
      // withholding "sword" from those would produce a node carrying a SWORD
      // model while claiming no simulator owns it, which is a contradiction
      // the export would have to resolve by guessing. The missing asset is
      // reported by the asset gate; it is not this function's to hide.
      owningSimulator: constituent.formation ? "sword" : "none",
      canonicalAssetKey: disCode || null,
      simulatorIdentifierCode: constituent.formation?.identifier ?? null,
      unitTypeKey: null,
      equipmentTypeKey: null,
      quantity: constituent.quantity,
      children: [],
    };
  });

  return {
    ...node,
    // The demotion. See the note at the top of the file: the node cannot be
    // the aggregate AND contain it.
    owningSimulator: "none",
    canonicalAssetKey: null,
    simulatorIdentifierCode: null,
    children: [...children, ...node.children],
  };
}

/**
 * Expand every automat in a tree, once.
 *
 * "Once" is deliberate and not a limitation: a constituent is a sub-formation,
 * never an automat, so there is nothing below to expand and no risk of
 * recursing into a cycle if the catalogue ever contained one.
 */
export function expandAutomatsInTree(
  root: CompositionNode,
  index: SwordFormationIndex,
  options: ExpandAutomatOptions = {},
): CompositionNode {
  const expanded = expandAutomat(root, index, options) ?? root;
  return {
    ...expanded,
    children: expanded.children.map((child) => expandAutomatsInTree(child, index, options)),
  };
}

/**
 * A one-line description of what is inside a sub-formation.
 *
 * For the UI and for error messages, and the only place the equipment facts
 * currently surface. Empty string when the unit carries no equipment block —
 * true of 21 of the 163 unit rows, which are single platforms (a fighter jet,
 * a Zodiac) rather than groupings.
 */
export function describeEquipment(equipment: SwordEquipment | null): string {
  if (!equipment) return "";
  const crew = equipment.crewPerItem > 1 ? `, crew ${equipment.crewPerItem}` : "";
  return `${equipment.count} × ${equipment.type}${crew}`;
}
