import React from "react";
import type { InventoryCounts, NavTarget } from "./types.js";
import { getDomainStyle, getNatFlag } from "./icons.js";

interface Props {
  counts: InventoryCounts;
  isLoading: boolean;
  onNavigate: (target: NavTarget) => void;
}

function pctColor(pct: number): string {
  if (pct >= 85) return "good";
  if (pct >= 60) return "ok";
  return "poor";
}

export const InventoryView: React.FC<Props> = ({
  counts,
  isLoading,
  onNavigate,
}) => {
  if (isLoading) {
    return (
      <div className="am-view">
        <div className="am-content-header">
          <span className="am-content-header-icon">▤</span>
          <span className="am-content-header-title">Inventory overview</span>
        </div>
        <div className="am-state-center">
          <div className="am-spinner" />
          <div className="am-state-sub">Loading ontology data…</div>
        </div>
      </div>
    );
  }

  const domainEntries = Object.entries(counts.byDomain).sort(
    (a, b) => b[1].mapped + b[1].unmapped - (a[1].mapped + a[1].unmapped)
  );
  const natEntries = Object.entries(counts.byNationality).sort(
    (a, b) => b[1].canonical - a[1].canonical
  );

  return (
    <div className="am-view">
      <div className="am-content-header">
        <span className="am-content-header-icon">▤</span>
        <span className="am-content-header-title">Inventory overview</span>
        <span className="am-content-header-spacer" />
        <span className="am-content-header-meta">
          {new Date().toLocaleDateString([], {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
        </span>
      </div>

      <div className="am-inventory">
        {/* ── Top summary cards ── */}
        <div className="am-inv-summary">
          {/* Canonical assets — navigate to category browser */}
          <button
            className="am-inv-card am-inv-card--clickable"
            onClick={() => onNavigate({ view: "categoryBrowser" })}
            title="Browse canonical assets"
          >
            <div className="am-inv-card-icon-row">
              <span className="am-inv-card-emoji">▦</span>
            </div>
            <div className="am-inv-card-value">{counts.totalCanonical}</div>
            <div className="am-inv-card-label">Canonical assets</div>
            <div className="am-inv-card-sub">doctrine catalogue ›</div>
          </button>

          {/* VBS4 entries — navigate to VBS4 catalogue */}
          <button
            className="am-inv-card am-inv-card--clickable"
            onClick={() => onNavigate({ view: "vbs4" })}
            title="Browse VBS4 catalogue"
          >
            <div className="am-inv-card-icon-row">
              <span className="am-inv-card-emoji">▣</span>
            </div>
            <div className="am-inv-card-value">{counts.totalVbs4}</div>
            <div className="am-inv-card-label">VBS4 entries</div>
            <div className="am-inv-card-sub">spawnable entities ›</div>
          </button>

          {/* Mapped — navigate to mismatch report (no specific category, just overview) */}
          <button
            className="am-inv-card am-inv-card--clickable"
            onClick={() => onNavigate({ view: "mismatches" })}
            title="View mismatch report"
          >
            <div className="am-inv-card-icon-row">
              <span className="am-inv-card-emoji" style={{ color: "#4ade80" }}>
                ✓
              </span>
            </div>
            <div className="am-inv-card-value" style={{ color: "#4ade80" }}>
              {counts.mappedCanonical}
            </div>
            <div className="am-inv-card-label">Mapped</div>
            <div className="am-inv-card-sub">
              {counts.totalCanonical > 0
                ? `${Math.round(
                    (counts.mappedCanonical / counts.totalCanonical) * 100
                  )}% coverage ›`
                : "—"}
            </div>
          </button>

          {/* Unmapped canonical — navigate to mismatch report, unmapped_canonical category */}
          <button
            className="am-inv-card am-inv-card--clickable"
            onClick={() =>
              onNavigate({
                view: "mismatches",
                mismatchCategory: "unmapped_canonical",
              })
            }
            title="View unmapped canonical assets in mismatch report"
          >
            <div className="am-inv-card-icon-row">
              <span
                className="am-inv-card-emoji"
                style={{ color: "var(--am-amber)" }}
              >
                !
              </span>
            </div>
            <div
              className={`am-inv-card-value ${
                counts.unmappedCanonical > 0 ? "warn" : ""
              }`}
            >
              {counts.unmappedCanonical}
            </div>
            <div className="am-inv-card-label">Unmapped</div>
            <div className="am-inv-card-sub">no simulator model ›</div>
          </button>

          {/* Orphan VBS4 — navigate to mismatch report, orphan_vbs4 category */}
          <button
            className="am-inv-card am-inv-card--clickable"
            onClick={() =>
              onNavigate({
                view: "mismatches",
                mismatchCategory: "orphan_vbs4",
              })
            }
          >
            <div className="am-inv-card-icon-row">
              <span className="am-inv-card-emoji">⇋</span>
            </div>
            <div
              className={`am-inv-card-value ${
                counts.orphanVbs4 > 0 ? "danger" : ""
              }`}
            >
              {counts.orphanVbs4}
            </div>
            <div className="am-inv-card-label">Orphan VBS4</div>
            <div className="am-inv-card-sub">no canonical parent ›</div>
          </button>

          {/* Drones — navigate to VBS4 catalogue (drone filter) */}
          <button
            className="am-inv-card am-inv-card--clickable"
            onClick={() => onNavigate({ view: "vbs4" })}
            title="Browse VBS4 drone entries"
          >
            <div className="am-inv-card-icon-row">
              <span
                className="am-inv-card-emoji"
                style={{ color: "var(--am-purple)" }}
              >
                ◈
              </span>
            </div>
            <div
              className="am-inv-card-value"
              style={{ color: "var(--am-purple)" }}
            >
              {counts.droneCount}
            </div>
            <div className="am-inv-card-label">Drones</div>
            <div className="am-inv-card-sub">VBS4 drone entries ›</div>
          </button>
        </div>

        {/* ── Mapping coverage by domain ── */}
        <div>
          <div className="am-inv-section-title">Mapping coverage by domain</div>
          <div className="am-domain-grid">
            {domainEntries.map(([domain, { mapped, unmapped }]) => {
              const total = mapped + unmapped;
              const style = getDomainStyle(domain);
              return (
                <div
                  key={domain}
                  className="am-domain-card"
                  style={{ borderTop: `2px solid ${style.color}` }}
                >
                  <div className="am-domain-card-header">
                    <div
                      className="am-domain-card-icon"
                      style={{ background: style.bg, color: style.color }}
                    >
                      {style.emoji}
                    </div>
                    <div>
                      <div className="am-domain-card-name">{domain}</div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--am-text-muted)",
                          marginTop: 1,
                        }}
                      >
                        {total} assets ·{" "}
                        {total > 0 ? Math.round((mapped / total) * 100) : 0}%
                        mapped
                      </div>
                    </div>
                  </div>
                  <div className="am-domain-bar-row">
                    <span
                      className="am-domain-bar-label"
                      style={{ color: "var(--am-green)" }}
                    >
                      Mapped
                    </span>
                    <div className="am-domain-bar-track">
                      <div
                        className="am-domain-bar-fill mapped"
                        style={{
                          width: `${total > 0 ? (mapped / total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="am-domain-bar-count">{mapped}</span>
                  </div>
                  <div className="am-domain-bar-row">
                    <span
                      className="am-domain-bar-label"
                      style={{ color: "var(--am-red)" }}
                    >
                      Unmapped
                    </span>
                    <div className="am-domain-bar-track">
                      <div
                        className="am-domain-bar-fill unmapped"
                        style={{
                          width: `${total > 0 ? (unmapped / total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="am-domain-bar-count">{unmapped}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Coverage by nationality ── */}
        {natEntries.length > 0 && (
          <div>
            <div className="am-inv-section-title">Coverage by nationality</div>
            <div className="am-nat-table">
              <div className="am-nat-table-head">
                <span>Nation</span>
                <span style={{ textAlign: "right" }}>Canonical</span>
                <span style={{ textAlign: "right" }}>Mapped</span>
                <span style={{ textAlign: "right" }}>Unmapped</span>
                <span style={{ textAlign: "right" }}>Status</span>
              </div>
              {natEntries.map(([nat, { canonical, mapped, unmapped }]) => {
                const pct =
                  canonical > 0 ? Math.round((mapped / canonical) * 100) : 0;
                const flag = getNatFlag(nat);
                return (
                  <div key={nat} className="am-nat-row">
                    <span className="am-nat-name">
                      {flag && <span className="am-nat-code">{flag}</span>}
                      {nat}
                    </span>
                    <span className="am-nat-num">{canonical}</span>
                    <span className="am-nat-num mapped">{mapped}</span>
                    <span className="am-nat-num">{unmapped}</span>
                    <span className={`am-nat-pct ${pctColor(pct)}`}>
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
