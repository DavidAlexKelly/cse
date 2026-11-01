import { Client } from "@osdk/client";
import { createEditBatch, Edits } from "@osdk/functions";

import { NxgUnitHierarchy, NxgOperation, NxgPhase } from "@ontology/sdk";

import { assertValidIsoDate, present, presentDate } from "../helpers.js";

/**
 * Updates the name, validity window, owning operation and/or phase of an
 * existing NxgUnitHierarchy.
 *
 * Only supplied values are written; an omitted argument leaves the stored
 * property untouched. Declared `T?` rather than `T | undefined`, because the
 * union form is a required parameter that merely accepts undefined, which made
 * every one of these mandatory and the action uncallable.
 *
 * operationKey used to be refused outright ("create a new hierarchy instead").
 * That guard has been relaxed, because re-pointing an existing ORBAT is a real
 * need — OPERATION-BALTIC-SHIELD and OP-BALTIC-SHIELD-2026 model one exercise
 * twice, and consolidating them means moving a hierarchy with 117 edges rather
 * than rebuilding it. Refusing the move did not prevent the problem, it only
 * pushed it into a bulk reconcile.
 *
 * It is relaxed, not removed: the target operation must exist. The original
 * concern was a hierarchy silently orphaning itself onto a bad key, and an
 * existence check answers that directly. The edges are unaffected either way —
 * they hang off hierarchyKey, not operationKey.
 *
 * phaseKey states which exercise phase this ORBAT is for. A phase hierarchy
 * holds a full standing force, not a delta from the previous phase.
 *
 * Property notes (from ontology):
 *   - validFrom / validTo are stored as the ontology `date` type (YYYY-MM-DD strings)
 *   - operationKey is the FK linking to NxgOperation.primaryKey_
 *   - phaseKey is the FK linking to NxgPhase.phaseId
 */
async function updateNxgUnitHierarchy(
  client: Client,
  primaryKey: string,
  name?: string,
  validFrom?: string,
  validTo?: string,
  operationKey?: string,
  phaseKey?: string
): Promise<Edits.Object<NxgUnitHierarchy>[]> {
  const hierarchy = await client(NxgUnitHierarchy)
    .fetchOne(primaryKey)
    .catch(() => undefined);
  if (hierarchy === undefined) {
    throw new Error(`NxgUnitHierarchy "${primaryKey}" does not exist`);
  }

  if (present(name) && name.trim().length === 0) {
    throw new Error(`name must not be empty`);
  }

  // presentDate(), not `!== undefined`: the Actions API prefills an unset
  // optional with explicit null, and an unfilled date field arrives as "".
  // Neither is a date, and neither should reach assertValidIsoDate.
  if (presentDate(validFrom)) {
    assertValidIsoDate(validFrom, "validFrom");
  }

  if (presentDate(validTo)) {
    assertValidIsoDate(validTo, "validTo");
    const effectiveValidFrom = presentDate(validFrom)
      ? validFrom
      : hierarchy.validFrom;
    if (effectiveValidFrom && validTo <= effectiveValidFrom) {
      throw new Error(
        `validTo "${validTo}" must be after validFrom "${effectiveValidFrom}"`
      );
    }
  }

  if (present(operationKey)) {
    const operation = await client(NxgOperation)
      .fetchOne(operationKey)
      .catch(() => undefined);
    if (operation === undefined) {
      throw new Error(
        `operationKey "${operationKey}" does not exist in NxgOperation`
      );
    }
  }

  if (present(phaseKey)) {
    const phase = await client(NxgPhase)
      .fetchOne(phaseKey)
      .catch(() => undefined);
    if (phase === undefined) {
      throw new Error(`phaseKey "${phaseKey}" does not exist in NxgPhase`);
    }
  }

  const batch = createEditBatch<Edits.Object<NxgUnitHierarchy>>(client);

  batch.update(hierarchy, {
    ...(present(name) && { name: name.trim() }),
    ...(presentDate(validFrom) && { validFrom }),
    ...(presentDate(validTo) && { validTo }),
    ...(present(operationKey) && { operationKey }),
    ...(present(phaseKey) && { phaseKey }),
  });

  return batch.getEdits();
}

export default updateNxgUnitHierarchy;
