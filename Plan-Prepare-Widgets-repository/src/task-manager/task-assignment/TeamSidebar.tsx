// ── Team Sidebar ───────────────────────────────────────────────────────────

import { Icon } from "@blueprintjs/core";
import React, { useState } from "react";
import { MilButton } from "../../shared/components/Button.js";
import { AddMemberModal } from "./AddMemberModal.js";
import { MemberDetailModal } from "./MemberDetailModal.js";
import type { TeamMember, WorkflowTask } from "./types.js";
import "./taskAssignment.css";

// ── Avatar colour palette — sourced from existing CSS token colours ────────

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

// ── Props ──────────────────────────────────────────────────────────────────

interface TeamSidebarProps {
  members: TeamMember[];
  tasks: WorkflowTask[];
  activeMember: string | null;
  onActiveMemberChange: (name: string | null) => void;
  onAddMember: (member: TeamMember) => void;
  onSaveMember: (updated: TeamMember) => void;
  onUpdateTask: (updated: WorkflowTask) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export const TeamSidebar: React.FC<TeamSidebarProps> = ({
  members,
  tasks,
  activeMember,
  onActiveMemberChange,
  onAddMember,
  onSaveMember,
  onUpdateTask,
}) => {
  const [showAddModal,    setShowAddModal]    = useState(false);
  const [detailMember,    setDetailMember]    = useState<TeamMember | null>(null);
  const [detailMemberIdx, setDetailMemberIdx] = useState<number>(0);

  const handleCardClick = (member: TeamMember, index: number) => {
    // If already active: clicking card body still opens detail modal
    // Deselect is handled exclusively by the × button
    onActiveMemberChange(member.name);
    setDetailMember(member);
    setDetailMemberIdx(index);
  };

  const handleDeselect = (e: React.MouseEvent) => {
    e.stopPropagation();
    onActiveMemberChange(null);
  };

  return (
    <>
      <aside className="ta-sidebar">

        {/* Heading */}
        <div className="ta-sidebar__heading">Exercise Team</div>

        {/* Member cards */}
        {members.map((member, index) => {
          const isActive = activeMember === member.name;
          return (
            <div
              key={member.id}
              className={["ta-member-card", isActive ? "ta-member-card--active" : ""].filter(Boolean).join(" ")}
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick(member, index)}
              onKeyDown={e => e.key === "Enter" && handleCardClick(member, index)}
              style={{ cursor: "pointer" }}
            >
              <div
                className="ta-member-avatar"
                style={{ backgroundColor: getAvatarColour(index) }}
              >
                {getInitials(member.name)}
              </div>
              <div className="ta-member-info">
                <div className="ta-member-name">{member.name}</div>
                <div className="ta-member-role">{member.role}</div>
              </div>

              {/* Explicit deselect button — only shown on active card */}
              {isActive && (
                <button
                  className="ta-member-card__deselect"
                  title="Clear filter"
                  onClick={handleDeselect}
                  onKeyDown={e => e.key === "Enter" && handleDeselect(e as unknown as React.MouseEvent)}
                >
                  <Icon icon="cross" size={8} />
                </button>
              )}
            </div>
          );
        })}

        {/* Add team member */}
        <div style={{ marginTop: 8 }}>
          <MilButton
            icon="add"
            variant="ghost"
            fill
            onClick={() => setShowAddModal(true)}
          >
            Add team member
          </MilButton>
        </div>

      </aside>

      {/* Add member modal */}
      {showAddModal && (
        <AddMemberModal
          existingMembers={members}
          onAdd={member => { onAddMember(member); setShowAddModal(false); }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Member detail modal */}
      {detailMember && (
        <MemberDetailModal
          member={detailMember}
          memberIndex={detailMemberIdx}
          allMembers={members}
          tasks={tasks}
          onSaveMember={updated => { onSaveMember(updated); setDetailMember(null); }}
          onUpdateTask={onUpdateTask}
          onClose={() => setDetailMember(null)}
        />
      )}
    </>
  );
};
