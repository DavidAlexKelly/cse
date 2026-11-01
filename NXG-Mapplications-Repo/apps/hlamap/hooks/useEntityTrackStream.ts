// ── hlamap/hooks/useEntityTrackStream.ts ───────────────────────────────────
// Live entity state read from the "HLA Entity Tracks (1 Hz stream)" streaming
// dataset, replacing the bridge_get_entities function poll.
//
// Why read the stream instead of calling the bridge
// -------------------------------------------------
// The tracks are published by their own compute module (hla-bridge-streamer,
// beside a monitor-only federate) at 1 Hz. Reading them here means:
//
//   * the map keeps working while the tasking compute module is redeployed or
//     scaled to zero — it no longer shares a pod with the map's data path,
//   * every viewer reads the rows the platform already stores, rather than each
//     browser tab causing its own RTI-backed function call once a second, and
//   * what the map shows is exactly what downstream analytics see.
//
// Commands still go through the bridge functions: this stream is read-only.
//
// Offsets and history
// -------------------
// A stream is an append-only log, not a snapshot. On the first poll we start a
// little way *back* from the end so the map paints immediately rather than
// waiting for the next tick — but not from offset 0, which would replay the
// whole exercise. After that we read forward from the offsets we hold.
//
// Disappearance is the other consequence of a log. bridge_get_entities returned
// the current set, so an entity that left simply vanished; here nothing is ever
// removed, so entities have to be aged out. Two rules do it, and they answer
// different questions:
//
//   ENTITY_TTL_MS  — relative to the newest `observed_at` in the stream. Catches
//                    a single entity going quiet while the rest keep arriving.
//                    Being relative, it cannot fire when the whole feed stops:
//                    everything ages together and nothing is ever the outlier.
//   ENTITY_MAX_AGE_MS — relative to the newest observed_at in the stream (server
//                    time). The backstop for exactly the case above: when the
//                    whole feed stops, newest stops advancing, and anything last
//                    seen more than ENTITY_MAX_AGE_MS before it is dead.
//                    Both sides are server timestamps so browser clock skew
//                    cannot cause spurious eviction.
//
// Both rules measure `observed_at` and nothing else, and both live in
// shared/hla/trackAgeing — pure, and therefore tested. Ageing asks whether the
// streamer is still publishing an entity, which is a different question from
// whether that entity has moved, and keying it on the bridge's change clock
// hid every stationary unit in the federation.

import { useEffect, useRef, useState } from "react";
import { Streams } from "@osdk/foundry.streams";
import { client } from "@/client";
import type { BridgeStatusInfo, HlaEntity } from "../types";
import type { ConnState } from "../components/TopBar";
import { mergeRow, positioned, type TrackRow } from "@/shared/hla/trackRow";
import { HLA_TRACKS_BRANCH, HLA_TRACKS_DATASET_RID } from "@/shared/hla/dataset";
import { ENTITY_MAX_AGE_MS, isExpired, rowObservedAt } from "@/shared/hla/trackAgeing";

const STREAM_RID = HLA_TRACKS_DATASET_RID;
const STREAM_BRANCH = HLA_TRACKS_BRANCH;

/** The publisher writes at 1 Hz; polling faster only costs requests. */
// Halved from the publisher's 1 Hz: a command's effect crosses five polling
// stages in series (poster -> input stream -> commands.py -> bridge -> drone
// -> tracks.py -> here), so each one that is faster than the 1 Hz source rate
// takes real latency off the observed round trip. Costs 2x the requests.
const POLL_INTERVAL_MS = 500;
/** Records per partition per poll. One tick is one row per entity. */
const RECORD_LIMIT = 500;
/**
 * How far back to start on the first poll: enough to cover a few ticks of a
 * large federation so the map paints straight away, small enough not to replay
 * history.
 */
const INITIAL_LOOKBACK_RECORDS = 600n;

/**
 * How long (wall-clock) with no new rows before we consider the RTI offline
 * and clear the map. 5 s gives a couple of missed ticks before declaring dead.
 */
const RTI_OFFLINE_TIMEOUT_MS = 5_000;

type Offsets = Record<string, string>;

interface Tracked {
  entity: HlaEntity;
  /**
   * Server time, in epoch millis, at which the streamer last published this
   * entity — see {@link rowObservedAt}. Ordering and ageing both key on this.
   */
  lastSeenAt: number;
}

function drawableEntities(tracked: Map<string, Tracked>): HlaEntity[] {
  return [...tracked.values()].map((v) => v.entity).filter(positioned);
}

export interface EntityTrackStream {
  entities: HlaEntity[];
  status: BridgeStatusInfo | null;
  connState: ConnState;
  error: string | null;
}

