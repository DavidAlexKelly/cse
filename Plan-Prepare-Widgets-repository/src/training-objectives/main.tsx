import { OsdkProvider } from "@osdk/react";
import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import TrainingObjectivesConfig from "./trainingObjectives.config.js";
import { TrainingObjectives } from "./TrainingObjectives.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={TrainingObjectivesConfig} client={client}>
    <OsdkProvider client={client}>
      <TrainingObjectives />
    </OsdkProvider>
  </FoundryWidget>,
);
