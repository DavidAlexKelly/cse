import { Client, ObjectSet } from "@osdk/client";
import { createEditBatch, Edits, UserFacingError } from "@osdk/functions";

import { NxgInject } from "@ontology/sdk";

/** Safety cap on the number of objects deleted in a single invocation. */
const MAX_DELETIONS = 2000;

/**
 * Deletes every inject in the supplied object set.
 *
 * Action rules operate on a single object at a time, so removing the roughly 142 remaining
 * orphaned injects would otherwise take one action call each. Passing a filtered object set
 * collapses that into a single call.
 */
async function bulkDeleteInjects(
  client: Client,
  injects: ObjectSet<NxgInject>
): Promise<Edits.Object<NxgInject>[]> {
  const batch = createEditBatch<Edits.Object<NxgInject>>(client);
  let deletions = 0;

  for await (const inject of injects.asyncIter()) {
    batch.delete(inject);
    deletions++;
  }

  if (deletions === 0) {
    throw new UserFacingError("The supplied object set is empty, so there is nothing to delete.");
  }

  if (deletions > MAX_DELETIONS) {
    throw new UserFacingError(
      `Refusing to delete ${deletions} injects in one call, which exceeds the safety cap of ` +
        `${MAX_DELETIONS}. Narrow the object set and try again.`
    );
  }

  return batch.getEdits();
}

export default bulkDeleteInjects;
