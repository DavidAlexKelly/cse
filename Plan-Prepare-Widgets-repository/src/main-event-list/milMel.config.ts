import { NxgInject, NxgPhase, NxgScenario } from "@custom-widget/sdk";
import { defineConfig } from "@osdk/widget.client";

// Any updates to the widget configuration in this file such as new parameters
// and events will not be reflected in dev mode. Publish a new version of the
// widget set to start developing against configuration changes.

export default defineConfig({
  id: "milMel",
  name: "MIL/MEL",
  // Keep under 250 characters — the widget build plugin rejects longer.
  description:
    "Scripted events and incidents (MIL/MEL) for an exercise, grouped by phase. Bind Scenario to pick the exercise; optionally bind Selected Phase to open that phase's tab, or Selected Inject to deep-link to one event.",
  type: "workshop",
  parameters: {
    // These three were read by the widget but never declared here, so
    // Workshop had no way to bind them. The widget silently fell back to
    // a default scenario and the phase/inject deep-links never resolved.
    scenario: {
      displayName: "Scenario",
      type: "objectSet",
      allowedType: NxgScenario,
    },
    selectedPhase: {
      displayName: "Selected Phase (opens that phase's tab)",
      type: "objectSet",
      allowedType: NxgPhase,
    },
    selectedInject: {
      displayName: "Selected Inject (opens that event's detail)",
      type: "objectSet",
      allowedType: NxgInject,
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
  // The widget creates, edits and deletes injects, so let Workshop
  // re-read its own queries once an action lands.
  refreshHostDataOnAction: true,
});
