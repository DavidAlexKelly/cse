// ============================================================
//  CSE Validation Tab
//
//  Wraps the ontology function `cseValidateOrbat` (Compute-Module-backed) so
//  the current ORBAT can be validated against server-side schema and logic
//  rules without persisting it.
//
//  The function contract:
//    input:  { orbatContent: string, projectName: string }
//    output: string   — expected to be JSON, but we defensively render as
//                       either parsed JSON or raw text if parsing fails.
//
//  The panel is intentionally read-only: no auto-fix (the returned violation
//  shape is unknown at compile time), no state mutation.  It's a call-and-
//  display view that lets the user click "Validate now" and see whatever the
//  server returns.  A future iteration can parse the result and cross-link
//  findings back to unit ids when the server-side schema stabilises.
// ============================================================

import React, { useCallback, useMemo, useState } from "react";
import { cseValidateOrbat } from "@custom-widget/sdk";
import { client } from "../client.js";
import type { UnitNode } from "./types.js";
import { serialiseOrbatForValidation } from "./cseValidateSerialise.js";

interface Props {
  units: UnitNode[];
  /**
   * Free-text project/operation title.  Passed straight through to the
   * function as its `projectName` argument, and also embedded in the
   * serialised orbat envelope as the top-level `title` for the fallback
   * path.
   */
  projectName: string;
  /** Foundry terrain identifier — matches NxgOperation.terrainName. */
  terrainName?: string;
  /** Operation UUID to use as the envelope's top-level `id`. */
  operationId?: string;
  /** Operation window (start / end).  Defaults to a 2-week window from now. */
  started?: string | Date;
  ended?: string | Date;
  /**
   * PRIMARY code path.  Pre-built SWORD-shaped ORBAT JSON string supplied by
   * Workshop (via the operation→SWORD helper function bound to the
   * `validationPayload` widget parameter).  When present, this is used
   * VERBATIM as `orbatContent` — no widget-side serialisation happens.
   *
   * When absent/empty the tab falls back to serialising the widget's live
   * tree, which is useful for previewing but usually rejected by the CSE
   * server because it isn't tied to a real NXG Operation.
   */
  validationPayload?: string;
  /**
   * Optional callback invoked with the raw response string every time a
   * validation run finishes successfully.  The root widget uses this to
   * emit the `onValidationCompleted` event out to Workshop.
   */
  onValidationCompleted?: (rawResult: string) => void;
}

type Stage = "idle" | "loading" | "done" | "error";

// ─── Result rendering ────────────────────────────────────────────────────────

/**
 * Try to parse the response as JSON and, if successful, render it in a
 * structured way (heuristically detecting arrays of `{ severity/message }`
 * shaped objects that most validation functions return).  Otherwise falls
 * back to a `<pre>` block.
 */
const ResultRenderer: React.FC<{ raw: string }> = ({ raw }) => {
  const parsed = useMemo<unknown>(() => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }, [raw]);

  // If it's an object with a "violations" or "issues" or "errors" array, use that
  const findings = useMemo<Array<Record<string, unknown>> | null>(() => {
    if (!parsed || typeof parsed !== "object") return null;
    const asRec = parsed as Record<string, unknown>;
    for (const key of [
      "violations",
      "issues",
      "errors",
      "findings",
      "results",
    ]) {
      const v = asRec[key];
      if (
        Array.isArray(v) &&
        v.every((x) => typeof x === "object" && x !== null)
      ) {
        return v as Array<Record<string, unknown>>;
      }
    }
    // Top-level array of finding-shaped objects
    if (
      Array.isArray(parsed) &&
      parsed.every((x) => typeof x === "object" && x !== null)
    ) {
      return parsed as Array<Record<string, unknown>>;
    }
    return null;
  }, [parsed]);

  // Top-level "valid" boolean
  const topLevelValid = useMemo<boolean | null>(() => {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const asRec = parsed as Record<string, unknown>;
    for (const key of ["valid", "ok", "success", "passed"]) {
      if (typeof asRec[key] === "boolean") return asRec[key] as boolean;
    }
    return null;
  }, [parsed]);

  if (findings && findings.length === 0) {
    return (
      <div className="cse-empty">
        <span style={{ fontSize: 28 }}>✓</span>
        <span>Structure passes CSE validation — no findings.</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {topLevelValid !== null && (
        <div
          className="cse-summary-banner"
          style={{
            background: topLevelValid
              ? "rgba(64,160,96,0.10)"
              : "rgba(231,106,110,0.10)",
            border: `1px solid ${
              topLevelValid ? "rgba(64,160,96,0.4)" : "rgba(231,106,110,0.4)"
            }`,
            color: topLevelValid ? "#4ade80" : "#ef4d4d",
          }}
        >
          <span style={{ fontSize: 22 }}>{topLevelValid ? "✓" : "⛔"}</span>
          <span style={{ fontWeight: 700 }}>
            {topLevelValid
              ? "ORBAT is valid according to CSE rules"
              : "ORBAT has CSE validation issues"}
          </span>
        </div>
      )}

      {findings && findings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--mil-text-3)",
            }}
          >
            {findings.length} finding{findings.length !== 1 ? "s" : ""}
          </div>
          {findings.map((f, i) => (
            <FindingRow key={i} finding={f} />
          ))}
        </div>
      )}

      {/* Always give access to the raw response — small toggle */}
      <details style={{ marginTop: 4 }}>
        <summary
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--mil-text-3)",
            cursor: "pointer",
          }}
        >
          Raw server response
        </summary>
        <pre className="cse-raw">{raw}</pre>
      </details>

      {/* If we couldn't structure it at all, show the raw response directly */}
      {parsed === null && <pre className="cse-raw">{raw}</pre>}
    </div>
  );
};

