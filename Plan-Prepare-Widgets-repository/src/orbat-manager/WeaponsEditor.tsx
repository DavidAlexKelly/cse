/* eslint-disable jsx-a11y/no-autofocus */
// ============================================================
//  Weapons Editor — unit-level carried weapons
// ============================================================

import React, { useState } from "react";
import type { WeaponItem } from "./types.js";
import { mkId } from "./platformContext.js";
import { MilButton } from "../shared/components/Button.js";

// ── Weapons catalogue ──────────────────────────────────────────────────────
interface WeaponPreset {
  id: string;
  name: string;
  calibre: string;
  category: string;
  nation: string;
  effectiveRangeM: number;
}

const WEAPONS_CATALOGUE: WeaponPreset[] = [
  // Rifles
  { id: "sa80a3",    name: "SA80 A3 (L85A3)", calibre: "5.56×45mm NATO", category: "Assault Rifle",  nation: "UK",  effectiveRangeM: 400 },
  { id: "l129a2",    name: "L129A2 SWS",       calibre: "7.62×51mm NATO", category: "Marksman Rifle", nation: "UK",  effectiveRangeM: 800 },
  { id: "m4a1",      name: "M4A1 Carbine",     calibre: "5.56×45mm NATO", category: "Assault Rifle",  nation: "USA", effectiveRangeM: 500 },
  { id: "m16a4",     name: "M16A4",            calibre: "5.56×45mm NATO", category: "Assault Rifle",  nation: "USA", effectiveRangeM: 550 },
  { id: "hk416",     name: "HK416 A5",         calibre: "5.56×45mm NATO", category: "Assault Rifle",  nation: "DE",  effectiveRangeM: 500 },
  { id: "ak74m",     name: "AK-74M",           calibre: "5.45×39mm",      category: "Assault Rifle",  nation: "RU",  effectiveRangeM: 500 },
  { id: "ak12",      name: "AK-12",            calibre: "5.45×39mm",      category: "Assault Rifle",  nation: "RU",  effectiveRangeM: 500 },
  { id: "scar-l",    name: "FN SCAR-L",        calibre: "5.56×45mm NATO", category: "Assault Rifle",  nation: "BE",  effectiveRangeM: 500 },
  // Sub-machine guns
  { id: "mp5",       name: "Heckler & Koch MP5", calibre: "9×19mm",       category: "SMG",            nation: "DE",  effectiveRangeM: 100 },
  { id: "mp7",       name: "Heckler & Koch MP7", calibre: "4.6×30mm",     category: "SMG",            nation: "DE",  effectiveRangeM: 150 },
  // LMGs / GPMGs
  { id: "l7a2",      name: "L7A2 GPMG",        calibre: "7.62×51mm NATO", category: "GPMG",           nation: "UK",  effectiveRangeM: 800 },
  { id: "l110a3",    name: "L110A3 LSW",        calibre: "5.56×45mm NATO", category: "LMG",            nation: "UK",  effectiveRangeM: 800 },
  { id: "m249",      name: "M249 SAW",          calibre: "5.56×45mm NATO", category: "LMG",            nation: "USA", effectiveRangeM: 800 },
  { id: "m240",      name: "M240B GPMG",        calibre: "7.62×51mm NATO", category: "GPMG",           nation: "USA", effectiveRangeM: 900 },
  { id: "pkm",       name: "PKM",               calibre: "7.62×54mmR",     category: "GPMG",           nation: "RU",  effectiveRangeM: 800 },
  { id: "mg3",       name: "MG3",               calibre: "7.62×51mm NATO", category: "GPMG",           nation: "DE",  effectiveRangeM: 1000 },
  // HMGs
  { id: "l134a1",    name: "L134A1 HMG",        calibre: "12.7×99mm NATO", category: "HMG",            nation: "UK",  effectiveRangeM: 1800 },
  { id: "m2qcb",     name: "M2 .50 cal HMG",    calibre: "12.7×99mm NATO", category: "HMG",            nation: "USA", effectiveRangeM: 1800 },
  // Grenade launchers
  { id: "l17a2",     name: "L17A2 UGL",         calibre: "40×46mm",        category: "Grenade Launcher", nation: "UK", effectiveRangeM: 350 },
  { id: "m203",      name: "M203 UGL",           calibre: "40×46mm",        category: "Grenade Launcher", nation: "USA", effectiveRangeM: 350 },
  // Anti-tank
  { id: "nlaw",      name: "NLAW",              calibre: "150mm",          category: "ATGM",           nation: "UK",  effectiveRangeM: 800 },
  { id: "javelin",   name: "FGM-148 Javelin",   calibre: "127mm",          category: "ATGM",           nation: "USA", effectiveRangeM: 2500 },
  { id: "at4",       name: "AT4",               calibre: "84mm",           category: "RPG",            nation: "SE",  effectiveRangeM: 300 },
  { id: "rpg7",      name: "RPG-7",             calibre: "40mm/85mm",      category: "RPG",            nation: "RU",  effectiveRangeM: 500 },
  { id: "kornet",    name: "9M133 Kornet",       calibre: "152mm",          category: "ATGM",           nation: "RU",  effectiveRangeM: 5500 },
  // Mortars
  { id: "l16-81mm",  name: "L16A2 Mortar",      calibre: "81mm",           category: "Mortar",         nation: "UK",  effectiveRangeM: 5650 },
  { id: "m252-81mm", name: "M252 Mortar",        calibre: "81mm",           category: "Mortar",         nation: "USA", effectiveRangeM: 5700 },
  { id: "2b14-82mm", name: "2B14 Podnos",        calibre: "82mm",           category: "Mortar",         nation: "RU",  effectiveRangeM: 4200 },
  { id: "l16-120mm", name: "L16 120mm Mortar",   calibre: "120mm",          category: "Mortar",         nation: "UK",  effectiveRangeM: 6800 },
  // Sniper
  { id: "l115a3",    name: "L115A3 AWM",         calibre: ".338 Lapua Mag", category: "Sniper Rifle",   nation: "UK",  effectiveRangeM: 1500 },
  { id: "l96a1",     name: "L96A1",              calibre: "7.62×51mm NATO", category: "Sniper Rifle",   nation: "UK",  effectiveRangeM: 900 },
  { id: "m107",      name: "M107 Barrett",       calibre: ".50 BMG",        category: "Anti-Materiel",  nation: "USA", effectiveRangeM: 1500 },
  { id: "sv-98",     name: "SV-98",              calibre: "7.62×54mmR",     category: "Sniper Rifle",   nation: "RU",  effectiveRangeM: 1000 },
  // Air defence
  { id: "starstreak", name: "Starstreak HVM",    calibre: "27mm",           category: "MANPADS",        nation: "UK",  effectiveRangeM: 7000 },
  { id: "stinger",   name: "FIM-92 Stinger",     calibre: "70mm",           category: "MANPADS",        nation: "USA", effectiveRangeM: 4800 },
  { id: "igla",      name: "9K38 Igla",          calibre: "72mm",           category: "MANPADS",        nation: "RU",  effectiveRangeM: 5200 },
];

