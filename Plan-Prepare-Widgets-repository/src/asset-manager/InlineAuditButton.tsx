// ============================================================
//  InlineAuditButton
//  A small "🤖 Audit" button + scrollable output box.
//  Designed to sit inside card headers in overlays.
// ============================================================

import React, { useState, useCallback } from "react";
import { client } from "../client.js";
import { orbatAuditSingle } from "@custom-widget/sdk";

type AuditState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; report: string }
  | { status: "error"; message: string };

// ─── Tiny markdown renderer ──────────────────────────────────────────────────

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let ki = 0;
  const k = () => ki++;

  while (i < lines.length) {
    const line = lines[i];
    if (/^### /.test(line)) {
      nodes.push(
        <h3 key={k()} className="am-audit-h3">
          {line.slice(4)}
        </h3>
      );
      i++;
      continue;
    }
    if (/^## /.test(line)) {
      nodes.push(
        <h2 key={k()} className="am-audit-h2">
          {line.slice(3)}
        </h2>
      );
      i++;
      continue;
    }
    if (/^# /.test(line)) {
      nodes.push(
        <h1 key={k()} className="am-audit-h1">
          {line.slice(2)}
        </h1>
      );
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      nodes.push(<hr key={k()} className="am-audit-hr" />);
      i++;
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={k()} className="am-audit-ul">
          {items.map((item, idx) => (
            <li key={idx} className="am-audit-li">
              {inlineMd(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }
    if (line.trim() === "") {
      nodes.push(<div key={k()} className="am-audit-spacer" />);
      i++;
      continue;
    }
    nodes.push(
      <p key={k()} className="am-audit-p">
        {inlineMd(line)}
      </p>
    );
    i++;
  }
  return <>{nodes}</>;
}

function inlineMd(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let ki = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last)
      parts.push(<span key={ki++}>{text.slice(last, match.index)}</span>);
    const raw = match[0];
    if (raw.startsWith("**"))
      parts.push(
        <strong key={ki++} className="am-audit-bold">
          {raw.slice(2, -2)}
        </strong>
      );
    else
      parts.push(
        <code key={ki++} className="am-audit-code">
          {raw.slice(1, -1)}
        </code>
      );
    last = match.index + raw.length;
  }
  if (last < text.length)
    parts.push(<span key={ki++}>{text.slice(last)}</span>);
  return <>{parts}</>;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  /** Value passed to orbatAuditSingle as unitIdentifier */
  auditId: string;
}

export const InlineAuditButton: React.FC<Props> = ({ auditId }) => {
  const [state, setState] = useState<AuditState>({ status: "idle" });

  const run = useCallback(async () => {
    setState({ status: "running" });
    try {
      const result = await client(orbatAuditSingle).executeFunction({
        unitIdentifier: auditId,
      });
      setState({ status: "done", report: result as string });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [auditId]);

  return (
    <div className="am-inline-audit">
      {/* ── Trigger row ── */}
      <div className="am-inline-audit-bar">
        <button
          className={`am-inline-audit-btn${
            state.status === "running" ? " running" : ""
          }${state.status === "done" ? " done" : ""}`}
          onClick={run}
          disabled={state.status === "running"}
          title={`Run AI audit for ${auditId}`}
        >
          {state.status === "running" ? (
            <>
              <div className="am-spinner am-inline-audit-spinner" />
              Auditing…
            </>
          ) : state.status === "done" ? (
            <>◈ Re-run audit</>
          ) : (
            <>◈ AI Audit</>
          )}
        </button>

        {state.status === "error" && (
          <span className="am-inline-audit-err" title={state.message}>
            ! Failed — click to retry
          </span>
        )}
      </div>

      {/* ── Output box ── */}
      {(state.status === "done" || state.status === "error") && (
        <div
          className={`am-inline-audit-output${
            state.status === "error" ? " error" : ""
          }`}
        >
          {state.status === "error" ? (
            <span style={{ color: "var(--am-red)", fontSize: 11 }}>
              {state.message}
            </span>
          ) : (
            <div className="am-audit-report am-audit-report--compact">
              {renderMarkdown(
                (state as { status: "done"; report: string }).report
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
