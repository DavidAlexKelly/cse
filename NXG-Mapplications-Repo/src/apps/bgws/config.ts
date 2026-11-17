// ── bgws/config.ts ─────────────────────────────────────────────────────────
// Where the BGWS screen reads from. Each can be overridden by a Vite env
// variable at build time; the events stream can also be set per widget from
// Workshop (bgwsConfig.ts → eventStreamRid), which wins.

/**
 * "HLA Events" — published by the streamer's events.py. NOT CREATED YET at the
 * time of writing, so empty by default: the screen then says "event stream not
 * configured" instead of polling a RID that does not exist. Federate status
 * (state, sim time, speed) also arrives on this stream, so until it is set the
 * control bar can send commands but cannot show BGWS's answers.
 */
export const BGWS_EVENTS_STREAM_RID: string =
  (import.meta.env.VITE_HLA_EVENTS_STREAM_RID as string | undefined)?.trim() || "";

/** "Command Stream Output" — one outcome row per command stage, keyed by command_id. */
export const COMMAND_OUTPUT_STREAM_RID: string =
  (import.meta.env.VITE_HLA_COMMAND_OUTPUT_RID as string | undefined)?.trim() ||
  "ri.foundry.main.dataset.28808101-229f-4424-8769-35c7d5a6e908";
