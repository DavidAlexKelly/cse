// ============================================================
// useNxgScenarioMutations
//
// Write-side hook for the scenario header/strategic context and
// its OPFOR doctrine cards, used by the Scenario widget.
// ============================================================

import { useCallback } from "react";
import {
  NxgOpforDefinition,
  NxgScenario,
  createNxgPOpforDefinition,
  deleteNxgPOpforDefinition,
  modifyNxgPOpforDefinition,
  modifyNxgPScenario,
} from "@custom-widget/sdk";
import { client } from "../../client.js";
import { useOntologyMutation } from "./useOntologyMutation.js";
import type { OntologyMutationOptions } from "./useOntologyMutation.js";

export interface ScenarioWritePayload {
  name: string;
  scenarioType?: string | null;
  status?: string | null;
  classification?: string | null;
  currentPhase?: string | null;
  overallProgressPct?: number | null;
  /** ISO date string, e.g. "2026-03-01". */
  dDay?: string | null;
  strategicContextTitle?: string | null;
  strategicContextBody?: string | null;
  aiGenerated?: boolean | null;
}

export interface OpforWritePayload {
  title: string;
  meta?: string | null;
  body?: string | null;
  /** Capability tags, stored pipe-delimited on the object. */
  tags?: string[] | null;
  aiGenerated?: boolean | null;
}

function orNull(v: string | null | undefined): string | null {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
}

function joinTags(v: string[] | null | undefined): string | null {
  if (!v || v.length === 0) return null;
  const cleaned = v.map((t) => t.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join("|") : null;
}

/** Splits the pipe-delimited tag string back into a list. */
export function splitTags(v: string | null | undefined): string[] {
  if (!v) return [];
  return v
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);
}

export interface UseNxgScenarioMutationsResult {
  pending: boolean;
  error: string | null;
  clearError: () => void;
  updateScenario: (
    scenarioId: string,
    payload: ScenarioWritePayload,
  ) => Promise<void>;
  createOpfor: (
    scenarioId: string,
    payload: OpforWritePayload,
  ) => Promise<void>;
  updateOpfor: (
    opforDefinitionId: string,
    payload: OpforWritePayload,
  ) => Promise<void>;
  deleteOpfor: (opforDefinitionId: string) => Promise<void>;
}

export function useNxgScenarioMutations(
  options?: OntologyMutationOptions,
): UseNxgScenarioMutationsResult {
  const { pending, error, clearError, run } = useOntologyMutation(options);

  const updateScenario = useCallback(
    async (scenarioId: string, payload: ScenarioWritePayload) => {
      await run(async () => {
        const scenario = await client(NxgScenario).fetchOne(scenarioId);
        await client(modifyNxgPScenario).applyAction({
          scenario,
          scenarioName: payload.name.trim(),
          scenarioType: orNull(payload.scenarioType),
          scenarioStatus: orNull(payload.status),
          classification: orNull(payload.classification),
          currentPhase: orNull(payload.currentPhase),
          overallProgressPct: payload.overallProgressPct ?? null,
          dDay: orNull(payload.dDay),
          strategicContextTitle: orNull(payload.strategicContextTitle),
          strategicContextBody: orNull(payload.strategicContextBody),
          aiGenerated: payload.aiGenerated ?? null,
        });
      });
    },
    [run],
  );

  const createOpfor = useCallback(
    async (scenarioId: string, payload: OpforWritePayload) => {
      await run(async () => {
        await client(createNxgPOpforDefinition).applyAction({
          scenarioId,
          opforTitle: payload.title.trim(),
          opforMeta: orNull(payload.meta),
          opforBody: orNull(payload.body),
          opforTags: joinTags(payload.tags),
          aiGenerated: payload.aiGenerated ?? false,
        });
      });
    },
    [run],
  );

  const updateOpfor = useCallback(
    async (opforDefinitionId: string, payload: OpforWritePayload) => {
      await run(async () => {
        const opforDefinition =
          await client(NxgOpforDefinition).fetchOne(opforDefinitionId);
        await client(modifyNxgPOpforDefinition).applyAction({
          opforDefinition,
          opforTitle: payload.title.trim(),
          opforMeta: orNull(payload.meta),
          opforBody: orNull(payload.body),
          opforTags: joinTags(payload.tags),
          aiGenerated: payload.aiGenerated ?? null,
        });
      });
    },
    [run],
  );

  const deleteOpfor = useCallback(
    async (opforDefinitionId: string) => {
      await run(async () => {
        const opforDefinition =
          await client(NxgOpforDefinition).fetchOne(opforDefinitionId);
        await client(deleteNxgPOpforDefinition).applyAction({
          opforDefinition,
        });
      });
    },
    [run],
  );

  return {
    pending,
    error,
    clearError,
    updateScenario,
    createOpfor,
    updateOpfor,
    deleteOpfor,
  };
}
