// ============================================================
//  Layer View Panels — Platforms & Weapons overlay
//  Used in GroupBuilderPanel (layer mode) and ForceSummaryPanel
// ============================================================

import React, { useMemo, useState } from "react";
import type { UnitNode } from "./types.js";
import { ECHELON_LABELS } from "./types.js";
import {
  unitToDisplay,
  buildWeaponTree,
  aggregateWeaponsForGroup,
  buildPlatformTree,
  getPlatformColor,
} from "./treeUtils.js";
import type { DisplayNode, WeaponTreeEntry, AggregatedWeapon, PlatformTreeNode } from "./treeUtils.js";

// Re-export type for consumers that import it from this module
export type { DisplayNode };

// ─── Shared Stat box ───────────────────────────────────────────────────────
const Stat: React.FC<{ val: string | number; label: string; color?: string }> = ({
  val, label, color = "#fb923c",
}) => (
  <div style={{
    flex: 1, textAlign: "center", padding: "6px",
    background: `${color}12`, border: `1px solid ${color}33`, borderRadius: 2,
  }}>
    <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
    <div style={{ fontSize: 9, color: "var(--mil-text-2)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>
      {label}
    </div>
  </div>
);

// ─── Echelon helpers ─────────────────────────────────────────────────────
const ECHELON_MARK: Record<string, string> = {
  team: "Ø", squad: "•", section: "••", platoon: "•••",
  company: "|", battalion: "||", regiment: "|||",
  brigade: "X", division: "XX", corps: "XXX",
};
function echelonColor(echelon?: string): string {
  if (!echelon) return "var(--mil-text-2)";
  if (["team","squad","section","platoon"].includes(echelon)) return "var(--mil-cyan-lt)";
  if (["company","battalion","regiment"].includes(echelon)) return "var(--mil-olive-lt)";
  return "var(--mil-amber)";
}

// ─── Platform Hierarchy Row ───────────────────────────────────────────────
const PlatformTreeRow: React.FC<{
  node: PlatformTreeNode;
  defaultOpen?: boolean;
  onSelectUnit?: (unit: UnitNode) => void;
}> = ({ node, defaultOpen, onSelectUnit }) => {
  const [open, setOpen] = useState(defaultOpen !== undefined ? defaultOpen : false);
  const hasChildren = node.children.length > 0;
  const indent = node.depth * 16;

  const borderLeft = node.kind === "platform"
    ? `3px solid ${node.color}`
    : node.kind === "section"
    ? `3px solid ${node.color}`
    : node.kind === "assigned-unit"
    ? "3px solid rgba(34,168,192,0.5)"
    : "3px solid transparent";

  const bg = node.kind === "platform"
    ? `${node.color}0d`
    : node.kind === "section"
    ? "rgba(255,255,255,0.02)"
    : "transparent";

  const labelColor = node.kind === "platform"
    ? node.color
    : node.kind === "section"
    ? "var(--mil-text-2)"
    : node.kind === "assigned-unit"
    ? "var(--mil-cyan-lt)"
    : "var(--mil-text)";

  const isClickable = !!onSelectUnit && (node.kind === "unit" || node.kind === "assigned-unit") && !!node.unit;

  return (
    <div>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        onClick={() => { if (isClickable && node.unit) onSelectUnit!(node.unit); }}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          paddingLeft: 8 + indent, paddingRight: 8,
          paddingTop: node.kind === "unit" ? 6 : 4,
          paddingBottom: node.kind === "unit" ? 6 : 4,
          background: bg, borderLeft,
          borderBottom: "1px solid var(--mil-border)",
          cursor: isClickable ? "pointer" : "default",
          transition: "background 0.1s",
        }}
        onMouseEnter={e => { if (isClickable) (e.currentTarget as HTMLDivElement).style.background = "var(--mil-surface)"; }}
        onMouseLeave={e => { if (isClickable) (e.currentTarget as HTMLDivElement).style.background = bg; }}
      >
        <button
          onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
          disabled={!hasChildren}
          style={{
            background: "none", border: "none",
            cursor: hasChildren ? "pointer" : "default",
            color: hasChildren ? "var(--mil-text-2)" : "transparent",
            fontSize: 9, padding: "1px", flexShrink: 0, width: 12,
          }}
        >
          {hasChildren ? (open ? "▼" : "▶") : " "}
        </button>

        <span style={{ fontSize: node.kind === "platform" ? 16 : 13, flexShrink: 0, lineHeight: 1 }}>
          {node.icon}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            <span style={{
              fontSize: node.kind === "unit" ? 12 : 11,
              fontWeight: node.kind === "unit" || node.kind === "platform" ? 700 : 400,
              color: labelColor,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {node.label}
            </span>

            {(node.kind === "unit" || node.kind === "assigned-unit") && node.sublabel && (
              <span style={{
                fontSize: 9, fontFamily: "monospace", fontWeight: 700,
                padding: "1px 5px", borderRadius: 2,
                background: "var(--mil-surface)", border: "1px solid var(--mil-border-lt)",
                color: echelonColor(node.sublabel), flexShrink: 0,
              }}>
                {ECHELON_MARK[node.sublabel] ?? ""} {(ECHELON_LABELS as Record<string, string>)[node.sublabel] ?? node.sublabel}
              </span>
            )}

            {node.kind === "section" && node.sublabel && (
              <span style={{ fontSize: 9, color: "var(--mil-muted)", fontStyle: "italic" }}>{node.sublabel}</span>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 1, flexWrap: "wrap" }}>
            {node.pax > 0 && (
              <span style={{ fontSize: 9, color: "var(--mil-text-2)", fontVariantNumeric: "tabular-nums" }}>
                {node.pax} pax
              </span>
            )}
            {node.totalPax !== node.pax && node.totalPax > 0 && (
              <span style={{ fontSize: 9, padding: "0 4px", borderRadius: 2, background: "var(--mil-cyan-dim)", color: "var(--mil-cyan-lt)", border: "1px solid rgba(34,168,192,0.3)", fontVariantNumeric: "tabular-nums" }}>
                Σ{node.totalPax.toLocaleString()}
              </span>
            )}
            {node.status && node.status !== "active" && (
              <span style={{
                fontSize: 8, padding: "0 4px", borderRadius: 2, textTransform: "uppercase",
                background: node.status === "destroyed" ? "rgba(239, 77, 77,0.2)" : "rgba(240, 168, 60,0.2)",
                color: node.status === "destroyed" ? "#f87171" : "#fcd34d",
              }}>{node.status}</span>
            )}
            {node.kind === "platform" && node.weapons && node.weapons.length > 0 && (
              <span style={{ fontSize: 9, padding: "0 5px", borderRadius: 2, background: "rgba(248,113,113,0.12)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}>
                ⚔ {node.weapons.reduce((s, w) => s + w.quantity, 0)} weapons
              </span>
            )}
          </div>
        </div>
      </div>

      {open && hasChildren && node.children.map((child, i) => (
        <PlatformTreeRow
          key={`${child.id}-${i}`}
          node={child}
          defaultOpen={false}
          onSelectUnit={onSelectUnit}
        />
      ))}
    </div>
  );
};

// ─── Legacy flat platform list (used in "Platforms Only" mode) ─────────────
const LegacyPlatformRow: React.FC<{
  displayNode: DisplayNode;
  depth: number;
  onSelectNode?: (n: DisplayNode) => void;
}> = ({ displayNode: n, depth, onSelectNode }) => {
  const [open, setOpen] = useState(false);
  const hasChildren = n.children.length > 0;
  const pColor = n.asset ? getPlatformColor(n.asset.presetId) : n.color;
  const bgColor = n.kind === "asset" ? `${pColor}0d` : "transparent";
  const borderLeft = n.kind === "asset"
    ? `2px solid ${pColor}`
    : n.kind === "section" ? `2px solid ${n.color}55` : "2px solid transparent";

  return (
    <div>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        onClick={() => onSelectNode?.(n)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          paddingLeft: 8 + depth * 14, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
          background: bgColor, borderLeft,
          cursor: onSelectNode ? "pointer" : "default",
          borderBottom: "1px solid var(--mil-border)", transition: "background 0.1s",
        }}
      >
        {hasChildren ? (
          <button onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--mil-text-2)", fontSize: 9, width: 12 }}>
            {open ? "▼" : "▶"}
          </button>
        ) : <span style={{ width: 12 }} />}
        <span style={{ fontSize: 14 }}>{n.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: n.kind === "unit" ? 600 : 400, color: n.kind === "unit" ? "var(--mil-text)" : n.kind === "asset" ? pColor : "var(--mil-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {n.label}
          </div>
          {n.sublabel && <div style={{ fontSize: 9, color: "var(--mil-muted)" }}>{n.sublabel}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {n.pax > 0 && <span style={{ fontSize: 9, color: "var(--mil-text-2)", fontVariantNumeric: "tabular-nums" }}>{n.pax} pax</span>}
          {n.totalPax !== n.pax && n.totalPax > 0 && (
            <span style={{ fontSize: 9, padding: "0 4px", borderRadius: 2, background: "var(--mil-cyan-dim)", color: "var(--mil-cyan-lt)", border: "1px solid rgba(34,168,192,0.3)" }}>
              Σ{n.totalPax}
            </span>
          )}
        </div>
      </div>
      {open && hasChildren && n.children.map(child => (
        <LegacyPlatformRow key={child.id} displayNode={child} depth={depth + 1} onSelectNode={onSelectNode} />
      ))}
    </div>
  );
};

// ─── PLATFORMS LAYER PANEL ────────────────────────────────────────────────
export const PlatformsLayerPanel: React.FC<{
  units: UnitNode[];
  onSelectNode?: (n: DisplayNode) => void;
  onSelectUnit?: (unit: UnitNode) => void;
}> = ({ units, onSelectNode, onSelectUnit }) => {
  const [viewMode, setViewMode] = useState<"hierarchy" | "list">("hierarchy");

  const platformTree = useMemo(() => buildPlatformTree(units), [units]);
  const displayNodes = useMemo(() => units.map(u => unitToDisplay(u, units)), [units]);

  const allFlat = useMemo(() => {
    const result: UnitNode[] = [];
    const q = [...units];
    while (q.length) { const n = q.shift()!; result.push(n); q.push(...n.children); }
    return result;
  }, [units]);

  const totalPlatforms = allFlat.reduce((s, u) => s + u.assets.length, 0);
  const totalCrewPax   = allFlat.reduce((s, u) => s + u.assets.reduce((a, x) => a + x.crewCount, 0), 0);
  const unitsWithPlat  = allFlat.filter(u => u.assets.length > 0).length;
  const totalPlatWpn   = allFlat.reduce((s, u) => s + u.assets.reduce((a, x) => a + x.weapons.length, 0), 0);

  if (units.length === 0) {
    return <div className="mil-empty"><div style={{ fontSize: 28, opacity: 0.3 }}>🚁</div><div className="mil-empty__text">No units</div></div>;
  }

  const handleSelectUnit = (unit: UnitNode) => {
    if (onSelectUnit) { onSelectUnit(unit); return; }
    if (onSelectNode) {
      const dn = displayNodes.find(d => d.id === unit.id);
      if (dn) onSelectNode(dn);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "10px 12px 8px", flexShrink: 0, borderBottom: "1px solid var(--mil-border)" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <Stat val={totalPlatforms} label="Platforms" />
          <Stat val={totalCrewPax.toLocaleString()} label="Crew Pax" />
          <Stat val={unitsWithPlat} label="Units w/ Platforms" />
          {totalPlatWpn > 0 && <Stat val={totalPlatWpn} label="Wpn Types" color="#f87171" />}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["hierarchy", "list"] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)} style={{
              padding: "3px 10px", borderRadius: 2, cursor: "pointer",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
              background: viewMode === m ? "rgba(251,146,60,0.15)" : "var(--mil-surface)",
              border: `1px solid ${viewMode === m ? "#fb923c" : "var(--mil-border-lt)"}`,
              color: viewMode === m ? "#fb923c" : "var(--mil-text-2)",
            }}>
              {m === "hierarchy" ? "⎇ Unit Hierarchy" : "≡ Platforms Only"}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "hierarchy" && (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div style={{ display: "flex", gap: 12, padding: "4px 10px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--mil-muted)", background: "var(--mil-bg-2)", borderBottom: "1px solid var(--mil-border)" }}>
            <span style={{ flex: 1 }}>Unit / Platform / Section / Assigned unit</span>
            <span>pax</span>
            <span>Σ total</span>
          </div>
          {platformTree.map(node => (
            <PlatformTreeRow key={node.id} node={node} defaultOpen={false} onSelectUnit={handleSelectUnit} />
          ))}
        </div>
      )}

      {viewMode === "list" && (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "8px" }}>
          {totalPlatforms === 0 ? (
            <div style={{ fontSize: 11, color: "var(--mil-muted)", fontStyle: "italic", textAlign: "center", padding: "24px 16px" }}>
              No platforms assigned yet. Open a unit&apos;s detail panel and add platforms in the Platforms tab.
            </div>
          ) : (
            displayNodes.filter(n => n.children.some(c => c.kind === "asset")).map(dn => (
              <div key={dn.id} style={{ marginBottom: 6, border: "1px solid var(--mil-border)", borderRadius: 2, overflow: "hidden" }}>
                <LegacyPlatformRow displayNode={dn} depth={0} onSelectNode={onSelectNode} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ─── WEAPONS LAYER ─────────────────────────────────────────────────────────
const WeaponChips: React.FC<{ weapons: AggregatedWeapon[]; compact?: boolean }> = ({ weapons, compact }) => {
  if (weapons.length === 0) return null;
  const show = compact ? weapons.slice(0, 3) : weapons;
  const extra = compact ? Math.max(0, weapons.length - 3) : 0;
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 3 }}>
      {show.map(w => (
        <span key={w.key} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 2, background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {w.totalQuantity.toLocaleString()}× {w.name}{w.calibre ? ` (${w.calibre})` : ""}
          {w.totalRounds > 0 && <span style={{ opacity: 0.7 }}> · {w.totalRounds.toLocaleString()} rnds</span>}
        </span>
      ))}
      {extra > 0 && <span style={{ fontSize: 9, color: "var(--mil-muted)", padding: "1px 4px" }}>+{extra} more</span>}
    </div>
  );
};

const WeaponTreeRow: React.FC<{ entry: WeaponTreeEntry }> = ({ entry }) => {
  const [open, setOpen] = useState(false);
  const hasChildren = entry.children.length > 0;
  const isPlatform = entry.sourceKind === "platform";
  const indent = entry.depth * 18;
  const ownQty = entry.weapons.reduce((s, w) => s + w.quantity, 0);
  const totalQty = entry.aggregated.reduce((s, a) => s + a.totalQuantity, 0);
  const hasOwnWeapons = entry.weapons.length > 0;
  const ownAgg = entry.aggregated.filter(a => entry.weapons.some(w => `${w.name}||${w.calibre ?? ""}` === a.key));
  const childOnlyAgg = entry.aggregated.filter(a => !entry.weapons.some(w => `${w.name}||${w.calibre ?? ""}` === a.key));

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 6,
        paddingLeft: 8 + indent, paddingRight: 8, paddingTop: 6, paddingBottom: 6,
        borderBottom: "1px solid var(--mil-border)",
        background: isPlatform ? "rgba(251,146,60,0.04)" : "transparent",
        borderLeft: isPlatform ? "3px solid #fb923c" : hasOwnWeapons ? "3px solid #f87171" : "3px solid var(--mil-border)",
      }}>
        <button onClick={() => setOpen(o => !o)} disabled={!hasChildren}
          style={{ background: "none", border: "none", cursor: hasChildren ? "pointer" : "default", color: hasChildren ? "var(--mil-text-2)" : "transparent", fontSize: 9, padding: "2px", flexShrink: 0, marginTop: 2 }}>
          {hasChildren ? (open ? "▼" : "▶") : "·"}
        </button>
        <span style={{ fontSize: isPlatform ? 16 : 13, flexShrink: 0, marginTop: 1 }}>{entry.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: entry.depth === 0 ? 700 : 500, color: isPlatform ? "#fb923c" : "var(--mil-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.sourceName}
            </span>
            {!isPlatform && entry.echelon && (
              <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: "var(--mil-surface)", border: "1px solid var(--mil-border-lt)", color: echelonColor(entry.echelon), flexShrink: 0 }}>
                {ECHELON_MARK[entry.echelon] ?? ""} {(ECHELON_LABELS as Record<string, string>)[entry.echelon] ?? entry.echelon}
              </span>
            )}
            {hasOwnWeapons && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 2, background: "rgba(248,113,113,0.18)", color: "#f87171", border: "1px solid rgba(248,113,113,0.35)", flexShrink: 0 }}>⚔ {ownQty.toLocaleString()} own</span>}
            {hasChildren && totalQty > 0 && totalQty !== ownQty && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 2, background: "rgba(248,113,113,0.08)", color: "#f87171", border: "1px solid rgba(248,113,113,0.2)", flexShrink: 0 }}>Σ {totalQty.toLocaleString()}</span>}
          </div>
          {hasOwnWeapons && <WeaponChips weapons={ownAgg} compact={entry.depth > 0} />}
          {!open && hasChildren && <WeaponChips weapons={childOnlyAgg} compact />}
        </div>
      </div>
      {open && hasChildren && entry.children.map(child => <WeaponTreeRow key={child.sourceId} entry={child} />)}
    </div>
  );
};

