import AuthCallback from "@/AuthCallback";
import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

const OrbatManagerApp     = lazy(() => import("./apps/orbatManager/App"));
const ScenarioPlannerApp  = lazy(() => import("./apps/scenarioPlanner/App"));
const TimelineViewApp     = lazy(() => import("./apps/timelineView/App"));
const HlaMapApp           = lazy(() => import("./apps/hlamap/index"));
const AnalysisScreenApp   = lazy(() => import("./apps/analysisScreen/index"));
// Bare map for testing the chunked planet basemap media set. No units, no
// terrain, no orders — just tiles.
const GlobeMapApp         = lazy(() => import("./apps/globeMap/App"));
// The Battlegroup Wargame System (/bgws) now lives in its own repository and
// Developer Console app ("Realtime AI Wargaming").

/** Minimal full-screen spinner shown while a chunk is being fetched */
function AppLoader() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "100vw",
      height: "100vh",
      background: "#060d18",
      color: "#475569",
      fontFamily: "'Courier New', monospace",
      fontSize: 13,
      letterSpacing: "0.1em",
    }}>
      LOADING…
    </div>
  );
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<AppLoader />}>{element}</Suspense>;
}

export const router = createBrowserRouter(
  [
    {
      // Restored to master's landing page. This branch had it pointed at the
      // globe test app and then at Scenario Planner while developing the
      // basemap; neither belongs in a merge whose subject is the basemap.
      // Both remain reachable at /globe and /scenario-plan.
      path: "/",
      element: withSuspense(<ScenarioPlannerApp />),
    },
    {
      path: "/globe",
      element: withSuspense(<GlobeMapApp />),
    },
    {
      path: "/orbat",
      element: withSuspense(<OrbatManagerApp />),
    },
    {
      path: "/scenario-plan",
      element: withSuspense(<ScenarioPlannerApp />),
    },
    {
      path: "/timeline",
      element: withSuspense(<TimelineViewApp />),
    },
    {
      path: "/hlamap",
      element: withSuspense(<HlaMapApp />),
    },
    {
      path: "/analysis",
      element: withSuspense(<AnalysisScreenApp />),
    },
    {
      path: "/auth/callback",
      element: <AuthCallback />,
    },
  ],
  { basename: import.meta.env.BASE_URL }
);
