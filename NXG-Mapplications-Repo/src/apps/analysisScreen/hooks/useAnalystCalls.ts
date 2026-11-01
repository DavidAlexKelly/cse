// analysisScreen/hooks/useAnalystCalls.ts
//
// The analyst's ratings and notes on training objectives, per run and phase —
// saved to the ontology as NxgObjectiveAssessment objects, so a debrief is
// shared rather than stuck in one browser.
//
// Every call is ALSO kept in this browser's localStorage, which is what makes
// the screen usable before the object type exists, offline, or in mock mode:
//
//   storage "foundry"  the type exists and is reachable — the ontology is the
//                      record; reads come from it, writes go to it
//   storage "device"   it does not (yet), or Foundry refused — calls are kept
//                      on this device, and the screen says so
//
// Writes are debounced per objective (typing a note is not a write per key)
// and use create / modify / delete with a deterministic key, so repeated
// saves converge on one object.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  OntologyResourceMissing,
  applyActionByName,
  searchObjectsByName,
} from "@/shared/lib/platformObjects";
import {
  ASSESSMENT_ACTIONS,
  ASSESSMENT_OBJECT_PARAM,
  ASSESSMENT_OBJECT_TYPE,
  type AssessmentContext,
  assessmentId,
  assessmentProperties,
  callsFromObjects,
} from "../lib/assessmentRecord";
import type { AnalystCall, ObjectiveRating } from "../lib/objectiveAssessment";

const PREFIX = "nxg.analysis.objectiveCalls.";
const WRITE_DELAY_MS = 800;

export type CallStorage = "loading" | "foundry" | "device";

function localKey(ctx: AssessmentContext): string {
  return `${PREFIX}${ctx.runId}|${ctx.phaseId}`;
}

function readLocal(ctx: AssessmentContext | null): Record<string, AnalystCall> {
  if (!ctx) return {};
  try {
    const raw = window.localStorage.getItem(localKey(ctx));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, AnalystCall>) : {};
  } catch {
    return {};
  }
}

function writeLocal(ctx: AssessmentContext, calls: Record<string, AnalystCall>): void {
  try {
    window.localStorage.setItem(localKey(ctx), JSON.stringify(calls));
  } catch {
    /* storage unavailable — calls last for this session */
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface UseAnalystCalls {
  calls: Record<string, AnalystCall>;
  setCall: (objectiveId: string, call: AnalystCall) => void;
  storage: CallStorage;
  /** Why calls are on this device only, or the last write problem. */
  storageNote: string | null;
}

/**
 * @param ctx      which run and phase; null → nothing to assess yet
 * @param persist  write to the ontology (false for the synthetic demo run,
 *                 whose assessments must not land in the real record)
 * @param suggestions  the suggested rating and basis per objective, stored
 *                 beside the analyst's call for audit
 */
export function useAnalystCalls(
  ctx: AssessmentContext | null,
  persist: boolean,
  suggestions: ReadonlyMap<string, { rating: ObjectiveRating; basis: string }>,
): UseAnalystCalls {
  const [calls, setCalls] = useState<Record<string, AnalystCall>>(() => readLocal(ctx));
  const [storage, setStorage] = useState<CallStorage>("loading");
  const [storageNote, setStorageNote] = useState<string | null>(null);

  const ctxKey = ctx ? `${ctx.runId}|${ctx.phaseId}` : null;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;
  const storageRef = useRef(storage);
  storageRef.current = storage;
  /** Assessment ids known to exist in the ontology — decides create vs modify. */
  const storedRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const current = ctxRef.current;
    const local = readLocal(current);
    setCalls(local);
    storedRef.current = new Set();
    if (!current) {
      setStorage("device");
      setStorageNote(null);
      return;
    }
    if (!persist) {
      setStorage("device");
      setStorageNote("Demo run — calls are kept on this device and not written to the ontology.");
      return;
    }
    let live = true;
    setStorage("loading");
    searchObjectsByName(ASSESSMENT_OBJECT_TYPE, { runId: current.runId, phaseId: current.phaseId })
      .then((objects) => {
        if (!live) return;
        storedRef.current = new Set(
          objects.map((o) => String(o.assessmentId ?? "")).filter((id) => id.length > 0),
        );
        // The ontology is the record; anything only on this device (made
        // before the type existed, or offline) is kept and saved on next edit.
        setCalls({ ...local, ...callsFromObjects(objects) });
        setStorage("foundry");
        setStorageNote(null);
      })
      .catch((err) => {
        if (!live) return;
        setStorage("device");
        setStorageNote(
          err instanceof OntologyResourceMissing
            ? "NxgObjectiveAssessment is not set up in the ontology yet — calls are saved on this device only."
            : `Could not reach Foundry (${describe(err)}) — calls are saved on this device only.`,
        );
      });
    return () => {
      live = false;
    };
    // ctxKey stands for ctx; persist switches the source.
  }, [ctxKey, persist]);

  // Flush nothing on unmount — pending writes are cancelled with their timers.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // ── Save ────────────────────────────────────────────────────────────────
  const writeToOntology = useCallback(async (objectiveId: string, call: AnalystCall) => {
    const current = ctxRef.current;
    if (!current || storageRef.current !== "foundry") return;
    const id = assessmentId(current, objectiveId);
    const exists = storedRef.current.has(id);
    try {
      if (!call.rating && !call.note) {
        if (exists) {
          await applyActionByName(ASSESSMENT_ACTIONS.delete, { [ASSESSMENT_OBJECT_PARAM]: id });
          storedRef.current.delete(id);
        }
        return;
      }
      const suggestion = suggestionsRef.current.get(objectiveId) ?? {
        rating: "NEEDS_JUDGEMENT" as const,
        basis: "",
      };
      const props = assessmentProperties(current, objectiveId, call, suggestion);
      if (exists) {
        const { assessmentId: _pk, ...rest } = props;
        void _pk;
        await applyActionByName(ASSESSMENT_ACTIONS.modify, {
          [ASSESSMENT_OBJECT_PARAM]: id,
          ...rest,
        });
      } else {
        await applyActionByName(ASSESSMENT_ACTIONS.create, props);
        storedRef.current.add(id);
      }
      setStorageNote(null);
    } catch (err) {
      setStorageNote(
        err instanceof OntologyResourceMissing
          ? `${describe(err)} The call is saved on this device.`
          : `Could not save to Foundry (${describe(err)}). The call is saved on this device.`,
      );
    }
  }, []);

  const setCall = useCallback(
    (objectiveId: string, call: AnalystCall) => {
      const current = ctxRef.current;
      setCalls((prev) => {
        const next = { ...prev, [objectiveId]: call };
        if (!call.rating && !call.note) delete next[objectiveId];
        if (current) writeLocal(current, next);
        return next;
      });
      const timers = timersRef.current;
      const pending = timers.get(objectiveId);
      if (pending) clearTimeout(pending);
      timers.set(
        objectiveId,
        setTimeout(() => {
          timers.delete(objectiveId);
          void writeToOntology(objectiveId, call);
        }, WRITE_DELAY_MS),
      );
    },
    [writeToOntology],
  );

  return { calls, setCall, storage, storageNote };
}
