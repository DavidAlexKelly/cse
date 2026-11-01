// ============================================================
//  Unit Audit Panel
//  Prominent CTA button → runs orbatAuditSingle → markdown output
// ============================================================

import React, { useState, useCallback } from "react";
import { client } from "../client.js";
import { orbatAuditSingle } from "@custom-widget/sdk";

type AuditState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; report: string; ranAt: Date }
  | { status: "error"; message: string };

// ─── Minimal markdown renderer (shared logic, duplicated to avoid circular dep)
function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let keyIdx = 0;
  const k = () => keyIdx++;

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
              {inlineMarkdown(item)}
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
        {inlineMarkdown(line)}
      </p>
    );
    i++;
  }
  return <>{nodes}</>;
}

function inlineMarkdown(text: string): React.ReactNode {
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

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  unitIdentifier: string;
  unitLabel?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const UnitAuditPanel: React.FC<Props> = ({
  unitIdentifier,
  unitLabel,
}) => {
  const [state, setState] = useState<AuditState>({ status: "idle" });

  const runAudit = useCallback(async () => {
    setState({ status: "running" });
    try {
      const result = await client(orbatAuditSingle).executeFunction({
        unitIdentifier,
      });
      setState({ status: "done", report: result as string, ranAt: new Date() });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [unitIdentifier]);

  const displayName = unitLabel ?? unitIdentifier;

  return (
    <div className="am-unit-audit">
      {/* ── CTA — stacked layout so button is always fully visible ── */}
      <div className="am-unit-audit-cta">
        <div className="am-unit-audit-cta-top">
          <span className="am-unit-audit-cta-icon">◈</span>
          <div className="am-unit-audit-cta-text">
            <div className="am-unit-audit-cta-title">AI Unit Audit</div>
            <div className="am-unit-audit-cta-sub">
              GPT-4.1 deep scan of{" "}
              <code className="am-unit-audit-cta-code">{displayName}</code>
            </div>
          </div>
        </div>
        <button
          className={`am-unit-audit-cta-btn${
            state.status === "running" ? " running" : ""
          }${state.status === "done" ? " rerun" : ""}`}
          onClick={runAudit}
          disabled={state.status === "running"}
        >
          {state.status === "running" ? (
            <>
              <div className="am-spinner am-audit-spinner" />
              Analysing…
            </>
          ) : state.status === "done" ? (
            <>
              <span>↺</span>Re-run audit
            </>
          ) : (
            <>
              <span>⚡</span>Run AI audit
            </>
          )}
        </button>
      </div>

      {/* ── Output area — only shown once triggered ── */}
      {state.status !== "idle" && (
        <div className="am-unit-audit-output">
          {state.status === "running" && (
            <div className="am-unit-audit-running">
              <div className="am-spinner am-spinner--lg" />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>
                  Auditing unit…
                </div>
                <div style={{ fontSize: 11, color: "var(--am-text-muted)" }}>
                  GPT-4.1 is analysing all linked assets
                </div>
              </div>
            </div>
          )}

          {state.status === "error" && (
            <div className="am-unit-audit-error">
              <span style={{ fontSize: 18 }}>⚠</span>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontWeight: 600,
                    color: "var(--am-red)",
                    marginBottom: 3,
                  }}
                >
                  Audit failed
                </div>
                <div style={{ fontSize: 11, color: "var(--am-text-muted)" }}>
                  {state.message}
                </div>
              </div>
              <button className="am-btn" onClick={runAudit}>
                ↺ Retry
              </button>
            </div>
          )}

          {state.status === "done" && (
            <>
              <div className="am-unit-audit-output-meta">
                <span className="am-unit-audit-output-badge">
                  ✓ Audit complete
                </span>
                <span className="am-audit-timestamp">
                  {state.ranAt.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="am-audit-report am-audit-report--compact">
                {renderMarkdown(state.report)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
