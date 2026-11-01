// src/apps/scenarioPlanner/components/BranchSelector/BranchSelector.tsx
//
// Shows alternative branch phases (COAs) when the selected phase has siblings
// that share the same basedOnPhaseId. Renders as a horizontal strip of
// selectable cards so the planner can switch between alternatives.

import type { KeyboardEvent } from "react";
import type { Phase } from "../../shared/types";
import { getPhaseColourById } from "../../shared/phaseColours";

interface Props {
  /** The currently selected phase. */
  selectedPhase: Phase;
  /** Sibling branch phases (including the selected one). */
  branchSiblings: Phase[];
  /** All phases — used for colour lookup. */
  allPhases: Phase[];
  /** Called when the user picks a different branch. */
  onSelectBranch: (phaseId: string) => void;
  /** Called when the user wants to create another branch from the same fork point. */
  onForkPhase?: () => void;
}

function StatusDot({ status }: { status: Phase["status"] }) {
  const colour =
    status === "APPROVED" ? "#2fbf71"
    : status === "REVIEW"  ? "#e8a838"
    : "#6a7292";
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: colour,
        flexShrink: 0,
      }}
      aria-label={status}
    />
  );
}

export function BranchSelector({
  selectedPhase,
  branchSiblings,
  allPhases,
  onSelectBranch,
  onForkPhase,
}: Props) {
  if (branchSiblings.length < 2) return null;

  const sourcePhase = allPhases.find((p) => p.id === selectedPhase.basedOnPhaseId);

  return (
    <div
      className="sp-branch-selector"
      role="region"
      aria-label="Branch alternatives"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        background: "rgba(30, 36, 50, 0.6)",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#8b95a8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          ⑂ Branches
        </span>
        {sourcePhase && (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            from {sourcePhase.name}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {branchSiblings.map((branch) => {
          const isActive = branch.id === selectedPhase.id;
          const colour = getPhaseColourById(branch.id, allPhases);

          function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectBranch(branch.id);
            }
          }

          return (
            <button
              key={branch.id}
              className="sp-branch-card"
              onClick={() => onSelectBranch(branch.id)}
              onKeyDown={handleKeyDown}
              aria-pressed={isActive}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                background: isActive ? "rgba(74, 144, 217, 0.15)" : "rgba(255,255,255,0.04)",
                border: isActive ? `1px solid ${colour}` : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 4,
                cursor: "pointer",
                minWidth: 0,
                transition: "all 0.15s ease",
              }}
            >
              <span
                style={{
                  width: 3,
                  height: 20,
                  borderRadius: 2,
                  backgroundColor: colour,
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <StatusDot status={branch.status} />
                  <span style={{
                    fontSize: 11,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "#e0e4ec" : "#8b95a8",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {branch.name}
                  </span>
                </div>
                {branch.objective && (
                  <span style={{
                    fontSize: 9,
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 200,
                  }}>
                    {branch.objective}
                  </span>
                )}
              </div>
            </button>
          );
        })}

        {onForkPhase && (
          <button
            className="sp-branch-card sp-branch-card--add"
            onClick={onForkPhase}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "6px 12px",
              background: "rgba(255,255,255,0.04)",
              border: "1px dashed rgba(255,255,255,0.12)",
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 11,
              gap: 4,
              transition: "all 0.15s ease",
            }}
            aria-label="Add another branch"
          >
            <span aria-hidden="true">+</span> New COA
          </button>
        )}
      </div>
    </div>
  );
}
