import { NxgScenario } from "@custom-widget/sdk";
import { defineConfig } from "@osdk/widget.client";

export default defineConfig({
  id: "taskAssignment",
  name: "Task Assignment",
  description: "Assign approvers and task owners to workflow tasks",
  type: "workshop",
  parameters: {
    scenario: {
      displayName: "Scenario",
      type: "objectSet",
      allowedType: NxgScenario,
    },
  },
  // navigateToGraph was declared here but never emitted — the list/graph
  // toggle is internal widget state, so Workshop had a dead event to bind.
  events: {
    // Signal-only: lets Workshop refresh sibling widgets after this one
    // writes. refreshHostDataOnAction covers Workshop's own queries, but
    // another widget showing the same data would otherwise go stale.
    onDataChanged: {
      displayName: "Data Changed",
      parameterUpdateIds: [],
    },
  },
  // The widget creates, edits and deletes tasks and subtasks, so let
  // Workshop re-read its own queries once an action lands.
  refreshHostDataOnAction: true,
});
