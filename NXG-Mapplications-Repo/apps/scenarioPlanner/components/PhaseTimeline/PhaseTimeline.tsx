// src/apps/scenarioPlanner/components/PhaseTimeline/PhaseTimeline.tsx
// Horizontally-scrollable phase timeline strip shown at the bottom of the map.
// Simple linear strip — the branching graph lives in PhaseGraphHome.

import type { KeyboardEvent } from "react";
import type { Phase } from "../../shared/types";
import { getPhaseColourById } from "../../shared/phaseColours";
import { formatPhaseWindow } from "../../shared/timeScale";

interface Props {
  phases: Phase[];
  selectedPhaseId: string | null;
  /** Kept for API compat — not used in the linear strip. */
  branchesBySource: Record<string, Phase[]>;
  onSelectPhase: (id: string) => void;
  onAddPhase: () => void;
  readOnly?: boolean;
}

export function PhaseTimeline({
  phases,
  selectedPhaseId,
  onSelectPhase,
  onAddPhase,
  readOnly,
}: Props) {
  return (
    <div className="sp-timeline" role="region" aria-label="Phase timeline">
      <div className="sp-timeline__track" role="list">
        {phases.map((phase, idx) => {
          const colour = getPhaseColourById(phase.id, phases);
          const isSelected = phase.id === selectedPhaseId;
          const label = `${idx + 1}/${phases.length}`;

          function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectPhase(phase.id);
            }
          }

          return (
            <div
              key={phase.id}
              role="listitem"
              tabIndex={0}
              className={`sp-timeline__phase${isSelected ? " sp-timeline__phase--selected" : ""}`}
              onClick={() => onSelectPhase(phase.id)}
              onKeyDown={handleKeyDown}
              aria-selected={isSelected}
              aria-label={phase.name}
            >
              <div
                className="sp-timeline__phase-bar"
                style={{ backgroundColor: colour }}
                aria-hidden="true"
              />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="sp-timeline__phase-id" style={{ color: colour }}>
                  {label}
                </span>
                <span className={`sp-badge ${phase.status === "APPROVED" ? "sp-badge--approved" : phase.status === "REVIEW" ? "sp-badge--review" : "sp-badge--draft"}`}>
                  {phase.status}
                </span>
              </div>
              <div className="sp-timeline__phase-name">{phase.name}</div>
              <div className="sp-timeline__phase-meta">
                {/* D+n or H+n depending on the scenario — see formatPhaseWindow. */}
                {formatPhaseWindow(phase)}
                {phase.unitIds.length > 0 && <> · {phase.unitIds.length}u</>}
              </div>
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <button
          className="sp-timeline__add"
          onClick={onAddPhase}
          aria-label="Add new phase"
          title="Add new phase"
        >
          +
        </button>
      )}
    </div>
  );
}
