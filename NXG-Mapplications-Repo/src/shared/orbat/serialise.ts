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
import { ORGANIC_RELATIONSHIP_KEY, ontologyDate, PLACEHOLDER_DIS } from "./model";
import { ringPositions } from "./ringLayout";

/** A generated ORBAT, flattened into what the reconcile function wants. */
export interface SerialisedOrbat {
  rootUnitKey: string;
  units: ReconcileUnit[];
  /** Internal parent → child edges. Excludes the root's own parentage. */
  edges: ReconcileEdge[];
  /** True when maxUnits stopped the walk before the whole tree was written. */
  truncated: boolean;
}

export interface SerialiseOptions {
  lat: number;
  lng: number;
  validFrom?: string;
  /** Key generator, injectable so tests are deterministic. */
  newKey?: () => string;
  /**
   * Key for a specific node copy. Overrides newKey when it returns a value —
   * a phase ORBAT uses it to keep keys phase-prefixed, and "generate beneath"
   * to reuse an existing unit's key for the root.
   */
  keyFor?: (
    node: CompositionNode,
    info: { isRoot: boolean; copyIndex: number },
  ) => string | undefined;
  /**
   * "root-only" (default, the scenario-wide behaviour): only the root is
   * positioned. "ring": every unit is positioned on a ring around its parent
   * (see ringLayout.ts) — what a phase ORBAT needs, because CSE spawns from
   * NxgUnit lat/lng.
   */
  layout?: "root-only" | "ring";
  /** Depth of the root in its tree, so ring radii match where it sits. Default 0. */
  rootDepth?: number;
  /**
   * Leave the root's own unit row out. For expanding beneath a unit that
   * already exists: its properties are not ours to rewrite.
   */
  omitRootUnit?: boolean;
  /** Stop writing after this many units. The walk is breadth-first, so whole levels survive. */
  maxUnits?: number;
}

/**
 * Flatten a CompositionNode tree into units and edges.
 *
 * Mirrors createCompositionInOntology's semantics — quantity expands into that
 * many units, suffixed " 1", " 2" … — minus the NxgTacticalGraphicSymbol rows,
 * which are not wanted here.
 *
 * Root quantity is kept: every copy of the root sits at the placed position
 * and the FIRST copy is the ORBAT root.
 */
export function serialiseComposition(
  root: CompositionNode,
  options: SerialiseOptions,
): SerialisedOrbat {
  const validFrom = options.validFrom ?? ontologyDate();
  const newKey = options.newKey ?? (() => crypto.randomUUID());
  const ring = options.layout === "ring";
  const rootDepth = options.rootDepth ?? 0;
  const maxUnits = options.maxUnits ?? Number.POSITIVE_INFINITY;
  const units: ReconcileUnit[] = [];
  const edges: ReconcileEdge[] = [];
  let rootUnitKey = "";
  let truncated = false;
  let written = 0;

  interface Item {
    node: CompositionNode;
    parentUnitKey: string | null;
    copyIndex: number;
    copies: number;
    depth: number;
    pos: { lat: number; lng: number } | null;
  }

  // Breadth-first, so a cap keeps every higher level whole.
  const rootCopies = Math.max(1, root.quantity);
  const queue: Item[] = [];
  for (let i = 0; i < rootCopies; i++) {
    queue.push({
      node: root,
      parentUnitKey: null,
      copyIndex: i,
      copies: rootCopies,
      depth: rootDepth,
      pos: { lat: options.lat, lng: options.lng },
    });
  }

  for (let q = 0; q < queue.length; q++) {
    const { node, parentUnitKey, copyIndex: i, copies, depth, pos } = queue[q];
    {
      const isRoot = parentUnitKey === null && i === 0;
      const isRootRow = parentUnitKey === null;
      const unitKey = options.keyFor?.(node, { isRoot, copyIndex: i }) ?? newKey();
      if (isRoot) rootUnitKey = unitKey;

      const emitRow = !(isRootRow && options.omitRootUnit);
      if (emitRow && written >= maxUnits) {
        truncated = true;
        break;
      }
      const position = isRootRow || ring ? pos : null;

      if (emitRow) {
        written++;
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
          dis: PLACEHOLDER_DIS,
          canControlDrones: false,
          militaryService: node.militaryService,
          echelon: node.echelon,
          sidc: node.sidc,
          affiliation: node.affiliation,
          allegiance: node.allegiance,
          latitude: position?.lat ?? null,
          longitude: position?.lng ?? null,
          unitTypeKey: node.unitTypeKey,
          equipmentTypeKey: node.equipmentTypeKey,
        });
      }

      if (parentUnitKey) {
        edges.push({
          parentUnitKey,
          childUnitKey: unitKey,
          relationshipTypeKey: ORGANIC_RELATIONSHIP_KEY,
          validFrom,
        });
      }

      // Every copy of every child gets its own slot on this unit's ring.
      const childCopies = node.children.map((c) => Math.max(1, c.quantity));
      const slots =
        ring && pos
          ? ringPositions(
              pos,
              childCopies.reduce((a, b) => a + b, 0),
              depth + 1,
            )
          : [];
      let slot = 0;
      node.children.forEach((child, c) => {
        for (let k = 0; k < childCopies[c]; k++) {
          queue.push({
            node: child,
            parentUnitKey: unitKey,
            copyIndex: k,
            copies: childCopies[c],
            depth: depth + 1,
            pos: slots[slot++] ?? pos,
          });
        }
      });
    }
  }

  return { rootUnitKey, units, edges, truncated };
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
