import { OsdkProvider } from "@osdk/react";
import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import TaskManagerConfig from "./taskManager.config.js";
import { TaskManager } from "./TaskManager.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={TaskManagerConfig} client={client}>
    <OsdkProvider client={client}>
      <TaskManager />
    </OsdkProvider>
  </FoundryWidget>,
);