type WeaponViewMode = "tree" | "summary";

export const WeaponsLayerPanel: React.FC<{
  units: UnitNode[];
  onSelectNode?: (n: DisplayNode) => void;
}> = ({ units }) => {
  const [viewMode, setViewMode] = useState<WeaponViewMode>("tree");
  const [sortAsc, setSortAsc] = useState(false);

  const weaponTree    = useMemo(() => buildWeaponTree(units), [units]);
  const allAggregated = useMemo(() => aggregateWeaponsForGroup(units), [units]);
  const sortedSummary = useMemo(
    () => [...allAggregated].sort((a, b) => sortAsc ? a.totalQuantity - b.totalQuantity : b.totalQuantity - a.totalQuantity),
    [allAggregated, sortAsc],
  );

  const totalTypes  = allAggregated.length;
  const totalQty    = allAggregated.reduce((s, a) => s + a.totalQuantity, 0);
  const totalRounds = allAggregated.reduce((s, a) => s + a.totalRounds, 0);

  if (weaponTree.length === 0) {
    return (
      <div className="mil-empty" style={{ padding: 40 }}>
        <div style={{ fontSize: 28, opacity: 0.3 }}>⚔</div>
        <div className="mil-empty__text">No weapons assigned</div>
        <div style={{ fontSize: 11, color: "var(--mil-muted)", maxWidth: 220, textAlign: "center", lineHeight: 1.5 }}>
          Use the <strong>Weapons</strong> tab for carried small arms and the <strong>Platforms</strong> tab for vehicle armaments.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "10px 12px 8px", flexShrink: 0, borderBottom: "1px solid var(--mil-border)" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <Stat val={totalTypes} label="Weapon Types" color="#f87171" />
          <Stat val={totalQty.toLocaleString()} label="Total Weapons" color="#f87171" />
          <Stat val={totalRounds > 0 ? totalRounds.toLocaleString() : "—"} label="Total Rounds" color="#f87171" />
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["tree", "summary"] as WeaponViewMode[]).map(m => (
            <button key={m} onClick={() => setViewMode(m)} style={{
              padding: "3px 10px", borderRadius: 2, cursor: "pointer",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
              background: viewMode === m ? "rgba(248,113,113,0.15)" : "var(--mil-surface)",
              border: `1px solid ${viewMode === m ? "#f87171" : "var(--mil-border-lt)"}`,
              color: viewMode === m ? "#f87171" : "var(--mil-text-2)",
            }}>{m === "tree" ? "⎇ By Unit" : "≡ Summary"}</button>
          ))}
        </div>
      </div>

      {viewMode === "tree" && (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 10px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--mil-muted)", background: "var(--mil-bg-2)", borderBottom: "1px solid var(--mil-border)" }}>
            <span style={{ flex: 1 }}>Unit / Platform (command hierarchy)</span>
            <span style={{ color: "#f87171" }}>⚔ own</span>
            <span>Σ subtotal</span>
          </div>
          {weaponTree.map(entry => <WeaponTreeRow key={entry.sourceId} entry={entry} />)}
        </div>
      )}

      {viewMode === "summary" && (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr>
                {[
                  { label: "Weapon system", w: undefined, align: "left" as const },
                  { label: "Calibre", w: 100, align: "left" as const },
                  { label: "Total qty", w: 90, align: "right" as const, sortable: true },
                  { label: "Total rounds", w: 90, align: "right" as const },
                ].map(col => (
                  <th key={col.label} style={{ padding: "5px 10px", textAlign: col.align, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--mil-muted)", background: "var(--mil-bg-2)", borderBottom: "1px solid var(--mil-border)", whiteSpace: "nowrap", width: col.w }}>
                    {col.label}
                    {col.sortable && <button onClick={() => setSortAsc(a => !a)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--mil-text-2)", fontSize: 9, marginLeft: 4, padding: 0 }}>{sortAsc ? "↑" : "↓"}</button>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedSummary.map((row, i) => (
                <tr key={row.key} style={{ background: i % 2 === 0 ? "var(--mil-bg)" : "var(--mil-bg-2)" }}>
                  <td style={{ padding: "6px 10px", color: "var(--mil-text)", fontWeight: 600 }}><span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: "#f87171", fontSize: 12 }}>⚔</span>{row.name}</span></td>
                  <td style={{ padding: "6px 10px", color: "var(--mil-text-2)", fontSize: 10 }}>{row.calibre ?? <span style={{ color: "var(--mil-muted)" }}>—</span>}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right", color: "#f87171", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{row.totalQuantity.toLocaleString()}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right", color: "var(--mil-text-2)", fontVariantNumeric: "tabular-nums" }}>{row.totalRounds > 0 ? row.totalRounds.toLocaleString() : <span style={{ color: "var(--mil-muted)" }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
