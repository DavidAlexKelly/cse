// ============================================================
//  ORBAT Audit Tab — LLM-powered two-stage audit
// ============================================================

import React, { useState, useCallback } from "react";
import { client } from "../client.js";
import { orbatAudit } from "@custom-widget/sdk";

type AuditState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; report: string; ranAt: Date }
  | { status: "error"; message: string };

// ─── Minimal markdown renderer ─────────────────────────────
// Converts the headings, bold, inline-code, and bullet lists
// that GPT reliably emits into styled JSX.  No external dep.
function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let keyIdx = 0;
  const key = () => keyIdx++;

  while (i < lines.length) {
    const line = lines[i];

    // H1
    if (/^# /.test(line)) {
      nodes.push(
        <h1 key={key()} className="am-audit-h1">
          {line.slice(2)}
        </h1>
      );
      i++;
      continue;
    }
    // H2
    if (/^## /.test(line)) {
      nodes.push(
        <h2 key={key()} className="am-audit-h2">
          {line.slice(3)}
        </h2>
      );
      i++;
      continue;
    }
    // H3
    if (/^### /.test(line)) {
      nodes.push(
        <h3 key={key()} className="am-audit-h3">
          {line.slice(4)}
        </h3>
      );
      i++;
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      nodes.push(<hr key={key()} className="am-audit-hr" />);
      i++;
      continue;
    }
    // Unordered list block — collect consecutive bullet lines
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={key()} className="am-audit-ul">
          {items.map((item, idx) => (
            <li key={idx} className="am-audit-li">
              {inlineMarkdown(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }
    // Empty line → spacer
    if (line.trim() === "") {
      nodes.push(<div key={key()} className="am-audit-spacer" />);
      i++;
      continue;
    }
    // Default: paragraph
    nodes.push(
      <p key={key()} className="am-audit-p">
        {inlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return <>{nodes}</>;
}

/** Handles **bold**, `code`, and plain text within a single line. */
function inlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let k = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<span key={k++}>{text.slice(last, match.index)}</span>);
    }
    const raw = match[0];
    if (raw.startsWith("**")) {
      parts.push(
        <strong key={k++} className="am-audit-bold">
          {raw.slice(2, -2)}
        </strong>
      );
    } else {
      parts.push(
        <code key={k++} className="am-audit-code">
          {raw.slice(1, -1)}
        </code>
      );
    }
    last = match.index + raw.length;
  }
  if (last < text.length) {
    parts.push(<span key={k++}>{text.slice(last)}</span>);
  }
  return <>{parts}</>;
}

// ─── Component ────────────────────────────────────────────

export const OrbatAuditTab: React.FC = () => {
  const [state, setState] = useState<AuditState>({ status: "idle" });

  const runAudit = useCallback(async () => {
    setState({ status: "running" });
    try {
      const result = await client(orbatAudit).executeFunction();
      setState({ status: "done", report: result as string, ranAt: new Date() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ status: "error", message: msg });
    }
  }, []);

  return (
    <div className="am-audit-tab">
      {/* ── Panel header ── */}
      <div className="am-audit-header">
        <div className="am-audit-header-left">
          <span className="am-audit-header-icon">◈</span>
          <div>
            <div className="am-audit-header-title">AI ORBAT Audit</div>
            <div className="am-audit-header-sub">
              Two-stage LLM scan (GPT-5 Nano fast pass → GPT-4.1 deep analysis)
            </div>
          </div>
        </div>
        <div className="am-audit-header-right">
          {state.status === "done" && (
            <span className="am-audit-timestamp">
              Last run:{" "}
              {state.ranAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          <button
            className={`am-audit-run-btn${
              state.status === "running" ? " running" : ""
            }`}
            onClick={runAudit}
            disabled={state.status === "running"}
          >
            {state.status === "running" ? (
              <>
                <div className="am-spinner am-audit-spinner" />
                Running audit…
              </>
            ) : (
              <>
                <span>⚡</span>
                {state.status === "done" ? "Re-run audit" : "Run AI audit"}
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="am-audit-body">
        {state.status === "idle" && (
          <div className="am-state-center">
            <div className="am-state-icon">⌕</div>
            <div className="am-state-title">Ready to audit</div>
            <div className="am-state-sub">
              Click <strong>Run AI audit</strong> to scan all NXG ORBAT objects
              for mismatches, missing data, and structural inconsistencies using
              a two-stage LLM analysis.
            </div>
          </div>
        )}

        {state.status === "running" && (
          <div className="am-state-center">
            <div className="am-audit-running-animation">
              <div className="am-spinner am-spinner--lg" />
            </div>
            <div className="am-state-title">Audit in progress…</div>
            <div className="am-state-sub">
              Stage 1 · GPT-5 Nano fast scan across all units &amp; Simworks
              assets
            </div>
            <div className="am-audit-stages">
              <div className="am-audit-stage am-audit-stage--active">
                <span className="am-audit-stage-dot" />
                Stage 1 — Fast scan (GPT-5 Nano)
              </div>
              <div className="am-audit-stage am-audit-stage--pending">
                <span className="am-audit-stage-dot" />
                Stage 2 — Deep analysis (GPT-4.1)
              </div>
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="am-state-center">
            <div className="am-state-icon">⚠</div>
            <div className="am-state-title">Audit failed</div>
            <div className="am-state-sub">{state.message}</div>
            <button
              className="am-btn"
              style={{ marginTop: 12 }}
              onClick={runAudit}
            >
              ↺ Retry
            </button>
          </div>
        )}

        {state.status === "done" && (
          <div className="am-audit-report">{renderMarkdown(state.report)}</div>
        )}
      </div>
    </div>
  );
};
