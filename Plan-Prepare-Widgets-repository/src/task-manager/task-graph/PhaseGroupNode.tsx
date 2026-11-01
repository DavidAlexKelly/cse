/* eslint-disable react/prop-types */
// ── Phase Group Node
//
// A non-interactive background "box" node rendered behind task nodes
// to visually group tasks that belong to the same exercise phase.
// Uses React Flow's standard node rendering — position/size is driven
// by the parent TaskGraph via the `style` prop.
// ============================================================

import React, { memo } from "react";
import type { NodeProps } from "@xyflow/react";

export interface PhaseGroupNodeData {
  label: string;
  colour: string;
  sequenceNumber: number;
  startOffset: string;
  endOffset: string;
  [key: string]: unknown;
}

export const PhaseGroupNode: React.FC<NodeProps> = memo(({ data }) => {
  const d = data as PhaseGroupNodeData;
  const colour = d.colour ?? "#6c5ce7";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 6,
        border: `1.5px solid ${colour}`,
        background: `${colour}0d`, // ~5% opacity fill
        boxSizing: "border-box",
        pointerEvents: "none",
        position: "relative",
      }}
    >
      {/* Phase label pinned to top-left */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 12,
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        {/* Coloured sequence badge */}
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 3,
            background: colour,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            fontWeight: 800,
            color: "#fff",
            letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          {d.sequenceNumber}
        </div>

        {/* Phase name */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: colour,
            whiteSpace: "nowrap",
          }}
        >
          {d.label}
        </span>

        {/* Offset range */}
        {(d.startOffset || d.endOffset) && (
          <span
            style={{
              fontSize: 10,
              color: "#6a7292",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "0.04em",
            }}
          >
            {d.startOffset}{d.endOffset ? ` → ${d.endOffset}` : ""}
          </span>
        )}
      </div>
    </div>
  );
});

PhaseGroupNode.displayName = "PhaseGroupNode";
