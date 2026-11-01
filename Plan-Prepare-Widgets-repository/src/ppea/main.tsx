import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import PpeaConfig from "./ppea.config.js";
import { Ppea } from "./Ppea.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={PpeaConfig} client={client}>
    <Ppea />
  </FoundryWidget>,
);
