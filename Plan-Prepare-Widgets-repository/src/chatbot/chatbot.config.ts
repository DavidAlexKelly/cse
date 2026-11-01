import { NxgScenario } from "@custom-widget/sdk";
import { defineConfig } from "@osdk/widget.client";

export default defineConfig({
  id: "chatbot",
  name: "[NXG] Operations Chatbot",
  description:
    "AI-powered operations assistant backed by the NXG AIP Agent. Ask questions about the scenario, phases, tasks, and planning status.",
  type: "workshop",
  parameters: {
    scenario: {
      displayName: "Scenario",
      type: "objectSet",
      allowedType: NxgScenario,
    },
  },
  events: {
    onClose: {
      displayName: "Close Chatbot",
      parameterUpdateIds: [],
    },
  },
});
