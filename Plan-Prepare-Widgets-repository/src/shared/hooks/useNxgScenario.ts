// ============================================================
// useNxgScenario
//
// Loads a single NxgScenario from the ontology by scenarioId.
// Returns strategic context title/body and ai-generated flag.
// Falls back to MOCK_SCENARIO when no scenarioId is provided
// or the ontology fetch fails, so the dashboard is always demo-ready.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { NxgScenario } from "@custom-widget/sdk";
import type { Osdk } from "@osdk/client";
import { client } from "../../client.js";
import { MOCK_SCENARIO } from "../data/mockScenarioDashboard.js";
import type { DataSource } from "./dataSource.js";

export interface ScenarioContext {
  scenarioId: string;
  scenarioName: string;
  scenarioType: string;
  classification: string;
  scenarioStatus: string;
  overallProgressPct: number;
  currentPhase: string;
  strategicContextTitle: string;
  strategicContextBody: string;
  aiGenerated: boolean;
  /**
   * Calendar date that D+0 corresponds to, as an ISO date string.
   * Used to resolve D-Day relative offsets on phases, tasks and
   * injects into real dates. Null when not yet set on the scenario.
   */
  dDay: string | null;
}

function osdkToContext(obj: Osdk.Instance<NxgScenario>): ScenarioContext {
  return {
    scenarioId: obj.scenarioId,
    scenarioName: obj.scenarioName ?? "",
    scenarioType: obj.scenarioType ?? "",
    classification: obj.classification ?? "",
    scenarioStatus: obj.scenarioStatus ?? "",
    overallProgressPct: Number(obj.overallProgressPct ?? 0),
    currentPhase: obj.currentPhase ?? "",
    strategicContextTitle: obj.strategicContextTitle ?? "",
    strategicContextBody: obj.strategicContextBody ?? "",
    aiGenerated: obj.aiGenerated ?? false,
    dDay: obj.dDay ?? null,
  };
}

export interface UseNxgScenarioResult {
  scenario: ScenarioContext | null;
  loading: boolean;
  error: string | null;
  /** Whether `scenario` came from the ontology or from local seed data. */
  source: DataSource;
  refresh: () => void;
}

export function useNxgScenario(
  scenarioId: string | null | undefined
): UseNxgScenarioResult {
  // Starts null: the seed scenario is only shown once a real fetch has
  // failed, so mock data cannot flash before the first load.
  const [scenario, setScenario] = useState<ScenarioContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>("unbound");

  const load = useCallback(async () => {
    // No scenario bound — show nothing rather than quietly loading a
    // default exercise. The widget renders an explicit empty state.
    if (scenarioId == null) {
      setScenario(null);
      setSource("unbound");
      setLoading(false);
      setError(null);
      return;
    }
    const resolvedId = scenarioId;

    setLoading(true);
    setError(null);
    try {
      const obj = await client(NxgScenario).fetchOne(resolvedId);
      setScenario(osdkToContext(obj));
      setSource("ontology");
    } catch (e) {
      setError(String(e));
      // Graceful fallback — dashboard stays fully populated
      setScenario(MOCK_SCENARIO);
      setSource("seed");
    } finally {
      setLoading(false);
    }
  }, [scenarioId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { scenario, loading, error, source, refresh: load };
}
