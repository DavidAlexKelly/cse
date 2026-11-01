// src/map/ScenarioPlanning/components/MapToolbar/MapToolbar.tsx
// Floating toolbar rendered over the map canvas.

import React from "react";
import type { DrawingTool } from "../../shared/types";
import css from "./MapToolbar.module.css";

interface MapToolbarProps {
  activeTool: DrawingTool;
  onToolSelect: (tool: DrawingTool) => void;
  /** Phase colour dot — shown when a phase is selected */
  phaseColour?: string;
}

const TOOLS: {
  id: DrawingTool;
  icon: string;
  label: string;
  shortcut: string;
}[] = [
  { id: "select", icon: "⬆", label: "Select", shortcut: "S" },
  { id: "place-unit", icon: "⊞", label: "Place Unit", shortcut: "U" },
  { id: "draw-arrow", icon: "→", label: "Draw Arrow", shortcut: "A" },
  { id: "place-objective", icon: "◎", label: "Objective", shortcut: "O" },
];

export const MapToolbar: React.FC<MapToolbarProps> = ({
  activeTool,
  onToolSelect,
  phaseColour,
}) => {
  return (
    <div
      className={css.toolbar}
      role="toolbar"
      aria-label="Map drawing tools"
    >
      {/* Phase colour indicator */}
      {phaseColour && (
        <>
          <div
            className={css.phaseDot}
            style={{ backgroundColor: phaseColour }}
            aria-label="Active phase colour"
            role="img"
          />
          <div className={css.divider} aria-hidden="true" />
        </>
      )}

      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={`${css.toolBtn} ${activeTool === tool.id ? css.toolBtnActive : ""}`}
          onClick={() => onToolSelect(tool.id)}
          title={`${tool.label} [${tool.shortcut}]`}
          aria-pressed={activeTool === tool.id}
          aria-label={tool.label}
        >
          <span className={css.toolIcon} aria-hidden="true">
            {tool.icon}
          </span>
          <span className={css.toolLabel}>{tool.label}</span>
          <span className={css.toolShortcut} aria-hidden="true">
            {tool.shortcut}
          </span>
        </button>
      ))}

      <div className={css.divider} aria-hidden="true" />

      <div className={css.hint} aria-live="polite">
        {activeTool === "select" && "Click to select elements"}
        {activeTool === "place-unit" && "Click map to place unit"}
        {activeTool === "draw-arrow" && "Click start → click end"}
        {activeTool === "place-objective" && "Click map to place objective"}
      </div>
    </div>
  );
};
