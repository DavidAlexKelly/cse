// ============================================================
//  Asset Manager — MASA Sword Asset Catalogue View
// ============================================================
//
//  Renders all NxgOSwordAssetCatalogue rows in a filterable table.
//  Sword is a constructive simulation (units, not individual entities),
//  so its data model differs from VBS4 / Simworks — the columns here
//  reflect echelon, unit kind, combat efficiency, and equipment.

import React, { useMemo, useState } from "react";
import type { SwordAsset } from "./types.js";
import { getDomainStyle, getNatFlag } from "./icons.js";
import { DisCodeBadge } from "./DisCodeBadge.js";

interface Props {
  sword: SwordAsset[];
  isLoading: boolean;
  /** Called when a DIS code badge is clicked — opens the DIS Reference view. */
  onOpenDisReference?: (code: string) => void;
}

export const SwordCatalogueView: React.FC<Props> = ({
  sword,
  isLoading,
  onOpenDisReference,
}) => {
  const [search, setSearch] = useState("");
  const [filterDomain, setFilterDomain] = useState("All");
  const [filterKind, setFilterKind] = useState("All");
  const [filterNation, setFilterNation] = useState("All");

  const domains = useMemo(() => {
    const s = new Set(sword.map((v) => v.domain ?? "Unknown"));
    return ["All", ...Array.from(s).sort()];
  }, [sword]);

  const kinds = useMemo(() => {
    const s = new Set(sword.map((v) => v.kind ?? "Unknown"));
    return ["All", ...Array.from(s).sort()];
  }, [sword]);

  const nations = useMemo(() => {
    const s = new Set(sword.map((v) => v.country ?? "Unknown"));
    return ["All", ...Array.from(s).sort()];
  }, [sword]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sword.filter((v) => {
      if (
        q &&
        !v.identifier.toLowerCase().includes(q) &&
        !(v.name ?? "").toLowerCase().includes(q) &&
        !(v.displayName ?? "").toLowerCase().includes(q)
      )
        return false;
      if (filterDomain !== "All" && (v.domain ?? "Unknown") !== filterDomain)
        return false;
      if (filterKind !== "All" && (v.kind ?? "Unknown") !== filterKind)
        return false;
      if (filterNation !== "All" && (v.country ?? "Unknown") !== filterNation)
        return false;
      return true;
    });
  }, [sword, search, filterDomain, filterKind, filterNation]);

  if (isLoading) {
    return (
      <div className="am-view">
        <div className="am-content-header">
          <span className="am-content-header-icon">⚔</span>
          <span className="am-content-header-title">MASA Sword catalogue</span>
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
        <span className="am-content-header-icon">⚔</span>
        <span className="am-content-header-title">MASA Sword catalogue</span>
        <span className="am-content-header-badge">
          {sword.length} unit templates
        </span>
        <span className="am-content-header-spacer" />
        <span className="am-content-header-meta">
          Aggregated constructive simulation
        </span>
      </div>

      <div className="am-filter-bar">
        <input
          className="am-search-input"
          placeholder="Search identifier or unit name…"
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
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value)}
        >
          {kinds.map((k) => (
            <option key={k}>{k === "All" ? "Kind: All" : k}</option>
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
          {filtered.length} of {sword.length}
        </span>
      </div>

      <div className="am-table-wrap">
        <table className="am-table">
          <thead>
            <tr>
              <th>Identifier</th>
              <th>Name</th>
              <th>Kind</th>
              <th>Echelon</th>
              <th>Domain</th>
              <th>Country</th>
              <th>DIS Code</th>
              <th>Combat Eff.</th>
              <th>Major Equipment</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
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
                const domainStr = v.domain;
                const ds = getDomainStyle(domainStr);
                const flag = getNatFlag(v.country);
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
                      {v.displayName ?? v.name ?? "—"}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {v.kind ?? (
                        <span style={{ color: "var(--am-text-dim)" }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {v.echelonLevel ?? v.level ?? (
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
                      {v.country ?? "—"}
                    </td>
                    <td>
                      <DisCodeBadge
                        code={v.disCode ?? v.dis6code}
                        onOpenReference={onOpenDisReference}
                      />
                    </td>
                    <td style={{ fontSize: 12, color: "var(--am-text-muted)" }}>
                      {v.combatEfficiency ?? "—"}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {v.majorEquipmentType ? (
                        <>
                          {v.majorEquipmentType}
                          {v.majorEquipmentCount && (
                            <span
                              style={{
                                color: "var(--am-text-dim)",
                                marginLeft: 6,
                              }}
                            >
                              ×{v.majorEquipmentCount}
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "var(--am-text-dim)" }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--am-text-muted)" }}>
                      {v.isGroup ? (
                        <span
                          className="am-tag mapped"
                          style={{
                            background: "rgba(76,144,240,0.15)",
                            color: "var(--am-accent)",
                          }}
                        >
                          Group
                        </span>
                      ) : (
                        <span className="am-tag neutral">Unit</span>
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
