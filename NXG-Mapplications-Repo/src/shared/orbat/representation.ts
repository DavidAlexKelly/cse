// src/shared/orbat/representation.ts
//
// What a node BECOMES in the federation.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS RULE IS MIRRORED IN PYTHON.
// Any change here must be made in the translator too:
//   [NXG] Translator → python-functions/python/src/representation.py
// The two test files carry the same case table, in the same order, under the
// same names, so a diff between them is readable:
//   src/shared/orbat/representation.test.ts
//   python-functions/python/tests/test_representation.py
// ─────────────────────────────────────────────────────────────────────────────
//
// Why this concept is needed
// --------------------------
// `entityType` says what a node IS militarily — an organisation, a vehicle, a
// person. It does not say what the federation will DO with it, and those two
// have quietly diverged. Three organisations in the ontology today carry a
// SWORD automat code AND have vehicle children:
//
//   Air Defence Battery            AAA.Surface to air battery|automat
//     ├── AD Battery CP Vehicle              (vehicle)
//     ├── Anti-aircraft Tank Alpha           (vehicle)
//     └── Target Detection Vehicle Alpha     (vehicle)
//
// SWORD spawns "AAA.Surface to air battery" whole — the automat already
// contains its command post, its launchers and its radar, stated in
// Automats.xml as min-occurs/max-occurs. VBS4 then separately spawns the three
// vehicles beneath it. The same battery is in the exercise twice.
//
// Nothing in the model could express that, because there was no word for the
// difference between "this node is structure" and "this node is a thing SWORD
// instantiates". `representation` is that word.
//
// The rule
// --------
//   1. vehicle / human / aircraft            → entity
//   2. organisation + SWORD "…|automat" code → automat
//   3. organisation + SWORD "…|unit" code    → subformation
//   4. organisation, anything else           → aggregate
//
// Rule 1 comes first deliberately: a vehicle with no model chosen yet is an
// INCOMPLETE entity, not a structure. assetEligibility already reports that,
// and representation should not disagree with it.
//
// Rule 4 absorbs two cases that look different and behave the same. An
// organisation with no code is plain structure. An organisation carrying a
// platform code — and three do, e.g. Light Gun Section → "GBR L118
// (ARTILLERY)" — is ALSO plain structure, because an <Organisation> in the CSE
// schema may only carry an OrganisationExtension, and the only one defined is
// <sword:Sword>. A SimWorks className on an organisation cannot be emitted at
// all; it is silently dropped at export. Calling that node an entity would
// claim a platform gets spawned for it, and none does.
//
// Derived, not stored — for now
// -----------------------------
// This is a pure function of two properties that already exist on NxgUnit, so
// there is nothing to migrate and nothing to keep in sync. When it becomes a
// stored `representation` property (it needs a column on the Unit dataset and
// parameters on Create/Update Unit), this function supplies the default and
// the backfill.

import type { CompositionNode } from "../types/index";

/**
 * How a node is realised in the federation.
 *
 * Ordered coarse → fine, which is also the order the export projection cares
 * about: an aggregate contributes nothing, an automat contributes one SWORD
 * unit, an entity contributes one platform.
 */
export type Representation = "aggregate" | "automat" | "subformation" | "entity";

/** Suffix on a SWORD catalogue identifier for an aggregate SWORD spawns whole. */
export const AUTOMAT_SUFFIX = "|automat";

/**
 * Suffix on a SWORD catalogue identifier for an automat's internal composition.
 *
 * "unit" is SWORD's Pion: the platoons, sections and command posts an automat
 * is made of. 163 of the 244 catalogue rows are these. They are offered in the
 * asset picker, so a planner can pick one, which is why `subformation` is a
 * real case and not a hypothetical one.
 */
export const UNIT_SUFFIX = "|unit";

/** The `entityType` values that are physical things rather than structure. */
export const PHYSICAL_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "vehicle",
  "human",
  "aircraft",
]);

/** The minimum a node has to expose for its representation to be derived. */
export interface RepresentableNode {
  entityType: string;
  simulatorIdentifierCode?: string | null;
}

/**
 * What this node becomes in the federation. See the rule at the top of the file.
 */
export function representationOf(node: RepresentableNode): Representation {
  if (PHYSICAL_ENTITY_TYPES.has(node.entityType)) return "entity";

  const code = (node.simulatorIdentifierCode ?? "").trim();
  if (code.endsWith(AUTOMAT_SUFFIX)) return "automat";
  if (code.endsWith(UNIT_SUFFIX)) return "subformation";
  return "aggregate";
}

