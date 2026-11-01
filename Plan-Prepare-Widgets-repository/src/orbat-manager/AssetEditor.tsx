// ============================================================
//  Asset Editor — Manage platforms on a UnitNode
//  Matches screenshot: commander/rank/crew fields,
//  CREW (section tree with role col) / ASSIGN UNITS / WEAPONS tabs.
// ============================================================

import React, { useState } from "react";
import type { AssetNode, AssetSection, WeaponItem, UnitNode } from "./types.js";
import { defaultCrewSections, mkId, flattenSections, flattenAllDescendants } from "./platformContext.js";
import { MilButton } from "../shared/components/Button.js";

// ─── Catalogue ────────────────────────────────────────────────────────────────
interface PlatformPreset {
  id: string; name: string; category: string; nation: string;
  crewCount: number; quantity: number;
}

const CATALOGUE: PlatformPreset[] = [
  { id: "challenger-2",     name: "Challenger 2 MBT",     category: "mbt",        nation: "UK",  crewCount: 4,   quantity: 1  },
  { id: "abrams-m1a2",      name: "M1A2 Abrams MBT",      category: "mbt",        nation: "USA", crewCount: 4,   quantity: 1  },
  { id: "leopard-2a7",      name: "Leopard 2A7 MBT",      category: "mbt",        nation: "DE",  crewCount: 4,   quantity: 1  },
  { id: "t-90m",            name: "T-90M MBT",            category: "mbt",        nation: "RU",  crewCount: 3,   quantity: 1  },
  { id: "warrior-ifv",      name: "Warrior IFV",          category: "ifv",        nation: "UK",  crewCount: 3,   quantity: 14 },
  { id: "boxer-miv",        name: "Boxer MIV",            category: "apc",        nation: "UK",  crewCount: 3,   quantity: 12 },
  { id: "bradley-m2a3",     name: "M2A3 Bradley IFV",     category: "ifv",        nation: "USA", crewCount: 3,   quantity: 14 },
  { id: "cv-90",            name: "CV-90 IFV",            category: "ifv",        nation: "SE",  crewCount: 3,   quantity: 12 },
  { id: "bmp-3",            name: "BMP-3 IFV",            category: "ifv",        nation: "RU",  crewCount: 3,   quantity: 10 },
  { id: "apc-m113",         name: "M113 APC",             category: "apc",        nation: "USA", crewCount: 2,   quantity: 12 },
  { id: "jackal-wls",       name: "Jackal WLS",           category: "wheeled",    nation: "UK",  crewCount: 3,   quantity: 8  },
  { id: "foxhound",         name: "Foxhound MRAP",        category: "wheeled",    nation: "UK",  crewCount: 2,   quantity: 6  },
  { id: "mastiff",          name: "Mastiff PPV",          category: "wheeled",    nation: "UK",  crewCount: 2,   quantity: 6  },
  { id: "apache-ah-64",     name: "Apache AH-64E",        category: "helicopter", nation: "UK",  crewCount: 2,   quantity: 8  },
  { id: "wildcat-ah1",      name: "Wildcat AH1",          category: "helicopter", nation: "UK",  crewCount: 2,   quantity: 6  },
  { id: "chinook-hc6",      name: "Chinook HC6",          category: "helicopter", nation: "UK",  crewCount: 3,   quantity: 4  },
  { id: "merlin-hc4",       name: "Merlin HC4",           category: "helicopter", nation: "UK",  crewCount: 3,   quantity: 4  },
  { id: "puma-hc2",         name: "Puma HC2",             category: "helicopter", nation: "UK",  crewCount: 2,   quantity: 6  },
  { id: "uh-60-blackhawk",  name: "UH-60 Black Hawk",     category: "helicopter", nation: "USA", crewCount: 3,   quantity: 6  },
  { id: "mi-28",            name: "Mi-28 Havoc",          category: "helicopter", nation: "RU",  crewCount: 2,   quantity: 8  },
  { id: "typhoon-fgr4",     name: "Typhoon FGR4",         category: "fixed",      nation: "UK",  crewCount: 1,   quantity: 12 },
  { id: "f-35b-lightning",  name: "F-35B Lightning II",   category: "fixed",      nation: "UK",  crewCount: 1,   quantity: 12 },
  { id: "f-16c",            name: "F-16C Falcon",         category: "fixed",      nation: "USA", crewCount: 1,   quantity: 12 },
  { id: "a-10c",            name: "A-10C Thunderbolt II", category: "fixed",      nation: "USA", crewCount: 1,   quantity: 8  },
  { id: "type-45-destroyer",name: "Type 45 Destroyer",    category: "destroyer",  nation: "UK",  crewCount: 190, quantity: 1  },
  { id: "type-23-frigate",  name: "Type 23 Frigate",      category: "frigate",    nation: "UK",  crewCount: 185, quantity: 1  },
  { id: "type-26-frigate",  name: "Type 26 Frigate",      category: "frigate",    nation: "UK",  crewCount: 157, quantity: 1  },
  { id: "astute-sub",       name: "Astute Class SSN",     category: "submarine",  nation: "UK",  crewCount: 98,  quantity: 1  },
  { id: "ssbn-vanguard",    name: "Vanguard Class SSBN",  category: "submarine",  nation: "UK",  crewCount: 135, quantity: 1  },
  { id: "virginia-ssn",     name: "Virginia Class SSN",   category: "submarine",  nation: "USA", crewCount: 135, quantity: 1  },
  { id: "arleigh-burke",    name: "Arleigh Burke DDG",    category: "destroyer",  nation: "USA", crewCount: 280, quantity: 1  },
];

