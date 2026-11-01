// analysisScreen/hooks/useMatchOverrides.ts
//
// A phase's match corrections, kept in this browser per phase. They name
// simulator callsigns, not run-specific handles, so corrections made in
// rehearsal apply to every later run of the phase on this machine.
import { useCallback, useEffect, useState } from "react";
import { type MatchOverrides, withOverride } from "../lib/matchOverrides";

const PREFIX = "nxg.analysis.matchOverrides.";

function read(phaseId: string | null): MatchOverrides {
  if (!phaseId) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREFIX + phaseId) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as MatchOverrides) : {};
  } catch {
    return {};
  }
}

export function useMatchOverrides(phaseId: string | null): {
  overrides: MatchOverrides;
  setOverride: (plannedId: string, value: string | undefined) => void;
  clearAll: () => void;
} {
  const [overrides, setOverrides] = useState<MatchOverrides>(() => read(phaseId));
  useEffect(() => setOverrides(read(phaseId)), [phaseId]);

  const save = useCallback(
    (next: MatchOverrides) => {
      setOverrides(next);
      if (!phaseId) return;
      try {
        window.localStorage.setItem(PREFIX + phaseId, JSON.stringify(next));
      } catch {
        /* storage unavailable — corrections last for this session */
      }
    },
    [phaseId],
  );

  const setOverride = useCallback(
    (plannedId: string, value: string | undefined) =>
      save(withOverride(overrides, plannedId, value)),
    [overrides, save],
  );
  const clearAll = useCallback(() => save({}), [save]);
  return { overrides, setOverride, clearAll };
}
