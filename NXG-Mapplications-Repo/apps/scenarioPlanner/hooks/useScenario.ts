// src/apps/scenarioPlanner/hooks/useScenario.ts
//
// Resolves the active NxgScenario from the Workshop "scenario" input, and
// loads everything hanging off it: phases, exercise name, current phase,
// participating nations and the D-Day label.
//
// Workshop passes the scenario either as a temporary object-set RID (how the
// field is declared in scenarioConfig.ts) or as ObjectSetLocators (a list of
// primary keys). useWorkshopObjectKey resolves both to the primary key of the
// single scenario selected; we fetch that NxgScenario from the ontology and
// return the relevant exercise metadata fields so App.tsx can build an
// ExerciseMeta without duplicating fetch logic.
//
// If no single scenario is selected the DEFAULT_SCENARIO_ID is used; if the
// fetch fails the hook returns `null` and the caller falls back to
// DEFAULT_EXERCISE.

import { useState, useEffect, useCallback } from "react";
import { client } from "../../../client";
import {
  useWorkshopObjectKey,
  type WorkshopObjectSetValue,
} from "../../../shared/hooks/useWorkshopObjectKey";
import { NxgScenario, NxgPhase } from "@nxg-simulation-execution-testing/sdk";
import type { Phase } from "../shared/types";
import { DEFAULT_SCENARIO_ID } from "../shared/phaseColours";
import { parsePhaseOffset } from "../shared/timeScale";

// ── Output shape ──────────────────────────────────────────────────────────────

export interface ScenarioMeta {
  scenarioId: string;
  scenarioName: string;
  currentPhase: string;
  /**
   * Participating nations, from NxgScenario.nations (pipe-delimited ISO codes).
   *
   * Used to be a Workshop string input because the scenario did not carry it,
   * which meant two modules showing the same exercise could disagree about who
   * was in it. Empty when the SDK predates the property.
   */
  nations: string[];
  /** Exercise clock label, e.g. "D+1" or "H+0", from NxgScenario.dDayOffset. */
  dDayOffset: string;
}

