import { Client } from "@osdk/client";
import { createEditBatch, Edits } from "@osdk/functions";

import { NxgUnitHierarchy, NxgOperation, NxgPhase } from "@ontology/sdk";

import { assertValidIsoDate, present, presentDate } from "../helpers.js";

/**
 * Creates a new NxgUnitHierarchy.
 *
 * operationKey is optional — reference hierarchies (standing TO&E)
 * are not linked to a specific operation.
 *
 * phaseKey is optional too, and carries the intent of the ORBAT. Set, the
 * hierarchy is the force laid out for one exercise phase; null, it is
 * phase-agnostic — a standing reference ORBAT such as HIER-BALTIC-SHIELD-REF.
 *
 * A phase hierarchy holds a FULL STANDING FORCE, not a delta from the phase
 * before it, and holds BOTH SIDES as separate root trees. That is what lets a
 * phase export as one document with two root Organisations, which validate.xsd
 * permits via maxOccurs="unbounded" on <Entities>. Lineage between phases is
 * recorded on NxgPhase.basedOnPhaseId, not here.
 *
 * Property notes (from ontology):
 *   - validFrom / validTo are stored as the ontology `date` type (YYYY-MM-DD strings)
 *   - operationKey is the FK linking to NxgOperation.primaryKey_
 *   - phaseKey is the FK linking to NxgPhase.phaseId
 *
 * PARAMETER ORDER CHANGED. operationKey and validTo now trail validFrom, where
 * previously operationKey sat between name and validFrom. They had to move:
 * both are optional, `T?` is the only declaration Foundry reads as optional,
 * and TypeScript forbids a required parameter after an optional one — so
 * validFrom could not stay where it was.
 *
 * This is safe for the bound action because actions map arguments by NAME, via
 * functionParameterId, not by position. Any caller invoking the function
 * positionally in TypeScript would need updating, and there are none in this
 * repo.
 */
async function createNxgUnitHierarchy(
  client: Client,
  primaryKey: string,
  name: string,
  validFrom: string,
  operationKey?: string,
  validTo?: string,
  phaseKey?: string
): Promise<Edits.Object<NxgUnitHierarchy>[]> {
  assertValidIsoDate(validFrom, "validFrom");

  // presentDate(), not `!== undefined`: the Actions API prefills an unset
  // optional with explicit null, and an unfilled date field arrives as "".
  // Neither is a date, and neither should reach assertValidIsoDate.
  if (presentDate(validTo)) {
    assertValidIsoDate(validTo, "validTo");
    if (validTo <= validFrom) {
      throw new Error(
        `validTo "${validTo}" must be after validFrom "${validFrom}"`
      );
    }
  }

  if (!name || name.trim().length === 0) {
    throw new Error(`name must not be empty`);
  }

  const existing = await client(NxgUnitHierarchy)
    .fetchOne(primaryKey)
    .catch(() => undefined);
  if (existing !== undefined) {
    throw new Error(
      `NxgUnitHierarchy with primaryKey "${primaryKey}" already exists`
    );
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

  batch.create(NxgUnitHierarchy, {
    primaryKey_: primaryKey,
    name: name.trim(),
    validFrom,
    ...(present(operationKey) && { operationKey }),
    ...(presentDate(validTo) && { validTo }),
    ...(present(phaseKey) && { phaseKey }),
  });

  return batch.getEdits();
}

export default createNxgUnitHierarchy;
