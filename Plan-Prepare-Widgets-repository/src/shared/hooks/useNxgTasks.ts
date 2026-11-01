// ============================================================
// useNxgTasks
//
// Loads NxgTask objects from the ontology, filtered by
// scenarioId, along with their NxgSubtask checklist items.
//
// Falls back to MOCK_TASKS (full Iron Forge 26 task list) when
// the ontology returns nothing, so the dashboard is always
// demo-ready. Callers can distinguish the two via `source`.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { NxgSubtask, NxgTask } from "@custom-widget/sdk";
import type { Osdk } from "@osdk/client";
import { client } from "../../client.js";
import { MOCK_TASKS } from "../data/mockScenarioDashboard.js";
import {
  compareTaskSections,
  normaliseTaskSection,
  normaliseTaskStatus,
} from "../task/taskTaxonomy.js";
import type { DataSource } from "./dataSource.js";
import type {
  SubTask,
  WorkflowTask,
} from "../../task-manager/task-assignment/types.js";

export type { WorkflowTask };

function osdkToSubtask(obj: Osdk.Instance<NxgSubtask>): SubTask {
  return {
    id: obj.subtaskId,
    label: obj.subtaskLabel ?? "",
    done: obj.isDone ?? false,
  };
}

function osdkToTask(
  obj: Osdk.Instance<NxgTask>,
  subTasks: SubTask[],
): WorkflowTask {
  return {
    id: obj.taskId,
    section: normaliseTaskSection(obj.taskSection),
    phaseId: obj.phaseId ?? null,
    injectId: obj.injectId ?? null,
    title: obj.taskName ?? "",
    description: obj.taskDescription ?? "",
    approver: obj.approvedByPersonId ?? null,
    owner: obj.assignedToPersonId ?? null,
    due: obj.dueOffset ?? "",
    status: normaliseTaskStatus(obj.taskStatus),
    aiAssisted: obj.aiAssisted ?? false,
    subTasks,
  };
}

export interface UseNxgTasksResult {
  tasks: WorkflowTask[];
  loading: boolean;
  error: string | null;
  /** Whether `tasks` came from the ontology or from local seed data. */
  source: DataSource;
  refresh: () => void;
}

export function useNxgTasks(
  scenarioId: string | null | undefined,
): UseNxgTasksResult {
  // Starts empty: seed records are only shown once a real fetch has come
  // back with nothing, so mock data cannot flash before the first load.
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>("unbound");

  const load = useCallback(async () => {
    // No scenario bound — show nothing rather than quietly loading a
    // default exercise. The widget renders an explicit empty state.
    if (scenarioId == null) {
      setTasks([]);
      setSource("unbound");
      setLoading(false);
      setError(null);
      return;
    }
    const resolvedId = scenarioId;

    setLoading(true);
    setError(null);
    try {
      // Subtasks are denormalised with a scenarioId, so the whole
      // checklist set for the scenario comes back in one query
      // rather than one query per task.
      const subtasksByTask = new Map<string, Osdk.Instance<NxgSubtask>[]>();
      for await (const obj of client(NxgSubtask)
        .where({ scenarioId: { $eq: resolvedId } })
        .asyncIter()) {
        const key = obj.taskId ?? "";
        const bucket = subtasksByTask.get(key);
        if (bucket) bucket.push(obj);
        else subtasksByTask.set(key, [obj]);
      }

      const results: WorkflowTask[] = [];
      for await (const obj of client(NxgTask)
        .where({ scenarioId: { $eq: resolvedId } })
        .asyncIter()) {
        const subs = (subtasksByTask.get(obj.taskId) ?? [])
          .slice()
          .sort(
            (a, b) =>
              (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0) ||
              (a.subtaskLabel ?? "").localeCompare(b.subtaskLabel ?? ""),
          )
          .map(osdkToSubtask);
        results.push(osdkToTask(obj, subs));
      }

      if (results.length > 0) {
        results.sort(
          (a, b) =>
            compareTaskSections(a.section, b.section) ||
            a.title.localeCompare(b.title),
        );
        setTasks(results);
        setSource("ontology");
      } else {
        // No ontology data — keep rich mock task list for demo
        setTasks(MOCK_TASKS);
        setSource("seed");
      }
    } catch (e) {
      setError(String(e));
      setTasks(MOCK_TASKS);
      setSource("seed");
    } finally {
      setLoading(false);
    }
  }, [scenarioId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { tasks, loading, error, source, refresh: load };
}