/** Short label for the UI and for error messages. */
export const REPRESENTATION_LABELS: Record<Representation, string> = {
  aggregate: "Structure",
  automat: "SWORD automat",
  subformation: "SWORD sub-formation",
  entity: "Simulated entity",
};

/**
 * True when nothing below this node should exist: the node already contains it.
 *
 * An automat is a single aggregate that SWORD instantiates complete with its
 * own sub-units and their equipment. A sub-formation is one slice of such an
 * aggregate — SWORD builds its equipment from the catalogue, not from our tree.
 * In both cases anything we put underneath is a second copy of the same force.
 */
export function isSelfContained(representation: Representation): boolean {
  return representation === "automat" || representation === "subformation";
}

/** Convenience: does this node describe a SWORD aggregate SWORD spawns whole? */
export function isAutomatNode(node: RepresentableNode): boolean {
  return representationOf(node) === "automat";
}

// ───────────────────────────────────────────────────────────────────────────
// The assertion: an automat may not have entity descendants
// ───────────────────────────────────────────────────────────────────────────

/** One node the tree walk found in the wrong place. */
export interface DoubleCountedNode {
  /** The offending descendant. */
  node: RepresentableNode & { id?: string; unitIdentifier?: string };
  /** The automat (or sub-formation) it sits beneath. */
  ancestor: RepresentableNode & { id?: string; unitIdentifier?: string };
  /** Human-readable explanation, safe to show a planner. */
  message: string;
}

type TreeNode = RepresentableNode & {
  id?: string;
  unitIdentifier?: string;
  children?: readonly TreeNode[];
};

function nameOf(node: TreeNode): string {
  return node.unitIdentifier || node.id || "(unnamed unit)";
}

/**
 * Every entity that sits beneath a self-contained node.
 *
 * The generator cannot produce this any more — it stops descending at an
 * automat — but two other paths still can, and both are in daily use:
 * importing an ORBAT built elsewhere, and a planner hand-adding a child in the
 * ORBAT Manager. So the check belongs on the tree, not in the generator.
 *
 * The walk does NOT stop at the first offender: a battery with four vehicles
 * under it is four problems, and a planner fixing them one at a time would
 * otherwise have to re-run the check after each.
 *
 * It DOES stop descending past an entity, because crew inside a vehicle are
 * carried by the vehicle rather than spawned separately — that nesting is
 * correct and is not what this is looking for.
 */
export function findDoubleCountedDescendants(root: TreeNode): DoubleCountedNode[] {
  const found: DoubleCountedNode[] = [];

  function walk(node: TreeNode, selfContainedAncestor: TreeNode | null): void {
    const representation = representationOf(node);

    if (selfContainedAncestor && representation === "entity") {
      const ancestorKind = REPRESENTATION_LABELS[representationOf(selfContainedAncestor)];
      found.push({
        node,
        ancestor: selfContainedAncestor,
        message:
          `"${nameOf(node)}" sits beneath "${nameOf(selfContainedAncestor)}", which is a ` +
          `${ancestorKind} — SWORD spawns that whole, already containing its sub-units and ` +
          `their equipment. Anything beneath it puts the same force in the exercise twice. ` +
          `Either remove "${nameOf(node)}", or clear the SWORD asset on ` +
          `"${nameOf(selfContainedAncestor)}" so it becomes plain structure.`,
      });
      // An entity's children are its crew; they move with it. Nothing below is
      // a separate finding.
      return;
    }

    if (representation === "entity") return;

    const ancestor = selfContainedAncestor ?? (isSelfContained(representation) ? node : null);
    for (const child of node.children ?? []) walk(child, ancestor);
  }

  walk(root, null);
  return found;
}

/**
 * Throw if any entity sits beneath an automat.
 *
 * Called alongside assertCompositionEligible, before a composition is written.
 */
export function assertNoDoubleCounting(root: TreeNode): void {
  const found = findDoubleCountedDescendants(root);
  if (!found.length) return;

  const shown = found
    .slice(0, 5)
    .map((f) => `  • ${f.message}`)
    .join("\n");
  const more = found.length > 5 ? `\n  …and ${found.length - 5} more.` : "";
  throw new Error(
    `Cannot write "${nameOf(root)}": ${found.length} unit(s) are counted twice.\n${shown}${more}`,
  );
}

/**
 * Narrowing helper so callers holding a CompositionNode need no cast.
 *
 * CompositionNode.entityType is a union of four string literals and
 * RepresentableNode.entityType is `string`, so this is widening rather than a
 * real conversion — it exists to keep the intent legible at call sites.
 */
export function representationOfNode(node: CompositionNode): Representation {
  return representationOf(node);
}
