// shared/lib/launchRecords.ts
//
// Which phase a run executed.
//
// Nothing in the ontology records that yet (no run object, no run fields on
// NxgPhase), so the Execute screen leaves a note here when it launches, and
// Analysis reads it to open a run on the phase it was launched for. The note
// lives in the browser's localStorage: it works for the operator who launched
// the run, on that machine — which is the demo — and falls back to choosing
// the phase by hand everywhere else. Replace with an ontology record when one
// exists.

export interface LaunchRecord {
  scenarioId: string;
  phaseId: string;
  phaseName: string;
  /** Epoch seconds when the launch completed. */
  launchedAtS: number;
  demo: boolean;
}

const KEY = "nxg.execute.launches";
const KEEP = 50;

export function readLaunchRecords(): LaunchRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LaunchRecord[]) : [];
  } catch {
    return [];
  }
}

export function recordLaunch(record: LaunchRecord): void {
  try {
    const next = [record, ...readLaunchRecords()].slice(0, KEEP);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — Analysis falls back to choosing the phase by hand */
  }
}

/** Launches are recorded when the launch completes; the run's first tracks follow shortly after. */
const BEFORE_RUN_S = 15 * 60;
const AFTER_START_S = 5 * 60;

/**
 * The launch that started this run: the latest one in the window from a
 * quarter of an hour before the run's first track to five minutes after it.
 */
export function launchForRun(
  run: { startS: number; endS: number },
  records: readonly LaunchRecord[],
): LaunchRecord | null {
  const candidates = records.filter(
    (r) =>
      !r.demo &&
      r.launchedAtS >= run.startS - BEFORE_RUN_S &&
      r.launchedAtS <= run.startS + AFTER_START_S,
  );
  candidates.sort((a, b) => b.launchedAtS - a.launchedAtS);
  return candidates[0] ?? null;
}
