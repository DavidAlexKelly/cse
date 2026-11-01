// ============================================================
// useNxgScenarioListFromObjectSet
//
// Reads every scenario out of a widget objectSet parameter,
// rather than just the first one like useScenarioIdFromObjectSet.
//
// Used by the Planner, which lists the exercises already in the
// ontology so a user can open one. Reading from the bound object
// set rather than querying all NxgScenario means Workshop stays
// in control of which exercises are offered — it can filter by
// status, owner, or anything else before handing them over.
//
// The objectSet comes from @osdk/widget.client-react's parameter
// system, which may use a different internal @osdk/api build than
// the one our code imports, so it is duck-typed here.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import type { DataSource } from "./dataSource.js";

interface FetchableObjectSet {
  fetchPage(opts: {
    $pageSize: number;
  }): Promise<{ data: Array<Record<string, unknown>> }>;
}

/**
 * One scenario, flattened to the fields the Planner's cards need.
 *
 * Deliberately carries no people: NxgScenario has no owner or team,
 * and personnel are not modelled in the ontology, so the cards show
 * no avatars rather than inventing them.
 */
export interface ScenarioSummary {
  scenarioId: string;
  scenarioName: string;
  scenarioType: string;
  scenarioStatus: string;
  classification: string;
  currentPhase: string;
  overallProgressPct: number;
  createdDate: string | null;
  aiGenerated: boolean;
}

// A single generous page. Foundry paginates, but an exercise catalogue
// larger than this is not a realistic case here, and truncating is
// better than an unbounded fetch loop on a widget's first render.
const PAGE_SIZE = 200;

function toSummary(obj: Record<string, unknown>): ScenarioSummary {
  const str = (key: string): string => {
    const v = obj[key];
    return typeof v === "string" ? v : "";
  };
  return {
    scenarioId: str("scenarioId"),
    scenarioName: str("scenarioName"),
    scenarioType: str("scenarioType"),
    scenarioStatus: str("scenarioStatus"),
    classification: str("classification"),
    currentPhase: str("currentPhase"),
    overallProgressPct: Number(obj["overallProgressPct"] ?? 0),
    createdDate: str("createdDate") || null,
    aiGenerated: obj["aiGenerated"] === true,
  };
}

export interface UseNxgScenarioListResult {
  scenarios: ScenarioSummary[];
  loading: boolean;
  error: string | null;
  /** "unbound" when no object set is bound, "ontology" otherwise. */
  source: DataSource;
  refresh: () => void;
}

export function useNxgScenarioListFromObjectSet(
  objectSet: unknown,
): UseNxgScenarioListResult {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>("unbound");

  const load = useCallback(async () => {
    const fetchable = objectSet as FetchableObjectSet | null;
    if (objectSet == null || typeof fetchable?.fetchPage !== "function") {
      setScenarios([]);
      setSource("unbound");
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const page = await fetchable.fetchPage({ $pageSize: PAGE_SIZE });
      const mapped = page.data
        .map(toSummary)
        .filter((s) => s.scenarioId !== "")
        // Most recently created first, then by name so the order is stable
        // for the scenarios that have no created date.
        .sort(
          (a, b) =>
            (b.createdDate ?? "").localeCompare(a.createdDate ?? "") ||
            a.scenarioName.localeCompare(b.scenarioName),
        );
      setScenarios(mapped);
      setSource("ontology");
    } catch (e) {
      setError(String(e));
      setScenarios([]);
      setSource("ontology");
    } finally {
      setLoading(false);
    }
  }, [objectSet]);

  useEffect(() => {
    void load();
  }, [load]);

  return { scenarios, loading, error, source, refresh: load };
}
