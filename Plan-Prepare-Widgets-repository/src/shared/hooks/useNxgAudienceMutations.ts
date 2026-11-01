// ============================================================
// useNxgAudienceMutations
//
// Write-side counterpart to useNxgTrainingAudiences, covering
// both the audience groups and the nations contributing to them.
// ============================================================

import { useCallback } from "react";
import {
  NxgParticipatingNation,
  NxgTrainingAudience,
  createNxgPParticipatingNation,
  createNxgPTrainingAudience,
  deleteNxgPParticipatingNation,
  deleteNxgPTrainingAudience,
  modifyNxgPParticipatingNation,
  modifyNxgPTrainingAudience,
} from "@custom-widget/sdk";
import { client } from "../../client.js";
import { useOntologyMutation } from "./useOntologyMutation.js";
import type { OntologyMutationOptions } from "./useOntologyMutation.js";

export interface AudienceWritePayload {
  name: string;
  audienceType?: string | null;
  description?: string | null;
  participantCount?: number | null;
  /** Directorates are stored pipe-delimited on the object. */
  directorates?: string[] | null;
}

export interface NationWritePayload {
  nationCode: string;
  role?: string | null;
  participantCount?: number | null;
  directorates?: string[] | null;
}

function orNull(v: string | null | undefined): string | null {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
}

/** Joins a directorate list into the pipe-delimited form the ontology stores. */
function joinDirectorates(v: string[] | null | undefined): string | null {
  if (!v || v.length === 0) return null;
  const cleaned = v.map((d) => d.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join("|") : null;
}

/** Splits the pipe-delimited directorate string back into a list. */
export function splitDirectorates(v: string | null | undefined): string[] {
  if (!v) return [];
  return v
    .split("|")
    .map((d) => d.trim())
    .filter(Boolean);
}

export interface UseNxgAudienceMutationsResult {
  pending: boolean;
  error: string | null;
  clearError: () => void;
  createAudience: (
    scenarioId: string,
    payload: AudienceWritePayload,
  ) => Promise<void>;
  updateAudience: (
    audienceId: string,
    payload: AudienceWritePayload,
  ) => Promise<void>;
  deleteAudience: (audienceId: string) => Promise<void>;
  createNation: (
    scenarioId: string,
    audienceId: string,
    payload: NationWritePayload,
  ) => Promise<void>;
  updateNation: (
    participatingNationId: string,
    payload: NationWritePayload,
  ) => Promise<void>;
  deleteNation: (participatingNationId: string) => Promise<void>;
}

export function useNxgAudienceMutations(
  options?: OntologyMutationOptions,
): UseNxgAudienceMutationsResult {
  const { pending, error, clearError, run } = useOntologyMutation(options);

  const createAudience = useCallback(
    async (scenarioId: string, payload: AudienceWritePayload) => {
      await run(async () => {
        await client(createNxgPTrainingAudience).applyAction({
          scenarioId,
          audienceName: payload.name.trim(),
          audienceType: orNull(payload.audienceType),
          audienceDescription: orNull(payload.description),
          participantCount: payload.participantCount ?? null,
          directorates: joinDirectorates(payload.directorates),
        });
      });
    },
    [run],
  );

  const updateAudience = useCallback(
    async (audienceId: string, payload: AudienceWritePayload) => {
      await run(async () => {
        const trainingAudience =
          await client(NxgTrainingAudience).fetchOne(audienceId);
        await client(modifyNxgPTrainingAudience).applyAction({
          trainingAudience,
          audienceName: payload.name.trim(),
          audienceType: orNull(payload.audienceType),
          audienceDescription: orNull(payload.description),
          participantCount: payload.participantCount ?? null,
          directorates: joinDirectorates(payload.directorates),
        });
      });
    },
    [run],
  );

  const deleteAudience = useCallback(
    async (audienceId: string) => {
      await run(async () => {
        const nxgTrainingAudience =
          await client(NxgTrainingAudience).fetchOne(audienceId);
        await client(deleteNxgPTrainingAudience).applyAction({
          nxgTrainingAudience,
        });
      });
    },
    [run],
  );

  const createNation = useCallback(
    async (
      scenarioId: string,
      audienceId: string,
      payload: NationWritePayload,
    ) => {
      await run(async () => {
        await client(createNxgPParticipatingNation).applyAction({
          scenarioId,
          audienceId,
          nationCode: payload.nationCode.trim(),
          nationRole: orNull(payload.role),
          participantCount: payload.participantCount ?? null,
          directorates: joinDirectorates(payload.directorates),
        });
      });
    },
    [run],
  );

  const updateNation = useCallback(
    async (participatingNationId: string, payload: NationWritePayload) => {
      await run(async () => {
        const participatingNation = await client(
          NxgParticipatingNation,
        ).fetchOne(participatingNationId);
        await client(modifyNxgPParticipatingNation).applyAction({
          participatingNation,
          nationCode: payload.nationCode.trim(),
          nationRole: orNull(payload.role),
          participantCount: payload.participantCount ?? null,
          directorates: joinDirectorates(payload.directorates),
        });
      });
    },
    [run],
  );

  const deleteNation = useCallback(
    async (participatingNationId: string) => {
      await run(async () => {
        const participatingNation = await client(
          NxgParticipatingNation,
        ).fetchOne(participatingNationId);
        await client(deleteNxgPParticipatingNation).applyAction({
          participatingNation,
        });
      });
    },
    [run],
  );

  return {
    pending,
    error,
    clearError,
    createAudience,
    updateAudience,
    deleteAudience,
    createNation,
    updateNation,
    deleteNation,
  };
}
