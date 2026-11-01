// ── analysisScreen/components/TopBar.tsx ───────────────────────────────────
// Title, run picker and run metadata.
import type { FC } from "react";
import type { RunSummary } from "../types";
import { UI, formatDateTime, formatDuration } from "./ui";

interface Props {
  runs: RunSummary[];
  selectedRun: RunSummary | null;
  loadingRuns: boolean;
  onSelectRun: (runId: string) => void;
  onRefresh: () => void;
  /**
   * Mock-demo state, when this app owns it.
   *
   * Only passed when there is no Workshop to take the setting from — see
   * shared/hooks/useMockDemo. Embedded in Workshop the module owns it and no
   * toggle is offered, so that the two widgets cannot be put into different
   * modes from inside one of them.
   */
  mockDemo?: boolean;
  onToggleMockDemo?: (value: boolean) => void;
  /**
   * Which view is showing, when there is more than one.
   *
   * Only passed when a debrief exists to switch to — a run with no event log
   * has nothing to put on a second tab, and an empty tab is worse than no tab.
   */
  view?: AnalysisView;
  onViewChange?: (view: AnalysisView) => void;
  /**
   * The phase the run is measured against. Omit to hide the selector (the
   * mock run carries its own plan).
   */
  phases?: { id: string; name: string }[];
  selectedPhaseId?: string | null;
  onSelectPhase?: (phaseId: string) => void;
}

export type AnalysisView = "map" | "debrief";

const VIEWS: { id: AnalysisView; label: string }[] = [
  { id: "map", label: "MAP" },
  { id: "debrief", label: "DEBRIEF" },
];

const TopBar: FC<Props> = ({
  runs,
  selectedRun,
  loadingRuns,
  onSelectRun,
  onRefresh,
  mockDemo,
  onToggleMockDemo,
  view,
  onViewChange,
  phases,
  selectedPhaseId,
  onSelectPhase,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 16,
      background: UI.bg1,
      borderBottom: `1px solid ${UI.border}`,
      padding: "0 14px",
      height: 46,
      flexShrink: 0,
      fontFamily: UI.fontSans,
    }}
  >
    <div
      style={{
        fontFamily: UI.fontMono,
        fontSize: 13,
        color: UI.accent,
        letterSpacing: 2,
        fontWeight: 700,
      }}
    >
      ANALYSIS
    </div>
    <div style={{ fontFamily: UI.fontMono, fontSize: 10, color: UI.textFaint }}>
      HLA ENTITY TRACKS · AFTER-ACTION REVIEW
    </div>

    {onViewChange && view && (
      <div style={{ display: "flex", marginLeft: 4 }}>
        {VIEWS.map((option) => {
          const active = view === option.id;
          return (
            <button
              key={option.id}
              onClick={() => onViewChange(option.id)}
              style={{
                background: active ? UI.bg2 : "transparent",
                color: active ? UI.accent : UI.textDim,
                border: `1px solid ${active ? UI.accent : UI.border}`,
                borderRightWidth: option.id === "map" ? 0 : 1,
                fontFamily: UI.fontMono,
                fontSize: 10,
                padding: "4px 12px",
                cursor: "pointer",
                letterSpacing: 1,
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    )}

    <div style={{ flex: 1 }} />

    {/* Standalone only. In Workshop the module's variable governs, and a
        second control here could disagree with the HLA map next to it. */}
    {onToggleMockDemo && (
      <button
        onClick={() => onToggleMockDemo(!mockDemo)}
        title={
          mockDemo
            ? "Replaying the synthetic OP-BALTIC-SHIELD run. Click to read the HLA tracks dataset instead."
            : "Reading the HLA tracks dataset. Click to replay the synthetic OP-BALTIC-SHIELD run instead."
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: mockDemo ? `${UI.amber}22` : UI.bg2,
          color: mockDemo ? UI.amber : UI.textDim,
          border: `1px solid ${mockDemo ? UI.amber : UI.border}`,
          fontFamily: UI.fontMono,
          fontSize: 10,
          padding: "4px 9px",
          cursor: "pointer",
          letterSpacing: 0.5,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: mockDemo ? UI.amber : UI.textFaint,
          }}
        />
        {mockDemo ? "DEMO MODE" : "LIVE DATA"}
      </button>
    )}

    {selectedRun && (
      <div style={{ fontFamily: UI.fontMono, fontSize: 10, color: UI.textDim }}>
        {formatDateTime(selectedRun.startS)} ·{" "}
        {formatDuration(selectedRun.endS - selectedRun.startS)}
      </div>
    )}

    {phases && onSelectPhase && (
      <label
        style={{
          fontFamily: UI.fontMono,
          fontSize: 10,
          color: UI.textFaint,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
        title="The phase whose plan this run is measured against"
      >
        PLAN
        <select
          value={selectedPhaseId ?? ""}
          disabled={phases.length === 0}
          onChange={(e) => onSelectPhase(e.target.value)}
          style={{
            background: UI.bg2,
            color: UI.text,
            border: `1px solid ${UI.border}`,
            fontFamily: UI.fontMono,
            fontSize: 11,
            padding: "4px 6px",
            minWidth: 180,
          }}
        >
          {phases.length === 0 && <option value="">no phases</option>}
          {phases.map((phase) => (
            <option key={phase.id} value={phase.id}>
              {phase.name}
            </option>
          ))}
        </select>
      </label>
    )}

    <label
      style={{
        fontFamily: UI.fontMono,
        fontSize: 10,
        color: UI.textFaint,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      RUN
      <select
        value={selectedRun?.id ?? ""}
        disabled={loadingRuns || runs.length === 0}
        onChange={(e) => onSelectRun(e.target.value)}
        style={{
          background: UI.bg2,
          color: UI.text,
          border: `1px solid ${UI.border}`,
          fontFamily: UI.fontMono,
          fontSize: 11,
          padding: "4px 6px",
          minWidth: 300,
        }}
      >
        {loadingRuns && <option value="">detecting runs…</option>}
        {!loadingRuns && runs.length === 0 && <option value="">no runs found</option>}
        {runs.map((run, index) => (
          <option key={run.id} value={run.id}>
            {index === 0 ? "▸ latest · " : ""}
            {formatDateTime(run.startS)} · {formatDuration(run.endS - run.startS)} ·{" "}
            {run.activeMinutes} min active
          </option>
        ))}
      </select>
    </label>

    <button
      onClick={onRefresh}
      disabled={loadingRuns}
      style={{
        background: UI.bg2,
        color: UI.textDim,
        border: `1px solid ${UI.border}`,
        fontFamily: UI.fontMono,
        fontSize: 10,
        padding: "5px 9px",
        cursor: loadingRuns ? "default" : "pointer",
        letterSpacing: 0.5,
      }}
    >
      REFRESH
    </button>
  </div>
);

export default TopBar;
