import React, { useMemo, useState } from "react";
import type { Vbs4Asset, CanonicalAsset } from "./types.js";
import { getDomainStyle, getNatFlag } from "./icons.js";
import { DisCodeBadge } from "./DisCodeBadge.js";

interface Props {
  vbs4: Vbs4Asset[];
  canonical: CanonicalAsset[];
  isLoading: boolean;
  onSelectAsset: (identifier: string) => void;
  /** Called when a DIS code badge is clicked — opens the DIS Reference view. */
  onOpenDisReference?: (code: string) => void;
}

function linkStatus(
  v: Vbs4Asset,
  canonicalKeys: Set<string>
): "Linked" | "Orphan" | "Partial" {
  if (!v.canonicalAssetKey) return "Orphan";
  if (!canonicalKeys.has(v.canonicalAssetKey)) return "Partial";
  return "Linked";
}

function crewStr(v: Vbs4Asset): string {
  const g = v.gunnerSeatCount ?? 0;
  const c = v.numCargoSeats ?? 0;
  const hasCmd = v.hasCommander;
  if (!hasCmd && g === 0 && c === 0) return "—";
  const cmdSeat = hasCmd ? 1 : 0;
  return `${cmdSeat + g}+${c}`;
}

export const Vbs4CatalogueView: React.FC<Props> = ({
  vbs4,
  canonical,
  isLoading,
  onSelectAsset,
  onOpenDisReference,
}) => {
  const [search, setSearch] = useState("");
  const [filterDomain, setFilterDomain] = useState("All");
  const [filterMapping, setFilterMapping] = useState("All");

  const canonicalKeys = useMemo(
    () => new Set(canonical.map((c) => c.primaryKey)),
    [canonical]
  );

  const domains = useMemo(() => {
    const s = new Set(
      vbs4.map((v) => v.domain ?? v.derivedMilitaryDomain ?? "Unknown")
    );
    return ["All", ...Array.from(s).sort()];
  }, [vbs4]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return vbs4.filter((v) => {
      if (
        q &&
        !v.identifier.toLowerCase().includes(q) &&
        !v.classType?.toLowerCase().includes(q)
      )
        return false;
      const d = v.domain ?? v.derivedMilitaryDomain ?? "Unknown";
      if (filterDomain !== "All" && d !== filterDomain) return false;
      const status = linkStatus(v, canonicalKeys);
      if (filterMapping === "Linked" && status !== "Linked") return false;
      if (filterMapping === "Orphan" && status !== "Orphan") return false;
      return true;
    });
  }, [vbs4, search, filterDomain, filterMapping, canonicalKeys]);

  if (isLoading) {
    return (
      <div className="am-view">
        <div className="am-content-header">
          <span className="am-content-header-icon">▣</span>
          <span className="am-content-header-title">VBS4 catalogue</span>
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
        <span className="am-content-header-icon">▣</span>
        <span className="am-content-header-title">VBS4 catalogue</span>
        <span className="am-content-header-badge">{vbs4.length} entities</span>
      </div>

      <div className="am-filter-bar">
        <input
          className="am-search-input"
          placeholder="Search entity class…"
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
          value={filterMapping}
          onChange={(e) => setFilterMapping(e.target.value)}
        >
          <option value="All">Mapped: All</option>
          <option value="Linked">Linked</option>
          <option value="Orphan">Orphan</option>
        </select>
        <span className="am-filter-count">
          {filtered.length} of {vbs4.length}
        </span>
      </div>

      <div className="am-table-wrap">
        <table className="am-table">
          <thead>
            <tr>
              <th>Entity Class</th>
              <th>Domain</th>
              <th>Nationality</th>
              <th>DIS Code</th>
              <th>Crew</th>
              <th>Drone</th>
              <th>Canonical</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
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
                const status = linkStatus(v, canonicalKeys);
                const domainStr = v.domain ?? v.derivedMilitaryDomain;
                const ds = getDomainStyle(domainStr);
                const flag = getNatFlag(v.nationality);
                return (
                  <tr
                    key={v.identifier}
                    onClick={() => onSelectAsset(v.identifier)}
                    style={{ cursor: "pointer" }}
                  >
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
                      {v.nationality ?? "—"}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <DisCodeBadge
                        code={v.disCode}
                        onOpenReference={onOpenDisReference}
                      />
                    </td>
                    <td style={{ fontSize: 11 }}>{crewStr(v)}</td>
                    <td style={{ textAlign: "center" }}>
                      {v.isDrone ? (
                        <span
                          title="Drone capable"
                          style={{
                            fontFamily: "var(--am-mono)",
                            color: "var(--am-purple)",
                            fontWeight: 700,
                          }}
                        >
                          ◈
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span
                        className={`am-tag ${
                          status === "Linked"
                            ? "mapped"
                            : status === "Orphan"
                            ? "orphan"
                            : "partial"
                        }`}
                      >
                        {status === "Linked"
                          ? "✓ Linked"
                          : status === "Orphan"
                          ? "⚠ Orphan"
                          : "~ Partial"}
                      </span>
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
