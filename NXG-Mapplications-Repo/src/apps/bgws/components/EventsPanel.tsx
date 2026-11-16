// ── bgws/components/EventsPanel.tsx ────────────────────────────────────────
// BGWS's event log as it arrives on the HLA Events stream, newest first,
// filterable by family (fire, unit, sense, task, …), side, the selected unit
// and free text. Clicking an event selects the unit it names and flies the
// map to where it happened.

import { type FC, useMemo, useState } from "react";
import type { BgwsEventRow } from "../types";
import type { TailState } from "../hooks/useStreamTail";
import { familiesIn, filterEvents, formatSimTime, type EventFilter } from "../lib/events";
import { sideColour } from "../lib/symbols";
import { chip, heading, input, panel, row, section, UI } from "./styles";

interface Props {
  events: BgwsEventRow[];
  state: TailState;
  error: string | null;
  selectedUniqueId: string | null;
  federate: string;
  onEventClick: (event: BgwsEventRow) => void;
}

const MAX_SHOWN = 300;

const EventsPanel: FC<Props> = ({ events, state, error, selectedUniqueId, federate, onEventClick }) => {
  const [families, setFamilies] = useState<string[]>([]);
  const [side, setSide] = useState("all");
  const [onlySelected, setOnlySelected] = useState(false);
  const [text, setText] = useState("");
  const [includeStatus, setIncludeStatus] = useState(false);

  const available = useMemo(() => familiesIn(events), [events]);
  const filter: EventFilter = {
    families,
    side,
    text,
    includeStatus,
    federate,
    unitUniqueId: onlySelected ? selectedUniqueId : null,
  };
  const shown = useMemo(
    () => filterEvents(events, filter).slice(-MAX_SHOWN).reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, families, side, text, includeStatus, federate, onlySelected, selectedUniqueId],
  );

  const toggle = (family: string) =>
    setFamilies((f) => (f.includes(family) ? f.filter((x) => x !== family) : [...f, family]));

  return (
    <div style={panel(330)}>
      <div style={section}>
        <div style={heading}>Events {state === "online" ? `(${events.length})` : ""}</div>
        {state === "unconfigured" ? (
          <div style={{ fontSize: 11, color: UI.amber }}>
            Event stream not configured. Set the HLA Events stream RID (Workshop “HLA Events stream RID”, or
            VITE_HLA_EVENTS_STREAM_RID) to see BGWS events and federate state.
          </div>
        ) : state === "error" ? (
          <div style={{ fontSize: 11, color: UI.red }}>Event stream read failed: {error}</div>
        ) : (
          <>
            <div style={row}>
              <input style={{ ...input, flex: 1, width: "auto" }} placeholder="Search text, unit…" value={text} onChange={(e) => setText(e.target.value)} />
              <select style={{ ...input, width: 80 }} value={side} onChange={(e) => setSide(e.target.value)}>
                <option value="all">all sides</option>
                <option value="blue">blue</option>
                <option value="red">red</option>
                <option value="neutral">neutral</option>
              </select>
            </div>
            <div style={{ ...row, marginTop: 6, gap: 4 }}>
              {available.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggle(f)}
                  style={{ ...chip(UI.blue, families.includes(f)), cursor: "pointer", background: families.includes(f) ? chip(UI.blue).background : "transparent" }}
                >
                  {f}
                </button>
              ))}
              {families.length > 0 && (
                <button type="button" onClick={() => setFamilies([])} style={{ ...chip(UI.textDim, false), cursor: "pointer" }}>
                  clear
                </button>
              )}
            </div>
            <div style={{ ...row, marginTop: 6, fontSize: 10, color: UI.textDim }}>
              <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" checked={onlySelected} disabled={!selectedUniqueId} onChange={(e) => setOnlySelected(e.target.checked)} />
                selected unit only
              </label>
              <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" checked={includeStatus} onChange={(e) => setIncludeStatus(e.target.checked)} />
                federate status
              </label>
            </div>
          </>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {state !== "unconfigured" && shown.length === 0 && (
          <div style={{ ...section, fontSize: 11, color: UI.textFaint, borderBottom: "none" }}>
            {events.length === 0 ? "No events yet." : "No events match the filter."}
          </div>
        )}
        {shown.map((e) => {
          const clickable = !!(e.entity_unique_id || (typeof e.latitude === "number" && typeof e.longitude === "number"));
          return (
            <div
              key={e.event_id}
              onClick={() => clickable && onEventClick(e)}
              style={{
                padding: "5px 12px",
                borderBottom: `1px solid ${UI.border}`,
                borderLeft: `3px solid ${e.side ? sideColour(e.side) : "transparent"}`,
                cursor: clickable ? "pointer" : "default",
                fontSize: 11,
              }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                <span style={{ fontFamily: UI.fontMono, fontSize: 10, color: UI.textFaint }}>{formatSimTime(e.sim_time_s)}</span>
                <span style={{ fontWeight: 700, color: UI.text }}>{e.kind}</span>
                {e.source === "rpr" && <span style={chip(UI.textDim, false)}>rpr</span>}
              </div>
              <div style={{ color: UI.textDim, marginTop: 1 }}>
                {e.text || [e.entity_callsign ?? e.entity_name, e.target_callsign ?? e.target_name].filter(Boolean).join(" → ") || "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EventsPanel;
