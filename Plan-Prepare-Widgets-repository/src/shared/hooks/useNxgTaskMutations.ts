// ============================================================
// useNxgTaskMutations
//
// Write-side counterpart to useNxgTasks. Wraps the NxgTask and
// NxgSubtask action types so widgets can persist edits instead
// of mutating local React state that is lost on refresh.
//
// Callers pass plain ids; this hook resolves the OSDK object
// instance that modify/delete actions require. That costs one
// extra round trip per write but avoids every call site having
// to hold a Map of live object instances, and avoids acting on
// a stale instance after a background refresh.
// ============================================================

import { useCallback } from "react";
import {
  NxgSubtask,
  NxgTask,
  createNxgPSubtask,
  createNxgPTask,
  deleteNxgPSubtask,
  deleteNxgPTask,
  modifyNxgPSubtask,
  modifyNxgPTask,
} from "@custom-widget/sdk";
import { client } from "../../client.js";
import { useOntologyMutation } from "./useOntologyMutation.js";
import type { OntologyMutationOptions } from "./useOntologyMutation.js";
import type { TaskSection, TaskStatus } from "../task/taskTaxonomy.js";

// ── Payload shapes ────────────────────────────────────────────────────────

export interface TaskWritePayload {
  title: string;
  description?: string | null;
  section?: TaskSection | null;
  status?: TaskStatus | null;
  due?: string | null;
  owner?: string | null;
  approver?: string | null;
  phaseId?: string | null;
  injectId?: string | null;
  aiAssisted?: boolean | null;
}

export interface SubtaskWritePayload {
  label: string;
  done?: boolean | null;
  sequenceNumber?: number | null;
}

// Empty strings are meaningless in the ontology — send null so the
// property is cleared rather than set to "".
function orNull(v: string | null | undefined): string | null {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
}

export interface UseNxgTaskMutationsResult {
  pending: boolean;
  error: string | null;
  clearError: () => void;
  createTask: (scenarioId: string, payload: TaskWritePayload) => Promise<void>;
  updateTask: (taskId: string, payload: TaskWritePayload) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  createSubtask: (
    scenarioId: string,
    taskId: string,
    payload: SubtaskWritePayload,
  ) => Promise<void>;
  updateSubtask: (
    subtaskId: string,
    payload: SubtaskWritePayload,
  ) => Promise<void>;
  deleteSubtask: (subtaskId: string) => Promise<void>;
}

export function useNxgTaskMutations(
  options?: OntologyMutationOptions,
): UseNxgTaskMutationsResult {
  const { pending, error, clearError, run } = useOntologyMutation(options);

  const createTask = useCallback(
    async (scenarioId: string, payload: TaskWritePayload) => {
      await run(async () => {
        await client(createNxgPTask).applyAction({
          scenarioId,
          taskName: payload.title.trim(),
          taskDescription: orNull(payload.description),
          taskSection: payload.section ?? null,
          taskStatus: payload.status ?? "pending",
          dueOffset: orNull(payload.due),
          assignedToPersonId: orNull(payload.owner),
          approvedByPersonId: orNull(payload.approver),
          phaseId: orNull(payload.phaseId),
          aiAssisted: payload.aiAssisted ?? false,
        });
      });
    },
    [run],
  );

  const updateTask = useCallback(
    async (taskId: string, payload: TaskWritePayload) => {
      await run(async () => {
        const task = await client(NxgTask).fetchOne(taskId);
        await client(modifyNxgPTask).applyAction({
          task,
          taskName: payload.title.trim(),
          taskDescription: orNull(payload.description),
          taskSection: payload.section ?? null,
          taskStatus: payload.status ?? null,
          dueOffset: orNull(payload.due),
          assignedToPersonId: orNull(payload.owner),
          approvedByPersonId: orNull(payload.approver),
          phaseId: orNull(payload.phaseId),
          injectId: orNull(payload.injectId),
          aiAssisted: payload.aiAssisted ?? null,
        });
      });
    },
    [run],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      await run(async () => {
        const nxgTask = await client(NxgTask).fetchOne(taskId);
        await client(deleteNxgPTask).applyAction({ nxgTask });
      });
    },
    [run],
  );

  const createSubtask = useCallback(
    async (
      scenarioId: string,
      taskId: string,
      payload: SubtaskWritePayload,
    ) => {
      await run(async () => {
        await client(createNxgPSubtask).applyAction({
          scenarioId,
          taskId,
          subtaskLabel: payload.label.trim(),
          isDone: payload.done ?? false,
          sequenceNumber: payload.sequenceNumber ?? null,
        });
      });
    },
    [run],
  );

  const updateSubtask = useCallback(
    async (subtaskId: string, payload: SubtaskWritePayload) => {
      await run(async () => {
        const subtask = await client(NxgSubtask).fetchOne(subtaskId);
        await client(modifyNxgPSubtask).applyAction({
          subtask,
          subtaskLabel: payload.label.trim(),
          isDone: payload.done ?? null,
          sequenceNumber: payload.sequenceNumber ?? null,
        });
      });
    },
    [run],
  );

  const deleteSubtask = useCallback(
    async (subtaskId: string) => {
      await run(async () => {
        const subtask = await client(NxgSubtask).fetchOne(subtaskId);
        await client(deleteNxgPSubtask).applyAction({ subtask });
      });
    },
    [run],
  );

  return {
    pending,
    error,
    clearError,
    createTask,
    updateTask,
    deleteTask,
    createSubtask,
    updateSubtask,
    deleteSubtask,
  };
}
