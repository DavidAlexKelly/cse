// ── analysisScreen/data/tracks.ts ──────────────────────────────────────────
// Queries against the HLA entity-tracks dataset.
//
// Two facts about this dataset drive the shape of everything below:
//
//  1. There is no run/session id. Entities are re-published with fresh HLA
//     handles every federation execution, and the only signal that one run
//     ended and another began is an idle gap in `observed_at`. Runs are
//     therefore *inferred* by gap detection (see runs.ts).
//
//  2. Rows are written whenever the bridge discovers an entity, including
//     before that entity publishes a position, and roughly a quarter of rows
//     are sparse in this way. Every query here filters on
//     `latitude IS NOT NULL` so that a burst of attribute-less discovery rows
//     is not mistaken for a run worth playing.
//
// Rows come back raw (as TrackRow) rather than pre-merged into entities: the
// merge needs the identity accumulated across the whole chunk, which is the
// playback hook's job — see hooks/useRunPlayback.

import { asNumber, columnIndex } from "./csv";
import { groupMinutesIntoRuns, sqlTimestamp } from "./runs";
import { runSql } from "./sqlClient";
import type { TrackRow } from "@/shared/hla/trackRow";
import { HLA_TRACKS_DATASET_RID } from "@/shared/hla/dataset";
import type { RawFrame, RunSummary } from "../types";

// The same dataset hlamap tails live — see shared/hla/dataset.
const TRACKS_DATASET_RID = HLA_TRACKS_DATASET_RID;

/**
 * Enumerate every run in the dataset, newest first.
 *
 * The query only asks for the DISTINCT minute buckets that contain positional
 * rows — a couple of thousand integers even for a multi-day feed — and the gap
 * grouping happens client-side. Doing the grouping in SQL needs a window
 * function feeding an aggregate, which Spark's analyser collapses back into
 * the base scan and then rejects ("non-aggregating expression observed_at").
 * Folding a few thousand integers in JS is simpler than fighting that.
 */
export async function listRuns(signal?: AbortSignal): Promise<RunSummary[]> {
  const query = `
    SELECT DISTINCT CAST(FLOOR(unix_timestamp(observed_at) / 60) AS BIGINT) AS m
    FROM \`${TRACKS_DATASET_RID}\`
    WHERE latitude IS NOT NULL
    ORDER BY m
  `;

  const table = await runSql(query, signal);
  const col = columnIndex(table);

  const minutes = table.rows
    .map((row) => asNumber(row[col["m"]]))
    .filter((m): m is number => m != null)
    .sort((a, b) => a - b);

  return groupMinutesIntoRuns(minutes);
}

/** Empty string → null, so a blank CSV cell does not read as a real value. */
function asText(value: string | undefined): string | null {
  return value == null || value === "" ? null : value;
}

/**
 * Fetch one downsampled window of playback frames.
 *
 * Downsampling happens server-side: rows are bucketed into `stepSeconds` and
 * the first row per (entity, bucket) wins. That keeps the payload proportional
 * to entities × buckets (a few tens of thousands of rows) instead of to the
 * ~300 rows/second the feed actually contains.
 *
 * The identity columns (name, callsign, force, DIS type, simulator) are
 * selected alongside the position ones even though they are constant per
 * entity and therefore heavily repeated. The alternative — a separate roster
 * query per run — means an extra aggregation over every row in the run before
 * anything can be drawn, and the repetition compresses away on the wire.
 */
export async function loadFrames(
  startS: number,
  endS: number,
  stepSeconds: number,
  signal?: AbortSignal
): Promise<RawFrame[]> {
  const query = `
    WITH src AS (
      SELECT
        CAST(FLOOR(unix_timestamp(observed_at) / ${stepSeconds}) AS BIGINT) AS bucket,
        CAST(unix_timestamp(observed_at) AS BIGINT)                         AS ts,
        entity_id,
        unique_id,
        name,
        callsign,
        force_id,
        symbol_id,
        dis_type,
        simulator,
        latitude,
        longitude,
        altitude_m,
        heading_deg,
        speed_mps,
        damage_state,
        aggregate_state
      FROM \`${TRACKS_DATASET_RID}\`
      WHERE latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND observed_at >= TIMESTAMP '${sqlTimestamp(startS)}'
        AND observed_at <  TIMESTAMP '${sqlTimestamp(endS)}'
    ),
    ranked AS (
      SELECT
        bucket, ts, entity_id, unique_id, name, callsign, force_id, symbol_id,
        dis_type, simulator, latitude, longitude, altitude_m, heading_deg,
        speed_mps, damage_state, aggregate_state,
        ROW_NUMBER() OVER (PARTITION BY entity_id, bucket ORDER BY ts) AS rn
      FROM src
    )
    SELECT
      bucket * ${stepSeconds} AS frame_ts,
      entity_id,
      unique_id,
      name,
      callsign,
      force_id,
      symbol_id,
      dis_type,
      simulator,
      latitude,
      longitude,
      altitude_m,
      heading_deg,
      speed_mps,
      damage_state,
      aggregate_state
    FROM ranked
    WHERE rn = 1
    ORDER BY frame_ts, entity_id
  `;

  const table = await runSql(query, signal);
  const col = columnIndex(table);

  const byTs = new Map<number, TrackRow[]>();

  for (const cells of table.rows) {
    const ts = asNumber(cells[col["frame_ts"]]);
    if (ts == null) continue;

    const row: TrackRow = {
      entity_id: asText(cells[col["entity_id"]]),
      unique_id: asText(cells[col["unique_id"]]),
      name: asText(cells[col["name"]]),
      callsign: asText(cells[col["callsign"]]),
      force_id: asText(cells[col["force_id"]]),
      symbol_id: asText(cells[col["symbol_id"]]),
      dis_type: asText(cells[col["dis_type"]]),
      simulator: asText(cells[col["simulator"]]),
      latitude: asNumber(cells[col["latitude"]]),
      longitude: asNumber(cells[col["longitude"]]),
      altitude_m: asNumber(cells[col["altitude_m"]]),
      heading_deg: asNumber(cells[col["heading_deg"]]),
      speed_mps: asNumber(cells[col["speed_mps"]]),
      damage_state: asText(cells[col["damage_state"]]),
      aggregate_state: asText(cells[col["aggregate_state"]]),
    };

    const bucket = byTs.get(ts);
    if (bucket) bucket.push(row);
    else byTs.set(ts, [row]);
  }

  return [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, rows]): RawFrame => ({ ts, rows }));
}
