// ── bgws/hooks/useBgwsEvents.ts ────────────────────────────────────────────
// The HLA Events stream, accumulated: every BGWS event (and RPR fire) the
// streamer has published, deduplicated and in stream order, newest 2000 kept.
// Federate status is derived from these rows (lib/events latestStatuses), so
// it needs no stream of its own.

import { useCallback, useState } from "react";
import type { BgwsEventRow } from "../types";
import { mergeEvents } from "../lib/events";
import { useStreamTail, type StreamTail } from "./useStreamTail";

export interface BgwsEventStream {
  events: BgwsEventRow[];
  tail: StreamTail;
}

export function useBgwsEvents(rid: string, enabled: boolean): BgwsEventStream {
  const [events, setEvents] = useState<BgwsEventRow[]>([]);
  const onRows = useCallback((rows: BgwsEventRow[]) => setEvents((held) => mergeEvents(held, rows)), []);
  // Events are bursty (a fire fight is dozens a second) but nobody reads them
  // that fast; 1 s matches the streamer's own poll.
  const tail = useStreamTail<BgwsEventRow>({ rid, enabled, intervalMs: 1000, lookback: 1000 }, onRows);
  return { events, tail };
}
