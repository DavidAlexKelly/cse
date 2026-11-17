// ── bgws/components/TopBar.tsx ─────────────────────────────────────────────
// The screen header in the shared console pattern (shared/hla/console.css):
// eyebrow + title, the Build | Live switch, the data feeds' health, demo mode
// and the app switcher.

import type { FC } from "react";
import { AppSwitcher } from "@/components/AppSwitcher";
import "@/shared/hla/console.css";
import type { ScreenMode } from "../types";
import type { TailState } from "../hooks/useStreamTail";
import { UI } from "./styles";

interface Props {
  mode: ScreenMode;
  onMode: (mode: ScreenMode) => void;
  title: string;
  mockDemo: boolean;
  onToggleMockDemo?: (value: boolean) => void;
  tracks: { online: boolean; count: number; bgws: number };
  events: TailState;
  outcomes: TailState;
}

const FEED: Record<TailState, { label: string; colour: string }> = {
  unconfigured: { label: "not configured", colour: UI.amber },
  disabled: { label: "off", colour: UI.textFaint },
  connecting: { label: "connecting", colour: UI.amber },
  online: { label: "online", colour: UI.green },
  error: { label: "error", colour: UI.red },
};

function Feed({ name, state }: { name: string; state: TailState }) {
  const f = FEED[state];
  return (
    <span className="hc-status" title={`${name} stream: ${f.label}`}>
      <span className="hc-dot" style={{ background: f.colour }} />
      {name}
    </span>
  );
}

const TopBar: FC<Props> = ({ mode, onMode, title, mockDemo, onToggleMockDemo, tracks, events, outcomes }) => (
  <>
    <header className="hc-header">
      <div className="hc-heading">
        <div className="hc-eyebrow">BGWS · WARGAME</div>
        <div className="hc-title" title={title}>
          {title}
        </div>
      </div>

      <div className="hc-seg" role="group" aria-label="Screen">
        <button type="button" aria-pressed={mode === "build"} onClick={() => onMode("build")}>
          Build
        </button>
        <button type="button" aria-pressed={mode === "live"} onClick={() => onMode("live")}>
          Live
        </button>
      </div>

      <span className="hc-divider" />

      <span className="hc-status" title="HLA Entity Tracks stream">
        <span className="hc-dot" style={{ background: tracks.online ? UI.green : UI.red }} />
        Tracks · <span className="hc-mono">{tracks.bgws}</span>&nbsp;BGWS /{" "}
        <span className="hc-mono">{tracks.count}</span>
      </span>
      <Feed name="Events" state={events} />
      <Feed name="Outcomes" state={outcomes} />

      <span className="hc-spacer" />

      {onToggleMockDemo ? (
        <label className="hc-demo-toggle" title="Simulate BGWS, the streams and the functions in the browser">
          <input type="checkbox" checked={mockDemo} onChange={(e) => onToggleMockDemo(e.target.checked)} />
          Demo mode
        </label>
      ) : (
        mockDemo && <span className="hc-demo-badge">DEMO MODE</span>
      )}
      <AppSwitcher />
    </header>
    {mockDemo && (
      <div className="hc-banner" role="status">
        Demo mode — BGWS, the event and outcome streams and the Commander functions are simulated in the
        browser. Nothing is sent to Foundry.
      </div>
    )}
  </>
);

export default TopBar;
