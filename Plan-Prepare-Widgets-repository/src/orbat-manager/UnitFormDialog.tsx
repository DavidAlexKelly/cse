/* eslint-disable jsx-a11y/no-autofocus */
/* eslint-disable jsx-a11y/label-has-associated-control */
// ============================================================
//  Unit Form Dialog — Add / Edit a UnitNode
//  Uses shared MilModal — no Blueprint Dialog (fixes transparent bg)
//  Tabbed: Core | Symbol | Capabilities | Weapons | Platforms | Properties
//  Includes a relationship chooser when adding (not editing):
//    Child of <parent>  |  Sibling of <parent>  |  Parent of <parent>
// ============================================================

import React, { useEffect, useMemo, useState } from "react";
import type { UnitNode, EchelonLevel, UnitIconType, Side, AssetNode, WeaponItem, CustomProperty, CommandRelationshipType, EquipmentTypeRef } from "./types.js";
import { ECHELON_ORDER, ECHELON_LABELS, COMMAND_REL_LABELS, COMMAND_REL_DESCRIPTION, COMMAND_REL_COLOUR } from "./types.js";
import { AssetEditor } from "./AssetEditor.js";
import { WeaponsEditor } from "./WeaponsEditor.js";
import type { Sector1Modifier, Sector2Modifier, HqIndicator, SymbolStatus } from "./symbolSpec.js";
import { NatoSymbol } from "./NatoSymbol.js";
import { MilModal, MilFormGroup, MilFormRow, MilTextInput, MilTextArea, MilSelect } from "../shared/components/Modal.js";
import { useEquipmentTypes } from "./equipmentTypeContext.js";

// ── Icon catalogue ──
const ICON_OPTIONS: { value: UnitIconType; label: string }[] = [
  { value: "infantry",           label: "Infantry — diagonal line" },
  { value: "armour",             label: "Armour — hollow oval" },
  { value: "mechanisedInfantry", label: "Mechanised Infantry — oval + diagonal" },
  { value: "artillery",          label: "Artillery — solid circle" },
  { value: "rocketArtillery",    label: "Rocket Artillery" },
  { value: "mortar",             label: "Mortar — circle + line" },
  { value: "aviation",           label: "Aviation — rotor cross" },
  { value: "airForce",           label: "Air Force — wing triangle" },
  { value: "reconnaissance",     label: "Reconnaissance — reverse diagonal" },
  { value: "cavalry",            label: "Cavalry — diagonal + circle" },
  { value: "engineer",           label: "Engineer — portcullis" },
  { value: "pioneer",            label: "Pioneer — portcullis + axe" },
  { value: "signals",            label: "Signals — lightning bolt" },
  { value: "cyber",              label: "Cyber — circle + </>" },
  { value: "ew",                 label: "Electronic Warfare — wave arcs" },
  { value: "logistics",          label: "Logistics — wheel cross" },
  { value: "maintenance",        label: "Maintenance — wrench" },
  { value: "medical",            label: "Medical — equal cross" },
  { value: "airDefence",         label: "Air Defence — arc + arrow" },
  { value: "specialForces",      label: "Special Forces — crossed swords" },
  { value: "sniper",             label: "Sniper — crosshair" },
  { value: "antiTank",           label: "Anti-Tank — triangle" },
  { value: "naval",              label: "Naval — hull" },
  { value: "cbrn",               label: "CBRN — hazard triangle" },
  { value: "military_police",    label: "Military Police — MP" },
  { value: "headquarters",       label: "Headquarters — horizontal bar" },
  { value: "generic",            label: "Generic (frame only)" },
];

// ── Echelon pax guidance ──
const ECHELON_DESC: Record<EchelonLevel, string> = {
  team:      "2–6 personnel. Fire team.",
  squad:     "6–14 personnel. Basic tactical unit.",
  section:   "8–14 personnel. Basic building block.",
  platoon:   "28–56 personnel. 3–4 sections.",
  company:   "80–250 personnel. 3–5 platoons.",
  battalion: "2+ Companies with HQ. ~700 pax.",
  regiment:  "2+ Battalions. 1,000–3,000 pax.",
  brigade:   "2+ Regiments. 3,000–8,000 pax.",
  division:  "2+ Brigades. 10,000–25,000 pax.",
  corps:     "2+ Divisions. 20,000–80,000 pax.",
  army:      "2+ Corps. 80,000–400,000 pax.",
  armyGroup: "2+ Armies. Very large.",
  theatre:   "All forces in a theatre.",
};

const ECHELON_PAX_RANGE: Record<EchelonLevel, [number, number]> = {
  team:      [2, 6],        squad:     [6, 14],       section:   [8, 14],
  platoon:   [28, 56],      company:   [80, 250],      battalion: [300, 1200],
  regiment:  [500, 3000],   brigade:   [3000, 8000],   division:  [10000, 25000],
  corps:     [20000, 80000], army:     [80000, 400000], armyGroup: [400000, 1000000],
  theatre:   [1000000, 10000000],
};

