// src/apps/scenarioPlanner/hooks/usePhases.ts
//
// Phase state management, backed by [NXG-P] Phase in the ontology.
//
// This hook used to be pure React state. Phases were read from the ontology by
// useScenario, but every mutation (create / fork / rename / delete) only ever
// updated local state and pushed a JSON blob into the Workshop `phasesJson`
// variable. Two things followed from that:
//
//   1. Standalone (no Workshop context) the write was a no-op, so nothing a
//      planner did to a phase survived a reload.
//   2. Even inside Workshop it was dead, because App.tsx prefers ontology
//      phases over the Workshop param when a scenario resolves — and it always
//      resolves, since useScenario falls back to DEFAULT_SCENARIO_ID.
//
// Mutations now go through lib/phaseActions, which calls the real action types.
// The Workshop callbacks are still fired so other widgets stay in sync, but
// they are notifications, not the persistence mechanism.
//
// Supports phase branching: when two phases share the same basedOnPhaseId they
// are alternative COAs from the same decision point. `basedOnPhaseId` is a real
// property on NxgPhase and is written by both the create and modify actions.

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { Phase } from "../shared/types";
import { MOCK_PHASES } from "../shared/scenarioPhases";
import {
  createPhaseInOntology,
  deletePhaseInOntology,
  phaseWriteInput,
  updatePhaseInOntology,
} from "../lib/phaseActions";

interface UsePhasesOptions {
  /** JSON string of Phase[] from Workshop param, or undefined */
  phasesParam?: string;
  /** Pre-selected phase ID from Workshop param */
  selectedPhaseIdParam?: string;
  /**
   * Scenario these phases belong to. Required to persist: NxgPhase.scenarioId
   * is what useScenario filters on, so a phase written without it would be
   * invisible on the next load.
   */
  scenarioId?: string;
  /**
   * Called after a successful ontology write so the caller can refetch the
   * scenario and converge on server state.
   */
  onPersisted?: () => void;
  /** Workshop event callbacks — notifications only, not persistence. */
  onPhaseSelected?: (id: string) => void;
  onPhaseCreated?: (phases: Phase[]) => void;
  onPhaseUpdated?: (phases: Phase[]) => void;
  onPhaseDeleted?: (phases: Phase[]) => void;
}

