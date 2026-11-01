// src/shared/orbat/usePhasePreflight.ts
//
// The Translator's preflight for one phase ORBAT (nxgPreflightOrbatFromPhase):
// will every unit actually spawn? This is the check Execute gates the launch
// on, run against the same ontology export Execute sends — so a force that is
// green here is green there.
import { useCallback, useEffect, useRef, useState } from "react";
import { executeQuery } from "@/shared/lib/platformFunctions";
import { type PreflightReport, parsePreflight } from "./preflight";

export const PREFLIGHT_FUNCTION = ["nxgPreflightOrbatFromPhase", "preflightOrbatFromPhase"];

export type PreflightStatus = "idle" | "running" | "done" | "error";

export interface PhasePreflight {
  status: PreflightStatus;
  report: PreflightReport | null;
  error: string | null;
  /** Run it again — after an edit has been saved. */
  recheck: () => void;
}

export function usePhasePreflight(
  operationKey: string | null,
  phaseId: string | null,
  /** False to skip (e.g. demo mode, or nothing saved yet). */
  enabled = true,
): PhasePreflight {
  const [status, setStatus] = useState<PreflightStatus>("idle");
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled || !operationKey || !phaseId) {
      setStatus("idle");
      setReport(null);
      setError(null);
      return;
    }
    const mine = ++seq.current;
    setStatus("running");
    setError(null);
    executeQuery(PREFLIGHT_FUNCTION, { operation_key: operationKey, phase_key: phaseId })
      .then((raw) => {
        if (mine !== seq.current) return;
        const parsed = parsePreflight(raw);
        if (!parsed) throw new Error("Preflight returned a report that could not be read.");
        setReport(parsed);
        setStatus("done");
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        setReport(null);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, [operationKey, phaseId, enabled, tick]);

  const recheck = useCallback(() => setTick((t) => t + 1), []);
  return { status, report, error, recheck };
}
