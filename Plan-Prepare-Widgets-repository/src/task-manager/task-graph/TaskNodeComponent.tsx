import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import React, { memo } from "react";
import type { TaskNodeData } from "./data.js";

// ── Status badge colours ────────────────────────────────────────────────
const STATUS_STYLES: Record<
  TaskNodeData["status"],
  { bg: string; border: string; color: string; label: string }
> = {
  approved:  { bg: "rgba(36, 180, 126,0.2)",   border: "rgba(36, 180, 126,0.5)",   color: "#24b47e", label: "Approved" },
  "in-review": { bg: "rgba(240, 168, 60,0.2)", border: "rgba(240, 168, 60,0.5)", color: "#f0a83c", label: "In Review" },
  pending:   { bg: "rgba(106, 114, 146,0.2)",    border: "rgba(106, 114, 146,0.5)",   color: "#98a1c0", label: "Pending" },
  save:      { bg: "rgba(76, 126, 243,0.2)",   border: "rgba(76, 126, 243,0.5)", color: "#4c7ef3", label: "Save" },
};

const PRIORITY_BORDER: Record<TaskNodeData["priority"], string> = {
  critical: "#ef4d4d",
  warning:  "#f0a83c",
  active:   "#6c5ce7",
  grey:     "#2f3860",
};

// ── Component ───────────────────────────────────────────────────────────
// eslint-disable-next-line react/prop-types
export const TaskNodeComponent: React.FC<NodeProps> = memo(({ data, selected }) => {
  const d = data as TaskNodeData;
  const status = STATUS_STYLES[d.status];
  const borderColor = selected ? "#6c5ce7" : PRIORITY_BORDER[d.priority];
  const progressPct = `${Math.round(d.progress * 100)}%`;
  const subtasks = d.subtasks ?? [];
  const doneCount = subtasks.filter((s) => s.done).length;

  return (
    <div
      style={{
        background: "#141828",
        border: `1px solid ${borderColor}`,
        borderTop: `3px solid ${borderColor}`,
        borderRadius: 4,
        width: 260,
        fontFamily: "'Inter', system-ui, sans-serif",
        boxShadow: selected
          ? "0 0 12px rgba(108, 92, 231,0.3)"
          : "0 2px 8px rgba(0,0,0,0.5)",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 10,
          height: 10,
          background: "#232a45",
          border: "2px solid #3f4a78",
          borderRadius: "50%",
        }}
      />

      {/* Header */}
      <div
        style={{
          padding: "8px 10px 6px",
          borderBottom: "1px solid #232a45",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#98a1c0",
          }}
        >
          {d.category}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: "1px 6px",
            borderRadius: 2,
            background: status.bg,
            border: `1px solid ${status.border}`,
            color: status.color,
          }}
        >
          {status.label}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: "8px 10px" }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#e6eaf8",
            marginBottom: 3,
            lineHeight: 1.3,
          }}
        >
          {d.label}
        </div>

        {/* Assignee / Reviewer */}
        <div
          style={{
            display: "flex",
            gap: 6,
            fontSize: 10,
            color: "#98a1c0",
            marginBottom: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="5" r="3.5" />
              <path d="M1.5 14.5c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6" />
            </svg>
            {d.assignee}
          </div>
          <span style={{ color: "#232a45" }}>|</span>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1.5l2 4 4.5.7-3.2 3.1.8 4.5L8 11.8l-4.1 2 .8-4.5L1.5 6.2 6 5.5z" />
            </svg>
            {d.reviewer}
          </div>
        </div>

        {/* Subtasks */}
        {subtasks.length > 0 && (
          <div
            style={{
              borderTop: "1px solid #232a45",
              paddingTop: 6,
              marginBottom: 6,
            }}
          >
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6a7292", marginBottom: 4 }}>
              Subtasks {doneCount}/{subtasks.length}
            </div>
            {subtasks.map((st) => (
              <div
                key={st.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 5,
                  marginBottom: 3,
                  fontSize: 10,
                  lineHeight: 1.4,
                  color: st.done ? "#24b47e" : st.blocked ? "#f0a83c" : "#98a1c0",
                }}
              >
                <span style={{ flexShrink: 0, marginTop: 1 }}>
                  {st.done ? "✓" : st.blocked ? "⊘" : "○"}
                </span>
                <span
                  style={{
                    textDecoration: st.done ? "line-through" : "none",
                    opacity: st.done ? 0.6 : 1,
                  }}
                >
                  {st.label}
                  {st.blocked && (
                    <span style={{ fontSize: 8, color: "#f0a83c", marginLeft: 3 }}>BLOCKED</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Progress bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              flex: 1,
              height: 4,
              background: "#232a45",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: progressPct,
                height: "100%",
                background: PRIORITY_BORDER[d.priority],
                borderRadius: 2,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <span style={{ fontSize: 10, color: "#6a7292", fontWeight: 600 }}>
            {progressPct}
          </span>
        </div>
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 10,
          height: 10,
          background: "#232a45",
          border: "2px solid #3f4a78",
          borderRadius: "50%",
        }}
      />
    </div>
  );
});

TaskNodeComponent.displayName = "TaskNodeComponent";
