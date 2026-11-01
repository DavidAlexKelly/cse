// analysisScreen/data/runTrack.ts
//
// The whole of a real run at a coarse cadence, for measuring it against the
// plan. Read in chunks of 100 buckets so no single SQL query is large, with
// identity carried across chunks the same way playback does.
import type { TrackRow } from "@/shared/hla/trackRow";
import { buildFrames } from "../hooks/useRunPlayback";
import { sampleStepSeconds } from "../lib/trackSample";
import type { Frame, RunSummary } from "../types";
import { loadFrames } from "./tracks";

const BUCKETS_PER_READ = 100;

export async function loadRunTrackFrames(run: RunSummary, signal?: AbortSignal): Promise<Frame[]> {
  const step = sampleStepSeconds(run.endS - run.startS);
  const span = step * BUCKETS_PER_READ;
  const identities = new Map<string, TrackRow>();
  const frames: Frame[] = [];
  for (let start = run.startS; start < run.endS; start += span) {
    const raw = await loadFrames(start, Math.min(start + span, run.endS), step, signal);
    frames.push(...buildFrames(raw, identities));
  }
  return frames;
}
