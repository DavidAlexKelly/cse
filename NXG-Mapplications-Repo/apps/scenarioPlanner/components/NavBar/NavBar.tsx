// src/map/ScenarioPlanning/components/NavBar/NavBar.tsx

import type { Phase, ExerciseMeta } from "../../types";
import { AppSwitcher } from "@/components/AppSwitcher";

interface Props {
  exercise: ExerciseMeta;
  phases: Phase[];
  readOnly?: boolean;
}

export function NavBar({ exercise, phases, readOnly }: Props) {
  const definedCount = phases.length;
  const totalCount = phases.length;
  const nationsStr = exercise.nations.join(" · ");

  return (
    <nav className="sp-nav" aria-label="Scenario planning navigation">
      {/* ── Sub row ── */}
      <div className="sp-nav__sub">
        <div className="sp-nav__sub-left">
          <div className="sp-nav__sub-item">
            <span className="sp-nav__sub-label">Exercise</span>
            <span className="sp-nav__sub-value">{exercise.exerciseName}</span>
          </div>
          <div className="sp-nav__sub-item">
            <span className="sp-nav__sub-label">Phase</span>
            <span className="sp-nav__sub-dot" aria-hidden="true" />
            <span className="sp-nav__sub-value">{exercise.currentPhaseLabel}</span>
          </div>
          <div className="sp-nav__sub-item">
            <span className="sp-nav__sub-label">D</span>
            <span className="sp-nav__sub-value">{exercise.dDayOffset}</span>
          </div>
          <div className="sp-nav__sub-item">
            <span className="sp-nav__sub-label">Nations</span>
            <span className="sp-nav__sub-value">{nationsStr}</span>
          </div>
          <div className="sp-nav__sub-item">
            <span className="sp-nav__sub-label">Phases</span>
            <span className="sp-nav__sub-value">{definedCount}/{totalCount}</span>
          </div>
        </div>
        <div className="sp-nav__sub-right">
          <span className="sp-nav__classification">NATO UNCLASSIFIED</span>
          <button
            className="sp-btn--sm sp-btn--outline"
            disabled={readOnly}
            aria-label="Verify scenario"
          >
            VERIFY
          </button>
          <button
            className="sp-btn--sm sp-btn--primary"
            disabled={readOnly}
            aria-label="Deploy scenario"
          >
            DEPLOY
          </button>
          <AppSwitcher />
        </div>
      </div>
    </nav>
  );
}
