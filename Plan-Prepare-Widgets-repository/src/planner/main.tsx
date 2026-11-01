import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import PlannerConfig from "./planner.config.js";
import { Planner } from "./Planner.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={PlannerConfig} client={client}>
    <Planner />
  </FoundryWidget>,
);
