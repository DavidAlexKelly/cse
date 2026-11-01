import { Client } from "@osdk/client";
import { createEditBatch, Edits, Double } from "@osdk/functions";

import { NxgTacticalGraphicSymbol, NxgUnit } from "@ontology/sdk";

import {
  assertValidLatitude,
  assertValidLongitude,
  present,
} from "../helpers.js";

/**
 * Creates a new NxgTacticalGraphicSymbol for a unit.
 *
 * Enforces one-symbol-per-unit uniqueness within the ontology.
 * Called immediately after createNxgUnit during composition placement.
 *
 * Property notes (from ontology):
 *   - unitKey FK → NxgUnit.primaryKey_ (drives the ONE_TO_ONE nxgTacticalGraphicSymbol link)
 *   - The symbol and unit share sidc, latitude, and longitude for consistency
 *
 * directionOfMovement is declared `Double?`, not `Double | undefined`: the
 * union form is a required parameter that merely accepts undefined, so Foundry
 * registered it as mandatory and a symbol could not be created without a
 * heading.
 */
async function createNxgTacticalGraphicSymbol(
  client: Client,
  primaryKey: string,
  unitKey: string,
  sidc: string,
  latitude: Double,
  longitude: Double,
  directionOfMovement?: Double
): Promise<Edits.Object<NxgTacticalGraphicSymbol>[]> {
  assertValidLatitude(latitude);
  assertValidLongitude(longitude);

  // present(), not `!== undefined` (the Actions API prefills unset optionals
  // with explicit null) and not truthiness — a heading of 0 is due north, a
  // perfectly good value that truthiness would throw away.
  if (
    present(directionOfMovement) &&
    (directionOfMovement < 0 || directionOfMovement > 360)
  ) {
    throw new Error(
      `directionOfMovement must be between 0 and 360. Got: ${directionOfMovement}`
    );
  }

  const existing = await client(NxgTacticalGraphicSymbol)
    .fetchOne(primaryKey)
    .catch(() => undefined);
  if (existing !== undefined) {
    throw new Error(
      `NxgTacticalGraphicSymbol with primaryKey "${primaryKey}" already exists`
    );
  }

  const unit = await client(NxgUnit)
    .fetchOne(unitKey)
    .catch(() => undefined);
  if (unit === undefined) {
    throw new Error(`unitKey "${unitKey}" does not exist in NxgUnit`);
  }

  const { data: existingSymbols } = await client(NxgTacticalGraphicSymbol)
    .where({ unitKey: { $eq: unitKey } })
    .fetchPage();

  if (existingSymbols.length > 0) {
    throw new Error(
      `A TacticalGraphicSymbol already exists for unit "${unitKey}". ` +
        `Delete the existing symbol before creating a new one.`
    );
  }

  const batch = createEditBatch<Edits.Object<NxgTacticalGraphicSymbol>>(client);

  batch.create(NxgTacticalGraphicSymbol, {
    primaryKey_: primaryKey,
    unitKey,
    sidc,
    latitude,
    longitude,
    ...(present(directionOfMovement) && { directionOfMovement }),
  });

  return batch.getEdits();
}

export default createNxgTacticalGraphicSymbol;
