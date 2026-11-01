// ============================================================
//  PlatformInlineView — compact in-line display of a unit's
//  platform assignments and owned platforms, shown in the list
//  row expansion and tree card expansion.
//  Also hosts the editable AssetEditor for the owning unit.
// ============================================================

import React, { useState } from "react";
import type { UnitNode, AssetNode, AssetSection } from "./types.js";
import { findPlatformAssignments, flattenSections, toggleUnitInAsset, mkId } from "./platformContext.js";

// ── Category icon/colour helpers ──────────────────────────────────────────────
function platformIcon(presetId: string): string {
  const c = presetId.toLowerCase();
  if (c.includes("sub"))       return "🤿";
  if (c.includes("carrier"))   return "⛴";
  if (c.includes("destroyer") || c.includes("frigate") || c.includes("corvette")) return "⚓";
  if (c.includes("helicopter") || c.includes("apache") || c.includes("chinook") ||
      c.includes("merlin") || c.includes("wildcat") || c.includes("puma") || c.includes("blackhawk")) return "🚁";
  if (c.includes("fixed") || c.includes("typhoon") || c.includes("f-35") || c.includes("f-16") || c.includes("a-10")) return "✈";
  if (c.includes("mbt") || c.includes("challenger") || c.includes("abrams") || c.includes("leopard") || c.includes("t-90")) return "🛡";
  if (c.includes("ifv") || c.includes("warrior") || c.includes("bradley") || c.includes("bmp") || c.includes("cv-90")) return "🚖";
  if (c.includes("apc") || c.includes("boxer") || c.includes("m113")) return "🚌";
  return "🔲";
}

function platformColor(presetId: string): string {
  const c = presetId.toLowerCase();
  if (c.includes("mbt") || c.includes("challenger") || c.includes("abrams") || c.includes("leopard") || c.includes("t-90")) return "#f59e0b";
  if (c.includes("ifv") || c.includes("warrior") || c.includes("bradley") || c.includes("bmp")) return "#fb923c";
  if (c.includes("apc") || c.includes("boxer") || c.includes("m113")) return "#fbbf24";
  if (c.includes("helicopter") || c.includes("apache") || c.includes("chinook") ||
      c.includes("merlin") || c.includes("wildcat") || c.includes("puma") || c.includes("blackhawk")) return "#34d399";
  if (c.includes("fixed") || c.includes("typhoon") || c.includes("f-35")) return "#60a5fa";
  if (c.includes("destroyer") || c.includes("frigate") || c.includes("corvette")) return "#818cf8";
  if (c.includes("sub")) return "#a78bfa";
  return "#f0a83c";
}

// ── Editable section row (inline, compact) ────────────────────────────────────
interface InlineSectionRowProps {
  section: AssetSection;
  depth: number;
  allUnits: UnitNode[];
  onChange: (updated: AssetSection) => void;
  onDelete: () => void;
}

