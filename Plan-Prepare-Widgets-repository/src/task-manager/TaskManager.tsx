import { Icon, InputGroup } from "@blueprintjs/core";
import React, { useCallback, useState } from "react";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import { MilButton } from "../shared/components/Button.js";
import { MilLabel } from "../shared/components/Label.js";
import { MilList } from "../shared/components/List.js";
import type { MilListItemProps } from "../shared/components/List.js";
import { useNxgTasks } from "../shared/hooks/useNxgTasks.js";
import { useNxgTaskMutations } from "../shared/hooks/useNxgTaskMutations.js";
import type { TaskStatus } from "../shared/task/taskTaxonomy.js";
import { useScenarioIdFromObjectSet } from "../shared/hooks/useScenarioIdFromParam.js";
import { ScenarioGate } from "../shared/components/ScenarioGate.js";
import "../shared/styling/index.css";
import type TaskManagerConfig from "./taskManager.config.js";

const useWidgetContext =
  useFoundryWidgetContext.withTypes<typeof TaskManagerConfig>();

// Badges are built from the shared taxonomy so "approved" — which the
// ontology uses and this widget previously had no entry for — renders
// correctly instead of falling through to a blank badge.
const STATUS_BADGE: Record<TaskStatus, React.ReactNode> = {
  approved: <MilLabel intent="green">Approved</MilLabel>,
  assigned: <MilLabel intent="blue">Assigned</MilLabel>,
  "in-review": <MilLabel intent="amber">In Review</MilLabel>,
  pending: <MilLabel intent="grey">Pending</MilLabel>,
};

const PRIORITY_ACCENT: Record<TaskStatus, "warning" | "active" | "none"> = {
  approved: "active",
  assigned: "active",
  "in-review": "warning",
  pending: "none",
};

const TaskManagerBody: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {

  const { tasks, loading, source, refresh } = useNxgTasks(scenarioId);
  const { emitEvent } = useWidgetContext();
  // Routed through the mutation hook's onSuccess so every write notifies
  // Workshop, rather than each call site having to remember to.
  const notifyDataChanged = useCallback(
    () => emitEvent("onDataChanged", { parameterUpdates: {} }),
    [emitEvent],
  );
  const {
    deleteTask,
    error: writeError,
    clearError: clearWriteError,
  } = useNxgTaskMutations({ onSuccess: notifyDataChanged });

  // Seed tasks have no matching ontology objects to delete.
  const persists = source === "ontology";

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = tasks.filter(
    (t) =>
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.owner ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const items: MilListItemProps[] = filtered.map((task) => ({
    title: task.title,
    meta: `${task.owner ?? "Unassigned"} · Due ${task.due}`,
    icon:
      task.status === "approved" || task.status === "assigned"
        ? "tick-circle"
        : "circle",
    accent: PRIORITY_ACCENT[task.status] ?? "none",
    selected: selectedId === task.id,
    badges: <>{STATUS_BADGE[task.status]}</>,
    actions: [
      {
        icon: "trash",
        title: persists ? "Delete" : "Delete (unavailable for seed data)",
        intent: "danger",
        onClick: () => {
          if (!persists) return;
          void deleteTask(task.id)
            .then(() => refresh())
            .catch(() => refresh());
        },
      },
    ],
    onClick: () => setSelectedId(task.id),
  }));

  return (
    <div className="mil-widget bp5-dark">
      {writeError && (
        <div className="mil-banner mil-banner--error" role="alert">
          <Icon icon="warning-sign" size={12} />
          <span>{writeError}</span>
          <button
            className="mil-banner__dismiss"
            onClick={clearWriteError}
            aria-label="Dismiss"
          >
            <Icon icon="cross" size={12} />
          </button>
        </div>
      )}

      {!persists && !loading && (
        <div className="mil-banner mil-banner--warning">
          <Icon icon="database" size={12} />
          <span>
            Showing seed data — this scenario has no tasks in the ontology, so
            changes are not saved.
          </span>
        </div>
      )}

      {/* Header */}
      <div className="mil-header">
        <div className="mil-header__title">
          <Icon icon="clipboard" size={14} />
          Task Manager
          <span className="mil-header__subtitle">Operations</span>
        </div>
        <div className="mil-header__actions">
          <MilButton icon="export" variant="ghost">
            Export
          </MilButton>
          <MilButton icon="add" variant="primary">
            New Task
          </MilButton>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mil-toolbar">
        <InputGroup
          leftIcon="search"
          placeholder="Search tasks..."
          small
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        <div className="mil-toolbar__separator" />
        <MilButton icon="filter" variant="ghost">
          Filter
        </MilButton>
        <MilButton icon="sort" variant="ghost">
          Sort
        </MilButton>
        <MilButton icon="gantt-chart" variant="ghost">
          Timeline
        </MilButton>
      </div>

      {/* Content */}
      <div className="mil-content">
        {loading ? (
          <div
            style={{
              padding: "24px 0",
              color: "#6a7292",
              fontSize: 12,
              fontStyle: "italic",
            }}
          >
            Loading tasks…
          </div>
        ) : (
          <MilList
            sectionLabel={`${filtered.length} Task${
              filtered.length !== 1 ? "s" : ""
            }`}
            items={items}
            emptyText="No tasks found"
          />
        )}
      </div>

      {/* Status Bar */}
      <div className="mil-statusbar">
        <MilLabel variant="status-dot" intent="green">
          {tasks.filter((t) => t.status === "assigned").length} Assigned
        </MilLabel>
        <MilLabel variant="status-dot" intent="amber">
          {tasks.filter((t) => t.status === "in-review").length} In Review
        </MilLabel>
        <MilLabel variant="status-dot" intent="grey">
          {tasks.filter((t) => t.status === "pending").length} Pending
        </MilLabel>
      </div>
    </div>
  );
};

// ── Widget entry point ─────────────────────────────────────────────────────
// Resolves the bound scenario before mounting the body, so the body always
// has a real scenario to work with and never silently falls back to a
// default exercise.

export const TaskManager: React.FC = () => {
  const { parameters } = useWidgetContext();
  const binding = useScenarioIdFromObjectSet(
    parameters.values.scenario?.objectSet
  );
  return (
    <ScenarioGate binding={binding}>
      {(scenarioId) => <TaskManagerBody scenarioId={scenarioId} />}
    </ScenarioGate>
  );
};
