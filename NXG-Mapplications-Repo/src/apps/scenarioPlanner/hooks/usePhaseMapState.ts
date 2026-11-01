// src/apps/scenarioPlanner/hooks/usePhaseMapState.ts
//
// Loads and persists NxgPhaseMapState objects from the Ontology.
//
// Each NxgPhaseMapState row carries:
//   mapStateId       (PK)
//   phaseId          (FK → NxgPhase)
//   startStateMapJson  JSON string → MapPhaseState (units / arrows / objectives)
//   endStateMapJson    JSON string → MapPhaseState (units / arrows / objectives)
//
// On mount the hook fetches all NxgPhaseMapState objects whose phaseId is in
// the supplied `phaseIds` list and parses their JSON into plain MapPhaseState
// values.  On save it calls the upsert action from the SDK.
//
// If no persisted state exists for a phase the hook falls back to the
// hardcoded SCENARIO_BY_PHASE data from scenarioData.ts so the app still
// works in dev / when data hasn't been seeded yet.
//
// ── Two stores, on purpose (for now) ─────────────────────────────────────────
// There are TWO places a phase's map picture gets written, and App.tsx drives
// both:
//
//   1. THIS hook → NxgPhaseMapState. The planner's own start/end state, read
//      back by the Scenario Planner on load.
//   2. phaseCreator/phaseMapStateService.syncPhaseMapState → tagged
//      [NXG-O] Template Orbat Graph records. The ORBAT feed consumed by the
//      ORBAT Manager's phase auto-ingest.
//
// They overlap in content but have different consumers, so neither is dead
// code and deleting either one breaks a different app. Note that a comment in
// the ORBAT Manager's data layer claims "the old NxgPhaseMapState object type
// has been removed" — that is NOT true; the object type is live and is what
// this hook reads and writes. Consolidating the two is a real design decision
// and needs an owner, not a drive-by cleanup.

import { useState, useEffect, useCallback, useRef } from "react";
import { client } from "../../../client";
import {
  NxgPhaseMapState,
  createNxgPPhaseMapState,
  updateNxgPPhaseMapState,
} from "@nxg-simulation-execution-testing/sdk";
import type { MapPhaseState } from "../phaseCreator/types";
import { SCENARIO_BY_PHASE } from "../shared/scenarioData";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Per-phase map data as held by this hook. */
export interface PhaseMapData {
  /** PK of the NxgPhaseMapState row (undefined if not yet persisted). */
  mapStateId?: string;
  startState: MapPhaseState;
  /** null until the phase has been resolved / end state generated. */
  endState: MapPhaseState | null;
  /**
   * Where startState came from:
   *   "ontology" — a real NxgPhaseMapState row (a planner's data — never
   *                silently modified).
   *   "fallback" — the hardcoded demo lay-down in shared/scenarioData.ts,
   *                which the app may sanity-correct (e.g. snapping units off
   *                water) before showing it.
   */
  source: "ontology" | "fallback";
}

export interface UsePhaseMapStateResult {
  /** Per-phase map data keyed by phaseId. */
  phaseMapData: Record<string, PhaseMapData>;
  loading: boolean;
  error: string | null;
  /**
   * Persist the start state for a given phase back to the Ontology.
   * Creates a new NxgPhaseMapState row if one doesn't exist yet.
   */
  saveStartState: (phaseId: string, state: MapPhaseState) => Promise<void>;
  /**
   * Persist the end state for a given phase back to the Ontology.
   */
  saveEndState: (phaseId: string, state: MapPhaseState) => Promise<void>;
  /** Re-fetch all phase map states (e.g. after external mutation). */
  reload: () => void;
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

function parseMapStateJson(raw: string | null | undefined): MapPhaseState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Array.isArray(parsed.units) &&
      Array.isArray(parsed.arrows) &&
      Array.isArray(parsed.objectives)
    ) {
      return parsed as MapPhaseState;
    }
    return null;
  } catch {
    return null;
  }
}

/** How much a saved map state actually holds — used to pick between duplicate rows. */
function mapStateContentSize(state: MapPhaseState | null): number {
  if (!state) return -1;
  return state.units.length + state.arrows.length + state.objectives.length;
}

/**
 * Build the hardcoded fallback MapPhaseState for a phase from scenarioData.ts.
 * Returns an empty state if the phase isn't in the hardcoded data.
 */
