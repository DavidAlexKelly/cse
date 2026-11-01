import { NxgScenario } from "@custom-widget/sdk";
import { defineConfig } from "@osdk/widget.client";

export default defineConfig({
  id: "scenarioDashboard",
  name: "Scenario Dashboard",
  description:
    "Landing page dashboard for a CAX exercise — shows scenario stats, open tasks, phase readiness and objective coverage. Use 'View map' and 'View tasks' events to navigate to other widgets.",
  type: "workshop",
  parameters: {
    scenario: {
      displayName: "Scenario",
      type: "objectSet",
      allowedType: NxgScenario,
    },
  },
  events: {
    onViewMap: {
      displayName: "View Map",
      parameterUpdateIds: [],
    },
    onViewTasks: {
      displayName: "View Tasks",
      parameterUpdateIds: [],
    },
    onViewPhases: {
      displayName: "View Phases",
      parameterUpdateIds: [],
    },
    onOpenChatbot: {
      displayName: "Open Chatbot",
      parameterUpdateIds: [],
    },
  },
});
