// ── Workflow Table ─────────────────────────────────────────────────────────

import { Icon } from "@blueprintjs/core";
import React, { useState } from "react";
import { MilLabel } from "../../shared/components/Label.js";
import type { TaskSection, TeamMember, WorkflowTask } from "./types.js";
import { WorkflowRow } from "./WorkflowRow.js";
import type { PhaseRecord } from "../../shared/hooks/useNxgPhases.js";
import "./taskAssignment.css";

// ── Helpers ────────────────────────────────────────────────────────────────

function phaseStatusIntent(status: string): "green" | "amber" | "grey" | "blue" {
  switch (status.toLowerCase()) {
    case "executing": return "green";
    case "ready": return "blue";
    case "planning": return "amber";
    default: return "grey";
  }
}

function phaseStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case "executing": return "Executing";
    case "ready": return "Ready";
    case "planning": return "Planning";
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function taskCompletionCounts(tasks: WorkflowTask[]) {
  const assigned = tasks.filter(t => t.status === "assigned").length;
  const pending  = tasks.filter(t => t.status === "pending").length;
  const inReview = tasks.filter(t => t.status === "in-review").length;
  return { assigned, pending, inReview, total: tasks.length };
}

// ── Props ──────────────────────────────────────────────────────────────────

interface WorkflowTableProps {
  tasks: WorkflowTask[];
  teamMembers: TeamMember[];
  sections: readonly TaskSection[];
  /** Phases from NxgPhase — when present, tasks group by phase first */
  phases: PhaseRecord[];
  activeMember: string | null;
  onClearMemberFilter: () => void;
  onUpdateTask: (updated: WorkflowTask) => void;
  onDeleteTask: (id: string) => void;
}

// ── Phase header ───────────────────────────────────────────────────────────

interface PhaseHeaderProps {
  phase: PhaseRecord;
  tasks: WorkflowTask[];
  collapsed: boolean;
  onToggle: () => void;
}

const PhaseHeader: React.FC<PhaseHeaderProps> = ({ phase, tasks, collapsed, onToggle }) => {
  const counts = taskCompletionCounts(tasks);
  const intent = phaseStatusIntent(phase.phaseStatus);

  return (
    <div
      className="ta-phase-header"
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={e => e.key === "Enter" && onToggle()}
    >
      {/* Left: chevron + name */}
      <Icon
        icon={collapsed ? "chevron-right" : "chevron-down"}
        size={12}
        className="ta-phase-header__chevron"
      />
      <div className="ta-phase-header__identity">
        <span className="ta-phase-header__name">{phase.phaseName}</span>
        {(phase.startOffset || phase.endOffset) && (
          <span className="ta-phase-header__offsets">
            {phase.startOffset}{phase.endOffset ? ` → ${phase.endOffset}` : ""}
          </span>
        )}
        {phase.objectiveStatement && (
          <span className="ta-phase-header__objective">{phase.objectiveStatement}</span>
        )}
      </div>

      {/* Right: task count chips + phase status */}
      <div className="ta-phase-header__meta">
        {counts.assigned > 0 && (
          <span className="ta-phase-chip ta-phase-chip--green">{counts.assigned} assigned</span>
        )}
        {counts.inReview > 0 && (
          <span className="ta-phase-chip ta-phase-chip--amber">{counts.inReview} in review</span>
        )}
        {counts.pending > 0 && (
          <span className="ta-phase-chip ta-phase-chip--grey">{counts.pending} pending</span>
        )}
        <MilLabel intent={intent}>{phaseStatusLabel(phase.phaseStatus)}</MilLabel>
      </div>
    </div>
  );
};

// ── Unphased / fallback section toggle ────────────────────────────────────

interface SectionToggleProps {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}

const SectionToggle: React.FC<SectionToggleProps> = ({ label, count, collapsed, onToggle }) => (
  <div
    className="ta-section-toggle"
    role="button"
    tabIndex={0}
    onClick={onToggle}
    onKeyDown={e => e.key === "Enter" && onToggle()}
  >
    <span className="ta-section-toggle__label">{label}</span>
    <span className="ta-section-toggle__count">
      {collapsed ? `(${count} task${count !== 1 ? "s" : ""})` : ""}
    </span>
    <Icon
      icon={collapsed ? "chevron-right" : "chevron-down"}
      size={12}
      className="ta-section-toggle__chevron"
    />
  </div>
);

// ── Task list renderer ────────────────────────────────────────────────────

interface TaskListProps {
  tasks: WorkflowTask[];
  teamMembers: TeamMember[];
  phaseName?: string;
  onUpdate: (t: WorkflowTask) => void;
  onDelete: (id: string) => void;
  emptyMessage: string;
}

