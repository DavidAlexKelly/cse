import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import CustomHeaderConfig from "./customHeader.config.js";
import { CustomHeader } from "./CustomHeader.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={CustomHeaderConfig} client={client}>
    <CustomHeader />
  </FoundryWidget>,
);
