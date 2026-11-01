// ── hlamap/components/EventLog.tsx ────────────────────────────────────────

import type { FC } from "react";
import type { LogEntry } from "../types";
import { UI } from "./ui";

const COLOR: Record<LogEntry["level"], string> = {
  info: UI.textDim,
  success: UI.green,
  error: UI.red,
};

const EventLog: FC<{ entries: LogEntry[] }> = ({ entries }) => (
  <div
    style={{
      height: 130,
      borderTop: `1px solid ${UI.border}`,
      background: UI.bg1,
      overflowY: "auto",
      fontFamily: UI.fontMono,
      fontSize: 11,
      padding: "6px 10px",
      display: "flex",
      flexDirection: "column-reverse",
      flexShrink: 0,
    }}
  >
    {entries.length === 0 && <div style={{ color: UI.textFaint }}>No commands issued yet.</div>}
    {[...entries].reverse().map((entry) => (
      <div key={entry.id} style={{ color: COLOR[entry.level], padding: "1px 0" }}>
        <span style={{ color: UI.textFaint }}>{entry.time}</span>{"  "}
        {entry.message}
      </div>
    ))}
  </div>
);

export default EventLog;
