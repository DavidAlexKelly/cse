import { Client, ObjectSet } from "@osdk/client";
import { createEditBatch, Edits, UserFacingError } from "@osdk/functions";

import { NxgTask } from "@ontology/sdk";

/** Safety cap on the number of objects deleted in a single invocation. */
const MAX_DELETIONS = 2000;

/**
 * Deletes every task in the supplied object set.
 *
 * Action rules operate on a single object at a time, so removing the roughly 177 orphaned
 * tasks would otherwise take one action call each. Passing a filtered object set collapses
 * that into a single call.
 */
async function bulkDeleteTasks(
  client: Client,
  tasks: ObjectSet<NxgTask>
): Promise<Edits.Object<NxgTask>[]> {
  const batch = createEditBatch<Edits.Object<NxgTask>>(client);
  let deletions = 0;

  for await (const task of tasks.asyncIter()) {
    batch.delete(task);
    deletions++;
  }

  if (deletions === 0) {
    throw new UserFacingError("The supplied object set is empty, so there is nothing to delete.");
  }

  if (deletions > MAX_DELETIONS) {
    throw new UserFacingError(
      `Refusing to delete ${deletions} tasks in one call, which exceeds the safety cap of ` +
        `${MAX_DELETIONS}. Narrow the object set and try again.`
    );
  }

  return batch.getEdits();
}

export default bulkDeleteTasks;
