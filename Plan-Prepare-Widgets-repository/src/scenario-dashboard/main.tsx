import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";

import ScenarioDashboardConfig from "./scenarioDashboard.config.js";
import { ScenarioDashboard } from "./ScenarioDashboard.js";
import { client } from "../client.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={ScenarioDashboardConfig} client={client}>
    <ScenarioDashboard />
  </FoundryWidget>
);
