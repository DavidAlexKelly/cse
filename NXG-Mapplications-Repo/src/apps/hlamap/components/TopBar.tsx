// ── hlamap/components/TopBar.tsx ──────────────────────────────────────────
// The screen header, in the pattern every screen shares (shared/hla/console.css):
// eyebrow + title, the federation's state, simulation controls, demo mode,
// the next act of the demo, and the app switcher.
import type { FC } from "react";
import { AppSwitcher } from "@/components/AppSwitcher";
import "@/shared/hla/console.css";
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
  const entities = status?.entityCount ?? 0;
  const statusLabel = mockDemo
    ? `Simulated federation · ${entities} entities`
    : connState === "loading"
      ? "Connecting…"
      : connState === "offline"
        ? "Bridge unreachable"
        : `${status?.connected ? "RTI connected" : "RTI offline"} · ${status?.federationName || "—"} · ${entities} live entities`;
  const dot = mockDemo ? UI.amber : DOT_COLOR[connState];

  return (
    <>
      <header className="hc-header">
        <div className="hc-heading">
          <div className="hc-eyebrow">LIVE MAP</div>
          <div className="hc-title">HLA federation</div>
        </div>

        <div className="hc-status" role="status">
          <span className="hc-dot" style={{ background: dot }} />
          {statusLabel}
        </div>

        <span className="hc-divider" />

        <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Simulation time">
          <button type="button" className="mil-btn mil-btn--sm mil-btn--default" onClick={onStart}>
            ▶ Start
          </button>
          <button type="button" className="mil-btn mil-btn--sm mil-btn--ghost" onClick={onPause}>
            ❚❚ Pause
          </button>
          <button type="button" className="mil-btn mil-btn--sm mil-btn--danger" onClick={onStop}>
            ■ Stop
          </button>
        </div>

        <span className="hc-spacer" />

        {onToggleMockDemo ? (
          <label
            className="hc-demo-toggle"
            title="Simulate the federation in the browser — no simulator, bridge or RTI needed"
          >
            <input
              type="checkbox"
              checked={mockDemo}
              onChange={(e) => onToggleMockDemo(e.target.checked)}
            />
            Demo mode
          </label>
        ) : (
          mockDemo && <span className="hc-demo-badge">DEMO MODE</span>
        )}
        {onOpenAnalysis && (
          <button
            type="button"
            className="mil-btn mil-btn--sm mil-btn--primary"
            onClick={onOpenAnalysis}
            title="Replay the run against the phase plan and debrief it"
          >
            Analyse run →
          </button>
        )}
        <AppSwitcher />
      </header>
      {mockDemo && (
        <div className="hc-banner" role="status">
          Demo mode — the federation is simulated in the browser from the OP-BALTIC-SHIELD ORBAT.
          Commands act on the simulation, not on a real federate.
        </div>
      )}
    </>
  );
};

export default TopBar;
