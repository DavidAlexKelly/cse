import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";

import ChatbotConfig from "./chatbot.config.js";
import { Chatbot } from "./Chatbot.js";
import { client } from "../client.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={ChatbotConfig} client={client}>
    <Chatbot />
  </FoundryWidget>
);
