import { NxgPhase, NxgScenario } from "@custom-widget/sdk";
import { defineConfig } from "@osdk/widget.client";

export default defineConfig({
  id: "taskGraph",
  name: "Task Graph",
  description:
    "Interactive node graph view of task management activities and their dependencies",
  type: "workshop",
  parameters: {
    scenario: {
      displayName: "Scenario",
      type: "objectSet",
      allowedType: NxgScenario,
    },
    // Optional phase filter, so this widget can follow the selection the
    // Phases widget publishes. Both NxgTask and NxgTrainingObjective carry
    // a phaseId, so the filter is meaningful here.
    selectedPhase: {
      displayName: "Selected Phase (optional filter)",
      type: "objectSet",
      allowedType: NxgPhase,
    },
  },
  events: {},
});