async function readNewRecords(
  offsets: Offsets,
  isFirstRead: boolean
): Promise<{ rows: TrackRow[]; offsets: Offsets }> {
  const next: Offsets = { ...offsets };
  const rows: TrackRow[] = [];

  const endOffsets = (await Streams.getEndOffsets(client, STREAM_RID, STREAM_BRANCH, {
    preview: true,
  })) as Record<string, string>;

  await Promise.all(
    Object.entries(endOffsets).map(async ([partitionId, endOffset]) => {
      let startOffset = next[partitionId];
      if (startOffset === undefined) {
        const end = BigInt(endOffset);
        const from = end > INITIAL_LOOKBACK_RECORDS ? end - INITIAL_LOOKBACK_RECORDS : 0n;
        startOffset = String(isFirstRead ? from : end);
      }
      if (BigInt(startOffset) >= BigInt(endOffset)) {
        next[partitionId] = startOffset;
        return;
      }
      try {
        const records = await Streams.getRecords(client, STREAM_RID, STREAM_BRANCH, {
          partitionId: partitionId as never,
          startOffset,
          limit: RECORD_LIMIT,
          preview: true,
        });
        if (!Array.isArray(records)) return;
        for (const record of records) {
          rows.push(record.value as TrackRow);
          const after = String(BigInt(record.offset) + 1n);
          if (!next[partitionId] || BigInt(after) > BigInt(next[partitionId])) {
            next[partitionId] = after;
          }
        }
      } catch (err) {
        console.error(`[useEntityTrackStream] getRecords failed on partition ${partitionId}:`, err);
      }
    })
  );

  return { rows, offsets: next };
}

export function useEntityTrackStream(): EntityTrackStream {
  const [entities, setEntities] = useState<HlaEntity[]>([]);
  const [status, setStatus] = useState<BridgeStatusInfo | null>(null);
  const [connState, setConnState] = useState<ConnState>("loading");
  const [error, setError] = useState<string | null>(null);

  const offsetsRef = useRef<Offsets>({});
  const trackedRef = useRef<Map<string, Tracked>>(new Map());
  const firstReadRef = useRef(true);
  const newestRef = useRef<number>(0);
  // Wall-clock time of the last poll that returned at least one row.
  // Used to decide RTI offline via browser time — avoids server clock skew.
  const lastFreshRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      let rows: TrackRow[];
      try {
        const result = await readNewRecords(offsetsRef.current, firstReadRef.current);
        if (cancelled) return;
        offsetsRef.current = result.offsets;
        firstReadRef.current = false;
        rows = result.rows;
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error("[useEntityTrackStream] stream read failed:", err);
        setError(message);
        setConnState("offline");
        // Expire by server time even on a failed read — if newestRef is set,
        // it hasn't advanced, so entities that are ENTITY_MAX_AGE_MS old
        // relative to the last good tick get dropped.
        if (newestRef.current > 0) {
          const threshold = newestRef.current - ENTITY_MAX_AGE_MS;
          for (const [key, value] of trackedRef.current) {
            if (value.lastSeenAt < threshold) trackedRef.current.delete(key);
          }
        }
        setEntities(drawableEntities(trackedRef.current));
        return;
      }

      const tracked = trackedRef.current;
      let federation: string | null = null;

      for (const row of rows) {
        const key = row.entity_id ?? row.unique_id;
        if (!key) continue;
        const existing = tracked.get(String(key));
        // An unusable timestamp falls back to what we already held, or to the
        // server-time high-water mark for an entity we have not seen before.
        // Never Date.now(): every comparison below is server-time against
        // server-time, and mixing in the browser clock would reintroduce skew.
        const lastSeenAt = rowObservedAt(row) ?? existing?.lastSeenAt ?? newestRef.current;
        // Strictly older only. Every row in a publish batch shares one
        // observed_at, so `<` lets the whole batch through while still
        // discarding an older batch arriving late from another partition.
        if (existing && lastSeenAt < existing.lastSeenAt) continue;
        const entity = mergeRow(existing?.entity, row);
        if (!entity) continue;
        tracked.set(entity.id, { entity, lastSeenAt });
        if (row.federation) federation = row.federation;
      }

      // Update the running high-water mark of server timestamps.
      let newest = 0;
      for (const value of tracked.values()) {
        if (value.lastSeenAt > newest) newest = value.lastSeenAt;
      }
      if (newest > newestRef.current) newestRef.current = newest;

      // Use the all-time high-water mark for eviction, NOT just this tick's
      // newest. When rows.length === 0 (feed stopped), newest === 0 and
      // guards like `if (newest > 0)` would skip eviction entirely — leaving
      // stale entities on the map forever.
      const evictNewest = newestRef.current;

      // Age out anything the streamer has stopped publishing. Both rules —
      // the relative TTL and the absolute backstop — are in isExpired; both
      // compare server timestamps, so browser clock skew is irrelevant.
      for (const [key, value] of tracked) {
        if (isExpired(value.lastSeenAt, evictNewest)) tracked.delete(key);
      }

      if (cancelled) return;

      const live = drawableEntities(tracked);
      setEntities(live);

      const fresh = rows.length > 0;
      if (fresh) lastFreshRef.current = Date.now();

      const rti = Date.now() - lastFreshRef.current < RTI_OFFLINE_TIMEOUT_MS;

      setStatus((prev) => ({
        connected: rti,
        federationName: federation ?? prev?.federationName ?? "",
        simTime: 0,
        entityCount: live.length,
      }));
      setConnState("online");

      // Clear the map as soon as we decide the RTI is offline.
      if (!rti) {
        trackedRef.current.clear();
        setEntities([]);
      }
    }

    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { entities, status, connState, error };
}

export default useEntityTrackStream;
