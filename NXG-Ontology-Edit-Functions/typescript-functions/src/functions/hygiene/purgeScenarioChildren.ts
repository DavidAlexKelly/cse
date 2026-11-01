import { Client } from "@osdk/client";
import { createEditBatch, Edits, UserFacingError } from "@osdk/functions";

import { NxgInject, NxgPhase, NxgPhaseMapState, NxgScenario, NxgTask } from "@ontology/sdk";

/**
 * Safety cap. The ontology holds a few hundred orphaned children in total, so a count
 * approaching this number implies the wrong scenarioId was supplied.
 */
const MAX_DELETIONS = 2000;

/** Chunk size used when filtering map states by a list of phase IDs. */
const PHASE_ID_CHUNK_SIZE = 100;

function chunk(items: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Deletes every child object belonging to a scenarioId: phases, the map states hanging
 * off those phases, tasks and injects.
 *
 * NxgPhase, NxgTask and NxgInject reference their scenario through a plain scenarioId
 * string, and NxgPhaseMapState references its phase through a plain phaseId string. None
 * are enforced links, so deleting a scenario leaves its children behind as unreachable
 * orphans. Abandoned document-generation runs have left roughly 177 tasks and 143 injects
 * pointing at scenarioIds that no longer resolve.
 *
 * Map states are found indirectly, because NxgPhaseMapState carries no scenarioId: the
 * phases are collected first and their phaseIds used to locate the associated map states.
 *
 * @param scenarioId The scenarioId whose children should be removed.
 * @param includeExistingScenario Guard. When false the function refuses to run if a
 *        Scenario with this ID still exists, so a mistyped ID cannot strip a live
 *        scenario. Set true to deliberately clear the children of a scenario that does
 *        still exist, such as an abandoned draft.
 */
async function purgeScenarioChildren(
  client: Client,
  scenarioId: string,
  includeExistingScenario: boolean
): Promise<
  (
    | Edits.Object<NxgPhase>
    | Edits.Object<NxgPhaseMapState>
    | Edits.Object<NxgTask>
    | Edits.Object<NxgInject>
  )[]
> {
  if (scenarioId === undefined || scenarioId.trim() === "") {
    throw new UserFacingError("A scenarioId must be provided.");
  }

  const scenarioStillExists = await client(NxgScenario)
    .fetchOne(scenarioId)
    .then(() => true)
    .catch(() => false);

  if (scenarioStillExists && !includeExistingScenario) {
    throw new UserFacingError(
      `Scenario "${scenarioId}" still exists, so its children are not orphaned. Set ` +
        "'Include existing scenario' to true if you intend to clear the children of a " +
        "scenario that still exists."
    );
  }

  const batch = createEditBatch<
    | Edits.Object<NxgPhase>
    | Edits.Object<NxgPhaseMapState>
    | Edits.Object<NxgTask>
    | Edits.Object<NxgInject>
  >(client);

  let deletions = 0;

  // Phases first, so their IDs can be used to find the associated map states.
  const phaseIds: string[] = [];
  for await (const phase of client(NxgPhase).where({ scenarioId: { $eq: scenarioId } }).asyncIter()) {
    if (phase.phaseId !== undefined) {
      phaseIds.push(phase.phaseId);
    }
    batch.delete(phase);
    deletions++;
  }

  for (const phaseIdChunk of chunk(phaseIds, PHASE_ID_CHUNK_SIZE)) {
    for await (const mapState of client(NxgPhaseMapState)
      .where({ phaseId: { $in: phaseIdChunk } })
      .asyncIter()) {
      batch.delete(mapState);
      deletions++;
    }
  }

  for await (const task of client(NxgTask).where({ scenarioId: { $eq: scenarioId } }).asyncIter()) {
    batch.delete(task);
    deletions++;
  }

  for await (const inject of client(NxgInject).where({ scenarioId: { $eq: scenarioId } }).asyncIter()) {
    batch.delete(inject);
    deletions++;
  }

  if (deletions > MAX_DELETIONS) {
    throw new UserFacingError(
      `Refusing to delete ${deletions} objects in one call, which exceeds the safety cap ` +
        `of ${MAX_DELETIONS}. Check that scenarioId "${scenarioId}" is correct.`
    );
  }

  return batch.getEdits();
}

export default purgeScenarioChildren;
