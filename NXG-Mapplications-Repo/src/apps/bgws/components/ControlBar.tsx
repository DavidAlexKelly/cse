// ── bgws/components/ControlBar.tsx ─────────────────────────────────────────
// Load the scenario into BGWS and drive its clock, and show what BGWS says
// back.
//
// Two sources of truth, shown side by side because they answer different
// questions:
//   * the command's progression on the Command Stream Output — did Foundry
//     get it onto the HLA wire? (queued → sent, or refused/expired/failed)
//   * BGWS's federate.status events — what did BGWS do about it? (loading,
//     building_terrain, ready, running, …) matched to our command by
//     requestId = command_id.
// Buttons follow the known federate state where there is one, and are all
// enabled when the state is unknown (no event stream) — the command can
// still be sent, we just cannot see the answer.

import { type FC, useEffect, useState } from "react";
import type { ControlCommand, FederateStatus, IssuedCommand, OutcomeSummary } from "../types";
import { estimateSimTime, formatSimTime } from "../lib/events";
import { SPEED_LIMITS } from "../lib/control";
import OutcomeTrail from "./OutcomeTrail";
import { chip, federateStateColour, UI } from "./styles";

export interface ControlEntry {
  command: IssuedCommand;
  summary: OutcomeSummary | null;
  /** BGWS's latest federate.status answering this command. */
  reply: FederateStatus | null;
}

interface Props {
  federate: string;
  onFederate: (federate: string) => void;
  /** Federates heard from, for the picker. */
  federates: string[];
  /** Latest status per federate the selection covers. */
  statuses: FederateStatus[];
  eventsConfigured: boolean;
  loadBlockedReason: string | null;
  onLoad: (speed?: number) => void;
  onControl: (command: ControlCommand, speed?: number) => void;
  last: ControlEntry | null;
}

const ALLOWED: Record<Exclude<ControlCommand, "speed">, string[]> = {
  start: ["ready", "paused"],
  pause: ["running"],
  resume: ["paused"],
  stop: ["loading", "building_terrain", "ready", "running", "paused"],
};

const ControlBar: FC<Props> = ({
  federate,
  onFederate,
  federates,
  statuses,
  eventsConfigured,
  loadBlockedReason,
  onLoad,
  onControl,
  last,
}) => {
  const [speed, setSpeed] = useState(1);
  // A 1 s clock so the sim time runs between BGWS's 30 s heartbeats.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // With exactly one federate in view its state decides; otherwise allow all.
  const known = statuses.length === 1 ? String(statuses[0].state) : null;
  const allowed = (cmd: Exclude<ControlCommand, "speed">) => !known || ALLOWED[cmd].includes(known);
  const speedValid = Number.isFinite(speed) && speed >= SPEED_LIMITS.min && speed <= SPEED_LIMITS.max;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 18px",
        borderBottom: `1px solid ${UI.border}`,
        background: UI.bg1,
        fontFamily: UI.fontSans,
        color: UI.text,
        fontSize: 11,
        flexWrap: "wrap",
        flexShrink: 0,
      }}
    >
      <label className="hc-field" title="Which BGWS federate the controls address. Empty addresses every BGWS federate.">
        Federate
        <input
          list="bgws-federates"
          value={federate}
          placeholder="all BGWS federates"
          onChange={(e) => onFederate(e.target.value)}
          style={{
            padding: "5px 8px",
            background: "#0f131b",
            border: `1px solid ${UI.borderStrong}`,
            borderRadius: 4,
            color: UI.text,
            font: `12px ${UI.fontSans}`,
            width: 150,
          }}
        />
        <datalist id="bgws-federates">
          {federates.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>

      <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Scenario control">
        <button
          type="button"
          className="mil-btn mil-btn--sm mil-btn--primary"
          disabled={!!loadBlockedReason}
          title={loadBlockedReason ?? "Send the scenario to BGWS (hla_bgws_load_scenario)"}
          onClick={() => onLoad(speedValid ? speed : undefined)}
        >
          ⇪ Load scenario
        </button>
        <button type="button" className="mil-btn mil-btn--sm mil-btn--default" disabled={!allowed("start")} onClick={() => onControl("start")}>
          ▶ Start
        </button>
        <button type="button" className="mil-btn mil-btn--sm mil-btn--ghost" disabled={!allowed("pause")} onClick={() => onControl("pause")}>
          ❚❚ Pause
        </button>
        <button type="button" className="mil-btn mil-btn--sm mil-btn--ghost" disabled={!allowed("resume")} onClick={() => onControl("resume")}>
          ▶▶ Resume
        </button>
        <button type="button" className="mil-btn mil-btn--sm mil-btn--danger" disabled={!allowed("stop")} onClick={() => onControl("stop")}>
          ■ Stop
        </button>
      </div>

      <label className="hc-field" title="Sim seconds per wall second">
        Speed
        <input
          type="number"
          min={SPEED_LIMITS.min}
          max={SPEED_LIMITS.max}
          step={0.5}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          style={{
            width: 60,
            padding: "5px 6px",
            background: "#0f131b",
            border: `1px solid ${speedValid ? UI.borderStrong : UI.red}`,
            borderRadius: 4,
            color: UI.text,
            font: `12px ${UI.fontMono}`,
          }}
        />
        ×
        <button
          type="button"
          className="mil-btn mil-btn--sm mil-btn--ghost"
          disabled={!speedValid}
          onClick={() => onControl("speed", speed)}
        >
          Set
        </button>
      </label>

      <span className="hc-divider" />

      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
        {!eventsConfigured ? (
          <span style={{ color: UI.amber }}>Event stream not configured — BGWS state unknown.</span>
        ) : statuses.length === 0 ? (
          <span style={{ color: UI.textDim }}>No federate.status from {federate || "any BGWS federate"} yet.</span>
        ) : (
          statuses.map((s) => (
            <span key={s.federate} style={{ display: "inline-flex", gap: 6, alignItems: "center" }} title={s.message}>
              <span className="hc-dot" style={{ background: federateStateColour(String(s.state)) }} />
              <span style={{ fontWeight: 700 }}>{s.federate || "BGWS"}</span>
              <span style={chip(federateStateColour(String(s.state)))}>{String(s.state).replace("_", " ")}</span>
              <span className="hc-mono" title="Sim time (estimated between status reports)">T+{formatSimTime(estimateSimTime(s, now))}</span>
              {s.speed !== undefined && <span className="hc-mono">{s.speed}×</span>}
              {s.units !== undefined && <span className="hc-mono">{s.units} units</span>}
              {s.scenario && <span style={{ color: UI.textDim }}>{s.scenario}</span>}
              {s.message && (
                <span style={{ color: UI.textDim, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.message}
                </span>
              )}
            </span>
          ))
        )}
      </div>

      <span style={{ flex: 1 }} />

      {last && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }} title={last.summary?.detail ?? ""}>
          <span style={{ color: UI.textDim, whiteSpace: "nowrap" }}>{last.command.label}</span>
          <OutcomeTrail
            summary={last.summary}
            error={last.command.error}
            extra={last.reply ? `BGWS: ${String(last.reply.state).replace("_", " ")}` : undefined}
          />
        </div>
      )}
    </div>
  );
};

export default ControlBar;
