import { OsdkProvider } from "@osdk/react";
import { FoundryWidget } from "@osdk/widget.client-react";
import { createRoot } from "react-dom/client";
import { client } from "../client.js";
import PmesiiAnalysisConfig from "./pmesiiAnalysis.config.js";
import { PmesiiAnalysis } from "./PmesiiAnalysis.js";

const root = document.getElementById("root")!;

createRoot(root).render(
  <FoundryWidget config={PmesiiAnalysisConfig} client={client}>
    <OsdkProvider client={client}>
      <PmesiiAnalysis />
    </OsdkProvider>
  </FoundryWidget>,
);