function fallbackStartState(phaseId: string): MapPhaseState {
  const scenario = SCENARIO_BY_PHASE[phaseId];
  if (!scenario) return { units: [], arrows: [], objectives: [] };

  const startState = scenario.startState;
  return {
    units: startState.units.map((u) => ({
      id: u.id,
      templateId: u.templateId,
      label: u.label,
      sidc: u.sidc,
      lat: u.lat,
      lng: u.lng,
      force: u.sidc[1] === "H" ? ("red" as const) : ("blue" as const),
    })),
    arrows: startState.arrows.map((a) => ({
      id: a.id,
      fromLat: a.fromLat,
      fromLng: a.fromLng,
      toLat: a.toLat,
      toLng: a.toLng,
      colour: a.colour,
      lineStyle: a.lineStyle,
      endpointStyle: a.endpointStyle,
      tacticSidc: a.tacticSidc,
      tacticLabel: a.tacticLabel,
      milxScale: a.milxScale,
      assignedUnitId: a.assignedUnitId,
      targetObjectiveId: a.targetObjectiveId,
    })),
    objectives: startState.objectives.map((o) => ({
      id: o.id,
      lat: o.lat,
      lng: o.lng,
      name: o.name,
      colour: o.colour,
    })),
  };
}

// ─── Primary-key resolution ───────────────────────────────────────────────────

