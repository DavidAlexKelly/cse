import { Client } from "@osdk/client";
import { createEditBatch, Edits } from "@osdk/functions";

import {
  NxgUnit,
  NxgTacticalGraphicSymbol,
  NxgUnitHierachyEdge,
} from "@ontology/sdk";

type NxgUnitEdit =
  | Edits.Object<NxgUnit>
  | Edits.Object<NxgTacticalGraphicSymbol>
  | Edits.Object<NxgUnitHierachyEdge>;

/**
 * Deletes an NxgUnit and optionally cascades to its linked
 * TacticalGraphicSymbol and UnitHierarchyEdges.
 *
 * cascadeSymbol: also delete the linked TacticalGraphicSymbol
 * cascadeEdges:  also delete all edges where this unit is parent or child
 *
 * Link notes (from ontology):
 *   - NxgUnit → NxgUnitHierachyEdge (as parent): via NxgUnit.primaryKey_ → NxgUnitHierachyEdge.parentUnitKey
 *   - NxgUnit → NxgUnitHierachyEdge (as child):  via NxgUnit.primaryKey_ → NxgUnitHierachyEdge.childUnitKey
 *   - NxgUnit → NxgTacticalGraphicSymbol (1-to-1): via NxgUnit.primaryKey_ → NxgTacticalGraphicSymbol.unitKey
 */
async function deleteNxgUnit(
  client: Client,
  primaryKey: string,
  cascadeSymbol: boolean,
  cascadeEdges: boolean
): Promise<NxgUnitEdit[]> {
  const unit = await client(NxgUnit)
    .fetchOne(primaryKey)
    .catch(() => undefined);
  if (unit === undefined) {
    throw new Error(`NxgUnit "${primaryKey}" does not exist`);
  }

  const batch = createEditBatch<NxgUnitEdit>(client);

  if (cascadeEdges) {
    const { data: edgesAsParent } = await client(NxgUnitHierachyEdge)
      .where({ parentUnitKey: { $eq: primaryKey } })
      .fetchPage();
    for (const edge of edgesAsParent) batch.delete(edge);

    const { data: edgesAsChild } = await client(NxgUnitHierachyEdge)
      .where({ childUnitKey: { $eq: primaryKey } })
      .fetchPage();
    for (const edge of edgesAsChild) batch.delete(edge);
  }

  if (cascadeSymbol) {
    const { data: symbols } = await client(NxgTacticalGraphicSymbol)
      .where({ unitKey: { $eq: primaryKey } })
      .fetchPage();
    for (const symbol of symbols) batch.delete(symbol);
  }

  batch.delete(unit);

  return batch.getEdits();
}

export default deleteNxgUnit;
