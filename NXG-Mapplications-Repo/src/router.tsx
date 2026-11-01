import AuthCallback from "@/AuthCallback";
import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

const OrbatManagerApp     = lazy(() => import("./apps/orbatManager/App"));
const ScenarioPlannerApp  = lazy(() => import("./apps/scenarioPlanner/App"));
const TimelineViewApp     = lazy(() => import("./apps/timelineView/App"));
const HlaMapApp           = lazy(() => import("./apps/hlamap/index"));
const AnalysisScreenApp   = lazy(() => import("./apps/analysisScreen/index"));
// Readiness → launch → live map for one phase. The Execute tab of the Plan &
// Prepare Workshop embeds this route.
const ExecuteApp          = lazy(() => import("./apps/execute/App"));
// /globe (a bare basemap test page, apps/globeMap) was removed: its source is
// not in this repository, and a lazy import of a missing module fails the
// build, not just the route.
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
      // The Scenario Planner, also reachable at /scenario-plan.
      path: "/",
      element: withSuspense(<ScenarioPlannerApp />),
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
      path: "/execute",
      element: withSuspense(<ExecuteApp />),
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
