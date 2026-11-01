// src/shared/orbat/skeleton.ts
//
// Builds the initial ORBAT tree for a unit placed on the Scenario Planner map,
// rooted at what the unit actually IS — an infantry division roots a division,
// a recce troop roots a troop.
//
// Default depth is TWO levels below the root (a division gives brigades and
// battalions, ~12 nodes) which is fast to write and enough to be useful. The
// planner can then extend or regenerate in the ORBAT screen; going straight to
// platoon level would be hundreds of ontology writes.

import type { CompositionNode } from "@/shared/types";
import type { PlacedUnit, UnitEchelon } from "../../apps/scenarioPlanner/map/types";
import { UNIT_ARCHETYPES, UNIT_TEMPLATES } from "../../apps/scenarioPlanner/map/unitTemplates";
import { isAutomatNode } from "./representation";
import {
  matchSwordFormation,
  natureFromText,
  type SwordFormationIndex,
} from "./swordFormations";

/**
 * Echelon ladder, largest first.
 *
 * Exported because it is also the seniority ordering the scenario hierarchy
 * reconciler ranks units by (see hierarchy.ts) — there must be exactly one
 * definition of "a brigade outranks a battalion".
 */
export const ECHELON_LADDER: UnitEchelon[] = [
  "Army Group",
  "Army",
  "Corps",
  "Division",
  "Brigade",
  "Regiment",
  "Battalion",
  "Company",
  "Platoon",
  "Section",
  "Squad",
  "Team",
];

/** APP-6 echelon glyph (SIDC position 12, index 11). */
const ECHELON_GLYPH: Partial<Record<UnitEchelon, string>> = {
  Team: "A",
  Crew: "A",
  Squad: "B",
  Section: "C",
  Platoon: "D",
  Detachment: "D",
  Company: "E",
  Battery: "E",
  Troop: "E",
  Battalion: "F",
  Squadron: "F",
  Regiment: "G",
  Group: "G",
  Wing: "G",
  Brigade: "H",
  Division: "I",
  Corps: "J",
  Army: "K",
  "Army Group": "L",
  Region: "M",
};

/**
 * How many subordinates of the next echelon down a formation typically holds,
 * and what the child is called. Deliberately conservative — a planner can add.
 */
const SUBORDINATE_COUNT: Partial<Record<UnitEchelon, number>> = {
  "Army Group": 3,
  Army: 3,
  Corps: 3,
  Division: 3,
  Brigade: 3,
  Regiment: 3,
  Battalion: 3,
  Squadron: 3,
  Company: 3,
  Battery: 3,
  Troop: 3,
  Platoon: 3,
  Section: 2,
  Squad: 2,
};

/** NATO-style short forms used in unit names. */
const ECHELON_ABBREV: Partial<Record<UnitEchelon, string>> = {
  "Army Group": "Army Gp",
  Army: "Army",
  Corps: "Corps",
  Division: "Div",
  Brigade: "Bde",
  Regiment: "Regt",
  Group: "Gp",
  Wing: "Wg",
  Battalion: "Bn",
  Squadron: "Sqn",
  Company: "Coy",
  Battery: "Bty",
  Troop: "Tp",
  Platoon: "Pl",
  Flight: "Flt",
  Detachment: "Det",
  Section: "Sect",
  Squad: "Sqd",
  Team: "Tm",
  Crew: "Crew",
};

/**
 * Sub-units are lettered or numbered by convention: companies, squadrons and
 * batteries take letters (A Coy, B Sqn, C Bty); everything else takes numbers
 * (1 Bde, 2 Bn, 3 Pl).
 */
const LETTERED_ECHELONS: ReadonlySet<UnitEchelon> = new Set<UnitEchelon>([
  "Company",
  "Squadron",
  "Battery",
]);

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** "A Coy" / "2 Bn" — the designator a sub-unit is known by. */
function designator(echelon: UnitEchelon, index: number): string {
  const abbrev = ECHELON_ABBREV[echelon] ?? echelon;
  const number = LETTERED_ECHELONS.has(echelon)
    ? LETTERS[index] ?? String(index + 1)
    : String(index + 1);
  return `${number} ${abbrev}`;
}

/** Next echelon down from the given one, or undefined at the bottom. */
export function childEchelon(echelon: UnitEchelon): UnitEchelon | undefined {
  const i = ECHELON_LADDER.indexOf(echelon);
  if (i === -1 || i === ECHELON_LADDER.length - 1) return undefined;
  return ECHELON_LADDER[i + 1];
}

