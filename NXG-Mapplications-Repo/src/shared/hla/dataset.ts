// ── shared/hla/dataset.ts ──────────────────────────────────────────────────
// Where the HLA entity tracks live.
//
// One dataset, read two ways: hlamap tails it by stream offset for the live
// map, analysisScreen queries time windows out of it with SQL for replay. They
// used to name it with two different environment variables
// (VITE_HLA_TRACK_STREAM_RID and VITE_HLA_TRACKS_DATASET_RID), only one of
// which was actually set — so pointing the live map at a test federation
// silently left the replay on the real one. One name now, resolved here.

/**
 * "HLA Entity Tracks (1 Hz stream)".
 *
 * VITE_HLA_TRACK_STREAM_RID is still honoured as a fallback so an existing
 * local .env keeps working, but VITE_HLA_TRACKS_DATASET_RID is the name to
 * set — it is the one present in the checked-in env files.
 */
export const HLA_TRACKS_DATASET_RID =
  (import.meta.env.VITE_HLA_TRACKS_DATASET_RID as string | undefined)?.trim() ||
  (import.meta.env.VITE_HLA_TRACK_STREAM_RID as string | undefined)?.trim() ||
  "ri.foundry.main.dataset.6e22a37b-e083-4977-be80-f407c8bd952b";

/** The branch both readers use. */
export const HLA_TRACKS_BRANCH = "master";
