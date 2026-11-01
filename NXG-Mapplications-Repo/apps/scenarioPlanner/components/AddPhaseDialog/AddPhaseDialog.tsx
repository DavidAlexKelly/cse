// src/apps/scenarioPlanner/components/AddPhaseDialog/AddPhaseDialog.tsx
//
// Simple modal dialog for creating a new phase. Collects name, based-on
// phase, and duration. On submit the phase is created with its start state
// inherited from the selected base phase's end state.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Phase } from "../../shared/types";

export interface AddPhaseResult {
  name: string;
  basedOnPhaseId: string;
  durationHours: number;
}

interface Props {
  isOpen: boolean;
  phases: Phase[];
  /** Map of basedOnPhaseId → Phase[] for detecting existing branches. */
  branchesBySource?: Record<string, Phase[]>;
  /** Pre-select a base phase (e.g. the currently selected phase). */
  defaultBasedOnPhaseId?: string;
  onSubmit: (result: AddPhaseResult) => void;
  onClose: () => void;
}

export function AddPhaseDialog({
  isOpen,
  phases,
  branchesBySource = {},
  defaultBasedOnPhaseId,
  onSubmit,
  onClose,
}: Props) {
  const [name, setName] = useState("");
  const [basedOn, setBasedOn] = useState(defaultBasedOnPhaseId ?? phases[phases.length - 1]?.id ?? "");
  const [duration, setDuration] = useState(72);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName(`Phase ${phases.length + 1} — `);
      setBasedOn(defaultBasedOnPhaseId ?? phases[phases.length - 1]?.id ?? "");
      setDuration(72);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, phases.length, defaultBasedOnPhaseId]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !basedOn) return;
      onSubmit({ name: name.trim(), basedOnPhaseId: basedOn, durationHours: duration });
    },
    [name, basedOn, duration, onSubmit],
  );

  if (!isOpen) return null;

  return (
    <div className="sp-dialog-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add new phase">
      <div className="sp-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sp-dialog__header">
          <h2 className="sp-dialog__title">Add New Phase</h2>
          <button className="sp-dialog__close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={handleSubmit} className="sp-dialog__body">
          <label className="sp-dialog__field">
            <span className="sp-dialog__label">Phase Name</span>
            <input
              ref={inputRef}
              type="text"
              className="sp-dialog__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Phase 5 — Consolidation"
              maxLength={120}
              required
            />
          </label>

          <label className="sp-dialog__field">
            <span className="sp-dialog__label">Based on Phase</span>
            <select
              className="sp-dialog__select"
              value={basedOn}
              onChange={(e) => setBasedOn(e.target.value)}
              required
            >
              {phases.map((p, i) => (
                <option key={p.id} value={p.id}>
                  PH-{String(i + 1).padStart(2, "0")}: {p.name}
                </option>
              ))}
            </select>
            <span className="sp-dialog__hint">
              The new phase inherits its start state (units &amp; positions) from the end state of this phase.
              {basedOn && (branchesBySource[basedOn]?.length ?? 0) > 0 && (
                <> This creates another branch alternative (⑂ {(branchesBySource[basedOn]?.length ?? 0) + 1} total).</>
              )}
            </span>
          </label>

          <label className="sp-dialog__field">
            <span className="sp-dialog__label">Duration (hours)</span>
            <input
              type="number"
              className="sp-dialog__input"
              value={duration}
              onChange={(e) => setDuration(Math.max(1, parseInt(e.target.value) || 1))}
              min={1}
              step={1}
            />
            <span className="sp-dialog__hint">
              How many simulated hours this phase covers. Used for order feasibility checks.
            </span>
          </label>

          <div className="sp-dialog__actions">
            <button type="button" className="sp-btn--outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="sp-btn--primary" disabled={!name.trim() || !basedOn}>
              Create Phase
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
