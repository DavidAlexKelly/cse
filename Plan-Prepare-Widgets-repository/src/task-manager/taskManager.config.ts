import { NxgScenario } from "@custom-widget/sdk";
import { defineConfig } from "@osdk/widget.client";

// Any updates to the widget configuration in this file such as new parameters
// and events will not be reflected in dev mode. Publish a new version of the
// widget set to start developing against configuration changes.

export default defineConfig({
  id: "taskManager",
  name: "Task Manager",
  description:
    "Searchable list of the planning and preparation tasks for an exercise. Bind Scenario to choose the exercise.",
  type: "workshop",
  parameters: {
    // Previously undeclared, so Workshop could not bind it and the widget
    // always fell back to the default scenario — while still offering a
    // delete action against those tasks.
    scenario: {
      displayName: "Scenario",
      type: "objectSet",
      allowedType: NxgScenario,
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
  // The widget deletes tasks, so let Workshop re-read its own queries.
  refreshHostDataOnAction: true,
});
