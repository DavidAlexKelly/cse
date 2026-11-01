// src/shared/orbat/model.ts
//
// Pure ORBAT vocabulary: no OSDK client, no ontology calls, no DOM.
//
// These live apart from scenarioOrbat.ts deliberately. That module imports
// "@/client", which reads configuration from <meta> tags at module load — so
// anything importing it drags a browser dependency in, and the reconciler's
// pure functions could not be unit tested. Splitting the vocabulary out keeps
// hierarchy.ts and its tests free of that.
//
// scenarioOrbat.ts re-exports everything here, so existing imports still work.

/** Which force a unit belongs to. */
export type Side = "blue" | "red";

/**
 * Command relationship for a parent → child ORBAT edge.
 *
 * NxgUnitHierachyEdge.relationshipTypeKey is a foreign key into
 * NxgUnitHierarchyNodeRelationshipType, whose keys are RELTYPE-ORGANIC,
 * RELTYPE-OPCON, RELTYPE-TACON, RELTYPE-ATTACHED and RELTYPE-ASSIGNED.
 * "ORGANIC" is permanent subordination, which is what a unit's own ORBAT is.
 *
 * (Both the TypeScript client and the Python import function previously used
 * values that matched nothing — "COMMAND" and "ORGANIC" respectively — so every
 * edge carried a dangling reference.)
 */
export const ORGANIC_RELATIONSHIP_KEY = "RELTYPE-ORGANIC";

/**
 * Date string for validFrom / validTo.
 *
 * These action parameters are typed `string`, but the properties behind them
 * are `date` in the ontology (confirmed on NxgUnitHierachyEdge and
 * NxgUnitHierarchy) — the generated SDK .d.ts claims `datetime`, which is
 * wrong. The same trap is documented for NxgOTemplateOrbatGraph.createdAt.
 */
export function ontologyDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Side a placed unit belongs to, from its SIDC affiliation char. */
export function sideForSidc(sidc: string | undefined): Side {
  const aff = (sidc?.[1] ?? "F").toUpperCase();
  return aff === "H" || aff === "S" ? "red" : "blue";
}
