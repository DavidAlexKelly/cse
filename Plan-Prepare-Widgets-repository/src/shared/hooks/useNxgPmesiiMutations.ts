// ============================================================
// useNxgPmesiiMutations
//
// Write-side counterpart to useNxgPmesiiDomains.
//
// Note: the Modify action originally shipped with no property
// parameters and therefore could not change anything. It was
// corrected before this hook was written — if domain edits ever
// appear to succeed but not persist, re-check that action first.
// ============================================================

import { useCallback } from "react";
import {
  NxgPmesiiDomain,
  createNxgPPmesiiDomain,
  deleteNxgPPmesiiDomain,
  modifyNxgPPmesiiDomain,
} from "@custom-widget/sdk";
import { client } from "../../client.js";
import { useOntologyMutation } from "./useOntologyMutation.js";
import type { OntologyMutationOptions } from "./useOntologyMutation.js";

export interface PmesiiWritePayload {
  /** PMESII-PT domain name, e.g. "Political". Only set on create. */
  domainKey?: string | null;
  value?: string | null;
  status?: string | null;
  reviewerPersonId?: string | null;
  aiGenerated?: boolean | null;
}

function orNull(v: string | null | undefined): string | null {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
}

export interface UseNxgPmesiiMutationsResult {
  pending: boolean;
  error: string | null;
  clearError: () => void;
  createDomain: (
    scenarioId: string,
    payload: PmesiiWritePayload,
  ) => Promise<void>;
  updateDomain: (
    domainId: string,
    payload: PmesiiWritePayload,
  ) => Promise<void>;
  deleteDomain: (domainId: string) => Promise<void>;
}

export function useNxgPmesiiMutations(
  options?: OntologyMutationOptions,
): UseNxgPmesiiMutationsResult {
  const { pending, error, clearError, run } = useOntologyMutation(options);

  const createDomain = useCallback(
    async (scenarioId: string, payload: PmesiiWritePayload) => {
      await run(async () => {
        await client(createNxgPPmesiiDomain).applyAction({
          scenarioId,
          domainKey: orNull(payload.domainKey),
          domainValue: orNull(payload.value),
          domainStatus: orNull(payload.status) ?? "draft",
          aiGenerated: payload.aiGenerated ?? false,
        });
      });
    },
    [run],
  );

  const updateDomain = useCallback(
    async (domainId: string, payload: PmesiiWritePayload) => {
      await run(async () => {
        const nxgPmesiiDomain =
          await client(NxgPmesiiDomain).fetchOne(domainId);
        await client(modifyNxgPPmesiiDomain).applyAction({
          nxgPmesiiDomain,
          domainValue: orNull(payload.value),
          domainStatus: orNull(payload.status),
          reviewerPersonId: orNull(payload.reviewerPersonId),
          aiGenerated: payload.aiGenerated ?? null,
        });
      });
    },
    [run],
  );

  const deleteDomain = useCallback(
    async (domainId: string) => {
      await run(async () => {
        const pmesiiDomain = await client(NxgPmesiiDomain).fetchOne(domainId);
        await client(deleteNxgPPmesiiDomain).applyAction({ pmesiiDomain });
      });
    },
    [run],
  );

  return {
    pending,
    error,
    clearError,
    createDomain,
    updateDomain,
    deleteDomain,
  };
}
