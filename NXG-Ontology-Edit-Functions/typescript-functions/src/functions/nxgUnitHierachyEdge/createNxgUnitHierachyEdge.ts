import { Client } from "@osdk/client";
import { createEditBatch, Edits } from "@osdk/functions";

import {
  NxgUnitHierachyEdge,
  NxgUnitHierarchy,
  NxgUnit,
  NxgUnitHierarchyNodeRelationshipType,
} from "@ontology/sdk";

import { assertValidIsoDate, presentDate } from "../helpers.js";

/**
 * Creates a new NxgUnitHierachyEdge linking a parent unit to a child
 * unit within a named hierarchy.
 *
 * Enforces:
 *   - Both units must exist
 *   - Hierarchy must exist
 *   - Relationship type must exist
 *   - A unit may only have one parent per hierarchy
 *   - Direct circular references (A→B where B→A already exists) are rejected
 *
 * Property notes (from ontology):
 *   - hierarchyKey FK → NxgUnitHierarchy.primaryKey_
 *   - parentUnitKey FK → NxgUnit.primaryKey_ (drives nxgUnitHierachyEdges link)
 *   - childUnitKey FK → NxgUnit.primaryKey_ (drives nxgChildUnitHierachyEdges link)
 *   - relationshipTypeKey FK → NxgUnitHierarchyNodeRelationshipType.primaryKey_
 *   - validFrom / validTo are stored as the ontology `date` type (YYYY-MM-DD strings)
 *
 * validTo is declared `validTo?: string`, NOT `validTo: string | undefined`.
 * The two are not the same thing and the difference is why this action could
 * not be called. In TypeScript `x: string | undefined` is a REQUIRED parameter
 * that happens to accept the value undefined — the caller must still pass
 * something — whereas `x?: string` is genuinely optional. Foundry derives the
 * function's input spec from that signature, so the union form registered
 * validTo as required and every call omitting it (or passing explicit null,
 * which is how the action API prefills an absent optional) came back as
 * FunctionExecutionHasInvalidInputs / missingArgument naming exactly the
 * parameters left null.
 *
 * Note the ordering constraint this imposes: TypeScript will not allow a
 * required parameter after an optional one, so this only works while the
 * optional parameters are trailing.
 */
async function createNxgUnitHierachyEdge(
  client: Client,
  primaryKey: string,
  hierarchyKey: string,
  parentUnitKey: string,
  childUnitKey: string,
  relationshipTypeKey: string,
  validFrom: string,
  validTo?: string
): Promise<Edits.Object<NxgUnitHierachyEdge>[]> {
  assertValidIsoDate(validFrom, "validFrom");
  // presentDate(), not `!== undefined`. "Absent" reaches this function in three
  // spellings: undefined when genuinely omitted, explicit null because that is
  // what the Actions API prefills an unset optional with, and "" from a form
  // field that was never filled in. All three mean "no end date", and the
  // stricter check let null and "" through to assertValidIsoDate.
  if (presentDate(validTo)) {
    assertValidIsoDate(validTo, "validTo");
    if (validTo <= validFrom) {
      throw new Error(
        `validTo "${validTo}" must be after validFrom "${validFrom}"`
      );
    }
  }

  if (parentUnitKey === childUnitKey) {
    throw new Error(
      `parentUnitKey and childUnitKey must be different. Got: "${parentUnitKey}" for both`
    );
  }

  const existingEdge = await client(NxgUnitHierachyEdge)
    .fetchOne(primaryKey)
    .catch(() => undefined);
  if (existingEdge !== undefined) {
    throw new Error(
      `NxgUnitHierachyEdge with primaryKey "${primaryKey}" already exists`
    );
  }

  const hierarchy = await client(NxgUnitHierarchy)
    .fetchOne(hierarchyKey)
    .catch(() => undefined);
  if (hierarchy === undefined) {
    throw new Error(
      `hierarchyKey "${hierarchyKey}" does not exist in NxgUnitHierarchy`
    );
  }

  const parentUnit = await client(NxgUnit)
    .fetchOne(parentUnitKey)
    .catch(() => undefined);
  if (parentUnit === undefined) {
    throw new Error(
      `parentUnitKey "${parentUnitKey}" does not exist in NxgUnit`
    );
  }

  const childUnit = await client(NxgUnit)
    .fetchOne(childUnitKey)
    .catch(() => undefined);
  if (childUnit === undefined) {
    throw new Error(`childUnitKey "${childUnitKey}" does not exist in NxgUnit`);
  }

  const relType = await client(NxgUnitHierarchyNodeRelationshipType)
    .fetchOne(relationshipTypeKey)
    .catch(() => undefined);
  if (relType === undefined) {
    throw new Error(
      `relationshipTypeKey "${relationshipTypeKey}" does not exist in NxgUnitHierarchyNodeRelationshipType`
    );
  }

  const { data: existingParentEdges } = await client(NxgUnitHierachyEdge)
    .where({
      $and: [
        { hierarchyKey: { $eq: hierarchyKey } },
        { childUnitKey: { $eq: childUnitKey } },
      ],
    })
    .fetchPage();

  if (existingParentEdges.length > 0) {
    throw new Error(
      `Unit "${childUnitKey}" already has a parent in hierarchy "${hierarchyKey}". ` +
        `Remove the existing edge first.`
    );
  }

  const { data: directCycleEdges } = await client(NxgUnitHierachyEdge)
    .where({
      $and: [
        { hierarchyKey: { $eq: hierarchyKey } },
        { parentUnitKey: { $eq: childUnitKey } },
        { childUnitKey: { $eq: parentUnitKey } },
      ],
    })
    .fetchPage();

  if (directCycleEdges.length > 0) {
    throw new Error(
      `Creating this edge would create a direct circular reference ` +
        `between "${parentUnitKey}" and "${childUnitKey}" in hierarchy "${hierarchyKey}"`
    );
  }

  const batch = createEditBatch<Edits.Object<NxgUnitHierachyEdge>>(client);

  batch.create(NxgUnitHierachyEdge, {
    primaryKey_: primaryKey,
    hierarchyKey,
    parentUnitKey,
    childUnitKey,
    relationshipTypeKey,
    validFrom,
    ...(presentDate(validTo) && { validTo }),
  });

  return batch.getEdits();
}

export default createNxgUnitHierachyEdge;