/** Replace the echelon glyph in a 15-char APP-6D SIDC. */
export function withEchelonGlyph(sidc: string, echelon: UnitEchelon): string {
  const glyph = ECHELON_GLYPH[echelon];
  if (!glyph || sidc.length < 12) return sidc;
  return sidc.slice(0, 11) + glyph + sidc.slice(12);
}

/**
 * Best-effort echelon for a placed unit: the archetype behind its templateId
 * first, then the SIDC's echelon glyph, then Battalion as a neutral default.
 */
export function echelonForPlacedUnit(unit: Pick<PlacedUnit, "templateId" | "sidc">): UnitEchelon {
  // UNIT_TEMPLATES entries are archetype × echelon and carry a concrete
  // echelon; UNIT_ARCHETYPES only list the echelons they support.
  const template = UNIT_TEMPLATES.find((t) => t.id === unit.templateId);
  if (template?.echelon) return template.echelon;

  const glyph = unit.sidc?.[11];
  if (glyph) {
    const match = (Object.entries(ECHELON_GLYPH) as [UnitEchelon, string][])
      .find(([, g]) => g === glyph);
    if (match) return match[0];
  }
  return "Battalion";
}

export interface OrbatSkeletonOptions {
  /** Levels of subordinates to generate below the root. Default 2. */
  depth?: number;
  /** Cap on total nodes, so a large formation can't run away. Default 60. */
  maxNodes?: number;
  /**
   * SWORD catalogue index. When supplied, every generated organisation is
   * matched to a SWORD formation and gets a real asset link.
   *
   * Optional so the generator stays a pure function with no ontology
   * dependency — the tests build skeletons without it, and callers that have
   * not loaded the catalogue still get a (structural) tree.
   */
  swordFormations?: SwordFormationIndex;
  /**
   * SWORD nature to match against ("ARMOR", "INF", "ART"…). Inferred from the
   * placed unit's name when omitted.
   *
   * Inherited by the whole tree on purpose: a tank squadron generates tank
   * companies, not a mixture.
   */
  nature?: string;
  /**
   * Replace a matched automat with its real SWORD composition.
   *
   * Supplied as a callback rather than called directly so this module keeps
   * no dependency on swordComposition — that one already depends on this one
   * for the echelon ladder, and a cycle between them would be worse than a
   * parameter. generate.ts wires expandAutomat in; the tests pass their own.
   *
   * Returning null means "leave the node as the automat", which is what
   * happens when the catalogue does not describe it.
   */
  expandAutomat?: (node: CompositionNode) => CompositionNode | null;
}

/**
 * Build the CompositionNode tree for a placed unit.
 *
 * The root mirrors the placed unit exactly (same label, SIDC, affiliation) so
 * the ORBAT and the map symbol agree; children step down the echelon ladder
 * with the matching echelon glyph.
 */
