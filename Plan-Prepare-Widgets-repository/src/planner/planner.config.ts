import { NxgScenario } from "@custom-widget/sdk";
import { defineConfig } from "@osdk/widget.client";

// Any updates to the widget configuration in this file such as new parameters
// and events will not be reflected in dev mode. Publish a new version of the
// widget set to start developing against configuration changes.

export default defineConfig({
  id: "planner",
  name: "Planner",
  // Keep under 250 characters — the widget build plugin rejects longer.
  description:
    "Planning landing page: lists the exercises already in the ontology so a user can open one, and runs the wizard that generates a new one. Bind Scenarios to the exercises to offer, and Selected Scenario to a variable to act on the chosen one.",
  type: "workshop",
  parameters: {
    // The exercises to list on the home screen. Bound as an object set so
    // Workshop decides which exercises are on offer — it can filter by
    // status, owner or anything else before handing them over.
    scenarios: {
      displayName: "Scenarios (exercises to list)",
      type: "objectSet",
      allowedType: NxgScenario,
    },
    // Written by the widget when a user opens an exercise from the list,
    // so Workshop can navigate to it.
    //
    // An object set rather than a scenario id string: every scenario-scoped
    // widget in this set takes a Scenario object set, so emitting one lets
    // them be wired straight to this parameter instead of Workshop having
    // to turn an id back into objects.
    selectedScenario: {
      displayName: "Selected Scenario",
      type: "objectSet",
      allowedType: NxgScenario,
    },
    exerciseName: {
      displayName: "Exercise Name",
      type: "string",
    },
    exerciseType: {
      displayName: "Exercise Type",
      type: "string",
    },
  },
  events: {
    // Fired when a user opens an existing exercise from the home screen.
    // Workshop owns the navigation; the widget just says which one.
    onOpenScenario: {
      displayName: "Open Scenario",
      parameterUpdateIds: ["selectedScenario", "exerciseName", "exerciseType"],
    },
    onOpenPreparePhase: {
      displayName: "Open Prepare Phase",
      parameterUpdateIds: ["exerciseName", "exerciseType"],
    },
    onOpenPmesii: {
      displayName: "Open PMESII",
      parameterUpdateIds: ["exerciseName"],
    },
  },
  // The wizard creates scenarios and their children, so let Workshop
  // re-read its own queries once an action lands.
  refreshHostDataOnAction: true,
});
