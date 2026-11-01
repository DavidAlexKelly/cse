// ============================================================
// useNxgTrainingObjectives
//
// Loads NxgTrainingObjective objects from the ontology,
// filtered by scenarioId, falling back to
// MOCK_TRAINING_OBJECTIVES when the scenario has none.
//
// Coverage note: the ontology has no coverage field, and an
// objective has no direct link to tasks. Previously this hook
// borrowed coveragePct from whichever mock objective sat at the
// same array index, which produced numbers unrelated to the
// objective being displayed. Coverage is now derived from the
// planning progress of the objective's phase — pass the
// scenario's tasks in to enable it, otherwise it reports 0.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { NxgTrainingObjective } from "@custom-widget/sdk";
import type { Osdk } from "@osdk/client";
import { client } from "../../client.js";
import type { TrainingObjectiveRecord } from "../data/index.js";
import {
  MOCK_TRAINING_OBJECTIVES,
  type MockTrainingObjective,
} from "../data/mockScenarioDashboard.js";
import {
  groupTasksByPhase,
  objectiveCoveragePct,
} from "../metrics/planningMetrics.js";
import type { DataSource } from "./dataSource.js";
import type { WorkflowTask } from "../../task-manager/task-assignment/types.js";

export type { MockTrainingObjective };
export type { TrainingObjectiveRecord };

/** A training objective plus the phase it belongs to and its derived coverage. */
export interface TrainingObjectiveView extends MockTrainingObjective {
  phaseId: string | null;
}

function osdkToRecord(
  obj: Osdk.Instance<NxgTrainingObjective>,
): Omit<TrainingObjectiveView, "coveragePct"> {
  return {
    objectiveId: obj.objectiveId,
    ref: obj.ref ?? "",
    objective: obj.objective ?? "",
    functionalArea: obj.functionalArea ?? "",
    priority: (obj.priority as TrainingObjectiveRecord["priority"]) ?? "Medium",
    phaseId: obj.phaseId ?? null,
  };
}

const SEED_OBJECTIVES: TrainingObjectiveView[] = MOCK_TRAINING_OBJECTIVES.map(
  (o) => ({ ...o, phaseId: null }),
);

export interface UseNxgTrainingObjectivesResult {
  objectives: TrainingObjectiveView[];
  loading: boolean;
  error: string | null;
  /** Whether `objectives` came from the ontology or from local seed data. */
  source: DataSource;
  refresh: () => void;
}

export function useNxgTrainingObjectives(
  scenarioId: string | null | undefined,
  /** Scenario tasks, used to derive per-objective coverage. Optional. */
  tasks?: WorkflowTask[],
): UseNxgTrainingObjectivesResult {
  // Raw records are held separately from the derived coverage so that
  // a change to the task list recomputes coverage without refetching
  // the objectives — and so a caller passing a fresh array identity
  // each render cannot trigger a fetch loop.
  // Starts empty: seed records are only shown once a real fetch has come
  // back with nothing, so mock data cannot flash before the first load.
  const [raw, setRaw] = useState<Omit<TrainingObjectiveView, "coveragePct">[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>("unbound");

  const load = useCallback(async () => {
    // No scenario bound — show nothing rather than quietly loading a
    // default exercise. The widget renders an explicit empty state.
    if (scenarioId == null) {
      setRaw([]);
      setSource("unbound");
      setLoading(false);
      setError(null);
      return;
    }
    const resolvedId = scenarioId;

    setLoading(true);
    setError(null);
    try {
      const results: Omit<TrainingObjectiveView, "coveragePct">[] = [];
      for await (const obj of client(NxgTrainingObjective)
        .where({ scenarioId: { $eq: resolvedId } })
        .asyncIter()) {
        results.push(osdkToRecord(obj));
      }
      if (results.length > 0) {
        results.sort((a, b) => a.ref.localeCompare(b.ref));
        setRaw(results);
        setSource("ontology");
      } else {
        setRaw(SEED_OBJECTIVES);
        setSource("seed");
      }
    } catch (e) {
      setError(String(e));
      setRaw(SEED_OBJECTIVES);
      setSource("seed");
    } finally {
      setLoading(false);
    }
  }, [scenarioId]);

  useEffect(() => {
    void load();
  }, [load]);

  const objectives = useMemo<TrainingObjectiveView[]>(() => {
    // Seed records carry their own illustrative coverage figures.
    if (source === "seed") return SEED_OBJECTIVES;
    const tasksByPhase = groupTasksByPhase(tasks ?? []);
    return raw.map((r) => ({
      ...r,
      coveragePct: objectiveCoveragePct(r.phaseId, tasksByPhase),
    }));
  }, [raw, source, tasks]);

  return { objectives, loading, error, source, refresh: load };
}
