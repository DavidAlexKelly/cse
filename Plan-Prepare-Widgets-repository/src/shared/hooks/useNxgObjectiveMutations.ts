// ============================================================
// useNxgObjectiveMutations
//
// Write-side counterpart to useNxgTrainingObjectives.
// ============================================================

import { useCallback } from "react";
import {
  NxgTrainingObjective,
  createNxgPTrainingObjective,
  deleteNxgPTrainingObjective,
  modifyNxgPTrainingObjective,
} from "@custom-widget/sdk";
import { client } from "../../client.js";
import { useOntologyMutation } from "./useOntologyMutation.js";
import type { OntologyMutationOptions } from "./useOntologyMutation.js";

export interface ObjectiveWritePayload {
  objective: string;
  ref?: string | null;
  functionalArea?: string | null;
  priority?: string | null;
  phaseId?: string | null;
}

function orNull(v: string | null | undefined): string | null {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
}

export interface UseNxgObjectiveMutationsResult {
  pending: boolean;
  error: string | null;
  clearError: () => void;
  createObjective: (
    scenarioId: string,
    payload: ObjectiveWritePayload,
  ) => Promise<void>;
  updateObjective: (
    objectiveId: string,
    payload: ObjectiveWritePayload,
  ) => Promise<void>;
  deleteObjective: (objectiveId: string) => Promise<void>;
}

export function useNxgObjectiveMutations(
  options?: OntologyMutationOptions,
): UseNxgObjectiveMutationsResult {
  const { pending, error, clearError, run } = useOntologyMutation(options);

  const createObjective = useCallback(
    async (scenarioId: string, payload: ObjectiveWritePayload) => {
      await run(async () => {
        await client(createNxgPTrainingObjective).applyAction({
          scenarioId,
          objective: payload.objective.trim(),
          ref: orNull(payload.ref),
          functionalArea: orNull(payload.functionalArea),
          priority: orNull(payload.priority),
          phaseId: orNull(payload.phaseId),
        });
      });
    },
    [run],
  );

  const updateObjective = useCallback(
    async (objectiveId: string, payload: ObjectiveWritePayload) => {
      await run(async () => {
        const trainingObjective =
          await client(NxgTrainingObjective).fetchOne(objectiveId);
        await client(modifyNxgPTrainingObjective).applyAction({
          trainingObjective,
          objective: payload.objective.trim(),
          ref: orNull(payload.ref),
          functionalArea: orNull(payload.functionalArea),
          priority: orNull(payload.priority),
          phaseId: orNull(payload.phaseId),
        });
      });
    },
    [run],
  );

  const deleteObjective = useCallback(
    async (objectiveId: string) => {
      await run(async () => {
        const nxgTrainingObjective =
          await client(NxgTrainingObjective).fetchOne(objectiveId);
        await client(deleteNxgPTrainingObjective).applyAction({
          nxgTrainingObjective,
        });
      });
    },
    [run],
  );

  return {
    pending,
    error,
    clearError,
    createObjective,
    updateObjective,
    deleteObjective,
  };
}