const CATEGORIES = [...new Set(WEAPONS_CATALOGUE.map(w => w.category))].sort();

interface WeaponsEditorProps {
  weapons: WeaponItem[];
  onChange: (weapons: WeaponItem[]) => void;
}

export const WeaponsEditor: React.FC<WeaponsEditorProps> = ({ weapons, onChange }) => {
  const [catFilter, setCatFilter] = useState("");
  const [search,    setSearch]    = useState("");
  const [showCat,   setShowCat]   = useState(false);

  const totalRounds = weapons.reduce((s, w) => s + (w.roundsCarried ?? 0) * w.quantity, 0);

  const updateWeapon = (idx: number, updated: WeaponItem) => {
    onChange(weapons.map((w, i) => (i === idx ? updated : w)));
  };

  const removeWeapon = (idx: number) => {
    onChange(weapons.filter((_, i) => i !== idx));
  };

  const addFromPreset = (preset: WeaponPreset) => {
    const existing = weapons.findIndex(w => w.id === preset.id);
    if (existing >= 0) {
      // Increment quantity
      onChange(weapons.map((w, i) => i === existing ? { ...w, quantity: w.quantity + 1 } : w));
    } else {
      const newW: WeaponItem = {
        id: preset.id,
        name: preset.name,
        calibre: preset.calibre,
        quantity: 1,
        roundsCarried: 0,
      };
      onChange([...weapons, newW]);
    }
  };

  const addCustom = () => {
    onChange([...weapons, { id: mkId(), name: "Custom Weapon", quantity: 1 }]);
  };

  const filtered = WEAPONS_CATALOGUE.filter(p => {
    const matchCat  = !catFilter || p.category === catFilter;
    const matchText = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.calibre.toLowerCase().includes(search.toLowerCase()) ||
      p.nation.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchText;
  });

  const byCat: Record<string, WeaponPreset[]> = {};
  for (const p of filtered) {
    (byCat[p.category] ??= []).push(p);
  }

  return (
    <div>
      {/* Summary strip */}
      {weapons.length > 0 && (
        <div style={{
          display: "flex", gap: 8, marginBottom: 10,
        }}>
          {[
            { val: weapons.length, label: "WEAPON TYPES" },
            { val: weapons.reduce((s, w) => s + w.quantity, 0), label: "TOTAL WEAPONS" },
            { val: totalRounds > 0 ? totalRounds.toLocaleString() : "—", label: "TOTAL ROUNDS" },
          ].map(({ val, label }) => (
            <div key={label} style={{
              flex: 1, textAlign: "center", padding: "6px",
              background: "rgba(239, 77, 77,0.1)", border: "1px solid rgba(239, 77, 77,0.25)", borderRadius: 2,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#f87171" }}>{val}</div>
              <div style={{ fontSize: 9, color: "#98a1c0", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Assigned weapons list */}
      {weapons.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {weapons.map((w, idx) => (
            <div key={w.id} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 8px", marginBottom: 3,
              background: "#0e1120", border: "1px solid #232a45", borderRadius: 2,
            }}>
              <div style={{ flex: 2, minWidth: 0 }}>
                <input
                  className="mel-input"
                  value={w.name}
                  onChange={e => updateWeapon(idx, { ...w, name: e.target.value })}
                  style={{ width: "100%", padding: "2px 6px", fontSize: 11 }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  className="mel-input"
                  value={w.calibre ?? ""}
                  onChange={e => updateWeapon(idx, { ...w, calibre: e.target.value || undefined })}
                  placeholder="Calibre"
                  style={{ width: "100%", padding: "2px 6px", fontSize: 11 }}
                />
              </div>
              <div style={{ width: 50, flexShrink: 0 }}>
                <input
                  type="number"
                  className="mel-input"
                  value={w.quantity}
                  min={1}
                  onChange={e => updateWeapon(idx, { ...w, quantity: Math.max(1, Number(e.target.value)) })}
                  style={{ width: "100%", padding: "2px 4px", fontSize: 11, textAlign: "center" }}
                  title="Quantity"
                />
              </div>
              <div style={{ width: 60, flexShrink: 0 }}>
                <input
                  type="number"
                  className="mel-input"
                  value={w.roundsCarried ?? ""}
                  min={0}
                  onChange={e => updateWeapon(idx, { ...w, roundsCarried: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="Rnds"
                  style={{ width: "100%", padding: "2px 4px", fontSize: 11, textAlign: "center" }}
                  title="Rounds carried per weapon"
                />
              </div>
              <button
                onClick={() => removeWeapon(idx)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#ef4d4d", fontSize: 13, padding: "2px 4px",
                }}
              >✕</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 4, fontSize: 9, color: "#6a7292", padding: "2px 8px" }}>
            <span style={{ minWidth: 120, flex: 2 }}>NAME</span>
            <span style={{ flex: 1 }}>CALIBRE</span>
            <span style={{ width: 50, textAlign: "center" }}>QTY</span>
            <span style={{ width: 60, textAlign: "center" }}>ROUNDS</span>
            <span style={{ width: 20 }} />
          </div>
        </div>
      )}

      {/* Catalogue toggle */}
      <button
        onClick={() => setShowCat(c => !c)}
        style={{
          display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center",
          padding: "8px 12px", background: "#1a1f36",
          border: "1px solid #2f3860", borderRadius: 2, cursor: "pointer",
          fontSize: 11, fontWeight: 700, color: "#f87171", letterSpacing: "0.06em",
          marginBottom: 4,
        }}
      >
        <span>⚔ ADD FROM WEAPONS CATALOGUE</span>
        <span style={{ color: "#6a7292" }}>{showCat ? "▲" : "▼"}</span>
      </button>

      {showCat && (
        <div style={{
          border: "1px solid #232a45", borderRadius: 2,
          background: "#080a12", marginBottom: 8,
        }}>
          {/* Search + category filter */}
          <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderBottom: "1px solid #232a45" }}>
            <input
              className="mel-input"
              placeholder="Search weapons..."
              value={search}
              autoFocus
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, padding: "3px 6px", fontSize: 11 }}
            />
            <select
              className="mel-select"
              value={catFilter}
              onChange={e => setCatFilter(e.target.value)}
              style={{ fontSize: 11, padding: "3px 6px" }}
            >
              <option value="">All categories</option>
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div style={{ maxHeight: 240, overflowY: "auto", padding: "4px 8px 8px" }}>
            {Object.entries(byCat).map(([cat, presets]) => (
              <div key={cat} style={{ marginBottom: 8 }}>
                <div style={{
                  fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.1em", color: "#f87171",
                  paddingBottom: 3, borderBottom: "1px solid #232a45", marginBottom: 4,
                }}>
                  {cat}
                </div>
                {presets.map(p => (
                  <button
                    key={p.id}
                    onClick={() => addFromPreset(p)}
                    style={{
                      display: "flex", width: "100%", alignItems: "center", gap: 8,
                      padding: "4px 8px", marginBottom: 2,
                      background: "#141828", border: "1px solid #232a45",
                      borderRadius: 2, cursor: "pointer", textAlign: "left",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#1a1f36"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#141828"; }}
                  >
                    <span style={{ fontSize: 11, color: "#e6eaf8", fontWeight: 600, flex: 1 }}>{p.name}</span>
                    <span style={{ fontSize: 10, color: "#98a1c0" }}>{p.calibre}</span>
                    <span style={{ fontSize: 9, color: "#6a7292" }}>{p.nation}</span>
                    <span style={{ fontSize: 9, color: "#6a7292" }}>{p.effectiveRangeM}m</span>
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ fontSize: 11, color: "#6a7292", fontStyle: "italic", padding: "8px 0" }}>
                No weapons match your search.
              </div>
            )}
          </div>
        </div>
      )}

      <MilButton variant="ghost" icon="add" onClick={addCustom}>Add custom weapon</MilButton>
    </div>
  );
};
