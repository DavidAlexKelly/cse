// ── bgws/hooks/useStreamTail.ts ────────────────────────────────────────────
// Tail a Foundry stream: every poll, hand the caller whatever rows arrived
// since the last one.
//
// The same offset discipline as hlamap's useEntityTrackStream, which this is
// modelled on: a stream is an append-only log, so the first read starts a
// little way back from the end (so the screen fills at once without replaying
// the whole exercise) and later reads go forward from the offsets held, per
// partition. What is different is what the rows are for — events and command
// outcomes are accumulated by the caller rather than merged into entity
// state — so the reading is factored out here and the folding left to the
// caller.
//
// An empty RID means "not configured": the hook does nothing and says so,
// which is how the HLA Events stream is handled until it exists.

import { useEffect, useRef, useState } from "react";
import { Streams } from "@osdk/foundry.streams";
import { client } from "@/client";

type Offsets = Record<string, string>;

export interface StreamTailOptions {
  rid: string;
  branch?: string;
  /** Off in mock mode, so the real stream is not polled for nothing. */
  enabled: boolean;
  intervalMs?: number;
  /** Records per partition to read back on the first poll. */
  lookback?: number;
  /** Records per partition per poll. */
  limit?: number;
}

export type TailState = "unconfigured" | "disabled" | "connecting" | "online" | "error";

export interface StreamTail {
  state: TailState;
  error: string | null;
}

/**
 * Poll `rid` and call `onRows` with each batch of new rows. `onRows` is read
 * through a ref, so it can be an inline closure without restarting the poll.
 */
export function useStreamTail<T>(options: StreamTailOptions, onRows: (rows: T[]) => void): StreamTail {
  const { rid, branch = "master", enabled, intervalMs = 1000, lookback = 500, limit = 500 } = options;
  const [state, setState] = useState<TailState>(rid ? "connecting" : "unconfigured");
  const [error, setError] = useState<string | null>(null);
  const onRowsRef = useRef(onRows);
  onRowsRef.current = onRows;

  useEffect(() => {
    if (!rid) {
      setState("unconfigured");
      return;
    }
    if (!enabled) {
      setState("disabled");
      return;
    }
    let cancelled = false;
    let offsets: Offsets = {};
    let first = true;
    let busy = false;
    setState("connecting");

    async function poll() {
      // A slow read must not overlap the next one: both would start from the
      // same offsets and deliver the same rows twice.
      if (busy) return;
      busy = true;
      try {
        const end = (await Streams.getEndOffsets(client, rid, branch, { preview: true })) as Record<string, string>;
        const next: Offsets = { ...offsets };
        const rows: T[] = [];
        await Promise.all(
          Object.entries(end).map(async ([partitionId, endOffset]) => {
            let start = next[partitionId];
            if (start === undefined) {
              const e = BigInt(endOffset);
              const back = BigInt(lookback);
              start = String(first ? (e > back ? e - back : 0n) : e);
            }
            if (BigInt(start) >= BigInt(endOffset)) {
              next[partitionId] = start;
              return;
            }
            const records = await Streams.getRecords(client, rid, branch, {
              partitionId: partitionId as never,
              startOffset: start,
              limit,
              preview: true,
            });
            if (!Array.isArray(records)) return;
            for (const record of records) {
              rows.push(record.value as T);
              const after = String(BigInt(record.offset) + 1n);
              if (!next[partitionId] || BigInt(after) > BigInt(next[partitionId])) next[partitionId] = after;
            }
          }),
        );
        if (cancelled) return;
        offsets = next;
        first = false;
        setError(null);
        setState("online");
        if (rows.length > 0) onRowsRef.current(rows);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[useStreamTail] ${rid}:`, err);
        setError(message);
        setState("error");
      } finally {
        busy = false;
      }
    }

    void poll();
    const id = window.setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [rid, branch, enabled, intervalMs, lookback, limit]);

  return { state, error };
}
