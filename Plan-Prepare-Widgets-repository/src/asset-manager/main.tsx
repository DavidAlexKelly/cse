import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import AssetManagerConfig from "./assetManager.config.js";
import { AssetManagerWidget } from "./AssetManagerWidget.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={AssetManagerConfig} client={client}>
    <AssetManagerWidget />
  </FoundryWidget>,
);
