// PhaseSwitcher.tsx — skeleton
//
// Compact chip-row above the map that lets the user flip between phases of
// the current operation.  Each chip corresponds to one phase-origin
// HierarchyTemplate tagged with the widget's current `operationKey`.
//
// Clicking a chip fires `onSelectPhase(phaseTemplateId)` — the parent App is
// responsible for swapping `mapPositions` (and, later, per-edge relationship
// types) to that phase's saved values.
//
// Structure (units, hierarchy) is stable across phases of the same
// operation, so this component only needs to signal "switch phases"; it
// never touches the unit tree itself.
//
// TODO(phase-switcher):
//   - Add keyboard shortcuts (← / →)
//   - Add optional autoplay (▶ animate through phases with N-second dwell)
//   - Add a rename/reorder affordance
//   - Handle the "no phases" empty state more gracefully than the current
//     "return null"
//   - Consider a mini timeline visualisation (D-day offset marks etc.)
//     once phase metadata carries timing info.

import type React from "react";
import { C } from "./shared/milStyles";

export interface PhaseSwitcherItem {
  /** HierarchyTemplate.id — the stable id we call back with. */
  id: string;
  /** Human-readable label — falls back to "Phase N" in the caller. */
  label: string;
  /** Sort key — payload's phaseIndex, or ingestion order. */
  phaseIndex: number;
  /** Optional description for a tooltip / hover-card. */
  description?: string;
}

interface Props {
  /** All phase-origin templates that belong to the currently-selected operation, sorted by phaseIndex. */
  phases: PhaseSwitcherItem[];
  /** Currently-selected phase id, or null if none. */
  selectedPhaseId: string | null;
  /** Fired when the user clicks a chip or uses the arrow buttons. */
  onSelectPhase: (phaseId: string) => void;
  /** The operationKey these phases belong to — shown as a label prefix. */
  operationKey?: string;
}

export function PhaseSwitcher({ phases, selectedPhaseId, onSelectPhase, operationKey }: Props) {
  if (phases.length === 0) return null;

  const currentIdx = phases.findIndex((p) => p.id === selectedPhaseId);
  const goPrev = () => {
    const idx = currentIdx <= 0 ? phases.length - 1 : currentIdx - 1;
    onSelectPhase(phases[idx].id);
  };
  const goNext = () => {
    const idx = currentIdx < 0 || currentIdx >= phases.length - 1 ? 0 : currentIdx + 1;
    onSelectPhase(phases[idx].id);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        fontSize: 11,
        fontFamily: "IBM Plex Mono, monospace",
        color: C.text2,
        userSelect: "none",
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: C.text2, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {operationKey ? `${operationKey} · ` : ""}Phases
      </span>

      <button
        onClick={goPrev}
        disabled={phases.length < 2}
        style={chipButtonStyle(false)}
        title="Previous phase (←)"
      >
        ◀
      </button>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {phases.map((p, i) => {
          const selected = p.id === selectedPhaseId;
          return (
            <button
              key={p.id}
              onClick={() => onSelectPhase(p.id)}
              title={p.description || p.label}
              style={chipButtonStyle(selected)}
            >
              <span style={{ opacity: 0.6, marginRight: 4 }}>{i + 1}</span>
              {p.label}
            </button>
          );
        })}
      </div>

      <button
        onClick={goNext}
        disabled={phases.length < 2}
        style={chipButtonStyle(false)}
        title="Next phase (→)"
      >
        ▶
      </button>

      <span style={{ marginLeft: "auto", color: C.text2, opacity: 0.6 }}>
        {currentIdx >= 0 ? `${currentIdx + 1} / ${phases.length}` : `— / ${phases.length}`}
      </span>
    </div>
  );
}

function chipButtonStyle(selected: boolean): React.CSSProperties {
  return {
    background: selected ? C.cyan : C.bg,
    color: selected ? "#fff" : C.text2,
    border: `1px solid ${selected ? C.cyan : C.border}`,
    padding: "3px 8px",
    borderRadius: 3,
    fontSize: 11,
    fontFamily: "IBM Plex Mono, monospace",
    cursor: "pointer",
    lineHeight: 1.4,
  };
}