/**
 * Resolve the real primary key of the NxgPhaseMapState row for a phase.
 *
 * The `createNxgPPhaseMapState` action does NOT accept a mapStateId — the PK
 * is generated by the ontology. Previously this hook invented a local
 * `map-state-{phaseId}-{Date.now()}` string and stored it as `mapStateId`,
 * which meant every subsequent save tried to UPDATE a primary key that does
 * not exist (silently failing, or creating duplicate rows).
 *
 * We now read the PK back:
 *   1. From the action's returned edits (`$returnEdits: true`), when available.
 *   2. Otherwise by re-querying NxgPhaseMapState by phaseId.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pkFromEdits(result: any): string | undefined {
  const added = result?.edits?.addedObjects ?? result?.addedObjects;
  if (Array.isArray(added) && added.length > 0) {
    const pk = added[0]?.primaryKey;
    if (typeof pk === "string" && pk.length > 0) return pk;
  }
  return undefined;
}

async function fetchMapStateIdForPhase(phaseId: string): Promise<string | undefined> {
  try {
    const page = await client(NxgPhaseMapState)
      .where({ phaseId })
      .fetchPage({ $pageSize: 1 });
    return page.data[0]?.mapStateId ?? undefined;
  } catch (err) {
    console.warn("[usePhaseMapState] Could not read back mapStateId for phase", phaseId, err);
    return undefined;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePhaseMapState(phaseIds: string[]): UsePhaseMapStateResult {
  const [phaseMapData, setPhaseMapData] = useState<Record<string, PhaseMapData>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // Stable ref so save callbacks always see the current data without
  // needing to be added to their dependency arrays.
  const phaseMapDataRef = useRef(phaseMapData);
  useEffect(() => {
    phaseMapDataRef.current = phaseMapData;
  }, [phaseMapData]);

  // Stable ref for phaseIds so the effect dependency is the serialised list
  // rather than the array reference (avoids infinite loops).
  const phaseIdsKey = phaseIds.join(",");

  useEffect(() => {
    if (phaseIds.length === 0) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const result = await client(NxgPhaseMapState)
          .where({ phaseId: { $in: phaseIds } })
          .fetchPage({ $pageSize: 200 });

        if (cancelled) return;

        // Build a lookup keyed by phaseId.
        //
        // A phase can have MORE THAN ONE NxgPhaseMapState row (e.g. phase_01
        // has three, two of them empty — left behind by earlier create calls
        // that couldn't read their primary key back). Previously the last row
        // read simply won, so a phase could load as empty even though a full
        // lay-down was saved. Keep the row with the most content instead.
        const fromOntology = new Map<string, PhaseMapData>();
        const contentOf = new Map<string, number>();
        for (const row of result.data) {
          const pid = row.phaseId;
          if (!pid) continue;
          const startState = parseMapStateJson(row.startStateMapJson);
          const endState = parseMapStateJson(row.endStateMapJson);
          const content = mapStateContentSize(startState);
          const existing = contentOf.get(pid);
          if (existing !== undefined) {
            console.warn(
              `[usePhaseMapState] Phase ${pid} has more than one NxgPhaseMapState row (${row.mapStateId}). Using the one with the most content.`,
            );
            if (content <= existing) continue;
          }
          contentOf.set(pid, content);
          // An ontology row whose start state is empty (or unparseable) is
          // treated as "no data" so the demo lay-down still shows — otherwise
          // a blank row silently hides the phase's ORBAT.
          const hasOntologyUnits = !!startState && startState.units.length > 0;
          fromOntology.set(pid, {
            mapStateId: row.mapStateId ?? undefined,
            startState: hasOntologyUnits ? startState! : fallbackStartState(pid),
            endState: endState ?? null,
            source: hasOntologyUnits ? "ontology" : "fallback",
          });
        }

        // Fill any missing phases with hardcoded fallback data
        const next: Record<string, PhaseMapData> = {};
        for (const pid of phaseIds) {
          next[pid] = fromOntology.get(pid) ?? {
            mapStateId: undefined,
            startState: fallbackStartState(pid),
            endState: null,
            source: "fallback",
          };
        }

        setPhaseMapData(next);
      } catch (err) {
        if (!cancelled) {
          console.warn("[usePhaseMapState] Failed to load from Ontology, falling back to scenarioData:", err);
          // Fall back to hardcoded data for all phases so the app stays usable.
          const fallback: Record<string, PhaseMapData> = {};
          for (const pid of phaseIds) {
            fallback[pid] = {
              mapStateId: undefined,
              startState: fallbackStartState(pid),
              endState: null,
              source: "fallback",
            };
          }
          setPhaseMapData(fallback);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseIdsKey, version]);

  // ── Persist helpers ────────────────────────────────────────────────────────

  const saveStartState = useCallback(
    async (phaseId: string, state: MapPhaseState) => {
      const current = phaseMapDataRef.current[phaseId];
      const startJson = JSON.stringify(state);

      // Optimistic local update
      setPhaseMapData((prev) => ({
        ...prev,
        [phaseId]: {
          ...prev[phaseId],
          startState: state,
        },
      }));

      try {
        if (current?.mapStateId) {
          // Row exists — update it
          await client(updateNxgPPhaseMapState).applyAction({
            nxgPhaseMapState: current.mapStateId,
            startStateMapJson: startJson,
          });
        } else {
          // No row yet — create one. The PK is assigned by the ontology, so we
          // read it back (from the action edits, else by querying) instead of
          // inventing a local id that would never match.
          const result = await client(createNxgPPhaseMapState).applyAction(
            { phaseId, startStateMapJson: startJson },
            { $returnEdits: true },
          );
          const mapStateId =
            pkFromEdits(result) ?? (await fetchMapStateIdForPhase(phaseId));
          if (mapStateId) {
            // Store the real PK so subsequent saves use update instead of create
            setPhaseMapData((prev) => ({
              ...prev,
              [phaseId]: {
                ...prev[phaseId],
                mapStateId,
              },
            }));
          } else {
            console.warn(
              `[usePhaseMapState] Created a map state row for ${phaseId} but could not resolve its primary key — the next save will create another row.`,
            );
          }
        }
      } catch (err) {
        console.error("[usePhaseMapState] Failed to save start state:", err);
        // Don't revert the optimistic update — the user's edits are preserved
        // in memory even if the write fails.
      }
    },
    [],
  );

  const saveEndState = useCallback(
    async (phaseId: string, state: MapPhaseState) => {
      const current = phaseMapDataRef.current[phaseId];
      const endJson = JSON.stringify(state);

      // Optimistic local update
      setPhaseMapData((prev) => ({
        ...prev,
        [phaseId]: {
          ...prev[phaseId],
          endState: state,
        },
      }));

      try {
        if (current?.mapStateId) {
          await client(updateNxgPPhaseMapState).applyAction({
            nxgPhaseMapState: current.mapStateId,
            endStateMapJson: endJson,
          });
        } else {
          // Create row with the current start state if none exists yet
          const existingStart = phaseMapDataRef.current[phaseId]?.startState;
          const result = await client(createNxgPPhaseMapState).applyAction(
            {
              phaseId,
              startStateMapJson: existingStart
                ? JSON.stringify(existingStart)
                : JSON.stringify({ units: [], arrows: [], objectives: [] }),
              endStateMapJson: endJson,
            },
            { $returnEdits: true },
          );
          const mapStateId =
            pkFromEdits(result) ?? (await fetchMapStateIdForPhase(phaseId));
          if (mapStateId) {
            setPhaseMapData((prev) => ({
              ...prev,
              [phaseId]: {
                ...prev[phaseId],
                mapStateId,
              },
            }));
          }
        }
      } catch (err) {
        console.error("[usePhaseMapState] Failed to save end state:", err);
      }
    },
    [],
  );

  return { phaseMapData, loading, error, saveStartState, saveEndState, reload };
}
