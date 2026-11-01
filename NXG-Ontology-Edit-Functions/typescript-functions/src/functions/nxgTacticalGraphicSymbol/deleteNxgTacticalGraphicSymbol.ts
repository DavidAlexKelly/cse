import { Client } from "@osdk/client";
import { createEditBatch, Edits } from "@osdk/functions";

import { NxgTacticalGraphicSymbol } from "@ontology/sdk";

/**
 * Deletes an NxgTacticalGraphicSymbol.
 *
 * Does not cascade — unit is left intact. Use deleteNxgUnit with
 * cascadeSymbol: true if you want to remove both together.
 */
async function deleteNxgTacticalGraphicSymbol(
  client: Client,
  primaryKey: string
): Promise<Edits.Object<NxgTacticalGraphicSymbol>[]> {
  const symbol = await client(NxgTacticalGraphicSymbol).fetchOne(primaryKey).catch(() => undefined);
  if (symbol === undefined) {
    throw new Error(`NxgTacticalGraphicSymbol "${primaryKey}" does not exist`);
  }

  const batch = createEditBatch<Edits.Object<NxgTacticalGraphicSymbol>>(client);
  batch.delete(symbol);
  return batch.getEdits();
}

export default deleteNxgTacticalGraphicSymbol;
