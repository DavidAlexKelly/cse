// src/map/ScenarioPlanning/components/PhaseDetail/PhaseDetail.tsx

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type {
  Phase,
  NxgInject,
  NxgTask,
  NxgTrainingAudience,
  NxgPmesiiDomain,
  NxgTrainingObjective,
} from "../../shared/types";
import { getPhaseColour } from "../../shared/phaseColours";
import { formatPhaseWindow, phaseDurationHours } from "../../shared/timeScale";
import { OrdersTab, type OrdersTabProps } from "./OrdersTab";
import { OrbatTab, type OrbatTabProps } from "./OrbatTab";
// ── Composition-tab wiring (DJ-Slate) ──────────────────────────────────
//   The Composition tab renders a plaintext snapshot of the phase's map
//   state and exposes a Publish → ORBAT button. It needs:
//     - MapPhaseState        the snapshot shape produced by MapWrapper
//     - lngLatToMgrs         formats coords in the snapshot
//     - syncPhaseMapState    fallback when App.tsx does not inject its
//                            own onPublishToOrbat handler
//     - getMapStateId        drives the "Previously published" badge
//     - SyncPhaseMapStateParams  shared parameter type
import type { MapPhaseState } from "../../phaseCreator/types";
import { lngLatToMgrs } from "../../../../shared/components/MgrsOverlay";
import {
  syncPhaseMapState,
  getMapStateId,
  checkPhaseHasExistingOrbat,
  type SyncPhaseMapStateParams,
} from "../../phaseCreator/phaseMapStateService";
import { BranchSelector } from "../BranchSelector/BranchSelector";


interface Props {
  phase: Phase | null;
  phaseIndex: number;
  allPhases: Phase[];
  /** Map of basedOnPhaseId → Phase[] for detecting branch points. */
  branchesBySource?: Record<string, Phase[]>;
  /** Sibling branch phases for the currently selected phase. */
  branchSiblings?: Phase[];
  /** Called when the user picks a different branch alternative. */
  onSelectBranch?: (phaseId: string) => void;
  /** Called when the user wants to fork from the current phase. */
  onForkPhase?: () => void;
  onClose: () => void;
  /** Apply an in-place rename for the open phase */
  onRename?: (phaseId: string, newName: string) => void;
  /** Disable editing affordances */
  readOnly?: boolean;
  /** Full task catalogue — currently unused; reserved for future tab work */
  tasks?: NxgTask[];
  /** Reserved for future tab work that re-introduces task selection */
  onTaskSelected?: (taskId: string) => void;
  /** Full training audience catalogue */
  audiences?: NxgTrainingAudience[];
  /** Fired when the user clicks an audience row — mirrors onTaskSelected */
  onAudienceSelected?: (audienceId: string) => void;
  /** Full PMESII domain catalogue */
  pmesiiDomains?: NxgPmesiiDomain[];
  /** Fired when the user clicks a PMESII domain row — mirrors onTaskSelected */
  onPmesiiSelected?: (domainId: string) => void;
  /** Full training objectives catalogue */
  objectives?: NxgTrainingObjective[];
  /** Fired when the user clicks a training objective row — mirrors onTaskSelected */
  onObjectiveSelected?: (objectiveId: string) => void;
  /** Full MEL/MIL inject catalogue */
  injects?: NxgInject[];
  /** Fired when the user clicks an inject row — mirrors onTaskSelected */
  onInjectSelected?: (injectId: string) => void;
  /** Called when the user edits the phase name or objective */
  onPhaseUpdate?: (updated: Phase) => void;
  /** Called when the user confirms deletion of the open phase */
  onPhaseDelete?: (phaseId: string) => void;
  /** Orders tab props — passed through to the OrdersTab component. */
  ordersTabProps?: Omit<OrdersTabProps, "phase" | "readOnly">;
  /**
   * ORBAT of the unit currently selected on the map. Omit to show the tab's
   * "select a unit" empty state.
   */
  orbatTabProps?: Omit<OrbatTabProps, "readOnly">;

  /**
   * Callback to read the live map state for this phase.
   * Called lazily when the COMPOSITION tab is first shown.
   */
  onReadMapState?: () => MapPhaseState | null;
  /**
   * Fired when the user triggers a manual refresh of the map state from the
   * COMPOSITION tab toolbar.  The App layer uses this to schedule a debounced
   * sync to the [NXG-O] Template Orbat Graph ontology object.
   */
  onMapStateChanged?: () => void;
  /**
   * When provided, the COMPOSITION tab shows a "Publish to ORBAT Manager" button.
   * Returns a SyncPhaseMapStateParams-compatible object so the tab can call
   * syncPhaseMapState directly (avoids prop-drilling the whole service).
   *
   * The callback receives the current MapPhaseState snapshot so the App layer
   * doesn't need to maintain a ref to it.
   */
  onPublishToOrbat?: (params: SyncPhaseMapStateParams) => Promise<{
    mapStateId: string;
    orbatJson: string | null;
    bySide?: Partial<Record<"blue"|"red", { mapStateId: string; orbatJson: string | null; templateName: string }>>;
  }>;
}

type TabId =
  | "OVERVIEW"
  | "SUB_PHASES"
  | "ORDERS"
  | "TASKS"
  | "ORBAT"
  | "AUDIENCE"
  | "COMPOSITION"
  | "PMSEII"
  | "OBJECTIVES"
  | "MIL_MEL";

// Tabs render at the top of the panel body. Each tab label is always kept
// on a single line (no mid-word breaks like "OVERVI-EW"); if the pills
// don't all fit on one row at the current panel width, the tab strip
// itself wraps so pills flow onto a second row.
const TABS: { id: TabId; label: string }[] = [
  { id: "OVERVIEW",    label: "OVERVIEW"    },
  { id: "SUB_PHASES",  label: "SUB PHASES"  },
  { id: "ORDERS",      label: "ORDERS"      },
  { id: "ORBAT",       label: "ORBAT"       },
  { id: "TASKS",       label: "TASKS"       },
  { id: "AUDIENCE",    label: "AUDIENCE"    },
  { id: "COMPOSITION", label: "COMPOSITION" },
  { id: "PMSEII",      label: "PMESII"      },
  { id: "OBJECTIVES",  label: "OBJECTIVES"  },
  { id: "MIL_MEL",     label: "MEL/MIL"     },
];
// ── Phase link resolution ─────────────────────────────────────────────────────
//
// NxgTrainingAudience and NxgPmesiiDomain are SCENARIO-scoped in the ontology:
// they carry a scenarioId FK and a link to NxgScenario, but no phaseId. Phases
// loaded from the ontology (useScenario) therefore never populate
// `phase.audienceIds` / `phase.pmesiiDomainIds`, and the old strict filters
// made both tabs permanently empty against live data.
//
// Resolution order:
//   1. Explicit id array on the Phase (Workshop / mock data) → phase-specific.
//   2. Otherwise the whole (already scenario-filtered) catalogue, flagged as
//      scenario-wide so the UI can say so.

interface ResolvedLinks<T> {
  items: T[];
  /** True when we fell back to the scenario-wide catalogue. */
  scenarioWide: boolean;
}

function resolveScenarioScoped<T>(
  ids: string[] | undefined,
  all: T[],
  idOf: (item: T) => string,
): ResolvedLinks<T> {
  if (ids && ids.length > 0) {
    return { items: all.filter((item) => ids.includes(idOf(item))), scenarioWide: false };
  }
  return { items: all, scenarioWide: true };
}

function ScenarioWideNote({ label }: { label: string }) {
  return (
    <div
      style={{
        margin: "0 0 8px",
        padding: "5px 8px",
        borderRadius: 3,
        border: "1px solid rgba(245,73,139,0.25)",
        background: "rgba(245,73,139,0.07)",
        color: "#8b95a8",
        fontSize: 10,
        lineHeight: 1.45,
      }}
    >
      Showing <strong style={{ color: "#c8cdd8" }}>scenario-wide</strong> {label} — this
      phase has no explicit {label} links, and {label} are defined per scenario in the
      ontology rather than per phase.
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className={"sp-detail__empty"}>
      <span className={"sp-detail__empty-icon"} aria-hidden="true">{icon}</span>
      <p className={"sp-detail__empty-text"}>{text}</p>
    </div>
  );
}

// ── Editable text field ───────────────────────────────────────────────────────
// Click to edit; Enter commits (Shift+Enter inserts newline when multiline),
// Escape cancels, blur commits.

interface EditableFieldProps {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  multiline?: boolean;
  ariaLabel?: string;
  /** When true, render as plain text (no edit affordances). */
  readOnly?: boolean;
  placeholder?: string;
}

