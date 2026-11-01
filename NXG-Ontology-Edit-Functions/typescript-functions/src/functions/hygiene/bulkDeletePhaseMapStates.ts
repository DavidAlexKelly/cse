import { Client, ObjectSet } from "@osdk/client";
import { createEditBatch, Edits, UserFacingError } from "@osdk/functions";

import { NxgPhaseMapState } from "@ontology/sdk";

/** Safety cap on the number of objects deleted in a single invocation. */
const MAX_DELETIONS = 500;

/**
 * Deletes every phase map state in the supplied object set.
 *
 * Two known problems need this: phases carrying duplicate map states where a 1:1
 * relationship is expected, and map states whose phaseId no longer resolves to any Phase.
 *
 * Caution: some map states are backed by rows in the nxg_phase_map_state dataset rather
 * than being pure ontology edits. Deleting a dataset-backed object may not persist, because
 * the row can be re-materialised from the dataset. Prefer keeping the dataset-backed record
 * and deleting the edit-created duplicates, then verify the result afterwards.
 */
async function bulkDeletePhaseMapStates(
  client: Client,
  mapStates: ObjectSet<NxgPhaseMapState>
): Promise<Edits.Object<NxgPhaseMapState>[]> {
  const batch = createEditBatch<Edits.Object<NxgPhaseMapState>>(client);
  let deletions = 0;

  for await (const mapState of mapStates.asyncIter()) {
    batch.delete(mapState);
    deletions++;
  }

  if (deletions === 0) {
    throw new UserFacingError("The supplied object set is empty, so there is nothing to delete.");
  }

  if (deletions > MAX_DELETIONS) {
    throw new UserFacingError(
      `Refusing to delete ${deletions} map states in one call, which exceeds the safety cap ` +
        `of ${MAX_DELETIONS}. Narrow the object set and try again.`
    );
  }

  return batch.getEdits();
}

export default bulkDeletePhaseMapStates;