// ─── Individual finding row ──────────────────────────────────────────────────

const SEV_COLOUR: Record<string, string> = {
  ERROR: "#ef4d4d",
  WARNING: "#d9822b",
  INFO: "#5b8bf7",
  OK: "#4ade80",
};

const FindingRow: React.FC<{ finding: Record<string, unknown> }> = ({
  finding,
}) => {
  const sev = String(
    finding.severity ?? finding.level ?? finding.type ?? "INFO"
  ).toUpperCase();
  const colour = SEV_COLOUR[sev] ?? "#8f9bb3";
  const message =
    (typeof finding.message === "string" && finding.message) ||
    (typeof finding.msg === "string" && finding.msg) ||
    (typeof finding.description === "string" && finding.description) ||
    "(no message)";
  const code =
    (typeof finding.code === "string" && finding.code) ||
    (typeof finding.rule === "string" && finding.rule) ||
    (typeof finding.id === "string" && finding.id) ||
    null;
  const unit =
    (typeof finding.unit === "string" && finding.unit) ||
    (typeof finding.unitId === "string" && finding.unitId) ||
    (typeof finding.unitName === "string" && finding.unitName) ||
    null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "8px 10px",
        background: "var(--mil-bg-2)",
        borderLeft: `3px solid ${colour}`,
        borderRadius: 3,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: colour,
            background: `${colour}22`,
            padding: "2px 6px",
            borderRadius: 3,
          }}
        >
          {sev}
        </span>
        {code && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--mil-text-3)",
              fontFamily: "var(--mil-mono, monospace)",
            }}
          >
            {code}
          </span>
        )}
        {unit && (
          <span
            style={{
              fontSize: 10,
              color: "var(--mil-text-2)",
              background: "var(--mil-bg-3, rgba(255,255,255,0.04))",
              padding: "1px 5px",
              borderRadius: 3,
            }}
          >
            unit: {unit}
          </span>
        )}
      </div>
      <div
        style={{ fontSize: 11, color: "var(--mil-text-1)", lineHeight: 1.5 }}
      >
        {message}
      </div>
      {/* Any residual keys we didn't render explicitly — makes debugging easier */}
      {(() => {
        const known = new Set([
          "severity",
          "level",
          "type",
          "message",
          "msg",
          "description",
          "code",
          "rule",
          "id",
          "unit",
          "unitId",
          "unitName",
        ]);
        const extra = Object.entries(finding).filter(([k]) => !known.has(k));
        if (extra.length === 0) return null;
        return (
          <div
            style={{
              fontSize: 9,
              color: "var(--mil-text-3)",
              fontFamily: "var(--mil-mono, monospace)",
              marginTop: 2,
            }}
          >
            {extra.map(([k, v]) => (
              <span key={k} style={{ marginRight: 10 }}>
                {k}={typeof v === "object" ? JSON.stringify(v) : String(v)}
              </span>
            ))}
          </div>
        );
      })()}
    </div>
  );
};

// ─── Main tab ────────────────────────────────────────────────────────────────

