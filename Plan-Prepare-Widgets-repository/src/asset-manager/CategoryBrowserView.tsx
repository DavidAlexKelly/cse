import React, { useMemo, useState, useRef, useEffect } from "react";
import type { CanonicalAsset, Vbs4Asset } from "./types.js";
import {
  getDomainStyle,
  getNatFlag,
  getCategoryEmoji,
  getMappingBadge,
} from "./icons.js";

interface Props {
  canonical: CanonicalAsset[];
  vbs4: Vbs4Asset[];
  onSelectAsset: (key: string) => void;
}

// ─── Dropdown ────────────────────────────────────────────────────────────────

interface DropdownProps {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  renderOption?: (opt: string) => React.ReactNode;
}
const Dropdown: React.FC<DropdownProps> = ({
  label,
  value,
  options,
  onChange,
  renderOption,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const isActive = value !== "All";
  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 120 }}>
      <button
        className={`am-cb-dd-btn${isActive ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", fontFamily: "var(--am-font)" }}
      >
        <span className="am-cb-dd-label">{label}</span>
        <span className="am-cb-dd-value">{isActive ? value : "All"}</span>
        <span className="am-cb-dd-chevron">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="am-cat-dropdown" style={{ minWidth: "100%" }}>
          {options.map((opt) => (
            <button
              key={opt}
              className={`am-cat-option${value === opt ? " selected" : ""}`}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                fontFamily: "var(--am-font)",
                border: "none",
                cursor: "pointer",
                background: "none",
              }}
            >
              {renderOption ? renderOption(opt) : opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main view ────────────────────────────────────────────────────────────────

export const CategoryBrowserView: React.FC<Props> = ({
  canonical,
  vbs4,
  onSelectAsset,
}) => {
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("All");
  const [classType, setClassType] = useState("All");
  const [nationality, setNationality] = useState("All");
  const [mappingFilter, setMappingFilter] = useState<
    "All" | "Mapped" | "Unmapped"
  >("All");

  const vbs4ByCanon = useMemo(() => {
    const m = new Map<string, Vbs4Asset[]>();
    for (const v of vbs4) {
      if (!v.canonicalAssetKey) continue;
      if (!m.has(v.canonicalAssetKey)) m.set(v.canonicalAssetKey, []);
      m.get(v.canonicalAssetKey)!.push(v);
    }
    return m;
  }, [vbs4]);

  const domains = useMemo(() => {
    const s = new Set(canonical.map((c) => c.militaryDomain ?? "Unknown"));
    return ["All", ...Array.from(s).sort()];
  }, [canonical]);

  const classTypes = useMemo(() => {
    const base =
      domain === "All"
        ? canonical
        : canonical.filter((c) => (c.militaryDomain ?? "Unknown") === domain);
    const s = new Set(base.map((c) => c.assetCategory ?? "Unknown"));
    return ["All", ...Array.from(s).sort()];
  }, [canonical, domain]);

  const nationalities = useMemo(() => {
    const s = new Set(canonical.map((c) => c.nationality ?? "Unknown"));
    return ["All", ...Array.from(s).sort()];
  }, [canonical]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return canonical.filter((c) => {
      if (domain !== "All" && (c.militaryDomain ?? "Unknown") !== domain)
        return false;
      if (classType !== "All" && (c.assetCategory ?? "Unknown") !== classType)
        return false;
      if (nationality !== "All" && (c.nationality ?? "Unknown") !== nationality)
        return false;
      const entries = vbs4ByCanon.get(c.primaryKey) ?? [];
      const isMapped = entries.length > 0;
      if (mappingFilter === "Mapped" && !isMapped) return false;
      if (mappingFilter === "Unmapped" && isMapped) return false;
      if (q) {
        const name = (c.canonicalName ?? "").toLowerCase();
        const pk = c.primaryKey.toLowerCase();
        const nat = (c.nationality ?? "").toLowerCase();
        const cat = (c.assetCategory ?? "").toLowerCase();
        const vbs4ids = entries
          .map((v) => v.identifier.toLowerCase())
          .join(" ");
        if (
          !name.includes(q) &&
          !pk.includes(q) &&
          !nat.includes(q) &&
          !cat.includes(q) &&
          !vbs4ids.includes(q)
        )
          return false;
      }
      return true;
    });
  }, [
    canonical,
    vbs4ByCanon,
    domain,
    classType,
    nationality,
    mappingFilter,
    search,
  ]);

  const activeFilterCount = [
    domain !== "All",
    classType !== "All",
    nationality !== "All",
    mappingFilter !== "All",
    search.trim() !== "",
  ].filter(Boolean).length;

  return (
    <div className="am-view">
      <div className="am-content-header">
        <span className="am-content-header-icon">▦</span>
        <span className="am-content-header-title">Category browser</span>
        <span className="am-content-header-badge">
          {results.length} of {canonical.length}
        </span>
        <span className="am-content-header-spacer" />
        {activeFilterCount > 0 && (
          <button
            className="am-btn"
            style={{ fontSize: 11 }}
            onClick={() => {
              setDomain("All");
              setClassType("All");
              setNationality("All");
              setMappingFilter("All");
              setSearch("");
            }}
          >
            Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
          </button>
        )}
      </div>

      <div className="am-cat-browser">
        {/* ── Filter bar ── */}
        <div className="am-cb-filters">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              position: "relative",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 10,
                color: "var(--am-text-dim)",
                fontFamily: "var(--am-mono)",
                fontSize: 13,
                pointerEvents: "none",
              }}
            >
              ⌕
            </span>
            <input
              className="am-search-input"
              style={{ paddingLeft: 32 }}
              placeholder="Search name, category, nationality, VBS4 identifier…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{
                  position: "absolute",
                  right: 8,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--am-text-muted)",
                  fontSize: 12,
                  padding: "2px 4px",
                }}
              >
                ✕
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Dropdown
              label="Domain"
              value={domain}
              options={domains}
              onChange={(v) => {
                setDomain(v);
                setClassType("All");
              }}
              renderOption={(opt) => {
                if (opt === "All") return "All domains";
                const ds = getDomainStyle(opt);
                return (
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 7 }}
                  >
                    <span>{ds.emoji}</span>
                    {opt}
                  </span>
                );
              }}
            />
            <Dropdown
              label="Class"
              value={classType}
              options={classTypes}
              onChange={setClassType}
              renderOption={(opt) => {
                if (opt === "All") return "All classes";
                return (
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 7 }}
                  >
                    <span>{getCategoryEmoji(opt)}</span>
                    {opt}
                  </span>
                );
              }}
            />
            <Dropdown
              label="Nationality"
              value={nationality}
              options={nationalities}
              onChange={setNationality}
              renderOption={(opt) => {
                if (opt === "All") return "All nationalities";
                const flag = getNatFlag(opt);
                return (
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 7 }}
                  >
                    {flag && <span>{flag}</span>}
                    {opt}
                  </span>
                );
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "var(--am-text-muted)" }}>
              Show:
            </span>
            {(["All", "Mapped", "Unmapped"] as const).map((opt) => (
              <button
                key={opt}
                className={`am-cb-pill${
                  mappingFilter === opt ? " active" : ""
                }`}
                onClick={() => setMappingFilter(opt)}
              >
                {opt === "Mapped"
                  ? "Mapped"
                  : opt === "Unmapped"
                  ? "Unmapped"
                  : "All"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Results list ── */}
        <div className="am-cat-list">
          {results.length === 0 ? (
            <div className="am-state-center">
              <div className="am-state-icon">⌕</div>
              <div className="am-state-title">No assets match</div>
              <div className="am-state-sub">
                Try adjusting the filters or search term.
              </div>
            </div>
          ) : (
            results.map((c) => {
              const entries = vbs4ByCanon.get(c.primaryKey) ?? [];
              const badge = getMappingBadge(entries.length);
              const ds = getDomainStyle(c.militaryDomain);
              const flag = getNatFlag(c.nationality);
              const catEmoji = getCategoryEmoji(
                c.assetCategory ?? c.canonicalName
              );
              const hasDis = entries.some((v) => v.disCode);
              const hasDrone = entries.some((v) => v.isDrone);
              const crewEntry = entries.find(
                (v) =>
                  v.hasCommander ||
                  (v.gunnerSeatCount ?? 0) > 0 ||
                  (v.numCargoSeats ?? 0) > 0
              );
              const crewStr = crewEntry
                ? [
                    crewEntry.hasCommander ? "Cmdr" : null,
                    (crewEntry.gunnerSeatCount ?? 0) > 0
                      ? `${crewEntry.gunnerSeatCount}× Gnnr`
                      : null,
                    (crewEntry.numCargoSeats ?? 0) > 0
                      ? `${crewEntry.numCargoSeats}× Cargo`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(", ")
                : null;
              const primaryDis = entries.map((v) => v.disCode).find(Boolean);

              return (
                <button
                  key={c.primaryKey}
                  className="am-cb-card"
                  onClick={() => onSelectAsset(c.primaryKey)}
                >
                  <div className={`am-cb-card-strip ${badge.cssClass}`} />
                  <div className="am-cb-card-cat-icon">{catEmoji}</div>
                  <div className="am-cb-card-body">
                    <div className="am-cb-card-top">
                      <span className="am-cb-card-name">
                        {c.canonicalName ?? c.primaryKey}
                      </span>
                      <div className="am-cb-card-badges">
                        {hasDrone && (
                          <span className="am-tag drone" title="Drone capable">
                            ◈ Drone
                          </span>
                        )}
                        <span
                          className={`am-tag ${badge.cssClass}`}
                          style={{ gap: 4 }}
                        >
                          {badge.emoji} {badge.label}
                        </span>
                      </div>
                    </div>
                    <div className="am-cb-card-meta">
                      {c.militaryDomain && (
                        <span
                          className="am-cb-meta-item"
                          style={{ color: ds.color }}
                        >
                          {ds.emoji} {c.militaryDomain}
                        </span>
                      )}
                      {c.assetCategory && (
                        <span className="am-cb-meta-item">
                          {c.assetCategory}
                        </span>
                      )}
                      {c.nationality && (
                        <span className="am-cb-meta-item">
                          {flag && <span className="am-nat-code">{flag}</span>}
                          {c.nationality}
                        </span>
                      )}
                      {c.branch && (
                        <span
                          className="am-cb-meta-item"
                          style={{ color: "var(--am-text-dim)" }}
                        >
                          {c.branch}
                        </span>
                      )}
                    </div>
                    {entries.length > 0 && (
                      <div className="am-cb-card-spec">
                        {primaryDis && (
                          <span className="am-cb-spec-item">
                            <span className="am-cb-spec-key">DIS</span>
                            <code className="am-cb-spec-val">{primaryDis}</code>
                          </span>
                        )}
                        {!hasDis && (
                          <span className="am-cb-spec-item am-cb-spec-warn">
                            ! No DIS code
                          </span>
                        )}
                        {crewStr && (
                          <span className="am-cb-spec-item">
                            <span className="am-cb-spec-key">Crew</span>
                            <span className="am-cb-spec-val">{crewStr}</span>
                          </span>
                        )}
                        {!crewStr && (
                          <span className="am-cb-spec-item am-cb-spec-warn">
                            ! No crew config
                          </span>
                        )}
                        {entries.length > 1 && (
                          <span className="am-cb-spec-item">
                            <span className="am-cb-spec-key">Variants</span>
                            <span className="am-cb-spec-val">
                              {entries.length}
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="am-cb-card-chevron">›</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
