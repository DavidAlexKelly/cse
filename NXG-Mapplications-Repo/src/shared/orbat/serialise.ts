// src/shared/orbat/serialise.ts
//
// Pure helpers for turning what is on the map into what the reconcile function
// eats. Kept out of generate.ts because that module imports "@/client", which
// reads <meta> tags at load and cannot run outside a browser — these need to be
// unit-testable.

import type { CompositionNode } from "@/shared/types";
import type { PlacedUnit } from "../../apps/scenarioPlanner/map/types";
import { isOrbatEligible } from "./eligibility";
import type { ReconcileEdge, ReconcileUnit } from "./hierarchy";
import { ORGANIC_RELATIONSHIP_KEY, ontologyDate } from "./model";

/** A generated ORBAT, flattened into what the reconcile function wants. */
export interface SerialisedOrbat {
  rootUnitKey: string;
  units: ReconcileUnit[];
  /** Internal parent → child edges. Excludes the root's own parentage. */
  edges: ReconcileEdge[];
}

/**
 * Flatten a CompositionNode tree into units and edges.
 *
 * Mirrors createCompositionInOntology's semantics — quantity expands into that
 * many units, suffixed " 1", " 2" … — minus the NxgTacticalGraphicSymbol rows,
 * which are not wanted here. The root carries the placement's position so the
 * unit is locatable without a symbol; subordinates have none, as before.
 */
export function serialiseComposition(
  root: CompositionNode,
  options: {
    lat: number;
    lng: number;
    validFrom?: string;
    /** Key generator, injectable so tests are deterministic. */
    newKey?: () => string;
  },
): SerialisedOrbat {
  const validFrom = options.validFrom ?? ontologyDate();
  const newKey = options.newKey ?? (() => crypto.randomUUID());
  const units: ReconcileUnit[] = [];
  const edges: ReconcileEdge[] = [];
  let rootUnitKey = "";

  const walk = (node: CompositionNode, parentUnitKey: string | null): void => {
    const copies = Math.max(1, node.quantity);
    for (let i = 0; i < copies; i++) {
      const unitKey = newKey();
      const isRoot = parentUnitKey === null && i === 0;
      if (isRoot) rootUnitKey = unitKey;

      units.push({
        primaryKey: unitKey,
        unitIdentifier: copies > 1 ? `${node.unitIdentifier} ${i + 1}` : node.unitIdentifier,
        entityType: node.entityType,
        // Everything the node knows about how it will be simulated, sent on.
        //
        // These three were hardcoded to "none" / omitted, which quietly threw
        // away the whole point of matching a generated formation to a SWORD
        // automat: buildOrbatSkeleton would resolve "ARMOR.Heavy tank
        // company", set owningSimulator to "sword" and attach its DIS code,
        // and this function dropped all of it on the way to the reconcile. So
        // every ORBAT produced by the bulk generator — which is the path the
        // Scenario Planner uses — landed structural, with no asset links, no
        // matter how well the match had gone.
        //
        // (The reconcile function had two matching defects that hid this: it
        // mapped "sword" to "none", and it wrote the canonical asset under a
        // property name that does not exist. Both are fixed in the translator
        // alongside this; sending the fields is useless without them.)
        owningSimulator: node.owningSimulator || "none",
        simulatorIdentifierCode: node.simulatorIdentifierCode ?? null,
        dis6Code: node.canonicalAssetKey ?? null,
        dis: "0.0.0.0.0.0.0",
        canControlDrones: false,
        militaryService: node.militaryService,
        echelon: node.echelon,
        sidc: node.sidc,
        affiliation: node.affiliation,
        allegiance: node.allegiance,
        latitude: isRoot ? options.lat : null,
        longitude: isRoot ? options.lng : null,
        unitTypeKey: node.unitTypeKey,
        equipmentTypeKey: node.equipmentTypeKey,
      });

      if (parentUnitKey) {
        edges.push({
          parentUnitKey,
          childUnitKey: unitKey,
          relationshipTypeKey: ORGANIC_RELATIONSHIP_KEY,
          validFrom,
        });
      }

      for (const child of node.children) walk(child, unitKey);
    }
  };

  walk(root, null);
  return { rootUnitKey, units, edges };
}

/**
 * Identity of a placement ACROSS phases.
 *
 * A unit that already has an ORBAT is identified by its root key. One that
 * doesn't has no ontology identity yet, so fall back to the placement id, then
 * to label + SIDC — hand-authored phase states reuse ids, but generated ones
 * don't, and generating four ORBATs for the same battalion because it appears
 * in four phases would be worse than the problem this solves.
 */
export function identityOf(unit: PlacedUnit): string {
  return unit.orbatRootUnitKey ?? `${unit.id}|${unit.label}|${unit.sidc}`;
}

export function withoutOrbat(unit: PlacedUnit): boolean {
  return !unit.orbatRootUnitKey && isOrbatEligible(unit);
}

/** How many placements would be generated for — drives the button's label. */
export function countPlacementsWithoutOrbat(placements: PlacedUnit[]): number {
  const seen = new Set<string>();
  for (const placement of placements) {
    if (!withoutOrbat(placement)) continue;
    seen.add(identityOf(placement));
  }
  return seen.size;
}
