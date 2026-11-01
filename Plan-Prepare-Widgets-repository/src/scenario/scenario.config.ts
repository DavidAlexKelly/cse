import { NxgScenario } from "@custom-widget/sdk";
import { defineConfig } from "@osdk/widget.client";

export default defineConfig({
  id: "scenario",
  name: "Scenario",
  description:
    "Define and review exercise scenario — strategic context, OPFOR definitions, subtask tracking, and review thread.",
  type: "workshop",
  parameters: {
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
  // The widget writes to the ontology, so let Workshop re-read its
  // own queries once an action lands.
  refreshHostDataOnAction: true,
});