type DialogTab = "core" | "symbol" | "capabilities" | "weapons" | "platforms" | "properties";

/** Relationship modes when adding (not editing) a unit */
export type RelationshipMode = "child" | "sibling" | "parent";

interface FormState {
  name: string; echelon: EchelonLevel;
  officers: number; otherRanks: number; notes: string;
  icon: UnitIconType;
  sector1: Sector1Modifier | ""; sector2: Sector2Modifier | "";
  hqIndicator: HqIndicator | ""; reinforced: "+" | "-" | "±" | "";
  symbolStatus: SymbolStatus | "";
  callSign: string; primaryWeapon: string; combatEffectiveness: string;
  speedRoadKph: string; speedOffRoadKph: string; rangeKm: string;
  iffCode: string; radioFreqMhz: string;
  commandRelationshipType: CommandRelationshipType | "";
}
function nodeToForm(node?: UnitNode): FormState {
  const totalPax = node?.personnelCount ?? 8;
  return {
    name: node?.name ?? "", echelon: node?.echelon ?? "section",
    officers: 0, otherRanks: totalPax, notes: node?.notes ?? "",
    icon: node?.symbol.icon ?? "infantry",
    sector1: (node?.symbol.sector1 ?? "") as Sector1Modifier | "",
    sector2: (node?.symbol.sector2 ?? "") as Sector2Modifier | "",
    hqIndicator: (node?.symbol.hqIndicator ?? "") as HqIndicator | "",
    reinforced: (node?.symbol.reinforced ?? "") as "+" | "-" | "±" | "",
    symbolStatus: (node?.symbol.status ?? "") as SymbolStatus | "",
    callSign: node?.capabilities.callSign ?? "",
    primaryWeapon: node?.capabilities.primaryWeapon ?? "",
    combatEffectiveness: node?.capabilities.combatEffectiveness ?? "",
    speedRoadKph: String(node?.capabilities.speedRoadKph ?? ""),
    speedOffRoadKph: String(node?.capabilities.speedOffRoadKph ?? ""),
    rangeKm: String(node?.capabilities.rangeKm ?? ""),
    iffCode: node?.capabilities.iffCode ?? "",
    radioFreqMhz: String(node?.capabilities.radioFreqMhz ?? ""),
    commandRelationshipType: (node?.commandRelationshipType ?? "") as CommandRelationshipType | "",
  };
}

export interface UnitFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with form input + optional relationship mode for add operations */
  onSubmit: (input: Record<string, unknown>, relationshipMode?: RelationshipMode) => void;
  existingNode?: UnitNode;
  /** Pre-fill form from a unit template (when adding via template picker) */
  templatePreFill?: Record<string, unknown>;
  /** Reference node — the unit this was triggered from (for relationship context) */
  parentName?: string | null;
  /** Pre-select a relationship mode when the dialog opens (default: "child") */
  defaultRelMode?: RelationshipMode;
  side: Side;
}

// Shared field label style
const fieldLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
  textTransform: "uppercase", color: "var(--mil-muted)", marginBottom: 5, display: "block",
};

// Shared select style
const milSelect: React.CSSProperties = {
  background: "var(--mil-bg-2)", border: "1px solid var(--mil-border-lt)", borderRadius: 2,
  color: "var(--mil-text)", fontSize: 12, padding: "5px 9px",
  width: "100%", outline: "none",
};

// Shared input style
const milInput: React.CSSProperties = {
  background: "var(--mil-bg-2)", border: "1px solid var(--mil-border-lt)", borderRadius: 2,
  color: "var(--mil-text)", fontSize: 12, padding: "5px 9px",
  width: "100%", outline: "none",
};

const TABS: { id: DialogTab; label: string }[] = [
  { id: "core",         label: "Core" },
  { id: "symbol",       label: "Symbol" },
  { id: "capabilities", label: "Capabilities" },
  { id: "weapons",      label: "🔫 Weapons" },
  { id: "platforms",    label: "🚁 Platforms" },
  { id: "properties",   label: "Properties" },
];

// ── Relationship option card ──────────────────────────────────────────────────
interface RelCardProps {
  mode: RelationshipMode;
  active: boolean;
  refName: string;
  onClick: () => void;
}

