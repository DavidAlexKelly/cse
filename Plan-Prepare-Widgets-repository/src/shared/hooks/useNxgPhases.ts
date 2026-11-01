// ============================================================
// useNxgPhases
//
// Loads NxgPhase objects from the ontology, filtered by
// scenarioId, sorted by sequenceNumber.
// Polls every 15 seconds so newly created phases appear
// automatically in all widgets (scenario dashboard, task manager).
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { NxgPhase } from "@custom-widget/sdk";
import type { Osdk } from "@osdk/client";
import { client } from "../../client.js";

const POLL_INTERVAL_MS = 15_000;

export interface PhaseRecord {
  phaseId: string;
  phaseName: string;
  /** Human-readable label, always "Phase N" (1-based) — use this everywhere in the UI */
  displayLabel: string;
  phaseDescription: string;
  objectiveStatement: string;
  startOffset: string;
  endOffset: string;
  phaseStatus: string;
  sequenceNumber: number;
  scenarioId: string;
  /** Planning-readiness score 0–100. Always 0 when loaded from the ontology (no mock data). */
  readinessPct?: number;
}

/** Returns a consistent 1-based display label, e.g. "Phase 1", "Phase 2" */
export function phaseDisplayLabel(sequenceNumber: number): string {
  return `Phase ${sequenceNumber}`;
}

function osdkToRecord(obj: Osdk.Instance<NxgPhase>): PhaseRecord {
  const seq = Number(obj.sequenceNumber ?? 0);
  return {
    phaseId: obj.phaseId,
    phaseName: phaseDisplayLabel(seq),
    displayLabel: phaseDisplayLabel(seq),
    phaseDescription: obj.phaseDescription ?? "",
    objectiveStatement: obj.objectiveStatement ?? "",
    startOffset: obj.startOffset ?? "",
    endOffset: obj.endOffset ?? "",
    phaseStatus: obj.phaseStatus ?? "planning",
    sequenceNumber: seq,
    scenarioId: obj.scenarioId ?? "",
    readinessPct: 0,
  };
}

export interface UseNxgPhasesResult {
  phases: PhaseRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useNxgPhases(
  scenarioId: string | null | undefined
): UseNxgPhasesResult {
  const [phases, setPhases] = useState<PhaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // No scenario bound — show nothing rather than quietly loading a
    // default exercise. The widget renders an explicit empty state.
    if (scenarioId == null) {
      setPhases([]);
      setLoading(false);
      setError(null);
      return;
    }
    const resolvedId = scenarioId;
    setLoading(true);
    setError(null);
    try {
      const results: PhaseRecord[] = [];
      for await (const obj of client(NxgPhase)
        .where({ scenarioId: { $eq: resolvedId } })
        .asyncIter()) {
        results.push(osdkToRecord(obj));
      }
      results.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      setPhases(results);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [scenarioId]);

  // Initial load + poll every 15 s so new phases appear automatically
  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  return { phases, loading, error, refresh: load };
}
