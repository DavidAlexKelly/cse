// src/apps/scenarioPlanner/hooks/useUnitOrbat.ts
//
// Loads the ORBAT sub-tree for the unit currently selected on the map, so the
// Scenario Planner's right-hand bar can show the force the planner has built
// without switching apps.

import { useCallback, useEffect, useState } from "react";
import type { CompositionNode } from "@/shared/types";
import { loadOrbatSubtree } from "../../../shared/orbat/loadOrbatSubtree";

export interface UseUnitOrbatResult {
  root: CompositionNode | null;
  nodeCount: number;
  truncated: boolean;
  loading: boolean;
  /** Set when the graph could not be read, or the root no longer exists. */
  error: string | null;
  reload: () => void;
}

export function useUnitOrbat(
  hierarchyKey: string | undefined,
  rootUnitKey: string | undefined,
): UseUnitOrbatResult {
  const [root, setRoot] = useState<CompositionNode | null>(null);
  const [nodeCount, setNodeCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!hierarchyKey || !rootUnitKey) {
      setRoot(null);
      setNodeCount(0);
      setTruncated(false);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    loadOrbatSubtree(hierarchyKey, rootUnitKey)
      .then((subtree) => {
        if (cancelled) return;
        if (!subtree) {
          setRoot(null);
          setNodeCount(0);
          setError(
            "This unit's ORBAT could not be found — it may have been deleted in the ORBAT Manager.",
          );
          return;
        }
        setRoot(subtree.root);
        setNodeCount(subtree.nodeCount);
        setTruncated(subtree.truncated);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[useUnitOrbat] failed to load ORBAT:", err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [hierarchyKey, rootUnitKey, version]);

  return { root, nodeCount, truncated, loading, error, reload };
}
