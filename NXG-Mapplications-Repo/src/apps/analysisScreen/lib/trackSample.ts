// analysisScreen/lib/trackSample.ts
//
// A real run's whole track at a coarse cadence, in the SampledTrack shape the
// compliance engine and run statistics read (see sampleMockTrack for the mock
// run's equivalent).
//
// Playback deliberately holds only a few chunks of a run; measuring an order
// needs all of it. So this is a separate, coarse read: a few hundred frame
// buckets across the whole run, whatever its length.
import type { HlaEntity } from "@/shared/hla/types";
import type { EntityCandidate } from "./entityMatch";
import type { Roster } from "./runStatistics";
import type { SampledTrack } from "./sampleMockTrack";

/** Frame buckets across the whole run — fixes the cost of the read. */
export const SAMPLE_BUCKETS = 400;

/** Seconds per bucket for a run of this length: never finer than 30 s. */
export function sampleStepSeconds(runDurationSec: number, buckets = SAMPLE_BUCKETS): number {
  return Math.max(30, Math.ceil(Math.max(1, runDurationSec) / buckets));
}

export interface FrameLike {
  ts: number;
  entities: HlaEntity[];
}

/** Per-entity positions through the run, seconds from its start, time-ordered. */
export function trackFromFrames(frames: readonly FrameLike[], runStartS: number): SampledTrack {
  const track: SampledTrack = new Map();
  const ordered = [...frames].sort((a, b) => a.ts - b.ts);
  for (const frame of ordered) {
    for (const e of frame.entities) {
      if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
      const sample = { tSec: Math.max(0, frame.ts - runStartS), lat: e.lat, lon: e.lon };
      const list = track.get(e.id);
      if (list) list.push(sample);
      else track.set(e.id, [sample]);
    }
  }
  return track;
}

/** Who each entity is, as first seen — for the statistics' roster. */
export function rosterFromFrames(frames: readonly FrameLike[]): Roster {
  const roster: Roster = new Map();
  for (const frame of frames) {
    for (const e of frame.entities) {
      if (roster.has(e.id)) continue;
      roster.set(e.id, { label: e.unit || e.callsign || e.id, force: e.force });
    }
  }
  return roster;
}

/** Each entity at its first appearance — what planned units are matched against. */
export function candidatesFromFrames(frames: readonly FrameLike[]): EntityCandidate[] {
  const first = new Map<string, EntityCandidate>();
  const ordered = [...frames].sort((a, b) => a.ts - b.ts);
  for (const frame of ordered) {
    for (const e of frame.entities) {
      if (first.has(e.id) || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
      first.set(e.id, {
        id: e.id,
        callsign: e.callsign,
        unit: e.unit,
        force: e.force === "RED" ? "red" : "blue",
        lat: e.lat,
        lon: e.lon,
      });
    }
  }
  return [...first.values()];
}
