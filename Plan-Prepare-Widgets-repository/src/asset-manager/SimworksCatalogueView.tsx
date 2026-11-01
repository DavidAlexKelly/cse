// ============================================================
//  Asset Manager — Simworks Asset Catalogue View
// ============================================================
//
//  Sister view to Vbs4CatalogueView, but for the second simulator
//  (Simworks). Renders all NxgSimworksAssetCatalogue rows in a
//  filterable table with domain / nationality / DIS filters.

import React, { useMemo, useState } from "react";
import type { SimworksAsset } from "./types.js";
import { getDomainStyle, getNatFlag } from "./icons.js";
import { DisCodeBadge } from "./DisCodeBadge.js";

interface Props {
  simworks: SimworksAsset[];
  isLoading: boolean;
  /** Called when a DIS code badge is clicked — opens the DIS Reference view. */
  onOpenDisReference?: (code: string) => void;
}

function capabilityDots(s: SimworksAsset): React.ReactNode {
  const dots: { icon: string; title: string }[] = [];
  if (s.hasWeapons) dots.push({ icon: "W", title: "Has weapons" });
  if (s.hasSensors) dots.push({ icon: "S", title: "Has sensors" });
  if (s.hasIff) dots.push({ icon: "I", title: "Has IFF" });
  if (s.hasEmissions) dots.push({ icon: "E", title: "Has emissions" });
  if (dots.length === 0)
    return <span style={{ color: "var(--am-text-dim)" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {dots.map((d) => (
        <span
          key={d.icon}
          title={d.title}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            borderRadius: 2,
            background: "var(--am-surface)",
            border: "1px solid var(--am-border-lt)",
            color: "var(--am-accent)",
            fontFamily: "var(--am-mono)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0,
          }}
        >
          {d.icon}
        </span>
      ))}
    </span>
  );
}

export const SimworksCatalogueView: React.FC<Props> = ({
  simworks,
  isLoading,
  onOpenDisReference,
}) => {
  const [search, setSearch] = useState("");
  const [filterDomain, setFilterDomain] = useState("All");
  const [filterNation, setFilterNation] = useState("All");

  const domains = useMemo(() => {
    const s = new Set(
      simworks.map((v) => v.militaryDomain ?? v.disDomainLabel ?? "Unknown")
    );
    return ["All", ...Array.from(s).sort()];
  }, [simworks]);

  const nations = useMemo(() => {
    const s = new Set(
      simworks.map((v) => v.nationality ?? v.disCountryLabel ?? "Unknown")
    );
    return ["All", ...Array.from(s).sort()];
  }, [simworks]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return simworks.filter((v) => {
      if (
        q &&
        !v.identifier.toLowerCase().includes(q) &&
        !(v.simworksClassLabel ?? "").toLowerCase().includes(q) &&
        !(v.assetCategory ?? "").toLowerCase().includes(q)
      )
        return false;
      const d = v.militaryDomain ?? v.disDomainLabel ?? "Unknown";
      if (filterDomain !== "All" && d !== filterDomain) return false;
      const n = v.nationality ?? v.disCountryLabel ?? "Unknown";
      if (filterNation !== "All" && n !== filterNation) return false;
      return true;
    });
  }, [simworks, search, filterDomain, filterNation]);

  if (isLoading) {
    return (
      <div className="am-view">
        <div className="am-content-header">
          <span className="am-content-header-icon">◈</span>
          <span className="am-content-header-title">Simworks catalogue</span>
        </div>
        <div className="am-state-center">
          <div className="am-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="am-view">
      <div className="am-content-header">
        <span className="am-content-header-icon">◈</span>
        <span className="am-content-header-title">Simworks catalogue</span>
        <span className="am-content-header-badge">
          {simworks.length} entities
        </span>
        <span className="am-content-header-spacer" />
        <span className="am-content-header-meta">
          Constructive & virtual simulation platform
        </span>
      </div>

      <div className="am-filter-bar">
        <input
          className="am-search-input"
          placeholder="Search identifier, class or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="am-filter-select"
          value={filterDomain}
          onChange={(e) => setFilterDomain(e.target.value)}
        >
          {domains.map((d) => (
            <option key={d}>{d === "All" ? "Domain: All" : d}</option>
          ))}
        </select>
        <select
          className="am-filter-select"
          value={filterNation}
          onChange={(e) => setFilterNation(e.target.value)}
        >
          {nations.map((n) => (
            <option key={n}>{n === "All" ? "Nation: All" : n}</option>
          ))}
        </select>
        <span className="am-filter-count">
          {filtered.length} of {simworks.length}
        </span>
      </div>

      <div className="am-table-wrap">
        <table className="am-table">
          <thead>
            <tr>
              <th>Identifier</th>
              <th>Simworks Class</th>
              <th>Category</th>
              <th>Domain</th>
              <th>Nation</th>
              <th>DIS Code</th>
              <th>Capabilities</th>
              <th>Deployable</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--am-text-muted)",
                  }}
                >
                  No entries match the filters.
                </td>
              </tr>
            ) : (
              filtered.map((v) => {
                const domainStr = v.militaryDomain ?? v.disDomainLabel;
                const nationStr = v.nationality ?? v.disCountryLabel;
                const ds = getDomainStyle(domainStr);
                const flag = getNatFlag(nationStr);
                return (
                  <tr key={v.identifier}>
                    <td
                      style={{
                        fontFamily: "monospace",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--am-text)",
                      }}
                    >
                      {v.identifier}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--am-text)" }}>
                      {v.simworksClassLabel ?? v.simworksClass ?? "—"}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {v.assetCategory ?? (
                        <span style={{ color: "var(--am-text-dim)" }}>—</span>
                      )}
                    </td>
                    <td>
                      {domainStr ? (
                        <span
                          className={`am-tag ${ds.cssClass}`}
                          style={{ gap: 4 }}
                        >
                          {ds.icon} {domainStr}
                        </span>
                      ) : (
                        <span className="am-tag domain-unknown">—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {flag && <span className="am-nat-code">{flag}</span>}
                      {nationStr ?? "—"}
                    </td>
                    <td>
                      <DisCodeBadge
                        code={v.disCode}
                        onOpenReference={onOpenDisReference}
                      />
                    </td>
                    <td>{capabilityDots(v)}</td>
                    <td style={{ textAlign: "center", fontSize: 11 }}>
                      {v.isDeployable === true ? (
                        <span style={{ color: "#4ade80", fontWeight: 700 }}>
                          ✓
                        </span>
                      ) : v.isDeployable === false ? (
                        <span style={{ color: "var(--am-text-dim)" }}>—</span>
                      ) : (
                        <span style={{ color: "var(--am-text-dim)" }}>?</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
