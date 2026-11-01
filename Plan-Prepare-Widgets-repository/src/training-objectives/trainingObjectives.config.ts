import { NxgPhase, NxgScenario } from "@custom-widget/sdk";
import { defineConfig } from "@osdk/widget.client";

export default defineConfig({
  id: "trainingObjectives",
  name: "Training Objectives",
  description:
    "Define and review training objectives — references, statements, functional areas, and priorities. Drag-reorderable.",
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
  events: {
    // Signal-only: lets Workshop refresh sibling widgets after this one
    // writes. refreshHostDataOnAction covers Workshop's own queries, but
    // another widget showing the same data would otherwise go stale.
    onDataChanged: {
      displayName: "Data Changed",
      parameterUpdateIds: [],
    },
  },
  // The widget writes to the ontology, so let Workshop re-read its
  // own queries once an action lands.
  refreshHostDataOnAction: true,
});
