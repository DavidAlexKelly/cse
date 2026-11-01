/**
 * useOperations.ts — loads all NxgOperation objects from the ontology.
 * Used to populate the Map Placement sidebar so users can load
 * existing ORBAT hierarchies from the ontology onto the map.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { OOperation } from "@/shared/types";
import { loadOperations } from "@/shared/lib/foundry";

export interface UseOperationsResult {
  operations: OOperation[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Module-scoped cache of the last successful load. `loadOperations` is
 * already TTL-cached at the network layer, but this avoids re-sorting the
 * list every time a component remounts.
 */
let _cached: OOperation[] | null = null;

export function useOperations(): UseOperationsResult {
  const [operations, setOperations] = useState<OOperation[]>(() => _cached ?? []);
  const [loading, setLoading]       = useState(!_cached);
  const [error, setError]           = useState<string | null>(null);
  const [version, setVersion]       = useState(0);
  const cancelledRef                = useRef(false);

  const reload = useCallback(() => {
    _cached = null;
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    setError(null);

    // Fast path — reuse the sorted list from a previous mount.
    if (_cached && version === 0) {
      setOperations(_cached);
      setLoading(false);
      return () => { cancelledRef.current = true; };
    }

    setLoading(true);
    loadOperations()
      .then((ops) => {
        if (cancelledRef.current) return;
        // `loadOperations` result is cached, but each caller wants it
        // sorted. Sort once, cache the sorted array.
        const sorted = [...ops].sort((a, b) => b.startTime.localeCompare(a.startTime));
        _cached = sorted;
        setOperations(sorted);
      })
      .catch((err) => {
        if (!cancelledRef.current) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false);
      });

    return () => { cancelledRef.current = true; };
  }, [version]);

  return { operations, loading, error, reload };
}

