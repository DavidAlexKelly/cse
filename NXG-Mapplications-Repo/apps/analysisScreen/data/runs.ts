// ── analysisScreen/data/runs.ts ────────────────────────────────────────────
// Pure run-detection logic.
//
// Split out from tracks.ts (which reaches the network) so it can be unit
// tested without a DOM or a Foundry client.
//
// Unit naming and symbol selection used to live here too, as a hand-rolled
// "branch prefix" parser feeding a colour lookup. Both are gone: the map now
// draws proper APP-6 symbols through shared/hla, which resolves what a unit is
// from the SWORD asset catalogue rather than from guessing at its callsign.

import type { RunSummary } from "../types";

/**
 * Idle minutes that separate one run from the next. Two minutes is comfortably
 * longer than any hiccup seen inside a live federation execution and far
 * shorter than the gaps between execution sessions.
 */
export const RUN_GAP_MINUTES = 2;

/** Format epoch seconds as a UTC `yyyy-MM-dd HH:mm:ss` SQL timestamp literal. */
export function sqlTimestamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Fold a sorted list of active minute buckets into runs.
 *
 * A run is a block of minutes with no gap larger than `gapMinutes`. The end of
 * a run is the END of its last active minute, not the start — otherwise the
 * final minute of every run would be unreachable on the timeline.
 */
export function groupMinutesIntoRuns(
  sortedMinutes: number[],
  gapMinutes = RUN_GAP_MINUTES
): RunSummary[] {
  const runs: RunSummary[] = [];
  let firstMinute: number | null = null;
  let lastMinute: number | null = null;
  let activeMinutes = 0;

  const flush = () => {
    if (firstMinute == null || lastMinute == null) return;
    runs.push({
      id: `run-${firstMinute * 60}`,
      startS: firstMinute * 60,
      endS: (lastMinute + 1) * 60,
      activeMinutes,
    });
  };

  for (const minute of sortedMinutes) {
    if (firstMinute == null || lastMinute == null) {
      firstMinute = minute;
      lastMinute = minute;
      activeMinutes = 1;
      continue;
    }
    if (minute - lastMinute > gapMinutes) {
      flush();
      firstMinute = minute;
      activeMinutes = 1;
    } else {
      activeMinutes += 1;
    }
    lastMinute = minute;
  }
  flush();

  return runs.sort((a, b) => b.startS - a.startS);
}
