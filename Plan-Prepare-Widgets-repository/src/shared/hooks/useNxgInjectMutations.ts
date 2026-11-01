// ============================================================
// useNxgInjectMutations
//
// Write-side hook for MEL/MIL injects, used by the MilMel widget.
// ============================================================

import { useCallback } from "react";
import {
  NxgInject,
  createNxgPInject,
  deleteNxgPInject,
  modifyNxgPInject,
} from "@custom-widget/sdk";
import { client } from "../../client.js";
import { useOntologyMutation } from "./useOntologyMutation.js";
import type { OntologyMutationOptions } from "./useOntologyMutation.js";

export interface InjectWritePayload {
  title: string;
  body?: string | null;
  category?: string | null;
  dayOffset?: string | null;
  expectedResponse?: string | null;
  phaseId?: string | null;
  referencesTerrainFeatureId?: string | null;
}

function orNull(v: string | null | undefined): string | null {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
}

export interface UseNxgInjectMutationsResult {
  pending: boolean;
  error: string | null;
  clearError: () => void;
  createInject: (
    scenarioId: string,
    payload: InjectWritePayload,
  ) => Promise<void>;
  updateInject: (
    injectId: string,
    payload: InjectWritePayload,
  ) => Promise<void>;
  deleteInject: (injectId: string) => Promise<void>;
}

export function useNxgInjectMutations(
  options?: OntologyMutationOptions,
): UseNxgInjectMutationsResult {
  const { pending, error, clearError, run } = useOntologyMutation(options);

  const createInject = useCallback(
    async (scenarioId: string, payload: InjectWritePayload) => {
      await run(async () => {
        await client(createNxgPInject).applyAction({
          scenarioId,
          injectTitle: payload.title.trim(),
          injectBody: orNull(payload.body),
          injectCategory: orNull(payload.category),
          dayOffset: orNull(payload.dayOffset),
          expectedResponse: orNull(payload.expectedResponse),
          phaseId: orNull(payload.phaseId),
          referencesTerrainFeatureId: orNull(
            payload.referencesTerrainFeatureId,
          ),
        });
      });
    },
    [run],
  );

  const updateInject = useCallback(
    async (injectId: string, payload: InjectWritePayload) => {
      await run(async () => {
        const inject = await client(NxgInject).fetchOne(injectId);
        await client(modifyNxgPInject).applyAction({
          inject,
          injectTitle: payload.title.trim(),
          injectBody: orNull(payload.body),
          injectCategory: orNull(payload.category),
          dayOffset: orNull(payload.dayOffset),
          expectedResponse: orNull(payload.expectedResponse),
          phaseId: orNull(payload.phaseId),
          referencesTerrainFeatureId: orNull(
            payload.referencesTerrainFeatureId,
          ),
        });
      });
    },
    [run],
  );

  const deleteInject = useCallback(
    async (injectId: string) => {
      await run(async () => {
        const nxgInject = await client(NxgInject).fetchOne(injectId);
        await client(deleteNxgPInject).applyAction({ nxgInject });
      });
    },
    [run],
  );

  return {
    pending,
    error,
    clearError,
    createInject,
    updateInject,
    deleteInject,
  };
}
