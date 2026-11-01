import { OsdkProvider } from "@osdk/react";
import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import MilMelConfig from "./milMel.config.js";
import { MilMel } from "./MilMel.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={MilMelConfig} client={client}>
    <OsdkProvider client={client}>
      <MilMel />
    </OsdkProvider>
  </FoundryWidget>,
);
