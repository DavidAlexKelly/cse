// ── analysisScreen/hooks/useRunPlayback.ts ─────────────────────────────────
// Windowed playback over a run that is far too large to hold in the browser.
//
// The timeline always spans the WHOLE run, but only a handful of chunks are
// ever resident. A chunk is a fixed number of frame buckets, so its wall-clock
// span scales with the chosen resolution: at 1 s resolution a chunk is 90 s of
// the run, at 30 s resolution it is 45 minutes. That keeps every fetch to
// roughly the same number of rows (buckets × entities) no matter how much of
// the run the user wants to skim.
//
// Chunks are fetched on demand: on load (the start of the run), on seek (the
// chunk under the playhead), and speculatively one chunk ahead while playing.
// Playback stalls — "buffering" — rather than skipping when the playhead
// reaches an unloaded chunk.
//
// Frames carry HlaEntity, the same model the live map draws, so the analysis
// screen and hlamap render identical symbols for the same unit.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { accumulateIdentity, entityFromRow, positioned } from "@/shared/hla/trackRow";
import type { TrackRow } from "@/shared/hla/trackRow";
import type { HlaEntity } from "@/shared/hla/types";
import type { PhasePlan } from "@/shared/hla/balticShieldPlan";
import { loadFrames } from "../data/tracks";
import { SqlError } from "@/shared/lib/sqlClient";
import type { RunCompliance } from "../lib/compliance";
import type { RunDebrief } from "../lib/debriefNarrative";
import type { Frame, KeyEvent, RawFrame, RunSummary } from "../types";

/** Frame buckets per fetched chunk — fixes the row count of every query. */
export const BUCKETS_PER_CHUNK = 90;
/** Resident chunks before the furthest-from-playhead ones are evicted. */
const MAX_CACHED_CHUNKS = 8;
/** Playback clock rate. 15 Hz is smooth for map markers and cheap to render. */
const CLOCK_INTERVAL_MS = 66;
/** Start fetching the next chunk once the playhead is this far into the current one. */
const PREFETCH_AT = 0.7;

export interface LoadedRange {
  startS: number;
  endS: number;
}