const REL_META: Record<RelationshipMode, {
  icon: string; label: string; color: string;
  desc: (ref: string) => string;
}> = {
  child: {
    icon: "↓", label: "Child of",
    color: "var(--mil-cyan)",
    desc: ref => `New unit reports to "${ref}". It will appear nested under it in the hierarchy.`,
  },
  sibling: {
    icon: "→", label: "Sibling of",
    color: "#4ade80",
    desc: ref => `New unit is at the same level as "${ref}", reporting to the same parent.`,
  },
  parent: {
    icon: "↑", label: "Parent of",
    color: "var(--mil-amber)",
    desc: ref => `New unit becomes the commander of "${ref}". "${ref}" will be nested under the new unit.`,
  },
};

const RelCard: React.FC<RelCardProps> = ({ mode, active, refName, onClick }) => {
  const meta = REL_META[mode];
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", gap: 4,
        padding: "10px 12px", borderRadius: 2, cursor: "pointer",
        background: active ? `${meta.color}18` : "var(--mil-bg-2)",
        border: `2px solid ${active ? meta.color : "var(--mil-border)"}`,
        textAlign: "left", flex: 1, transition: "all 0.1s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          fontSize: 16, fontWeight: 700, color: meta.color,
          width: 24, textAlign: "center",
        }}>
          {meta.icon}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: active ? "var(--mil-text)" : "var(--mil-text-2)" }}>
          {meta.label}
        </span>
      </div>
      <div style={{ fontSize: 10, color: "var(--mil-muted)", lineHeight: 1.5, paddingLeft: 30 }}>
        {meta.desc(refName ?? "parent")}
      </div>
    </button>
  );
};

// ── Custom Properties Editor ──────────────────────────────────────────────────

const PROP_TYPE_LABELS: Record<CustomProperty["type"], string> = {
  text: "Text", number: "Number", boolean: "Yes/No", date: "Date",
};

