import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import OrbatManagerConfig from "./orbatManager.config.js";
import { OrbatWidget } from "./OrbatWidget.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={OrbatManagerConfig} client={client}>
    <OrbatWidget />
  </FoundryWidget>,
);
