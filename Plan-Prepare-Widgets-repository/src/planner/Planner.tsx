import { Icon } from "@blueprintjs/core";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../client.js";
import { NxgScenario } from "@custom-widget/sdk";
import { useNxgScenarioListFromObjectSet } from "../shared/hooks/useNxgScenarioList.js";
import { scenarioToWork } from "./scenarioWork.js";
import type { OngoingWork, WorkCategory } from "./scenarioWork.js";
import "../shared/styling/index.css";
import "./planner.css";
import type PlannerConfig from "./planner.config.js";
import {
  useScenarioGeneration,
  usePPDocuments,
  PIPELINE_STEPS,
  PIPELINE_STEP_SHORT,
  PIPELINE_STEP_ICONS,
  type ExistingDocument,
  type TraceEntry,
  type GenerationState,
  type PendingApproval,
} from "./useScenarioGeneration.js";

const useWidgetContext =
  useFoundryWidgetContext.withTypes<typeof PlannerConfig>();

// ─────────────────────────────────────────────────────────────────────────────
// Types & static data
// ─────────────────────────────────────────────────────────────────────────────

type ExerciseType = "cax" | "caw" | "planning" | "analysis";
type CreationMethod = "template" | "ai";

interface TeamMember {
  id: string;
  initials: string;
  name: string;
  role: string;
  color: string;
}

interface WorkflowTask {
  id: string;
  group: string;
  name: string;
  desc: string;
  ai?: boolean;
  approver: string;
  owner: string;
  due: string;
  status: "assigned" | "review" | "pending";
}

const EX_TYPES: {
  id: ExerciseType;
  name: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "cax",
    name: "Computer Assisted\nExercise",
    desc: "Simulation-driven exercise with full HQ staff, MEL/MIL, ORBAT and scenario.",
    icon: <Icon icon="layers" size={22} />,
  },
  {
    id: "caw",
    name: "Computer Assisted\nWargaming",
    desc: "Structured adversarial decision simulation with OPFOR control and turn-based play.",
    icon: <Icon icon="grid" size={22} />,
  },
  {
    id: "planning",
    name: "Operational\nPlanning",
    desc: "Course of action development, analysis, and comparison to support operational decisions.",
    icon: <Icon icon="document" size={22} />,
  },
  {
    id: "analysis",
    name: "Operational\nAnalysis",
    desc: "Data-driven assessment of operations, lessons learned, and performance against objectives.",
    icon: <Icon icon="timeline-bar-chart" size={22} />,
  },
];

const TEAM_MEMBERS: TeamMember[] = [
  {
    id: "bg",
    initials: "BG",
    name: "BGen Hartmann",
    role: "Exercise Director",
    color: "#4c7ef3",
  },
  {
    id: "al",
    initials: "AL",
    name: "Col Anderssen",
    role: "Exercise Director",
    color: "#24b47e",
  },
  {
    id: "mk",
    initials: "MK",
    name: "LtCol Kowalski",
    role: "Scenario Director",
    color: "#8b5cf6",
  },
  {
    id: "jr",
    initials: "JR",
    name: "Maj Roos",
    role: "J8 Exercise Planner",
    color: "#f0a83c",
  },
  {
    id: "tw",
    initials: "TW",
    name: "Maj Westergaard",
    role: "Deputy Planning PMO",
    color: "#6c5ce7",
  },
];

const WORKFLOW_TASKS: WorkflowTask[] = [
  // ── Planning & Design ─────────────────────────────────────────────────
  {
    id: "wt-scenario",
    group: "Planning & Design",
    name: "Scenario design",
    desc: "Strategic context, OPFOR definition, and exercise area narrative",
    ai: true,
    approver: "al",
    owner: "mk",
    due: "D-55",
    status: "assigned",
  },
  {
    id: "wt-training-objectives",
    group: "Planning & Design",
    name: "Training objectives",
    desc: "Training objectives across J-directorates",
    ai: true,
    approver: "bg",
    owner: "al",
    due: "D-55",
    status: "assigned",
  },
  {
    id: "wt-training-audience",
    group: "Planning & Design",
    name: "Training audience",
    desc: "Primary and secondary audiences, participating nations, participant numbers",
    ai: false,
    approver: "bg",
    owner: "al",
    due: "D-65",
    status: "review",
  },
  {
    id: "wt-composition",
    group: "Planning & Design",
    name: "Composition",
    desc: "Simulation systems, C2 nodes, and federation architecture",
    ai: false,
    approver: "",
    owner: "",
    due: "D-50",
    status: "pending",
  },
  // ── Scenario & Environment ────────────────────────────────────────────
  {
    id: "wt-pmesii",
    group: "Scenario & Environment",
    name: "PMESII variables",
    desc: "All PMESII-PT domains",
    ai: true,
    approver: "al",
    owner: "tw",
    due: "D-45",
    status: "review",
  },
  {
    id: "wt-exercise-area",
    group: "Scenario & Environment",
    name: "Exercise area",
    desc: "AOR, key terrain features, and phase lines",
    ai: false,
    approver: "",
    owner: "",
    due: "D-40",
    status: "pending",
  },
  // ── Execution Planning ────────────────────────────────────────────────
  {
    id: "wt-mel-p1",
    group: "Execution Planning",
    name: "MEL/MIL — Phase 1",
    desc: "Phase 1 injects: INTEL and CYBER events D+0 to D+2",
    ai: true,
    approver: "al",
    owner: "mk",
    due: "D-30",
    status: "review",
  },
  {
    id: "wt-mel-p2",
    group: "Execution Planning",
    name: "MEL/MIL — Phase 2",
    desc: "Phase 2 injects: METOC and INTEL events D+3 to D+6",
    ai: true,
    approver: "al",
    owner: "mk",
    due: "D-30",
    status: "pending",
  },
  {
    id: "wt-mel-p3",
    group: "Execution Planning",
    name: "MEL/MIL — Phase 3",
    desc: "Phase 3 injects: LOG and POLMIL events D+7 to D+10",
    ai: true,
    approver: "al",
    owner: "mk",
    due: "D-30",
    status: "pending",
  },
  {
    id: "wt-mel-p4",
    group: "Execution Planning",
    name: "MEL/MIL — Phase 4",
    desc: "Phase 4 injects: INFO OPS events D+11 to D+14",
    ai: true,
    approver: "al",
    owner: "mk",
    due: "D-30",
    status: "pending",
  },
  {
    id: "wt-orbat",
    group: "Execution Planning",
    name: "ORBAT & positions",
    desc: "Force structure and start positions on map",
    ai: false,
    approver: "",
    owner: "",
    due: "D-21",
    status: "pending",
  },
];

const STATUS_LABEL: Record<
  WorkflowTask["status"],
  { label: string; cls: string }
> = {
  assigned: { label: "Assigned", cls: "workflow-status--assigned" },
  review: { label: "In review", cls: "workflow-status--review" },
  pending: { label: "Pending", cls: "workflow-status--pending" },
};

const STEPS = [
  "Exercise type",
  "Creation method",
  "Scenario description",
  "Workflow & team",
];

// ─────────────────────────────────────────────────────────────────────────────
// Home screen data
// ─────────────────────────────────────────────────────────────────────────────

// WorkCategory and OngoingWork now live in ./scenarioWork, which also
// maps real NxgScenario objects onto the card shape. The hard-coded
// ONGOING_WORK array that used to sit here advertised exercises that did
// not exist in the ontology.

const START_NEW_ITEMS: {
  id: string;
  icon: "layers" | "grid" | "document" | "timeline-bar-chart";
  name: string;
  desc: string;
  category: Exclude<WorkCategory, "all">;
}[] = [
  {
    id: "cax",
    icon: "layers",
    name: "New CAX Exercise",
    desc: "Scenario · forces · objectives",
    category: "cax",
  },
  {
    id: "wargame",
    icon: "grid",
    name: "New Wargame",
    desc: "Cells · turns · adjudication",
    category: "wargame",
  },
  {
    id: "oplan",
    icon: "document",
    name: "New Operational Plan",
    desc: "COAs · sync · approval",
    category: "planning",
  },
  {
    id: "analysis",
    icon: "timeline-bar-chart",
    name: "New Analysis",
    desc: "Model · data · findings",
    category: "analysis",
  },
];

/**
 * Summary tiles, counted from the exercises actually in the ontology.
 * These were previously hard-coded ("4 Active Exercises"), which would now
 * contradict the list of real exercises sitting directly beneath them.
 */
function orgStatsFor(work: OngoingWork[]) {
  const count = (category: OngoingWork["category"]) =>
    String(work.filter((w) => w.category === category).length);
  return [
    {
      value: count("cax"),
      label: "Active Exercises",
      icon: "layers" as const,
      color: "#4c7ef3",
    },
    {
      value: count("wargame"),
      label: "Wargames in Progress",
      icon: "grid" as const,
      color: "#8b5cf6",
    },
    {
      value: count("planning"),
      label: "Operational Plans",
      icon: "document" as const,
      color: "#24b47e",
    },
    {
      value: count("analysis"),
      label: "Analysis Projects",
      icon: "timeline-bar-chart" as const,
      color: "#f0a83c",
    },
  ];
}

interface UpcomingDeadline {
  day: string;
  month: string;
  title: string;
  meta: string;
  urgency: "soon" | "days" | "week";
}