const CAT_ICON: Record<string, string> = {
  mbt: "🛡", ifv: "🚖", apc: "🚌", wheeled: "🛻",
  helicopter: "🚁", fixed: "✈", destroyer: "⚓",
  frigate: "⚓", submarine: "🤿", corvette: "⚓", carrier: "⛴",
};

const CAT_COLOR: Record<string, string> = {
  mbt: "#f59e0b", ifv: "#fb923c", apc: "#fb923c", wheeled: "#fbbf24",
  helicopter: "#34d399", fixed: "#60a5fa", destroyer: "#818cf8",
  frigate: "#818cf8", submarine: "#a78bfa", corvette: "#818cf8", carrier: "#f472b6",
};

function presetOf(presetId: string): PlatformPreset | undefined {
  return CATALOGUE.find(c => c.id === presetId);
}

function colorOf(presetId: string): string {
  const p = presetOf(presetId);
  return p ? (CAT_COLOR[p.category] ?? "#f0a83c") : "#f0a83c";
}

function iconOf(presetId: string): string {
  const p = presetOf(presetId);
  return p ? (CAT_ICON[p.category] ?? "🔲") : "🔲";
}

// ─── Crew section row — matches screenshot exactly ────────────────────────────
interface CrewSectionRowProps {
  section: AssetSection;
  depth: number;
  allAvailableUnits: UnitNode[];
  onChange: (updated: AssetSection) => void;
  onDelete: () => void;
}

