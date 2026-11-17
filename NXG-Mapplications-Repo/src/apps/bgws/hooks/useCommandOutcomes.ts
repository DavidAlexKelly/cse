// ── bgws/hooks/useCommandOutcomes.ts ───────────────────────────────────────
// The Command Stream Output, as outcome rows grouped by command_id.
//
// Every viewer's commands are on this stream, not just ours; the rows are kept
// whole (bounded) and the caller looks up the ids it issued. Keeping them all
// rather than filtering on arrival matters: an outcome can be read before the
// function call that queued the command has even returned its id.

import { useCallback, useState } from "react";
import type { CommandOutcomeRow } from "../types";
import { useStreamTail, type StreamTail } from "./useStreamTail";

const MAX_ROWS = 5000;

export interface CommandOutcomeStream {
  rows: CommandOutcomeRow[];
  tail: StreamTail;
}

export function useCommandOutcomes(rid: string, enabled: boolean): CommandOutcomeStream {
  const [rows, setRows] = useState<CommandOutcomeRow[]>([]);
  const onRows = useCallback(
    (incoming: CommandOutcomeRow[]) =>
      setRows((held) => {
        const all = [...held, ...incoming.filter((r) => r && r.command_id)];
        return all.length > MAX_ROWS ? all.slice(all.length - MAX_ROWS) : all;
      }),
    [],
  );
  // Fast enough that queued → sent → accepted reads as a progression, with a
  // lookback that covers a few minutes of a busy exercise.
  const tail = useStreamTail<CommandOutcomeRow>({ rid, enabled, intervalMs: 1000, lookback: 1500 }, onRows);
  return { rows, tail };
}
