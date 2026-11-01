import { Client } from "@osdk/client";
import { Integer, UserFacingError } from "@osdk/functions";

import { NxgInject, NxgPhase, NxgPhaseMapState, NxgScenario, NxgTask } from "@ontology/sdk";

/** Chunk size used when filtering map states by a list of phase IDs. */
const PHASE_ID_CHUNK_SIZE = 100;

export interface ScenarioChildCounts {
  /** True if a Scenario with this primary key still exists. False means the children are orphaned. */
  scenarioExists: boolean;
  phases: Integer;
  mapStates: Integer;
  tasks: Integer;
  injects: Integer;
  total: Integer;
}

function chunk(items: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Read-only companion to purgeScenarioChildren. Reports exactly what a purge would
 * remove, and whether the scenario itself still exists, without making any edit.
 *
 * Run this first against any scenarioId before purging.
 */
async function countScenarioChildren(
  client: Client,
  scenarioId: string
): Promise<ScenarioChildCounts> {
  if (scenarioId === undefined || scenarioId.trim() === "") {
    throw new UserFacingError("A scenarioId must be provided.");
  }

  const scenarioExists = await client(NxgScenario)
    .fetchOne(scenarioId)
    .then(() => true)
    .catch(() => false);

  const phaseIds: string[] = [];
  for await (const phase of client(NxgPhase).where({ scenarioId: { $eq: scenarioId } }).asyncIter()) {
    if (phase.phaseId !== undefined) {
      phaseIds.push(phase.phaseId);
    }
  }

  let mapStates = 0;
  for (const phaseIdChunk of chunk(phaseIds, PHASE_ID_CHUNK_SIZE)) {
    const result = await client(NxgPhaseMapState)
      .where({ phaseId: { $in: phaseIdChunk } })
      .aggregate({ $select: { $count: "unordered" } });
    mapStates += result.$count ?? 0;
  }

  const taskResult = await client(NxgTask)
    .where({ scenarioId: { $eq: scenarioId } })
    .aggregate({ $select: { $count: "unordered" } });

  const injectResult = await client(NxgInject)
    .where({ scenarioId: { $eq: scenarioId } })
    .aggregate({ $select: { $count: "unordered" } });

  const phases = phaseIds.length;
  const tasks = taskResult.$count ?? 0;
  const injects = injectResult.$count ?? 0;

  return {
    scenarioExists,
    phases,
    mapStates,
    tasks,
    injects,
    total: phases + mapStates + tasks + injects,
  };
}

export default countScenarioChildren;
