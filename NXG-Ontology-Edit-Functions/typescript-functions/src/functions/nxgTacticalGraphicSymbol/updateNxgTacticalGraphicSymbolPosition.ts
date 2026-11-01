import { Client } from "@osdk/client";
import { createEditBatch, Edits, Double } from "@osdk/functions";

import { NxgTacticalGraphicSymbol, NxgUnit } from "@ontology/sdk";

import {
  assertValidLatitude,
  assertValidLongitude,
  present,
} from "../helpers.js";

type NxgSymbolEdit =
  | Edits.Object<NxgTacticalGraphicSymbol>
  | Edits.Object<NxgUnit>;

/**
 * Updates the map position (and optionally direction of movement)
 * of an existing NxgTacticalGraphicSymbol.
 *
 * Also syncs latitude/longitude back to the linked NxgUnit so that
 * the unit's position property stays consistent with its symbol.
 *
 * Link notes (from ontology):
 *   - NxgUnit ←(1-to-1)→ NxgTacticalGraphicSymbol via NxgTacticalGraphicSymbol.unitKey
 *   - Position sync writes NxgUnit.latitude / NxgUnit.longitude directly
 *
 * directionOfMovement is declared `Double?`, not `Double | undefined`: the
 * union form is a required parameter that merely accepts undefined, so Foundry
 * registered it as mandatory and a symbol could not be dragged to a new
 * position without also restating its heading.
 */
async function updateNxgTacticalGraphicSymbolPosition(
  client: Client,
  primaryKey: string,
  latitude: Double,
  longitude: Double,
  directionOfMovement?: Double
): Promise<NxgSymbolEdit[]> {
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

  const symbol = await client(NxgTacticalGraphicSymbol)
    .fetchOne(primaryKey)
    .catch(() => undefined);
  if (symbol === undefined) {
    throw new Error(`NxgTacticalGraphicSymbol "${primaryKey}" does not exist`);
  }

  const batch = createEditBatch<NxgSymbolEdit>(client);

  batch.update(symbol, {
    latitude,
    longitude,
    ...(present(directionOfMovement) && { directionOfMovement }),
  });

  // Sync position back to the linked NxgUnit (unitKey → NxgUnit.primaryKey_)
  if (symbol.unitKey !== undefined) {
    const unit = await client(NxgUnit)
      .fetchOne(symbol.unitKey)
      .catch(() => undefined);
    if (unit !== undefined) {
      batch.update(unit, { latitude, longitude });
    }
  }

  return batch.getEdits();
}

export default updateNxgTacticalGraphicSymbolPosition;
