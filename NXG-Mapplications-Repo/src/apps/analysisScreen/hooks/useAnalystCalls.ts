// analysisScreen/hooks/useAnalystCalls.ts
//
// The analyst's ratings and notes on training objectives, per run and phase.
//
// Kept in the browser's localStorage: there is no ontology object for an
// assessment yet, and the debrief must not depend on one to be usable. An
// analyst's calls survive a reload on the same machine; to share them, copy
// the summary (TrainingObjectivesSection → "Copy summary").
import { useCallback, useEffect, useState } from "react";
import type { AnalystCall } from "../lib/objectiveAssessment";

const PREFIX = "nxg.analysis.objectiveCalls.";

function read(key: string): Record<string, AnalystCall> {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, AnalystCall>) : {};
  } catch {
    return {};
  }
}

export function useAnalystCalls(key: string | null): {
  calls: Record<string, AnalystCall>;
  setCall: (objectiveId: string, call: AnalystCall) => void;
} {
  const [calls, setCalls] = useState<Record<string, AnalystCall>>(() => (key ? read(key) : {}));
  useEffect(() => setCalls(key ? read(key) : {}), [key]);

  const setCall = useCallback(
    (objectiveId: string, call: AnalystCall) => {
      setCalls((prev) => {
        const next = { ...prev, [objectiveId]: call };
        if (!call.rating && !call.note) delete next[objectiveId];
        if (key) {
          try {
            window.localStorage.setItem(PREFIX + key, JSON.stringify(next));
          } catch {
            /* storage unavailable — calls last for this session only */
          }
        }
        return next;
      });
    },
    [key],
  );

  return { calls, setCall };
}