function parsePhasesParam(raw: string | undefined): Phase[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as Phase[];
    return null;
  } catch {
    return null;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function usePhases(options: UsePhasesOptions = {}) {
  const {
    phasesParam,
    selectedPhaseIdParam,
    scenarioId,
    onPersisted,
    onPhaseSelected,
    onPhaseCreated,
    onPhaseUpdated,
    onPhaseDeleted,
  } = options;

  const parsedFromParam = useMemo(
    () => parsePhasesParam(phasesParam),
    [phasesParam]
  );

  const initialPhases = parsedFromParam ?? MOCK_PHASES;
  const initialSelectedId =
    (selectedPhaseIdParam && selectedPhaseIdParam.trim() !== "")
      ? selectedPhaseIdParam
      : (initialPhases[0]?.id ?? null);

  const [phases, setPhases] = useState<Phase[]>(initialPhases);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(
    initialSelectedId
  );
  /** Surfaced so the UI can tell the user a write failed instead of silently losing it. */
  const [mutationError, setMutationError] = useState<string | null>(null);

  const usingMockPhases = !parsedFromParam;

  // Ids this hook has successfully written to the ontology but has not yet
  // seen come back in `parsedFromParam`. Without this, the sync effect below
  // would drop a freshly-created phase during the window between the write
  // landing and the scenario refetch completing.
  const justWrittenIds = useRef<Set<string>>(new Set());
  // Ids deleted locally, for the mirror-image reason: the stale param would
  // resurrect them until the refetch lands.
  const justDeletedIds = useRef<Set<string>>(new Set());

  const phasesRef = useRef(phases);
  useEffect(() => {
    phasesRef.current = phases;
  }, [phases]);

  // ── Sync phases when the resolved param changes after initial render ────────
  useEffect(() => {
    if (!parsedFromParam || parsedFromParam.length === 0) return;

    setPhases((current) => {
      const incoming = parsedFromParam.filter((p) => !justDeletedIds.current.has(p.id));
      const incomingIds = new Set(incoming.map((p) => p.id));

      // Anything we wrote that the server has now confirmed can stop being
      // held locally.
      for (const id of [...justWrittenIds.current]) {
        if (incomingIds.has(id)) justWrittenIds.current.delete(id);
      }
      for (const id of [...justDeletedIds.current]) {
        if (!incomingIds.has(id)) justDeletedIds.current.delete(id);
      }

      // Carry over any confirmed-written phase the refetch has not caught up
      // with yet, preserving its position.
      const pending = current.filter(
        (p) => justWrittenIds.current.has(p.id) && !incomingIds.has(p.id),
      );
      const next = [...incoming, ...pending];

      const currentIds = current.map((p) => p.id).join(",");
      const nextIds = next.map((p) => p.id).join(",");
      if (currentIds === nextIds) return current;
      return next;
    });

    setSelectedPhaseId((current) => {
      if (current && justWrittenIds.current.has(current)) return current;
      const existsInNew = parsedFromParam.some((p) => p.id === current);
      if (existsInNew) return current;
      return parsedFromParam[0]?.id ?? null;
    });
  }, [parsedFromParam]);

  // ── Derived: branch lookup ────────────────────────────────────────────────
  // Groups phases by their basedOnPhaseId so we can detect fork points.
  // A phase with multiple entries in this map has branching alternatives.
  const branchesBySource = useMemo(() => {
    const map: Record<string, Phase[]> = {};
    for (const p of phases) {
      if (!p.basedOnPhaseId) continue;
      if (!map[p.basedOnPhaseId]) map[p.basedOnPhaseId] = [];
      map[p.basedOnPhaseId].push(p);
    }
    return map;
  }, [phases]);

  // ── Derived: detect which phases have branching alternatives ──────────────
  const getBranchSiblings = useCallback(
    (phaseId: string): Phase[] => {
      const phase = phases.find((p) => p.id === phaseId);
      if (!phase?.basedOnPhaseId) return [];
      const siblings = branchesBySource[phase.basedOnPhaseId] ?? [];
      return siblings.length > 1 ? siblings : [];
    },
    [phases, branchesBySource],
  );

  const selectPhase = useCallback(
    (id: string | null) => {
      setSelectedPhaseId(id);
      if (id) onPhaseSelected?.(id);
    },
    [onPhaseSelected]
  );

  /**
   * Guard shared by every mutation.
   *
   * Persisting while the mock set is on screen would write demo phases into a
   * real scenario, and any fork of one would carry a basedOnPhaseId pointing at
   * a phase that does not exist. Better to refuse and say so.
   */
  const persistBlockedReason = useCallback((): string | null => {
    if (!scenarioId) {
      return "No scenario is selected, so this change cannot be saved.";
    }
    if (usingMockPhases) {
      return (
        "These are demo phases that are not in the ontology, so changes cannot be saved. " +
        "Wire a scenario with phases to edit them."
      );
    }
    return null;
  }, [scenarioId, usingMockPhases]);

  const nextSequenceNumber = useCallback((): number => {
    return phasesRef.current.length + 1;
  }, []);

  // ── Create ────────────────────────────────────────────────────────────────
  /**
   * Persist a new phase and add it to local state.
   *
   * Returns the phase as stored, whose `id` is the ontology-assigned phaseId —
   * NOT the id on the draft passed in. Callers must use the returned id for
   * anything keyed on the phase (map state, selection), otherwise they will
   * write map state against an id that no phase has.
   */
  const createPhase = useCallback(
    async (draft: Phase): Promise<Phase> => {
      const blocked = persistBlockedReason();
      if (blocked) {
        setMutationError(blocked);
        throw new Error(blocked);
      }

      try {
        const phaseId = await createPhaseInOntology(
          phaseWriteInput(draft, scenarioId!, nextSequenceNumber()),
        );
        const stored: Phase = { ...draft, id: phaseId };
        justWrittenIds.current.add(phaseId);
        setMutationError(null);
        setPhases((prev) => {
          const next = [...prev, stored];
          onPhaseCreated?.(next);
          return next;
        });
        onPersisted?.();
        return stored;
      } catch (err) {
        const message = `Could not create phase "${draft.name}": ${describeError(err)}`;
        console.error("[usePhases]", message, err);
        setMutationError(message);
        throw err;
      }
    },
    [persistBlockedReason, scenarioId, nextSequenceNumber, onPhaseCreated, onPersisted],
  );

  // ── Fork — create a branch alternative from a source phase ────────────────
  const forkPhase = useCallback(
    async (
      sourcePhaseId: string,
      partial: Pick<Phase, "name" | "objective" | "startOffset" | "endOffset" | "status">,
    ): Promise<Phase> => {
      const source = phasesRef.current.find((p) => p.id === sourcePhaseId);
      const draft: Phase = {
        // Placeholder only — createPhase replaces it with the ontology PK.
        id: "pending",
        name: partial.name,
        status: partial.status,
        objective: partial.objective,
        startOffset: partial.startOffset,
        endOffset: partial.endOffset,
        // Branches inherit the scenario's offset scale (D+n vs H+n).
        offsetUnit: source?.offsetUnit,
        unitIds: [],
        passCriteria: [],
        failCriteria: [],
        tasks: [],
        dependencies: [],
        // The fork inherits the SAME basedOnPhaseId as the source — so it
        // becomes a sibling branch, not a child.
        basedOnPhaseId: source?.basedOnPhaseId ?? sourcePhaseId,
      };
      return createPhase(draft);
    },
    [createPhase],
  );

  // ── Update ────────────────────────────────────────────────────────────────
  // Optimistic: local state updates immediately and the write happens in the
  // background, because renaming a phase should not block the UI. A failure
  // surfaces through mutationError rather than reverting, so the planner's
  // text is not thrown away.
  const updatePhase = useCallback(
    (updated: Phase) => {
      setPhases((prev) => {
        const next = prev.map((p) => (p.id === updated.id ? updated : p));
        onPhaseUpdated?.(next);
        return next;
      });

      const blocked = persistBlockedReason();
      if (blocked) {
        setMutationError(blocked);
        return;
      }

      const index = phasesRef.current.findIndex((p) => p.id === updated.id);
      void updatePhaseInOntology(
        updated.id,
        phaseWriteInput(updated, scenarioId!, index >= 0 ? index + 1 : nextSequenceNumber()),
      )
        .then(() => {
          setMutationError(null);
          onPersisted?.();
        })
        .catch((err) => {
          const message = `Could not save phase "${updated.name}": ${describeError(err)}`;
          console.error("[usePhases]", message, err);
          setMutationError(message);
        });
    },
    [persistBlockedReason, scenarioId, nextSequenceNumber, onPhaseUpdated, onPersisted],
  );

  // ── Delete ────────────────────────────────────────────────────────────────
  const deletePhase = useCallback(
    (phaseId: string) => {
      setPhases((prev) => {
        if (!prev.some((p) => p.id === phaseId)) return prev;
        // Remove the phase, then strip the id from every other phase's
        // dependency list. Also clear basedOnPhaseId references.
        const next = prev
          .filter((p) => p.id !== phaseId)
          .map((p) => {
            let updated = p;
            if (p.dependencies.includes(phaseId)) {
              updated = { ...updated, dependencies: updated.dependencies.filter((d) => d !== phaseId) };
            }
            if (p.basedOnPhaseId === phaseId) {
              updated = { ...updated, basedOnPhaseId: undefined };
            }
            return updated;
          });
        onPhaseDeleted?.(next);
        return next;
      });
      setSelectedPhaseId((current) => (current === phaseId ? null : current));

      const blocked = persistBlockedReason();
      if (blocked) {
        setMutationError(blocked);
        return;
      }

      justDeletedIds.current.add(phaseId);
      justWrittenIds.current.delete(phaseId);

      void deletePhaseInOntology(phaseId)
        .then(() => {
          setMutationError(null);
          onPersisted?.();
        })
        .catch((err) => {
          const message = `Could not delete phase: ${describeError(err)}`;
          console.error("[usePhases]", message, err);
          setMutationError(message);
          // Let the next refetch put it back rather than leaving the UI
          // claiming a deletion that did not happen.
          justDeletedIds.current.delete(phaseId);
        });
    },
    [persistBlockedReason, onPhaseDeleted, onPersisted],
  );

  const selectedPhase = useMemo(
    () => phases.find((p) => p.id === selectedPhaseId) ?? null,
    [phases, selectedPhaseId]
  );

  return {
    /**
     * True when neither Workshop nor the ontology supplied phases, so the
     * IRON FORGE 26 mock set is in use. Callers use this to label the UI with
     * the mock exercise metadata rather than the live exercise defaults.
     * Mutations are refused in this state — see persistBlockedReason.
     */
    usingMockPhases,
    /** Full flat array of all phases. */
    phases,
    /** Phases grouped by basedOnPhaseId — use to detect fork points. */
    branchesBySource,
    /** Get sibling branches for a phase (phases sharing same basedOnPhaseId). */
    getBranchSiblings,
    selectedPhaseId,
    selectedPhase,
    selectPhase,
    /** Persists, then returns the phase with its ontology-assigned id. */
    createPhase,
    /** Create a branch alternative from an existing phase. Persists. */
    forkPhase,
    updatePhase,
    deletePhase,
    /** Non-null when the last mutation failed to persist. */
    mutationError,
    clearMutationError: useCallback(() => setMutationError(null), []),
  };
}
