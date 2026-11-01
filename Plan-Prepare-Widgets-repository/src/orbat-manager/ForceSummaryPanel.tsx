// ============================================================
//  Force Summary Panel — aggregated stats, compact + detailed views
// ============================================================

import React, { useState } from "react";
import type { Side, UnitNode } from "./types.js";
import { ECHELON_LABELS, IDENTITY_LABELS } from "./types.js";
import { flattenTree, countPersonnel } from "./treeUtils.js";
import { NatoSymbol } from "./NatoSymbol.js";
import { PlatformsLayerPanel, WeaponsLayerPanel } from "./LayerPanels.js";

const ECHELON_MARKS: Record<string, string> = {
  team: "Ø", squad: "•", section: "••", platoon: "•••",
  company: "|", battalion: "||", regiment: "|||",
  brigade: "X", division: "XX", corps: "XXX",
};

type ViewMode = "units" | "platforms" | "weapons";

interface ForceSummaryPanelProps {
  sides: Side[];
  onSelectUnit: (unit: UnitNode, side: Side) => void;
}

const CE_BG: Record<string, string> = {
  FO: "rgba(36, 180, 126,0.3)", SO: "rgba(36, 180, 126,0.2)",
  MO: "rgba(240, 168, 60,0.3)", NO: "rgba(239, 77, 77,0.3)",
  UNK: "rgba(106, 114, 146,0.25)",
};
const CE_FG: Record<string, string> = {
  FO: "#4ade80", SO: "#4ade80", MO: "#f0a83c", NO: "#f87171", UNK: "#98a1c0",
};