export interface RunPlayback {
  /** Playhead position, epoch seconds (fractional between frames). */
  currentTs: number;
  playing: boolean;
  speed: number;
  /** True when the playhead is over a chunk that has not arrived yet. */
  buffering: boolean;
  /** Entities at the playhead, positions interpolated between frames. */
  entities: HlaEntity[];
  /** Epoch seconds of the frame actually being displayed, or null. */
  frameTs: number | null;
  /** Wall-clock span of one chunk at the current resolution. */
  chunkSeconds: number;
  /** Spans of the run currently held in memory, for timeline shading. */
  loadedRanges: LoadedRange[];
  /** Spans currently in flight. */
  loadingRanges: LoadedRange[];
  error: string | null;
  /** True when the error is likely a missing OAuth scope / resource grant. */
  permissionDenied: boolean;
  /**
   * Notable moments in the run, for timeline markers.
   *
   * Optional because real runs do not derive them yet — only mock runs supply
   * them today. Deriving them from damage-state transitions is the next step.
   */
  keyEvents?: KeyEvent[];
  /**
   * The plan this run was executing, and how it measured up against it.
   *
   * Optional for the same reason keyEvents is, and gated the same way: only
   * mock runs can supply these today, because measuring an order needs the
   * whole track and this hook deliberately holds only a few chunks of it. The
   * UI keys the plan overlay and the compliance panel off `compliance` being
   * present rather than off a mock-demo flag, so when a real run can supply
   * them — a phase plan resolved from NxgPhaseMapState, and a track sampled by
   * SQL — the same screen lights up with no further changes.
   */
  plan?: PhasePlan;
  compliance?: RunCompliance;
  /**
   * Everything the debrief view reads: the run's event log, the statistics
   * derived from it and the track, and the written summary.
   *
   * Gated the same way, and for a harder reason than the plan is. Movement and
   * contact statistics would be honest for a real run, but the event log would
   * not: the tracks feed publishes no attrition and no activity, so contact,
   * losses and effects cannot be derived from it at all. A real run would be
   * able to fill part of this — appearances, movement, closest approach, and
   * every command issued, which the Command Stream datasets do record — and
   * RunEvent.provenance is what lets a mixed log say which is which.
   */
  debrief?: RunDebrief;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  /** Move the playhead and fetch whatever covers it. */
  seek: (ts: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Shortest signed rotation from `from` to `to`, in degrees. */
function angleDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Turn a chunk's raw rows into drawable frames.
 *
 * Identity is accumulated over the whole chunk first, then applied to each
 * row: about half the rows in this feed omit the callsign, and the symbology
 * needs a name to pick an APP-6 symbol rather than an empty frame. Only
 * identity crosses frames — see accumulateIdentity for why dynamic state
 * deliberately does not.
 */
function buildFrames(raw: RawFrame[], identities: Map<string, TrackRow>): Frame[] {
  for (const frame of raw) accumulateIdentity(frame.rows, identities);

  return raw.map((frame): Frame => {
    const entities: HlaEntity[] = [];
    for (const row of frame.rows) {
      const key = row.entity_id ?? row.unique_id;
      const entity = entityFromRow(key ? identities.get(String(key)) : undefined, row);
      if (entity && positioned(entity)) entities.push(entity);
    }
    return { ts: frame.ts, entities };
  });
}

export function useRunPlayback(run: RunSummary | null, stepSeconds: number): RunPlayback {
  const [chunks, setChunks] = useState<Map<number, Frame[]>>(() => new Map());
  const [loading, setLoading] = useState<Set<number>>(() => new Set());
  const [currentTs, setCurrentTs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [buffering, setBuffering] = useState(false);

  const chunkSeconds = BUCKETS_PER_CHUNK * stepSeconds;

  // What each entity *is*, learned from whichever rows carried it. Persists for
  // the life of the run so a chunk fetched later benefits from what earlier
  // chunks already established.
  const identitiesRef = useRef<Map<string, TrackRow>>(new Map());

  // Mirrors of state that the clock and loader read without re-subscribing.
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const currentTsRef = useRef(currentTs);
  currentTsRef.current = currentTs;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const totalChunks = run ? Math.max(1, Math.ceil((run.endS - run.startS) / chunkSeconds)) : 0;

  const chunkIndexOf = useCallback(
    (ts: number): number => {
      if (!run) return 0;
      return Math.floor((ts - run.startS) / chunkSeconds);
    },
    [run, chunkSeconds]
  );

  // ── Reset whenever the run or the resolution changes ─────────────────────
  // Chunk boundaries are a function of the step, so cached frames from a
  // different resolution cannot be reused. Identity is dropped with them: HLA
  // handles are reassigned between runs, so the same id in another run is a
  // different unit.
  useEffect(() => {
    identitiesRef.current = new Map();
    setChunks(new Map());
    setLoading(new Set());
    setError(null);
    setPermissionDenied(false);
    setPlaying(false);
    setBuffering(false);
    setCurrentTs(run ? run.startS : 0);
  }, [run, stepSeconds]);

  // ── Chunk loader ─────────────────────────────────────────────────────────
  const loadChunk = useCallback(
    (index: number) => {
      if (!run) return;
      if (index < 0 || index >= totalChunks) return;
      if (chunksRef.current.has(index) || loadingRef.current.has(index)) return;

      const startS = run.startS + index * chunkSeconds;
      const endS = Math.min(startS + chunkSeconds, run.endS);

      // Mark in flight immediately so concurrent callers do not double-fetch.
      loadingRef.current = new Set(loadingRef.current).add(index);
      setLoading(loadingRef.current);

      void (async () => {
        try {
          const raw = await loadFrames(startS, endS, stepSeconds);
          const frames = buildFrames(raw, identitiesRef.current);

          setChunks((prev) => {
            const next = new Map(prev).set(index, frames);

            // Evict the chunks furthest from the playhead once over budget.
            if (next.size > MAX_CACHED_CHUNKS) {
              const playheadChunk = Math.floor((currentTsRef.current - run.startS) / chunkSeconds);
              const ordered = [...next.keys()].sort(
                (a, b) => Math.abs(b - playheadChunk) - Math.abs(a - playheadChunk)
              );
              for (const key of ordered) {
                if (next.size <= MAX_CACHED_CHUNKS) break;
                if (key !== index) next.delete(key);
              }
            }
            return next;
          });
          setError(null);
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
          setError(String((err as Error)?.message ?? err));
          if (err instanceof SqlError && err.permissionDenied) setPermissionDenied(true);
        } finally {
          setLoading((prev) => {
            const next = new Set(prev);
            next.delete(index);
            loadingRef.current = next;
            return next;
          });
        }
      })();
    },
    [run, totalChunks, chunkSeconds, stepSeconds]
  );

  // ── Load the opening chunk of the run ────────────────────────────────────
  useEffect(() => {
    if (!run) return;
    loadChunk(0);
  }, [run, loadChunk]);

  // ── Flatten resident chunks into one time-ordered frame list ─────────────
  const frames = useMemo(() => {
    const ordered = [...chunks.keys()].sort((a, b) => a - b);
    const all: Frame[] = [];
    for (const key of ordered) all.push(...(chunks.get(key) ?? []));
    return all;
  }, [chunks]);

  /** Index of the last frame at or before `ts`, or -1. */
  const findFrameIndex = useCallback((list: Frame[], ts: number): number => {
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].ts <= ts) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }, []);

  const isCovered = useCallback(
    (ts: number): boolean => chunksRef.current.has(chunkIndexOf(ts)),
    [chunkIndexOf]
  );

  // ── Playback clock ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!run || !playing) return;

    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const deltaSeconds = ((now - last) / 1000) * speedRef.current;
      last = now;

      const from = currentTsRef.current;
      const target = from + deltaSeconds;

      // Stall rather than skip when the next chunk has not arrived.
      if (!isCovered(target)) {
        setBuffering(true);
        loadChunk(chunkIndexOf(target));
        return;
      }
      setBuffering(false);

      if (target >= run.endS) {
        currentTsRef.current = run.endS;
        setCurrentTs(run.endS);
        setPlaying(false);
        return;
      }

      currentTsRef.current = target;
      setCurrentTs(target);

      // Speculative read-ahead so playback does not stall at the boundary.
      const index = chunkIndexOf(target);
      const progress = (target - (run.startS + index * chunkSeconds)) / chunkSeconds;
      if (progress > PREFETCH_AT) loadChunk(index + 1);
    }, CLOCK_INTERVAL_MS);

    return () => clearInterval(id);
  }, [run, playing, isCovered, loadChunk, chunkIndexOf, chunkSeconds]);

  // ── Seeking ──────────────────────────────────────────────────────────────
  const seek = useCallback(
    (ts: number) => {
      if (!run) return;
      const clamped = clamp(ts, run.startS, run.endS);
      currentTsRef.current = clamped;
      setCurrentTs(clamped);
      const index = chunkIndexOf(clamped);
      loadChunk(index);
      setBuffering(!chunksRef.current.has(index));
    },
    [run, chunkIndexOf, loadChunk]
  );

  // ── Entities at the playhead, interpolated between frames ────────────────
  const { entities, frameTs } = useMemo(() => {
    const nothing = { entities: [] as HlaEntity[], frameTs: null as number | null };
    if (frames.length === 0) return nothing;

    const index = findFrameIndex(frames, currentTs);
    if (index < 0) return nothing;

    const current = frames[index];
    const next = frames[index + 1];

    // Only interpolate across an adjacent bucket. A larger gap means a chunk
    // boundary or a hole in the feed, where a straight line between two
    // positions would be an invention rather than a reading.
    const canInterpolate =
      next != null && next.ts > current.ts && next.ts - current.ts <= stepSeconds * 2;

    if (!canInterpolate) return { entities: current.entities, frameTs: current.ts };

    const t = clamp((currentTs - current.ts) / (next.ts - current.ts), 0, 1);
    const nextById = new Map(next.entities.map((e) => [e.id, e]));

    const blended = current.entities.map((entity): HlaEntity => {
      const to = nextById.get(entity.id);
      if (!to) return entity;
      return {
        ...entity,
        lat: entity.lat + (to.lat - entity.lat) * t,
        lon: entity.lon + (to.lon - entity.lon) * t,
        heading: (entity.heading + angleDelta(entity.heading, to.heading) * t + 360) % 360,
      };
    });

    return { entities: blended, frameTs: current.ts };
  }, [frames, currentTs, stepSeconds, findFrameIndex]);

  // ── Ranges for the timeline's "what is loaded" shading ───────────────────
  const rangeOf = useCallback(
    (index: number): LoadedRange => ({
      startS: (run?.startS ?? 0) + index * chunkSeconds,
      endS: Math.min((run?.startS ?? 0) + (index + 1) * chunkSeconds, run?.endS ?? 0),
    }),
    [run, chunkSeconds]
  );

  const loadedRanges = useMemo(
    () => (run ? [...chunks.keys()].sort((a, b) => a - b).map(rangeOf) : []),
    [chunks, run, rangeOf]
  );

  const loadingRanges = useMemo(
    () => (run ? [...loading].sort((a, b) => a - b).map(rangeOf) : []),
    [loading, run, rangeOf]
  );

  return {
    currentTs,
    playing,
    speed,
    buffering,
    entities,
    frameTs,
    chunkSeconds,
    loadedRanges,
    loadingRanges,
    error,
    permissionDenied,
    setPlaying,
    setSpeed,
    seek,
  };
}