const CrewSectionRow: React.FC<CrewSectionRowProps> = ({
  section, depth, allAvailableUnits, onChange, onDelete,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const assigned = new Set(section.assignedUnitIds ?? []);
  const hasChildren = section.subSections.length > 0;

  const totalInTree = (s: AssetSection): number =>
    s.personnelCount + s.subSections.reduce((a, ss) => a + totalInTree(ss), 0);
  const sectionTotal = totalInTree(section);

  const updateSub = (idx: number, updated: AssetSection) =>
    onChange({ ...section, subSections: section.subSections.map((s, i) => i === idx ? updated : s) });
  const deleteSub = (idx: number) =>
    onChange({ ...section, subSections: section.subSections.filter((_, i) => i !== idx) });

  const accentColor = depth === 0 ? "#6c5ce7" : "#22a8c0";

  return (
    <div>
      {/* Row */}
      <div style={{
        display: "flex", alignItems: "center",
        borderLeft: `2px solid ${accentColor}`,
        marginLeft: depth * 20,
        marginBottom: 2,
        background: depth % 2 === 0 ? "#0e1120" : "#0f1520",
      }}>
        {/* Expand toggle */}
        <button
          onClick={() => hasChildren && setExpanded(e => !e)}
          style={{
            width: 28, flexShrink: 0, background: "none", border: "none",
            cursor: hasChildren ? "pointer" : "default",
            color: hasChildren ? accentColor : "#2f3860",
            fontSize: 9, padding: "8px 4px", lineHeight: 1,
          }}
        >
          {hasChildren ? (expanded ? "▼" : "▶") : " "}
        </button>

        {/* Name */}
        <input
          className="mel-input"
          value={section.name}
          onChange={e => onChange({ ...section, name: e.target.value })}
          style={{ flex: 2.5, padding: "7px 8px", fontSize: 12, fontFamily: "monospace", background: "transparent", border: "none", color: "#e6eaf8" }}
          placeholder="Section name"
        />

        {/* Role (greyed, like screenshot) */}
        <input
          className="mel-input"
          value={section.role ?? ""}
          onChange={e => onChange({ ...section, role: e.target.value || undefined })}
          style={{ flex: 1.5, padding: "7px 8px", fontSize: 11, color: "#6a7292", background: "transparent", border: "none" }}
          placeholder="role"
        />

        {/* Pax input */}
        <input
          type="number"
          className="mel-input"
          value={section.personnelCount}
          min={0}
          onChange={e => onChange({ ...section, personnelCount: Math.max(0, Number(e.target.value)) })}
          style={{
            width: 52, padding: "5px 6px", fontSize: 14, fontWeight: 700,
            textAlign: "center", background: "#1a1f36", border: "1px solid #2f3860",
            borderRadius: 2, color: "#e6eaf8", margin: "0 4px",
          }}
        />

        <span style={{ fontSize: 10, color: "#6a7292", flexShrink: 0, marginRight: 4 }}>pax</span>

        {sectionTotal !== section.personnelCount && (
          <span style={{ fontSize: 9, color: "#98a1c0", marginRight: 4 }}>Σ{sectionTotal}</span>
        )}

        {/* Assigned units badge */}
        {assigned.size > 0 && (
          <span style={{
            fontSize: 9, padding: "0 5px", borderRadius: 8, marginRight: 2,
            background: "rgba(34,168,192,0.2)", color: "#22a8c0",
          }}>
            {assigned.size}
          </span>
        )}

        {/* Assign button (⛓ like screenshot) */}
        <button
          onClick={() => setAssignOpen(a => !a)}
          title="Assign units to this section"
          style={{
            width: 28, flexShrink: 0, background: "none", border: "none",
            cursor: "pointer", fontSize: 16,
            color: assignOpen ? "#22a8c0" : assigned.size > 0 ? "#22a8c0" : "#6a7292",
            padding: "4px 0",
          }}
        >
          ⛓
        </button>

        {/* Add sub-section (+) */}
        <button
          onClick={() => onChange({
            ...section,
            subSections: [...section.subSections, {
              id: mkId(), name: "Sub-section", personnelCount: 1,
              subSections: [], assignedUnitIds: [], role: "role",
            }],
          })}
          title="Add sub-section"
          style={{ width: 26, flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#22a8c0", fontSize: 18, padding: "2px 0" }}
        >
          +
        </button>

        {/* Delete (×) */}
        <button
          onClick={onDelete}
          title="Delete section"
          style={{ width: 28, flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#ef4d4d", fontSize: 16, padding: "4px 2px" }}
        >
          ×
        </button>
      </div>

      {/* Assign units panel */}
      {assignOpen && (
        <div style={{
          marginLeft: depth * 20 + 30, marginBottom: 4,
          padding: "8px 10px", background: "#080a12",
          border: "1px solid #232a45", borderRadius: 2,
        }}>
          <div style={{ fontSize: 9, color: "#6a7292", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Assign units to <strong style={{ color: "#22a8c0" }}>{section.name}</strong>:
          </div>
          {allAvailableUnits.length === 0 ? (
            <div style={{ fontSize: 10, color: "#6a7292", fontStyle: "italic" }}>No units available.</div>
          ) : (
            allAvailableUnits.map(u => (
              <label key={u.id} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 0", cursor: "pointer",
                borderBottom: "1px solid #1a1f36",
              }}>
                <input
                  type="checkbox"
                  checked={assigned.has(u.id)}
                  onChange={() => {
                    const next = new Set(assigned);
                    if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                    onChange({ ...section, assignedUnitIds: Array.from(next) });
                  }}
                />
                <span style={{ flex: 1, fontSize: 11, color: "#e6eaf8" }}>{u.name}</span>
                <span style={{ fontSize: 9, color: "#6a7292" }}>{u.echelon} · {u.personnelCount} pax</span>
              </label>
            ))
          )}
        </div>
      )}

      {/* Sub-sections */}
      {expanded && section.subSections.map((sub, idx) => (
        <CrewSectionRow
          key={sub.id}
          section={sub}
          depth={depth + 1}
          allAvailableUnits={allAvailableUnits}
          onChange={updated => updateSub(idx, updated)}
          onDelete={() => deleteSub(idx)}
        />
      ))}
    </div>
  );
};

// ─── Single asset card ────────────────────────────────────────────────────────
type AssetTab = "crew" | "assign" | "weapons";

interface AssetCardProps {
  asset: AssetNode;
  allAvailableUnits: UnitNode[];
  onChange: (updated: AssetNode) => void;
  onDelete: () => void;
}

const AssetCard: React.FC<AssetCardProps> = ({ asset, allAvailableUnits, onChange, onDelete }) => {
  const [tab, setTab] = useState<AssetTab>("crew");
  const [open, setOpen] = useState(true);

  const color = colorOf(asset.presetId);
  const icon  = iconOf(asset.presetId);
  const preset = presetOf(asset.presetId);

  const sectionPax = (secs: AssetSection[]): number =>
    secs.reduce((a, s) => a + s.personnelCount + sectionPax(s.subSections), 0);
  const totalCrewPax = sectionPax(asset.sections) || asset.crewCount;

  const assignedCount = (asset.assignedUnitIds ?? []).length;

  const updateSection = (idx: number, updated: AssetSection) =>
    onChange({ ...asset, sections: asset.sections.map((s, i) => i === idx ? updated : s) });

  const toggleAssetUnit = (uid: string) => {
    const cur = new Set(asset.assignedUnitIds ?? []);
    if (cur.has(uid)) cur.delete(uid); else cur.add(uid);
    onChange({ ...asset, assignedUnitIds: Array.from(cur) });
  };

  const updateWeapon = (idx: number, w: WeaponItem) =>
    onChange({ ...asset, weapons: asset.weapons.map((ww, i) => i === idx ? w : ww) });
  const removeWeapon = (idx: number) =>
    onChange({ ...asset, weapons: asset.weapons.filter((_, i) => i !== idx) });

  const TABS: { id: AssetTab; label: string; badge?: number }[] = [
    { id: "crew",    label: "CREW",         badge: totalCrewPax },
    { id: "assign",  label: "ASSIGN UNITS" },
    { id: "weapons", label: "WEAPONS",      badge: asset.weapons.length || undefined },
  ];

  return (
    <div style={{
      border: `1px solid ${color}44`, borderLeft: `3px solid ${color}`,
      borderRadius: 2, marginBottom: 14, overflow: "hidden", background: "#0b0e18",
    }}>
      {/* ── Header bar (matches screenshot top row) ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
        background: "#0e1120", borderBottom: "1px solid #232a45",
      }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>

        {/* Name */}
        <input
          className="mel-input"
          value={asset.name}
          onChange={e => onChange({ ...asset, name: e.target.value })}
          style={{ flex: 1, padding: "3px 6px", fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}
        />

        {/* Category · Nation */}
        {preset && (
          <span style={{ fontSize: 10, color, flexShrink: 0 }}>
            {preset.category.charAt(0).toUpperCase() + preset.category.slice(1)} · {preset.nation}
          </span>
        )}

        <div style={{ width: 1, height: 18, background: "#2f3860", flexShrink: 0 }} />

        {/* ×  Quantity */}
        <span style={{ fontSize: 10, color: "#6a7292", flexShrink: 0 }}>×</span>
        <input
          type="number" className="mel-input"
          value={asset.quantity} min={1}
          onChange={e => onChange({ ...asset, quantity: Math.max(1, Number(e.target.value)) })}
          style={{ width: 50, padding: "3px 4px", fontSize: 12, fontWeight: 700, textAlign: "center" }}
        />

        {/* Status */}
        <select
          className="mel-select"
          value={asset.state.status}
          onChange={e => onChange({ ...asset, state: { ...asset.state, status: e.target.value as AssetNode["state"]["status"] } })}
          style={{ fontSize: 11, padding: "3px 6px", minWidth: 78 }}
        >
          <option value="active">Active</option>
          <option value="reserve">Reserve</option>
          <option value="destroyed">Destroyed</option>
          <option value="unknown">Unknown</option>
        </select>

        {assignedCount > 0 && (
          <span style={{
            fontSize: 9, padding: "1px 6px", borderRadius: 8, flexShrink: 0,
            background: `${color}20`, color, border: `1px solid ${color}44`,
          }}>
            {assignedCount} assigned
          </span>
        )}

        <button onClick={() => setOpen(o => !o)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#98a1c0", fontSize: 10, flexShrink: 0 }}>
          {open ? "▲" : "▼"}
        </button>
        <button onClick={onDelete} title="Remove platform"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4d4d", fontSize: 16, flexShrink: 0 }}>
          ×
        </button>
      </div>

      {open && (
        <>
          {/* ── Commander / Rank / Crew pax (matches screenshot) ── */}
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 1fr 1fr",
            background: "#0b0e18", borderBottom: "1px solid #232a45",
          }}>
            {[
              { label: "Commander / Operator", field: "commanderName", placeholder: "e.g. Lt. John Smith, unknown" },
              { label: "Rank",                 field: "commanderRank", placeholder: "e.g. Lt Col" },
            ].map(({ label, field, placeholder }) => (
              <div key={field} style={{ borderRight: "1px solid #232a45", padding: "4px 10px" }}>
                <div style={{ fontSize: 9, color: "#6a7292", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{label}</div>
                <input
                  className="mel-input"
                  value={(asset as unknown as Record<string, unknown>)[field] as string ?? ""}
                  onChange={e => onChange({ ...asset, [field]: e.target.value })}
                  placeholder={placeholder}
                  style={{ width: "100%", padding: "4px 0", fontSize: 11, background: "transparent", border: "none", color: "#e6eaf8" }}
                />
              </div>
            ))}
            <div style={{ padding: "4px 10px" }}>
              <div style={{ fontSize: 9, color: "#6a7292", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Crew pax</div>
              <input
                type="number" className="mel-input"
                value={asset.crewCount}
                onChange={e => onChange({ ...asset, crewCount: Math.max(1, Number(e.target.value)) })}
                style={{ width: "100%", padding: "4px 0", fontSize: 13, fontWeight: 700, background: "transparent", border: "none", color: "#e6eaf8" }}
              />
            </div>
          </div>

          {/* Notes */}
          <div style={{ background: "#0b0e18", borderBottom: "1px solid #232a45" }}>
            <input
              className="mel-input"
              value={asset.notes ?? ""}
              onChange={e => onChange({ ...asset, notes: e.target.value })}
              placeholder="Notes (callsign, hull number, status…)"
              style={{ width: "100%", padding: "6px 10px", fontSize: 11, background: "transparent", border: "none", color: "#98a1c0" }}
            />
          </div>

          {/* ── Tab bar ── */}
          <div style={{ display: "flex", background: "#0e1120", borderBottom: "1px solid #232a45" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  padding: "7px 14px", background: "none", border: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                  color: tab === t.id ? color : "#6a7292",
                  borderBottom: tab === t.id ? `2px solid ${color}` : "2px solid transparent",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                {t.id === "crew" && "👥 "}
                {t.id === "assign" && "⛓ "}
                {t.id === "weapons" && "× "}
                {t.label}
                {t.badge !== undefined && t.badge > 0 && (
                  <span style={{
                    fontSize: 9, padding: "0 5px", borderRadius: 8,
                    background: tab === t.id ? `${color}20` : "#1a1f36",
                    color: tab === t.id ? color : "#98a1c0",
                  }}>
                    ({t.badge})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── CREW tab — section tree ── */}
          {tab === "crew" && (
            <div style={{ padding: "6px 0" }}>
              {/* Column headers */}
              <div style={{
                display: "flex", alignItems: "center",
                padding: "2px 8px 2px 50px",
                fontSize: 9, color: "#6a7292", letterSpacing: "0.08em", textTransform: "uppercase",
                borderBottom: "1px solid #1e2230", marginBottom: 2,
              }}>
                <span style={{ flex: 2.5 }}>Section</span>
                <span style={{ flex: 1.5 }}>Role</span>
                <span style={{ width: 62, textAlign: "center" }}>Pax</span>
              </div>

              {asset.sections.map((sec, idx) => (
                <CrewSectionRow
                  key={sec.id}
                  section={sec}
                  depth={0}
                  allAvailableUnits={allAvailableUnits}
                  onChange={updated => updateSection(idx, updated)}
                  onDelete={() => onChange({ ...asset, sections: asset.sections.filter((_, i) => i !== idx) })}
                />
              ))}

              <button
                onClick={() => onChange({
                  ...asset,
                  sections: [...asset.sections, {
                    id: mkId(), name: "New Section", personnelCount: 1,
                    subSections: [], assignedUnitIds: [], role: "role",
                  }],
                })}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  margin: "8px", padding: "5px 10px",
                  background: "none", border: "1px dashed #2f3860",
                  borderRadius: 2, cursor: "pointer", color: "#6a7292", fontSize: 11,
                  width: "calc(100% - 16px)",
                }}
              >
                + Add Section
              </button>
            </div>
          )}

          {/* ── ASSIGN UNITS tab ── */}
          {tab === "assign" && (
            <div style={{ padding: "10px" }}>
              <div style={{
                fontSize: 11, color: "#98a1c0", marginBottom: 10, lineHeight: 1.5,
                padding: "6px 8px", background: "#0e1120", border: "1px solid #232a45", borderRadius: 2,
              }}>
                Toggle units to assign them to this platform at <strong style={{ color: "#e6eaf8" }}>platform level</strong>.
                Use <strong style={{ color: "#22a8c0" }}>⛓</strong> in the CREW tab to assign to a specific section.
                All descendants (not just direct children) are listed.
              </div>

              {allAvailableUnits.length === 0 ? (
                <div style={{ fontSize: 11, color: "#6a7292", fontStyle: "italic" }}>No sub-units to assign.</div>
              ) : (
                allAvailableUnits.map(u => {
                  const atAssetLevel = (asset.assignedUnitIds ?? []).includes(u.id);
                  const inSectionResult = flattenSections(asset.sections).find(
                    ({ section: s }) => (s.assignedUnitIds ?? []).includes(u.id)
                  );
                  const isAssigned = atAssetLevel || !!inSectionResult;
                  const locationLabel = inSectionResult
                    ? `→ ${inSectionResult.section.name}`
                    : atAssetLevel ? "Platform level" : null;

                  return (
                    <label key={u.id} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 8px", marginBottom: 3, cursor: "pointer",
                      background: isAssigned ? `${color}0d` : "#0e1120",
                      border: `1px solid ${isAssigned ? color + "33" : "#232a45"}`,
                      borderRadius: 2, transition: "all 0.1s",
                    }}>
                      <input
                        type="checkbox"
                        checked={isAssigned}
                        onChange={() => toggleAssetUnit(u.id)}
                      />
                      <span style={{ flex: 1, fontSize: 12, color: "#e6eaf8" }}>{u.name}</span>
                      <span style={{ fontSize: 10, color: "#98a1c0" }}>
                        {u.echelon} · {u.personnelCount} pax
                      </span>
                      {locationLabel && (
                        <span style={{
                          fontSize: 9, padding: "0 5px", borderRadius: 2,
                          background: "rgba(34,168,192,0.15)", color: "#22a8c0",
                        }}>
                          {locationLabel}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          )}

          {/* ── WEAPONS tab ── */}
          {tab === "weapons" && (
            <div style={{ padding: "10px" }}>
              <div style={{ fontSize: 10, color: "#6a7292", marginBottom: 6 }}>
                Weapons fitted to this platform (main armament, secondary, defensive systems).
              </div>
              {asset.weapons.map((w, idx) => (
                <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                  <input className="mel-input" value={w.name} placeholder="Weapon name"
                    onChange={e => updateWeapon(idx, { ...w, name: e.target.value })}
                    style={{ flex: 2, padding: "4px 6px", fontSize: 11 }} />
                  <input className="mel-input" value={w.calibre ?? ""} placeholder="Calibre"
                    onChange={e => updateWeapon(idx, { ...w, calibre: e.target.value || undefined })}
                    style={{ flex: 1, padding: "4px 6px", fontSize: 11 }} />
                  <input type="number" className="mel-input" value={w.quantity} min={1}
                    onChange={e => updateWeapon(idx, { ...w, quantity: Math.max(1, Number(e.target.value)) })}
                    style={{ width: 50, padding: "4px 4px", fontSize: 11, textAlign: "center" }} />
                  <button onClick={() => removeWeapon(idx)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4d4d", fontSize: 16 }}>×</button>
                </div>
              ))}
              <MilButton variant="ghost" icon="add"
                onClick={() => onChange({ ...asset, weapons: [...asset.weapons, { id: mkId(), name: "New Weapon", quantity: 1 }] })}>
                Add Weapon
              </MilButton>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ─── Catalogue picker ─────────────────────────────────────────────────────────
const CataloguePicker: React.FC<{
  onPick: (p: PlatformPreset) => void;
  onClose: () => void;
}> = ({ onPick, onClose }) => {
  const [search, setSearch] = useState("");
  const filtered = CATALOGUE.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase()) ||
    p.nation.toLowerCase().includes(search.toLowerCase()),
  );
  const byCat: Record<string, PlatformPreset[]> = {};
  for (const p of filtered) (byCat[p.category] ??= []).push(p);

  return (
    <div style={{ border: "1px solid #2f3860", borderRadius: 2, background: "#080a12", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid #232a45", background: "#0e1120" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#f0a83c", flex: 1, letterSpacing: "0.06em" }}>🚁 PLATFORM CATALOGUE</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#6a7292", fontSize: 16 }}>×</button>
      </div>
      <div style={{ padding: "6px 8px" }}>
        <input className="mel-input" placeholder="Search platforms…" value={search}
          onChange={e => setSearch(e.target.value)} style={{ width: "100%", padding: "5px 8px", fontSize: 11 }} />
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto", padding: "0 8px 8px" }}>
        {Object.entries(byCat).map(([cat, presets]) => (
          <div key={cat} style={{ marginBottom: 8 }}>
            <div style={{
              fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
              color: CAT_COLOR[cat] ?? "#f0a83c", marginBottom: 4, paddingBottom: 2,
              borderBottom: "1px solid #232a45",
            }}>
              {CAT_ICON[cat] ?? "🔲"} {cat.toUpperCase()}
            </div>
            {presets.map(p => (
              <button key={p.id} onClick={() => { onPick(p); onClose(); }}
                style={{
                  display: "flex", width: "100%", alignItems: "center", gap: 8,
                  padding: "5px 8px", marginBottom: 2,
                  background: "#141828", border: "1px solid #232a45",
                  borderRadius: 2, cursor: "pointer", textAlign: "left",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#1a1f36"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#141828"; }}
              >
                <span style={{ flex: 1, fontSize: 11, color: "#e6eaf8", fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: 9, color: "#6a7292" }}>{p.nation}</span>
                <span style={{ fontSize: 10, color: CAT_COLOR[p.category] ?? "#f0a83c" }}>{p.crewCount} crew</span>
                <span style={{ fontSize: 9, color: "#6a7292" }}>×{p.quantity}</span>
              </button>
            ))}
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ fontSize: 11, color: "#6a7292", fontStyle: "italic", padding: "8px 0" }}>
            No platforms match &quot;{search}&quot;
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main AssetEditor ─────────────────────────────────────────────────────────
interface AssetEditorProps {
  assets: AssetNode[];
  siblingUnits: UnitNode[];
  onChange: (assets: AssetNode[]) => void;
}

export const AssetEditor: React.FC<AssetEditorProps> = ({ assets, siblingUnits, onChange }) => {
  const [showCat, setShowCat] = useState(false);

  // Expand ALL descendants so sub-sub-units can be assigned to sections
  const allDescendants = flattenAllDescendants(siblingUnits);

  const addFromPreset = (preset: PlatformPreset) => {
    onChange([...assets, {
      id: mkId(), name: preset.name, presetId: preset.id,
      quantity: preset.quantity, crewCount: preset.crewCount, weapons: [],
      sections: defaultCrewSections(preset.id, preset.crewCount),
      assignedUnitIds: siblingUnits.map(u => u.id), // auto-assign direct children
      state: { status: "active" },
    }]);
  };

  const addCustom = () => {
    onChange([...assets, {
      id: mkId(), name: "Custom Platform", presetId: "custom",
      quantity: 1, crewCount: 2, weapons: [],
      sections: [{ id: mkId(), name: "Crew", personnelCount: 2, subSections: [], assignedUnitIds: [], role: "crew" }],
      assignedUnitIds: siblingUnits.map(u => u.id),
      state: { status: "active" },
    }]);
  };

  const totalPlatforms = assets.length;
  const totalVehicles  = assets.reduce((a, x) => a + x.quantity, 0);
  const totalCrewPax   = assets.reduce((a, x) => a + x.crewCount * x.quantity, 0);

  return (
    <div>
      {assets.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {[
            { val: totalPlatforms, label: "PLATFORMS" },
            { val: totalVehicles,  label: "VEHICLES" },
            { val: totalCrewPax,   label: "CREW PAX" },
          ].map(({ val, label }) => (
            <div key={label} style={{
              flex: 1, textAlign: "center", padding: "6px",
              background: "rgba(240, 168, 60,0.08)", border: "1px solid rgba(240, 168, 60,0.25)", borderRadius: 2,
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#f0a83c", lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: 9, color: "#98a1c0", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {assets.map((asset, idx) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          allAvailableUnits={allDescendants}
          onChange={updated => onChange(assets.map((a, i) => i === idx ? updated : a))}
          onDelete={() => onChange(assets.filter((_, i) => i !== idx))}
        />
      ))}

      {showCat && <CataloguePicker onPick={addFromPreset} onClose={() => setShowCat(false)} />}

      {!showCat && (
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button onClick={() => setShowCat(true)}
            style={{
              flex: 1, padding: "9px 12px", background: "#1a1f36",
              border: "1px solid #2f3860", borderRadius: 2, cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#202641"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#1a1f36"; }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: "#f0a83c", letterSpacing: "0.06em" }}>
              🚁 ADD FROM CATALOGUE
            </span>
            <span style={{ color: "#6a7292" }}>▼</span>
          </button>
          <button onClick={addCustom}
            style={{ padding: "9px 12px", background: "none", border: "1px solid #2f3860", borderRadius: 2, cursor: "pointer", color: "#98a1c0", fontSize: 12 }}>
            + Custom
          </button>
        </div>
      )}
    </div>
  );
};
