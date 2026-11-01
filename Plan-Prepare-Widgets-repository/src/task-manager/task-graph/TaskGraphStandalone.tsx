// ── TaskGraphStandalone
//
// Standalone entry point for the Task Graph widget.
// Resolves the bound scenario, loads phases + tasks from the
// ontology, then renders TaskGraph with them injected.
//
// Optionally narrows to a single phase when a Selected Phase
// object set is bound, so the graph can follow the selection the
// Phases widget publishes.
// ============================================================

import React, { useMemo } from "react";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import { useNxgTasks } from "../../shared/hooks/useNxgTasks.js";
import { useNxgPhases } from "../../shared/hooks/useNxgPhases.js";
import { useScenarioIdFromObjectSet } from "../../shared/hooks/useScenarioIdFromParam.js";
import { useFirstObjectPropertyValue } from "../../shared/hooks/useFirstObjectPropertyValue.js";
import { ScenarioGate } from "../../shared/components/ScenarioGate.js";
import { TaskGraph } from "./TaskGraph.js";
import type taskGraphConfig from "./taskGraph.config.js";

const useWidgetContext = useFoundryWidgetContext.withTypes<typeof taskGraphConfig>();

const TaskGraphStandaloneBody: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {
  const { parameters } = useWidgetContext();
  const selectedPhaseId = useFirstObjectPropertyValue(
    parameters.values.selectedPhase?.objectSet,
    "phaseId",
  );

  const { tasks } = useNxgTasks(scenarioId);
  const { phases } = useNxgPhases(scenarioId);

  // When a phase is bound, show only that phase and its tasks. Tasks with
  // no phase are dropped rather than shown against the wrong phase.
  const visiblePhases = useMemo(
    () =>
      selectedPhaseId == null
        ? phases
        : phases.filter((p) => p.phaseId === selectedPhaseId),
    [phases, selectedPhaseId],
  );

  const visibleTasks = useMemo(
    () =>
      selectedPhaseId == null
        ? tasks
        : tasks.filter((t) => t.phaseId === selectedPhaseId),
    [tasks, selectedPhaseId],
  );

  return <TaskGraph phases={visiblePhases} liveTasks={visibleTasks} />;
};

// ── Widget entry point ─────────────────────────────────────────────────────
// Resolves the bound scenario before mounting the body, so the body always
// has a real scenario to work with and never silently falls back to a
// default exercise.

export const TaskGraphStandalone: React.FC = () => {
  const { parameters } = useWidgetContext();
  const binding = useScenarioIdFromObjectSet(
    parameters.values.scenario?.objectSet
  );
  return (
    <ScenarioGate binding={binding}>
      {(scenarioId) => <TaskGraphStandaloneBody scenarioId={scenarioId} />}
    </ScenarioGate>
  );
};