export const CseValidationTab: React.FC<Props> = ({
  units,
  projectName,
  terrainName,
  operationId,
  started,
  ended,
  validationPayload,
  onValidationCompleted,
}) => {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");
  const [lastValidatedAt, setLastValidatedAt] = useState<Date | null>(null);

  const totalUnits = useMemo(() => {
    let n = 0;
    const walk = (u: UnitNode) => {
      n++;
      u.children.forEach(walk);
    };
    units.forEach(walk);
    return n;
  }, [units]);

  // Payload source resolution:
  //   • "workshop"  — Workshop supplied a pre-built payload via the
  //                   `validationPayload` widget parameter; use it verbatim.
  //   • "widget"    — fall back to serialising the current widget tree
  //                   (useful for preview / dev, usually rejected by CSE).
  //   • "none"      — nothing to submit yet.
  const payloadSource: "workshop" | "widget" | "none" =
    validationPayload && validationPayload.trim()
      ? "workshop"
      : totalUnits > 0
      ? "widget"
      : "none";

  const canValidate = payloadSource !== "none" && stage !== "loading";

  const handleValidate = useCallback(async () => {
    if (!canValidate) return;
    setStage("loading");
    setError(null);
    setResult("");

    try {
      // Choose the payload source:
      //  1. Workshop-supplied JSON  → forward verbatim (primary path).
      //  2. Otherwise               → build one from the widget tree.
      const orbatContent =
        validationPayload && validationPayload.trim()
          ? validationPayload
          : JSON.stringify(
              serialiseOrbatForValidation(units, {
                operationId,
                title: projectName || "Untitled Operation",
                terrainName,
                started,
                ended,
              })
            );

      const raw = await client(cseValidateOrbat).executeFunction({
        orbatContent,
        projectName: projectName || "Untitled Project",
      });
      setResult(raw);
      setLastValidatedAt(new Date());
      setStage("done");
      // Forward the result up the tree so the root widget can emit it as
      // a Workshop event (`onValidationCompleted`).  Kept outside the
      // React state pipeline so the parent gets it immediately.
      try {
        onValidationCompleted?.(raw);
      } catch (cbErr) {
        // A misbehaving parent callback shouldn't break the validation UI.
        console.warn(
          "[CseValidationTab] onValidationCompleted callback threw:",
          cbErr
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }, [
    canValidate,
    validationPayload,
    units,
    projectName,
    terrainName,
    operationId,
    started,
    ended,
    onValidationCompleted,
  ]);

  return (
    <div className="cse-panel">
      {/* Header row */}
      <div className="cse-header">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--mil-text-1)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ color: "#5b8bf7" }}>◉</span>
            CSE server-side validation
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--mil-text-3)",
              lineHeight: 1.5,
            }}
          >
            Runs <code>cse_validate_orbat(orbatContent, projectName)</code>.
            Both function inputs are exposed as widget parameters —{" "}
            <code>validationPayload</code> and{" "}
            <code>validationProjectName</code> — so Workshop can bind them.
            Result is returned as-is on <code>validationResult</code> and via
            the <code>onValidationCompleted</code> event.
          </div>
        </div>

        <button
          className="ais-generate-btn"
          disabled={!canValidate}
          onClick={() => void handleValidate()}
          style={{ flexShrink: 0 }}
        >
          {stage === "loading" ? (
            <>
              <span className="ais-spinner" />
              Validating…
            </>
          ) : (
            <>
              <span>◉</span> Validate now
            </>
          )}
        </button>
      </div>

      {/* Meta line — includes the payload source badge */}
      <div
        style={{
          fontSize: 10,
          color: "var(--mil-text-3)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span>
          Project:{" "}
          <strong style={{ color: "var(--mil-text-2)" }}>
            {projectName || "—"}
          </strong>
        </span>

        {/* orbatContent source badge */}
        {payloadSource === "workshop" && (
          <span
            title="orbatContent supplied by Workshop via the `validationPayload` widget parameter."
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontWeight: 700,
              color: "#4ade80",
              background: "rgba(74, 222, 128,0.10)",
              border: "1px solid rgba(74, 222, 128,0.35)",
              padding: "1px 6px",
              borderRadius: 3,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontSize: 9,
            }}
          >
            <span>◉</span> orbatContent · Workshop
          </span>
        )}
        {payloadSource === "widget" && (
          <span
            title="No `validationPayload` bound from Workshop yet — the widget will serialise its own tree as `orbatContent`. Bind `validationPayload` to a Workshop variable (typically the output of the operation→SWORD helper) for a real check."
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontWeight: 700,
              color: "#d9822b",
              background: "rgba(217,130,43,0.10)",
              border: "1px solid rgba(217,130,43,0.35)",
              padding: "1px 6px",
              borderRadius: 3,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontSize: 9,
            }}
          >
            <span>⚠</span> orbatContent · widget tree
          </span>
        )}

        <span>
          Units in tree:{" "}
          <strong style={{ color: "var(--mil-text-2)" }}>{totalUnits}</strong>
        </span>
        {lastValidatedAt && (
          <span>
            Last run:{" "}
            <strong style={{ color: "var(--mil-text-2)" }}>
              {lastValidatedAt.toLocaleTimeString()}
            </strong>
          </span>
        )}
      </div>

      {/* Error */}
      {stage === "error" && error && (
        <div className="ais-error">
          <strong>Error:</strong> {error}
          <button
            onClick={() => {
              setError(null);
              setStage("idle");
            }}
            style={{
              marginLeft: 8,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              fontSize: 11,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Idle / empty state */}
      {stage === "idle" && !error && (
        <div className="cse-empty">
          <span style={{ fontSize: 22 }}>◉</span>
          <span>
            {payloadSource === "none"
              ? "Import an NXG Operation (or add units) before running CSE validation."
              : payloadSource === "workshop"
              ? 'Workshop payload ready — click "Validate now" to submit it to the CSE compute module.'
              : 'No Workshop payload yet — clicking "Validate now" will submit the widget tree as a fallback.'}
          </span>
        </div>
      )}

      {/* Result */}
      {stage === "done" && result && <ResultRenderer raw={result} />}
    </div>
  );
};
