// src/apps/scenarioPlanner/hooks/usePhaseOrbat.ts
//
// Load and cache one phase's ORBAT forest — every unit, its parent and its
// position — indexed by level for the map's level view.
//
// Two properties matter more than they look:
//
//   STALE LOADS ARE DROPPED. Any change of key (including to null, when the
//   planner goes back to Branches) supersedes the load in flight, and the
//   previous phase's index is cleared at once. Without this, leaving a phase
//   and coming back could show the old phase's tree for a moment — or, if its
//   load finished last, for good.
//
//   MOVES STICK. A drag is applied optimistically as a position override. The
//   override is only dropped when a reload returns the SAME stored position,
//   so a zoom, a level change or a reload that raced the write can never snap
//   a unit back to where it was.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ForestIndex,
  type ForestNode,
  type PositionMap,
  indexForest,
  withPositionOverrides,
} from "../../../shared/orbat/orbatLevels";
import { loadPhaseForest } from "../../../shared/orbat/phaseOrbat";

export interface UsePhaseOrbatResult {
  /** Index over the forest with any pending moves applied. Null before the first load. */
  index: ForestIndex | null;
  loading: boolean;
  error: string | null;
  truncated: boolean;
  /** Reload from the ontology. Resolves when the new index is in place. */
  reload: () => Promise<void>;
  /** Apply moves optimistically (before or while they are written). */
  applyMoves: (moves: PositionMap) => void;
  /** Undo optimistic moves after a failed write. */
  revertMoves: (keys: Iterable<string>) => void;
}

/** Within ~10 cm — what a stored double reads back as. */
function samePosition(a: { lat: number; lng: number }, b: ForestNode): boolean {
  return (
    b.lat != null &&
    b.lng != null &&
    Math.abs(a.lat - b.lat) < 1e-6 &&
    Math.abs(a.lng - b.lng) < 1e-6
  );
}

export function usePhaseOrbat(
  hierarchyKey: string | null,
  phaseId: string | null,
): UsePhaseOrbatResult {
  const [nodes, setNodes] = useState<ForestNode[] | null>(null);
  const [overrides, setOverrides] = useState<PositionMap>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  /** Incremented on every key change and reload; a load only lands if it still matches. */
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    if (!hierarchyKey || !phaseId) {
      setNodes(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const forest = await loadPhaseForest(hierarchyKey, phaseId);
      if (mine !== generation.current) return;
      setNodes(forest.nodes);
      setTruncated(forest.truncated);
      // Keep an override until the stored position has caught up with it.
      setOverrides((prev) => {
        if (prev.size === 0) return prev;
        const byKey = new Map(forest.nodes.map((n) => [n.key, n]));
        const next: PositionMap = new Map();
        for (const [key, pos] of prev) {
          const stored = byKey.get(key);
          if (stored && !samePosition(pos, stored)) next.set(key, pos);
        }
        return next;
      });
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [hierarchyKey, phaseId]);

  useEffect(() => {
    // Clear the previous phase immediately — never show its tree under this one.
    setNodes(null);
    setOverrides(new Map());
    setTruncated(false);
    void load();
  }, [load]);

  const applyMoves = useCallback((moves: PositionMap) => {
    if (moves.size === 0) return;
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const [k, p] of moves) next.set(k, p);
      return next;
    });
  }, []);

  const revertMoves = useCallback((keys: Iterable<string>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }, []);

  const index = useMemo(
    () => (nodes ? indexForest(withPositionOverrides(nodes, overrides)) : null),
    [nodes, overrides],
  );

  return { index, loading, error, truncated, reload: load, applyMoves, revertMoves };
}
