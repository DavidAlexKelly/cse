// ── analysisScreen/lib/sampleMockTrack.ts ──────────────────────────────────
// The whole of a mock run's movement, as a per-entity track.
//
// Measuring an order against a route needs the entire track, not the frame
// under the playhead — which is exactly what useRunPlayback cannot give you,
// because it deliberately holds only a handful of chunks at a time. For a mock
// run that constraint does not exist: laydownAt() is a pure function of
// progress, so the run can be sampled end to end with no I/O at all.
//
// This is the seam where a real run will differ. The shape below is what a
// SQL query over the tracks dataset would have to produce — entity id to a
// time-ordered list of positions — so the compliance engine that consumes it
// does not need to know which it is looking at.

import { ADVANCE_DURATION_S, laydownAt } from "@/shared/hla/balticShield";

export interface TrackSample {
  /** Seconds since the start of the run. */
  tSec: number;
  lat: number;
  lon: number;
}

/** Every entity's positions through the run, each list ordered by time. */
export type SampledTrack = Map<string, TrackSample[]>;

/**
 * Seconds between samples.
 *
 * 15 s over the hour-long advance is 241 samples per entity — about 5,500
 * points for the whole laydown, which is nothing to hold or to walk. Finer
 * sampling buys no accuracy here: the scripted advance is piecewise linear, so
 * samples between leg boundaries are exactly on the line anyway.
 */
export const DEFAULT_SAMPLE_CADENCE_S = 15;

/**
 * Sample the scripted advance across the whole run.
 *
 * The final instant is always included even when it does not fall on a cadence
 * boundary: several orders in the plan are only reached at the very end of the
 * advance, and dropping the last sample would report them as never reached.
 */
export function sampleMockTrack(
  runDurationSec: number = ADVANCE_DURATION_S,
  cadenceSec: number = DEFAULT_SAMPLE_CADENCE_S,
): SampledTrack {
  const track: SampledTrack = new Map();
  const duration = Math.max(1, runDurationSec);
  const step = Math.max(1, cadenceSec);

  const times: number[] = [];
  for (let t = 0; t < duration; t += step) times.push(t);
  times.push(duration);

  for (const tSec of times) {
    for (const entity of laydownAt(tSec / duration)) {
      // NaN is how balticShield spells "position not known"; it is never a
      // valid location and must not enter a distance calculation.
      if (!Number.isFinite(entity.lat) || !Number.isFinite(entity.lon)) continue;

      const samples = track.get(entity.id);
      const sample: TrackSample = { tSec, lat: entity.lat, lon: entity.lon };
      if (samples) samples.push(sample);
      else track.set(entity.id, [sample]);
    }
  }

  return track;
}

export default sampleMockTrack;