export const ForceSummaryPanel: React.FC<ForceSummaryPanelProps> = ({ sides, onSelectUnit }) => {
  const [viewMode, setViewMode] = useState<ViewMode>("units");
  const [search, setSearch] = useState("");
  const [filterEchelon, setFilterEchelon] = useState("");

  const allUnits: UnitNode[] = sides.flatMap(s => s.groups.flatMap(g => flattenTree(g.units)));
  const totalPax    = sides.reduce((a, s) => a + s.groups.reduce((b, g) => b + countPersonnel(g.units), 0), 0);
  const totalGroups = sides.reduce((a, s) => a + s.groups.length, 0);
  const totalPlat   = allUnits.reduce((a, u) => a + u.assets.length, 0);
  const totalWeap   = allUnits.reduce((a, u) => a + u.weapons.length + u.assets.reduce((b, x) => b + x.weapons.length, 0), 0);
  const allGroupUnits = sides.flatMap(s => s.groups.flatMap(g => g.units));

  return (
    <div className="orbat-panel">
      {/* Stats bar */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        background: "var(--mil-navy)", borderBottom: "1px solid var(--mil-border)", flexShrink: 0,
      }}>
        {[
          { val: sides.length,  label: "SIDES" },
          { val: totalGroups,   label: "GROUPS" },
          { val: allUnits.length, label: "UNITS" },
          { val: totalPax.toLocaleString(), label: "PAX" },
        ].map(({ val, label }) => (
          <div key={label} style={{ textAlign: "center", padding: "8px 0", borderRight: "1px solid var(--mil-border)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--mil-cyan-lt)", lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 9, color: "var(--mil-muted)", letterSpacing: "0.1em", marginTop: 1 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* View mode tabs */}
      <div style={{ display: "flex", background: "var(--mil-bg)", borderBottom: "1px solid var(--mil-border)", flexShrink: 0 }}>
        {([
          { id: "units",     label: "UNITS",        extra: null },
          { id: "platforms", label: "🚁 PLATFORMS", extra: totalPlat > 0 ? String(totalPlat) : null },
          { id: "weapons",   label: "⚔ WEAPONS",   extra: totalWeap > 0 ? String(totalWeap) : null },
        ] as { id: ViewMode; label: string; extra: string | null }[]).map(({ id, label, extra }) => (
          <button key={id} onClick={() => setViewMode(id)}
            style={{
              flex: 1, padding: "7px 4px", background: "none", border: "none", cursor: "pointer",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
              color: viewMode === id ? "var(--mil-text)" : "var(--mil-muted)",
              borderBottom: viewMode === id ? "2px solid var(--mil-olive)" : "2px solid transparent",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            }}>
            {label}
            {extra && (
              <span style={{
                fontSize: 9, padding: "0 5px", borderRadius: 8,
                background: "var(--mil-olive-mut)", color: "#4ade80",
              }}>{extra}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── PLATFORMS VIEW ── */}
      {viewMode === "platforms" && (
        <div className="orbat-panel__content" style={{ padding: 0 }}>
          {sides.length === 0 ? (
            <div className="mil-empty"><div className="mil-empty__text">No force data</div></div>
          ) : (
            <PlatformsLayerPanel
              units={allGroupUnits}
              onSelectUnit={unit => {
                  const side = sides.find(s => s.groups.some(g =>
                  flattenTree(g.units).some(u => u.id === unit.id)
                  ));
                if (side) onSelectUnit(unit, side);
              }}
              onSelectNode={dn => {
                if (dn.unit) {
                  const side = sides.find(s => s.groups.some(g =>
                    flattenTree(g.units).some(u => u.id === dn.unit!.id)
                  ));
                  if (side) onSelectUnit(dn.unit, side);
                }
              }}
            />
          )}
        </div>
      )}

      {/* ── WEAPONS VIEW ── */}
      {viewMode === "weapons" && (
        <div className="orbat-panel__content" style={{ padding: 0 }}>
          {sides.length === 0
            ? <div className="mil-empty"><div className="mil-empty__text">No force data</div></div>
            : <WeaponsLayerPanel units={allGroupUnits} />
          }
        </div>
      )}

      {/* ── UNITS VIEW ── */}
      {viewMode === "units" && (
        <>
          <div style={{
            padding: "6px 8px", borderBottom: "1px solid var(--mil-border)",
            display: "flex", flexDirection: "column", gap: 5, flexShrink: 0,
          }}>
            <input
              className="mel-input"
              placeholder="Search units..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: "4px 8px", fontSize: 11 }}
            />
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {["battalion", "company", "platoon", "section"].map(e => (
                <button key={e}
                  onClick={() => setFilterEchelon(filterEchelon === e ? "" : e)}
                  style={{
                    padding: "2px 8px", borderRadius: 2, cursor: "pointer", fontSize: 10,
                    fontFamily: "monospace", fontWeight: 700,
                    background: filterEchelon === e ? "var(--mil-cyan-dim)" : "var(--mil-surface)",
                    border: `1px solid ${filterEchelon === e ? "var(--mil-cyan)" : "var(--mil-border-lt)"}`,
                    color: filterEchelon === e ? "var(--mil-cyan-lt)" : "var(--mil-text-2)",
                  }}>
                  {ECHELON_MARKS[e] ?? ""} {ECHELON_LABELS[e as keyof typeof ECHELON_LABELS] ?? e}
                </button>
              ))}
          </div>
                  </div>

          <div className="orbat-panel__content">
            {sides.length === 0 ? (
              <div className="mil-empty">
                <div className="mil-empty__text">No force data</div>
                <div style={{ fontSize: 11, color: "var(--mil-muted)" }}>Add sides to see the summary.</div>
              </div>
            ) : (
              sides.map(side => {
                const sidePax   = side.groups.reduce((a, g) => a + countPersonnel(g.units), 0);
                const sideUnits = side.groups.flatMap(g => flattenTree(g.units));
                const sidePlat  = sideUnits.reduce((a, u) => a + u.assets.length, 0);

                return (
                  <div key={side.id} style={{ marginBottom: 14 }}>
                    {/* Side row */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                      background: "var(--mil-bg-3)", border: "1px solid var(--mil-border)",
                      borderRadius: 2, marginBottom: 3,
                    }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: side.colour || "var(--mil-red)" }} />
                      <span style={{ flex: 1, fontWeight: 700, fontSize: 13, color: "var(--mil-text)" }}>{side.name}</span>
                      <span style={{ fontSize: 10, color: "var(--mil-text-2)" }}>{IDENTITY_LABELS[side.standardIdentity]}</span>
                      {sidePlat > 0 && (
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 2,
                          background: "var(--mil-amber-mut)", color: "var(--mil-amber)",
                          border: "1px solid rgba(240, 168, 60,0.3)",
                        }}>
                          🚁 {sidePlat}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: "var(--mil-cyan-lt)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {sidePax.toLocaleString()} pax
                      </span>
                    </div>

                    {/* Units */}
                    {side.groups.map(group =>
                      flattenTree(group.units)
                        .filter(u => {
                          if (search && !u.name.toLowerCase().includes(search.toLowerCase())) return false;
                          if (filterEchelon && u.echelon !== filterEchelon) return false;
                          return true;
                        })
                        .map(unit => {
                          const ce     = unit.capabilities.combatEffectiveness;
                          const isTop  = group.units.some(u => u.id === unit.id);
                          const hasPlat = unit.assets.length > 0;

                          return (
                            <div key={unit.id}
                              role="button" tabIndex={0}
                              onClick={() => onSelectUnit(unit, side)}
                              onKeyDown={e => { if (e.key === "Enter") onSelectUnit(unit, side); }}
                              style={{
                                display: "flex", alignItems: "center", gap: 8,
                                padding: `4px 8px 4px ${isTop ? 8 : 24}px`,
                                cursor: "pointer", borderBottom: "1px solid var(--mil-border)",
                                transition: "background 0.1s",
                              }}
                              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--mil-bg-3)"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                            >
                              <NatoSymbol
                                standardIdentity={side.standardIdentity}
                                echelon={unit.echelon} icon={unit.symbol.icon}
                                hq={unit.symbol.hqIndicator} size={26}
                                style={{ flexShrink: 0 }}
                              />
                              <span style={{ flex: 1, fontSize: 12, fontWeight: isTop ? 600 : 400, color: "var(--mil-text)" }}>
                                {unit.name}
                              </span>
                              {hasPlat && (
                                <span style={{
                                  fontSize: 9, padding: "0 5px", borderRadius: 2,
                                  background: "var(--mil-amber-mut)", color: "var(--mil-amber)",
                                  border: "1px solid rgba(240, 168, 60,0.25)",
                                }}>
                                  🚁 {unit.assets.length}
                                </span>
                              )}
                              {unit.weapons.length > 0 && (
                                <span style={{
                                  fontSize: 9, padding: "0 5px", borderRadius: 2,
                                  background: "var(--mil-red-mut)", color: "#f87171",
                                  border: "1px solid rgba(248,113,113,0.25)",
                                }}>
                                  ⚔ {unit.weapons.length}
                                </span>
                              )}
                              {ce && (
                                <span style={{
                                  fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2,
                                  background: CE_BG[ce] ?? "transparent", color: CE_FG[ce] ?? "var(--mil-text-2)",
                                }}>
                                  {ce}
                                </span>
                              )}
                              <span style={{
                                fontSize: 11, color: "var(--mil-cyan-lt)",
                                fontVariantNumeric: "tabular-nums", fontWeight: 600,
                                minWidth: 36, textAlign: "right",
                              }}>
                                {unit.personnelCount}
                              </span>
                              <span style={{
                                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                                background: unit.state.status === "active"    ? "#4ade80"
                                  : unit.state.status === "reserve"  ? "var(--mil-amber)"
                                  : unit.state.status === "destroyed" ? "#f87171"
                                  : "var(--mil-muted)",
                              }} />
                            </div>
                          );
                        })
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
};