export function buildOrbatSkeleton(
  unit: PlacedUnit,
  options: OrbatSkeletonOptions = {},
): CompositionNode {
  const depth = options.depth ?? 2;
  const maxNodes = options.maxNodes ?? 60;

  // The nature the whole tree inherits, so a tank squadron generates tank
  // companies rather than a mixture.
  const nature = options.nature ?? natureFromText(unit.label, unit.templateId);
  const formations = options.swordFormations;

  const hostile = (unit.sidc?.[1] ?? "F").toUpperCase() === "H";
  const rootEchelon = echelonForPlacedUnit(unit);
  // Military service comes from the concrete template when the placement used
  // one, otherwise from the archetype the templateId is derived from.
  const template = UNIT_TEMPLATES.find((t) => t.id === unit.templateId);
  const archetype =
    UNIT_ARCHETYPES.find((a) => unit.templateId?.startsWith(a.id)) ?? undefined;
  const militaryService = template?.militaryService ?? archetype?.militaryService ?? "Army";

  let nodeCount = 0;

  const makeNode = (
    label: string,
    echelon: UnitEchelon,
    sidc: string,
    /** Only the root inherits the placement's unit type — subordinates are a
     *  different echelon and would otherwise all claim the same type key. */
    isRoot = false,
  ): CompositionNode => {
    nodeCount++;

    // Match the node to a SWORD formation of the same nature and echelon.
    // Null above company level is the expected answer, not a failure: SWORD
    // composes brigades and divisions out of automats rather than carrying
    // them as catalogue entries, so those nodes stay structural.
    const formation = formations ? matchSwordFormation(formations, echelon, nature) : null;

    return {
      id: crypto.randomUUID(),
      unitIdentifier: label,
      echelon,
      sidc,
      entityType: "organisation",
      militaryService,
      affiliation: hostile ? "Hostile" : "Friend",
      allegiance: hostile ? "OPFOR" : "FRIENDLY",
      // Derived from the match. "SCENARIO_PLANNER" used to be written here,
      // which is not a value the schema accepts (vbs4 | simworks | ascot7 |
      // jtls-go | sword | mace) and not one the app recognises either, so
      // every generated node resolved to "no simulator" and slipped through
      // the asset gate untouched.
      owningSimulator: formation ? "sword" : "none",
      canonicalAssetKey: formation?.disCode || null,
      simulatorIdentifierCode: formation?.identifier ?? null,
      unitTypeKey: isRoot ? unit.templateId ?? null : null,
      equipmentTypeKey: null,
      quantity: 1,
      children: [],
    };
  };

  /**
   * Names are parent-qualified so they still read correctly in a flat list:
   *   1 Inf Div
   *     └─ 1 Bde, 1 Inf Div
   *          └─ 2 Bn, 1 Bde
   * The parent's own designator (not the whole chain) is enough to
   * disambiguate, and keeps names short enough for the map and the tree.
   */
  const expand = (
    node: CompositionNode,
    echelon: UnitEchelon,
    levelsLeft: number,
    parentQualifier: string,
  ): void => {
    if (levelsLeft <= 0) return;
    const nextEchelon = childEchelon(echelon);
    if (!nextEchelon) return;
    const count = SUBORDINATE_COUNT[echelon] ?? 0;
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
      if (nodeCount >= maxNodes) return;
      const ownDesignator = designator(nextEchelon, i);
      const child = makeNode(
        `${ownDesignator}, ${parentQualifier}`,
        nextEchelon,
        withEchelonGlyph(unit.sidc, nextEchelon),
      );
      node.children.push(child);

      // At an automat the ladder stops being a guess and SWORD has the answer.
      //
      // A SWORD automat is an AGGREGATE, not a leaf: "ARMOR.Heavy tank
      // company" is one simulated entity that already contains its platoons,
      // and Automats.xml states that composition explicitly.
      //
      // Two things can happen here and neither is "carry on down the ladder":
      //
      //   NO ROOM LEFT, or no expander — keep the automat as it is. It is a
      //   perfectly good leaf: SWORD spawns the whole company.
      //
      //   ROOM LEFT and an expander — replace it with its real composition.
      //   Note REPLACE: the node gives up its automat code and becomes
      //   structure, and the SWORD assets move down onto the constituents.
      //   Keeping the code AND adding children would put the same company in
      //   the exercise twice, which is the DOUBLE_COUNTED error in
      //   representation.ts and is live in the ontology today. The XML
      //   validates either way — OrganisationType allows a <Sword> class
      //   alongside children — which is why it has to be caught here.
      //
      // Either way the ladder does not continue: inventing "1 Pl, A Coy" when
      // the catalogue says "ART.Guns firing platoon ×3, 4 guns each" is
      // strictly worse information.
      if (isAutomatNode(child)) {
        if (levelsLeft - 1 <= 0 || !options.expandAutomat) continue;
        const expanded = options.expandAutomat(child);
        if (!expanded) continue;
        node.children[node.children.length - 1] = expanded;
        nodeCount += expanded.children.length;
        continue;
      }

      expand(child, nextEchelon, levelsLeft - 1, ownDesignator);
    }
  };

  const root = makeNode(unit.label, rootEchelon, unit.sidc, true);

  // The root gets the same treatment as any other automat, and it needs it:
  // placing a company on the map matches it to an automat, and the ladder
  // would then have generated three platoons underneath — the same company
  // twice, in the very first tree the app builds for a placement. The
  // automat check inside expand() never saw the root, because expand() only
  // examines the children it creates.
  if (isAutomatNode(root)) {
    if (depth <= 0 || !options.expandAutomat) return root;
    return options.expandAutomat(root) ?? root;
  }

  expand(root, rootEchelon, depth, unit.label);
  return root;
}

/** Total nodes in a composition tree (accounting for quantity). */
export function countNodes(node: CompositionNode): number {
  return (
    Math.max(1, node.quantity) +
    node.children.reduce((sum, c) => sum + countNodes(c) * Math.max(1, node.quantity), 0)
  );
}
