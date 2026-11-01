import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";

import PhasesWidgetConfig from "./phasesWidget.config.js";
import { PhasesWidget } from "./PhasesWidget.js";
import { client } from "../client.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={PhasesWidgetConfig} client={client}>
    <PhasesWidget />
  </FoundryWidget>
);
