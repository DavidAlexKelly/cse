/**
 * ValidationPanel — shows all current validation issues grouped by severity.
 * Clicking an issue selects that unit in the tree and flies the map to it.
 */

import type {} from "react";
import type { ValidationIssue, OUnit } from "../../../types";

interface Props {
  issues: ValidationIssue[];
  units: Map<string, OUnit>;
  onSelectUnit: (unitKey: string) => void;
}

export function ValidationPanel({ issues, units, onSelectUnit }: Props) {
  const errors = issues.filter((i) => i.severity === "ERROR");
  const warnings = issues.filter((i) => i.severity === "WARNING");

  if (issues.length === 0) {
    return (
      <div
        style={{
          padding: "12px 16px",
          color: "#a5d6a7",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 16 }}>✓</span>
        All validation checks passed — ready to translate
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", maxHeight: "100%" }}>
      {errors.length > 0 && (
        <Section
          title={`${errors.length} Error${errors.length !== 1 ? "s" : ""}`}
          colour="#C62828"
          issues={errors}
          units={units}
          onSelect={onSelectUnit}
        />
      )}
      {warnings.length > 0 && (
        <Section
          title={`${warnings.length} Warning${warnings.length !== 1 ? "s" : ""}`}
          colour="#E65100"
          issues={warnings}
          units={units}
          onSelect={onSelectUnit}
        />
      )}
    </div>
  );
}

function Section({
  title,
  colour,
  issues,
  units,
  onSelect,
}: {
  title: string;
  colour: string;
  issues: ValidationIssue[];
  units: Map<string, OUnit>;
  onSelect: (key: string) => void;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{
          padding: "4px 12px",
          background: colour + "22",
          borderLeft: `3px solid ${colour}`,
          color: colour,
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {title}
      </div>
      {issues.map((issue, i) => {
        const unitName =
          units.get(issue.unitKey)?.unitIdentifier ?? issue.unitKey;
        return (
          <div
            key={i}
            onClick={() => onSelect(issue.unitKey)}
            style={{
              padding: "6px 12px 6px 16px",
              borderBottom: "1px solid #1e2d3a",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLDivElement).style.background = "#1a2b3c")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLDivElement).style.background = "transparent")
            }
          >
            <span style={{ fontSize: 12, color: "#e0e0e0" }}>
              {issue.message}
            </span>
            <span style={{ fontSize: 11, color: "#607d8b" }}>
              {unitName} · {issue.code}
            </span>
          </div>
        );
      })}
    </div>
  );
}