const UPCOMING_DEADLINES: UpcomingDeadline[] = [
  {
    day: "16",
    month: "SEP",
    title: "STARTEX readiness gate",
    meta: "Northern Shield CAX 26",
    urgency: "soon",
  },
  {
    day: "17",
    month: "SEP",
    title: "COA 2 decision brief",
    meta: "Joint Air-Land Operational Plan",
    urgency: "soon",
  },
  {
    day: "18",
    month: "SEP",
    title: "Wargame turn-4 adjudication",
    meta: "Baltic Deterrence Wargame",
    urgency: "days",
  },
  {
    day: "20",
    month: "SEP",
    title: "OA-217 draft findings due",
    meta: "Logistic Vulnerability Analysis",
    urgency: "week",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Searchable index — all content that should be findable
// ─────────────────────────────────────────────────────────────────────────────

type SearchCategory = "exercise" | "task" | "event" | "wargame" | "planning";

interface SearchItem {
  id: string;
  category: SearchCategory;
  title: string;
  meta: string;
  badge: string;
  badgeColor: string;
  icon: string;
  iconColor: string;
  progress?: number;
  progressColor?: string;
}

/** Turns a live work card into a search result row. */
function workToSearchItem(w: OngoingWork): SearchItem {
  return {
    id: w.id,
    category: (w.category === "cax"
      ? "exercise"
      : w.category === "wargame"
      ? "wargame"
      : w.category === "planning"
      ? "planning"
      : "exercise") as SearchCategory,
    title: w.title,
    meta: w.subtitle,
    badge: w.categoryLabel,
    badgeColor: w.categoryColor,
    icon:
      w.category === "cax"
        ? "layers"
        : w.category === "wargame"
        ? "grid"
        : w.category === "analysis"
        ? "timeline-bar-chart"
        : "document",
    iconColor: w.categoryColor,
    progress: w.progress,
    progressColor: w.progressColor,
  };
}

// Search rows that are not exercises. The exercise rows are derived from
// the live scenario list inside HomeScreen, so search finds real work.
const STATIC_SEARCH_ITEMS: SearchItem[] = [
  ...UPCOMING_DEADLINES.map((d, i) => ({
    id: `dl-${i}`,
    category: "event" as SearchCategory,
    title: d.title,
    meta: `${d.day} ${d.month} · ${d.meta}`,
    badge: "Deadline",
    badgeColor:
      d.urgency === "soon"
        ? "#ef4d4d"
        : d.urgency === "days"
        ? "#f0a83c"
        : "#6a7292",
    icon: "calendar",
    iconColor: "#6a7292",
  })),
  // workflow tasks
  ...WORKFLOW_TASKS.map((t) => ({
    id: `wf-${t.id}`,
    category: "task" as SearchCategory,
    title: t.name,
    meta: `${t.group} · Due ${t.due}`,
    badge: t.status.charAt(0).toUpperCase() + t.status.slice(1),
    badgeColor:
      t.status === "assigned"
        ? "#24b47e"
        : t.status === "review"
        ? "#f0a83c"
        : "#6a7292",
    icon: "clipboard",
    iconColor: "#6a7292",
  })),
];

const CATEGORY_LABELS: Record<SearchCategory, string> = {
  exercise: "Exercises",
  wargame: "Wargames",
  planning: "Planning",
  task: "Tasks",
  event: "Events",
};

// ─────────────────────────────────────────────────────────────────────────────
// Notification system
// ─────────────────────────────────────────────────────────────────────────────

type NotifType =
  | "approval"
  | "assignment"
  | "change"
  | "mention"
  | "deadline"
  | "system";

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  desc: string;
  time: string;
  read: boolean;
  iconColor: string;
  icon: string;
}

const INITIAL_NOTIFICATIONS: Notification[] = [
  {
    id: "n1",
    type: "approval",
    read: false,
    title: "Approval required: Scenario design",
    desc: "LtCol Kowalski submitted 'Scenario design' for your approval on STEADFAST DEFENDER 26",
    time: "2 min ago",
    iconColor: "#f0a83c",
    icon: "tick-circle",
  },
  {
    id: "n2",
    type: "approval",
    read: false,
    title: "Approval required: Training objectives",
    desc: "Col Anderssen submitted 'Training objectives' for your approval on STEADFAST DEFENDER 26",
    time: "14 min ago",
    iconColor: "#f0a83c",
    icon: "tick-circle",
  },
  {
    id: "n3",
    type: "assignment",
    read: false,
    title: "You were assigned as approver",
    desc: "BGen Hartmann assigned you as approver for 'MEL & MIL' on Baltic Crisis Wargame",
    time: "1 hr ago",
    iconColor: "#4c7ef3",
    icon: "person",
  },
  {
    id: "n4",
    type: "change",
    read: false,
    title: "Task status changed",
    desc: "'PMESII variables' moved to In Review — Maj Westergaard completed their section",
    time: "2 hr ago",
    iconColor: "#6c5ce7",
    icon: "refresh",
  },
  {
    id: "n5",
    type: "deadline",
    read: true,
    title: "Deadline approaching: Composition",
    desc: "'Composition' is due in 3 days (D-50) and has no owner assigned",
    time: "3 hr ago",
    iconColor: "#ef4d4d",
    icon: "warning-sign",
  },
  {
    id: "n6",
    type: "mention",
    read: true,
    title: "You were mentioned",
    desc: "Maj Roos mentioned you in a comment on COA Analysis: Northern Corridor",
    time: "Yesterday",
    iconColor: "#8b5cf6",
    icon: "chat",
  },
  {
    id: "n7",
    type: "assignment",
    read: true,
    title: "New task owner assignment",
    desc: "You were set as task owner for 'Exercise area' on STEADFAST DEFENDER 26",
    time: "Yesterday",
    iconColor: "#4c7ef3",
    icon: "person",
  },
  {
    id: "n8",
    type: "system",
    read: true,
    title: "Workflow confirmed",
    desc: "Exercise IRON FORGE 26 workflow was confirmed — 8 tasks assigned across 3 groups",
    time: "2 days ago",
    iconColor: "#24b47e",
    icon: "tick",
  },
];

type NotifFilter = "all" | "unread" | NotifType;

// ─────────────────────────────────────────────────────────────────────────────
// Notification Panel component
// ─────────────────────────────────────────────────────────────────────────────

function NotificationPanel({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClose,
}: {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<NotifFilter>("all");
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node))
        onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read;
    return n.type === filter;
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  const FILTER_TABS: { id: NotifFilter; label: string }[] = [
    { id: "all", label: "All" },
    {
      id: "unread",
      label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}`,
    },
    { id: "approval", label: "Approvals" },
    { id: "assignment", label: "Assignments" },
    { id: "deadline", label: "Deadlines" },
  ];

  const TYPE_LABEL: Record<NotifType, string> = {
    approval: "Approval",
    assignment: "Assignment",
    change: "Change",
    mention: "Mention",
    deadline: "Deadline",
    system: "System",
  };

  return (
    <div className="notif-panel" ref={panelRef}>
      {/* Header */}
      <div className="notif-panel__header">
        <div className="notif-panel__title">
          <Icon icon="notifications" size={13} />
          Notifications
        </div>
        <div className="notif-panel__actions">
          {unreadCount > 0 && (
            <button
              type="button"
              className="notif-panel__mark-all"
              onClick={onMarkAllRead}
            >
              Mark all read
            </button>
          )}
          <button
            type="button"
            className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only"
            onClick={onClose}
          >
            <Icon icon="cross" size={12} />
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="notif-panel__filter-row">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`notif-filter-chip${
              filter === tab.id ? " notif-filter-chip--active" : ""
            }`}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="notif-panel__body">
        {filtered.length === 0 ? (
          <div className="notif-panel__empty">
            <Icon icon="notifications" size={24} style={{ opacity: 0.2 }} />
            <span>No notifications</span>
          </div>
        ) : (
          filtered.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`notif-row${!n.read ? " notif-row--unread" : ""}`}
              onClick={() => {
                onMarkRead(n.id);
              }}
            >
              <div
                className="notif-row__icon"
                style={{ background: `${n.iconColor}22` }}
              >
                <Icon
                  icon={n.icon as "search"}
                  size={14}
                  style={{ color: n.iconColor }}
                />
              </div>
              <div className="notif-row__body">
                <div className="notif-row__title">
                  {!n.read && (
                    <span
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#4c7ef3",
                        marginRight: 5,
                        verticalAlign: "middle",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  {n.title}
                </div>
                <div className="notif-row__desc">{n.desc}</div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: n.iconColor,
                      background: `${n.iconColor}18`,
                      border: `1px solid ${n.iconColor}33`,
                      padding: "0 5px",
                      borderRadius: 2,
                    }}
                  >
                    {TYPE_LABEL[n.type]}
                  </span>
                  <span className="notif-row__time">{n.time}</span>
                </div>
              </div>
              <button
                type="button"
                className="notif-row__dismiss"
                title="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(n.id);
                }}
              >
                <Icon icon="cross" size={10} />
              </button>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// All Activities overlay
// ─────────────────────────────────────────────────────────────────────────────

type ActivityFilter = "all" | SearchCategory;

function ActivitiesOverlay({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [localSearch, setLocalSearch] = useState("");

  const filtered = STATIC_SEARCH_ITEMS.filter((item) => {
    const matchCat = filter === "all" || item.category === filter;
    const q = localSearch.toLowerCase();
    const matchQ =
      !q ||
      item.title.toLowerCase().includes(q) ||
      item.meta.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  const FILTER_TABS: { id: ActivityFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "exercise", label: "Exercises" },
    { id: "wargame", label: "Wargames" },
    { id: "planning", label: "Planning" },
    { id: "task", label: "Tasks" },
    { id: "event", label: "Events" },
  ];

  return (
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    <div className="activities-overlay" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="activities-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="activities-panel__header">
          <div className="activities-panel__title">
            <Icon icon="th-list" size={13} />
            All Activities
          </div>
          <button
            type="button"
            className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only"
            onClick={onClose}
          >
            <Icon icon="cross" size={12} />
          </button>
        </div>

        {/* Search */}
        <div className="activities-panel__search">
          <div className="activities-panel__search-wrap">
            <span className="activities-panel__search-icon">
              <Icon icon="search" size={11} />
            </span>
            <input
              className="activities-panel__search-input"
              placeholder="Filter activities…"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              ref={(el) => {
                if (el) el.focus();
              }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="activities-panel__filters">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`activities-filter-chip${
                filter === tab.id ? " activities-filter-chip--active" : ""
              }`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="activities-panel__body">
          {filtered.length === 0 ? (
            <div className="activities-panel__empty">
              <Icon icon="search" size={24} />
              <span>No activities match your search</span>
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className="activity-row"
                onClick={onClose}
              >
                <div
                  className="activity-row__icon"
                  style={{ background: `${item.iconColor}22` }}
                >
                  <Icon
                    icon={item.icon as "search"}
                    size={16}
                    style={{ color: item.iconColor }}
                  />
                </div>
                <div className="activity-row__body">
                  <div className="activity-row__title">{item.title}</div>
                  <div className="activity-row__meta">
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "#454c68",
                        marginRight: 5,
                      }}
                    >
                      {CATEGORY_LABELS[item.category]}
                    </span>
                    {item.meta}
                  </div>
                </div>
                <div className="activity-row__right">
                  {item.progress !== undefined && (
                    <div className="activity-row__progress">
                      <div className="activity-row__progress-label">
                        {item.progress}%
                      </div>
                      <div className="activity-row__progress-bar">
                        <div
                          className="activity-row__progress-fill"
                          style={{
                            width: `${item.progress}%`,
                            background: item.progressColor ?? "#4c7ef3",
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <span
                    style={{
                      display: "inline-flex",
                      padding: "1px 7px",
                      borderRadius: 2,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      background: `${item.badgeColor}22`,
                      color: item.badgeColor,
                      border: `1px solid ${item.badgeColor}44`,
                    }}
                  >
                    {item.badge}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Home Screen — redesigned
// ─────────────────────────────────────────────────────────────────────────────

function HomeScreen({
  onNewExercise,
  onOpenPmesii,
  onOpenScenario,
  work,
  workLoading,
  workUnbound,
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
}: {
  onNewExercise: () => void;
  onOpenPmesii: () => void;
  /** Opens an existing exercise — Workshop owns the navigation. */
  onOpenScenario: (work: OngoingWork) => void;
  /** Exercises from the ontology, mapped onto the card shape. */
  work: OngoingWork[];
  workLoading: boolean;
  /** True when no Scenarios object set is bound to the widget. */
  workUnbound: boolean;
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [showActivities, setShowActivities] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [workFilter, setWorkFilter] = useState<WorkCategory>("all");

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkRead = useCallback(onMarkRead, [onMarkRead]);
  const handleMarkAllRead = useCallback(onMarkAllRead, [onMarkAllRead]);
  const handleDismiss = useCallback(onDismiss, [onDismiss]);

  const filteredWork =
    workFilter === "all" ? work : work.filter((w) => w.category === workFilter);

  const WORK_FILTER_TABS: { id: WorkCategory; label: string }[] = [
    { id: "all", label: `All work ${work.length}` },
    {
      id: "cax",
      label: `Exercises ${work.filter((w) => w.category === "cax").length}`,
    },
    {
      id: "wargame",
      label: `Wargames ${work.filter((w) => w.category === "wargame").length}`,
    },
    {
      id: "planning",
      label: `Plans ${work.filter((w) => w.category === "planning").length}`,
    },
    {
      id: "analysis",
      label: `Analysis ${work.filter((w) => w.category === "analysis").length}`,
    },
  ];

  const searchResults =
    searchQuery.trim().length > 1
      ? [...work.map(workToSearchItem), ...STATIC_SEARCH_ITEMS].filter((item) => {
          const q = searchQuery.toLowerCase();
          return (
            item.title.toLowerCase().includes(q) ||
            item.meta.toLowerCase().includes(q) ||
            item.badge.toLowerCase().includes(q)
          );
        }).slice(0, 8)
      : [];

  const showDropdown = searchFocused && searchQuery.trim().length > 1;

  // Group results by category for display
  const groupedResults = searchResults.reduce<
    Partial<Record<SearchCategory, SearchItem[]>>
  >((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category]!.push(item);
    return acc;
  }, {});

  const URGENCY_LABEL: Record<
    UpcomingDeadline["urgency"],
    { label: string; cls: string }
  > = {
    soon: { label: "In 2 days", cls: "deadline-badge--soon" },
    days: { label: "In 5 days", cls: "deadline-badge--days" },
    week: { label: "In 8 days", cls: "deadline-badge--week" },
  };

  const CATEGORY_COLOR: Record<Exclude<WorkCategory, "all">, string> = {
    cax: "#4c7ef3",
    wargame: "#8b5cf6",
    planning: "#24b47e",
    analysis: "#f0a83c",
  };

  const CATEGORY_ICON: Record<
    Exclude<WorkCategory, "all">,
    "layers" | "grid" | "document" | "timeline-bar-chart"
  > = {
    cax: "layers",
    wargame: "grid",
    planning: "document",
    analysis: "timeline-bar-chart",
  };

  return (
    <div className="planner-shell bp5-dark" style={{ position: "relative" }}>
      {/* Activities overlay */}
      {showActivities && (
        <ActivitiesOverlay onClose={() => setShowActivities(false)} />
      )}

      {/* Notifications panel — positioned relative to nav */}
      {showNotifs && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 150,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              pointerEvents: "all",
            }}
          >
            <NotificationPanel
              notifications={notifications}
              onMarkRead={handleMarkRead}
              onMarkAllRead={handleMarkAllRead}
              onDismiss={handleDismiss}
              onClose={() => setShowNotifs(false)}
            />
          </div>
        </div>
      )}

      {/* Nav bar */}
      <div className="home-nav">
        <div className="home-nav__breadcrumb">
          <span style={{ color: "#454c68" }}>Command Overview</span>
          <span className="home-nav__breadcrumb-sep">·</span>
          <span
            style={{
              color: "#454c68",
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Allied Command Operations
          </span>
        </div>

        {/* Search */}
        <div className="home-nav__search-wrap">
          <div className="home-nav__search-input">
            <Icon icon="search" size={12} />
            <input
              placeholder="Search exercises, wargames, analyses…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            />
            {searchQuery && (
              <button
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#6a7292",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSearchQuery("");
                }}
              >
                <Icon icon="cross" size={10} />
              </button>
            )}
          </div>

          {/* Search dropdown */}
          {showDropdown && (
            <div className="search-dropdown">
              {searchResults.length === 0 ? (
                <div className="search-dropdown__empty">
                  No results for &ldquo;{searchQuery}&rdquo;
                </div>
              ) : (
                (
                  Object.entries(groupedResults) as [
                    SearchCategory,
                    SearchItem[]
                  ][]
                ).map(([cat, items]) => (
                  <React.Fragment key={cat}>
                    <div className="search-dropdown__section-label">
                      {CATEGORY_LABELS[cat]}
                    </div>
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="search-dropdown__item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSearchQuery("");
                          setSearchFocused(false);
                        }}
                      >
                        <div
                          className="search-dropdown__icon"
                          style={{ background: `${item.iconColor}22` }}
                        >
                          <Icon
                            icon={item.icon as "search"}
                            size={13}
                            style={{ color: item.iconColor }}
                          />
                        </div>
                        <div className="search-dropdown__body">
                          <div className="search-dropdown__title">
                            {item.title}
                          </div>
                          <div className="search-dropdown__meta">
                            {item.meta}
                          </div>
                        </div>
                        <span
                          className="search-dropdown__badge"
                          style={{
                            background: `${item.badgeColor}22`,
                            color: item.badgeColor,
                            border: `1px solid ${item.badgeColor}44`,
                          }}
                        >
                          {item.badge}
                        </span>
                      </button>
                    ))}
                    <div className="search-dropdown__divider" />
                  </React.Fragment>
                ))
              )}
            </div>
          )}
        </div>

        <div className="home-nav__right">
          <div className="home-nav__classification">NATO Unclassified</div>
          <button
            type="button"
            className={`home-nav__bell${
              showNotifs ? " home-nav__bell--active" : ""
            }`}
            onClick={() => setShowNotifs((v) => !v)}
            title="Notifications"
          >
            <Icon
              icon="notifications"
              size={16}
              color={showNotifs ? "#e6eaf8" : "#6a7292"}
            />
            {unreadCount > 0 && (
              <span className="home-nav__bell-badge">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <div className="home-nav__avatar">BG</div>
        </div>
      </div>

      {/* Body */}
      <div className="home-body">
        {/* ── Hero: greeting + stat chips ── */}
        <div className="home-hero">
          <div className="home-hero__greeting">Good morning, Planner</div>
          <div className="home-hero__stats">
            {orgStatsFor(work).map((s) => (
              <div key={s.label} className="home-stat-chip">
                <div
                  className="home-stat-chip__icon"
                  style={{ background: `${s.color}18`, color: s.color }}
                >
                  <Icon icon={s.icon} size={18} />
                </div>
                <div className="home-stat-chip__body">
                  <div className="home-stat-chip__value">{s.value}</div>
                  <div className="home-stat-chip__label">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Define PMESII ── */}
        <div className="home-pmesii-cta">
          <button
            type="button"
            className="planner-btn-primary"
            onClick={onOpenPmesii}
          >
            <Icon icon="globe" size={14} />
            Define PMESII
          </button>
        </div>

        {/* ── Start New Work ── */}
        <div className="home-start-section">
          <div className="home-section-hdr">
            <span className="home-section-eyebrow">Start New Work</span>
          </div>
          <div className="home-start-row">
            {START_NEW_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="home-start-item"
                onClick={item.category === "cax" ? onNewExercise : undefined}
              >
                <div
                  className="home-start-item__icon"
                  style={{
                    background: `${CATEGORY_COLOR[item.category]}18`,
                    color: CATEGORY_COLOR[item.category],
                  }}
                >
                  <Icon icon={CATEGORY_ICON[item.category]} size={20} />
                </div>
                <div className="home-start-item__body">
                  <div className="home-start-item__name">{item.name}</div>
                  <div className="home-start-item__desc">{item.desc}</div>
                </div>
                <div
                  className="home-start-item__plus"
                  style={{ color: CATEGORY_COLOR[item.category] }}
                >
                  <Icon icon="plus" size={14} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Main content: work cards + sidebar ── */}
        <div className="home-main-row">
          {/* Left: ongoing work */}
          <div className="home-work-col">
            <div className="home-section-hdr">
              <span className="home-section-eyebrow">
                Continue ongoing work
              </span>
              <div className="home-work-tabs">
                {WORK_FILTER_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`home-work-tab${
                      workFilter === tab.id ? " home-work-tab--active" : ""
                    }`}
                    onClick={() => setWorkFilter(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Empty / loading states — the list is real ontology data now,
                so say plainly when there is nothing rather than showing
                invented exercises. */}
            {workLoading && (
              <div className="home-work-empty">Loading exercises…</div>
            )}
            {!workLoading && workUnbound && (
              <div className="home-work-empty">
                <strong>No exercises bound.</strong> In Workshop, bind the
                Scenarios parameter to an object set of [NXG-P] Scenario
                objects to list existing exercises here.
              </div>
            )}
            {!workLoading && !workUnbound && work.length === 0 && (
              <div className="home-work-empty">
                No exercises yet. Use <strong>New Exercise</strong> to create
                the first one.
              </div>
            )}
            {!workLoading && !workUnbound && work.length > 0 &&
              filteredWork.length === 0 && (
                <div className="home-work-empty">
                  No exercises match this filter.
                </div>
              )}

            <div className="home-work-grid">
              {filteredWork.map((w) => (
                <div key={w.id} className="home-work-card">
                  {/* Card header */}
                  <div className="home-work-card__header">
                    <div className="home-work-card__badges">
                      <span
                        className="home-work-card__cat-badge"
                        style={{
                          background: `${w.categoryColor}20`,
                          color: w.categoryColor,
                          border: `1px solid ${w.categoryColor}33`,
                        }}
                      >
                        {w.categoryLabel}
                      </span>
                      <span
                        className="home-work-card__status-badge"
                        style={{ color: w.statusColor }}
                      >
                        <span
                          className="home-work-card__status-dot"
                          style={{ background: w.statusColor }}
                        />
                        {w.statusLabel}
                      </span>
                    </div>
                    {w.attention && (
                      <span className="home-work-card__attention">
                        <Icon icon="warning-sign" size={10} /> Attention
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <div className="home-work-card__title">{w.title}</div>
                  <div className="home-work-card__subtitle">{w.subtitle}</div>

                  {/* Progress */}
                  <div className="home-work-card__progress-section">
                    <div className="home-work-card__progress-label">
                      <span>{w.progressLabel}</span>
                      <span
                        style={{
                          color: w.progress === 100 ? "#24b47e" : "#98a1c0",
                        }}
                      >
                        {w.progress}%
                      </span>
                    </div>
                    <div className="home-work-card__progress-track">
                      <div
                        className="home-work-card__progress-fill"
                        style={{
                          width: `${w.progress}%`,
                          background: w.progressColor,
                        }}
                      />
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="home-work-card__footer">
                    <div className="home-work-card__avatars">
                      {w.avatars.map((av, i) => (
                        <div
                          key={i}
                          className="home-work-card__avatar"
                          style={{ background: av.color }}
                        >
                          {av.initials}
                        </div>
                      ))}
                      {w.extraAvatars > 0 && (
                        <div className="home-work-card__avatar home-work-card__avatar--extra">
                          +{w.extraAvatars}
                        </div>
                      )}
                    </div>
                    <div className="home-work-card__footer-right">
                      <span className="home-work-card__last-activity">
                        {w.lastActivity}
                      </span>
                      <button
                        type="button"
                        className="home-work-card__resume-btn"
                        onClick={() => onOpenScenario(w)}
                        title={`Open ${w.title}`}
                      >
                        Open →
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: sidebar */}
          <div className="home-sidebar">
            {/* Upcoming Deadlines */}
            <div className="home-sidebar-block">
              <div className="home-section-hdr" style={{ marginBottom: 10 }}>
                <span className="home-section-eyebrow">Upcoming deadlines</span>
              </div>
              <div className="home-deadlines-list">
                {UPCOMING_DEADLINES.map((d, i) => {
                  const u = URGENCY_LABEL[d.urgency];
                  return (
                    <div key={i} className="home-deadline-row">
                      <div className="home-deadline-date">
                        <div className="home-deadline-date__day">{d.day}</div>
                        <div className="home-deadline-date__month">
                          {d.month}
                        </div>
                      </div>
                      <div className="home-deadline-body">
                        <div className="home-deadline-title">{d.title}</div>
                        <div className="home-deadline-meta">{d.meta}</div>
                      </div>
                      <span className={`home-deadline-badge ${u.cls}`}>
                        {u.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wizard sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div className="planner-steps">
      {STEPS.map((label, i) => {
        const state = i < current ? "done" : i === current ? "active" : "idle";
        return (
          <React.Fragment key={label}>
            {i > 0 && <div className="planner-step__sep" />}
            <div className={`planner-step planner-step--${state}`}>
              <div className="planner-step__dot">
                {state === "done" ? <Icon icon="tick" size={10} /> : i + 1}
              </div>
              {label}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────
function Step1ExerciseType({
  selected,
  onSelect,
}: {
  selected: ExerciseType | null;
  onSelect: (t: ExerciseType) => void;
}) {
  return (
    <div className="step-centered">
      <div className="step-eyebrow">Step 1 of 4</div>
      <div className="step-title">What type of exercise?</div>
      <div className="step-subtitle">
        Select the exercise format. This shapes the workflow, templates, and
        outputs available to you.
      </div>
      <div className="ex-type-grid">
        {EX_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ex-type-card${
              selected === t.id ? " ex-type-card--selected" : ""
            }`}
            onClick={() => onSelect(t.id)}
          >
            <div className="ex-type-card__icon">{t.icon}</div>
            <div
              className="ex-type-card__name"
              style={{ whiteSpace: "pre-line" }}
            >
              {t.name}
            </div>
            <div className="ex-type-card__desc">{t.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────
function Step2CreationMethod({
  selected,
  onSelect,
}: {
  selected: CreationMethod | null;
  onSelect: (m: CreationMethod) => void;
}) {
  const checks: Record<CreationMethod, string[]> = {
    template: [
      "Pre-defined training objectives",
      "Validated PMESII & MEL/MIL structure",
      "NATO-standard workflow ready",
      "Fastest path to publish",
    ],
    ai: [
      "Upload PDF scenario & exercise direction",
      "AI generates scenarios, objectives, PMESII",
      "Auto-builds MEL/MIL & ORBAT draft",
      "Fully editable after generation",
    ],
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ position: "relative", display: "flex", flex: 1 }}>
        {(["template", "ai"] as CreationMethod[]).map((method) => (
          <button
            key={method}
            type="button"
            className={`creation-method-card${
              selected === method ? " creation-method-card--selected" : ""
            }`}
            style={{ flex: 1 }}
            onClick={() => onSelect(method)}
          >
            {method === "template" && (
              <span className="creation-method-chip creation-method-chip--recommended">
                Recommended
              </span>
            )}
            {method === "ai" && (
              <span className="creation-method-chip creation-method-chip--ai">
                AI-powered
              </span>
            )}
            <div className="creation-method-card__icon">
              <Icon
                icon={method === "template" ? "document" : "lightbulb"}
                size={28}
              />
            </div>
            <div className="creation-method-card__name">
              {method === "template"
                ? "From template"
                : "From document + prompt"}
            </div>
            <div className="creation-method-card__desc">
              {method === "template"
                ? "Choose a pre-built exercise template and customise it for your training audience and scenario."
                : "Upload your EXDIR, scenario PDF, or existing documents and let AI generate the full exercise world."}
            </div>
            <div className="creation-method-card__checks">
              {checks[method].map((c) => (
                <div key={c} className="creation-method-card__check">
                  <Icon
                    icon="tick"
                    size={12}
                    className="creation-method-card__check-icon"
                  />
                  {c}
                </div>
              ))}
            </div>
          </button>
        ))}
        <div className="creation-method-divider">or</div>
      </div>
    </div>
  );
}

