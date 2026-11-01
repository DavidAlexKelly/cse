// ============================================================
//  Standalone Equipment Type loader — used at the widget root so
//  the picker is available even before the Foundry Import panel
//  has been visited.  A single lightweight scan of NxgEquipmentType
//  suffices; the catalogue is small (a few hundred rows).
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { client } from "../client.js";
import { NxgEquipmentType } from "@custom-widget/sdk";
import type { EquipmentTypeRef } from "./types.js";

export interface EquipmentTypeLoaderState {
  types: EquipmentTypeRef[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useEquipmentTypesLoader(): EquipmentTypeLoaderState {
  const [types, setTypes] = useState<EquipmentTypeRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const entries: EquipmentTypeRef[] = [];
      for await (const et of client(NxgEquipmentType).asyncIter()) {
        const key = et.primaryKey_;
        if (!key) continue;
        entries.push({
          key,
          nomenclature: et.nomenclature ?? key,
          description: et.description ?? undefined,
        });
      }
      entries.sort((a, b) =>
        (a.nomenclature ?? a.key).localeCompare(b.nomenclature ?? b.key),
      );
      setTypes(entries);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return { types, loading, error, refresh: () => void fetchAll() };
}
