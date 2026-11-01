import { NxgPhase, NxgScenario } from "@custom-widget/sdk";
import { defineConfig } from "@osdk/widget.client";

export default defineConfig({
  id: "phasesWidget",
  name: "Phases",
  // Keep under 250 characters — the widget build plugin rejects longer.
  description:
    "Phase cards for a CAX exercise: status, stats, objective coverage and open gaps. Click a card for detail. Bind Scenario to pick the exercise; bind Selected Phase to a variable so other widgets follow the selection.",
  type: "workshop",
  parameters: {
    scenario: {
      displayName: "Scenario",
      type: "objectSet",
      allowedType: NxgScenario,
    },
    // Written by the widget when a card is selected, so Workshop can drive
    // other widgets from it.
    //
    // This is an object set rather than a phase id string: the widgets that
    // consume a selected phase (MIL/MEL, Task Graph, Training Objectives)
    // all take an object set, so emitting one lets them be wired directly
    // instead of Workshop having to convert an id back into objects.
    selectedPhase: {
      displayName: "Selected Phase",
      type: "objectSet",
      allowedType: NxgPhase,
    },
  },
  events: {
    onPhaseSelected: {
      displayName: "Phase Selected",
      parameterUpdateIds: ["selectedPhase"],
    },
    // Signal-only: lets Workshop refresh sibling widgets after this one
    // writes. refreshHostDataOnAction covers Workshop's own queries, but
    // another widget showing the same data would otherwise go stale.
    onDataChanged: {
      displayName: "Data Changed",
      parameterUpdateIds: [],
    },
  },
  // The widget creates, edits and deletes phases, so let Workshop
  // re-read its own queries once an action lands.
  refreshHostDataOnAction: true,
});
