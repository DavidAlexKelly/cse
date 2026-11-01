/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { Icon } from "@blueprintjs/core";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import { useScenarioIdFromObjectSet } from "../shared/hooks/useScenarioIdFromParam.js";
import { ScenarioGate } from "../shared/components/ScenarioGate.js";
import { useNxgScenario } from "../shared/hooks/useNxgScenario.js";
import { useNxgPhases } from "../shared/hooks/useNxgPhases.js";
import { useNxgTasks } from "../shared/hooks/useNxgTasks.js";
import { useNxgTrainingObjectives } from "../shared/hooks/useNxgTrainingObjectives.js";
import "../shared/styling/index.css";
import "./scenarioDashboard.css";
import type ScenarioDashboardConfig from "./scenarioDashboard.config.js";

const useWidgetContext =
  useFoundryWidgetContext.withTypes<typeof ScenarioDashboardConfig>();

// ── Tooltip ────────────────────────────────────────────────────────────────

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> = ({ content, children }) => {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
      }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1a1f36",
            border: "1px solid #2f3860",
            borderRadius: 5,
            padding: "8px 11px",
            fontSize: 11,
            color: "#ccd3ea",
            lineHeight: 1.55,
            whiteSpace: "normal",
            width: 240,
            boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
            zIndex: 100,
            pointerEvents: "none",
          }}
        >
          {content}
          {/* Arrow */}
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: "5px solid #2f3860",
            }}
          />
        </div>
      )}
    </div>
  );
};

// ── Info Popup (anchored next to chip) ────────────────────────────────────

interface InfoPopupProps {
  content: React.ReactNode;
  anchorRect: DOMRect;
  onClose: () => void;
}

const InfoPopup: React.FC<InfoPopupProps> = ({
  content,
  anchorRect,
  onClose,
}) => {
  const popupWidth = 260;
  // Position below the chip, aligned to its left edge, clamped to viewport
  const top = anchorRect.bottom + 8 + window.scrollY;
  const rawLeft = anchorRect.left + window.scrollX;
  const left = Math.min(rawLeft, window.innerWidth - popupWidth - 12);

  return (
    <>
      {/* Invisible backdrop to close on outside click */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 199 }}
        onClick={onClose}
      />
      <div
        style={{
          position: "absolute",
          top,
          left,
          width: popupWidth,
          zIndex: 200,
          background: "#1a1f36",
          border: "1px solid #2f3860",
          borderRadius: 8,
          padding: "14px 16px 14px 14px",
          fontSize: 12,
          color: "#ccd3ea",
          lineHeight: 1.6,
          boxShadow: "0 6px 24px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Arrow pointing up toward the chip */}
        <div
          style={{
            position: "absolute",
            top: -6,
            left: 20,
            width: 10,
            height: 6,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              background: "#1a1f36",
              border: "1px solid #2f3860",
              transform: "rotate(45deg)",
              marginTop: 3,
            }}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            position: "absolute",
            top: 8,
            right: 10,
            background: "none",
            border: "none",
            color: "#6a7292",
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
            padding: 2,
          }}
          aria-label="Close"
        >
          ✕
        </button>
        {content}
      </div>
    </>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case "active":
    case "executing":
    case "ready":
      return "#24b47e";
    case "planning":
    case "in_progress":
    case "in-progress":
      return "#4c7ef3";
    case "complete":
    case "completed":
    case "approved":
      return "#6c5ce7";
    case "needs_review":
    case "review":
      return "#f0a83c";
    default:
      return "#6a7292";
  }
}

function phaseBarColor(pct: number): string {
  if (pct >= 90) return "#24b47e"; // green — fully ready
  if (pct >= 70) return "#4c7ef3"; // blue  — on track
  if (pct >= 50) return "#f0a83c"; // amber — at risk
  return "#ef4d4d"; // red   — behind
}

function taskStatusColor(status: string): string {
  switch (status) {
    case "assigned":
      return "#24b47e";
    case "in-review":
      return "#f0a83c";
    default:
      return "#6a7292";
  }
}

function taskStatusLabel(status: string): string {
  switch (status) {
    case "assigned":
      return "Assigned";
    case "in-review":
      return "In Review";
    default:
      return "Pending";
  }
}