export interface UseScenarioResult {
  /** Resolved scenario metadata, or null when not available / still loading. */
  scenarioMeta: ScenarioMeta | null;
  /**
   * Phases loaded from the ontology for this scenario, mapped to the widget's
   * local Phase shape.  Null when scenario not loaded yet.
   */
  ontologyPhases: Phase[] | null;
  loading: boolean;
  error: string | null;
  /**
   * Re-fetch the scenario and its phases. Called after a phase mutation so the
   * widget converges on server state instead of trusting its optimistic copy.
   */
  reload: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Split NxgScenario.nations ("POL|LTU|GBR") into ISO codes.
 *
 * Read off the object dynamically because the generated SDK only gains the
 * property once the ontology change is merged and the SDK regenerated; until
 * then this returns [] and the caller falls back to its defaults.
 */
function parseNations(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split("|")
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * Map NxgPhase status string → the widget's PhaseStatus union.
 * Any unknown value falls back to "DRAFT".
 */
function mapPhaseStatus(raw: string | null | undefined): Phase["status"] {
  if (!raw) return "DRAFT";
  const upper = raw.toUpperCase();
  if (upper === "APPROVED") return "APPROVED";
  if (upper === "REVIEW") return "REVIEW";
  return "DRAFT";
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useScenario(
  /**
   * The raw Workshop field value for the `scenario` input — a temporary
   * object-set RID or ObjectSetLocators. May be undefined while loading.
   */
  scenarioInput: WorkshopObjectSetValue,
): UseScenarioResult {
  const [scenarioMeta, setScenarioMeta] = useState<ScenarioMeta | null>(null);
  const [ontologyPhases, setOntologyPhases] = useState<Phase[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // Derived key used to drive the effect — only re-fetch when the resolved
  // primary key actually changes (avoids thrashing on every render).
  const { primaryKey: selectedId, resolving } = useWorkshopObjectKey(scenarioInput, NxgScenario);

  // Default to DEFAULT_SCENARIO_ID when no single scenario is wired from
  // Workshop. This scenario has tiled pathfinding data available.
  // DEFAULT_EXERCISE in phaseColours.ts describes the same exercise so the
  // fallback labels match the fallback data.
  //
  // While a Workshop RID is still being resolved we hold off entirely (null)
  // rather than loading the default and then swapping scenarios underneath
  // the planner a moment later.
  const scenarioId = resolving ? null : selectedId ?? DEFAULT_SCENARIO_ID;

  useEffect(() => {
    // No scenario yet — the Workshop RID is still being resolved.
    if (!scenarioId) {
      setScenarioMeta(null);
      setOntologyPhases(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // ── 1. Fetch the NxgScenario object ───────────────────────────────
        const scenario = await client(NxgScenario).fetchOne(scenarioId);

        if (cancelled) return;

        const meta: ScenarioMeta = {
          scenarioId: scenario.scenarioId,
          scenarioName: scenario.scenarioName ?? scenario.scenarioId,
          currentPhase: scenario.currentPhase ?? "",
          nations: parseNations(scenario.nations),
          dDayOffset: scenario.dDayOffset ?? "",
        };

        setScenarioMeta(meta);

        // ── 2. Fetch the NxgPhase objects linked to this scenario ─────────
        // Traversed through the `phases` link rather than filtered on the
        // scenarioId property: the link is the ontology's statement of what
        // belongs to this scenario, and it keeps working if the property is
        // ever unset on a phase. Falls back to the property filter if the
        // traversal comes back empty, the same defensive pattern used for
        // operation hierarchies in shared/lib/foundry.ts.
        let phasePage = await client(NxgScenario)
          .where({ $primaryKey: scenarioId })
          .pivotTo("phases")
          .fetchPage({ $pageSize: 100 });

        if (cancelled) return;

        if (phasePage.data.length === 0) {
          console.warn(
            `[useScenario] No phases via the scenario link for ${scenarioId}; falling back to the scenarioId property.`,
          );
          phasePage = await client(NxgPhase)
            .where({ scenarioId })
            .fetchPage({ $pageSize: 100 });
        }

        if (cancelled) return;

        // Sort by sequenceNumber so phases appear in the correct order.
        // Objects whose sequenceNumber is null/undefined sort last.
        const sorted = [...phasePage.data].sort((a, b) => {
          const seqA = typeof a.sequenceNumber === "number" ? a.sequenceNumber : Number(a.sequenceNumber ?? 99999);
          const seqB = typeof b.sequenceNumber === "number" ? b.sequenceNumber : Number(b.sequenceNumber ?? 99999);
          return seqA - seqB;
        });

        const phases: Phase[] = sorted.map((p) => {
          const start = parsePhaseOffset(p.startOffset);
          const end = parsePhaseOffset(p.endOffset);
          if (p.startOffset && !start) {
            console.warn(
              `[useScenario] Unrecognised offset "${p.startOffset}" on phase ${p.phaseId} — treated as 0.`,
            );
          }
          // Both ends should use the same scale; trust whichever parsed.
          const offsetUnit = start?.unit ?? end?.unit ?? "day";
          return ({
          id: p.phaseId,
          name: p.phaseName ?? p.phaseId,
          status: mapPhaseStatus(p.phaseStatus),
          objective: p.objectiveStatement ?? "",
          startOffset: start?.value ?? 0,
          endOffset: end?.value ?? start?.value ?? 0,
          offsetUnit,
          unitIds: [],
          passCriteria: [],
          failCriteria: [],
          tasks: [],
          dependencies: [],
          basedOnPhaseId: p.basedOnPhaseId ?? undefined,
          });
        });

        setOntologyPhases(phases);
      } catch (err) {
        if (cancelled) return;
        console.warn("[useScenario] Failed to load scenario from ontology:", err);
        setScenarioMeta(null);
        setOntologyPhases(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scenarioId, version]);

  return { scenarioMeta, ontologyPhases, loading, error, reload };
}
