import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import DataVisualiserConfig from "./dataVisualiser.config.js";
import { DataVisualiser } from "./DataVisualiser.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={DataVisualiserConfig} client={client}>
    <DataVisualiser />
  </FoundryWidget>,
);
