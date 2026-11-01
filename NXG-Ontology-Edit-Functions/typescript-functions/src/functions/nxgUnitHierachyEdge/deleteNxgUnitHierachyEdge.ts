import { Client } from "@osdk/client";
import { createEditBatch, Edits } from "@osdk/functions";

import { NxgUnitHierachyEdge } from "@ontology/sdk";

/**
 * Deletes an NxgUnitHierachyEdge.
 *
 * Does not cascade — parent and child units are left intact.
 */
async function deleteNxgUnitHierachyEdge(
  client: Client,
  primaryKey: string
): Promise<Edits.Object<NxgUnitHierachyEdge>[]> {
  const edge = await client(NxgUnitHierachyEdge).fetchOne(primaryKey).catch(() => undefined);
  if (edge === undefined) {
    throw new Error(`NxgUnitHierachyEdge "${primaryKey}" does not exist`);
  }

  const batch = createEditBatch<Edits.Object<NxgUnitHierachyEdge>>(client);
  batch.delete(edge);
  return batch.getEdits();
}

export default deleteNxgUnitHierachyEdge;
