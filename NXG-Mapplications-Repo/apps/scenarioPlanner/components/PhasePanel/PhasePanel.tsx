// src/map/ScenarioPlanning/components/PhasePanel/PhasePanel.tsx

import type { KeyboardEvent } from "react";
import type { Phase } from "../../shared/types";
import { getPhaseColour } from "../../shared/phaseColours";
interface Props {
  phases: Phase[];
  selectedPhaseId: string | null;
  /** Map of basedOnPhaseId → Phase[] for detecting branch points. */
  branchesBySource: Record<string, Phase[]>;
  onSelectPhase: (id: string) => void;
  onAddPhase: () => void;
  readOnly?: boolean;
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Phase["status"] }) {
  const cls =
    status === "APPROVED"
      ? "sp-badge--approved"
      : status === "REVIEW"
        ? "sp-badge--review"
        : "sp-badge--draft";
  return <span className={`sp-badge ${cls}`}>{status}</span>;
}

// ── Individual phase card ────────────────────────────────────────────────────

interface CardProps {
  phase: Phase;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
  allPhases: Phase[];
  branchCount: number;
}

function PhaseCard({ phase, index, selected, onSelect, allPhases, branchCount }: CardProps) {
  const colour = getPhaseColour(index);
  const visibleTasks = phase.tasks.slice(0, 2);
  const extraTasks = phase.tasks.length - visibleTasks.length;

  const phaseIdLabel = `PH-${String(index + 1).padStart(2, "0")}`;

  // Resolve dependency labels from IDs
  const depLabels = phase.dependencies.map((depId) => {
    const idx = allPhases.findIndex((p) => p.id === depId);
    return idx >= 0 ? `PH-${String(idx + 1).padStart(2, "0")} PASS` : depId;
  });

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(phase.id);
    }
  }

  return (
    <div
      className={`sp-phase-card${selected ? " sp-phase-card--selected" : ""}`}
      style={{ borderLeftColor: colour }}
      role="button"
      tabIndex={0}
      aria-selected={selected}
      aria-label={`Phase ${phaseIdLabel}: ${phase.name}`}
      onClick={() => onSelect(phase.id)}
      onKeyDown={handleKeyDown}
    >
      <div className="sp-phase-card__inner">
        {/* Top row: ID + status */}
        <div className="sp-phase-card__top-row">
          <span className="sp-phase-card__id">{phaseIdLabel}</span>
          <StatusBadge status={phase.status} />
          {branchCount > 1 && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "#e8a838",
                background: "rgba(232,168,56,0.12)",
                borderRadius: 8,
                padding: "1px 6px",
                letterSpacing: "0.04em",
              }}
              title={`${branchCount} branch alternatives`}
            >
              ⑂ {branchCount}
            </span>
          )}
        </div>

        {/* Phase name */}
        <div className="sp-phase-card__name">{phase.name}</div>

        {/* Time range + unit count */}
        <div className="sp-phase-card__meta">
          <span className="sp-phase-card__time">
            H+{phase.startOffset} → H+{phase.endOffset}
          </span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {phase.unitIds.length > 0
              ? `${phase.unitIds.length} unit${phase.unitIds.length !== 1 ? "s" : ""}`
              : "No units"}
          </span>
        </div>

        {/* Task bullets */}
        {visibleTasks.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              margin: "0 0 5px",
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
            aria-label="Phase tasks"
          >
            {visibleTasks.map((task, i) => (
              <li
                key={i}
                style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", gap: 5 }}
              >
                <span aria-hidden="true" style={{ color: "var(--border-default)" }}>
                  ▸
                </span>
                <span>{task}</span>
              </li>
            ))}
            {extraTasks > 0 && (
              <li style={{ fontSize: 10, color: "var(--accent-primary)" }}>+{extraTasks} more</li>
            )}
          </ul>
        )}

        {/* Dependency tags */}
        {depLabels.length > 0 && (
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}
            aria-label="Dependencies"
          >
            {depLabels.map((label) => (
              <span
                key={label}
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--accent-primary)",
                  background: "rgba(74,124,89,0.1)",
                  border: "1px solid rgba(74,124,89,0.25)",
                  borderRadius: 2,
                  padding: "1px 5px",
                }}
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Collapsible section links ─────────────────────────────────────────────────

interface LinkRowProps {
  icon: string;
  label: string;
  badge: string;
  badgeVariant: "blue" | "green" | "amber";
}

function LinkRow({ icon, label, badge, badgeVariant }: LinkRowProps) {
  const badgeStyle =
    badgeVariant === "amber"
      ? { color: "#e8a838", background: "rgba(232,168,56,0.12)" }
      : { color: "#2fbf71", background: "rgba(74,124,89,0.12)" };

  return (
    <div
      className="sp-phase-panel__link-row"
      role="button"
      tabIndex={0}
      aria-label={`Navigate to ${label}`}
    >
      <div className="sp-phase-panel__link-left">
        <span className="sp-phase-panel__link-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="sp-phase-panel__link-label">{label}</span>
      </div>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.04em",
          borderRadius: 10,
          padding: "1px 7px",
          ...badgeStyle,
        }}
      >
        {badge}
      </span>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

export function PhasePanel({
  phases,
  selectedPhaseId,
  branchesBySource,
  onSelectPhase,
  onAddPhase,
  readOnly,
}: Props) {
  const totalUnits = phases.reduce((acc, p) => acc + p.unitIds.length, 0);

  return (
    <aside className="sp-phase-panel" aria-label="Scenario phases">
      {/* Header */}
      <div className="sp-phase-panel__header">
        <span className="sp-phase-panel__label">Scenario Phases</span>
        <button
          className="sp-phase-panel__add-btn"
          onClick={onAddPhase}
          disabled={readOnly}
          aria-label="Add new phase"
        >
          + Phase
        </button>
      </div>

      {/* Phase cards */}
      <div
        className="sp-phase-panel__list sp-scroll"
        role="list"
        aria-label="Phase list"
      >
        {phases.map((phase, idx) => {
          const siblings = phase.basedOnPhaseId
            ? (branchesBySource[phase.basedOnPhaseId] ?? [])
            : [];
          return (
            <PhaseCard
              key={phase.id}
              phase={phase}
              index={idx}
              selected={phase.id === selectedPhaseId}
              onSelect={onSelectPhase}
              allPhases={phases}
              branchCount={siblings.length}
            />
          );
        })}
      </div>

      {/* Collapsible section links */}
      <div className="sp-phase-panel__links" aria-label="Related sections">
        <LinkRow
          icon="⬡"
          label="ORBAT & Positions"
          badge={String(totalUnits)}
          badgeVariant="blue"
        />
        <LinkRow
          icon="⚡"
          label="MEL / MIL Injects"
          badge="3"
          badgeVariant="amber"
        />
        <LinkRow
          icon="◈"
          label="PMESII Variables"
          badge="Done"
          badgeVariant="green"
        />
        <LinkRow
          icon="🎯"
          label="Training Audience"
          badge="Review"
          badgeVariant="amber"
        />
      </div>
    </aside>
  );
}

