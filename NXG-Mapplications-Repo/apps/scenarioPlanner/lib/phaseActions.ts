// src/apps/scenarioPlanner/lib/phaseActions.ts
//
// Ontology writes for [NXG-P] Phase.
//
// Until now the Scenario Planner could READ phases (useScenario → NxgPhase) but
// had no way to write them: the create/modify/delete action types existed in the
// ontology but were never imported into the Developer Console app, so they were
// absent from the generated SDK. usePhases was therefore built as pure React
// state that wrote back only to a Workshop widget variable — which meant every
// phase a planner created, forked, renamed or deleted was lost on reload.
//
// The three action types are now imported. This module is the single place that
// talks to them.
//
// ── The primary-key problem ───────────────────────────────────────────────────
// `createNxgPPhase` does NOT accept a phaseId — the ontology assigns the PK
// (the action's rule sets phase-id from a uuid generator). The app cannot
// therefore mint its own id and assume it, which matters because a phase id is
// used as the key for that phase's map state (NxgPhaseMapState.phaseId) and for
// basedOnPhaseId on its branches. Inventing a local id produced map-state rows
// pointing at phases that did not exist.
//
// So creates read the assigned PK back, using the same approach as
// usePhaseMapState: `$returnEdits: true` first, then a query as a fallback.

import { client } from "@/client";
import {
  NxgPhase,
  createNxgPPhase,
  modifyNxgPPhase,
  deleteNxgPPhase,
} from "@nxg-simulation-execution-testing/sdk";
import type { Phase, PhaseOffsetUnit, PhaseStatus } from "../shared/types";
import { formatPhaseOffset } from "../shared/timeScale";

/** The subset of a Phase that is persisted on NxgPhase. */
export interface PhaseWriteInput {
  scenarioId: string;
  name: string;
  status: PhaseStatus;
  objective: string;
  startOffset: number;
  endOffset: number;
  offsetUnit?: PhaseOffsetUnit;
  sequenceNumber: number;
  /** The phase this one branches from. Null for a scenario's first phase. */
  basedOnPhaseId?: string;
}

/**
 * Pull a created object's primary key out of an action's returned edits.
 *
 * The response is `ActionResults`, which is either `{ type: "edits",
 * addedObjects: [...] }` or `{ type: "largeScaleEdits" }` where the arrays are
 * absent. Both shapes are handled, and older/newer OSDK versions have nested
 * the payload under `edits`, so both are probed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pkFromEdits(result: any): string | undefined {
  const added = result?.edits?.addedObjects ?? result?.addedObjects;
  if (Array.isArray(added) && added.length > 0) {
    const pk = added[0]?.primaryKey;
    if (typeof pk === "string" && pk.length > 0) return pk;
    if (typeof pk === "number") return String(pk);
  }
  return undefined;
}

/**
 * Fallback PK resolution when the action did not return edits.
 *
 * Matches on the fields we just wrote and takes the highest sequenceNumber, on
 * the assumption that the row we created is the newest one matching. This is a
 * best-effort recovery path, not the happy path.
 */
async function findPhaseIdByContent(input: PhaseWriteInput): Promise<string | undefined> {
  try {
    const page = await client(NxgPhase)
      .where({
        scenarioId: { $eq: input.scenarioId },
        phaseName: { $eq: input.name },
      })
      .fetchPage({ $pageSize: 50 });
    if (!page.data.length) return undefined;
    const sorted = [...page.data].sort(
      (a, b) => Number(b.sequenceNumber ?? 0) - Number(a.sequenceNumber ?? 0),
    );
    return sorted[0]?.phaseId ?? undefined;
  } catch (err) {
    console.warn("[phaseActions] could not read back the created phase id:", err);
    return undefined;
  }
}

function toActionParams(input: PhaseWriteInput) {
  return {
    scenarioId: input.scenarioId,
    phaseName: input.name,
    phaseStatus: input.status,
    objectiveStatement: input.objective,
    // NxgPhase stores offsets as scenario-relative strings ("D+2" / "H+18");
    // the widget keeps them as a number plus a unit. formatPhaseOffset is the
    // exact inverse of parsePhaseOffset in useScenario.
    startOffset: formatPhaseOffset(input.startOffset, input.offsetUnit),
    endOffset: formatPhaseOffset(input.endOffset, input.offsetUnit),
    sequenceNumber: input.sequenceNumber,
    basedOnPhaseId: input.basedOnPhaseId ?? null,
  };
}

/**
 * Create a phase and return its ontology-assigned phaseId.
 *
 * Throws when the write fails, and also when the write succeeded but the PK
 * could not be resolved — a phase whose id we don't know is worse than no
 * phase, because its map state would be written against an id that will never
 * be read back.
 */
export async function createPhaseInOntology(input: PhaseWriteInput): Promise<string> {
  const result = await client(createNxgPPhase).applyAction(toActionParams(input), {
    $returnEdits: true,
  });

  const phaseId = pkFromEdits(result) ?? (await findPhaseIdByContent(input));
  if (!phaseId) {
    throw new Error(
      `Phase "${input.name}" was created but its id could not be read back, so it cannot be ` +
        `linked to its map state. Reload to see it.`,
    );
  }
  return phaseId;
}

/**
 * Update an existing phase.
 *
 * `modifyNxgPPhase` takes the object as `ActionParam.ObjectType<NxgPhase>`,
 * which accepts a bare primary key — no round-trip fetch needed.
 */
export async function updatePhaseInOntology(
  phaseId: string,
  input: PhaseWriteInput,
): Promise<void> {
  await client(modifyNxgPPhase).applyAction({
    nxgPhase: phaseId,
    ...toActionParams(input),
  });
}

export async function deletePhaseInOntology(phaseId: string): Promise<void> {
  await client(deleteNxgPPhase).applyAction({ nxgPhase: phaseId });
}

/** Build the persisted subset from a full local Phase. */
export function phaseWriteInput(
  phase: Phase,
  scenarioId: string,
  sequenceNumber: number,
): PhaseWriteInput {
  return {
    scenarioId,
    name: phase.name,
    status: phase.status,
    objective: phase.objective,
    startOffset: phase.startOffset,
    endOffset: phase.endOffset,
    offsetUnit: phase.offsetUnit,
    sequenceNumber,
    basedOnPhaseId: phase.basedOnPhaseId,
  };
}
