import { OsdkProvider } from "@osdk/react";
import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../../client.js";
import TaskAssignmentConfig from "./taskAssignment.config.js";
import { TaskAssignment } from "./TaskAssignment.js";
import "../../shared/styling/index.css";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={TaskAssignmentConfig} client={client}>
    <OsdkProvider client={client}>
      <TaskAssignment />
    </OsdkProvider>
  </FoundryWidget>,
);
