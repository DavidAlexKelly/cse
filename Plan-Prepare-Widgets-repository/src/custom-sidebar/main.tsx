import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import CustomSidebarConfig from "./customSidebar.config.js";
import { CustomSidebar } from "./CustomSidebar.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={CustomSidebarConfig} client={client}>
    <CustomSidebar />
  </FoundryWidget>,
);
