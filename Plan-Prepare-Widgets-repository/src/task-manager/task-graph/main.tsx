import { OsdkProvider } from "@osdk/react";
import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../../client.js";
import TaskGraphConfig from "./taskGraph.config.js";
import { TaskGraphStandalone } from "./TaskGraphStandalone.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={TaskGraphConfig} client={client}>
    <OsdkProvider client={client}>
      <TaskGraphStandalone />
    </OsdkProvider>
  </FoundryWidget>,
);
