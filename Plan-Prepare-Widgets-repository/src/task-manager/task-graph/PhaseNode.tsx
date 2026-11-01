// ── Phase Overview Node ─────────────────────────────────────────────────────
//
// A single large node representing one phase in the overview graph.
// Shows: phase name, sequence badge, offset range, task count breakdown,
// and an "Explore Phase →" button that fires the onExplore callback.

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import React, { memo } from "react";
import { PHASE_COLOURS } from "./TaskGraph.js";

export interface PhaseNodeData {
  phaseId: string;
  phaseName: string;
  sequenceNumber: number;
  startOffset: string;
  endOffset: string;
  taskCount: number;
  assignedCount: number;
  pendingCount: number;
  colour: string;
  /** Injected by TaskGraph — not serialised into RF state */
  onExplore?: (phaseId: string) => void;
  [key: string]: unknown;
}

// eslint-disable-next-line react/prop-types
export const PhaseNode: React.FC<NodeProps> = memo(({ data }) => {
  const d = data as PhaseNodeData;
  const colour = d.colour ?? PHASE_COLOURS[0];

  const completionPct = d.taskCount > 0
    ? Math.round((d.assignedCount / d.taskCount) * 100)
    : 0;

  return (
    <div
      style={{
        width: 220,
        background: "#141828",
        border: `1.5px solid ${colour}`,
        borderTop: `4px solid ${colour}`,
        borderRadius: 6,
        fontFamily: "'Inter', system-ui, sans-serif",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        overflow: "hidden",
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
          border: `2px solid ${colour}`,
          borderRadius: "50%",
        }}
      />

      {/* Header */}
      <div
        style={{
          padding: "10px 12px 8px",
          borderBottom: "1px solid #232a45",
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        {/* Sequence badge */}
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            background: colour,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 800,
            color: "#fff",
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          {d.sequenceNumber}
        </div>

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: colour,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {d.phaseName}
          </div>
          {(d.startOffset || d.endOffset) && (
            <div
              style={{
                fontSize: 10,
                color: "#6a7292",
                fontVariantNumeric: "tabular-nums",
                marginTop: 2,
              }}
            >
              {d.startOffset}{d.endOffset ? ` → ${d.endOffset}` : ""}
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div
        style={{
          padding: "8px 12px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {/* Task count pills */}
        <div style={{ display: "flex", gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: 2,
              background: "rgba(108, 92, 231,0.15)",
              border: "1px solid rgba(108, 92, 231,0.3)",
              color: "#8b7cf6",
            }}
          >
            {d.assignedCount} assigned
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: 2,
              background: "rgba(106, 114, 146,0.15)",
              border: "1px solid rgba(106, 114, 146,0.2)",
              color: "#6a7292",
            }}
          >
            {d.pendingCount} pending
          </span>
        </div>

        {/* Progress bar */}
        {d.taskCount > 0 && (
          <div>
            <div
              style={{
                height: 4,
                background: "#232a45",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${completionPct}%`,
                  height: "100%",
                  background: colour,
                  borderRadius: 2,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <div
              style={{
                fontSize: 9,
                color: "#6a7292",
                marginTop: 3,
                letterSpacing: "0.04em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {completionPct}% complete · {d.taskCount} task{d.taskCount !== 1 ? "s" : ""}
            </div>
          </div>
        )}
        {d.taskCount === 0 && (
          <div style={{ fontSize: 10, color: "#454c68", fontStyle: "italic" }}>
            No tasks in this phase
          </div>
        )}

        {/* Explore button */}
        <button
          style={{
            marginTop: 2,
            padding: "5px 10px",
            background: `${colour}22`,
            border: `1px solid ${colour}66`,
            borderRadius: 3,
            color: colour,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: "inherit",
            width: "100%",
            transition: "background 0.1s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${colour}44`; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${colour}22`; }}
          onClick={e => {
            e.stopPropagation();
            d.onExplore?.(d.phaseId);
          }}
        >
          Explore Phase →
        </button>
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 10,
          height: 10,
          background: "#232a45",
          border: `2px solid ${colour}`,
          borderRadius: "50%",
        }}
      />
    </div>
  );
});

PhaseNode.displayName = "PhaseNode";
