// ============================================================
// useNxgOpforDefinitions
//
// Loads the OPFOR doctrine cards for a scenario.
//
// These were previously local-only state in the Scenario widget,
// so a newly written OPFOR card was lost on refresh. They are now
// a first-class object type.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { NxgOpforDefinition } from "@custom-widget/sdk";
import type { Osdk } from "@osdk/client";
import { client } from "../../client.js";
import { splitTags } from "./useNxgScenarioMutations.js";
import type { DataSource } from "./dataSource.js";
import type { OpforDefinition } from "../../scenario/scenarioData.js";

function osdkToOpfor(
  obj: Osdk.Instance<NxgOpforDefinition>,
): OpforDefinition {
  return {
    id: obj.opforDefinitionId,
    title: obj.opforTitle ?? "",
    generated: obj.aiGenerated ?? false,
    meta: obj.opforMeta ?? "",
    body: obj.opforBody ?? "",
    tags: splitTags(obj.opforTags),
  };
}

export interface UseNxgOpforDefinitionsResult {
  opforDefinitions: OpforDefinition[];
  loading: boolean;
  error: string | null;
  /** "ontology" once any card exists for the scenario, else "seed". */
  source: DataSource;
  refresh: () => void;
}

export function useNxgOpforDefinitions(
  scenarioId: string | null | undefined,
): UseNxgOpforDefinitionsResult {
  const [opforDefinitions, setOpforDefinitions] = useState<OpforDefinition[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>("unbound");

  const load = useCallback(async () => {
    // No scenario bound — show nothing rather than quietly loading a
    // default exercise. The widget renders an explicit empty state.
    if (scenarioId == null) {
      setOpforDefinitions([]);
      setSource("unbound");
      setLoading(false);
      setError(null);
      return;
    }
    const resolvedId = scenarioId;
    setLoading(true);
    setError(null);
    try {
      const results: OpforDefinition[] = [];
      for await (const obj of client(NxgOpforDefinition)
        .where({ scenarioId: { $eq: resolvedId } })
        .asyncIter()) {
        results.push(osdkToOpfor(obj));
      }
      results.sort((a, b) => a.title.localeCompare(b.title));
      setOpforDefinitions(results);
      setSource(results.length > 0 ? "ontology" : "seed");
    } catch (e) {
      setError(String(e));
      setOpforDefinitions([]);
      setSource("seed");
    } finally {
      setLoading(false);
    }
  }, [scenarioId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { opforDefinitions, loading, error, source, refresh: load };
}