const TaskList: React.FC<TaskListProps> = ({ tasks, teamMembers, phaseName, onUpdate, onDelete, emptyMessage }) => {
  if (tasks.length === 0) {
    return (
      <div className="ta-empty-section">{emptyMessage}</div>
    );
  }
  return (
    <div className="ta-task-list">
      {tasks.map(task => (
        <WorkflowRow
          key={task.id}
          task={task}
          teamMembers={teamMembers}
          phaseName={phaseName}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
};

// ── Phase group ───────────────────────────────────────────────────────────

interface PhaseGroupProps {
  phase: PhaseRecord;
  tasks: WorkflowTask[];
  teamMembers: TeamMember[];
  sections: readonly TaskSection[];
  activeMember: string | null;
  onUpdate: (t: WorkflowTask) => void;
  onDelete: (id: string) => void;
}

const PhaseGroup: React.FC<PhaseGroupProps> = ({
  phase, tasks, teamMembers, sections, activeMember, onUpdate, onDelete,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const filtered = activeMember
    ? tasks.filter(t => t.approver === activeMember || t.owner === activeMember)
    : tasks;

  // Determine if we have multiple sections within this phase
  const sectionsPresent = sections.filter(s => filtered.some(t => t.section === s));
  const useSubSections = sectionsPresent.length > 1;

  const toggleSection = (s: string) =>
    setCollapsedSections(prev => ({ ...prev, [s]: !prev[s] }));

  return (
    <div className="ta-phase-group">
      <PhaseHeader
        phase={phase}
        tasks={tasks}
        collapsed={collapsed}
        onToggle={() => setCollapsed(p => !p)}
      />

      {!collapsed && (
        <div className="ta-phase-group__body">
          {useSubSections ? (
            sectionsPresent.map(section => {
              const sectionTasks = filtered.filter(t => t.section === section);
              const isSectionCollapsed = !!collapsedSections[section];
              return (
                <div key={section}>
                  <SectionToggle
                    label={section}
                    count={sectionTasks.length}
                    collapsed={isSectionCollapsed}
                    onToggle={() => toggleSection(section)}
                  />
                  {!isSectionCollapsed && (
                    <TaskList
                      tasks={sectionTasks}
                      teamMembers={teamMembers}
                      phaseName={phase.phaseName}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                      emptyMessage={
                        activeMember
                          ? `No tasks for ${activeMember} in this section`
                          : "No tasks in this section"
                      }
                    />
                  )}
                </div>
              );
            })
          ) : (
            <TaskList
              tasks={filtered}
              teamMembers={teamMembers}
              phaseName={phase.phaseName}
              onUpdate={onUpdate}
              onDelete={onDelete}
              emptyMessage={
                activeMember
                  ? `No tasks for ${activeMember} in this phase`
                  : "No tasks in this phase"
              }
            />
          )}
        </div>
      )}
    </div>
  );
};

// ── Component ──────────────────────────────────────────────────────────────

export const WorkflowTable: React.FC<WorkflowTableProps> = ({
  tasks,
  teamMembers,
  sections,
  phases,
  activeMember,
  onClearMemberFilter,
  onUpdateTask,
  onDeleteTask,
}) => {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string) =>
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const filteredTasks = activeMember
    ? tasks.filter(t => t.approver === activeMember || t.owner === activeMember)
    : tasks;

  // ── Phase-based layout (when phases are available) ─────────────────────
  const hasPhases = phases.length > 0;

  // Tasks that have a matching phaseId
  const phasedTaskIds = hasPhases
    ? new Set(tasks.filter(t => t.phaseId && phases.some(p => p.phaseId === t.phaseId)).map(t => t.id))
    : new Set<string>();

  // Tasks with no matching phase — fall back to section grouping
  const unphasedTasks = tasks.filter(t => !phasedTaskIds.has(t.id));

  return (
    <div className="ta-table">

      {/* ── Active filter banner ─────────────────────────────────────── */}
      {activeMember && (
        <div className="ta-filter-banner">
          <Icon icon="filter" size={10} />
          Showing tasks for <strong style={{ marginLeft: 4 }}>{activeMember}</strong>
          <button
            className="mil-btn mil-btn--ghost mil-btn--sm"
            style={{ marginLeft: "auto", fontSize: 10 }}
            onClick={onClearMemberFilter}
          >
            Clear filter
          </button>
        </div>
      )}

      {/* ── Scrollable body ─────────────────────────────────────────── */}
      <div className="ta-table__body">

        {/* ── Phase groups (primary structure) ────────────────────── */}
        {hasPhases && phases.map(phase => {
          const phaseTasks = tasks.filter(t => t.phaseId === phase.phaseId);
          return (
            <PhaseGroup
              key={phase.phaseId}
              phase={phase}
              tasks={phaseTasks}
              teamMembers={teamMembers}
              sections={sections}
              activeMember={activeMember}
              onUpdate={onUpdateTask}
              onDelete={onDeleteTask}
            />
          );
        })}

        {/* ── Unphased tasks — section fallback ───────────────────── */}
        {unphasedTasks.length > 0 && sections.map(section => {
          const sectionTasks = (activeMember
            ? unphasedTasks.filter(t => t.approver === activeMember || t.owner === activeMember)
            : unphasedTasks
          ).filter(t => t.section === section);

          if (sectionTasks.length === 0 && activeMember) return null;

          const totalInSection = unphasedTasks.filter(t => t.section === section).length;
          if (totalInSection === 0) return null;

          const isCollapsed = !!collapsedSections[section];

          return (
            <div key={section}>
              <SectionToggle
                label={hasPhases ? `${section} (unphased)` : section}
                count={totalInSection}
                collapsed={isCollapsed}
                onToggle={() => toggleSection(section)}
              />
              {!isCollapsed && (
                <TaskList
                  tasks={sectionTasks}
                  teamMembers={teamMembers}
                  onUpdate={onUpdateTask}
                  onDelete={onDeleteTask}
                  emptyMessage={
                    activeMember
                      ? `No tasks for ${activeMember} in this section`
                      : "No tasks in this section"
                  }
                />
              )}
            </div>
          );
        })}

        {filteredTasks.length === 0 && (
          <div style={{ padding: "24px 0", color: "#454c68", fontSize: 12, textAlign: "center" }}>
            {activeMember ? `No tasks assigned to ${activeMember}` : "No tasks"}
          </div>
        )}
      </div>
    </div>
);
};
