// ── analysisScreen/types.ts ────────────────────────────────────────────────
// Shapes for after-action analysis of the "HLA Entity Tracks (1 Hz stream)"
// dataset (ri.foundry.main.dataset.6e22a37b-e083-4977-be80-f407c8bd952b).
//
// The entities themselves are HlaEntity, exactly as the live map draws them —
// see shared/hla/types. Only the playback scaffolding is this app's own.
//
// The dataset has no run/session identifier column, so a "run" here is
// inferred: a contiguous block of positional rows bounded by an idle gap (see
// data/runs.ts). Everything is keyed on epoch SECONDS rather than Date objects
// — the SQL layer returns unix_timestamp() integers, which sidesteps any
// timestamp-string/timezone parsing ambiguity.

import type { TrackRow } from "@/shared/hla/trackRow";
import type { HlaEntity } from "@/shared/hla/types";

/** One inferred federation run: a block of positional activity. */
export interface RunSummary {
  /** Stable id derived from the run's start second. */
  id: string;
  /** Epoch seconds, inclusive. */
  startS: number;
  /** Epoch seconds, exclusive. */
  endS: number;
  /** Count of one-minute buckets in the run that contained positional rows. */
  activeMinutes: number;
}

/** The raw rows sampled into a single time bucket, as they came back from SQL. */
export interface RawFrame {
  /** Epoch seconds of the bucket (already snapped to the resolution step). */
  ts: number;
  rows: TrackRow[];
}

/** All entities as they were at a single instant. */
export interface Frame {
  /** Epoch seconds of the bucket. */
  ts: number;
  entities: HlaEntity[];
}

/**
 * A moment in a run worth jumping to — a kill, a first detection, a phase
 * transition. Rendered as a marker on the timeline.
 *
 * Currently only produced for mock runs. Deriving these from real track data
 * (damage-state transitions, entities disappearing) is the obvious next step,
 * which is why the shape is deliberately not mock-specific.
 */
export interface KeyEvent {
  id: string;
  /** Epoch seconds. */
  ts: number;
  /**
   * What kind of moment this is.
   *
   * The first four are things that happened in the run. The last three come
   * from measuring the run against its plan (see lib/compliance.ts) and are
   * only ever emitted for the order currently selected in the compliance
   * panel — a marker per order per moment would bury the track under its own
   * annotations.
   */
  kind:
    | "engagement"
    | "loss"
    | "detection"
    | "objective"
    | "phase"
    | "plan"
    | "arrival"
    | "deviation";
  /** One line, shown on hover. */
  label: string;
}