function EditableField({
  value,
  onCommit,
  className,
  multiline,
  ariaLabel,
  readOnly,
  placeholder,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Reset whenever the external value changes
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Focus + select on entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select?.();
    }
  }, [editing]);

  function commit() {
    const next = draft.trim();
    if (next.length > 0 && next !== value) {
      onCommit(next);
    } else {
      setDraft(value);
    }
    setEditing(false);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  function handleKey(
    e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  if (readOnly) {
    return <p className={className}>{value || placeholder}</p>;
  }

  if (editing) {
    return multiline ? (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        className={`${className ?? ""} ${"sp-editable__input sp-editable__textarea"}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        aria-label={ariaLabel}
        rows={3}
      />
    ) : (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        className={`${className ?? ""} ${"sp-editable__input"}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <p
      className={`${className ?? ""} ${"sp-editable"}`}
      title="Click to edit"
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      aria-label={ariaLabel}
    >
      {value || (
        <span className={"sp-editable__placeholder"}>
          {placeholder ?? "Click to edit"}
        </span>
      )}
    </p>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  phase,
  onPhaseUpdate,
  readOnly,
}: {
  phase: Phase;
  onPhaseUpdate?: (u: Phase) => void;
  readOnly?: boolean;
}) {
  return (
    <>
      <div className={"sp-detail__section"}>
        <div className={"sp-detail__section-header"}>
          <span className={"sp-detail__section-icon"} aria-hidden="true">🎯</span>
          Objective
        </div>
        <EditableField
          value={phase.objective}
          onCommit={(v) => onPhaseUpdate?.({ ...phase, objective: v })}
          className={"sp-detail__objective-text"}
          multiline
          ariaLabel="Phase objective"
          readOnly={readOnly || !onPhaseUpdate}
          placeholder="Click to add an objective…"
        />
      </div>

      {phase.owner && (
        <div className={"sp-detail__section"}>
          <div className={"sp-detail__section-header"}>
            <span className={"sp-detail__section-icon"} aria-hidden="true">👤</span>
            Owner
          </div>
          <div>
            <span className={"sp-detail__owner-chip"}>
              <span className={"sp-detail__owner-dot"} aria-hidden="true" />
              {phase.owner}
            </span>
          </div>
        </div>
      )}

      {phase.dependencies.length > 0 && (
        <div className={"sp-detail__section"}>
          <div className={"sp-detail__section-header"}>
            <span className={"sp-detail__section-icon"} aria-hidden="true">🔗</span>
            Depends on
          </div>
          <div className={"sp-detail__dep-row"}>
            {phase.dependencies.map((d) => (
              <span key={d} className={"sp-detail__dep-tag"}>{d}</span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Tasks tab ─────────────────────────────────────────────────────────────────

const TASK_STATUS_META: Record<
  NxgTask["taskStatus"],
  { label: string; className: string }
> = {
  approved:    { label: "APPROVED",  className: "sp-badge sp-badge--approved" },
  "in-review": { label: "IN REVIEW", className: "sp-badge sp-badge--review"   },
  pending:     { label: "PENDING",   className: "sp-badge sp-badge--draft"  },
};

function TasksTab({
  phase,
  allTasks,
  selectedTaskId,
  onTaskSelected,
}: {
  phase: Phase;
  allTasks: NxgTask[];
  selectedTaskId: string | null;
  onTaskSelected?: (taskId: string) => void;
}) {
  // Prefer the explicit phase.taskIds link table, but fall back to any tasks
  // whose phaseId FK matches this phase — mirrors the OBJECTIVES / MEL-MIL
  // fallback pattern, so the tab still renders when the mock/live phase
  // data hasn't been extended with taskIds yet.
  const phaseTasks = allTasks.filter((t) => {
    if (phase.taskIds && phase.taskIds.length > 0) {
      return phase.taskIds.includes(t.taskId);
    }
    // NxgTask has an optional phase_id FK — used as a fallback when
    // phase.taskIds hasn't been populated (mock / older phase data).
    return t.phaseId === phase.id;
  });

  if (phaseTasks.length === 0) {
    return <EmptyState icon="📋" text="No tasks linked to this phase." />;
  }

  // Group by taskSection (preserve insertion order)
  const sections = Array.from(new Set(phaseTasks.map((t) => t.taskSection)));

  return (
    <div>
      {sections.map((section) => (
        <div key={section} className={"sp-detail__task-section"}>
          <div className={"sp-detail__task-section-header"}>{section}</div>
          {phaseTasks
            .filter((t) => t.taskSection === section)
            .map((task) => {
              const meta = TASK_STATUS_META[task.taskStatus];
              const isActive = task.taskId === selectedTaskId;
              return (
                <button
                  key={task.taskId}
                  type="button"
                  className={`${"sp-detail__task-row"} ${
                    isActive ? "sp-detail__task-row--active" : ""
                  }`}
                  onClick={() => onTaskSelected?.(task.taskId)}
                  aria-pressed={isActive}
                  aria-label={`Open task: ${task.taskName}`}
                  title="Open in Task Management"
                >
                  <div className={"sp-detail__task-row-top"}>
                    <span
                      className={`${"sp-badge"} ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                    {task.aiAssisted && (
                      <span
                        className={"sp-badge sp-badge--purple"}
                        title="AI assisted"
                      >
                        ✦ AI
                      </span>
                    )}
                    <span className={"sp-detail__task-due"}>{task.dueOffset}</span>
                    <span
                      className={"sp-detail__task-select-btn"}
                      aria-hidden="true"
                      title="Open in Task Management"
                    >
                      ›
                    </span>
                  </div>
                  <div className={"sp-detail__task-name"}>{task.taskName}</div>
                  {task.taskDescription && (
                    <div className={"sp-detail__task-desc"}>
                      {task.taskDescription}
                    </div>
                  )}
                  {task.assignedTo && (
                    <div className={"sp-detail__task-assignee"}>
                      <span className={"sp-detail__task-assignee-icon"}>👤</span>
                      {task.assignedTo}
                    </div>
                  )}
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}

// ── Audience tab ──────────────────────────────────────────────────────────────
//
// Executive-summary view of the Training Audience widget. Each row mirrors the
// Task row pattern: click to fire the `onAudienceSelected` event which the
// widget forwards to Workshop, allowing the parent app to open the full Task
// Management / Training Audience widget on the selected object.

const AUDIENCE_TYPE_META: Record<
  NxgTrainingAudience["audienceType"],
  { label: string; className: string }
> = {
  primary:   { label: "PRIMARY",   className: "sp-badge sp-badge--pink-primary"   },
  secondary: { label: "SECONDARY", className: "sp-badge sp-badge--purple" },
};

function AudienceTab({
  phase,
  allAudiences,
  selectedAudienceId,
  onAudienceSelected,
}: {
  phase: Phase;
  allAudiences: NxgTrainingAudience[];
  selectedAudienceId: string | null;
  onAudienceSelected?: (audienceId: string) => void;
}) {
  const { items: phaseAudiences, scenarioWide } = resolveScenarioScoped(
    phase.audienceIds,
    allAudiences,
    (a) => a.audienceId,
  );

  if (phaseAudiences.length === 0) {
    return <EmptyState icon="👥" text="No training audience available for this scenario." />;
  }

  // Executive-summary totals across the phase's linked audiences.
  const totalParticipants = phaseAudiences.reduce(
    (acc, a) => acc + (a.participantCount ?? 0),
    0,
  );
  const primaryCount = phaseAudiences.filter(
    (a) => a.audienceType === "primary",
  ).length;
  const secondaryCount = phaseAudiences.length - primaryCount;

  // Group by audience type — primary first — preserving insertion order.
  const groups: Array<{ label: string; audiences: NxgTrainingAudience[] }> = [
    {
      label: "PRIMARY AUDIENCE",
      audiences: phaseAudiences.filter((a) => a.audienceType === "primary"),
    },
    {
      label: "SECONDARY AUDIENCES",
      audiences: phaseAudiences.filter((a) => a.audienceType === "secondary"),
    },
  ].filter((g) => g.audiences.length > 0);

  return (
    <div>
      {scenarioWide && <ScenarioWideNote label="training audiences" />}
      {/* Executive summary strip */}
      <div className={"sp-detail__pink-summary"} aria-label="Audience summary">
        <div className={"sp-detail__pink-stat"}>
          <div className={"sp-detail__pink-value"}>{totalParticipants}</div>
          <div className={"sp-detail__pink-label"}>Participants</div>
        </div>
        <div className={"sp-detail__pink-stat"}>
          <div className={"sp-detail__pink-value"}>{primaryCount}</div>
          <div className={"sp-detail__pink-label"}>Primary</div>
        </div>
        <div className={"sp-detail__pink-stat"}>
          <div className={"sp-detail__pink-value"}>{secondaryCount}</div>
          <div className={"sp-detail__pink-label"}>Secondary</div>
        </div>
      </div>

      {groups.map((group) => (
        <div key={group.label} className={"sp-detail__task-section"}>
          <div className={"sp-detail__task-section-header"}>{group.label}</div>
          {group.audiences.map((audience) => {
            const meta = AUDIENCE_TYPE_META[audience.audienceType];
            const isActive = audience.audienceId === selectedAudienceId;
            return (
              <button
                key={audience.audienceId}
                type="button"
                className={`${"sp-detail__task-row"} ${
                  isActive ? "sp-detail__task-row--active" : ""
                }`}
                onClick={() => onAudienceSelected?.(audience.audienceId)}
                aria-pressed={isActive}
                aria-label={`Open training audience: ${audience.audienceName}`}
                title="Open in Task Management"
              >
                <div className={"sp-detail__task-row-top"}>
                  <span
                    className={`${"sp-badge"} ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                  <span className={"sp-detail__task-due"}>
                    👤 {audience.participantCount}
                  </span>
                  <span
                    className={"sp-detail__task-select-btn"}
                    aria-hidden="true"
                    title="Open in Task Management"
                  >
                    ›
                  </span>
                </div>
                <div className={"sp-detail__task-name"}>{audience.audienceName}</div>
                {audience.audienceDescription && (
                  <div className={"sp-detail__task-desc"}>
                    {audience.audienceDescription}
                  </div>
                )}
                {audience.directorates.length > 0 && (
                  <div className={"sp-detail__dep-row"}>
                    {audience.directorates.map((d) => (
                      <span key={d} className={"sp-detail__dep-tag"}>
                        {d}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── PMESII tab ────────────────────────────────────────────────────────────────
//
// Executive-summary view of the PMESII widget. Mirrors the Tasks / Audience
// tabs: each domain row is clickable and fires the `onPmesiiSelected` event,
// which the widget forwards to Workshop so the parent app can open the full
// PMESII widget on the selected domain (`taskIcon` reused for consistency).

const PMESII_STATUS_META: Record<
  NxgPmesiiDomain["domainStatus"],
  { label: string; className: string }
> = {
  complete:  { label: "COMPLETE",  className: "sp-badge sp-badge--approved" },
  in_review: { label: "IN REVIEW", className: "sp-badge sp-badge--review"   },
  empty:     { label: "EMPTY",     className: "sp-badge sp-badge--draft"    },
};

// Order the executive summary uses when displaying domains — follows the
// PMESII-PT mnemonic (Political, Military, Economic, Social, Infrastructure,
// Information, Physical Environment, Time).
const PMESII_ORDER: string[] = [
  "Political",
  "Military",
  "Economic",
  "Social",
  "Infrastructure",
  "Information",
  "Physical Environment",
  "Time",
];

function truncate(text: string, max = 140): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function PmesiiTab({
  phase,
  allDomains,
  selectedDomainId,
  onPmesiiSelected,
}: {
  phase: Phase;
  allDomains: NxgPmesiiDomain[];
  selectedDomainId: string | null;
  onPmesiiSelected?: (domainId: string) => void;
}) {
  const { items: phaseDomains, scenarioWide } = resolveScenarioScoped(
    phase.pmesiiDomainIds,
    allDomains,
    (d) => d.domainId,
  );

  if (phaseDomains.length === 0) {
    return <EmptyState icon="🌐" text="No PMESII domains available for this scenario." />;
  }

  // Executive-summary totals across the phase's linked domains.
  const completeCount  = phaseDomains.filter((d) => d.domainStatus === "complete").length;
  const inReviewCount  = phaseDomains.filter((d) => d.domainStatus === "in_review").length;
  const emptyCount     = phaseDomains.filter((d) => d.domainStatus === "empty").length;

  // Sort per PMESII-PT convention so the layout is stable across phases.
  const sortedDomains = [...phaseDomains].sort(
    (a, b) => PMESII_ORDER.indexOf(a.domainKey) - PMESII_ORDER.indexOf(b.domainKey),
  );

  return (
    <div>
      {scenarioWide && <ScenarioWideNote label="PMESII domains" />}
      {/* Executive summary strip */}
      <div className={"sp-detail__pink-summary"} aria-label="PMESII summary">
        <div className={"sp-detail__pink-stat"}>
          <div className={"sp-detail__pink-value"}>{completeCount}</div>
          <div className={"sp-detail__pink-label"}>Complete</div>
        </div>
        <div className={"sp-detail__pink-stat"}>
          <div className={"sp-detail__pink-value"}>{inReviewCount}</div>
          <div className={"sp-detail__pink-label"}>In Review</div>
        </div>
        <div className={"sp-detail__pink-stat"}>
          <div className={"sp-detail__pink-value"}>{emptyCount}</div>
          <div className={"sp-detail__pink-label"}>Empty</div>
        </div>
      </div>

      <div className={"sp-detail__task-section"}>
        <div className={"sp-detail__task-section-header"}>PMESII-PT DOMAINS</div>
        {sortedDomains.map((domain) => {
          const meta = PMESII_STATUS_META[domain.domainStatus];
          const isActive = domain.domainId === selectedDomainId;
          return (
            <button
              key={domain.domainId}
              type="button"
              className={`${"sp-detail__task-row"} ${
                isActive ? "sp-detail__task-row--active" : ""
              }`}
              onClick={() => onPmesiiSelected?.(domain.domainId)}
              aria-pressed={isActive}
              aria-label={`Open PMESII domain: ${domain.domainKey}`}
              title="Open in PMESII widget"
            >
              <div className={"sp-detail__task-row-top"}>
                <span
                  className={`${"sp-badge"} ${meta.className}`}
                >
                  {meta.label}
                </span>
                {domain.aiGenerated && (
                  <span
                    className={"sp-badge sp-badge--purple"}
                    title="AI generated"
                  >
                    ✦ AI
                  </span>
                )}
                <span
                  className={"sp-detail__task-select-btn"}
                  aria-hidden="true"
                  title="Open in PMESII widget"
                >
                  ›
                </span>
              </div>
              <div className={"sp-detail__task-name"}>{domain.domainKey}</div>
              {domain.domainValue ? (
                <div className={"sp-detail__task-desc"}>
                  {truncate(domain.domainValue)}
                </div>
              ) : (
                <div className={"sp-detail__task-desc"}>
                  <span className={"sp-editable__placeholder"}>
                    No content yet — click to author in PMESII widget.
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Objectives tab ────────────────────────────────────────────────────────────
//
// Executive-summary view of the Training Objectives widget. Mirrors the
// Tasks / Audience / PMESII tabs: each objective row is clickable and fires
// the `onObjectiveSelected` event, which the widget forwards to Workshop so
// the parent app can open the full Task Management widget on the selected
// NxgTrainingObjective. The pink accent (#F5498B) matches the ontology icon
// colour for NxgTrainingObjective.

const OBJECTIVE_PRIORITY_META: Record<
  NxgTrainingObjective["priority"],
  { label: string; className: string }
> = {
  High:   { label: "HIGH",   className: "sp-badge sp-badge--danger"   },
  Medium: { label: "MEDIUM", className: "sp-badge sp-badge--review" },
  Low:    { label: "LOW",    className: "sp-badge sp-badge--draft"    },
};

function ObjectivesTab({
  phase,
  allObjectives,
  selectedObjectiveId,
  onObjectiveSelected,
}: {
  phase: Phase;
  allObjectives: NxgTrainingObjective[];
  selectedObjectiveId: string | null;
  onObjectiveSelected?: (objectiveId: string) => void;
}) {
  // Prefer the explicit phase.objectiveIds link table, but fall back to the
  // phaseId FK on the objective itself so this tab still renders even when
  // the mock/live phase data hasn't been extended with objectiveIds yet.
  const phaseObjectives = allObjectives.filter((o) => {
    if (phase.objectiveIds && phase.objectiveIds.length > 0) {
      return phase.objectiveIds.includes(o.objectiveId);
    }
    return o.phaseId === phase.id;
  });

  if (phaseObjectives.length === 0) {
    return (
      <EmptyState icon="🎯" text="No training objectives linked to this phase." />
    );
  }

  // Executive-summary totals across the phase's linked objectives.
  const highCount   = phaseObjectives.filter((o) => o.priority === "High").length;
  const mediumCount = phaseObjectives.filter((o) => o.priority === "Medium").length;
  const lowCount    = phaseObjectives.filter((o) => o.priority === "Low").length;

  // Group by functional area (preserve insertion order) so the summary reads
  // like the Tasks tab's `taskSection` grouping.
  const areas = Array.from(
    new Set(phaseObjectives.map((o) => o.functionalArea || "Other")),
  );

  return (
    <div>
      {/* Executive summary strip */}
      <div className={"sp-detail__pink-summary"} aria-label="Objectives summary">
        <div className={"sp-detail__pink-stat"}>
          <div className={"sp-detail__pink-value"}>{highCount}</div>
          <div className={"sp-detail__pink-label"}>High</div>
        </div>
        <div className={"sp-detail__pink-stat"}>
          <div className={"sp-detail__pink-value"}>{mediumCount}</div>
          <div className={"sp-detail__pink-label"}>Medium</div>
        </div>
        <div className={"sp-detail__pink-stat"}>
          <div className={"sp-detail__pink-value"}>{lowCount}</div>
          <div className={"sp-detail__pink-label"}>Low</div>
        </div>
      </div>

      {areas.map((area) => (
        <div key={area} className={"sp-detail__task-section"}>
          <div className={"sp-detail__task-section-header"}>{area}</div>
          {phaseObjectives
            .filter((o) => (o.functionalArea || "Other") === area)
            .map((objective) => {
              const meta = OBJECTIVE_PRIORITY_META[objective.priority];
              const isActive = objective.objectiveId === selectedObjectiveId;
              return (
                <button
                  key={objective.objectiveId}
                  type="button"
                  className={`${"sp-detail__task-row"} ${
                    isActive ? "sp-detail__task-row--active" : ""
                  }`}
                  onClick={() => onObjectiveSelected?.(objective.objectiveId)}
                  aria-pressed={isActive}
                  aria-label={`Open training objective: ${objective.ref}`}
                  title="Open in Task Management"
                >
                  <div className={"sp-detail__task-row-top"}>
                    <span
                      className={`${"sp-badge"} ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                    <span className="sp-detail__task-due" style={{color:"#f5498b"}}>{objective.ref}</span>
                    <span
                      className={"sp-detail__task-select-btn"}
                      aria-hidden="true"
                      title="Open in Task Management"
                    >
                      ›
                    </span>
                  </div>
                  <div className={"sp-detail__task-name"}>{objective.objective}</div>
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}

// ── MEL/MIL tab ───────────────────────────────────────────────────────────────
//
// Executive-summary view of the MEL/MIL widget. Mirrors the
// Tasks / Audience / PMESII / Objectives tabs: each inject row is clickable
// and fires the `onInjectSelected` event, which the widget forwards to
// Workshop so the parent app can open the full MEL/MIL / Task Management
// widget on the selected NxgInject. The pink accent (#F5498B) matches the
// NxgInject ontology icon colour (⚡ lightning).

// Ordered set of inject categories the executive summary uses when it groups
// rows. Any category not in this list is appended to the end in insertion
// order under an "OTHER" heading.
const INJECT_CATEGORY_ORDER: string[] = [
  "INTEL",
  "CYBER",
  "METOC",
  "POLMIL",
  "CIMIC",
  "LOG",
  "INFO OPS",
];

/**
 * Category → tailwind-ish class name. We reuse the existing status/priority
 * palette so the MEL/MIL rows look consistent with the rest of the widget.
 */
function injectCategoryClass(category: string): string {
  const normalised = category?.toUpperCase() ?? "";
  switch (normalised) {
    case "INTEL":
      return "sp-badge sp-badge--intel";
    case "CYBER":
      return "sp-badge sp-badge--purple";
    case "METOC":
      return "sp-badge sp-badge--metoc";
    case "POLMIL":
      return "sp-badge sp-badge--amber-sm";
    case "CIMIC":
      return "sp-badge sp-badge--green-sm";
    case "LOG":
      return "sp-badge sp-badge--log";
    case "INFO OPS":
      return "sp-badge sp-badge--infoops";
    default:
      return "sp-badge sp-badge--draft";
  }
}

/** Parse a "D+N"/"D-N"/"D+0" style offset into a number for sorting. Falls
 * back to Number.MAX_SAFE_INTEGER for anything unrecognised so those rows
 * sort last but preserve their relative order. */
function parseDayOffset(dayOffset: string): number {
  if (!dayOffset) return Number.MAX_SAFE_INTEGER;
  const trimmed = dayOffset.trim().toUpperCase();
  if (trimmed === "D" || trimmed === "D+0" || trimmed === "D-0") return 0;
  const match = /^D([+-])(\d+)$/.exec(trimmed);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * Number(match[2]);
}

function MelMilTab({
  phase,
  allInjects,
  selectedInjectId,
  onInjectSelected,
}: {
  phase: Phase;
  allInjects: NxgInject[];
  selectedInjectId: string | null;
  onInjectSelected?: (injectId: string) => void;
}) {
  // Prefer the explicit phase.injectIds link table, but fall back to the
  // phaseId FK on the inject itself so this tab still renders even when the
  // mock/live phase data hasn't been extended with injectIds yet.
  const phaseInjects = allInjects.filter((i) => {
    if (phase.injectIds && phase.injectIds.length > 0) {
      return phase.injectIds.includes(i.injectId);
    }
    return i.phaseId === phase.id;
  });

  if (phaseInjects.length === 0) {
    return (
      <EmptyState icon="⚡" text="No MEL/MIL injects linked to this phase." />
    );
  }

  // Executive-summary totals across the phase's linked injects.
  const totalInjects = phaseInjects.length;
  const categorySet = new Set(phaseInjects.map((i) => i.injectCategory));
  const distinctCategories = categorySet.size;

  const offsets = phaseInjects
    .map((i) => parseDayOffset(i.dayOffset))
    .filter((n) => Number.isFinite(n));
  const minOffset = offsets.length > 0 ? Math.min(...offsets) : null;
  const maxOffset = offsets.length > 0 ? Math.max(...offsets) : null;
  const formatOffset = (n: number) => `D${n >= 0 ? "+" : ""}${n}`;
  // Use an en-dash (no surrounding spaces) so the range fits comfortably in
  // the narrow summary-strip stat cell. A wide arrow with padded spaces used
  // to wrap onto two lines on small viewports.
  const timespanLabel =
    minOffset !== null && maxOffset !== null
      ? minOffset === maxOffset
        ? formatOffset(minOffset)
        : `${formatOffset(minOffset)}–${formatOffset(maxOffset)}`
      : "—";
  const isTimespanRange =
    minOffset !== null && maxOffset !== null && minOffset !== maxOffset;

  // Group by category, preserving the canonical PMESII-style ordering above.
  const orderedCategories = [
    ...INJECT_CATEGORY_ORDER.filter((c) => categorySet.has(c)),
    ...Array.from(categorySet).filter(
      (c) => !INJECT_CATEGORY_ORDER.includes(c),
    ),
  ];

  return (
    <div>
      {/* Executive summary strip */}
      <div className={"sp-detail__pink-summary"} aria-label="MEL/MIL summary">
        <div className={"sp-detail__pink-stat"}>
          <div className={"sp-detail__pink-value"}>{totalInjects}</div>
          <div className={"sp-detail__pink-label"}>Injects</div>
        </div>
        <div className={"sp-detail__pink-stat"}>
          <div className={"sp-detail__pink-value"}>{distinctCategories}</div>
          <div className={"sp-detail__pink-label"}>Categories</div>
        </div>
        <div className={"sp-detail__pink-stat"}>
          <div
            className={`${"sp-detail__pink-value"} ${
              isTimespanRange ? "sp-detail__pink-value--range" : ""
            }`}
          >
            {timespanLabel}
          </div>
          <div className={"sp-detail__pink-label"}>Timespan</div>
        </div>
      </div>

      {orderedCategories.map((category) => {
        const rows = phaseInjects
          .filter((i) => i.injectCategory === category)
          .sort(
            (a, b) => parseDayOffset(a.dayOffset) - parseDayOffset(b.dayOffset),
          );
        return (
          <div key={category} className={"sp-detail__task-section"}>
            <div className={"sp-detail__task-section-header"}>{category}</div>
            {rows.map((inject) => {
              const isActive = inject.injectId === selectedInjectId;
              return (
                <button
                  key={inject.injectId}
                  type="button"
                  className={`${"sp-detail__task-row"} ${
                    isActive ? "sp-detail__task-row--active" : ""
                  }`}
                  onClick={() => onInjectSelected?.(inject.injectId)}
                  aria-pressed={isActive}
                  aria-label={`Open MEL/MIL inject: ${inject.injectTitle}`}
                  title="Open in Task Management"
                >
                  <div className={"sp-detail__task-row-top"}>
                    <span
                      className={`${"sp-badge"} ${injectCategoryClass(
                        inject.injectCategory,
                      )}`}
                    >
                      {inject.injectCategory}
                    </span>
                    <span className="sp-detail__task-due" style={{color:"#f5498b"}}>{inject.dayOffset}</span>
                    <span
                      className={"sp-detail__task-select-btn"}
                      aria-hidden="true"
                      title="Open in Task Management"
                    >
                      ›
                    </span>
                  </div>
                  <div className={"sp-detail__task-name"}>{inject.injectTitle}</div>
                  {inject.injectBody && (
                    <div className={"sp-detail__task-desc"}>
                      {truncate(inject.injectBody)}
                    </div>
                  )}
                  {inject.expectedResponse && (
                    <div className={"sp-detail__inject-expected"}>
                      <span className={"sp-detail__inject-expected-icon"}>↳</span>
                      {truncate(inject.expectedResponse, 120)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Map State (COMPOSITION) tab ───────────────────────────────────────────────
//
// Renders the complete phase map state as a plaintext document in a monospace
// pre block — unit list with MGRS coords, tactical drawings, objectives, and
// an executive summary of all linked planning data (Audience, PMESII,
// Objectives, MEL/MIL).

function deriveAffiliationLabel(sidc: string, affiliation?: "friend" | "hostile"): "FRIENDLY" | "HOSTILE" | "NEUTRAL" {
  const ch = affiliation
    ? (affiliation === "friend" ? "F" : "H")
    : (sidc?.[1] ?? "U");
  if (ch === "F" || ch === "f") return "FRIENDLY";
  if (ch === "H" || ch === "h") return "HOSTILE";
  return "NEUTRAL";
}

function buildMapStateDoc(
  phase: Phase,
  phaseIndex: number,
  mapState: MapPhaseState,
  allTasks: NxgTask[],
  allAudiences: NxgTrainingAudience[],
  allObjectives: NxgTrainingObjective[],
  allInjects: NxgInject[],
  allPmesiiDomains: NxgPmesiiDomain[],
): string {
  const lines: string[] = [];
  const hr = (char = "─", width = 60) => char.repeat(width);
  const phaseNum = String(phaseIndex + 1).padStart(2, "0");

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(hr("═"));
  lines.push(`PHASE ${phaseNum}  —  ${phase.name}`);
  lines.push(hr("═"));
  lines.push(`STATUS     : ${phase.status}`);
  lines.push(`TIMEFRAME  : ${formatPhaseWindow(phase)}  (${phaseDurationHours(phase)}h)`);
  if (phase.owner) lines.push(`OWNER      : ${phase.owner}`);
  if (phase.dependencies.length > 0) lines.push(`DEPENDS ON : ${phase.dependencies.join(", ")}`);
  lines.push("");

  // ── Objective ─────────────────────────────────────────────────────────────
  lines.push("COMMANDER'S OBJECTIVE");
  lines.push(hr());
  const objLines = (phase.objective || "Not set.").split(/\n/);
  for (const l of objLines) lines.push(`  ${l}`);
  lines.push("");

  // ── Units on the map ──────────────────────────────────────────────────────
  const friendly = mapState.units.filter(
    (u) => deriveAffiliationLabel(u.sidc) !== "HOSTILE",
  );
  const hostile = mapState.units.filter(
    (u) => deriveAffiliationLabel(u.sidc) === "HOSTILE",
  );

  lines.push(`FRIENDLY FORCES  (${friendly.length} units on map)`);
  lines.push(hr());
  if (friendly.length === 0) {
    lines.push("  — No friendly units placed.");
  } else {
    for (const u of friendly) {
      const mgrs = lngLatToMgrs(u.lng, u.lat, 5);
      const label = u.label || u.id;
      const sidc = u.sidc || "";
      lines.push(`  ► ${label.padEnd(28)} SIDC: ${sidc.padEnd(16)} ${mgrs}`);
    }
  }
  lines.push("");

  lines.push(`HOSTILE / OPFOR FORCES  (${hostile.length} units on map)`);
  lines.push(hr());
  if (hostile.length === 0) {
    lines.push("  — No hostile units placed.");
  } else {
    for (const u of hostile) {
      const mgrs = lngLatToMgrs(u.lng, u.lat, 5);
      const label = u.label || u.id;
      const sidc = u.sidc || "";
      lines.push(`  ✕ ${label.padEnd(28)} SIDC: ${sidc.padEnd(16)} ${mgrs}`);
    }
  }
  lines.push("");

  // ── Objectives / Control Measures ─────────────────────────────────────────
  lines.push(`OBJECTIVES / CONTROL MEASURES  (${mapState.objectives.length})`);
  lines.push(hr());
  if (mapState.objectives.length === 0) {
    lines.push("  — None placed.");
  } else {
    for (const o of mapState.objectives) {
      const mgrs = lngLatToMgrs(o.lng, o.lat, 5);
      lines.push(`  ◎ ${o.name.padEnd(30)} ${mgrs}`);
    }
  }
  lines.push("");

  // ── Tactical Drawings / Orders ────────────────────────────────────────────
  lines.push(`TACTICAL DRAWINGS / ORDERS  (${mapState.arrows.length})`);
  lines.push(hr());
  if (mapState.arrows.length === 0) {
    lines.push("  — No tactical drawings.");
  } else {
    for (const a of mapState.arrows) {
      const fromMgrs = lngLatToMgrs(a.fromLng, a.fromLat, 5);
      const toMgrs   = lngLatToMgrs(a.toLng,   a.toLat,   5);
      const tactic   = (a.tacticLabel ?? a.label ?? a.lineStyle ?? "Arrow").toUpperCase();
      const style    = a.lineStyle ?? "solid";
      const endpt    = a.endpointStyle ?? "arrow-filled";
      lines.push(`  → ${tactic.padEnd(24)} FROM: ${fromMgrs}  TO: ${toMgrs}`);
      lines.push(`      style: ${style}, endpoint: ${endpt}${a.assignedUnitId ? `, unit: ${a.assignedUnitId}` : ""}${a.targetObjectiveId ? `, obj: ${a.targetObjectiveId}` : ""}`);
    }
  }
  lines.push("");

  // ── Training Audiences ────────────────────────────────────────────────────
  // Same scenario-wide fallback as the AUDIENCE tab (see resolveScenarioScoped).
  const { items: phaseAudiences, scenarioWide: audiencesScenarioWide } =
    resolveScenarioScoped(phase.audienceIds, allAudiences, (a) => a.audienceId);
  if (phaseAudiences.length > 0) {
    lines.push(
      `TRAINING AUDIENCE  (${phaseAudiences.length})${audiencesScenarioWide ? "  [scenario-wide]" : ""}`,
    );
    lines.push(hr());
    for (const a of phaseAudiences) {
      lines.push(`  [${a.audienceType.toUpperCase().padEnd(9)}] ${a.audienceName}  (${a.participantCount} participants)`);
      if (a.audienceDescription) lines.push(`               ${a.audienceDescription}`);
    }
    lines.push("");
  }

  // ── PMESII ────────────────────────────────────────────────────────────────
  const { items: phasePmesii, scenarioWide: pmesiiScenarioWide } =
    resolveScenarioScoped(phase.pmesiiDomainIds, allPmesiiDomains, (d) => d.domainId);
  if (phasePmesii.length > 0) {
    lines.push(
      `PMESII-PT FACTORS  (${phasePmesii.length})${pmesiiScenarioWide ? "  [scenario-wide]" : ""}`,
    );
    lines.push(hr());
    for (const d of phasePmesii) {
      const status = d.domainStatus.replace("_", " ").toUpperCase().padEnd(10);
      lines.push(`  [${status}] ${d.domainKey}`);
      if (d.domainValue) {
        const snippet = d.domainValue.length > 180
          ? d.domainValue.slice(0, 177) + "…"
          : d.domainValue;
        for (const sl of snippet.split(/\n/)) lines.push(`               ${sl}`);
      }
    }
    lines.push("");
  }

  // ── Training Objectives ───────────────────────────────────────────────────
  const phaseObjectives = allObjectives.filter((o) => {
    if (phase.objectiveIds && phase.objectiveIds.length > 0)
      return phase.objectiveIds.includes(o.objectiveId);
    return o.phaseId === phase.id;
  });
  if (phaseObjectives.length > 0) {
    lines.push(`TRAINING OBJECTIVES  (${phaseObjectives.length})`);
    lines.push(hr());
    for (const o of phaseObjectives) {
      const pri = o.priority.toUpperCase().padEnd(7);
      lines.push(`  [${pri}] ${o.ref}  ${o.functionalArea ? `[${o.functionalArea}]` : ""}`);
      lines.push(`             ${o.objective}`);
    }
    lines.push("");
  }

  // ── MEL/MIL Injects ───────────────────────────────────────────────────────
  const phaseInjects = allInjects.filter((i) => {
    if (phase.injectIds && phase.injectIds.length > 0)
      return phase.injectIds.includes(i.injectId);
    return i.phaseId === phase.id;
  });
  if (phaseInjects.length > 0) {
    const sorted = [...phaseInjects].sort(
      (a, b) => parseDayOffset(a.dayOffset) - parseDayOffset(b.dayOffset),
    );
    lines.push(`MEL/MIL INJECTS  (${sorted.length})`);
    lines.push(hr());
    for (const i of sorted) {
      lines.push(`  [${i.dayOffset.padEnd(6)}] [${i.injectCategory.padEnd(8)}] ${i.injectTitle}`);
      if (i.injectBody) {
        const snippet = i.injectBody.length > 200 ? i.injectBody.slice(0, 197) + "…" : i.injectBody;
        for (const sl of snippet.split(/\n/)) lines.push(`               ${sl}`);
      }
      if (i.expectedResponse) {
        lines.push(`               ↳ Expected: ${i.expectedResponse.slice(0, 100)}${i.expectedResponse.length > 100 ? "…" : ""}`);
      }
    }
    lines.push("");
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  // Mirror the TASKS tab: prefer phase.taskIds, fall back to the phaseId FK.
  const phaseTasks = allTasks.filter((t) =>
    phase.taskIds && phase.taskIds.length > 0
      ? phase.taskIds.includes(t.taskId)
      : t.phaseId === phase.id,
  );
  if (phaseTasks.length > 0) {
    lines.push(`TASKS  (${phaseTasks.length})`);
    lines.push(hr());
    for (const t of phaseTasks) {
      lines.push(`  [${t.taskStatus.toUpperCase().padEnd(9)}] ${t.taskName}  ${t.dueOffset}`);
      if (t.taskDescription) lines.push(`               ${t.taskDescription}`);
    }
    lines.push("");
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push(hr("─"));
  lines.push(`Generated by Scenario Planner — ${new Date().toUTCString()}`);
  lines.push(hr("─"));

  return lines.join("\n");
}

// Per-side result returned by the App layer's onPublishToOrbat callback.
// When both blue and red are present on the map two templates are created
// (one per side); when only one side is present just that side is populated.
interface PublishSideResult {
  mapStateId: string;
  orbatJson: string | null;
  templateName: string;
}

// Pipeline run status shown inside the Publish button / result strip
type PublishStatus =
  | { kind: "idle" }
  | { kind: "running"; step: "reading" | "llm" | "ontology"; sideLabel?: string }
  | { kind: "success"; mapStateId: string; orbatJson: string | null; bySide?: Partial<Record<"blue"|"red", PublishSideResult>> }
  | { kind: "error"; message: string };

function MapStateTab({
  phase,
  phaseIndex,
  onReadMapState,
  onMapStateChanged,
  onPublishToOrbat,
  allTasks,
  allAudiences,
  allObjectives,
  allInjects,
  allPmesiiDomains,
}: {
  phase: Phase;
  phaseIndex: number;
  onReadMapState?: () => MapPhaseState | null;
  onMapStateChanged?: () => void;
  onPublishToOrbat?: (params: SyncPhaseMapStateParams) => Promise<{
    mapStateId: string;
    orbatJson: string | null;
    bySide?: Partial<Record<"blue"|"red", { mapStateId: string; orbatJson: string | null; templateName: string }>>;
  }>;
  allTasks: NxgTask[];
  allAudiences: NxgTrainingAudience[];
  allObjectives: NxgTrainingObjective[];
  allInjects: NxgInject[];
  allPmesiiDomains: NxgPmesiiDomain[];
}) {
  // Snapshot taken once when the tab mounts (or on manual refresh).
  const [mapState, setMapState] = useState<MapPhaseState | null>(null);
  const [copied, setCopied] = useState(false);
  const [publishStatus, setPublishStatus] = useState<PublishStatus>({ kind: "idle" });

  // ── Publish dialog state ──────────────────────────────────────────────────
  // Shown when the user clicks "Publish Composition" — lets them set the
  // parent node name before kicking off the pipeline.
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [parentNodeName, setParentNodeName] = useState("");

  // ── "Previously published" detection ─────────────────────────────────────
  // True when this phase has one or more existing ORBAT template records in
  // the ontology.  Initialised from the in-memory registry (instant, zero
  // network); if the registry is empty (page reload) we probe the ontology
  // asynchronously and update once the answer arrives.
  const [alreadyPublished, setAlreadyPublished] = useState<boolean>(
    () => !!getMapStateId(phase.id),
  );

  useEffect(() => {
    // Sync the flag whenever the phase changes.
    const fast = !!getMapStateId(phase.id);
    setAlreadyPublished(fast);

    if (!fast) {
      // Registry is empty — check the ontology in the background.
      // This handles the "first render after a page reload" case.
      let cancelled = false;
      checkPhaseHasExistingOrbat(phase.id).then((found) => {
        if (!cancelled) setAlreadyPublished(found);
      }).catch(() => { /* non-fatal */ });
      return () => { cancelled = true; };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.id]);

  // Read on mount
  useEffect(() => {
    setMapState(onReadMapState?.() ?? null);
    setPublishStatus({ kind: "idle" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.id]);

  const doc = useMemo(() => {
    if (!mapState) return null;
    return buildMapStateDoc(
      phase,
      phaseIndex,
      mapState,
      allTasks,
      allAudiences,
      allObjectives,
      allInjects,
      allPmesiiDomains,
    );
  }, [mapState, phase, phaseIndex, allTasks, allAudiences, allObjectives, allInjects, allPmesiiDomains]);

  function handleRefresh() {
    setMapState(onReadMapState?.() ?? null);
    setCopied(false);
    setPublishStatus({ kind: "idle" });
    onMapStateChanged?.();
  }

  function handleCopy() {
    if (!doc) return;
    navigator.clipboard.writeText(doc).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Publish pipeline ──────────────────────────────────────────────────────
  // Runs: read map state → llmPhaseToOrbat → createNxgPPhaseMapState (or update)
  const handlePublish = useCallback(async (resolvedParentNodeName?: string) => {
    if (publishStatus.kind === "running") return;

    try {
      // ── Step 1: Read live map state ───────────────────────────────────────
      setPublishStatus({ kind: "running", step: "reading" });
      const liveState = onReadMapState?.() ?? mapState;

      if (!liveState || liveState.units.length === 0) {
        setPublishStatus({
          kind: "error",
          message: "No units on the map for this phase. Place some units first.",
        });
        return;
      }

      // Refresh the composition snapshot shown in the document
      setMapState(liveState);

      setPublishStatus({ kind: "running", step: "llm" });

      const phaseDescription = `${phase.name}: ${phase.objective}`;
      const params: SyncPhaseMapStateParams = {
        phaseId:          phase.id,
        phaseName:        phase.name,
        operationName:    "",
        phaseDescription,
        startState:       liveState,
        parentNodeName:   resolvedParentNodeName?.trim() || undefined,
      };

      let result: {
        mapStateId: string;
        orbatJson: string | null;
        bySide?: Partial<Record<"blue"|"red", PublishSideResult>>;
      };

      if (onPublishToOrbat) {
        result = await onPublishToOrbat(params);
      } else {
        setPublishStatus({ kind: "running", step: "ontology" });
        const mapStateId = await syncPhaseMapState(params);
        result = { mapStateId, orbatJson: null };
      }

      setPublishStatus({
        kind:       "success",
        mapStateId: result.mapStateId,
        orbatJson:  result.orbatJson,
        bySide:     result.bySide,
      });
      // After a successful publish the phase now has an existing record.
      setAlreadyPublished(true);
      onMapStateChanged?.();

    } catch (err) {
      console.error("[PhaseDetail] Publish pipeline failed:", err);
      setPublishStatus({
        kind:    "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [publishStatus.kind, onReadMapState, mapState, phase.id, phase.name, phase.objective, onPublishToOrbat, onMapStateChanged]);

  const stepLabel: Record<NonNullable<Extract<PublishStatus, { kind: "running" }>["step"]>, string> = {
    reading:  "Reading placed units…",
    llm:      "Generating ORBAT via LLM_PhaseToORBAT…",
    ontology: "Saving to Template Orbat Graph…",
  };

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!mapState) {
    return (
      <div style={{ padding: "12px" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
          <button
            type="button"
            className="sp-btn--sm sp-btn--outline"
            onClick={handleRefresh}
            style={{ fontSize: 10, padding: "3px 8px" }}
            title="Read map state now"
          >
            ↻ Load map state
          </button>
        </div>
        <EmptyState icon="🗺️" text="No map state available. Click 'Load map state' or place units on the map." />
      </div>
    );
  }

  const isRunning = publishStatus.kind === "running";

  return (
    // The whole Composition tab flows as a single vertical column and
    // relies on the parent `.sp-detail__tab-content` (which already has
    // `overflow-y: auto`) to provide one end-to-end scrollbar. The old
    // implementation gave `<pre>` its own `flex:1 + overflow:auto`, which
    // created a nested scroller — the top publish strip stayed fixed
    // while only the snapshot scrolled. Removing `height: 100%` and the
    // inner overflows lets the tab scroll naturally as one document.
    // `minWidth: 0` prevents flex/grid parents from forcing a horizontal
    // scrollbar on narrow side panels.
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
      }}
    >

      {/* ── Publish strip ─────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        padding: "8px 10px",
        borderBottom: "1px solid var(--border-default)",
        background: "#0d0f14",
        display: "flex", flexDirection: "column", gap: 6,
        minWidth: 0,
      }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: "#F5498B", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", flex: 1 }}>
            ⌖ Publish to ORBAT Manager
          </span>
          {alreadyPublished && publishStatus.kind === "idle" && (
            <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2, background: "rgba(245,73,139,0.12)", color: "#F5498B", fontWeight: 700, letterSpacing: "0.04em" }}>
              Previously published
            </span>
          )}
        </div>

        {/* Description */}
        <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", lineHeight: 1.45 }}>
          {alreadyPublished
            ? <>
                Updates the existing{" "}
                <strong style={{ color: "#c8cdd8" }}>[NXG-O] Template Orbat Graph</strong>{" "}
                record(s) for this phase — re-runs{" "}
                <code style={{ fontSize: 9, background: "rgba(255,255,255,0.05)", borderRadius: 2, padding: "0 3px" }}>LLM_PhaseToORBAT</code>{" "}
                on the current map state and writes the new ORBAT over the existing record. No duplicate is created.
              </>
            : <>
                Splits the placed units by side (Blue / Red), runs each side through{" "}
                <code style={{ fontSize: 9, background: "rgba(255,255,255,0.05)", borderRadius: 2, padding: "0 3px" }}>LLM_PhaseToORBAT</code>,
                and saves one{" "}
                <strong style={{ color: "#c8cdd8" }}>[NXG-O] Template Orbat Graph</strong>{" "}
                record per side. Both sides present →{" "}
                <em style={{ color: "#9fa8da" }}>"{"{operation} - {phase} - Blue ORBAT Template"}"</em>{" "}
                and{" "}
                <em style={{ color: "#9fa8da" }}>"{"…Red ORBAT Template"}"</em>. Only one side present →{" "}
                <em style={{ color: "#9fa8da" }}>"{"{operation} - {phase} - ORBAT Template"}"</em>.{" "}
                The records appear in the ORBAT Manager under <em>Hierarchy → Phase</em>.
              </>
          }
        </p>

        {/* Action button — opens the publish dialog */}
        <button
          type="button"
          onClick={() => { if (!isRunning) { setParentNodeName(""); setShowPublishDialog(true); } }}
          disabled={isRunning}
          style={{
            alignSelf: "flex-start",
            padding: "5px 14px",
            background: isRunning ? "rgba(245,73,139,0.08)" : "rgba(245,73,139,0.15)",
            border: "1px solid rgba(245,73,139,0.4)",
            borderRadius: 3,
            color: isRunning ? "#c44080" : "#F5498B",
            cursor: isRunning ? "default" : "pointer",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "background 0.15s, border-color 0.15s",
          }}
          onMouseEnter={(e) => { if (!isRunning) (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,73,139,0.22)"; }}
          onMouseLeave={(e) => { if (!isRunning) (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,73,139,0.15)"; }}
          title={alreadyPublished
            ? "Re-run the pipeline and update the existing [NXG-O] Template Orbat Graph record"
            : "Run the pipeline and create a new [NXG-O] Template Orbat Graph record in the ontology"}
        >
          {isRunning
            ? <><span style={{ fontSize: 12, animation: "sp-spin 1s linear infinite", display: "inline-block" }}>⟳</span> {stepLabel[(publishStatus as Extract<PublishStatus, {kind:"running"}>).step]}</>
            : <><span style={{ fontSize: 13 }}>⌖</span>{alreadyPublished ? " Re-publish Composition" : " Publish Composition"}</>
          }
        </button>

        {/* ── Publish dialog ─────────────────────────────────────────────── */}
        {showPublishDialog && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 9000,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowPublishDialog(false); }}
          >
            <div style={{
              background: "var(--bg-surface-flat)",
              border: "1px solid var(--border-default)",
              borderRadius: 6,
              padding: "20px 22px",
              width: 380,
              maxWidth: "90vw",
              boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
              display: "flex", flexDirection: "column", gap: 14,
            }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Dialog header */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, color: "#F5498B" }}>⌖</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>
                  {alreadyPublished ? "Re-publish Composition" : "Publish Composition"}
                </span>
                <button
                  type="button"
                  onClick={() => setShowPublishDialog(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16, padding: "0 2px", lineHeight: 1 }}
                >×</button>
              </div>

              {/* Parent node name field */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Parent node name
                  <span style={{ fontSize: 9, fontWeight: 400, color: "var(--border-default)", textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>
                    (optional)
                  </span>
                </label>
                <p style={{ margin: 0, fontSize: 10, color: "var(--border-strong)", lineHeight: 1.45 }}>
                  The name given to the top-level unit in the ORBAT tree (the parent node all other units sit under).
                  Leave blank to use the phase description as the node name.
                </p>
                <input
                  autoFocus
                  type="text"
                  value={parentNodeName}
                  onChange={(e) => setParentNodeName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { setShowPublishDialog(false); void handlePublish(parentNodeName); }
                    if (e.key === "Escape") setShowPublishDialog(false);
                  }}
                  placeholder={`e.g. 3 PARA BG, TF IRON, ${phase.name} HQ…`}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "7px 10px",
                    background: "#0d0f14", border: "1px solid var(--border-default)",
                    borderRadius: 3, color: "var(--text-primary)",
                    fontSize: 12, fontFamily: "inherit", outline: "none",
                  }}
                />
              </div>

              {/* Dialog actions */}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowPublishDialog(false)}
                  style={{
                    padding: "5px 14px", background: "transparent",
                    border: "1px solid var(--border-default)", borderRadius: 3,
                    color: "#8a92a8", cursor: "pointer", fontSize: 11,
                    fontFamily: "inherit",
                  }}
                >Cancel</button>
                <button
                  type="button"
                  onClick={() => { setShowPublishDialog(false); void handlePublish(parentNodeName); }}
                  style={{
                    padding: "5px 16px",
                    background: "rgba(245,73,139,0.18)",
                    border: "1px solid rgba(245,73,139,0.5)",
                    borderRadius: 3, color: "#F5498B",
                    cursor: "pointer", fontSize: 11, fontWeight: 700,
                    letterSpacing: "0.05em", fontFamily: "inherit",
                  }}
                >
                  ⌖ {alreadyPublished ? "Re-publish" : "Publish"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Result / error feedback */}
        {publishStatus.kind === "success" && (() => {
          const bySide = publishStatus.bySide;
          const sideEntries = bySide
            ? (["blue", "red"] as const).filter((s) => !!bySide[s]).map((s) => ({ side: s, res: bySide[s]! }))
            : [];
          const isSplit = sideEntries.length > 1;
          // Was this a create or an update? We can infer from whether bySide
          // has templateName fields populated (create path) or not (update path
          // returns an empty bySide).
          const wasUpdate = !bySide || Object.keys(bySide).length === 0;

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "6px 8px", background: "rgba(91,173,111,0.08)", border: "1px solid rgba(91,173,111,0.25)", borderRadius: 3 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <span style={{ color: "#5bad6f", fontSize: 13, flexShrink: 0 }}>✓</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#5bad6f", fontWeight: 600 }}>
                    {wasUpdate
                      ? "ORBAT updated — existing record replaced in ORBAT Manager"
                      : isSplit
                        ? `Saved ${sideEntries.length} [NXG-O] Template Orbat Graph records — ORBAT Manager updated`
                        : "Saved to [NXG-O] Template Orbat Graph — ORBAT Manager updated"}
                  </div>

                  {isSplit ? (
                    // ── Both sides: list each template with its side badge ──
                    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                      {sideEntries.map(({ side, res }) => {
                        const sideColor = side === "blue" ? "#4A90D9" : "#E85A5A";
                        const sideLabel = side === "blue" ? "BLUE" : "RED";
                        return (
                          <div key={side} style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 1, borderLeft: `2px solid ${sideColor}`, paddingLeft: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.06em", color: sideColor }}>
                                {sideLabel}
                              </span>
                              <span style={{ color: "#c8cdd8", fontSize: 10 }}>{res.templateName}</span>
                            </div>
                            <div style={{ fontSize: 9 }}>
                              id: <code style={{ fontSize: 9, background: "rgba(255,255,255,0.04)", borderRadius: 2, padding: "0 3px", wordBreak: "break-all", overflowWrap: "anywhere" }}>{res.mapStateId}</code>
                              {res.orbatJson && <span> · {Math.round(res.orbatJson.length / 1024 * 10) / 10} KB</span>}
                              {!res.orbatJson && <span style={{ color: "var(--accent-amber)" }}> · ⚠ raw fallback (LLM returned no output)</span>}
                            </div>
                          </div>
                        );
                      })}
                      <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 3 }}>
                        Visible in ORBAT Manager → Hierarchy tab
                      </div>
                    </div>
                  ) : (
                    // ── Single side or update path ──
                    <>
                      {publishStatus.mapStateId && (
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                          record id: <code style={{ fontSize: 9, background: "rgba(255,255,255,0.04)", borderRadius: 2, padding: "0 3px", wordBreak: "break-all", overflowWrap: "anywhere" }}>{publishStatus.mapStateId}</code>
                        </div>
                      )}
                      {!wasUpdate && !publishStatus.orbatJson && (
                        <div style={{ fontSize: 10, color: "var(--accent-amber)", marginTop: 3 }}>
                          ⚠ LLM_PhaseToORBAT returned no output — raw unit data stored instead. The ORBAT Manager will show a parse error badge.
                        </div>
                      )}
                      {!wasUpdate && publishStatus.orbatJson && (
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                          ORBAT JSON: {Math.round(publishStatus.orbatJson.length / 1024 * 10) / 10} KB · visible in ORBAT Manager → Hierarchy tab
                        </div>
                      )}
                      {wasUpdate && (
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                          Visible in ORBAT Manager → Hierarchy tab
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
        {publishStatus.kind === "error" && (() => {
          // Classify the error for a more helpful headline
          const raw = publishStatus.message ?? "";
          const lower = raw.toLowerCase();
          let headline = "Pipeline failed";
          let hint: string | null = null;

          if (lower.includes("no units on the map")) {
            headline = "No units on the map";
            hint = "Place units before publishing this phase.";
          } else if (lower.includes("failed to fetch 400") || lower.includes("400")) {
            headline = "Ontology rejected the request (400)";
            hint = "The action parameters were invalid. Check createdAt format, tags length, or templateJson size in devtools.";
          } else if (lower.includes("failed to fetch 401") || lower.includes("failed to fetch 403") || lower.includes("permission")) {
            headline = "Not authorised (401/403)";
            hint = "Your Foundry token does not permit createNxgOtemplateOrbatGraph. Ask an admin to grant the action.";
          } else if (lower.includes("failed to fetch 404")) {
            headline = "Action or query not found (404)";
            hint = "The SDK may be out of date. Try refreshing the browser to reload the current OSDK bundle.";
          } else if (lower.includes("failed to fetch 500")) {
            headline = "Foundry returned a server error (500)";
            hint = "Retry in a moment. If it persists the ontology action is misconfigured.";
          } else if (lower.includes("llm call failed") || lower.includes("llm_phasetoorbat")) {
            headline = "LLM_PhaseToORBAT rejected the input";
            hint = "The LLM function returned an error — check devtools for the underlying HTTP response.";
          } else if (lower.includes("failed to serialise") || lower.includes("serialise")) {
            headline = "Could not serialise the map state";
          } else if (lower.includes("not valid json") || lower.includes("malformed")) {
            headline = "The LLM output was malformed";
            hint = "Re-publish to try again — the model occasionally emits invalid JSON.";
          }

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 8px", background: "rgba(239,154,154,0.07)", border: "1px solid rgba(239,154,154,0.25)", borderRadius: 3 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <span style={{ color: "#ef9a9a", fontSize: 13, flexShrink: 0 }}>⚠</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#ef9a9a", fontWeight: 700 }}>{headline}</div>
                  <div style={{ fontSize: 10, color: "#ef9a9a", marginTop: 3, lineHeight: 1.5, wordBreak: "break-word" }}>{raw}</div>
                  {hint && (
                    <div style={{ fontSize: 10, color: "var(--accent-amber)", marginTop: 4, lineHeight: 1.4, fontStyle: "italic" }}>
                      💡 {hint}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
                    <button
                      type="button"
                      onClick={() => setPublishStatus({ kind: "idle" })}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 9, padding: 0, textDecoration: "underline", fontFamily: "inherit" }}
                    >dismiss</button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(raw);
                      }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 9, padding: 0, textDecoration: "underline", fontFamily: "inherit" }}
                    >copy full error</button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Snapshot toolbar ──────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 10px",
        borderBottom: "1px solid var(--border-default)",
        flexShrink: 0,
        background: "var(--bg-surface-flat)",
      }}>
        <span style={{ fontSize: 9, color: "var(--text-muted)", flex: 1, letterSpacing: "0.06em", fontWeight: 600 }}>
          MAP STATE SNAPSHOT
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          style={{
            background: "none", border: "1px solid var(--border-default)", borderRadius: 2,
            color: "var(--text-muted)", cursor: "pointer", fontSize: 9, padding: "2px 7px",
            letterSpacing: "0.05em",
          }}
          title="Re-read map state"
        >↻ REFRESH</button>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            background: copied ? "rgba(91,173,111,0.12)" : "none",
            border: `1px solid ${copied ? "rgba(91,173,111,0.5)" : "var(--border-default)"}`,
            borderRadius: 2, color: copied ? "#5bad6f" : "var(--text-muted)",
            cursor: "pointer", fontSize: 9, padding: "2px 7px", letterSpacing: "0.05em",
            transition: "all 0.15s",
          }}
          title="Copy to clipboard"
        >
          {copied ? "✓ COPIED" : "⎘ COPY"}
        </button>
      </div>

      {/* Monospace document.
          The whole Composition tab is one scroll container (see wrapper
          above), so this pane no longer takes flex: 1 or its own
          overflow. `white-space: pre-wrap` + `word-break: break-word`
          wraps long unit descriptions / MGRS strings so the panel never
          needs horizontal scrolling. `overflow-wrap: anywhere` catches
          the pathological very-long-token case (e.g. copy-pasted URLs
          in descriptions). */}
      <pre style={{
        margin: 0,
        padding: "10px 12px",
        fontFamily: '"Courier New", "Consolas", monospace',
        fontSize: 10,
        lineHeight: 1.55,
        color: "#c8cdd8",
        background: "#0d0f14",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        tabSize: 2,
        minWidth: 0,
      }}>
        {doc}
      </pre>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PhaseDetail({
  phase,
  phaseIndex,
  allPhases: _allPhases,
  branchesBySource: _branchesBySource = {},
  branchSiblings = [],
  onSelectBranch,
  onForkPhase,
  onClose,
  onRename,
  readOnly,
  onPhaseUpdate,
  onPhaseDelete,
  ordersTabProps,
  orbatTabProps,
  tasks,
  onTaskSelected,
  audiences,
  onAudienceSelected,
  pmesiiDomains,
  onPmesiiSelected,
  objectives,
  onObjectiveSelected,
  injects,
  onInjectSelected,
  onReadMapState,
  onMapStateChanged,
  onPublishToOrbat,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("OVERVIEW");

  const isOpen = phase !== null;
  const colour = phase ? getPhaseColour(phaseIndex) : "#4a90d9";
  const phaseIdLabel = `PHASE ${String(phaseIndex + 1).padStart(2, "0")}`;

  // ── Task selection state ───────────────────────────────────────────────────
  // Tracks the currently-selected task so the row stays highlighted while the
  // user works in the Task Management screen (Workshop side reacts to the
  // onTaskSelected event we fire below).
  const allTasks = tasks ?? [];
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // ── Audience selection state ──────────────────────────────────────────────
  // Mirrors the task selection pattern above so the row remains highlighted
  // while the user works in the Task Management / Training Audience screen.
  const allAudiences = audiences ?? [];
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | null>(null);

  // ── PMESII selection state ────────────────────────────────────────────────
  // Mirrors the task/audience selection pattern above so the row remains
  // highlighted while the user works in the PMESII screen.
  const allPmesiiDomains = pmesiiDomains ?? [];
  const [selectedPmesiiId, setSelectedPmesiiId] = useState<string | null>(null);

  // ── Training Objective selection state ───────────────────────────────────
  // Mirrors the task/audience/pmesii selection pattern above so the row
  // remains highlighted while the user works in the Task Management screen
  // (Workshop side reacts to the onObjectiveSelected event we fire below).
  const allObjectives = objectives ?? [];
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(
    null,
  );

  // ── Inject selection state ────────────────────────────────────────────────
  // Mirrors the task/audience/pmesii/objective selection pattern above so the
  // row remains highlighted while the user works in the MIL & MEL screen
  // (Workshop side reacts to the onInjectSelected event we fire below).
  const allInjects = injects ?? [];
  const [selectedInjectId, setSelectedInjectId] = useState<string | null>(null);
  // Reset the highlighted task/audience/pmesii/objective/inject whenever the
  // open phase changes.
  useEffect(() => {
    setSelectedTaskId(null);
    setSelectedAudienceId(null);
    setSelectedPmesiiId(null);
    setSelectedObjectiveId(null);
    setSelectedInjectId(null);
  }, [phase?.id]);

  function handleTaskClick(taskId: string) {
    setSelectedTaskId(taskId);
    onTaskSelected?.(taskId);
  }

  function handleAudienceClick(audienceId: string) {
    setSelectedAudienceId(audienceId);
    onAudienceSelected?.(audienceId);
  }

  function handlePmesiiClick(domainId: string) {
    setSelectedPmesiiId(domainId);
    onPmesiiSelected?.(domainId);
  }

  function handleObjectiveClick(objectiveId: string) {
    setSelectedObjectiveId(objectiveId);
    onObjectiveSelected?.(objectiveId);
  }

  function handleInjectClick(injectId: string) {
    setSelectedInjectId(injectId);
    onInjectSelected?.(injectId);
  }

  // ── Inline rename state ────────────────────────────────────────────────────
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Delete confirmation state ──────────────────────────────────────────────
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset the delete-confirmation UI whenever the open phase changes
  useEffect(() => {
    setConfirmingDelete(false);
  }, [phase?.id]);

  const canDelete = !readOnly && !!onPhaseDelete && !!phase;

  function handleDeleteClick() {
    if (!canDelete) return;
    setConfirmingDelete(true);
  }

  function handleConfirmDelete() {
    if (!phase || !onPhaseDelete) return;
    onPhaseDelete(phase.id);
    setConfirmingDelete(false);
  }

  function handleCancelDelete() {
    setConfirmingDelete(false);
  }

  // Reset edit mode whenever the open phase changes
  useEffect(() => {
    setIsEditingName(false);
    setDraftName(phase?.name ?? "");
  }, [phase?.id, phase?.name]);

  // Auto-focus & select when entering edit mode
  useEffect(() => {
    if (isEditingName && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingName]);

  function commitName() {
    if (!phase) {
      setIsEditingName(false);
      return;
    }
    const next = draftName.trim();
    if (next.length > 0 && next !== phase.name) {
      onRename?.(phase.id, next);
    } else {
      // Revert preview text to whatever the phase actually has
      setDraftName(phase.name);
    }
    setIsEditingName(false);
  }

  function cancelName() {
    setDraftName(phase?.name ?? "");
    setIsEditingName(false);
  }

  function handleNameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitName();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelName();
    }
  }

  return (
    <aside
      className={`${"sp-detail-panel"} ${isOpen ? "sp-detail-panel--open" : ""}`}
      aria-label="Phase detail"
      aria-hidden={!isOpen}
    >
      {phase && (
        <div className={"sp-detail-panel__inner"}>
          {/* Header */}
          <div className={"sp-detail__header"}>
            <div className={"sp-detail__top-row"}>
              <div className={"sp-detail__title-col"}>
                <div className={"sp-detail__phase-label"}>{phaseIdLabel}</div>
                {isEditingName && !readOnly ? (
                  <input
                    ref={inputRef}
                    type="text"
                    className={"sp-detail__name-input"}
                    style={{ borderLeftColor: colour }}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitName}
                    onKeyDown={handleNameKey}
                    maxLength={80}
                    aria-label="Edit phase name"
                  />
                ) : (
                  <button
                    type="button"
                    className={`${"sp-detail__name"} ${
                      readOnly ? "" : "sp-detail__name sp-editable"
                    }`}
                    style={{ borderLeftColor: colour }}
                    title={readOnly ? phase.name : "Click to rename phase"}
                    onClick={() => {
                      if (readOnly) return;
                      setDraftName(phase.name);
                      setIsEditingName(true);
                    }}
                    aria-label={
                      readOnly
                        ? phase.name
                        : `Edit phase name: ${phase.name}`
                    }
                  >
                    <span className={"sp-detail__name-text"}>{phase.name}</span>
                    {!readOnly && (
                      <span
                        className={"sp-editable__pencil"}
                        aria-hidden="true"
                      >
                        ✎
                      </span>
                    )}
                  </button>
                )}
              </div>
              <div className={"sp-detail__actions"}>
                {canDelete && (
                  <button
                    className={"sp-detail__delete-btn"}
                    onClick={handleDeleteClick}
                    aria-label="Delete phase"
                    title="Delete phase"
                  >
                    🗑
                  </button>
                )}
                <button
                  className={"sp-detail__close-btn"}
                  onClick={onClose}
                  aria-label="Close phase detail"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Delete confirmation strip */}
            {confirmingDelete && phase && (
              <div className={"sp-detail__delete-confirm"} role="alertdialog" aria-label="Confirm delete phase">
                <div className={"sp-detail__delete-text"}>
                  Delete <strong>{phase.name}</strong>? This will remove the phase
                  and any of its ORBAT items from the map.
                </div>
                <div className={"sp-detail__delete-btns"}>
                  <button
                    type="button"
                    className={"sp-btn--sm sp-btn--outline"}
                    onClick={handleCancelDelete}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={"sp-btn--sm sp-btn--danger"}
                    onClick={handleConfirmDelete}
                  >
                    Delete phase
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* Horizontal tab strip — all tabs always visible, sharing the
              panel width evenly. Full labels wrap to two lines if needed. */}
          <nav
            className={"sp-detail__tab-nav"}
            role="tablist"
            aria-label="Phase detail sections"
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  className={`${"sp-detail__tab-btn"} ${
                    isActive ? "sp-detail__tab-btn--active" : ""
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.label}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Tab content
              Sub Phases tab manages its own internal scroll + pinned create button,
              so we strip padding and let it fill the remaining height directly.
              All other tabs get the standard padded scroll container. */}
          <div
            className={activeTab === "SUB_PHASES" ? "sp-detail__tab-content" : "sp-detail__tab-content sp-scroll"}
            style={activeTab === "SUB_PHASES" ? { padding: 0, overflowY: "hidden" } : {}}
            role="tabpanel"
            aria-label={`${activeTab} tab content`}
          >
            {activeTab === "SUB_PHASES" && (
              <BranchSelector
                selectedPhase={phase}
                branchSiblings={branchSiblings}
                allPhases={_allPhases}
                onSelectBranch={onSelectBranch ?? (() => {})}
                onForkPhase={readOnly ? undefined : onForkPhase}
              />
            )}
            {activeTab === "OVERVIEW" && (
              <OverviewTab
                phase={phase}
                onPhaseUpdate={onPhaseUpdate}
                readOnly={readOnly}
              />
            )}
            {activeTab === "ORDERS" && ordersTabProps && (
              <OrdersTab
                phase={phase}
                readOnly={readOnly}
                {...ordersTabProps}
              />
            )}
            {activeTab === "ORBAT" && (
              <OrbatTab
                readOnly={readOnly}
                {...(orbatTabProps ?? {
                  hasSelection: false,
                  root: null,
                  nodeCount: 0,
                  truncated: false,
                  loading: false,
                  error: null,
                })}
              />
            )}
            {activeTab === "ORDERS" && !ordersTabProps && (
              <div className="sp-detail__empty">
                <span className="sp-detail__empty-icon" aria-hidden="true">⚔️</span>
                <p className="sp-detail__empty-text">Orders generation not available for this phase.</p>
              </div>
            )}
            {activeTab === "TASKS" && (
              <TasksTab
                phase={phase}
                allTasks={allTasks}
                selectedTaskId={selectedTaskId}
                onTaskSelected={handleTaskClick}
              />
            )}
            {activeTab === "AUDIENCE" && (
              <AudienceTab
                phase={phase}
                allAudiences={allAudiences}
                selectedAudienceId={selectedAudienceId}
                onAudienceSelected={handleAudienceClick}
              />
            )}
            {activeTab === "COMPOSITION" && (
              <MapStateTab
                phase={phase}
                phaseIndex={phaseIndex}
                onReadMapState={onReadMapState}
                onMapStateChanged={onMapStateChanged}
                onPublishToOrbat={onPublishToOrbat}
                allTasks={allTasks}
                allAudiences={allAudiences}
                allObjectives={allObjectives}
                allInjects={allInjects}
                allPmesiiDomains={allPmesiiDomains}
              />
            )}
            {activeTab === "PMSEII" && (
              <PmesiiTab
                phase={phase}
                allDomains={allPmesiiDomains}
                selectedDomainId={selectedPmesiiId}
                onPmesiiSelected={handlePmesiiClick}
              />
            )}
            {activeTab === "OBJECTIVES" && (
              <ObjectivesTab
                phase={phase}
                allObjectives={allObjectives}
                selectedObjectiveId={selectedObjectiveId}
                onObjectiveSelected={handleObjectiveClick}
              />
            )}
            {activeTab === "MIL_MEL" && (
              <MelMilTab
                phase={phase}
                allInjects={allInjects}
                selectedInjectId={selectedInjectId}
                onInjectSelected={handleInjectClick}
              />
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

