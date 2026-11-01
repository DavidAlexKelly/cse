// src/shared/hooks/useAppNavigate.ts
//
// Navigation between the apps that keeps demo mode on.
//
// Standalone, demo mode lives in the URL (?mock=1, see useMockDemo). A plain
// navigate("/execute") drops it, so walking the demo path Plan → Execute →
// HLA Map → Analysis from the app switcher silently fell back to live calls
// halfway through. Every in-app navigation goes through here instead.
import { useCallback } from "react";
import { type NavigateOptions, useLocation, useNavigate } from "react-router-dom";
import { MOCK_DEMO_PARAM, readMockDemoParam } from "./useMockDemo";

/** `path`, with the demo-mode parameter carried over from `currentSearch`. */
export function carryDemoParam(path: string, currentSearch: string): string {
  if (!readMockDemoParam(currentSearch)) return path;
  const [beforeHash, hash = ""] = path.split("#");
  const [pathname, query = ""] = beforeHash.split("?");
  const params = new URLSearchParams(query);
  if (params.has(MOCK_DEMO_PARAM)) return path;
  params.set(MOCK_DEMO_PARAM, "1");
  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ""}`;
}

/** useNavigate, keeping demo mode across apps. */
export function useAppNavigate(): (path: string, options?: NavigateOptions) => void {
  const navigate = useNavigate();
  const { search } = useLocation();
  return useCallback(
    (path: string, options?: NavigateOptions) => navigate(carryDemoParam(path, search), options),
    [navigate, search],
  );
}
