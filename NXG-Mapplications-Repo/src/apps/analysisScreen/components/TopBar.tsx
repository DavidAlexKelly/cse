// ── analysisScreen/components/TopBar.tsx ───────────────────────────────────
// Title, run picker and run metadata.
import type { FC } from "react";
import { AppSwitcher } from "@/components/AppSwitcher";
import "@/shared/hla/console.css";
import type { RunSummary } from "../types";
import { formatDateTime, formatDuration } from "./ui";

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
  /** The exercise, shown as the screen title (as on Execute). */
  title?: string;
}

export type AnalysisView = "map" | "debrief";

const VIEWS: { id: AnalysisView; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "debrief", label: "Debrief" },
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
  title,
}) => (
  <>
    <header className="hc-header">
      <div className="hc-heading">
        <div className="hc-eyebrow">ANALYSE</div>
        <div className="hc-title" title={title}>
          {title ?? "After-action review"}
        </div>
      </div>

      {onViewChange && view && (
        <div className="hc-seg" role="group" aria-label="View">
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={view === option.id}
              onClick={() => onViewChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {phases && onSelectPhase && (
        <label className="hc-field" title="The phase whose plan this run is measured against">
          <span>Plan</span>
          <select
            value={selectedPhaseId ?? ""}
            disabled={phases.length === 0}
            onChange={(e) => onSelectPhase(e.target.value)}
          >
            {phases.length === 0 && <option value="">No phases</option>}
            {phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="hc-field">
        <span>Run</span>
        <select
          value={selectedRun?.id ?? ""}
          disabled={loadingRuns || runs.length === 0}
          onChange={(e) => onSelectRun(e.target.value)}
          style={{ minWidth: 260 }}
        >
          {loadingRuns && <option value="">Detecting runs…</option>}
          {!loadingRuns && runs.length === 0 && <option value="">No runs found</option>}
          {runs.map((run, index) => (
            <option key={run.id} value={run.id}>
              {index === 0 ? "Latest · " : ""}
              {formatDateTime(run.startS)} · {formatDuration(run.endS - run.startS)} ·{" "}
              {run.activeMinutes} min active
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="mil-btn mil-btn--sm mil-btn--ghost"
        onClick={onRefresh}
        disabled={loadingRuns}
        title="Look for new runs in the track dataset"
      >
        Refresh
      </button>

      <span className="hc-spacer" />

      {/* Standalone only. In Workshop the module's variable governs, and a
          second control here could disagree with the HLA map next to it. */}
      {onToggleMockDemo ? (
        <label
          className="hc-demo-toggle"
          title="Replay the synthetic OP-BALTIC-SHIELD run instead of the HLA tracks dataset"
        >
          <input
            type="checkbox"
            checked={!!mockDemo}
            onChange={(e) => onToggleMockDemo(e.target.checked)}
          />
          Demo mode
        </label>
      ) : (
        mockDemo && <span className="hc-demo-badge">DEMO MODE</span>
      )}
      <AppSwitcher />
    </header>
    {mockDemo && (
      <div className="hc-banner" role="status">
        Demo mode — replaying a synthetic run of Operation BALTIC SHIELD against its Phase 1 plan.
        {selectedRun
          ? ` Run length ${formatDuration(selectedRun.endS - selectedRun.startS)}.`
          : ""}
      </div>
    )}
  </>
);

export default TopBar;
