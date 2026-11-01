// ============================================================
// useOntologyMutation
//
// Small shared wrapper around applying an ontology Action.
// Every widget mutation goes through this so that pending state,
// error surfacing and post-write refresh behave identically
// everywhere.
//
// Errors are deliberately NOT swallowed: `run` re-throws after
// recording the message so callers can choose to roll back
// optimistic UI, while `error` stays available for rendering.
// ============================================================

import { useCallback, useRef, useState } from "react";

export interface OntologyMutationOptions {
  /**
   * Called after every successful write.
   *
   * Widgets pass a callback here that emits their `onDataChanged` event,
   * so Workshop can refresh sibling widgets. Routing it through this hook
   * means every mutation notifies, rather than relying on each individual
   * call site remembering to.
   */
  onSuccess?: () => void;
}

export interface UseOntologyMutationResult {
  /** True while at least one mutation is in flight. */
  pending: boolean;
  /** Message from the most recent failure, or null. */
  error: string | null;
  /** Clears the current error message. */
  clearError: () => void;
  /**
   * Runs an action and tracks pending/error state around it.
   * Re-throws on failure so the caller can roll back.
   */
  run: <T>(fn: () => Promise<T>) => Promise<T>;
}

function messageFor(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return "The change could not be saved. Please try again.";
}

export function useOntologyMutation(
  options?: OntologyMutationOptions,
): UseOntologyMutationResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Counts concurrent mutations so overlapping writes don't clear
  // the pending flag early.
  const inFlight = useRef(0);
  // Held in a ref so `run` keeps a stable identity even when the caller
  // passes a fresh options object each render.
  const onSuccessRef = useRef(options?.onSuccess);
  onSuccessRef.current = options?.onSuccess;

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    inFlight.current += 1;
    setPending(true);
    setError(null);
    try {
      const result = await fn();
      onSuccessRef.current?.();
      return result;
    } catch (e) {
      setError(messageFor(e));
      throw e;
    } finally {
      inFlight.current -= 1;
      if (inFlight.current === 0) setPending(false);
    }
  }, []);

  return { pending, error, clearError, run };
}
