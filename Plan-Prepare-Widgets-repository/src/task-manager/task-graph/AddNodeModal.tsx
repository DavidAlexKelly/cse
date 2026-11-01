import React, { useState, useCallback } from "react";

import { UserSearch } from "./UserSearch.js";
import type { TaskNodeData } from "./data.js";

interface AddNodeModalProps {
  onAdd: (data: TaskNodeData) => void;
  onClose: () => void;
}

const CATEGORY_OPTIONS = [
  "Planning",
  "Personnel",
  "Composition",
  "Training",
  "Geography",
  "Operations",
  "Force Structure",
  "Intelligence",
  "Logistics",
  "Communications",
];

const PRIORITY_OPTIONS: { value: TaskNodeData["priority"]; label: string; color: string }[] = [
  { value: "critical", label: "Critical", color: "#ef4d4d" },
  { value: "warning", label: "Warning", color: "#f0a83c" },
  { value: "active", label: "Active", color: "#6c5ce7" },
  { value: "grey", label: "Low", color: "#6a7292" },
];

export const AddNodeModal: React.FC<AddNodeModalProps> = ({ onAdd, onClose }) => {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(CATEGORY_OPTIONS[0]);
  const [priority, setPriority] = useState<TaskNodeData["priority"]>("grey");
  const [assignee, setAssignee] = useState("");
  const [reviewer, setReviewer] = useState("");

  const handleSubmit = useCallback(() => {
    if (!label.trim()) return;
    onAdd({
      label: label.trim(),
      description: description.trim() || `Define / review ${label.trim().toLowerCase()}`,
      assignee: assignee || "Unassigned",
      reviewer: reviewer || "Unassigned",
      status: "pending",
      priority,
      progress: 0,
      category,
    });
  }, [label, description, category, priority, assignee, reviewer, onAdd]);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          background: "#141828",
          border: "1px solid #232a45",
          borderRadius: 4,
          width: 460,
          maxWidth: "calc(100vw - 32px)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.85)",
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            background: "#0e1120",
            borderBottom: "1px solid #232a45",
            borderRadius: "4px 4px 0 0",
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#e6eaf8",
            }}
          >
            + Add workflow node
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#98a1c0",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Name */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6a7292", marginBottom: 4 }}>
              Node name *
            </div>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Force Protection"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              style={{
                width: "100%",
                background: "#0e1120",
                border: "1px solid #2f3860",
                borderRadius: 2,
                color: "#e6eaf8",
                fontSize: 13,
                padding: "6px 9px",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Description */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6a7292", marginBottom: 4 }}>
              Description
            </div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the task"
              style={{
                width: "100%",
                background: "#0e1120",
                border: "1px solid #2f3860",
                borderRadius: 2,
                color: "#e6eaf8",
                fontSize: 13,
                padding: "6px 9px",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Category + Priority row */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6a7292", marginBottom: 4 }}>
                Category
              </div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0e1120",
                  border: "1px solid #2f3860",
                  borderRadius: 2,
                  color: "#e6eaf8",
                  fontSize: 12,
                  padding: "6px 9px",
                  outline: "none",
                  fontFamily: "inherit",
                }}
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6a7292", marginBottom: 4 }}>
                Priority
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {PRIORITY_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setPriority(p.value)}
                    style={{
                      flex: 1,
                      padding: "4px 6px",
                      borderRadius: 2,
                      border: priority === p.value ? `1px solid ${p.color}` : "1px solid #2f3860",
                      background: priority === p.value ? `${p.color}20` : "transparent",
                      color: priority === p.value ? p.color : "#98a1c0",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Assignee + Reviewer */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <UserSearch label="Assignee" selectedUser={assignee} onSelect={setAssignee} />
            </div>
            <div style={{ flex: 1 }}>
              <UserSearch label="Reviewer" selectedUser={reviewer} onSelect={setReviewer} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 16px",
            background: "#0e1120",
            borderTop: "1px solid #232a45",
            borderRadius: "0 0 4px 4px",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "5px 14px",
              borderRadius: 2,
              border: "1px solid #2f3860",
              background: "#1a1f36",
              color: "#e6eaf8",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!label.trim()}
            style={{
              padding: "5px 14px",
              borderRadius: 2,
              border: "1px solid #6c5ce7",
              background: label.trim() ? "#6c5ce7" : "#232a45",
              color: label.trim() ? "#fff" : "#6a7292",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: label.trim() ? "pointer" : "not-allowed",
              fontFamily: "inherit",
            }}
          >
            Add Node
          </button>
        </div>
      </div>
    </div>
  );
};
