import { OsdkProvider } from "@osdk/react";
import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import ScenarioConfig from "./scenario.config.js";
import { Scenario } from "./Scenario.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={ScenarioConfig} client={client}>
    <OsdkProvider client={client}>
      <Scenario />
    </OsdkProvider>
  </FoundryWidget>,
);
