/**
 * useOrbatData — loads all ontology data for a given operation key.
 *
 * Fetches in parallel where possible:
 *   1. operation + edges (sequential — need snapshot key first)
 *   2. units + symbols + configs (parallel — all need unit keys from edges)
 *   3. assets (parallel with above — needs classNames from configs)
 */

import { useState, useEffect, useCallback } from "react";
import type {
  OUnit,
  OEdge,
  OSymbol,
  OSimulatorConfig,
  OAsset,
  OOperation,
} from "../types/index";
import {
  loadOperation,
  loadEdgesForOperation,
  loadUnits,
  loadSymbols,
  loadConfigs,
  loadAssets,
} from "../lib/foundry";

export interface OrbatData {
  operation: OOperation | null;
  units: Map<string, OUnit>;
  edges: OEdge[];
  symbols: Map<string, OSymbol>;
  configs: Map<string, OSimulatorConfig>;
  assets: Map<string, OAsset>;
}

export interface UseOrbatDataResult {
  data: OrbatData;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const EMPTY: OrbatData = {
  operation: null,
  units: new Map(),
  edges: [],
  symbols: new Map(),
  configs: new Map(),
  assets: new Map(),
};

export function useOrbatData(operationKey: string | null): UseOrbatDataResult {
  const [data, setData] = useState<OrbatData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!operationKey) {
      setData(EMPTY);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Step 1: operation metadata + hierarchy edges
        const [operation, edges] = await Promise.all([
          loadOperation(operationKey),
          loadEdgesForOperation(operationKey),
        ]);

        if (cancelled) return;

        // Derive unit keys from edges
        const unitKeySet = new Set<string>();
        for (const e of edges) {
          unitKeySet.add(e.childUnitKey);
          unitKeySet.add(e.parentUnitKey);
        }
        const unitKeys = [...unitKeySet];

        // Step 2: units, symbols, configs in parallel
        const [unitList, symbolList, configList] = await Promise.all([
          loadUnits(unitKeys),
          loadSymbols(unitKeys),
          loadConfigs(unitKeys),
        ]);

        if (cancelled) return;

        // Step 3: VBS4 asset catalogue entries for referenced simulatorIdentifierCodes
        const simIds = [
          ...new Set(
            unitList
              .map((u) => u.simulatorIdentifierCode)
              .filter((x): x is string => Boolean(x))
          ),
        ];
        const assetList = await loadAssets(simIds);

        if (cancelled) return;

        // Build Maps
        const units = new Map(unitList.map((u) => [u.primaryKey, u]));
        const symbols = new Map(symbolList.map((s) => [s.unitKey, s]));
        const configs = new Map(configList.map((c) => [c.unitKey, c]));
        const assets = new Map(assetList.map((a) => [a.identifier, a]));

        setData({ operation, units, edges, symbols, configs, assets });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [operationKey, version]);

  return { data, loading, error, reload };
}