// ─── Document Slot Controls (upload + existing-document dropdown) ────────────
function DocumentSlotControls({
  slot,
  existing,
  uploadedName,
  docs,
  docsLoading,
  reloadDocs,
  openDropdown,
  setOpenDropdown,
  dropdownRef,
  onPickExisting,
  onClearExisting,
  onUploadClick,
  dragOver,
  onDrop,
  onDragOver,
  onDragLeave,
  uploadLabel,
  uploadSubLabel,
}: {
  slot: "scenario" | "exdir";
  existing: ExistingDocument | null;
  uploadedName: string | null;
  docs: ExistingDocument[];
  docsLoading: boolean;
  reloadDocs: () => void;
  openDropdown: "scenario" | "exdir" | null;
  setOpenDropdown: (s: "scenario" | "exdir" | null) => void;
  dropdownRef: React.RefObject<HTMLDivElement>;
  onPickExisting: (d: ExistingDocument) => void;
  onClearExisting: () => void;
  onUploadClick: () => void;
  dragOver: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  uploadLabel: string;
  uploadSubLabel: string;
}) {
  const [filter, setFilter] = useState("");
  const isOpen = openDropdown === slot;
  const hasUpload = uploadedName != null;
  const hasExisting = existing != null;

  const filtered = React.useMemo(() => {
    if (!filter.trim()) return docs;
    const q = filter.trim().toLowerCase();
    return docs.filter((d) => d.fileName.toLowerCase().includes(q));
  }, [docs, filter]);

  // If an existing document is selected, show a compact "selected" card
  // instead of the upload drop-zone.
  if (hasExisting) {
    return (
      <div className="doc-slot-selected">
        <Icon icon="database" size={13} style={{ color: "#4ade80" }} />
        <div className="doc-slot-selected__body">
          <div className="doc-slot-selected__label">
            Using existing document
          </div>
          <div className="doc-slot-selected__name" title={existing!.fileName}>
            {existing!.fileName}
          </div>
        </div>
        <button
          type="button"
          className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only"
          onClick={onClearExisting}
          title="Clear selection"
        >
          <Icon icon="cross" size={10} />
        </button>
      </div>
    );
  }

  return (
    <div className="doc-slot-wrap">
      <div className="doc-slot-controls">
        <button
          type="button"
          className={`scenario-drop-zone doc-slot-upload${
            dragOver ? " scenario-drop-zone--drag-over" : ""
          }`}
          onClick={onUploadClick}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <Icon icon="upload" size={14} />
          <span>{hasUpload ? "Change file" : uploadLabel}</span>
          {!hasUpload && (
            <span style={{ fontSize: 10, color: "#454c68" }}>
              {uploadSubLabel}
            </span>
          )}
        </button>
        <div className="doc-slot-existing" ref={isOpen ? dropdownRef : null}>
          <button
            type="button"
            className="doc-slot-existing__btn"
            onClick={() => setOpenDropdown(isOpen ? null : slot)}
            title={
              docsLoading
                ? "Loading available documents…"
                : docs.length === 0
                ? "No pre-processed documents available"
                : "Reuse a previously-processed document"
            }
            disabled={docsLoading && docs.length === 0}
          >
            <Icon icon="database" size={11} />
            <span>Or select existing</span>
            <Icon icon={isOpen ? "chevron-up" : "chevron-down"} size={9} />
          </button>
          {isOpen && (
            <div className="doc-slot-existing__menu">
              <div className="doc-slot-existing__search">
                <Icon
                  icon="search"
                  size={10}
                  style={{ color: "#6a7292", flexShrink: 0 }}
                />
                <input
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  className="doc-slot-existing__search-input"
                  placeholder="Filter documents…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <button
                  type="button"
                  className="doc-slot-existing__reload"
                  onClick={() => reloadDocs()}
                  title="Reload list"
                >
                  <Icon icon="refresh" size={9} />
                </button>
              </div>
              <div className="doc-slot-existing__list">
                {docsLoading && docs.length === 0 && (
                  <div className="doc-slot-existing__empty">
                    <div
                      className="scenario-spinner"
                      style={{ width: 12, height: 12, borderWidth: 2 }}
                    />
                    <span>Loading documents…</span>
                  </div>
                )}
                {!docsLoading && filtered.length === 0 && (
                  <div className="doc-slot-existing__empty">
                    <Icon icon="database" size={13} style={{ opacity: 0.4 }} />
                    <span>
                      {filter ? "No matches" : "No pre-processed documents yet"}
                    </span>
                  </div>
                )}
                {filtered.map((d) => (
                  <button
                    key={d.mediaItemRid}
                    type="button"
                    className="doc-slot-existing__item"
                    onClick={() => onPickExisting(d)}
                    title={d.fileName}
                  >
                    <Icon
                      icon="document"
                      size={11}
                      style={{ color: "#4ade80", flexShrink: 0 }}
                    />
                    <div className="doc-slot-existing__item-name">
                      {d.fileName}
                    </div>
                    <span className="doc-slot-existing__item-meta">
                      {d.extractedText.length} lines
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Uploaded file record ─────────────────────────────────────────────────────
interface UploadedFile {
  id: string;
  name: string;
  objectUrl: string;
  type: string; // MIME
  slot: "scenario" | "exdir";
  file: File; // original — passed to useScenarioGeneration
}

// ─── Generation Trace Panel — friendly, human-readable summary ─────────────
//
// Rather than dumping raw JSON to the screen, each pipeline entry is turned
// into a small "story card" describing WHAT happened at that step in plain
// English — e.g. "The AI was asked to draft the scenario, given the exercise
// name and 12 000 characters of document text" or "The AI proposed 5 phases".
// Users who want the underlying payload can click "Show details" on any card.

function formatForDisplay(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Compact character-count -> "~N.Nk chars" for large inputs
function fmtChars(n: number): string {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(1)}k chars`;
}

// Human-friendly label for each `step` string that trace entries carry
const TRACE_STEP_LABELS: Record<string, string> = {
  inputs: "Inputs",
  scenario: "Scenario",
  phases: "Phases",
  training_objectives: "Objectives",
  pmesii: "PMESII",
  tasks: "Tasks",
  injects: "Injects",
  error: "Error",
};

// Ordered list of steps we render tabs for (in pipeline order)
const TRACE_STEP_ORDER: string[] = [
  "inputs",
  "scenario",
  "phases",
  "training_objectives",
  "pmesii",
  "tasks",
  "injects",
];

const KIND_META: Record<
  TraceEntry["kind"],
  { icon: string; color: string; label: string; description: string }
> = {
  input: {
    icon: "arrow-right",
    color: "#4a7c9c",
    label: "SENT",
    description: "sent to Foundry",
  },
  output: {
    icon: "arrow-left",
    color: "#4ade80",
    label: "RECEIVED",
    description: "received from Foundry",
  },
  error: {
    icon: "warning-sign",
    color: "#f2726b",
    label: "ERROR",
    description: "an error occurred",
  },
  info: {
    icon: "info-sign",
    color: "#98a1c0",
    label: "PARSED",
    description: "processed by the widget",
  },
};

// ─── Reasoning overlay ────────────────────────────────────────────────────────
// Full-screen overlay shown when the user clicks the "View AI Reasoning" button.
// Renders the step's reasoning field in a clear, readable format.
function ReasoningOverlay({
  payload,
  stepLabel,
  onClose,
}: {
  payload: {
    reasoning?: string;
    items?: Array<{ index: number; reasoning: string }>;
  };
  stepLabel: string;
  onClose: () => void;
}) {
  // Parse top-level reasoning string into per-field lines
  const fieldLines: Array<{ key: string | null; val: string }> =
    React.useMemo(() => {
      if (typeof payload.reasoning !== "string") return [];
      return payload.reasoning
        .split(/(?:^|\.\s+)(?=[A-Za-z_]+\s*:)/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const colonIdx = line.indexOf(":");
          const hasKey = colonIdx > 0 && colonIdx < 50;
          return {
            key: hasKey ? line.slice(0, colonIdx).trim() : null,
            val: hasKey ? line.slice(colonIdx + 1).trim() : line,
          };
        });
    }, [payload.reasoning]);

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Close on Escape
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const hasFieldLines = fieldLines.length > 0;
  const hasItems = Array.isArray(payload.items) && payload.items.length > 0;

  return (
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    <div
      onClick={handleBackdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(8, 12, 20, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 680,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          background: "#141828",
          border: "1.5px solid #f0a83c66",
          borderRadius: 10,
          boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px #f0a83c22",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid #1c2547",
            background: "#0e1224",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: "#f0a83c22",
              border: "1px solid #f0a83c55",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon icon="lightbulb" size={14} color="#f0a83c" />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#e8c97a",
                lineHeight: 1.2,
              }}
            >
              AI Reasoning
            </div>
            <div style={{ fontSize: 10, color: "#6a7292", marginTop: 2 }}>
              {stepLabel} · How the AI interpreted the source documents
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid #2a3358",
              borderRadius: 4,
              color: "#6a7292",
              cursor: "pointer",
              padding: "3px 7px",
              display: "flex",
              alignItems: "center",
            }}
            title="Close (Esc)"
          >
            <Icon icon="cross" size={11} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {/* Per-field reasoning (scenario step) */}
          {hasFieldLines &&
            fieldLines.map((line, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "10px 14px",
                  background: "#0e1224",
                  border: "1px solid #1c2547",
                  borderRadius: 6,
                  borderLeft: "3px solid #f0a83c55",
                }}
              >
                {line.key && (
                  <div style={{ flexShrink: 0, minWidth: 130 }}>
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "#f0a83c",
                        background: "#f0a83c18",
                        border: "1px solid #f0a83c44",
                        padding: "2px 6px",
                        borderRadius: 3,
                        fontFamily: "monospace",
                      }}
                    >
                      {line.key}
                    </span>
                  </div>
                )}
                <p
                  style={{
                    margin: 0,
                    fontSize: 11,
                    lineHeight: 1.65,
                    color: "#aab3d0",
                  }}
                >
                  {line.val}
                </p>
              </div>
            ))}

          {/* Per-item reasoning (array steps) */}
          {hasItems &&
            payload.items!.map(({ index, reasoning }) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "10px 14px",
                  background: "#0e1224",
                  border: "1px solid #1c2547",
                  borderRadius: 6,
                  borderLeft: "3px solid #f0a83c55",
                }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#1a2435",
                    border: "1px solid #f0a83c55",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    fontWeight: 700,
                    color: "#f0a83c",
                    marginTop: 1,
                  }}
                >
                  {index + 1}
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 11,
                    lineHeight: 1.65,
                    color: "#aab3d0",
                  }}
                >
                  {reasoning}
                </p>
              </div>
            ))}

          {!hasFieldLines && !hasItems && (
            <div
              style={{
                textAlign: "center",
                color: "#6a7292",
                fontSize: 12,
                padding: 24,
              }}
            >
              No reasoning data available for this step.
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid #1c2547",
            display: "flex",
            justifyContent: "flex-end",
            flexShrink: 0,
            background: "#0e1224",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 16px",
              background: "#f0a83c22",
              border: "1px solid #f0a83c55",
              borderRadius: 5,
              color: "#e8c97a",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reasoning button — inline trace card replacement ─────────────────────────
// Replaces the old ReasoningCard with a prominent button that opens the overlay.
function ReasoningButton({
  payload,
  stepLabel,
}: {
  payload: {
    reasoning?: string;
    items?: Array<{ index: number; reasoning: string }>;
  };
  stepLabel: string;
}) {
  const [open, setOpen] = React.useState(false);

  const hasFieldLines =
    typeof payload.reasoning === "string" &&
    payload.reasoning.trim().length > 0;
  const itemCount = Array.isArray(payload.items) ? payload.items.length : 0;
  const count = hasFieldLines
    ? payload.reasoning!.split(/(?:^|\.\s+)(?=[A-Za-z_]+\s*:)/).filter(Boolean)
        .length
    : itemCount;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          background: "linear-gradient(135deg, #f0a83c18 0%, #f0a83c08 100%)",
          border: "1.5px solid #f0a83c66",
          borderRadius: 7,
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
          marginTop: 4,
          transition: "border-color 0.15s, background 0.15s",
        }}
        onMouseOver={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "#f0a83c";
          (e.currentTarget as HTMLButtonElement).style.background =
            "linear-gradient(135deg, #f0a83c28 0%, #f0a83c12 100%)";
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "#f0a83c";
          (e.currentTarget as HTMLButtonElement).style.background =
            "linear-gradient(135deg, #f0a83c28 0%, #f0a83c12 100%)";
        }}
        onMouseOut={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor =
            "#f0a83c66";
          (e.currentTarget as HTMLButtonElement).style.background =
            "linear-gradient(135deg, #f0a83c18 0%, #f0a83c08 100%)";
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor =
            "#f0a83c66";
          (e.currentTarget as HTMLButtonElement).style.background =
            "linear-gradient(135deg, #f0a83c18 0%, #f0a83c08 100%)";
        }}
        title="View AI reasoning — see how the AI interpreted the source documents"
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 5,
            background: "#f0a83c22",
            border: "1px solid #f0a83c55",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon icon="lightbulb" size={13} color="#f0a83c" />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#e8c97a",
              lineHeight: 1.2,
            }}
          >
            View AI Reasoning
          </div>
          <div style={{ fontSize: 9, color: "#8a6a3a", marginTop: 2 }}>
            {count} {hasFieldLines ? "field" : "item"}
            {count === 1 ? "" : "s"} explained · source citations included
          </div>
        </div>
        <Icon icon="arrow-right" size={11} color="#f0a83c" />
      </button>

      {open && (
        <ReasoningOverlay
          payload={payload}
          stepLabel={stepLabel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ─── Summarisers — turn raw payloads into a human-readable summary ──────────

interface EntrySummary {
  /** One-line headline shown in bold */
  headline: string;
  /** Optional short paragraph shown under the headline */
  narrative?: string;
  /** Key/value chips shown below (e.g. "Exercise name: ...") */
  facts?: Array<{ label: string; value: React.ReactNode; mono?: boolean }>;
  /** Optional list of items (e.g. proposed phases) */
  items?: Array<{ title: string; subtitle?: string }>;
}

function summariseInputsPayload(payload: unknown): EntrySummary {
  const p = (payload ?? {}) as {
    exerciseName?: string;
    scenarioDocText?: { length?: number; source?: string };
    exdirText?: { length?: number; source?: string };
    aiPrompt?: { length?: number };
  };
  const scenSrc = p.scenarioDocText?.source ?? "empty";
  const exdirSrc = p.exdirText?.source ?? "empty";
  const scenLen = p.scenarioDocText?.length ?? 0;
  const exdirLen = p.exdirText?.length ?? 0;
  const promptLen = p.aiPrompt?.length ?? 0;

  const cleanSrc = (s: string): string => {
    if (s === "empty") return "not provided";
    if (s.startsWith("upload:")) return `uploaded (${s.slice(7)})`;
    if (s.startsWith("existing:")) return `existing document (${s.slice(9)})`;
    return s;
  };

  return {
    headline: "Inputs ready for AI generation",
    narrative:
      "Documents were prepared and combined with the exercise name and prompt. This is what the widget will pass to the AI for each generation step.",
    facts: [
      {
        label: "Exercise name",
        value: p.exerciseName ?? "(unset)",
        mono: true,
      },
      {
        label: "Scenario document",
        value: `${cleanSrc(scenSrc)} · ${fmtChars(scenLen)}`,
      },
      {
        label: "Exercise direction",
        value: `${cleanSrc(exdirSrc)} · ${fmtChars(exdirLen)}`,
      },
      {
        label: "AI prompt",
        value:
          promptLen > 0 ? `provided (${fmtChars(promptLen)})` : "none provided",
      },
    ],
  };
}

/** Friendly name of what a given pipeline `step` is asking the AI to produce */
const AI_STEP_GOAL: Record<string, string> = {
  scenario:
    "draft the scenario shell — its name, type, classification, strategic context and training audience",
  phases: "propose the exercise phases and their timeline",
  training_objectives: "write the training objectives",
  pmesii: "populate the PMESII-PT variables",
  tasks: "generate the workflow tasks",
  injects: "generate the MEL / MIL injects",
};

const AI_STEP_TITLE: Record<string, string> = {
  scenario: "AI asked to draft the scenario",
  phases: "AI asked to design the phases",
  training_objectives: "AI asked to write training objectives",
  pmesii: "AI asked to fill in PMESII-PT variables",
  tasks: "AI asked to plan workflow tasks",
  injects: "AI asked to author MEL / MIL injects",
};

function summariseAIFunctionCall(entry: TraceEntry): EntrySummary {
  const p = (entry.payload ?? {}) as {
    exerciseName?: string;
    step?: string;
    scenarioDocTextChars?: number;
    exdirTextChars?: number;
    aiPrompt?: string;
  };
  const step = p.step ?? entry.step;
  const goal = AI_STEP_GOAL[step] ?? `produce data for the "${step}" step`;
  const title = AI_STEP_TITLE[step] ?? `AI asked to work on ${step}`;
  const scenChars = p.scenarioDocTextChars ?? 0;
  const exdirChars = p.exdirTextChars ?? 0;
  const hasPrompt = p.aiPrompt && p.aiPrompt !== "(none)";

  return {
    headline: title,
    narrative: `The AI logic function was called and asked to ${goal}. It was given the exercise name, the document text, and the optional prompt.`,
    facts: [
      {
        label: "Exercise",
        value: p.exerciseName ?? "(unset)",
        mono: true,
      },
      {
        label: "Scenario doc",
        value: scenChars > 0 ? fmtChars(scenChars) : "none",
      },
      {
        label: "Exercise direction",
        value: exdirChars > 0 ? fmtChars(exdirChars) : "none",
      },
      {
        label: "Custom prompt",
        value: hasPrompt ? "provided" : "none",
      },
    ],
  };
}

function summariseAIFunctionResponse(entry: TraceEntry): EntrySummary {
  const p = entry.payload as
    | { type?: string; length?: number; value?: unknown }
    | undefined;
  const step = entry.step;
  const stepLabel = TRACE_STEP_LABELS[step] ?? step;
  const isString = p?.type === "string";
  const len = typeof p?.length === "number" ? p.length : undefined;
  return {
    headline: `AI response received for ${stepLabel}`,
    narrative: isString
      ? `The AI returned a JSON payload (${
          len != null ? fmtChars(len) : "unknown size"
        }) describing its proposed ${stepLabel.toLowerCase()}. The widget will now parse and validate it before writing to the ontology.`
      : `The AI returned a ${
          p?.type ?? "response"
        } for ${stepLabel.toLowerCase()}. The widget will now parse and validate it before writing to the ontology.`,
  };
}

function summariseParsedPayload(entry: TraceEntry): EntrySummary | null {
  const step = entry.step;
  const stepLabel = TRACE_STEP_LABELS[step] ?? step;
  const payload = entry.payload;

  // Array-style responses (phases, PMESII, tasks, injects, objectives)
  if (Array.isArray(payload)) {
    const items = payload.slice(0, 12).map((item: unknown, idx: number) => {
      const rec = (item ?? {}) as Record<string, unknown>;
      const asStr = (v: unknown): string | undefined =>
        typeof v === "string" && v.length > 0 ? v : undefined;
      // Try to pick a sensible title / subtitle
      const title: string =
        asStr(rec.phaseName) ??
        asStr(rec.objective) ??
        asStr(rec.taskName) ??
        asStr(rec.injectTitle) ??
        asStr(rec.domainKey) ??
        asStr(rec.name) ??
        `Item ${idx + 1}`;
      const subtitle: string | undefined =
        asStr(rec.phaseDescription) ??
        asStr(rec.taskDescription) ??
        asStr(rec.injectBody) ??
        asStr(rec.domainValue) ??
        asStr(rec.functionalArea) ??
        asStr(rec.priority) ??
        asStr(rec.dueOffset) ??
        asStr(rec.dayOffset) ??
        asStr(rec.startOffset);
      return { title, subtitle };
    });
    const extra = payload.length - items.length;
    return {
      headline: `AI proposed ${payload.length} ${stepLabel.toLowerCase()}`,
      narrative: `Each item below will now be validated and written to the ontology as a linked object.${
        extra > 0
          ? ` (Showing the first ${items.length} — ${extra} more not listed.)`
          : ""
      }`,
      items,
    };
  }

  // Scenario shell — object with named fields
  if (step === "scenario" && payload && typeof payload === "object") {
    const p = payload as {
      scenarioName?: string;
      scenarioType?: string;
      classification?: string;
      strategicContextTitle?: string;
      strategicContextBody?: string;
      sourceDocuments?: string;
      trainingAudience?: {
        audienceName?: string;
        directorates?: string;
      };
    };
    const ta = p.trainingAudience;
    return {
      headline: "AI proposed the scenario shell",
      narrative:
        "The following top-level scenario fields were drafted by the AI. Empty fields will be filled with sensible defaults before the ontology write.",
      facts: [
        {
          label: "Scenario name",
          value: p.scenarioName ?? "(missing)",
          mono: true,
        },
        { label: "Type", value: p.scenarioType ?? "(missing)" },
        { label: "Classification", value: p.classification ?? "(missing)" },
        {
          label: "Strategic context",
          value: p.strategicContextTitle ?? "(missing)",
        },
        {
          label: "Body length",
          value:
            typeof p.strategicContextBody === "string"
              ? fmtChars(p.strategicContextBody.length)
              : "(missing)",
        },
        { label: "Source documents", value: p.sourceDocuments ?? "(none)" },
        {
          label: "Training audience",
          value: ta?.audienceName ?? "(not proposed)",
          mono: true,
        },
        {
          label: "Directorates",
          value: ta?.directorates ?? "(not proposed)",
        },
      ],
    };
  }
  return null;
}

function summariseOntologyAction(entry: TraceEntry): EntrySummary {
  // Extract the "createNxg..." name and whether it's a batch from the label
  const label = entry.label;
  // Batch pattern: "Ontology action → createNxgPTask (batch of 5)"
  const batchMatch = /→\s*([\w]+)\s*\(batch of (\d+)\)/.exec(label);
  const singleMatch = /→\s*([\w]+)(?:\s*\(([^)]+)\))?/.exec(label);

  const ACTION_HUMAN: Record<string, { name: string; article: string }> = {
    createNxgPScenario: { name: "scenario", article: "the" },
    createNxgPTrainingAudience: { name: "training audience", article: "the" },
    createNxgPPhase: { name: "phase", article: "a" },
    createNxgPTrainingObjective: { name: "training objective", article: "a" },
    createNxgPPmesiiDomain: { name: "PMESII domain", article: "a" },
    createNxgPTask: { name: "task", article: "a" },
    createNxgPInject: { name: "inject (MEL/MIL)", article: "an" },
  };

  if (batchMatch) {
    const [, actionName, countStr] = batchMatch;
    const count = parseInt(countStr, 10);
    const human = ACTION_HUMAN[actionName];
    const noun = human?.name ?? "object";
    return {
      headline: `Writing ${count} ${noun}${
        count === 1 ? "" : "s"
      } to the ontology`,
      narrative: `The widget is submitting ${count} new ${noun}${
        count === 1 ? "" : "s"
      } as a batch action. Each object will be linked back to its parent scenario / phase.`,
    };
  }

  if (singleMatch) {
    const [, actionName, ctx] = singleMatch;
    const human = ACTION_HUMAN[actionName];
    if (human) {
      return {
        headline: `Creating ${human.article} ${human.name} in the ontology${
          ctx ? ` (${ctx})` : ""
        }`,
        narrative: `The widget is applying the ${actionName} action to persist ${human.article} new ${human.name}.`,
      };
    }
  }

  return {
    headline: label.replace(/^Ontology action → /, "Applying action: "),
  };
}

function summariseActionResult(entry: TraceEntry): EntrySummary {
  const p = entry.payload as
    | { type?: string; addedObjects?: unknown[] }
    | undefined;
  const label = entry.label.replace(/^Action result — /, "");
  const human: Record<string, string> = {
    createNxgPScenario: "scenario",
    createNxgPTrainingAudience: "training audience",
    createNxgPPhase: "phase",
    createNxgPTrainingObjective: "training objective",
    createNxgPPmesiiDomain: "PMESII domain",
    createNxgPTask: "task",
    createNxgPInject: "inject",
  };
  const nounFor = (name: string): string => human[name] ?? "object";
  if (p?.type === "edits") {
    const added = Array.isArray(p?.addedObjects) ? p.addedObjects.length : 0;
    const noun = nounFor(label);
    return {
      headline: `${added > 0 ? "Success" : "Completed"} — ${added} new ${noun}${
        added === 1 ? "" : "s"
      } created`,
      narrative:
        added > 0
          ? "The object was written and its primary key returned. It will now be linked to the rest of the scenario."
          : "The action completed but no new objects were returned.",
    };
  }
  return {
    headline: `${nounFor(label)} action completed`,
    narrative: "The Foundry action returned successfully.",
  };
}

function summariseActionError(entry: TraceEntry): EntrySummary {
  const p = (entry.payload ?? {}) as {
    error?: string;
    message?: string;
    errorDescription?: string;
    errorCode?: string;
    errorName?: string;
    statusCode?: number;
  };
  const msg: string | undefined = p.error ?? p.message;
  const description: string | undefined = p.errorDescription;
  const code: string | undefined = p.errorCode ?? p.errorName;
  const status: number | undefined = p.statusCode;

  // Extract action name from label
  const nameMatch = /—\s*([\w]+)/.exec(entry.label);
  const actionName = nameMatch?.[1];

  const humanNoun: Record<string, string> = {
    createNxgPScenario: "scenario",
    createNxgPTrainingAudience: "training audience",
    createNxgPPhase: "phase",
    createNxgPTrainingObjective: "training objective",
    createNxgPPmesiiDomain: "PMESII domain",
    createNxgPTask: "task",
    createNxgPInject: "inject",
  };
  const noun = actionName ? humanNoun[actionName] ?? "object" : "object";

  return {
    headline: `Foundry rejected the ${noun}`,
    narrative:
      description ||
      msg ||
      "The action could not be applied. See details below for the exact reason returned by Foundry.",
    facts: [
      ...(code ? [{ label: "Error code", value: code, mono: true }] : []),
      ...(status ? [{ label: "HTTP status", value: String(status) }] : []),
    ],
  };
}

function summariseJsonParseFailure(entry: TraceEntry): EntrySummary {
  const p = (entry.payload ?? {}) as {
    attempts?: unknown[];
    rawLength?: number;
  };
  const attempts: number = Array.isArray(p.attempts) ? p.attempts.length : 0;
  const rawLen: number = p.rawLength ?? 0;
  return {
    headline: `Could not parse the AI response for ${
      TRACE_STEP_LABELS[entry.step] ?? entry.step
    }`,
    narrative: `The AI returned malformed JSON — the widget tried ${attempts} different repair strategies but none succeeded. Retrying usually resolves this because the model produces slightly different output each time.`,
    facts: [
      { label: "Response size", value: fmtChars(rawLen) },
      { label: "Repair attempts", value: String(attempts) },
    ],
  };
}

function summariseGenericError(entry: TraceEntry): EntrySummary {
  const p = (entry.payload ?? {}) as { message?: string };
  const msg: string = p.message ?? "An unexpected error occurred.";
  return {
    headline: "Generation failed",
    narrative: msg,
  };
}

/**
 * Pick the appropriate summariser for a trace entry based on its label / kind.
 * Falls back to a generic "unknown event" summary so nothing is ever blank.
 */
function summariseEntry(entry: TraceEntry): EntrySummary {
  const label = entry.label;

  // Errors
  if (entry.kind === "error") {
    if (label.includes("JSON parse")) return summariseJsonParseFailure(entry);
    if (
      label.includes("Ontology action FAILED") ||
      label.includes("Batch action FAILED") ||
      /rejected item/.test(label)
    ) {
      return summariseActionError(entry);
    }
    return summariseGenericError(entry);
  }

  // Inputs step summary
  if (entry.step === "inputs" && entry.kind === "input") {
    return summariseInputsPayload(entry.payload);
  }

  // AI function call & response
  if (label.startsWith("Function call →")) {
    return summariseAIFunctionCall(entry);
  }
  if (label.startsWith("Raw AIP function response")) {
    return summariseAIFunctionResponse(entry);
  }

  // Parsed JSON — item lists / structured object
  if (label.startsWith("Parsed JSON payload")) {
    const s = summariseParsedPayload(entry);
    if (s) return s;
    return {
      headline: `AI response parsed for ${
        TRACE_STEP_LABELS[entry.step] ?? entry.step
      }`,
      narrative:
        "The widget successfully parsed the AI's response into structured data.",
    };
  }

  // Ontology actions
  if (label.startsWith("Ontology action →")) {
    return summariseOntologyAction(entry);
  }
  if (label.startsWith("Action result —")) {
    return summariseActionResult(entry);
  }

  // AI reasoning block
  if (label === "AI reasoning") {
    const p = entry.payload as {
      reasoning?: string;
      items?: Array<{ index: number; reasoning: string }>;
    };
    const count =
      typeof p.reasoning === "string"
        ? p.reasoning.split(/(?:^|\.\s+)(?=[A-Za-z_]+\s*:)/).filter(Boolean)
            .length
        : Array.isArray(p.items)
        ? p.items.length
        : 0;
    return {
      headline: "AI reasoning & source citations",
      narrative: `The AI explained its choices for ${count} field${
        count === 1 ? "" : "s"
      }, citing the exact passages it drew from in the source documents.`,
    };
  }

  // Fallback — use the label as headline
  return {
    headline: label,
  };
}

function TraceEntryCard({ entry }: { entry: TraceEntry }) {
  // Details (raw JSON) are hidden by default — the summary above tells the story.
  const [showDetails, setShowDetails] = useState(false);
  const meta = KIND_META[entry.kind];
  const timeStr = new Date(entry.timestamp).toLocaleTimeString(undefined, {
    hour12: false,
  });
  const summary = summariseEntry(entry);
  const stepLabel = TRACE_STEP_LABELS[entry.step] ?? entry.step;

  // Reasoning entries get their own prominent button → overlay
  if (entry.label === "AI reasoning") {
    const p = entry.payload as {
      reasoning?: string;
      items?: Array<{ index: number; reasoning: string }>;
    };
    return <ReasoningButton payload={p} stepLabel={stepLabel} />;
  }

  return (
    <div
      className={`trace-card trace-card--${entry.kind}`}
      style={{ borderLeftColor: meta.color }}
    >
      {/* Header row — icon, kind, time */}
      <div className="trace-card__meta">
        <div
          className="trace-card__meta-icon"
          style={{
            color: meta.color,
            background: meta.color + "1a",
            borderColor: meta.color + "44",
          }}
        >
          <Icon icon={meta.icon as "search"} size={11} />
        </div>
        <span
          className="trace-card__kind"
          style={{ color: meta.color, borderColor: meta.color + "44" }}
        >
          {meta.label}
        </span>
        <span className="trace-card__step">{stepLabel}</span>
        <span className="trace-card__time">{timeStr}</span>
      </div>

      {/* Headline */}
      <div className="trace-card__headline">{summary.headline}</div>

      {/* Narrative */}
      {summary.narrative && (
        <div className="trace-card__narrative">{summary.narrative}</div>
      )}

      {/* Facts (key/value chips) */}
      {summary.facts && summary.facts.length > 0 && (
        <div className="trace-card__facts">
          {summary.facts.map((f, i) => (
            <div key={i} className="trace-fact">
              <div className="trace-fact__label">{f.label}</div>
              <div
                className={`trace-fact__value${
                  f.mono ? " trace-fact__value--mono" : ""
                }`}
              >
                {f.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Item list (e.g. proposed phases) */}
      {summary.items && summary.items.length > 0 && (
        <div className="trace-card__items">
          {summary.items.map((it, i) => (
            <div key={i} className="trace-card__item">
              <span className="trace-card__item-index">{i + 1}</span>
              <div className="trace-card__item-body">
                <div className="trace-card__item-title">{it.title}</div>
                {it.subtitle && (
                  <div className="trace-card__item-subtitle">{it.subtitle}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Details toggle — raw payload for advanced users */}
      <button
        type="button"
        className="trace-card__details-toggle"
        onClick={() => setShowDetails((v) => !v)}
      >
        <Icon icon={showDetails ? "chevron-down" : "chevron-right"} size={9} />
        {showDetails ? "Hide raw details" : "Show raw details"}
      </button>
      {showDetails && (
        <pre className="trace-card__raw">{formatForDisplay(entry.payload)}</pre>
      )}
    </div>
  );
}

// ─── Approval preview — shows the AI proposal and Accept/Decline buttons ────

/**
 * Render a small preview card for the current AI proposal so the user can
 * see exactly what will land in the ontology if they accept.
 */
function ProposalPreview({ pending }: { pending: PendingApproval }) {
  const { step, proposal } = pending;

  // Scenario shell — a single object
  if (step === "scenario" && proposal && typeof proposal === "object") {
    const p = proposal as {
      scenarioName?: string;
      scenarioType?: string;
      classification?: string;
      strategicContextTitle?: string;
      strategicContextBody?: string;
      sourceDocuments?: string;
      scenarioStatus?: string;
      currentPhase?: string;
      overallProgressPct?: number;
      createdDate?: string;
      trainingAudience?: {
        audienceName?: string;
        audienceType?: string;
        audienceDescription?: string;
        directorates?: string;
        participantCount?: number;
      };
    };
    return (
      <div className="approval-preview">
        <div className="approval-preview__section">
          <div className="approval-preview__section-title">Scenario</div>
          <div className="approval-preview__facts">
            <div className="approval-fact">
              <div className="approval-fact__label">Name</div>
              <div className="approval-fact__value approval-fact__value--mono">
                {p.scenarioName ?? "(missing)"}
              </div>
            </div>
            <div className="approval-fact">
              <div className="approval-fact__label">Type</div>
              <div className="approval-fact__value">
                {p.scenarioType ?? "(missing)"}
              </div>
            </div>
            <div className="approval-fact">
              <div className="approval-fact__label">Classification</div>
              <div className="approval-fact__value">
                {p.classification ?? "(missing)"}
              </div>
            </div>
            <div className="approval-fact">
              <div className="approval-fact__label">Status</div>
              <div className="approval-fact__value">
                {p.scenarioStatus ?? "Draft"}
              </div>
            </div>
            <div className="approval-fact">
              <div className="approval-fact__label">Current phase</div>
              <div className="approval-fact__value">
                {p.currentPhase ?? "(not set)"}
              </div>
            </div>
            <div className="approval-fact">
              <div className="approval-fact__label">Created</div>
              <div className="approval-fact__value approval-fact__value--mono">
                {p.createdDate ?? "(today)"}
              </div>
            </div>
          </div>
        </div>

        {(p.strategicContextTitle || p.strategicContextBody) && (
          <div className="approval-preview__section">
            <div className="approval-preview__section-title">
              Strategic context
            </div>
            {p.strategicContextTitle && (
              <div className="approval-preview__body-title">
                {p.strategicContextTitle}
              </div>
            )}
            {p.strategicContextBody && (
              <div className="approval-preview__body-text">
                {p.strategicContextBody}
              </div>
            )}
          </div>
        )}

        {p.sourceDocuments && (
          <div className="approval-preview__section">
            <div className="approval-preview__section-title">
              Source documents
            </div>
            <div className="approval-preview__body-text approval-preview__body-text--mono">
              {p.sourceDocuments}
            </div>
          </div>
        )}

        {p.trainingAudience && (
          <div className="approval-preview__section">
            <div className="approval-preview__section-title">
              Training audience
            </div>
            <div className="approval-preview__facts">
              <div className="approval-fact">
                <div className="approval-fact__label">Name</div>
                <div className="approval-fact__value approval-fact__value--mono">
                  {p.trainingAudience.audienceName ?? "(missing)"}
                </div>
              </div>
              <div className="approval-fact">
                <div className="approval-fact__label">Type</div>
                <div className="approval-fact__value">
                  {p.trainingAudience.audienceType ?? "(missing)"}
                </div>
              </div>
              <div className="approval-fact">
                <div className="approval-fact__label">Directorates</div>
                <div className="approval-fact__value">
                  {p.trainingAudience.directorates ?? "(none)"}
                </div>
              </div>
              <div className="approval-fact">
                <div className="approval-fact__label">Participants</div>
                <div className="approval-fact__value approval-fact__value--mono">
                  {p.trainingAudience.participantCount != null
                    ? String(p.trainingAudience.participantCount)
                    : "(unspecified)"}
                </div>
              </div>
            </div>
            {p.trainingAudience.audienceDescription && (
              <div
                className="approval-preview__body-text"
                style={{ marginTop: 8 }}
              >
                {p.trainingAudience.audienceDescription}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Everything else is an array of items — render as numbered list
  if (Array.isArray(proposal)) {
    return (
      <div className="approval-preview">
        <div className="approval-preview__count">
          {proposal.length} {proposal.length === 1 ? "item" : "items"} proposed
        </div>
        <div className="approval-preview__items">
          {proposal.map((item: unknown, i: number) => {
            const rec = (item ?? {}) as Record<string, unknown>;
            const asStr = (v: unknown): string | undefined =>
              typeof v === "string" && v.length > 0 ? v : undefined;
            const title: string =
              asStr(rec.phaseName) ??
              asStr(rec.objective) ??
              asStr(rec.taskName) ??
              asStr(rec.injectTitle) ??
              asStr(rec.domainKey) ??
              `Item ${i + 1}`;
            const subtitle: string | undefined =
              asStr(rec.phaseDescription) ??
              asStr(rec.taskDescription) ??
              asStr(rec.injectBody) ??
              asStr(rec.domainValue) ??
              asStr(rec.functionalArea);
            const badges: string[] = [];
            const priority = asStr(rec.priority);
            if (priority) badges.push(priority);
            const dueOffset = asStr(rec.dueOffset);
            if (dueOffset) badges.push(dueOffset);
            const dayOffset = asStr(rec.dayOffset);
            if (dayOffset) badges.push(dayOffset);
            const startOffset = asStr(rec.startOffset);
            const endOffset = asStr(rec.endOffset);
            if (startOffset && endOffset)
              badges.push(`${startOffset} → ${endOffset}`);
            const injectCategory = asStr(rec.injectCategory);
            if (injectCategory) badges.push(injectCategory);
            const taskSection = asStr(rec.taskSection);
            if (taskSection) badges.push(taskSection);
            return (
              <div key={i} className="approval-item">
                <div className="approval-item__index">{i + 1}</div>
                <div className="approval-item__body">
                  <div className="approval-item__title">{title}</div>
                  {subtitle && (
                    <div className="approval-item__subtitle">{subtitle}</div>
                  )}
                  {badges.length > 0 && (
                    <div className="approval-item__badges">
                      {badges.map((b, bi) => (
                        <span key={bi} className="approval-item__badge">
                          {b}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="approval-preview">
      <pre className="approval-preview__raw">
        {JSON.stringify(proposal, null, 2)}
      </pre>
    </div>
  );
}

function ApprovalBar({
  pending,
  onApprove,
  onDecline,
  onRegenerate,
}: {
  pending: PendingApproval;
  onApprove?: () => void;
  onDecline?: () => void;
  onRegenerate?: (feedback: string) => void;
}) {
  const [feedback, setFeedback] = React.useState("");
  const busy = pending.isRegenerating;

  const handleRegenerate = () => {
    if (busy) return;
    const trimmed = feedback.trim();
    if (!trimmed) return;
    onRegenerate?.(trimmed);
    setFeedback("");
  };

  return (
    <div className="approval-bar">
      <div className="approval-bar__header">
        <div className="approval-bar__title">
          <Icon icon="pause" size={13} />
          <span>Review AI proposal · {pending.label}</span>
          {pending.regenerationAttempt > 0 && (
            <span className="approval-bar__attempt">
              regenerated {pending.regenerationAttempt}×
            </span>
          )}
        </div>
        <div className="approval-bar__subtitle">
          Nothing has been written to the ontology yet. Review the details below
          and <strong>accept</strong> to continue, ask the AI to
          <strong> regenerate</strong> this section with extra instructions, or{" "}
          <strong>skip</strong> this section (no objects created for it) and
          move on.
        </div>
      </div>

      {/* Regeneration history — show what the user has already told the AI
          on previous retries so they remember what has already been tried. */}
      {pending.previousFeedback.length > 0 && (
        <div className="approval-feedback-history">
          <div className="approval-feedback-history__label">
            Previous instructions
          </div>
          {pending.previousFeedback.map((f, i) => (
            <div key={i} className="approval-feedback-history__item">
              <span className="approval-feedback-history__index">#{i + 1}</span>
              <span className="approval-feedback-history__text">{f}</span>
            </div>
          ))}
        </div>
      )}

      {/* Preview of the current proposal */}
      <ProposalPreview pending={pending} />

      {/* Regeneration prompt — like the AI prompt on step 3, but scoped
          to this specific section */}
      <div className="approval-regenerate">
        <div className="approval-regenerate__label">
          <Icon icon="lightbulb" size={10} />
          <span>Ask the AI to try again</span>
          <span className="approval-regenerate__hint">
            optional — add instructions and hit Regenerate
          </span>
        </div>
        <textarea
          className="approval-regenerate__input"
          placeholder={`e.g. "Make the phases shorter" · "Add a cyber-domain focus" · "Include a joint fires objective"`}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          disabled={busy}
          rows={2}
          onKeyDown={(e) => {
            if (
              (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ||
              (e.key === "Enter" && !e.shiftKey && feedback.trim().length > 0)
            ) {
              e.preventDefault();
              handleRegenerate();
            }
          }}
        />
      </div>

      <div className="approval-bar__actions">
        <button
          type="button"
          className="approval-btn approval-btn--decline"
          onClick={() => onDecline?.()}
          disabled={busy}
          title="Skip this section — no objects will be created for it, but the pipeline continues to the next step"
        >
          <Icon icon="chevron-right" size={11} />
          Skip &amp; continue
        </button>
        <button
          type="button"
          className="approval-btn approval-btn--regenerate"
          onClick={handleRegenerate}
          disabled={busy || feedback.trim().length === 0}
          title={
            feedback.trim().length === 0
              ? "Type some feedback for the AI, then click Regenerate"
              : "Ask the AI to try again with your feedback"
          }
        >
          {busy ? (
            <>
              <div
                className="scenario-spinner"
                style={{ width: 10, height: 10, borderWidth: 2 }}
              />
              Regenerating…
            </>
          ) : (
            <>
              <Icon icon="refresh" size={11} />
              Regenerate
            </>
          )}
        </button>
        <button
          type="button"
          className="approval-btn approval-btn--accept"
          onClick={() => onApprove?.()}
          disabled={busy}
        >
          <Icon icon="tick" size={11} />
          Accept &amp; continue
        </button>
      </div>
    </div>
  );
}

/**
 * ── Generation Trace Panel — CAROUSEL layout ──
 *
 * The right-hand panel used to be a scrolling list of every trace card. It
 * now works as a **carousel**: exactly one "slide" is visible at a time and
 * the user clicks the ← / → arrows (or clicks a step chip) to move between
 * them.
 *
 * There is one slide per pipeline step (Inputs, Scenario, Phases, Objectives,
 * PMESII, Tasks, Injects). A slide bundles together every trace entry for
 * that step (the AI call, the response, the parsed proposal, the ontology
 * writes, any errors). When a step is currently pending approval, that
 * step's slide also renders the ApprovalBar at the top with Accept /
 * Regenerate / Decline.
 */
interface TraceSlide {
  /** Pipeline step key (e.g. "scenario", "phases") */
  step: string;
  /** Friendly label ("Scenario", "Phases", …) */
  label: string;
  /** Every trace entry that belongs to this slide, chronologically */
  entries: TraceEntry[];
  /** Whether this slide's step is the currently-running one */
  isCurrent: boolean;
  /** Whether an error occurred in this slide's step */
  hasError: boolean;
  /** Approval preview (only set on the slide that's waiting for the user) */
  approval: PendingApproval | null;
}

function GenerationTracePanel({
  genState,
  onApprove,
  onDecline,
  onRegenerate,
  onSkip,
}: {
  genState: GenerationState;
  onApprove?: () => void;
  onDecline?: () => void;
  onRegenerate?: (feedback: string) => void;
  /** Skip the rest of generation entirely and advance to the next wizard step */
  onSkip?: () => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // Which slide index the user is currently looking at
  const [slideIndex, setSlideIndex] = React.useState(0);
  // Track whether the user has manually navigated between slides. Once they
  // have, we STOP auto-advancing so we don't yank them away while reading.
  const userNavigatedRef = React.useRef(false);

  const isRunning =
    genState.currentStep !== "idle" &&
    genState.currentStep !== "done" &&
    genState.currentStep !== "error" &&
    genState.currentStep !== "cancelled";

  // Group trace entries into slides — one slide per pipeline step
  const slides: TraceSlide[] = React.useMemo(() => {
    const bySrepKey = new Map<string, TraceEntry[]>();
    for (const e of genState.trace) {
      const list = bySrepKey.get(e.step) ?? [];
      list.push(e);
      bySrepKey.set(e.step, list);
    }

    // Steps to include: canonical order (with data OR currently-running) +
    // extras (unknown step keys that appeared in the trace)
    const knownWithData = TRACE_STEP_ORDER.filter(
      (s) => bySrepKey.has(s) || s === genState.currentStep
    );
    const extras = Array.from(bySrepKey.keys()).filter(
      (s) => !TRACE_STEP_ORDER.includes(s)
    );
    const stepKeys = [...knownWithData, ...extras];

    return stepKeys.map((step) => {
      const entries = bySrepKey.get(step) ?? [];
      const hasError = entries.some((e) => e.kind === "error");
      const isCurrent = genState.currentStep === step;
      const approval =
        genState.pendingApproval && genState.pendingApproval.step === step
          ? genState.pendingApproval
          : null;
      return {
        step,
        label: TRACE_STEP_LABELS[step] ?? step,
        entries,
        isCurrent,
        hasError,
        approval,
      };
    });
  }, [genState.trace, genState.currentStep, genState.pendingApproval]);

  // Auto-advance to whichever slide is currently active (unless the user has
  // manually navigated somewhere else, or is reviewing a pending approval).
  React.useEffect(() => {
    if (userNavigatedRef.current) return;
    // If an approval is pending, jump straight to that slide so the user
    // sees the accept/decline/regenerate UI without hunting for it.
    if (genState.pendingApproval) {
      const idx = slides.findIndex(
        (s) => s.step === genState.pendingApproval!.step
      );
      if (idx !== -1) {
        setSlideIndex(idx);
        return;
      }
    }
    const step = genState.currentStep;
    if (
      step === "idle" ||
      step === "done" ||
      step === "error" ||
      step === "cancelled" ||
      step === "persisting" ||
      step === "uploading" ||
      step === "extracting"
    ) {
      return;
    }
    const idx = slides.findIndex((s) => s.step === step);
    if (idx !== -1) setSlideIndex(idx);
  }, [genState.currentStep, genState.pendingApproval, slides]);

  // If slides shrink (e.g. reset), clamp the index
  React.useEffect(() => {
    if (slideIndex > 0 && slideIndex >= slides.length) {
      setSlideIndex(Math.max(0, slides.length - 1));
    }
  }, [slides.length, slideIndex]);

  // Reset scroll to top whenever the visible slide changes
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [slideIndex]);

  const canPrev = slideIndex > 0;
  const canNext = slideIndex < slides.length - 1;

  const goPrev = () => {
    if (!canPrev) return;
    userNavigatedRef.current = true;
    setSlideIndex((i) => Math.max(0, i - 1));
  };
  const goNext = () => {
    if (!canNext) return;
    userNavigatedRef.current = true;
    setSlideIndex((i) => Math.min(slides.length - 1, i + 1));
  };
  const goTo = (i: number) => {
    userNavigatedRef.current = true;
    setSlideIndex(i);
  };
  const jumpToLive = () => {
    userNavigatedRef.current = false;
    const targetStep = genState.pendingApproval
      ? genState.pendingApproval.step
      : genState.currentStep;
    const idx = slides.findIndex((s) => s.step === targetStep);
    if (idx !== -1) setSlideIndex(idx);
  };

  // Keyboard arrows navigate between slides when the panel is focused
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  };

  const currentSlide = slides[slideIndex] ?? null;

  // Are we currently viewing something other than the live/pending step?
  const liveStep = genState.pendingApproval
    ? genState.pendingApproval.step
    : genState.currentStep;
  const viewingLive = currentSlide?.step === liveStep;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="trace-panel"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="AI generation trace"
    >
      {/* Header — status */}
      <div className="trace-panel__header">
        <Icon icon="console" size={13} />
        <span className="trace-panel__title">AIP function trace</span>
        {isRunning && (
          <span className="trace-panel__running">
            <div
              className="scenario-spinner"
              style={{ width: 10, height: 10, borderWidth: 2 }}
            />
            {genState.stepLabel}
          </span>
        )}
        {genState.currentStep === "done" && (
          <span className="trace-panel__done">
            ✓ Complete — {genState.objectsCreated} objects created
          </span>
        )}
        {genState.currentStep === "error" && (
          <span className="trace-panel__failed">
            ✕ Failed at step: {genState.errorStep ?? "?"}
          </span>
        )}
        {genState.currentStep === "cancelled" && (
          <span className="trace-panel__failed">
            ✕ Cancelled at step: {genState.errorStep ?? "?"}
          </span>
        )}

        {/* Skip generation button — only while actively running */}
        {isRunning && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 9px",
              background: "transparent",
              border: "1px solid #454c68",
              borderRadius: 4,
              color: "#6a7292",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.06em",
              cursor: "pointer",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
            onMouseOver={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.borderColor = "#98a1c0";
              el.style.color = "#aab3d0";
            }}
            onFocus={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.borderColor = "#98a1c0";
              el.style.color = "#aab3d0";
            }}
            onMouseOut={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.borderColor = "#454c68";
              el.style.color = "#6a7292";
            }}
            onBlur={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.borderColor = "#454c68";
              el.style.color = "#6a7292";
            }}
            title="Stop generation and skip straight to the workflow step — objects created so far are kept"
          >
            <Icon icon="fast-forward" size={9} />
            Skip generation
          </button>
        )}
      </div>

      {/* Empty state — no trace yet */}
      {slides.length === 0 && (
        <div className="trace-panel__body">
          <div className="trace-panel__empty">
            <Icon icon="console" size={18} style={{ opacity: 0.3 }} />
            <span>
              Waiting for generation to start… The exact inputs sent to the AIP
              function and each response will appear here.
            </span>
          </div>
        </div>
      )}

      {/* Slide navigation strip — prev arrow, chips, next arrow */}
      {slides.length > 0 && (
        <div className="trace-carousel-nav">
          <button
            type="button"
            className="trace-nav-arrow"
            onClick={goPrev}
            disabled={!canPrev}
            title="Previous section (←)"
            aria-label="Previous section"
          >
            <Icon icon="chevron-left" size={14} />
          </button>

          <div className="trace-nav-chips" role="tablist">
            {slides.map((s, i) => {
              const isActive = i === slideIndex;
              return (
                <button
                  key={s.step}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`trace-nav-chip${
                    isActive ? " trace-nav-chip--active" : ""
                  }${s.isCurrent ? " trace-nav-chip--current" : ""}${
                    s.hasError ? " trace-nav-chip--errored" : ""
                  }${s.approval ? " trace-nav-chip--pending" : ""}`}
                  onClick={() => goTo(i)}
                  title={s.label}
                >
                  {s.isCurrent && isRunning && (
                    <div
                      className="scenario-spinner"
                      style={{ width: 8, height: 8, borderWidth: 1.5 }}
                    />
                  )}
                  {s.approval && (
                    <span
                      className="trace-nav-chip__dot"
                      title="Waiting for your approval"
                    />
                  )}
                  <span className="trace-nav-chip__label">{s.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="trace-nav-arrow"
            onClick={goNext}
            disabled={!canNext}
            title="Next section (→)"
            aria-label="Next section"
          >
            <Icon icon="chevron-right" size={14} />
          </button>
        </div>
      )}

      {/* Progress footer — position + "jump to live" affordance */}
      {slides.length > 0 && currentSlide && (
        <div className="trace-carousel-progress">
          <span className="trace-carousel-progress__count">
            {slideIndex + 1} of {slides.length} · {currentSlide.label}
          </span>
          {!viewingLive && (isRunning || genState.pendingApproval) && (
            <button
              type="button"
              className="trace-carousel-jump"
              onClick={jumpToLive}
              title="Jump to the currently-running section"
            >
              <Icon icon="fast-forward" size={9} />
              {genState.pendingApproval ? "Jump to pending" : "Jump to live"}
            </button>
          )}
        </div>
      )}

      {/* Single visible slide — scrolls independently */}
      {currentSlide && (
        <SlideBody
          slide={currentSlide}
          isRunning={isRunning}
          scrollRef={scrollRef}
          onApprove={onApprove}
          onDecline={onDecline}
          onRegenerate={onRegenerate}
        />
      )}
    </div>
  );
}

// ─── Processing Steps Overlay ─────────────────────────────────────────────────
// Shows all raw trace cards for a slide in a full-screen overlay.
function ProcessingStepsOverlay({
  entries,
  stepLabel,
  onClose,
}: {
  entries: TraceEntry[];
  stepLabel: string;
  onClose: () => void;
}) {
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    <div
      onClick={handleBackdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(8, 12, 20, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          background: "#141828",
          border: "1.5px solid #2a3358",
          borderRadius: 10,
          boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid #1c2547",
            background: "#0e1224",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: "#2a3358",
              border: "1px solid #3a4a5c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon icon="flow-linear" size={14} color="#98a1c0" />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#e6eaf8",
                lineHeight: 1.2,
              }}
            >
              Processing Steps
            </div>
            <div style={{ fontSize: 10, color: "#6a7292", marginTop: 2 }}>
              {stepLabel} · {entries.length} step
              {entries.length === 1 ? "" : "s"} — function calls, responses,
              ontology writes
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid #2a3358",
              borderRadius: 4,
              color: "#6a7292",
              cursor: "pointer",
              padding: "3px 7px",
              display: "flex",
              alignItems: "center",
            }}
            title="Close (Esc)"
          >
            <Icon icon="cross" size={11} />
          </button>
        </div>

        {/* Body — trace cards */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          {entries.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: "#6a7292",
                fontSize: 12,
                padding: 32,
              }}
            >
              No processing steps recorded for this section.
            </div>
          ) : (
            entries.map((e) => <TraceEntryCard key={e.id} entry={e} />)
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid #1c2547",
            display: "flex",
            justifyContent: "flex-end",
            flexShrink: 0,
            background: "#0e1224",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 16px",
              background: "#1c2547",
              border: "1px solid #3a4a5c",
              borderRadius: 5,
              color: "#98a1c0",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SlideBody ────────────────────────────────────────────────────────────────
// Single scrollable view once a parsed proposal exists:
//   1. Proposal card (what the objects look like)
//   2. Reasoning button (opens overlay)
//   3. "View processing steps" button (opens overlay with all trace cards)
//
// While pending approval → ApprovalBar (unchanged).
// While still running with no entries → spinner/empty state.
// Before a parsed payload arrives → all entries shown flat (unchanged).
function SlideBody({
  slide,
  isRunning,
  scrollRef,
  onApprove,
  onDecline,
  onRegenerate,
}: {
  slide: TraceSlide;
  isRunning: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  onApprove?: () => void;
  onDecline?: () => void;
  onRegenerate?: (feedback: string) => void;
}) {
  const [stepsOpen, setStepsOpen] = React.useState(false);

  // Reset steps overlay when slide changes
  const prevStepRef = React.useRef(slide.step);
  React.useEffect(() => {
    if (prevStepRef.current !== slide.step) {
      setStepsOpen(false);
      prevStepRef.current = slide.step;
    }
  }, [slide.step]);

  // Partition entries
  const parsedEntry =
    slide.entries.find(
      (e) => e.kind === "info" && e.label === "Parsed JSON payload"
    ) ?? null;
  const reasoningEntry =
    slide.entries.find(
      (e) => e.kind === "info" && e.label === "AI reasoning"
    ) ?? null;
  // All entries except the two above go into the steps overlay
  const stepEntries = slide.entries.filter(
    (e) => e.label !== "Parsed JSON payload" && e.label !== "AI reasoning"
  );

  const hasProposal = parsedEntry !== null && !slide.approval;

  // Pending approval — ApprovalBar + reasoning button + steps button.
  // Raw trace cards are NEVER shown inline; they are only in the overlay.
  if (slide.approval) {
    return (
      <>
        {stepsOpen && (
          <ProcessingStepsOverlay
            entries={stepEntries}
            stepLabel={slide.label}
            onClose={() => setStepsOpen(false)}
          />
        )}
        <div className="trace-panel__body" ref={scrollRef}>
          <ApprovalBar
            pending={slide.approval}
            onApprove={onApprove}
            onDecline={onDecline}
            onRegenerate={onRegenerate}
          />
          {reasoningEntry && (
            <ReasoningButton
              payload={
                reasoningEntry.payload as {
                  reasoning?: string;
                  items?: Array<{ index: number; reasoning: string }>;
                }
              }
              stepLabel={slide.label}
            />
          )}
          {stepEntries.length > 0 && (
            <ViewStepsButton
              count={stepEntries.length}
              onOpen={() => setStepsOpen(true)}
            />
          )}
        </div>
      </>
    );
  }

  // Empty / running state
  if (slide.entries.length === 0) {
    return (
      <div className="trace-panel__body" ref={scrollRef}>
        <div className="trace-panel__empty">
          <Icon icon="console" size={18} style={{ opacity: 0.3 }} />
          <span>
            {slide.isCurrent && isRunning
              ? `Waiting for the AI response for ${slide.label}…`
              : `No activity yet for ${slide.label}.`}
          </span>
        </div>
      </div>
    );
  }

  // Main view — proposal card + buttons
  if (hasProposal) {
    return (
      <>
        {stepsOpen && (
          <ProcessingStepsOverlay
            entries={stepEntries}
            stepLabel={slide.label}
            onClose={() => setStepsOpen(false)}
          />
        )}
        <div className="trace-panel__body" ref={scrollRef}>
          {/* 1. Proposal card */}
          <SlideProposalCard
            step={parsedEntry.step}
            payload={parsedEntry.payload}
            label={slide.label}
          />

          {/* 2. Reasoning button */}
          {reasoningEntry && (
            <ReasoningButton
              payload={
                reasoningEntry.payload as {
                  reasoning?: string;
                  items?: Array<{ index: number; reasoning: string }>;
                }
              }
              stepLabel={slide.label}
            />
          )}

          {/* 3. Processing steps button */}
          {stepEntries.length > 0 && (
            <ViewStepsButton
              count={stepEntries.length}
              onOpen={() => setStepsOpen(true)}
            />
          )}
        </div>
      </>
    );
  }

  // Fallback — no parsed payload yet and no approval pending.
  // Show a compact status line + steps button; DO NOT dump raw trace cards.
  return (
    <>
      {stepsOpen && (
        <ProcessingStepsOverlay
          entries={stepEntries}
          stepLabel={slide.label}
          onClose={() => setStepsOpen(false)}
        />
      )}
      <div className="trace-panel__body" ref={scrollRef}>
        <div className="trace-panel__empty">
          <Icon icon="console" size={18} style={{ opacity: 0.3 }} />
          <span>
            {slide.isCurrent && isRunning
              ? `Working on ${slide.label}… The result will appear here once the AI responds.`
              : `${slide.label} — no result yet.`}
          </span>
        </div>
        {stepEntries.length > 0 && (
          <ViewStepsButton
            count={stepEntries.length}
            onOpen={() => setStepsOpen(true)}
          />
        )}
      </div>
    </>
  );
}

// ─── ViewStepsButton ─────────────────────────────────────────────────────────
// Reusable "View processing steps" button — same visual language as
// ReasoningButton so users recognise the pattern (button opens overlay).
function ViewStepsButton({
  count,
  onOpen,
}: {
  count: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        background: "transparent",
        border: "1px solid #2a3358",
        borderRadius: 7,
        cursor: "pointer",
        width: "100%",
        textAlign: "left",
        marginTop: 4,
      }}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#4a5a6c";
        (e.currentTarget as HTMLButtonElement).style.background = "#1a2435";
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#4a5a6c";
        (e.currentTarget as HTMLButtonElement).style.background = "#1a2435";
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#2a3358";
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#2a3358";
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
      title="View the raw processing steps — function calls, AI responses, and ontology writes"
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 5,
          background: "#1c2547",
          border: "1px solid #2a3358",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon icon="flow-linear" size={13} color="#6a7292" />
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#98a1c0",
            lineHeight: 1.2,
          }}
        >
          View processing steps
        </div>
        <div style={{ fontSize: 9, color: "#6a7292", marginTop: 2 }}>
          {count} step{count === 1 ? "" : "s"} — function calls, responses &amp;
          ontology writes
        </div>
      </div>
      <Icon icon="arrow-right" size={11} color="#3a4a5c" />
    </button>
  );
}

// ─── SlideProposalCard ────────────────────────────────────────────────────────
// Renders the parsed proposal for a completed step in a clean "object card"
// style — reuses the same visual language as ProposalPreview but is fed
// directly from the parsed payload, not from a PendingApproval.
function SlideProposalCard({
  step,
  payload,
  label,
}: {
  step: string;
  payload: unknown;
  label: string;
}) {
  // Scenario (object)
  if (
    step === "scenario" &&
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload)
  ) {
    const p = payload as {
      scenarioName?: string;
      scenarioType?: string;
      classification?: string;
      strategicContextTitle?: string;
      strategicContextBody?: string;
      sourceDocuments?: string;
      scenarioStatus?: string;
      currentPhase?: string;
      createdDate?: string;
      overallProgressPct?: number;
      trainingAudience?: {
        audienceName?: string;
        audienceType?: string;
        audienceDescription?: string;
        directorates?: string;
        participantCount?: number;
      };
    };
    return (
      <div className="approval-preview">
        <div className="approval-preview__section">
          <div className="approval-preview__section-title">
            Scenario — {label}
          </div>
          <div className="approval-preview__facts">
            {[
              {
                label: "Name",
                value: p.scenarioName ?? "(missing)",
                mono: true,
              },
              { label: "Type", value: p.scenarioType ?? "(missing)" },
              {
                label: "Classification",
                value: p.classification ?? "(missing)",
              },
              { label: "Status", value: p.scenarioStatus ?? "Draft" },
              { label: "Current phase", value: p.currentPhase ?? "(not set)" },
              {
                label: "Created",
                value: p.createdDate ?? "(today)",
                mono: true,
              },
            ].map(({ label: l, value, mono }) => (
              <div key={l} className="approval-fact">
                <div className="approval-fact__label">{l}</div>
                <div
                  className={`approval-fact__value${
                    mono ? " approval-fact__value--mono" : ""
                  }`}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
        {(p.strategicContextTitle || p.strategicContextBody) && (
          <div className="approval-preview__section">
            <div className="approval-preview__section-title">
              Strategic context
            </div>
            {p.strategicContextTitle && (
              <div className="approval-preview__body-title">
                {p.strategicContextTitle}
              </div>
            )}
            {p.strategicContextBody && (
              <div className="approval-preview__body-text">
                {p.strategicContextBody}
              </div>
            )}
          </div>
        )}
        {p.sourceDocuments && (
          <div className="approval-preview__section">
            <div className="approval-preview__section-title">
              Source documents
            </div>
            <div className="approval-preview__body-text approval-preview__body-text--mono">
              {p.sourceDocuments}
            </div>
          </div>
        )}
        {p.trainingAudience && (
          <div className="approval-preview__section">
            <div className="approval-preview__section-title">
              Training audience
            </div>
            <div className="approval-preview__facts">
              {[
                {
                  label: "Name",
                  value: p.trainingAudience.audienceName ?? "(missing)",
                  mono: true,
                },
                {
                  label: "Type",
                  value: p.trainingAudience.audienceType ?? "(missing)",
                },
                {
                  label: "Directorates",
                  value: p.trainingAudience.directorates ?? "(none)",
                },
                {
                  label: "Participants",
                  value:
                    p.trainingAudience.participantCount != null
                      ? String(p.trainingAudience.participantCount)
                      : "(unspecified)",
                  mono: true,
                },
              ].map(({ label: l, value, mono }) => (
                <div key={l} className="approval-fact">
                  <div className="approval-fact__label">{l}</div>
                  <div
                    className={`approval-fact__value${
                      mono ? " approval-fact__value--mono" : ""
                    }`}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
            {p.trainingAudience.audienceDescription && (
              <div
                className="approval-preview__body-text"
                style={{ marginTop: 8 }}
              >
                {p.trainingAudience.audienceDescription}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Arrays (phases, objectives, pmesii, tasks, injects)
  if (Array.isArray(payload)) {
    return (
      <div className="approval-preview">
        <div className="approval-preview__count">
          {payload.length} {payload.length === 1 ? "item" : "items"} — {label}
        </div>
        <div className="approval-preview__items">
          {payload.map((item: unknown, i: number) => {
            const rec = (item ?? {}) as Record<string, unknown>;
            const asStr = (v: unknown): string | undefined =>
              typeof v === "string" && v.length > 0 ? v : undefined;
            const title: string =
              asStr(rec.phaseName) ??
              asStr(rec.objective) ??
              asStr(rec.taskName) ??
              asStr(rec.injectTitle) ??
              asStr(rec.domainKey) ??
              `Item ${i + 1}`;
            const subtitle: string | undefined =
              asStr(rec.phaseDescription) ??
              asStr(rec.taskDescription) ??
              asStr(rec.injectBody) ??
              asStr(rec.domainValue) ??
              asStr(rec.functionalArea);
            const badges: string[] = [];
            const priority = asStr(rec.priority);
            if (priority) badges.push(priority);
            const dueOffset = asStr(rec.dueOffset);
            if (dueOffset) badges.push(dueOffset);
            const startOffset = asStr(rec.startOffset);
            const endOffset = asStr(rec.endOffset);
            if (startOffset && endOffset)
              badges.push(`${startOffset} → ${endOffset}`);
            const injectCategory = asStr(rec.injectCategory);
            if (injectCategory) badges.push(injectCategory);
            const taskSection = asStr(rec.taskSection);
            if (taskSection) badges.push(taskSection);
            return (
              <div key={i} className="approval-item">
                <div className="approval-item__index">{i + 1}</div>
                <div className="approval-item__body">
                  <div className="approval-item__title">{title}</div>
                  {subtitle && (
                    <div className="approval-item__subtitle">{subtitle}</div>
                  )}
                  {badges.length > 0 && (
                    <div className="approval-item__badges">
                      {badges.map((b, bi) => (
                        <span key={bi} className="approval-item__badge">
                          {b}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Fallback
  return (
    <div className="approval-preview">
      <pre className="approval-preview__raw">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}

// ─── Step 3 ───────────────────────────────────────────────────────────────────
function Step3ScenarioDescription({
  exerciseName,
  onExerciseNameChange,
  generating,
  genState,
  onFilesChange,
  onSelectionChange,
  onPromptChange,
  onApprove,
  onDecline,
  onRegenerate,
  onSkipGeneration,
}: {
  exerciseName: string;
  onExerciseNameChange: (v: string) => void;
  generating: boolean;
  /** Full generation state (trace timeline + current step) for the debug panel */
  genState: GenerationState;
  onFilesChange: (scenarioFile: File | null, exdirFile: File | null) => void;
  onSelectionChange: (
    scenarioExisting: ExistingDocument | null,
    exdirExisting: ExistingDocument | null
  ) => void;
  onPromptChange: (prompt: string) => void;
  /** User accepts the currently-pending AI proposal */
  onApprove: () => void;
  /** User declines the currently-pending AI proposal (cancels the run) */
  onDecline: () => void;
  /** User asks the AI to try again with extra feedback / instructions */
  onRegenerate: (feedback: string) => void;
  /** Skip the rest of generation and advance to the workflow step */
  onSkipGeneration: () => void;
}) {
  // Pre-processed documents already stored in the ontology
  const {
    documents: existingDocs,
    loading: docsLoading,
    reload: reloadDocs,
  } = usePPDocuments();

  const [scenarioExisting, setScenarioExisting] =
    useState<ExistingDocument | null>(null);
  const [exdirExisting, setExdirExisting] = useState<ExistingDocument | null>(
    null
  );

  const [openDropdown, setOpenDropdown] = useState<"scenario" | "exdir" | null>(
    null
  );
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpenDropdown(null);
      }
    };
    if (openDropdown) {
      document.addEventListener("mousedown", onDocClick);
      return () => document.removeEventListener("mousedown", onDocClick);
    }
  }, [openDropdown]);

  useEffect(() => {
    onSelectionChange(scenarioExisting, exdirExisting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioExisting, exdirExisting]);
  const ALL_TAGS = [
    "Cyber domain",
    "CIMIC elements",
    "Near-peer OPFOR",
    "SOF integration",
    "Logistics pressure",
    "Joint fires",
    "EW environment",
    "Multi-domain",
  ];
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [promptText, setPromptText] = useState(
    "Generate a full CAX exercise world for a multinational division HQ exercise set on the NATO Eastern Flank. High-intensity conventional conflict. Include PMESII variables, near-peer OPFOR, 14-day MEL/MIL with..."
  );

  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<"scenario" | "exdir" | null>(null);

  const scenarioRef = React.useRef<HTMLInputElement>(null);
  const exdirRef = React.useRef<HTMLInputElement>(null);

  // Notify parent when files change so the root can pass them to generation hook
  useEffect(() => {
    onFilesChange(
      uploads.find((u) => u.slot === "scenario")?.file ?? null,
      uploads.find((u) => u.slot === "exdir")?.file ?? null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploads]);

  // Notify parent when prompt text changes
  useEffect(() => {
    onPromptChange(promptText);
  }, [promptText, onPromptChange]);

  // Revoke object URLs on unmount to avoid memory leaks
  React.useEffect(() => {
    return () => {
      uploads.forEach((u) => URL.revokeObjectURL(u.objectUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFile = (file: File, slot: "scenario" | "exdir") => {
    const id = `${slot}-${Date.now()}`;
    const url = URL.createObjectURL(file);
    setUploads((prev) => {
      const old = prev.find((u) => u.slot === slot);
      if (old) URL.revokeObjectURL(old.objectUrl);
      const next = [
        ...prev.filter((u) => u.slot !== slot),
        // Include the original File reference so the generation hook can read it
        { id, name: file.name, objectUrl: url, type: file.type, slot, file },
      ];
      return next;
    });
    setActiveTab(id);
  };

  const removeFile = (id: string) => {
    const file = uploads.find((u) => u.id === id);
    if (file) URL.revokeObjectURL(file.objectUrl);
    setUploads((prev) => {
      const next = prev.filter((u) => u.id !== id);
      if (activeTab === id) setActiveTab(next[next.length - 1]?.id ?? null);
      return next;
    });
  };

  const handleFileInput = (
    e: React.ChangeEvent<HTMLInputElement>,
    slot: "scenario" | "exdir"
  ) => {
    const file = e.target.files?.[0];
    if (file) addFile(file, slot);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent, slot: "scenario" | "exdir") => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files[0];
    if (file) addFile(file, slot);
  };

  const activeFile = uploads.find((u) => u.id === activeTab) ?? null;

  const renderPreview = () => {
    // While generating (or after done / error) show the live trace timeline
    // instead of the document preview so users see exactly what each step
    // sent to the AIP function and what came back.
    const showTrace =
      generating ||
      genState.currentStep === "done" ||
      genState.currentStep === "error" ||
      genState.currentStep === "cancelled" ||
      genState.trace.length > 0;
    if (showTrace) {
      return (
        <GenerationTracePanel
          genState={genState}
          onApprove={onApprove}
          onDecline={onDecline}
          onRegenerate={onRegenerate}
          onSkip={onSkipGeneration}
        />
      );
    }
    if (!activeFile) {
      return (
        <div className="doc-viewer__empty">
          <Icon icon="document" size={36} className="doc-viewer__empty-icon" />
          <div
            style={{
              fontSize: 13,
              color: "#6a7292",
              maxWidth: 260,
              lineHeight: 1.6,
            }}
          >
            Upload a scenario or exercise direction document — it will appear
            here for review.
          </div>
        </div>
      );
    }
    if (activeFile.type === "application/pdf") {
      return (
        <iframe
          className="doc-viewer__iframe"
          src={activeFile.objectUrl}
          title={activeFile.name}
        />
      );
    }
    if (activeFile.type.startsWith("image/")) {
      return (
        <img
          className="doc-viewer__img"
          src={activeFile.objectUrl}
          alt={activeFile.name}
        />
      );
    }
    return (
      <div className="doc-viewer__unsupported">
        <Icon icon="document" size={28} style={{ opacity: 0.3 }} />
        <div style={{ fontSize: 13 }}>{activeFile.name}</div>
        <div style={{ fontSize: 11, color: "#454c68" }}>
          Preview not available for this file type.
        </div>
        <a
          href={activeFile.objectUrl}
          download={activeFile.name}
          style={{ color: "#4c7ef3", fontSize: 12 }}
        >
          Download file
        </a>
      </div>
    );
  };

  const fileForSlot = (slot: "scenario" | "exdir") =>
    uploads.find((u) => u.slot === slot);

  return (
    <div className="scenario-layout" style={{ height: "100%" }}>
      {/* Left panel */}
      <div className="scenario-left">
        <div>
          <div className="scenario-field-label">Exercise name</div>
          <div className="scenario-name-wrap">
            <input
              className="scenario-input"
              value={exerciseName}
              onChange={(e) => onExerciseNameChange(e.target.value)}
              placeholder="e.g. EXERCISE IRON FORGE 26"
            />
            {exerciseName && (
              <button
                type="button"
                className="scenario-name-clear"
                onClick={() => onExerciseNameChange("")}
                title="Clear"
              >
                <Icon icon="cross" size={9} />
              </button>
            )}
          </div>
        </div>

        {/* Scenario doc upload */}
        <div>
          <div className="scenario-field-label">
            Upload scenario document (PDF)
          </div>
          <input
            ref={scenarioRef}
            type="file"
            accept=".pdf,image/*"
            style={{ display: "none" }}
            onChange={(e) => handleFileInput(e, "scenario")}
          />
          <DocumentSlotControls
            slot="scenario"
            existing={scenarioExisting}
            uploadedName={fileForSlot("scenario")?.name ?? null}
            docs={existingDocs}
            docsLoading={docsLoading}
            reloadDocs={reloadDocs}
            openDropdown={openDropdown}
            setOpenDropdown={setOpenDropdown}
            dropdownRef={dropdownRef}
            onPickExisting={(d) => {
              const up = fileForSlot("scenario");
              if (up) removeFile(up.id);
              setScenarioExisting(d);
              setOpenDropdown(null);
            }}
            onClearExisting={() => setScenarioExisting(null)}
            onUploadClick={() => {
              setScenarioExisting(null);
              scenarioRef.current?.click();
            }}
            dragOver={dragOver === "scenario"}
            onDrop={(e) => {
              setScenarioExisting(null);
              handleDrop(e, "scenario");
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver("scenario");
            }}
            onDragLeave={() => setDragOver(null)}
            uploadLabel="Drop scenario PDF here or click to upload"
            uploadSubLabel="Exercise background, threat overview, strategic context"
          />
          {fileForSlot("scenario") && (
            <div className="scenario-file-chip" style={{ marginTop: 6 }}>
              <Icon icon="document" size={12} style={{ color: "#ef4d4d" }} />
              <button
                type="button"
                className="scenario-file-chip__name"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  color:
                    activeTab === fileForSlot("scenario")!.id
                      ? "#e6eaf8"
                      : "#98a1c0",
                  fontFamily: "monospace",
                  fontSize: 11,
                  padding: 0,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                onClick={() => setActiveTab(fileForSlot("scenario")!.id)}
              >
                {fileForSlot("scenario")!.name}
              </button>
              <button
                type="button"
                className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only"
                style={{ marginLeft: "auto" }}
                onClick={() => removeFile(fileForSlot("scenario")!.id)}
              >
                <Icon icon="cross" size={10} />
              </button>
            </div>
          )}
        </div>

        {/* EXDIR upload */}
        <div>
          <div className="scenario-field-label">
            Upload exercise direction (PDF, optional)
          </div>
          <input
            ref={exdirRef}
            type="file"
            accept=".pdf,image/*"
            style={{ display: "none" }}
            onChange={(e) => handleFileInput(e, "exdir")}
          />
          <DocumentSlotControls
            slot="exdir"
            existing={exdirExisting}
            uploadedName={fileForSlot("exdir")?.name ?? null}
            docs={existingDocs}
            docsLoading={docsLoading}
            reloadDocs={reloadDocs}
            openDropdown={openDropdown}
            setOpenDropdown={setOpenDropdown}
            dropdownRef={dropdownRef}
            onPickExisting={(d) => {
              const up = fileForSlot("exdir");
              if (up) removeFile(up.id);
              setExdirExisting(d);
              setOpenDropdown(null);
            }}
            onClearExisting={() => setExdirExisting(null)}
            onUploadClick={() => {
              setExdirExisting(null);
              exdirRef.current?.click();
            }}
            dragOver={dragOver === "exdir"}
            onDrop={(e) => {
              setExdirExisting(null);
              handleDrop(e, "exdir");
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver("exdir");
            }}
            onDragLeave={() => setDragOver(null)}
            uploadLabel="Drop EXDIR PDF here or click to upload"
            uploadSubLabel="Commander's intent, training objectives, constraints"
          />
          {fileForSlot("exdir") && (
            <div className="scenario-file-chip" style={{ marginTop: 6 }}>
              <Icon icon="document" size={12} style={{ color: "#ef4d4d" }} />
              <button
                type="button"
                className="scenario-file-chip__name"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  color:
                    activeTab === fileForSlot("exdir")!.id
                      ? "#e6eaf8"
                      : "#98a1c0",
                  fontFamily: "monospace",
                  fontSize: 11,
                  padding: 0,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                onClick={() => setActiveTab(fileForSlot("exdir")!.id)}
              >
                {fileForSlot("exdir")!.name}
              </button>
              <button
                type="button"
                className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only"
                style={{ marginLeft: "auto" }}
                onClick={() => removeFile(fileForSlot("exdir")!.id)}
              >
                <Icon icon="cross" size={10} />
              </button>
            </div>
          )}
        </div>

        {/* AI prompt */}
        <div>
          <div
            className="scenario-field-label"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span className="scenario-prompt-chip">
              <Icon icon="lightbulb" size={9} />
              AI prompt
            </span>
            {promptText && (
              <button
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#6a7292",
                  padding: "2px 4px",
                  display: "flex",
                  alignItems: "center",
                  marginLeft: "auto",
                  borderRadius: 2,
                  transition: "color 0.1s",
                }}
                onClick={() => setPromptText("")}
                title="Clear prompt"
              >
                <Icon icon="cross" size={9} />
              </button>
            )}
          </div>
          <textarea
            className="scenario-textarea"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Describe what to generate…"
            rows={5}
          />
          <div className="scenario-tag-list" style={{ marginTop: 8 }}>
            {ALL_TAGS.map((tag) => {
              const active = activeTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`scenario-tag${
                    active ? " scenario-tag--active" : ""
                  }`}
                  onClick={() => {
                    if (!active) {
                      setActiveTags((prev) => [...prev, tag]);
                      setPromptText((p) =>
                        p ? `${p.trimEnd()} [${tag}]` : `[${tag}]`
                      );
                    } else {
                      setActiveTags((prev) => prev.filter((t) => t !== tag));
                      setPromptText((p) =>
                        p
                          .replace(` [${tag}]`, "")
                          .replace(`[${tag}]`, "")
                          .trimEnd()
                      );
                    }
                  }}
                >
                  {active ? (
                    <Icon icon="tick" size={9} style={{ marginRight: 3 }} />
                  ) : (
                    "+ "
                  )}
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right panel — document viewer */}
      <div className="doc-viewer">
        {/* Tab bar — only show when files are uploaded */}
        {uploads.length > 0 && (
          <div className="doc-viewer__toolbar">
            {uploads.map((u) => (
              <div
                key={u.id}
                className={`doc-viewer__tab${
                  activeTab === u.id ? " doc-viewer__tab--active" : ""
                }`}
                style={{ display: "flex", alignItems: "center", gap: 5 }}
              >
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "inherit",
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    fontWeight: "inherit",
                    letterSpacing: "inherit",
                    padding: 0,
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  onClick={() => setActiveTab(u.id)}
                  title={u.name}
                >
                  <Icon
                    icon="document"
                    size={11}
                    style={{ marginRight: 5, flexShrink: 0 }}
                  />
                  {u.name}
                </button>
                <button
                  type="button"
                  className="doc-viewer__tab-close"
                  onClick={() => removeFile(u.id)}
                  title="Close"
                >
                  <Icon icon="cross" size={9} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Preview body */}
        <div className="doc-viewer__body">{renderPreview()}</div>
      </div>
    </div>
  );
}

// ─── Step 4 ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS_LIST = [
  "#4c7ef3",
  "#24b47e",
  "#8b5cf6",
  "#f0a83c",
  "#ef4d4d",
  "#6c5ce7",
  "#6a7292",
];

function Step4WorkflowTeam({
  tasks,
  onAssign,
  onDeleteTask,
  onAddTask,
  onDeleteMember,
  onAddMember,
}: {
  tasks: WorkflowTask[];
  onAssign: (
    taskId: string,
    field: "approver" | "owner",
    value: string
  ) => void;
  onDeleteTask: (id: string) => void;
  onAddTask: (t: WorkflowTask) => void;
  onDeleteMember: (id: string) => void;
  onAddMember: (m: TeamMember) => void;
}) {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(TEAM_MEMBERS);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddMem, setShowAddMem] = useState(false);
  const [newTask, setNewTask] = useState({
    name: "",
    desc: "",
    group: "Planning & Design",
    due: "",
  });
  const [newMem, setNewMem] = useState({ name: "", role: "" });

  const groups = [...new Set(tasks.map((t) => t.group))];

  const memberOptions = [
    { value: "", label: "— Assign —" },
    ...teamMembers.map((m) => ({ value: m.id, label: m.name })),
  ];

  const handleAddTask = () => {
    if (!newTask.name.trim()) return;
    const id = `wt-${Date.now()}`;
    onAddTask({
      id,
      group: newTask.group,
      name: newTask.name,
      desc: newTask.desc,
      approver: "",
      owner: "",
      due: newTask.due || "TBD",
      status: "pending",
    });
    setNewTask({ name: "", desc: "", group: "Planning & Design", due: "" });
    setShowAddTask(false);
  };

  const handleAddMember = () => {
    if (!newMem.name.trim()) return;
    const initials = newMem.name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const id = `mem-${Date.now()}`;
    const color =
      AVATAR_COLORS_LIST[teamMembers.length % AVATAR_COLORS_LIST.length];
    const member: TeamMember = {
      id,
      initials,
      name: newMem.name,
      role: newMem.role,
      color,
    };
    setTeamMembers((prev) => [...prev, member]);
    onAddMember(member);
    setNewMem({ name: "", role: "" });
    setShowAddMem(false);
  };

  const handleDeleteMember = (id: string) => {
    setTeamMembers((prev) => prev.filter((m) => m.id !== id));
    onDeleteMember(id);
  };

  const TASK_GROUPS = [
    "Planning & Design",
    "Scenario & Environment",
    "Execution Planning",
  ];

  return (
    <div className="workflow-layout" style={{ height: "100%" }}>
      {/* Left: team roster */}
      <div className="workflow-left">
        <div>
          <div className="workflow-section-label">Workflow</div>
          <div style={{ fontSize: 12, color: "#98a1c0", lineHeight: 1.5 }}>
            Assign approvers and task owners.
          </div>
        </div>

        <div>
          <div className="workflow-section-label">Exercise team</div>
          {teamMembers.map((m) => (
            <div
              key={m.id}
              className="workflow-member"
              style={{ paddingRight: 6 }}
            >
              <div
                className="workflow-member__avatar"
                style={{ background: m.color }}
              >
                {m.initials}
              </div>
              <div className="workflow-member__info">
                <div className="workflow-member__name">{m.name}</div>
                <div className="workflow-member__role">{m.role}</div>
              </div>
              <button
                type="button"
                className="mil-btn mil-btn--danger mil-btn--sm mil-btn--icon-only"
                title="Remove member"
                onClick={() => handleDeleteMember(m.id)}
                style={{
                  opacity: 0,
                  transition: "opacity 0.1s",
                  marginLeft: "auto",
                  flexShrink: 0,
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                }}
                onFocus={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = "0";
                }}
                onBlur={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = "0";
                }}
              >
                <Icon icon="cross" size={10} />
              </button>
            </div>
          ))}

          {showAddMem ? (
            <div className="workflow-add-member-form">
              <input
                placeholder="Full name"
                value={newMem.name}
                onChange={(e) =>
                  setNewMem((p) => ({ ...p, name: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddMember();
                  if (e.key === "Escape") setShowAddMem(false);
                }}
                ref={(el) => {
                  if (el) el.focus();
                }}
              />
              <input
                placeholder="Role (optional)"
                value={newMem.role}
                onChange={(e) =>
                  setNewMem((p) => ({ ...p, role: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddMember();
                  if (e.key === "Escape") setShowAddMem(false);
                }}
              />
              <div className="workflow-add-member-form__btns">
                <button
                  type="button"
                  className="mil-btn mil-btn--ghost mil-btn--sm"
                  onClick={() => setShowAddMem(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="mil-btn mil-btn--primary mil-btn--sm"
                  onClick={handleAddMember}
                  disabled={!newMem.name.trim()}
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="workflow-add-btn"
              onClick={() => setShowAddMem(true)}
            >
              <Icon icon="plus" size={11} /> Add team member
            </button>
          )}
        </div>
      </div>

      {/* Right: tasks table */}
      <div className="workflow-right">
        <table className="workflow-table">
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Task</th>
              <th style={{ width: "20%" }}>Approver</th>
              <th style={{ width: "20%" }}>Task owner</th>
              <th style={{ width: "10%" }}>Due</th>
              <th style={{ width: "10%" }}>Status</th>
              <th style={{ width: "6%" }} />
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <React.Fragment key={group}>
                <tr className="workflow-group-row">
                  <td colSpan={6}>{group}</td>
                </tr>
                {tasks
                  .filter((t) => t.group === group)
                  .map((task) => {
                    const stat = STATUS_LABEL[task.status];
                    return (
                      <tr key={task.id} className="workflow-task-row">
                        <td>
                          <div className="workflow-task-row__name">
                            {task.name}
                            {task.ai && (
                              <span className="workflow-task-row__ai">AI</span>
                            )}
                          </div>
                          <div className="workflow-task-row__desc">
                            {task.desc}
                          </div>
                        </td>
                        <td>
                          <select
                            className="workflow-assign-select"
                            value={task.approver}
                            onChange={(e) =>
                              onAssign(task.id, "approver", e.target.value)
                            }
                          >
                            {memberOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className="workflow-assign-select"
                            value={task.owner}
                            onChange={(e) =>
                              onAssign(task.id, "owner", e.target.value)
                            }
                          >
                            {memberOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span className="workflow-due">{task.due}</span>
                        </td>
                        <td>
                          <span className={`workflow-status-badge ${stat.cls}`}>
                            {stat.label}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="mil-btn mil-btn--danger mil-btn--sm mil-btn--icon-only"
                            title="Delete task"
                            onClick={() => onDeleteTask(task.id)}
                          >
                            <Icon icon="cross" size={10} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </React.Fragment>
            ))}

            {/* Inline add-task row */}
            {showAddTask ? (
              <tr>
                <td colSpan={6}>
                  <div className="workflow-add-row">
                    <input
                      placeholder="Task name"
                      value={newTask.name}
                      onChange={(e) =>
                        setNewTask((p) => ({ ...p, name: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddTask();
                        if (e.key === "Escape") setShowAddTask(false);
                      }}
                      ref={(el) => {
                        if (el) el.focus();
                      }}
                      style={{ flex: 2 }}
                    />
                    <input
                      placeholder="Description (optional)"
                      value={newTask.desc}
                      onChange={(e) =>
                        setNewTask((p) => ({ ...p, desc: e.target.value }))
                      }
                      style={{ flex: 2 }}
                    />
                    <select
                      value={newTask.group}
                      onChange={(e) =>
                        setNewTask((p) => ({ ...p, group: e.target.value }))
                      }
                    >
                      {TASK_GROUPS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="Due (e.g. D-30)"
                      value={newTask.due}
                      onChange={(e) =>
                        setNewTask((p) => ({ ...p, due: e.target.value }))
                      }
                      style={{ width: 90 }}
                    />
                    <button
                      type="button"
                      className="mil-btn mil-btn--ghost mil-btn--sm"
                      onClick={() => setShowAddTask(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="mil-btn mil-btn--primary mil-btn--sm"
                      onClick={handleAddTask}
                      disabled={!newTask.name.trim()}
                    >
                      Add
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={6} style={{ padding: "10px 12px" }}>
                  <button
                    type="button"
                    className="workflow-add-btn"
                    style={{ width: "auto" }}
                    onClick={() => setShowAddTask(true)}
                  >
                    <Icon icon="plus" size={11} /> Add workflow task
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Step 5: Success ──────────────────────────────────────────────────────────
function StepSuccess({
  exerciseName,
  exType,
  onHome,
  onPrepare,
}: {
  exerciseName: string;
  exType: ExerciseType | null;
  onHome: () => void;
  /** Fires the Workshop event and returns to home */
  onPrepare: () => void;
}) {
  const typeLabel: Record<ExerciseType, string> = {
    cax: "CAX",
    caw: "CAW",
    planning: "Planning",
    analysis: "Analysis",
  };
  return (
    <div className="success-screen">
      <div className="success-icon">
        <Icon icon="tick" size={28} />
      </div>
      <div className="success-title">Exercise created</div>
      <div className="success-subtitle">
        Exercise {exerciseName || "IRON FORGE 26"} is set up with workflow and
        team assigned. Proceed to the Prepare phase to define the full exercise
        world.
      </div>

      <div className="success-card">
        <div className="success-card__header">
          {exerciseName || "EXERCISE IRON FORGE 26"}
        </div>
        <div className="success-card__body">
          <div className="success-card__row">
            <span className="success-card__row-label">Type</span>
            <span className="success-card__row-value">
              {exType ? typeLabel[exType] : "CAX"}
            </span>
          </div>
          <div className="success-card__row">
            <span className="success-card__row-label">Team assigned</span>
            <span className="success-card__row-value success-card__row-value--green">
              {TEAM_MEMBERS.length} members ✓
            </span>
          </div>
          <div className="success-card__row">
            <span className="success-card__row-label">Workflow tasks</span>
            <span className="success-card__row-value success-card__row-value--green">
              {WORKFLOW_TASKS.length} tasks created ✓
            </span>
          </div>
          <div className="success-card__row">
            <span className="success-card__row-label">Next step</span>
            <span className="success-card__row-value success-card__row-value--amber">
              Prepare phase →
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button type="button" className="planner-btn-ghost" onClick={onHome}>
          Back to home
        </button>
        <button
          type="button"
          className="planner-btn-primary"
          onClick={onPrepare}
        >
          Open Prepare phase →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────
export const Planner: React.FC = () => {
  const { parameters, emitEvent } = useWidgetContext();

  // ── Existing exercises ──────────────────────────────────────────────────
  // Listed from the Scenarios object set the module binds, so the home
  // screen shows exercises that actually exist. This replaces a hard-coded
  // ONGOING_WORK array whose Resume button only removed the card locally.
  const {
    scenarios,
    loading: scenariosLoading,
    source: scenariosSource,
  } = useNxgScenarioListFromObjectSet(parameters.values.scenarios?.objectSet);

  const work = useMemo(
    () => scenarios.map((scenario) => scenarioToWork(scenario)),
    [scenarios]
  );

  // Tells Workshop which exercise to open. The exercise name and type ride
  // along so the existing Prepare/PMESII wiring keeps working unchanged.
  const handleOpenScenario = useCallback(
    (item: OngoingWork) => {
      emitEvent("onOpenScenario", {
        parameterUpdates: {
          // An object set of exactly this scenario, so the scenario-scoped
          // widgets can be bound straight to it.
          selectedScenario: client(NxgScenario).where({
            scenarioId: { $eq: item.id },
          }),
          exerciseName: item.title,
          exerciseType: item.categoryLabel,
        },
      });
    },
    [emitEvent]
  );

  const [screen, setScreen] = useState<"home" | "wizard">("home");
  const [step, setStep] = useState(0); // 0-3 wizard, 4 = success
  const [exType, setExType] = useState<ExerciseType | null>(null);
  const [method, setMethod] = useState<CreationMethod | null>(null);
  const [exerciseName, setExerciseName] = useState("EXERCISE IRON FORGE");
  const [tasks, setTasks] = useState<WorkflowTask[]>(WORKFLOW_TASKS);

  // ── AI generation state ────────────────────────────────────────────────
  // Files, existing-doc selections and prompt text are lifted from Step3
  // so the root can pass them to the generation hook when Generate is clicked.
  const [scenarioFile, setScenarioFile] = useState<File | null>(null);
  const [exdirFile, setExdirFile] = useState<File | null>(null);
  const [scenarioExisting, setScenarioExisting] =
    useState<ExistingDocument | null>(null);
  const [exdirExisting, setExdirExisting] = useState<ExistingDocument | null>(
    null
  );
  const [aiPrompt, setAiPrompt] = useState("");
  const {
    state: genState,
    generate,
    reset: resetGen,
    approve: approveStep,
    decline: declineStep,
    regenerate: regenerateStep,
  } = useScenarioGeneration();
  const isGenerating =
    genState.currentStep !== "idle" &&
    genState.currentStep !== "done" &&
    genState.currentStep !== "error" &&
    genState.currentStep !== "cancelled";

  // ── Duplicate-name guard ────────────────────────────────────────────────
  // Before allowing generation to start we check whether a NxgScenario with
  // the same name (case-insensitive) already exists in the ontology.
  const [nameCheckState, setNameCheckState] = React.useState<
    "idle" | "checking" | "clear" | "duplicate"
  >("idle");
  const [duplicateScenarioName, setDuplicateScenarioName] = React.useState<
    string | null
  >(null);
  const nameCheckTimeoutRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // Debounce: re-check 600 ms after the user stops typing the exercise name.
  useEffect(() => {
    const trimmed = exerciseName.trim();
    if (!trimmed) {
      setNameCheckState("idle");
      setDuplicateScenarioName(null);
      return;
    }
    setNameCheckState("checking");
    setDuplicateScenarioName(null);
    if (nameCheckTimeoutRef.current) clearTimeout(nameCheckTimeoutRef.current);
    nameCheckTimeoutRef.current = setTimeout(async () => {
      try {
        // 1. Exact match (fast path)
        const exactPage = await client(NxgScenario)
          .where({ scenarioName: { $eq: trimmed } })
          .fetchPage({ $pageSize: 1 });
        if (exactPage.data.length > 0) {
          setNameCheckState("duplicate");
          setDuplicateScenarioName(exactPage.data[0].scenarioName ?? trimmed);
          return;
        }
        // 2. Case-insensitive pass — catches "exercise iron forge 26" matching
        //    "EXERCISE IRON FORGE 26" via full-text tokenisation.
        const words = trimmed.split(/\s+/).join(" ");
        const ciPage = await client(NxgScenario)
          .where({ scenarioName: { $containsAllTerms: words } })
          .fetchPage({ $pageSize: 10 });
        const match = ciPage.data.find(
          (s) => (s.scenarioName ?? "").toLowerCase() === trimmed.toLowerCase()
        );
        if (match) {
          setNameCheckState("duplicate");
          setDuplicateScenarioName(match.scenarioName ?? trimmed);
        } else {
          setNameCheckState("clear");
        }
      } catch {
        // Fail open — network issues should not block generation.
        setNameCheckState("clear");
      }
    }, 600);
    return () => {
      if (nameCheckTimeoutRef.current)
        clearTimeout(nameCheckTimeoutRef.current);
    };
  }, [exerciseName]);

  // Emits the Workshop event — Workshop owns the page navigation.
  // We intentionally do NOT reset state here; the page change unmounts the
  // widget naturally. If no Workshop action is wired the success screen stays.
  const handleOpenPrepare = useCallback(() => {
    emitEvent("onOpenPreparePhase", {
      parameterUpdates: {
        exerciseName: exerciseName || "EXERCISE IRON FORGE 26",
        exerciseType: exType ?? "cax",
      },
    });
  }, [emitEvent, exerciseName, exType]);

  // Emits the Workshop event that opens the PMESII action/module — Workshop
  // owns what "open" means (navigate, open a module, run an action, etc.).
  // We just hand it the current exercise name so the target view can scope
  // to it.
  const handleOpenPmesii = useCallback(() => {
    emitEvent("onOpenPmesii", {
      parameterUpdates: {
        exerciseName: exerciseName || "EXERCISE IRON FORGE 26",
      },
    });
  }, [emitEvent, exerciseName]);

  // Notifications state (lifted to root so wizard changes push to home)
  const [notifications, setNotifications] = useState<Notification[]>(
    INITIAL_NOTIFICATIONS
  );

  const pushNotification = useCallback(
    (n: Omit<Notification, "id" | "read">) => {
      setNotifications((prev) => [
        { ...n, id: `live-${Date.now()}`, read: false },
        ...prev,
      ]);
    },
    []
  );

  const handleAssign = (
    taskId: string,
    field: "approver" | "owner",
    value: string
  ) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const updated = { ...t, [field]: value };
        // auto-update status
        if (updated.approver && updated.owner) updated.status = "assigned";
        else if (updated.owner || updated.approver) updated.status = "review";
        else updated.status = "pending";

        // Push notification
        const memberName =
          TEAM_MEMBERS.find((m) => m.id === value)?.name ?? "Unknown";
        if (field === "approver" && value) {
          pushNotification({
            type: "approval",
            title: `Approval assignment: ${updated.name}`,
            desc: `${memberName} set as approver for '${updated.name}' — ${updated.group}`,
            time: "Just now",
            iconColor: "#f0a83c",
            icon: "tick-circle",
          });
        }
        if (field === "owner" && value) {
          pushNotification({
            type: "assignment",
            title: `Task owner assigned: ${updated.name}`,
            desc: `${memberName} assigned as task owner for '${updated.name}' — ${updated.group}`,
            time: "Just now",
            iconColor: "#4c7ef3",
            icon: "person",
          });
        }
        if (
          updated.approver &&
          updated.owner &&
          (t.approver !== updated.approver || t.owner !== updated.owner)
        ) {
          pushNotification({
            type: "change",
            title: `Task fully assigned: ${updated.name}`,
            desc: `'${updated.name}' now has both approver and owner — status updated to Assigned`,
            time: "Just now",
            iconColor: "#6c5ce7",
            icon: "tick",
          });
        }
        return updated;
      })
    );
  };

  const canContinue = () => {
    if (step === 0) return exType !== null;
    if (step === 1) return method !== null;
    if (step === 2)
      return (
        exerciseName.trim().length > 0 &&
        !isGenerating &&
        nameCheckState !== "duplicate" &&
        nameCheckState !== "checking"
      );
    return true;
  };

  // Trigger real AI generation — separate from the "Continue" flow
  const handleGenerate = useCallback(async () => {
    resetGen();
    await generate({
      exerciseName,
      scenarioFile,
      scenarioExisting,
      exdirFile,
      exdirExisting,
      aiPrompt,
    });
  }, [
    generate,
    resetGen,
    exerciseName,
    scenarioFile,
    scenarioExisting,
    exdirFile,
    exdirExisting,
    aiPrompt,
  ]);

  const handleContinue = () => {
    if (step < 3) setStep((s) => s + 1);
    else setStep(4); // success
  };

  const handleBack = () => {
    if (step > 0) setStep((s) => s - 1);
    else setScreen("home");
  };

  // ── Home screen ─────────────────────────────────────────────────────────
  if (screen === "home") {
    return (
      <HomeScreen
        work={work}
        workLoading={scenariosLoading}
        workUnbound={scenariosSource === "unbound"}
        onOpenScenario={handleOpenScenario}
        onNewExercise={() => {
          setStep(0);
          setExType(null);
          setMethod(null);
          setScreen("wizard");
        }}
        onOpenPmesii={handleOpenPmesii}
        notifications={notifications}
        onMarkRead={(id) =>
          setNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, read: true } : n))
          )
        }
        onMarkAllRead={() =>
          setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
        }
        onDismiss={(id) =>
          setNotifications((prev) => prev.filter((n) => n.id !== id))
        }
      />
    );
  }

  // ── Success screen ──────────────────────────────────────────────────────
  if (step === 4) {
    return (
      <div className="planner-shell bp5-dark">
        <StepBar current={5} />
        <div className="planner-body">
          <StepSuccess
            exerciseName={exerciseName}
            exType={exType}
            onHome={() => {
              setStep(0);
              setScreen("home");
            }}
            onPrepare={handleOpenPrepare} // fires Workshop event; Workshop navigates
          />
        </div>
      </div>
    );
  }

  return (
    <div className="planner-shell bp5-dark">
      <StepBar current={step} />

      {/* Step body */}
      <div className="planner-body">
        {step === 0 && (
          <Step1ExerciseType
            selected={exType}
            onSelect={(t) => {
              setExType(t);
            }}
          />
        )}
        {step === 1 && (
          <Step2CreationMethod
            selected={method}
            onSelect={(m) => {
              setMethod(m);
            }}
          />
        )}
        {step === 2 && (
          <Step3ScenarioDescription
            exerciseName={exerciseName}
            onExerciseNameChange={setExerciseName}
            generating={isGenerating}
            genState={genState}
            onFilesChange={(sf, ef) => {
              setScenarioFile(sf);
              setExdirFile(ef);
            }}
            onSelectionChange={(se, ee) => {
              setScenarioExisting(se);
              setExdirExisting(ee);
            }}
            onPromptChange={setAiPrompt}
            onApprove={approveStep}
            onDecline={declineStep}
            onRegenerate={regenerateStep}
            onSkipGeneration={() => {
              resetGen();
              setStep(3);
            }}
          />
        )}
        {step === 3 && (
          <Step4WorkflowTeam
            tasks={tasks}
            onAssign={handleAssign}
            onDeleteTask={(id) =>
              setTasks((prev) => prev.filter((t) => t.id !== id))
            }
            onAddTask={(t) => setTasks((prev) => [...prev, t])}
            onDeleteMember={() => {}}
            onAddMember={() => {}}
          />
        )}
      </div>

      {/* Footer */}
      <div className="planner-footer">
        {/* AI recommended chip on step 4 */}
        {step === 3 && (
          <button
            type="button"
            className="ai-badge"
            style={{ marginRight: "auto" }}
          >
            <Icon icon="lightbulb" size={10} /> AI recommended assignments
          </button>
        )}
        {/* AI Generation controls on step 3 (only shown for AI method) */}
        {step === 2 && (
          <div
            style={{
              marginRight: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            {/* Trigger button */}
            {!isGenerating && genState.currentStep === "idle" && (
              <>
                <button
                  type="button"
                  className="ai-badge"
                  style={{ padding: "5px 14px", fontSize: 11 }}
                  disabled={
                    !exerciseName.trim() ||
                    nameCheckState === "duplicate" ||
                    nameCheckState === "checking"
                  }
                  onClick={() => {
                    void handleGenerate();
                  }}
                >
                  {nameCheckState === "checking" ? (
                    <>
                      <div
                        className="scenario-spinner"
                        style={{ width: 9, height: 9, borderWidth: 2 }}
                      />
                      Checking name…
                    </>
                  ) : (
                    <>
                      <Icon icon="lightbulb" size={10} />{" "}
                      {method === "ai" ? "Generate from documents" : "Generate"}
                    </>
                  )}
                </button>

                {/* Duplicate-name error banner */}
                {nameCheckState === "duplicate" && duplicateScenarioName && (
                  <div
                    className="gen-error-banner"
                    style={{
                      marginTop: 4,
                      padding: "10px 14px",
                      borderRadius: 6,
                      border: "1.5px solid var(--am-red, #c62828)",
                      background: "rgba(198,40,40,0.10)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      maxWidth: 420,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        fontWeight: 700,
                        fontSize: 12,
                        color: "var(--am-red, #ef5350)",
                      }}
                    >
                      <Icon icon="warning-sign" size={13} />
                      Duplicate scenario name
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#d9b3b3",
                        lineHeight: 1.5,
                      }}
                    >
                      A scenario named{" "}
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontWeight: 700,
                          color: "var(--am-red, #ef5350)",
                        }}
                      >
                        {duplicateScenarioName}
                      </span>{" "}
                      already exists in the ontology. Please choose a different
                      name before generating.
                    </div>
                  </div>
                )}

                {/* Clear indicator when name is verified unique */}
                {nameCheckState === "clear" && exerciseName.trim() && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 10,
                      color: "var(--am-green, #6c5ce7)",
                      marginTop: 2,
                    }}
                  >
                    <Icon icon="tick-circle" size={10} />
                    Name is available
                  </div>
                )}
              </>
            )}

            {/* Progress stepper — shown while running or after completion */}
            {(isGenerating ||
              genState.currentStep === "done" ||
              genState.currentStep === "error") && (
              <div className="gen-stepper">
                {PIPELINE_STEPS.map((s) => {
                  const isDone = genState.completedSteps.includes(s);
                  const isActive =
                    genState.currentStep === s ||
                    (genState.currentStep === "persisting" &&
                      // "persisting" follows the last LLM step — treat the
                      // previous pipeline step as still "active"
                      PIPELINE_STEPS[
                        PIPELINE_STEPS.indexOf(
                          genState.completedSteps[
                            genState.completedSteps.length - 1
                          ] ?? "uploading"
                        ) + 1
                      ] === s);
                  const isError = genState.currentStep === "error" && !isDone;
                  return (
                    <div
                      key={s}
                      className={
                        "gen-stepper__step" +
                        (isDone ? " gen-stepper__step--done" : "") +
                        (isActive ? " gen-stepper__step--active" : "") +
                        (isError && isActive ? " gen-stepper__step--error" : "")
                      }
                      title={PIPELINE_STEP_SHORT[s]}
                    >
                      <div className="gen-stepper__icon">
                        {isDone ? (
                          <Icon icon="tick" size={9} />
                        ) : isActive && isGenerating ? (
                          <div className="gen-stepper__spinner" />
                        ) : (
                          <Icon
                            icon={(PIPELINE_STEP_ICONS[s] ?? "dot") as "search"}
                            size={9}
                          />
                        )}
                      </div>
                      <span className="gen-stepper__label">
                        {PIPELINE_STEP_SHORT[s]}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Status line */}
            {isGenerating && (
              <span className="gen-status gen-status--running">
                <div
                  className="scenario-spinner"
                  style={{ width: 9, height: 9, borderWidth: 2 }}
                />
                {genState.stepLabel}
              </span>
            )}
            {genState.currentStep === "done" && (
              <span className="gen-status gen-status--done">
                ✓ {genState.objectsCreated} objects created
              </span>
            )}
            {genState.currentStep === "error" && (
              <div className="gen-error-banner">
                <Icon icon="warning-sign" size={11} />
                <span>{genState.error}</span>
                <button
                  type="button"
                  className="gen-error-banner__retry"
                  onClick={() => {
                    resetGen();
                  }}
                >
                  Dismiss &amp; retry
                </button>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className="planner-btn-ghost"
          onClick={handleBack}
        >
          {step > 0 ? "← Back" : "Cancel"}
        </button>

        <button
          type="button"
          className="planner-btn-primary"
          disabled={!canContinue()}
          onClick={handleContinue}
        >
          {step === 3 ? "Confirm & assign tasks →" : "Continue →"}
        </button>
      </div>
    </div>
  );
};
