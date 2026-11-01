// hooks/useCompositionData.ts
import { useState, useEffect, useCallback, useRef } from "react";
import type {
  OCanonicalAsset,
  OUnitType,
  OEquipmentType,
  ORelationshipType,
} from "../types/index";
import {
  loadCanonicalAssets,
  loadUnitTypes,
  loadEquipmentTypes,
  loadRelationshipTypes,
} from "../lib/foundry";

export interface CompositionRefData {
  canonicalAssets: Map<string, OCanonicalAsset>;
  unitTypes: Map<string, OUnitType>;
  equipmentTypes: Map<string, OEquipmentType>;
  relationshipTypes: Map<string, ORelationshipType>;
}

export interface UseCompositionDataResult {
  refData: CompositionRefData;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const EMPTY: CompositionRefData = {
  canonicalAssets: new Map(),
  unitTypes: new Map(),
  equipmentTypes: new Map(),
  relationshipTypes: new Map(),
};

/**
 * Shared module-level snapshot so multiple concurrent mounts of this hook
 * reuse the same fully-populated Maps. Together with the TTL cache inside
 * `lib/foundry.ts::loadXxx` this collapses the "reference data" load into
 * a single fetch + a single Map build per user session.
 */
let _cachedSnapshot: CompositionRefData | null = null;

export function useCompositionData(): UseCompositionDataResult {
  const [refData, setRefData] = useState<CompositionRefData>(
    () => _cachedSnapshot ?? EMPTY,
  );
  const [loading, setLoading] = useState(!_cachedSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const cancelledRef = useRef(false);

  const reload = useCallback(() => {
    _cachedSnapshot = null;
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    setError(null);

    if (_cachedSnapshot && version === 0) {
      setRefData(_cachedSnapshot);
      setLoading(false);
      return () => { cancelledRef.current = true; };
    }

    setLoading(true);

    (async () => {
      try {
        const [assets, unitTypes, equipmentTypes, relationshipTypes] =
          await Promise.all([
            loadCanonicalAssets(),
            loadUnitTypes(),
            loadEquipmentTypes(),
            loadRelationshipTypes(),
          ]);

        if (cancelledRef.current) return;

        const snapshot: CompositionRefData = {
          canonicalAssets: new Map(assets.map((a) => [a.primaryKey, a])),
          unitTypes: new Map(unitTypes.map((t) => [t.primaryKey, t])),
          equipmentTypes: new Map(
            equipmentTypes.map((e) => [e.primaryKey, e])
          ),
          relationshipTypes: new Map(
            relationshipTypes.map((r) => [r.primaryKey, r])
          ),
        };
        _cachedSnapshot = snapshot;
        setRefData(snapshot);
      } catch (err) {
        console.error("[useCompositionData] error:", err);
        if (!cancelledRef.current)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [version]);

  return { refData, loading, error, reload };
}

