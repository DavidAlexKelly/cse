import { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "@/router";
import { setupBasemap } from "@/shared/map/dechoBasemapSetup";

// Hands this app's OAuth client and Foundry origin to @acc/decho-basemap.
// Must run before any map mounts; doing it here covers every route by
// construction.
setupBasemap();

// ── Shared design-system styles ───────────────────────────────────────────
// global.css defines all CSS custom properties (--bg-*, --text-*, --accent-*,
// etc.) and resets. It also imports animations.css via @import.
// components.css provides mil-*, mel-*, tl-* shared component classes.
// These MUST be loaded before any app-specific stylesheets so their tokens
// and class definitions are available.
import "@/shared/styles/global.css";
import "@/shared/styles/components.css";
import "@/shared/styles/ui-redesign.css";
import "@/shared/styles/task-page.css";

// Remove default browser margin
document.body.style.margin = "0";
document.body.style.padding = "0";
document.body.style.overflow = "hidden";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <Suspense>
    <RouterProvider router={router} />
  </Suspense>
);
