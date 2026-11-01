// ── hlamap/components/TopBar.tsx ──────────────────────────────────────────
import type { CSSProperties, FC } from "react";
import { AppSwitcher } from "@/components/AppSwitcher";
import type { BridgeStatusInfo } from "../types";
import { UI } from "./ui";

export type ConnState = "loading" | "online" | "offline";

interface Props {
  connState: ConnState;
  status: BridgeStatusInfo | null;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  /** Demo mode: the federation is simulated in the browser. */
  mockDemo?: boolean;
  /** Present when this app owns the setting (standalone); absent in Workshop. */
  onToggleMockDemo?: (value: boolean) => void;
  /** The next act of the demo; absent in Workshop, where the module's tabs do this. */
  onOpenAnalysis?: () => void;
}

const DOT_COLOR: Record<ConnState, string> = {
  loading: UI.amber,
  online: UI.green,
  offline: UI.red,
};

function btnStyle(color: string): CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${color}66`,
    color,
    fontFamily: UI.fontMono,
    fontSize: 11,
    padding: "4px 10px",
    cursor: "pointer",
    letterSpacing: 1,
  };
}

const TopBar: FC<Props> = ({
  connState,
  status,
  onStart,
  onPause,
  onStop,
  mockDemo = false,
  onToggleMockDemo,
  onOpenAnalysis,
}) => {
  const statusLabel = mockDemo
    ? `simulated federation · ${status?.entityCount ?? 0} entities`
    : connState === "loading"
      ? "connecting…"
      : connState === "offline"
        ? "bridge unreachable"
        : `${status?.connected ? "RTI connected" : "RTI offline"} · ${status?.federationName || "—"} · ${status?.entityCount ?? 0} live entities`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 14px",
        minHeight: 38,
        background: UI.bg1,
        borderBottom: `1px solid ${UI.border}`,
        fontFamily: UI.fontSans,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: UI.accent,
          letterSpacing: 1,
          fontFamily: UI.fontMono,
        }}
      >
        HLA MAP
      </span>

      <div style={{ width: 1, height: 18, background: UI.border }} />

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: DOT_COLOR[connState],
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 11, color: UI.textDim, fontFamily: UI.fontMono }}>
          {statusLabel}
        </span>
      </div>

      <div style={{ width: 1, height: 18, background: UI.border }} />

      <div style={{ display: "flex", gap: 6 }}>
        <button style={btnStyle(UI.green)} onClick={onStart}>
          ▶ Start
        </button>
        <button style={btnStyle(UI.amber)} onClick={onPause}>
          ⏸ Pause
        </button>
        <button style={btnStyle(UI.red)} onClick={onStop}>
          ■ Stop
        </button>
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        {onToggleMockDemo ? (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: UI.textDim,
            }}
            title="Simulate the federation in the browser — no simulator, bridge or RTI needed"
          >
            <input
              type="checkbox"
              checked={mockDemo}
              onChange={(e) => onToggleMockDemo(e.target.checked)}
            />
            Demo mode
          </label>
        ) : null}
        {mockDemo && (
          <span
            style={{
              border: `1px solid ${UI.amber}`,
              color: UI.amber,
              fontFamily: UI.fontMono,
              fontSize: 10,
              letterSpacing: 1,
              padding: "2px 8px",
            }}
          >
            ● DEMO — SIMULATED
          </span>
        )}
        {onOpenAnalysis && (
          <button
            type="button"
            style={btnStyle(UI.accent)}
            onClick={onOpenAnalysis}
            title="Replay the run against the phase plan and debrief it"
          >
            Analyse run →
          </button>
        )}
        <AppSwitcher />
      </div>
    </div>
  );
};

export default TopBar;