// ── Component ──────────────────────────────────────────────────────────────

const ScenarioDashboardBody: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {
  const { emitEvent } = useWidgetContext();

  const { scenario, loading: scenarioLoading } = useNxgScenario(scenarioId);
  const { phases, loading: phasesLoading } = useNxgPhases(scenarioId);
  const { tasks, loading: tasksLoading } = useNxgTasks(scenarioId);
  // Objective coverage is derived from the progress of each objective's
  // phase, so the task list has to be passed in. Without it every
  // objective reports zero coverage.
  const { objectives } = useNxgTrainingObjectives(scenarioId, tasks);

  // ── Local UI state ──────────────────────────────────────────────────────

  // Track which tasks have been locally "reviewed" (UI-only, no write-back yet)
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [activePopup, setActivePopup] = useState<{
    id: string;
    rect: DOMRect;
  } | null>(null);

  const markReviewed = useCallback((id: string) => {
    setReviewedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // ── Derived counts ──────────────────────────────────────────────────────

  const injectCount = tasks.filter(
    (t) => t.section === "Execution Planning"
  ).length;
  const pendingReview = tasks.filter((t) => t.status === "in-review").length;
  const openTasksCount = tasks.filter((t) => t.status !== "assigned").length;

  // coveragePct is derived from the planning progress of each
  // objective's phase — see shared/metrics/planningMetrics.
  const sortedObjectives = useMemo(
    () => [...objectives].sort((a, b) => b.coveragePct - a.coveragePct),
    [objectives]
  );

  const TASKS_PREVIEW = 4;
  const visibleTasks = showAllTasks ? tasks : tasks.slice(0, TASKS_PREVIEW);

  // ── Planning score ──────────────────────────────────────────────────────
  // Computed as: % of tasks that are "assigned" (fully assigned with owner +
  // approver) across all sections. Falls back to scenario.overallProgressPct
  // when no task data is loaded yet.
  const computedPlanningScore = useMemo(() => {
    if (tasks.length === 0) return scenario?.overallProgressPct ?? 0;
    const assigned = tasks.filter((t) => t.status === "assigned").length;
    return Math.round((assigned / tasks.length) * 100);
  }, [tasks, scenario]);

  // ── Stat chips config ───────────────────────────────────────────────────

  const statChips = [
    {
      icon: "timeline-bar-chart" as const,
      value: scenarioLoading ? "—" : `${scenario?.overallProgressPct ?? 0}%`,
      label: "Planning score",
      color: "#4c7ef3",
      popupId: "planning-score",
      popup: (
        <>
          <strong
            style={{ color: "#f3f5ff", display: "block", marginBottom: 6 }}
          >
            Planning Score
          </strong>
          Percentage of tasks that are fully assigned (have both an owner and an
          approver). A score of 100% means every planning task has been
          allocated to a responsible person.
          <br />
          <br />
          <span style={{ color: "#6a7292" }}>
            Formula: assigned tasks ÷ total tasks × 100
          </span>
        </>
      ),
    },
    {
      icon: "layers" as const,
      value: phasesLoading ? "—" : String(phases.length),
      label: "Phases defined",
      color: "#24b47e",
      popupId: null,
      popup: null,
    },
    {
      icon: "tick-circle" as const,
      value: tasksLoading ? "—" : String(tasks.length),
      label: "Total tasks",
      color: "#6c5ce7",
      popupId: null,
      popup: null,
    },
    {
      icon: "warning-sign" as const,
      value: tasksLoading ? "—" : String(pendingReview),
      label: "Tasks in review",
      color: "#f0a83c",
      popupId: null,
      popup: null,
    },
    {
      icon: "timeline-events" as const,
      value: tasksLoading ? "—" : String(injectCount),
      label: "Execution tasks",
      color: "#8b5cf6",
      popupId: null,
      popup: null,
    },
    {
      icon: "target" as const,
      value: String(objectives.length),
      label: "Training objectives",
      color: "#4c7ef3",
      popupId: null,
      popup: null,
    },
    {
      icon: "shield" as const,
      value: phasesLoading ? "—" : scenario?.currentPhase || "—",
      label: "Current phase",
      color: "#ef4d4d",
      popupId: null,
      popup: null,
    },
    {
      icon: "document" as const,
      value: tasksLoading ? "—" : String(openTasksCount),
      label: "Open tasks",
      color: "#6a7292",
      popupId: null,
      popup: null,
    },
  ];

  // ── Section IDs for phase readiness ────────────────────────────────────

  const sortedPhases = useMemo(
    () => [...phases].sort((a, b) => a.sequenceNumber - b.sequenceNumber),
    [phases]
  );

  return (
    <div className="sdb-root bp5-dark">
      {/* ── Hero Header ── */}
      <div className="sdb-hero">
        <div className="sdb-hero__badges">
          {scenario?.scenarioType && (
            <span className="badge badge--blue">{scenario.scenarioType}</span>
          )}
          {scenario?.classification && (
            <span className="badge badge--grey">{scenario.classification}</span>
          )}
          {scenario?.scenarioStatus && (
            <span
              className="badge"
              style={{
                background: `${statusColor(scenario.scenarioStatus)}20`,
                color: statusColor(scenario.scenarioStatus),
                border: `1px solid ${statusColor(scenario.scenarioStatus)}40`,
              }}
            >
              {scenario.scenarioStatus}
            </span>
          )}
          {scenario?.aiGenerated && (
            <Tooltip
              content={
                <>
                  <strong
                    style={{
                      color: "#f3f5ff",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    AI-Proposed World
                  </strong>
                  The strategic context, OPFOR definitions, and PMESII variables
                  for this scenario were generated with AI assistance. All
                  AI-generated content must be reviewed and approved by a human
                  planner before use in a live exercise.
                </>
              }
            >
              <span className="badge badge--purple" style={{ cursor: "help" }}>
                <Icon icon="lightbulb" size={9} /> AI-proposed world
              </span>
            </Tooltip>
          )}
        </div>

        <div className="sdb-hero__title-row">
          <div className="sdb-hero__title">
            {scenarioLoading
              ? "Loading…"
              : scenario?.scenarioName || "Untitled Scenario"}
          </div>
          <div className="sdb-hero__actions">
            <button
              type="button"
              className="sdb-hero__btn sdb-hero__btn--ghost"
              onClick={() => emitEvent("onViewMap", { parameterUpdates: {} })}
            >
              <Icon icon="map" size={13} /> View map
            </button>
            <button
              type="button"
              className="sdb-hero__btn sdb-hero__btn--primary"
              onClick={() => emitEvent("onViewTasks", { parameterUpdates: {} })}
            >
              <Icon icon="tick-circle" size={13} /> View tasks
            </button>
            <button
              type="button"
              className="sdb-hero__btn sdb-hero__btn--ghost"
              onClick={() => emitEvent("onOpenChatbot", { parameterUpdates: {} })}
              style={{ color: "#c47af5", borderColor: "rgba(196, 122, 245,0.35)" }}
            >
              <Icon icon="chat" size={13} /> AI Assistant
            </button>
          </div>
        </div>

        <div className="sdb-hero__subtitle">
          AI-assisted CAX planning workspace
        </div>

        {/* Progress bar */}
        <div className="sdb-hero__progress-row">
          <div className="sdb-hero__progress-track">
            <div
              className="sdb-hero__progress-fill"
              style={{ width: `${computedPlanningScore}%` }}
            />
          </div>
          <span className="sdb-hero__progress-pct">
            {computedPlanningScore}% planning score
          </span>
        </div>
      </div>

      {/* ── Stat chips ── */}
      <div className="sdb-stats">
        {statChips.map((chip) => (
          <div
            key={chip.label}
            className="sdb-stat"
            onClick={(e) =>
              chip.popupId
                ? setActivePopup({
                    id: chip.popupId,
                    rect: (
                      e.currentTarget as HTMLElement
                    ).getBoundingClientRect(),
                  })
                : undefined
            }
            style={{ cursor: chip.popupId ? "pointer" : "default" }}
          >
            <div
              className="sdb-stat__icon"
              style={{ color: chip.color, background: `${chip.color}15` }}
            >
              <Icon icon={chip.icon} size={14} />
            </div>
            <div className="sdb-stat__body">
              <div className="sdb-stat__value">{chip.value}</div>
              <div className="sdb-stat__label">
                {chip.label}
                {chip.popupId && (
                  <Icon
                    icon="help"
                    size={9}
                    style={{ marginLeft: 3, color: "#2f3860" }}
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Info popup ── */}
      {activePopup &&
        (() => {
          const chip = statChips.find((c) => c.popupId === activePopup.id);
          return chip?.popup ? (
            <InfoPopup
              content={chip.popup}
              anchorRect={activePopup.rect}
              onClose={() => setActivePopup(null)}
            />
          ) : null;
        })()}

      {/* ── Main two-column body ── */}
      <div className="sdb-body">
        {/* ── Left column: tasks + phase readiness + objectives ── */}
        <div className="sdb-main-col">
          {/* Open Tasks */}
          <div className="sdb-section">
            <div className="sdb-section__head">
              <div className="sdb-section__title">
                <Icon icon="tick-circle" size={12} />
                All open tasks
                <span className="sdb-section__count">{openTasksCount}</span>
              </div>
              <button
                type="button"
                className="sdb-link"
                onClick={() =>
                  emitEvent("onViewTasks", { parameterUpdates: {} })
                }
              >
                View all tasks →
              </button>
            </div>

            {tasksLoading ? (
              <div className="sdb-loading">Loading tasks…</div>
            ) : tasks.length === 0 ? (
              <div className="sdb-empty">No tasks found for this scenario.</div>
            ) : (
              <>
                <div className="sdb-task-list">
                  {visibleTasks.map((task) => {
                    const isReviewed = reviewedIds.has(task.id);
                    const isExpanded = expandedTaskId === task.id;
                    const statusCol = taskStatusColor(task.status);
                    const priColor =
                      task.status === "in-review"
                        ? "#f0a83c"
                        : task.status === "assigned"
                        ? "#24b47e"
                        : "#6a7292";
                    return (
                      <div
                        key={task.id}
                        className={`sdb-task${
                          isReviewed ? " sdb-task--reviewed" : ""
                        }`}
                        onClick={() =>
                          setExpandedTaskId(isExpanded ? null : task.id)
                        }
                      >
                        <div className="sdb-task__header">
                          {/* Status circle */}
                          <div className="sdb-task__check">
                            {isReviewed ? (
                              <Icon
                                icon="tick-circle"
                                size={14}
                                color="#24b47e"
                              />
                            ) : (
                              <div
                                className="sdb-task__circle"
                                style={{ borderColor: statusCol }}
                              />
                            )}
                          </div>

                          <div className="sdb-task__body">
                            <div className="sdb-task__title">{task.title}</div>
                            {task.description && (
                              <div className="sdb-task__desc">
                                {task.description}
                              </div>
                            )}
                            <div className="sdb-task__meta">
                              {task.section && (
                                <span className="sdb-task__section">
                                  {task.section}
                                </span>
                              )}
                              {task.due && (
                                <span className="sdb-task__due">
                                  <Icon icon="time" size={9} /> {task.due}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="sdb-task__right">
                            <span
                              className="sdb-task__status-badge"
                              style={{
                                background: `${priColor}18`,
                                color: priColor,
                                border: `1px solid ${priColor}33`,
                              }}
                            >
                              {taskStatusLabel(task.status)}
                            </span>
                            {!isReviewed && (
                              <button
                                type="button"
                                className="sdb-task__review-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markReviewed(task.id);
                                }}
                              >
                                Mark reviewed
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="sdb-task__expanded">
                            {task.owner && (
                              <div className="sdb-task__detail-row">
                                <span className="sdb-task__detail-label">
                                  Owner
                                </span>
                                <span className="sdb-task__detail-value">
                                  {task.owner}
                                </span>
                              </div>
                            )}
                            {task.approver && (
                              <div className="sdb-task__detail-row">
                                <span className="sdb-task__detail-label">
                                  Approver
                                </span>
                                <span className="sdb-task__detail-value">
                                  {task.approver}
                                </span>
                              </div>
                            )}
                            {task.due && (
                              <div className="sdb-task__detail-row">
                                <span className="sdb-task__detail-label">
                                  Due offset
                                </span>
                                <span className="sdb-task__detail-value">
                                  {task.due}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {tasks.length > TASKS_PREVIEW && (
                  <button
                    type="button"
                    className="sdb-show-more"
                    onClick={() => setShowAllTasks((v) => !v)}
                  >
                    {showAllTasks
                      ? `Show less`
                      : `See all ${tasks.length} tasks`}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Phase Readiness */}
          <div className="sdb-section">
            <div className="sdb-section__head">
              <div className="sdb-section__title">
                <Icon icon="layers" size={12} />
                Phase readiness
                <span className="sdb-section__count">{phases.length}</span>
              </div>
              <button
                type="button"
                className="sdb-link"
                onClick={() =>
                  emitEvent("onViewPhases", { parameterUpdates: {} })
                }
              >
                Open phases →
              </button>
            </div>

            {phasesLoading ? (
              <div className="sdb-loading">Loading phases…</div>
            ) : phases.length === 0 ? (
              <div className="sdb-empty">
                No phases defined for this scenario.
              </div>
            ) : (
              <div className="sdb-phase-readiness-wrap">
                <div className="sdb-phase-readiness-baseline" />
                <div className="sdb-phase-readiness-chart">
                  {sortedPhases.map((phase) => {
                    const pct =
                      (phase as typeof phase & { readinessPct?: number })
                        .readinessPct ?? 0;
                    const barColor = phaseBarColor(pct);
                    const isActive =
                      scenario?.currentPhase === phase.displayLabel ||
                      scenario?.currentPhase === phase.phaseName ||
                      scenario?.currentPhase === phase.phaseId;
                    // Height proportional to readiness — min 18% so label always visible
                    const heightPct = Math.max(18, pct);
                    return (
                      <div
                        key={phase.phaseId}
                        className={`sdb-phase-bar${
                          isActive ? " sdb-phase-bar--active" : ""
                        }`}
                        title={`${phase.phaseName} — ${phase.phaseDescription}`}
                      >
                        <div
                          className="sdb-phase-bar__fill"
                          style={{
                            background: barColor,
                            height: `${heightPct}%`,
                          }}
                        >
                          <span className="sdb-phase-bar__pct">{pct}%</span>
                        </div>
                        <div className="sdb-phase-bar__name">
                          {phase.displayLabel}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Objective Coverage */}
          {sortedObjectives.length > 0 && (
            <div className="sdb-section">
              <div className="sdb-section__head">
                <div className="sdb-section__title">
                  <Icon icon="target" size={12} />
                  Objective coverage
                  <span className="sdb-section__count">
                    {sortedObjectives.length}
                  </span>
                </div>
              </div>
              <div className="sdb-objectives-wrap">
                <div className="sdb-objectives">
                  {sortedObjectives.map((obj) => {
                    const pct = obj.coveragePct;
                    const barColor =
                      pct >= 80 ? "#4c7ef3" : pct >= 60 ? "#f0a83c" : "#ef4d4d";
                    return (
                      <div key={obj.objectiveId} className="sdb-objective-row">
                        <div className="sdb-objective-row__ref">{obj.ref}</div>
                        <div className="sdb-objective-row__label">
                          {obj.objective}
                        </div>
                        <div className="sdb-objective-row__bar-wrap">
                          <div className="sdb-objective-row__bar">
                            <div
                              className="sdb-objective-row__fill"
                              style={{ width: `${pct}%`, background: barColor }}
                            />
                          </div>
                          <span className="sdb-objective-row__pct">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Right column: sidebar info ── */}
        <div className="sdb-side-col">
          {/* Scenario details card */}
          <div className="sdb-side-card">
            <div className="sdb-side-card__title">
              <Icon icon="shield" size={12} /> Scenario details
            </div>
            <div className="sdb-side-card__rows">
              {scenario?.scenarioType && (
                <div className="sdb-detail-row">
                  <span className="sdb-detail-row__label">Type</span>
                  <span className="sdb-detail-row__value">
                    {scenario.scenarioType}
                  </span>
                </div>
              )}
              {scenario?.classification && (
                <div className="sdb-detail-row">
                  <span className="sdb-detail-row__label">Classification</span>
                  <span className="sdb-detail-row__value">
                    {scenario.classification}
                  </span>
                </div>
              )}
              {scenario?.currentPhase && (
                <div className="sdb-detail-row">
                  <span className="sdb-detail-row__label">Current phase</span>
                  <span
                    className="sdb-detail-row__value"
                    style={{ color: "#4c7ef3", fontWeight: 700 }}
                  >
                    {scenario.currentPhase}
                  </span>
                </div>
              )}

              {scenario?.aiGenerated && (
                <div className="sdb-detail-row">
                  <span className="sdb-detail-row__label">AI generated</span>
                  <span
                    className="sdb-detail-row__value"
                    style={{ color: "#c47af5" }}
                  >
                    Yes
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Strategic context snippet */}
          {scenario?.strategicContextTitle && (
            <div className="sdb-side-card">
              <div className="sdb-side-card__title">
                <Icon icon="document" size={12} /> Strategic context
              </div>
              <div className="sdb-side-card__context-title">
                {scenario.strategicContextTitle}
              </div>
              {scenario?.strategicContextBody && (
                <div className="sdb-side-card__context-body">
                  {scenario.strategicContextBody.slice(0, 280)}
                  {scenario.strategicContextBody.length > 280 ? "…" : ""}
                </div>
              )}
            </div>
          )}

          {/* Quick navigation */}
          <div className="sdb-side-card">
            <div className="sdb-side-card__title">
              <Icon icon="compass" size={12} /> Quick navigation
            </div>
            <div className="sdb-nav-list">
              <button
                type="button"
                className="sdb-nav-item"
                onClick={() => emitEvent("onViewMap", { parameterUpdates: {} })}
              >
                <div
                  className="sdb-nav-item__icon"
                  style={{
                    background: "rgba(76, 126, 243,0.15)",
                    color: "#4c7ef3",
                  }}
                >
                  <Icon icon="map" size={14} />
                </div>
                <div className="sdb-nav-item__body">
                  <div className="sdb-nav-item__label">ORBAT Map</div>
                  <div className="sdb-nav-item__desc">
                    View force structure on map
                  </div>
                </div>
                <Icon
                  icon="chevron-right"
                  size={12}
                  style={{ color: "#454c68" }}
                />
              </button>
              <button
                type="button"
                className="sdb-nav-item"
                onClick={() =>
                  emitEvent("onViewTasks", { parameterUpdates: {} })
                }
              >
                <div
                  className="sdb-nav-item__icon"
                  style={{
                    background: "rgba(108, 92, 231,0.15)",
                    color: "#6c5ce7",
                  }}
                >
                  <Icon icon="tick-circle" size={14} />
                </div>
                <div className="sdb-nav-item__body">
                  <div className="sdb-nav-item__label">Task Management</div>
                  <div className="sdb-nav-item__desc">
                    View and manage all tasks
                  </div>
                </div>
                <Icon
                  icon="chevron-right"
                  size={12}
                  style={{ color: "#454c68" }}
                />
              </button>
              <button
                type="button"
                className="sdb-nav-item"
                onClick={() =>
                  emitEvent("onOpenChatbot", { parameterUpdates: {} })
                }
              >
                <div
                  className="sdb-nav-item__icon"
                  style={{
                    background: "rgba(196, 122, 245,0.15)",
                    color: "#c47af5",
                  }}
                >
                  <Icon icon="chat" size={14} />
                </div>
                <div className="sdb-nav-item__body">
                  <div className="sdb-nav-item__label">AI Assistant</div>
                  <div className="sdb-nav-item__desc">
                    Ask the operations chatbot
                  </div>
                </div>
                <Icon
                  icon="chevron-right"
                  size={12}
                  style={{ color: "#454c68" }}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Widget entry point ─────────────────────────────────────────────────────
// Resolves the bound scenario before mounting the body, so the body always
// has a real scenario to work with and never silently falls back to a
// default exercise.

export const ScenarioDashboard: React.FC = () => {
  const { parameters } = useWidgetContext();
  const binding = useScenarioIdFromObjectSet(
    parameters.values.scenario?.objectSet
  );
  return (
    <ScenarioGate binding={binding}>
      {(scenarioId) => <ScenarioDashboardBody scenarioId={scenarioId} />}
    </ScenarioGate>
  );
};