const InlineSectionRow: React.FC<InlineSectionRowProps> = ({ section, depth, allUnits, onChange, onDelete }) => {
  const [open, setOpen] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const assigned = new Set(section.assignedUnitIds ?? []);

  return (
    <div style={{ marginLeft: depth * 12 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 4, padding: "3px 6px",
        background: "#0e1120", border: "1px solid #232a45", borderRadius: 2, marginBottom: 2,
      }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#6a7292", fontSize: 9, width: 12 }}>
          {section.subSections.length > 0 ? (open ? "▼" : "▶") : "·"}
        </button>
        <input
          className="mel-input"
          value={section.name}
          onChange={e => onChange({ ...section, name: e.target.value })}
          style={{ flex: 1, padding: "1px 5px", fontSize: 10 }}
        />
        <input
          type="number" className="mel-input"
          value={section.personnelCount} min={0}
          onChange={e => onChange({ ...section, personnelCount: Math.max(0, Number(e.target.value)) })}
          style={{ width: 40, padding: "1px 3px", fontSize: 10, textAlign: "center" }}
        />
        {assigned.size > 0 && (
          <span style={{ fontSize: 8, padding: "0 4px", borderRadius: 8, background: "rgba(34,168,192,0.15)", color: "#22a8c0" }}>
            {assigned.size}
          </span>
        )}
        {allUnits.length > 0 && (
          <button onClick={() => setAssignOpen(a => !a)}
            style={{
              background: assignOpen ? "rgba(34,168,192,0.12)" : "none",
              border: `1px solid ${assignOpen ? "#22a8c0" : "#2f3860"}`,
              cursor: "pointer", color: "#22a8c0", fontSize: 9, padding: "0 4px", borderRadius: 2,
            }}>
            👥
          </button>
        )}
        <button onClick={() => onChange({ ...section, subSections: [...section.subSections, { id: mkId(), name: "Sub-section", personnelCount: 1, subSections: [], assignedUnitIds: [] }] })}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#6a7292", fontSize: 12 }}>⊕</button>
        <button onClick={onDelete}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4d4d", fontSize: 11 }}>✕</button>
      </div>

      {assignOpen && allUnits.length > 0 && (
        <div style={{ marginLeft: 12, marginBottom: 3, padding: "4px 8px", background: "#080a12", border: "1px solid #232a45", borderRadius: 2 }}>
          {allUnits.map(u => (
            <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 0", cursor: "pointer", fontSize: 10, color: "#98a1c0" }}>
              <input type="checkbox" checked={assigned.has(u.id)}
                onChange={() => {
                  const next = new Set(assigned);
                  if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                  onChange({ ...section, assignedUnitIds: Array.from(next) });
                }} />
              {u.name}
              <span style={{ fontSize: 9, color: "#6a7292" }}>({u.echelon})</span>
            </label>
          ))}
        </div>
      )}

      {open && section.subSections.map((sub, idx) => (
        <InlineSectionRow key={sub.id} section={sub} depth={depth + 1} allUnits={allUnits}
          onChange={updated => onChange({ ...section, subSections: section.subSections.map((s, i) => i === idx ? updated : s) })}
          onDelete={() => onChange({ ...section, subSections: section.subSections.filter((_, i) => i !== idx) })}
        />
      ))}
    </div>
  );
};

// ── Owned platform inline card ────────────────────────────────────────────────
interface OwnedPlatformCardProps {
  asset: AssetNode;
  childUnits: UnitNode[];
  onChange: (updated: AssetNode) => void;
  onDelete: () => void;
}

const OwnedPlatformCard: React.FC<OwnedPlatformCardProps> = ({ asset, childUnits, onChange, onDelete }) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"assign" | "sections">("assign");
  const icon  = platformIcon(asset.presetId);
  const color = platformColor(asset.presetId);

  const assignedCount = (asset.assignedUnitIds ?? []).length;

  const updateSection = (idx: number, updated: AssetSection) =>
    onChange({ ...asset, sections: asset.sections.map((s, i) => i === idx ? updated : s) });

  return (
    <div style={{
      border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`,
      borderRadius: 2, marginBottom: 6, background: "#0b0e18",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", background: "#0e1120" }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            className="mel-input"
            value={asset.name}
            onChange={e => onChange({ ...asset, name: e.target.value })}
            style={{ width: "100%", padding: "1px 5px", fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}
          />
        </div>
        <span style={{ fontSize: 9, color, padding: "0 5px", borderRadius: 2, background: `${color}15`, flexShrink: 0 }}>
          ×{asset.quantity} · {asset.crewCount} crew
        </span>
        {assignedCount > 0 && (
          <span style={{ fontSize: 9, padding: "0 5px", borderRadius: 8, background: `${color}20`, color, flexShrink: 0 }}>
            {assignedCount} assigned
          </span>
        )}
        <button onClick={() => setOpen(o => !o)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#98a1c0", fontSize: 10 }}>
          {open ? "▲" : "▼"}
        </button>
        <button onClick={onDelete} title="Remove platform"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4d4d", fontSize: 12 }}>✕</button>
      </div>

      {open && (
        <>
          {/* Sub-tabs */}
          <div style={{ display: "flex", background: "#080a12", borderBottom: "1px solid #232a45", borderTop: "1px solid #232a45" }}>
            {(["assign", "sections"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{
                  padding: "4px 10px", background: "none", border: "none", cursor: "pointer",
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                  color: tab === t ? color : "#6a7292",
                  borderBottom: tab === t ? `2px solid ${color}` : "2px solid transparent",
                  textTransform: "uppercase",
                }}>
                {t === "assign" ? "Assign Units" : "Crew Sections"}
              </button>
            ))}
          </div>

          <div style={{ padding: "8px" }}>
            {/* ASSIGN tab */}
            {tab === "assign" && (
              <div>
                {childUnits.length === 0 ? (
                  <div style={{ fontSize: 10, color: "#6a7292", fontStyle: "italic" }}>No child units to assign.</div>
                ) : (
                  childUnits.map(u => {
                    const checked = (asset.assignedUnitIds ?? []).includes(u.id);
                    return (
                      <label key={u.id} style={{
                        display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", marginBottom: 2,
                        cursor: "pointer", borderRadius: 2,
                        background: checked ? `${color}0d` : "transparent",
                        border: `1px solid ${checked ? color + "33" : "#232a45"}`,
                      }}>
                        <input type="checkbox" checked={checked}
                          onChange={() => {
                            const cur = new Set(asset.assignedUnitIds ?? []);
                            if (cur.has(u.id)) cur.delete(u.id); else cur.add(u.id);
                            onChange({ ...asset, assignedUnitIds: Array.from(cur) });
                          }} />
                        <span style={{ flex: 1, fontSize: 11, color: "#e6eaf8" }}>{u.name}</span>
                        <span style={{ fontSize: 9, color: "#6a7292" }}>{u.echelon} · {u.personnelCount} pax</span>
                      </label>
                    );
                  })
                )}
              </div>
            )}

            {/* SECTIONS tab */}
            {tab === "sections" && (
              <div>
                {asset.sections.map((sec, idx) => (
                  <InlineSectionRow key={sec.id} section={sec} depth={0} allUnits={childUnits}
                    onChange={updated => updateSection(idx, updated)}
                    onDelete={() => onChange({ ...asset, sections: asset.sections.filter((_, i) => i !== idx) })}
                  />
                ))}
                <button
                  onClick={() => onChange({ ...asset, sections: [...asset.sections, { id: mkId(), name: "New Section", personnelCount: 1, subSections: [], assignedUnitIds: [] }] })}
                  style={{
                    display: "flex", alignItems: "center", gap: 4, marginTop: 4,
                    background: "none", border: "1px dashed #2f3860", borderRadius: 2,
                    cursor: "pointer", color: "#6a7292", fontSize: 10, padding: "3px 8px",
                    width: "100%",
                  }}>
                  ⊕ Add Section
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ── Assigned-to (child unit's view) compact card ──────────────────────────────
interface AssignedToCardProps {
  parentUnit: UnitNode;
  asset: AssetNode;
  sectionPath: string[];
  unit: UnitNode;
  onUpdateParentAssets: (parentId: string, assets: UnitNode["assets"]) => void;
}

const AssignedToCard: React.FC<AssignedToCardProps> = ({
  parentUnit, asset, sectionPath, unit, onUpdateParentAssets,
}) => {
  const icon  = platformIcon(asset.presetId);
  const color = platformColor(asset.presetId);
  const allFlat = flattenSections(asset.sections);
  const [open, setOpen] = useState(false);

  const currentLabel = sectionPath.length > 0 ? sectionPath.join(" › ") : "Platform level";

  const handleReassign = (newSectionId: string | null) => {
    let wa = toggleUnitInAsset(parentUnit, asset.id, unit.id, null, false);
    for (const { section: fs } of flattenSections(asset.sections)) {
      if ((fs.assignedUnitIds ?? []).includes(unit.id)) {
        wa = toggleUnitInAsset({ ...parentUnit, assets: wa }, asset.id, unit.id, fs.id, false);
      }
    }
    wa = toggleUnitInAsset({ ...parentUnit, assets: wa }, asset.id, unit.id, newSectionId, true);
    onUpdateParentAssets(parentUnit.id, wa);
    setOpen(false);
  };

  return (
    <div style={{
      border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`,
      borderRadius: 2, marginBottom: 5, background: "#0b0e18",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", background: "#0e1120" }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#e6eaf8", fontFamily: "monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {asset.quantity > 1 ? `${asset.quantity}× ` : ""}{asset.name}
          </div>
          <div style={{ fontSize: 9, color: "#6a7292", marginTop: 1 }}>
            Owned by <span style={{ color: "#98a1c0" }}>{parentUnit.name}</span>
            {" · "}<span style={{ color: "#22a8c0" }}>{currentLabel}</span>
          </div>
        </div>
        <button onClick={() => setOpen(o => !o)}
          style={{
            background: "none", border: "1px solid #2f3860", cursor: "pointer",
            color: "#22a8c0", fontSize: 9, padding: "1px 6px", borderRadius: 2,
            fontWeight: 700, letterSpacing: "0.05em",
          }}>
          {open ? "▲" : "REASSIGN"}
        </button>
      </div>

      {open && (
        <div style={{ padding: "6px 8px", borderTop: "1px solid #232a45" }}>
          <div style={{ fontSize: 9, color: "#6a7292", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Move to:
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 5px", cursor: "pointer",
            borderRadius: 2, marginBottom: 2,
            background: sectionPath.length === 0 ? "rgba(34,168,192,0.08)" : "transparent" }}>
            <input type="radio" name={`ri-${asset.id}`} checked={sectionPath.length === 0} onChange={() => handleReassign(null)} />
            <span style={{ fontSize: 10, color: "#98a1c0" }}>Platform level</span>
          </label>
          {allFlat.map(({ section: sec, depth }) => (
            <label key={sec.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 5px",
              cursor: "pointer", marginLeft: depth * 10, borderRadius: 2, marginBottom: 2,
              background: sectionPath.includes(sec.name) ? "rgba(34,168,192,0.08)" : "transparent" }}>
              <input type="radio" name={`ri-${asset.id}`} checked={sectionPath[sectionPath.length - 1] === sec.name}
                onChange={() => handleReassign(sec.id)} />
              <span style={{ fontSize: 10, color: "#e6eaf8" }}>{sec.name}</span>
              <span style={{ fontSize: 9, color: "#6a7292" }}>{sec.personnelCount} pax</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main export: shown inside list row expansion / tree card expansion ─────────
interface PlatformInlineViewProps {
  unit: UnitNode;
  groupUnits: UnitNode[];
  onUpdateUnit: (input: Record<string, unknown>) => void;
  onUpdateParentAssets: (parentId: string, assets: UnitNode["assets"]) => void;
}

export const PlatformInlineView: React.FC<PlatformInlineViewProps> = ({
  unit, groupUnits, onUpdateUnit, onUpdateParentAssets,
}) => {
  const assignments = findPlatformAssignments(groupUnits, unit.id);
  const hasOwned    = unit.assets.length > 0;
  const hasAssigned = assignments.length > 0;

  if (!hasOwned && !hasAssigned) return null;

  return (
    <div style={{ borderTop: "1px solid #232a45", background: "#080a12" }}>
      {/* Owned platforms */}
      {hasOwned && (
        <div style={{ padding: "6px 8px 2px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#f0a83c", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>
            🚁 Owned Platforms ({unit.assets.length})
          </div>
          {unit.assets.map((asset, idx) => (
            <OwnedPlatformCard
              key={asset.id}
              asset={asset}
              childUnits={unit.children}
              onChange={updated => {
                const newAssets = unit.assets.map((a, i) => i === idx ? updated : a);
                onUpdateUnit({ assetsJson: JSON.stringify(newAssets) });
              }}
              onDelete={() => {
                const newAssets = unit.assets.filter((_, i) => i !== idx);
                onUpdateUnit({ assetsJson: JSON.stringify(newAssets) });
              }}
            />
          ))}
        </div>
      )}

      {/* Platform assignments (from parents) */}
      {hasAssigned && (
        <div style={{ padding: "6px 8px 4px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#22a8c0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>
            📍 Assigned To ({assignments.length})
          </div>
          {assignments.map((a, i) => (
            <AssignedToCard
              key={`${a.parentUnit.id}-${a.asset.id}-${i}`}
              parentUnit={a.parentUnit}
              asset={a.asset}
              sectionPath={a.sectionPath}
              unit={unit}
              onUpdateParentAssets={onUpdateParentAssets}
            />
          ))}
        </div>
      )}
    </div>
  );
};
