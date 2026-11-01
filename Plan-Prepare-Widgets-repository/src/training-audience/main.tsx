import { OsdkProvider } from "@osdk/react";
import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import TrainingAudienceConfig from "./trainingAudience.config.js";
import { TrainingAudience } from "./TrainingAudience.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={TrainingAudienceConfig} client={client}>
    <OsdkProvider client={client}>
      <TrainingAudience />
    </OsdkProvider>
  </FoundryWidget>,
);
