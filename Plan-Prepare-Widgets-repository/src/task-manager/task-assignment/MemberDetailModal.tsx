// ── Member Detail Modal ────────────────────────────────────────────────────

import { Icon } from "@blueprintjs/core";
import React, { useState } from "react";
import { MilButton } from "../../shared/components/Button.js";
import { MilLabel } from "../../shared/components/Label.js";
import {
  MilModal,
  MilFormRow,
  MilFormGroup,
  MilTextInput,
  MilSelect,
} from "../../shared/components/Modal.js";
import type { TeamMember, WorkflowTask } from "./types.js";
import { deriveStatus } from "./types.js";
import {
  TASK_STATUS_INTENT,
  TASK_STATUS_LABEL,
} from "../../shared/task/taskTaxonomy.js";
import "./taskAssignment.css";

// ── Avatar colours — same palette as TeamSidebar ────────────────────

const AVATAR_COLOURS = [
  "#6c5ce7",
  "#4c7ef3",
  "#f0a83c",
  "#ef4d4d",
  "#6a7292",
];

function getAvatarColour(index: number): string {
  return AVATAR_COLOURS[index % AVATAR_COLOURS.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[parts.length - 2].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// ── Status helpers ─────────────────────────────────────────────────────────
// Sourced from the shared taxonomy so every widget agrees on the
// status vocabulary, including "approved" which the ontology uses.

const STATUS_INTENT = TASK_STATUS_INTENT;
const STATUS_LABEL = TASK_STATUS_LABEL;

// ── Assign options ─────────────────────────────────────────────────────────

const buildAssignOptions = (members: TeamMember[]) => [
  { value: "", label: "— Assign —" },
  ...members.map(m => ({ value: m.name, label: m.name })),
];

// ── Props ──────────────────────────────────────────────────────────────────

interface MemberDetailModalProps {
  member: TeamMember;
  memberIndex: number;
  allMembers: TeamMember[];
  tasks: WorkflowTask[];
  onSaveMember: (updated: TeamMember) => void;
  onUpdateTask: (updated: WorkflowTask) => void;
  onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export const MemberDetailModal: React.FC<MemberDetailModalProps> = ({
  member,
  memberIndex,
  allMembers,
  tasks,
  onSaveMember,
  onUpdateTask,
  onClose,
}) => {
  const [name, setName] = useState(member.name);
  const [rank, setRank] = useState(member.rank);
  const [role, setRole] = useState(member.role);

  const approverTasks = tasks.filter(t => t.approver === member.name);
  const ownerTasks    = tasks.filter(t => t.owner    === member.name);

  const assignOpts = buildAssignOptions(allMembers);

  const handleSave = () => {
    onSaveMember({ ...member, name: name.trim(), rank: rank.trim(), role: role.trim() });
    onClose();
  };

  const handleApproverChange = (task: WorkflowTask, value: string) => {
    const approver = value || null;
    onUpdateTask({ ...task, approver, status: deriveStatus(approver, task.owner) });
  };

  const handleOwnerChange = (task: WorkflowTask, value: string) => {
    const owner = value || null;
    onUpdateTask({ ...task, owner, status: deriveStatus(task.approver, owner) });
  };

  const avatarColour = getAvatarColour(memberIndex);

  return (
    <MilModal
      title="Team Member"
      titleIcon="person"
      onClose={onClose}
      actions={[
        { label: "Cancel",      variant: "default", onClick: onClose    },
        { label: "Save Member", variant: "primary", icon: "tick", onClick: handleSave },
      ]}
    >
      {/* ── Member identity ─────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 4 }}>
        <div
          className="ta-member-avatar"
          style={{ width: 48, height: 48, fontSize: 14, backgroundColor: avatarColour }}
        >
          {getInitials(name || member.name)}
        </div>
        <div style={{ flex: 1 }}>
          <MilFormRow>
            <MilFormGroup label="Full Name">
              <MilTextInput value={name} onChange={setName} placeholder="e.g. Col Anderssen" />
            </MilFormGroup>
          </MilFormRow>
        </div>
      </div>

      <MilFormRow>
        <MilFormGroup label="Rank" compact>
          <MilTextInput value={rank} onChange={setRank} placeholder="e.g. Col" />
        </MilFormGroup>
        <MilFormGroup label="Role">
          <MilTextInput value={role} onChange={setRole} placeholder="e.g. Plans Officer" />
        </MilFormGroup>
      </MilFormRow>

      {/* ── Divider ─────────────────────────────────────────────────── */}
      <div className="mil-divider" />

      {/* ── Approver for ────────────────────────────────────────────── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Icon icon="endorsed" size={11} style={{ color: "#6c5ce7" }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6a7292" }}>
            Approver for
          </span>
          <MilLabel intent="green">{approverTasks.length}</MilLabel>
        </div>

        {approverTasks.length === 0 ? (
          <p style={{ fontSize: 11, color: "#454c68", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            No tasks assigned as approver
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {approverTasks.map(task => (
              <div key={task.id} className="ta-member-task-row">
                <div>
                  <div className="ta-member-task-row__title">{task.title}</div>
                  <div className="ta-member-task-row__section">{task.section}</div>
                </div>
                <MilLabel intent={STATUS_INTENT[task.status]}>
                  {STATUS_LABEL[task.status]}
                </MilLabel>
                {/* Reassign approver (feature E) */}
                <MilSelect
                  value={task.approver ?? ""}
                  options={assignOpts}
                  onChange={v => handleApproverChange(task, v)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Owner for ───────────────────────────────────────────────── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Icon icon="person" size={11} style={{ color: "#4c7ef3" }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6a7292" }}>
            Task Owner for
          </span>
          <MilLabel intent="blue">{ownerTasks.length}</MilLabel>
        </div>

        {ownerTasks.length === 0 ? (
          <p style={{ fontSize: 11, color: "#454c68", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            No tasks assigned as owner
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ownerTasks.map(task => (
              <div key={task.id} className="ta-member-task-row">
                <div>
                  <div className="ta-member-task-row__title">{task.title}</div>
                  <div className="ta-member-task-row__section">{task.section}</div>
                </div>
                <MilLabel intent={STATUS_INTENT[task.status]}>
                  {STATUS_LABEL[task.status]}
                </MilLabel>
                {/* Reassign owner (feature E) */}
                <MilSelect
                  value={task.owner ?? ""}
                  options={assignOpts}
                  onChange={v => handleOwnerChange(task, v)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Summary counts ───────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, paddingTop: 4 }}>
        <MilButton variant="ghost" iconOnly icon="cross" title="Clear all assignments" />
        <span style={{ fontSize: 11, color: "#6a7292", alignSelf: "center" }}>
          {approverTasks.length + ownerTasks.length} total task{approverTasks.length + ownerTasks.length !== 1 ? "s" : ""} assigned
        </span>
      </div>
    </MilModal>
  );
};
