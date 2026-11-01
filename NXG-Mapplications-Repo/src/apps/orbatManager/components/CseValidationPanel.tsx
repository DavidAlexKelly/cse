/**
 * CseValidationPanel — shows the results of a cseValidateOrbat (VBS4) call.
 *
 * Two validation modes are exposed via tabs:
 *  - "Live ORBAT" — validates the ontology data currently loaded for the operation.
 *  - "External JSON" — validates a raw JSON string passed in from a Workshop variable.
 *
 * Both modes share the same project name input and results display.
 */

import { useState } from "react";
import type { CseValidationError } from "@/shared/lib/foundry";

export type { CseValidationError };
export type CseValidationStatus = "idle" | "running" | "done" | "error";

interface Props {
  cseErrors: CseValidationError[];
  cseStatus: CseValidationStatus;
  cseErrorMessage: string | null;
  projectName: string;
  onProjectNameChange: (name: string) => void;
  /** Validate the live ontology ORBAT */
  onRunValidation: () => void;
  /** Validate the external JSON string from Workshop */
  onRunValidationFromJson: () => void;
  hasLocalErrors: boolean;
  /** The external ORBAT JSON from Workshop — empty string if not set */
  externalOrbatJson: string;
}

type ValidationMode = "live" | "external";

export function CseValidationPanel({
  cseErrors,
  cseStatus,
  cseErrorMessage,
  projectName,
  onProjectNameChange,
  onRunValidation,
  onRunValidationFromJson,
  hasLocalErrors,
  externalOrbatJson,
}: Props) {
  const [mode, setMode] = useState<ValidationMode>("live");

  const blockingErrors = cseErrors.filter((e) => !e.isWarning);
  const warnings = cseErrors.filter((e) => e.isWarning);

  const isRunning = cseStatus === "running";
  const isDone = cseStatus === "done";
  const isError = cseStatus === "error";

  const liveDisabled = isRunning || !projectName.trim() || hasLocalErrors;
  const externalDisabled = isRunning || !projectName.trim() || !externalOrbatJson.trim();

  const handleValidate = () => {
    if (mode === "live") onRunValidation();
    else onRunValidationFromJson();
  };

  const validateDisabled = mode === "live" ? liveDisabled : externalDisabled;
  const validateTitle = mode === "live"
    ? hasLocalErrors
      ? "Resolve local validation errors before running CSE validation"
      : !projectName.trim()
      ? "Enter a CSE project name"
      : "Validate the live ORBAT data against the CSE VBS4 schema"
    : !projectName.trim()
    ? "Enter a CSE project name"
    : !externalOrbatJson.trim()
    ? "No external ORBAT JSON received from Workshop"
    : "Validate the external ORBAT JSON against the CSE VBS4 schema";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 16px" }}>

      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 2, background: "#0a1520", borderRadius: 4, padding: 2, border: "1px solid #1e3a4a", alignSelf: "flex-start" }}>
        {(["live", "external"] as ValidationMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: "3px 12px",
              background: mode === m ? "#1565C0" : "transparent",
              color: mode === m ? "#fff" : "#90a4ae",
              border: "none",
              borderRadius: 3,
              fontSize: 11,
              cursor: "pointer",
              fontWeight: mode === m ? 600 : 400,
            }}
          >
            {m === "live" ? "Live ORBAT" : "External JSON"}
          </button>
        ))}
      </div>

      {/* External JSON status indicator */}
      {mode === "external" && (
        <div style={{
          fontSize: 11,
          padding: "4px 8px",
          borderRadius: 3,
          borderLeft: `3px solid ${externalOrbatJson.trim() ? "#2e7d32" : "#607d8b"}`,
          background: externalOrbatJson.trim() ? "#0d2010" : "#131e2a",
          color: externalOrbatJson.trim() ? "#a5d6a7" : "#607d8b",
        }}>
          {externalOrbatJson.trim()
            ? `✓ External ORBAT received (${externalOrbatJson.length.toLocaleString()} chars) — from Workshop variable "externalOrbatJson"`
            : "No external ORBAT JSON received — set the Workshop variable \"externalOrbatJson\""}
        </div>
      )}

      {/* Project name input + validate button */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          placeholder="CSE project name (e.g. BALTIC-SHIELD)"
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          style={{
            flex: 1,
            padding: "5px 10px",
            background: "#1a2b3c",
            border: "1px solid #2a4a5a",
            borderRadius: 4,
            color: "#e0e0e0",
            fontSize: 12,
            outline: "none",
          }}
        />
        <button
          onClick={handleValidate}
          disabled={validateDisabled}
          title={validateTitle}
          style={{
            padding: "5px 14px",
            background: validateDisabled ? "#2a3a4a" : "#1565C0",
            color: "#e0e0e0",
            border: "none",
            borderRadius: 4,
            fontSize: 12,
            cursor: validateDisabled ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
            opacity: validateDisabled ? 0.6 : 1,
          }}
        >
          {isRunning ? "Validating…" : "Validate VBS4"}
        </button>
      </div>

      {/* Local errors guard (live mode only) */}
      {mode === "live" && hasLocalErrors && (
        <div style={{
          fontSize: 11,
          color: "#ffcc80",
          padding: "4px 8px",
          background: "#2a1f0a",
          borderRadius: 3,
          borderLeft: "3px solid #E65100",
        }}>
          ⚠ Resolve local structural errors first before running CSE validation
        </div>
      )}

      {/* API call error */}
      {isError && cseErrorMessage && (
        <div style={{
          fontSize: 12,
          color: "#ef9a9a",
          padding: "5px 8px",
          background: "#2a0f0f",
          borderRadius: 3,
          borderLeft: "3px solid #C62828",
        }}>
          CSE validation failed: {cseErrorMessage}
        </div>
      )}

      {/* Results */}
      {isDone && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {cseErrors.length === 0 ? (
            <div style={{
              fontSize: 12,
              color: "#a5d6a7",
              padding: "5px 8px",
              background: "#0d2010",
              borderRadius: 3,
              borderLeft: "3px solid #2e7d32",
            }}>
              ✓ VBS4 ORBAT is valid — ready to add to CSE project
            </div>
          ) : (
            <>
              {blockingErrors.length > 0 && (
                <IssueSection
                  title={`${blockingErrors.length} VBS4 error${blockingErrors.length !== 1 ? "s" : ""}`}
                  colour="#C62828"
                  items={blockingErrors}
                />
              )}
              {warnings.length > 0 && (
                <IssueSection
                  title={`${warnings.length} VBS4 warning${warnings.length !== 1 ? "s" : ""}`}
                  colour="#E65100"
                  items={warnings}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function IssueSection({
  title,
  colour,
  items,
}: {
  title: string;
  colour: string;
  items: CseValidationError[];
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          padding: "3px 8px",
          background: colour + "22",
          borderLeft: `3px solid ${colour}`,
          color: colour,
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          cursor: "pointer",
          userSelect: "none",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{title}</span>
        <span>{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded &&
        items.map((item, i) => (
          <div
            key={i}
            style={{
              padding: "5px 8px 5px 12px",
              borderBottom: "1px solid #1e2d3a",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 11, color: "#e0e0e0" }}>
              {item.description ?? item.message ?? "Unknown issue"}
            </span>
            {item.path && (
              <span style={{ fontSize: 10, color: "#607d8b", fontFamily: "monospace" }}>
                {item.path}
              </span>
            )}
          </div>
        ))}
    </div>
  );
}
