/**
 * useOrbatValidation — calls cseValidateOrbat (VBS4) against the current ORBAT
 * data and merges the results into the existing local ValidationIssue list.
 *
 * Returns:
 *   - cseErrors: raw errors from the Foundry function
 *   - cseValid:  true when no blocking (non-warning) errors are returned
 *   - cseStatus: "idle" | "running" | "done" | "error"
 *   - runValidation: validate using live ontology objects (units/edges/symbols)
 *   - runValidationFromJson: validate using a raw JSON string (e.g. from Workshop)
 *   - reset: clear all state
 */

import { useState, useCallback } from "react";
import type { OUnit, OEdge, OSymbol } from "@/shared/types";
import { callCseValidateOrbat, type CseValidationError } from "@/shared/lib/foundry";
import { client } from "@/client";
import { cseValidateOrbat } from "@nxg-simulation-execution-testing/sdk";

export type CseValidationStatus = "idle" | "running" | "done" | "error";

export interface UseOrbatValidationResult {
  cseErrors: CseValidationError[];
  cseValid: boolean;
  cseStatus: CseValidationStatus;
  cseErrorMessage: string | null;
  runValidation: (
    projectName: string,
    units: Map<string, OUnit>,
    edges: OEdge[],
    symbols: Map<string, OSymbol>,
  ) => Promise<void>;
  runValidationFromJson: (
    projectName: string,
    orbatJson: string,
  ) => Promise<void>;
  reset: () => void;
}

export function useOrbatValidation(): UseOrbatValidationResult {
  const [cseErrors, setCseErrors] = useState<CseValidationError[]>([]);
  const [cseValid, setCseValid] = useState(false);
  const [cseStatus, setCseStatus] = useState<CseValidationStatus>("idle");
  const [cseErrorMessage, setCseErrorMessage] = useState<string | null>(null);

  const runValidation = useCallback(
    async (
      projectName: string,
      units: Map<string, OUnit>,
      edges: OEdge[],
      symbols: Map<string, OSymbol>,
    ) => {
      setCseStatus("running");
      setCseErrors([]);
      setCseErrorMessage(null);
      try {
        const result = await callCseValidateOrbat(projectName, units, edges, symbols);
        setCseErrors(result.errors);
        setCseValid(result.valid);
        setCseStatus("done");
      } catch (err) {
        setCseStatus("error");
        setCseErrorMessage(err instanceof Error ? err.message : String(err));
        setCseValid(false);
      }
    },
    [],
  );

  /**
   * Validate a raw orbatContent JSON string directly — used when an external
   * ORBAT is passed in from a Workshop variable rather than built from the
   * live ontology objects.
   */
  const runValidationFromJson = useCallback(
    async (projectName: string, orbatJson: string) => {
      setCseStatus("running");
      setCseErrors([]);
      setCseErrorMessage(null);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = await (client(cseValidateOrbat as any) as any).executeFunction({
          projectName,
          orbatContent: orbatJson,
        });
        const result = typeof raw === "string" ? JSON.parse(raw) : raw;
        const errors: CseValidationError[] = result?.errors ?? [];
        setCseErrors(errors);
        setCseValid(errors.filter((e) => !e.isWarning).length === 0);
        setCseStatus("done");
      } catch (err) {
        setCseStatus("error");
        setCseErrorMessage(err instanceof Error ? err.message : String(err));
        setCseValid(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setCseErrors([]);
    setCseValid(false);
    setCseStatus("idle");
    setCseErrorMessage(null);
  }, []);

  return { cseErrors, cseValid, cseStatus, cseErrorMessage, runValidation, runValidationFromJson, reset };
}