const CustomPropertiesEditor: React.FC<{
  properties: CustomProperty[];
  onChange: (items: CustomProperty[]) => void;
}> = ({ properties, onChange }) => {
  const [items, setItems] = React.useState<CustomProperty[]>(properties);

  React.useEffect(() => {
    onChange(items);
  }, [items, onChange]);

  const addProp = () => {
    const newProp: CustomProperty = {
      id: crypto.randomUUID(),
      key: "",
      label: "",
      type: "text",
      value: "",
    };
    setItems(prev => [...prev, newProp]);
  };

  const updateProp = (id: string, partial: Partial<CustomProperty>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...partial } : item));
  };

  const removeProp = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{
        padding: "8px 10px",
        background: "var(--mil-surface)",
        border: "1px solid var(--mil-border-lt)",
        borderLeft: "3px solid var(--mil-olive)",
        borderRadius: 2,
        fontSize: 11,
        color: "var(--mil-text-2)",
        lineHeight: 1.5,
      }}>
        Add free-form key/value pairs — fuel %, readiness notes, grid reference, etc.
        These are stored on the unit and visible in the detail panel.
      </div>

      {items.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--mil-muted)", fontStyle: "italic", textAlign: "center", padding: "12px 0" }}>
          No custom properties yet.
        </div>
      )}

      {items.map((prop) => (
        <div key={prop.id} style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr auto",
          gap: 6,
          alignItems: "center",
          padding: "8px 10px",
          background: "var(--mil-bg-3)",
          border: "1px solid var(--mil-border)",
          borderRadius: 2,
        }}>
          {/* Label */}
          <div>
            <label style={{ ...fieldLabel, marginBottom: 3 }}>Label</label>
            <input
              style={milInput}
              value={prop.label}
              placeholder="e.g. Fuel Level"
              onChange={e => updateProp(prop.id, { label: e.target.value, key: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
            />
          </div>

          {/* Type */}
          <div>
            <label style={{ ...fieldLabel, marginBottom: 3 }}>Type</label>
            <select
              style={milSelect}
              value={prop.type}
              onChange={e => updateProp(prop.id, { type: e.target.value as CustomProperty["type"], value: "" })}
            >
              {(Object.keys(PROP_TYPE_LABELS) as CustomProperty["type"][]).map(t => (
                <option key={t} value={t}>{PROP_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          {/* Value */}
          <div>
            <label style={{ ...fieldLabel, marginBottom: 3 }}>Value</label>
            {prop.type === "boolean" ? (
              <select
                style={milSelect}
                value={prop.value}
                onChange={e => updateProp(prop.id, { value: e.target.value })}
              >
                <option value="">— Select —</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                style={milInput}
                type={prop.type === "number" ? "number" : prop.type === "date" ? "date" : "text"}
                value={prop.value}
                placeholder={
                  prop.type === "number" ? "e.g. 75" :
                  prop.type === "date"   ? "" :
                  "e.g. Alpha"
                }
                onChange={e => updateProp(prop.id, { value: e.target.value })}
              />
            )}
          </div>

          {/* Unit (for number types) + delete */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", paddingTop: 16 }}>
            {prop.type === "number" && (
              <input
                style={{ ...milInput, width: 60, fontSize: 11 }}
                value={prop.unit ?? ""}
                placeholder="unit"
                onChange={e => updateProp(prop.id, { unit: e.target.value })}
              />
            )}
            <button
              title="Remove property"
              onClick={() => removeProp(prop.id)}
              style={{
                background: "rgba(231,76,60,0.15)",
                border: "1px solid rgba(231,76,60,0.4)",
                borderRadius: 2,
                cursor: "pointer",
                color: "#ef4d4d",
                fontSize: 13,
                padding: "2px 7px",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      <div>
        <button
          onClick={addProp}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px",
            background: "var(--mil-bg-2)",
            border: "1px dashed var(--mil-border-lt)",
            borderRadius: 2,
            cursor: "pointer",
            color: "var(--mil-text-2)",
            fontSize: 11,
            fontWeight: 600,
            width: "100%",
            justifyContent: "center",
            transition: "border-color 0.1s, color 0.1s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--mil-olive)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--mil-olive-lt)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--mil-border-lt)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--mil-text-2)"; }}
        >
          + Add Property
        </button>
      </div>
    </div>
  );
};

// ── Equipment Type Picker ─────────────────────────────────────────────────────
//
//  Combobox-style picker fed by the ontology-loaded catalogue from
//  EquipmentTypeContext.  Filters as you type against nomenclature + key.
//  When the ontology returns nothing yet (initial load / offline), the picker
//  degrades gracefully to a free-text input so the field remains usable.
//
//  On select we store the full EquipmentTypeRef so downstream code has the
//  friendly name — the store persists that alongside the primary key.

interface EquipmentTypePickerProps {
  value: EquipmentTypeRef | null;
  onChange: (next: EquipmentTypeRef | null) => void;
}

const EquipmentTypePicker: React.FC<EquipmentTypePickerProps> = ({ value, onChange }) => {
  const catalogue = useEquipmentTypes();
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);

  // Reset transient query when the underlying value changes externally
  useEffect(() => { setQuery(""); }, [value?.key]);

  // Show at most 8 matches to keep the dropdown compact
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalogue.types.slice(0, 8);
    return catalogue.types
      .filter(t => {
        const hay = `${t.nomenclature ?? ""} ${t.key} ${t.description ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [catalogue.types, query]);

  // Free-text fallback when the ontology hasn't loaded yet
  const isOffline = !catalogue.loading && catalogue.error != null && catalogue.types.length === 0;

  return (
    <div style={{ position: "relative" }}>
      {value ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 9px", borderRadius: 3,
          background: "var(--mil-surface)",
          border: "1px solid var(--mil-border-lt)",
          borderLeft: "3px solid var(--mil-cyan)",
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mil-text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {value.nomenclature || value.key}
          </span>
          {value.description && (
            <span style={{ fontSize: 10, color: "var(--mil-muted)" }}>
              {value.description.slice(0, 40)}{value.description.length > 40 ? "…" : ""}
            </span>
          )}
          <button
            type="button"
            onClick={() => { onChange(null); setQuery(""); }}
            title="Clear equipment type"
            style={{
              background: "rgba(231,76,60,0.14)",
              border: "1px solid rgba(231,76,60,0.4)",
              borderRadius: 2, color: "#ef4d4d", padding: "1px 8px",
              cursor: "pointer", fontSize: 12, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      ) : (
        <>
          <input
            style={milInput}
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={
              catalogue.loading ? "Loading equipment types…" :
              isOffline ? "Equipment nomenclature (offline — free text)" :
              "Search NxgEquipmentType…"
            }
          />
          {open && matches.length > 0 && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
              background: "var(--mil-bg-2)",
              border: "1px solid var(--mil-border-lt)",
              borderTop: "none",
              borderRadius: "0 0 3px 3px",
              maxHeight: 220, overflowY: "auto",
              boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
            }}>
              {matches.map(t => (
                <button
                  key={t.key}
                  type="button"
                  onMouseDown={e => e.preventDefault()} // keep blur from firing first
                  onClick={() => {
                    onChange(t);
                    setQuery("");
                    setOpen(false);
                  }}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start",
                    gap: 1,
                    padding: "6px 10px",
                    width: "100%", textAlign: "left",
                    background: "none", border: "none",
                    borderBottom: "1px solid var(--mil-border)",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mil-text)" }}>
                    {t.nomenclature || t.key}
                  </span>
                  {t.description && (
                    <span style={{ fontSize: 10, color: "var(--mil-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                      {t.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {/* Offline free-text confirmation — pressing Enter or blur commits */}
          {isOffline && query.trim() && (
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onChange({ key: query.trim(), nomenclature: query.trim() });
                setQuery("");
                setOpen(false);
              }}
              style={{
                marginTop: 4,
                width: "100%",
                background: "var(--mil-olive-mut)",
                border: "1px dashed var(--mil-olive)",
                color: "var(--mil-olive-lt)",
                fontSize: 11, padding: "4px 8px",
                borderRadius: 2, cursor: "pointer",
              }}
            >

              Use &ldquo;{query.trim()}&rdquo; as free-text equipment
            </button>
          )}
        </>
      )}
      {/* Status footer */}
      <div style={{ fontSize: 10, color: "var(--mil-text-3)", marginTop: 4 }}>
        {catalogue.loading
          ? "Fetching NxgEquipmentType from ontology…"
          : catalogue.error
            ? <span style={{ color: "#ef4d4d" }}>Failed to load: {catalogue.error.slice(0, 60)}</span>
            : `${catalogue.types.length} equipment type${catalogue.types.length === 1 ? "" : "s"} available`}
      </div>
    </div>
  );
};

export const UnitFormDialog: React.FC<UnitFormDialogProps> = ({
  isOpen, onClose, onSubmit, existingNode, templatePreFill, parentName, defaultRelMode, side,
}) => {
  const [form, setForm]       = useState<FormState>(() => nodeToForm(existingNode));
  const [activeTab, setTab]   = useState<DialogTab>("core");
  const [assets, setAssets]   = useState<AssetNode[]>(() => existingNode?.assets ?? []);
  const [weapons, setWeapons] = useState<WeaponItem[]>(() => existingNode?.weapons ?? []);
  // Relationship mode — only relevant when adding (not editing)
  const [relMode, setRelMode] = useState<RelationshipMode>(defaultRelMode ?? "child");
  // Custom properties — managed by CustomPropertiesEditor, captured via ref on submit
  const pendingCustomPropsRef = React.useRef<CustomProperty[]>(existingNode?.customProperties ?? []);

  // ── Equipment type (ontology-backed) ────────────────────────────────
  //   Stored as an EquipmentTypeRef so we retain the friendly nomenclature
  //   between edit sessions. `null` means "no equipment" (organisational node).
  const [equipmentType, setEquipmentType] =
    useState<EquipmentTypeRef | null>(() => existingNode?.equipmentType ?? null);

  useEffect(() => {
    if (isOpen) {
      if (templatePreFill && !existingNode) {
        // Pre-fill from template
        const base = nodeToForm(undefined);
        setForm({
          ...base,
          name:       (templatePreFill.name  as string)         ?? "",
          echelon:    (templatePreFill.echelon as EchelonLevel)  ?? "section",
          otherRanks: (templatePreFill.personnelCount as number) ?? base.otherRanks,
          notes:      (templatePreFill.notes as string)         ?? "",
          icon:       (templatePreFill.symbolIcon as UnitIconType) ?? "infantry",
        });
        setEquipmentType(null);
      } else {
        setForm(nodeToForm(existingNode));
        setEquipmentType(existingNode?.equipmentType ?? null);
      }
      setAssets(existingNode?.assets ?? []);
      setWeapons(existingNode?.weapons ?? []);
      setTab("core");
      setRelMode(defaultRelMode ?? "child");
      pendingCustomPropsRef.current = existingNode?.customProperties ?? [];
    }
  }, [isOpen, existingNode, templatePreFill, defaultRelMode]);

  if (!isOpen) return null;

  const set = (partial: Partial<FormState>) => setForm(f => ({ ...f, ...partial }));
  const totalPax = form.officers + form.otherRanks;
  const [paxMin, paxMax] = ECHELON_PAX_RANGE[form.echelon] ?? [0, 99999];
  const isAdding = !existingNode;

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    onSubmit({
      name: form.name.trim(), echelon: form.echelon,
      personnelCount: totalPax || form.otherRanks,
      notes: form.notes, symbolIcon: form.icon,
      sector1: form.sector1 || undefined, sector2: form.sector2 || undefined,
      hqIndicator: form.hqIndicator || undefined, reinforced: form.reinforced || undefined,
      symbolStatus: form.symbolStatus || undefined,
      commandRelationshipType: form.commandRelationshipType || undefined,
      // Equipment type — send a full ref when set, explicit null to clear.
      // The store's inputToNode() understands both shapes.
      equipmentType: equipmentType ?? null,
      assetsJson: JSON.stringify(assets), weaponsJson: JSON.stringify(weapons),
      customPropertiesJson: JSON.stringify(pendingCustomPropsRef.current),
      capabilities: {
        callSign: form.callSign || undefined, primaryWeapon: form.primaryWeapon || undefined,
        combatEffectiveness: form.combatEffectiveness || undefined,
        speedRoadKph:    form.speedRoadKph    ? Number(form.speedRoadKph)    : undefined,
        speedOffRoadKph: form.speedOffRoadKph ? Number(form.speedOffRoadKph) : undefined,
        rangeKm:         form.rangeKm         ? Number(form.rangeKm)         : undefined,
        iffCode:         form.iffCode || undefined,
        radioFreqMhz:    form.radioFreqMhz    ? Number(form.radioFreqMhz)    : undefined,
      },
    }, isAdding ? relMode : undefined);
    onClose();
  };

  const dialogTitle = existingNode
    ? `Edit — ${existingNode.name}`
    : parentName
      ? `New Unit — ${REL_META[relMode].label} ${parentName}`
      : "Add Root Unit";

  return (
    <MilModal
      title={dialogTitle}
      titleIcon={existingNode ? "edit" : "add"}
      onClose={onClose}
      actions={[
        { label: "Cancel",  variant: "default", onClick: onClose },
        { label: existingNode ? "Save Changes" : "Add Unit", variant: "primary",
          disabled: !form.name.trim(), onClick: handleSubmit },
      ]}
    >
      {/*
        Layout note: mel-modal__body is now overflow-y: auto + flex: 1 1 0.
        We pull the relationship picker and tab bar OUT of the normal flow
        with negative margins so they sit flush to the modal edges and stay
        visible without scrolling, while the tab content area below them
        is what actually grows and scrolls.
      */}

      {/* ── Relationship picker (add only, only when a reference unit exists) ── */}
      {isAdding && parentName && (
        <div style={{
          margin: "-16px -16px 0",
          padding: "12px 16px 12px",
          background: "var(--mil-bg)",
          borderBottom: "1px solid var(--mil-border)",
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--mil-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Relationship to <strong style={{ color: "var(--mil-text)" }}>{parentName}</strong>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["child", "sibling", "parent"] as RelationshipMode[]).map(mode => (
              <RelCard
                key={mode}
                mode={mode}
                active={relMode === mode}
                refName={parentName}
                onClick={() => setRelMode(mode)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Tab bar — sticky so it stays visible while scrolling tab content ── */}
      <div style={{
        display: "flex", gap: 0,
        margin: "-16px -16px 0",
        borderBottom: "1px solid var(--mil-border)", background: "var(--mil-bg-2)",
        overflowX: "auto", flexShrink: 0,
        position: "sticky", top: 0, zIndex: 2,
      }}>
        {TABS.map(tab => (
          <button key={tab.id}
            onClick={() => setTab(tab.id)}
            style={{
              padding: "8px 14px", background: "none", border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: activeTab === tab.id ? 700 : 400,
              color: activeTab === tab.id ? "var(--mil-olive-lt)" : "var(--mil-text-2)",
              borderBottom: activeTab === tab.id ? "2px solid var(--mil-olive)" : "2px solid transparent",
              whiteSpace: "nowrap", transition: "color 0.1s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab content — this is what scrolls ── */}
      <div style={{ paddingTop: 16 }}>

      {/* ── CORE TAB ── */}
      {activeTab === "core" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <MilFormGroup label="Unit Name">
            <MilTextInput value={form.name} onChange={v => set({ name: v })}
              placeholder="e.g. Battalion HQ" autoFocus />
          </MilFormGroup>

          <div>
            <label style={fieldLabel}>Echelon</label>
            <MilSelect
              value={form.echelon}
              onChange={v => set({ echelon: v as EchelonLevel })}
              options={ECHELON_ORDER.map(e => ({ value: e, label: ECHELON_LABELS[e] }))}
            />
            <div style={{ fontSize: 11, color: "var(--mil-text-2)", marginTop: 4 }}>{ECHELON_DESC[form.echelon]}</div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--mil-text)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Personnel Breakdown
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[
                { label: "Officers",    val: form.officers,   key: "officers" as const },
                { label: "Other Ranks", val: form.otherRanks, key: "otherRanks" as const },
              ].map(({ label, val, key }) => (
                <div key={key}>
                  <label style={fieldLabel}>{label}</label>
                  <input type="number" style={milInput} value={val} min={0}
                    onChange={e => set({ [key]: Math.max(0, Number(e.target.value)) })} />
                </div>
              ))}
              <div>
                <label style={fieldLabel}>Total</label>
                <div style={{
                  padding: "5px 9px", background: "var(--mil-surface)",
                  border: "1px solid var(--mil-border-lt)", borderRadius: 2,
                  fontSize: 16, fontWeight: 700, color: "var(--mil-text)", textAlign: "center",
                }}>{totalPax}</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--mil-text-2)", marginTop: 4 }}>
              Typical for {ECHELON_LABELS[form.echelon]}: {paxMin.toLocaleString()} – {paxMax.toLocaleString()} pax
            </div>
          </div>

          <MilFormGroup label="Notes / Role">
            <MilTextArea value={form.notes} onChange={v => set({ notes: v })}
              placeholder="e.g. 6 x Off / 10 x OR" rows={3} />
          </MilFormGroup>

          {/* Equipment Type (ontology-linked) */}
          <div>
            <label style={fieldLabel}>Equipment Type (Ontology)</label>
            <EquipmentTypePicker value={equipmentType} onChange={setEquipmentType} />
          </div>

          {/* Command relationship to parent */}
          <div>
            <label style={fieldLabel}>Command Relationship to Parent</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {/* "default / organic" option */}
              {([
                "",
                "ORGANIC", "OPCON", "TACON", "ATTACHED", "ASSIGNED", "SUPPORTCON", "ADCON",
              ] as const).map(relType => {
                const isSelected = form.commandRelationshipType === relType;
                const colour = relType ? COMMAND_REL_COLOUR[relType as CommandRelationshipType] : null;
                return (
                  <button
                    key={relType}
                    type="button"
                    onClick={() => set({ commandRelationshipType: relType as CommandRelationshipType | "" })}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "7px 10px", borderRadius: 3, cursor: "pointer",
                      border: `1px solid ${isSelected ? (colour?.line ?? "var(--mil-olive)") : "var(--mil-border-lt)"}`,
                      background: isSelected ? (colour?.bg ?? "rgba(96,165,250,0.1)") : "var(--mil-bg-2)",
                      transition: "all 0.1s", textAlign: "left", width: "100%",
                    }}
                  >
                    {/* Colour swatch / line preview */}
                    <div style={{
                      width: 28, height: 3, borderRadius: 2, flexShrink: 0,
                      background: colour?.line ?? "#60a5fa",
                      border: relType === "TACON" ? `1px dotted ${colour?.line}` : undefined,
                      opacity: relType ? 1 : 0.3,
                      ...(relType === "OPCON" ? { borderBottom: `2px dashed ${colour?.line}`, background: "transparent", height: 0 } : {}),
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 700,
                        color: isSelected ? (colour?.badge ?? "var(--mil-text-1)") : "var(--mil-text-1)",
                      }}>
                        {relType ? COMMAND_REL_LABELS[relType as CommandRelationshipType] : "Organic (default)"}
                      </div>
                      {relType && (
                        <div style={{ fontSize: 9, color: "var(--mil-text-3)", marginTop: 1, lineHeight: 1.4 }}>
                          {COMMAND_REL_DESCRIPTION[relType as CommandRelationshipType]}
                        </div>
                      )}
                      {!relType && (
                        <div style={{ fontSize: 9, color: "var(--mil-text-3)", marginTop: 1 }}>
                          Permanently assigned — no special relationship indicator
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <span style={{
                        fontSize: 10, padding: "1px 6px", borderRadius: 2,
                        background: colour?.line ?? "var(--mil-olive)", color: "#fff", fontWeight: 700, flexShrink: 0,
                      }}>✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── SYMBOL TAB ── */}
      {activeTab === "symbol" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Live preview */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 0" }}>
            <NatoSymbol
              standardIdentity={side.standardIdentity} echelon={form.echelon} icon={form.icon}
              hq={form.hqIndicator as HqIndicator || undefined}
              sector1={form.sector1 as Sector1Modifier || undefined}
              sector2={form.sector2 as Sector2Modifier || undefined}
              reinforced={form.reinforced as "+" | "-" | "±" || undefined}
              status={form.symbolStatus as SymbolStatus || undefined}
              size={80}
              showSidc
            />
            <div style={{ fontSize: 9, color: "var(--mil-muted)", fontFamily: "monospace", letterSpacing: "0.05em" }}>
              APP-06(E)(2) · hover symbol for SIDC
            </div>
          </div>
          <div>
            <label style={fieldLabel}>Unit Function (icon)</label>
            <select style={milSelect} value={form.icon} onChange={e => set({ icon: e.target.value as UnitIconType })}>
              {ICON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <MilFormRow>
            <MilFormGroup label="Sector 1 – Capability (APP-6E)">
              <select style={milSelect} value={form.sector1} onChange={e => set({ sector1: e.target.value as Sector1Modifier | "" })}>
                <option value="">None</option>
                <option value="airborne">Airborne</option>
                <option value="airAssault">Air Assault</option>
                <option value="mountain">Mountain</option>
                <option value="amphibious">Amphibious</option>
                <option value="arctic">Arctic</option>
                <option value="light">Light</option>
                <option value="humint">HUMINT ★ (Edition E)</option>
                <option value="combinedCbrn">Combined CBRN ★ (Edition E)</option>
              </select>
            </MilFormGroup>
            <MilFormGroup label="Sector 2 – Mobility (APP-6E)">
              <select style={milSelect} value={form.sector2} onChange={e => set({ sector2: e.target.value as Sector2Modifier | "" })}>
                <option value="">None</option>
                <option value="wheeled">Wheeled</option>
                <option value="tracked">Tracked</option>
                <option value="towed">Towed</option>
                <option value="selfPropelled">Self-Propelled</option>
                <option value="motorised">Motorised</option>
                <option value="highMobility">High Mobility/Off-Road ★ (Edition E)</option>
              </select>
            </MilFormGroup>
          </MilFormRow>
          <MilFormRow>
            <MilFormGroup label="HQ / Task Force (SIDC digit 8)">
              <select style={milSelect} value={form.hqIndicator} onChange={e => set({ hqIndicator: e.target.value as HqIndicator | "" })}>
                <option value="">None</option>
                <option value="hq">HQ — Headquarters</option>
                <option value="taskForce">TF — Task Force</option>
                <option value="hqTaskForce">HQ TF — HQ + Task Force</option>
                <option value="feint">Feint</option>
                <option value="dummy">Dummy</option>
              </select>
            </MilFormGroup>
            <MilFormGroup label="Symbol Status (SIDC digit 7)">
              <select style={milSelect} value={form.symbolStatus} onChange={e => set({ symbolStatus: e.target.value as SymbolStatus | "" })}>
                <option value="">Present (default)</option>
                <option value="planned">Planned — dashed frame</option>
                <option value="damaged">Damaged</option>
                <option value="destroyed">Destroyed</option>
                <option value="fullCapacity">Full to Capacity</option>
              </select>
            </MilFormGroup>
          </MilFormRow>
          <MilFormRow>
            <MilFormGroup label="Reinforced / Reduced (Amplifier F)">
              <select style={milSelect} value={form.reinforced} onChange={e => set({ reinforced: e.target.value as "+" | "-" | "±" | "" })}>
                <option value="">— none —</option>
                <option value="+">+ Reinforced</option>
                <option value="-">- Reduced</option>
                <option value="±">± Both</option>
              </select>
            </MilFormGroup>
          </MilFormRow>
        </div>
      )}

      {/* ── CAPABILITIES TAB ── */}
      {activeTab === "capabilities" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            { label: "Call Sign",        key: "callSign",        placeholder: "e.g. SIGMA PHI" },
            { label: "Primary Weapon",   key: "primaryWeapon",   placeholder: "e.g. SA80A3" },
            { label: "IFF / SIF Code",   key: "iffCode",         placeholder: "e.g. 34534" },
            { label: "Speed Road km/h",  key: "speedRoadKph",    placeholder: "e.g. 67",  type: "number" },
            { label: "Speed Off-Road",   key: "speedOffRoadKph", placeholder: "e.g. 40",  type: "number" },
            { label: "Range km",         key: "rangeKm",         placeholder: "e.g. 546", type: "number" },
            { label: "Radio MHz",        key: "radioFreqMhz",    placeholder: "e.g. 456", type: "number" },
          ].map(({ label, key, placeholder, type }) => (
            <div key={key}>
              <label style={fieldLabel}>{label}</label>
              <input
                type={type ?? "text"} style={milInput}
                value={form[key as keyof FormState] as string}
                placeholder={placeholder}
                onChange={e => set({ [key]: e.target.value } as Partial<FormState>)}
              />
            </div>
          ))}
          <div>
            <label style={fieldLabel}>Combat Effectiveness</label>
            <select style={milSelect} value={form.combatEffectiveness}
              onChange={e => set({ combatEffectiveness: e.target.value })}>
              <option value="">— Unknown —</option>
              <option value="FO">FO – Fully Operational</option>
              <option value="SO">SO – Substantially Operational</option>
              <option value="MO">MO – Marginally Operational</option>
              <option value="NO">NO – Not Operational</option>
              <option value="UNK">UNK – Unknown</option>
            </select>
          </div>
        </div>
      )}

      {/* ── WEAPONS TAB ── */}
      {activeTab === "weapons" && <WeaponsEditor weapons={weapons} onChange={setWeapons} />}

      {/* ── PLATFORMS TAB ── */}
      {activeTab === "platforms" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 12, color: "var(--mil-text-2)", margin: 0, fontStyle: "italic" }}>
            Vehicles, aircraft, naval vessels — each platform has its own crew structure, weapons loadout, and sub-units.
          </p>
          <AssetEditor
            assets={assets}
            siblingUnits={existingNode?.children ?? []}
            onChange={setAssets}
          />
        </div>
      )}

      {/* ── PROPERTIES TAB ── */}
      {activeTab === "properties" && (
        <CustomPropertiesEditor
          properties={existingNode?.customProperties ?? []}
          onChange={props => {
            // Store updated custom properties into the submit callback via a closure ref
            pendingCustomPropsRef.current = props;
          }}
        />
      )}
      </div>{/* end tab content wrapper */}
    </MilModal>
  );
};

