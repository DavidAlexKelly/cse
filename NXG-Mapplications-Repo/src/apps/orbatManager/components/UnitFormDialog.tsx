/**
 * UnitFormDialog.tsx — Add / Edit a UnitNode in the Group Builder.
 *
 * Tabs:
 *   Core         — name, echelon, personnel count, notes
 *   Symbol       — icon, sector modifiers, HQ indicator, reinforced/reduced + milsymbol preview
 *   Catalogue    — canonical asset → VBS4/Sword simulator asset (via existing Foundry data)
 *   Capabilities — call sign, speed, range, IFF, combat effectiveness
 *
 * No hardcoded asset/weapon catalogues — all asset data comes from the
 * Foundry ontology via useCompositionData / loadVbs4AssetsForCanonical.
 *
 * Relationship chooser (child / sibling / parent-of) shown when adding a new
 * unit relative to a reference unit.
 */

import React, { useState, useEffect, useMemo } from "react";
import ms from "milsymbol";
import type { UnitNode, UnitIconType, EchelonLevel, OSimAsset } from "@/shared/types";
import { ECHELON_ORDER, ECHELON_LABELS, SIM_TARGET_LABELS } from "@/shared/types";
import { effectiveTargets, filterSelectableAssets } from "../../../shared/orbat/assetEligibility";
import {
  MilModal, MilFormGroup, MilFormRow,
  MilTextInput, MilTextArea, MilSelect,
} from "./shared/MilModal";
import { C } from "./shared/milStyles";
import { loadSimAssetsForTargets } from "@/shared/lib/foundry";
import type { CompositionRefData } from "@/shared/hooks/useCompositionData";

// ── Relationship mode ──────────────────────────────────────────────────────

export type RelationshipMode = "child" | "sibling" | "parent";

const REL_META: Record<RelationshipMode, { icon: string; label: string; color: string; desc: (ref: string) => string }> = {
  child:   { icon: "↓", label: "Child of",   color: C.cyanLt,  desc: (r) => `New unit reports to "${r}". Nested under it.` },
  sibling: { icon: "→", label: "Sibling of", color: C.oliveLt, desc: (r) => `Same level as "${r}", same parent.` },
  parent:  { icon: "↑", label: "Parent of",  color: C.amber,   desc: (r) => `New unit becomes the commander of "${r}".` },
};

// ── SIDC helpers ───────────────────────────────────────────────────────────

const AFF_CODES: Record<string, string> = { "Friend": "F", "Hostile": "H", "Neutral": "N", "Unknown": "U", "Assumed Friend": "A", "Suspect": "S" };

const ECH_CODES: Record<string, string> = {
  team: "B-", squad: "C-", section: "D-", platoon: "D-", company: "E-",
  battalion: "F-", regiment: "G-", brigade: "H-", division: "I-",
  corps: "J-", army: "K-", armyGroup: "K-", theatre: "L-",
};

const ICON_FUNC: Record<string, string> = {
  infantry: "UCI--", armour: "UCA--", mechanisedInfantry: "UCIZ-",
  artillery: "UCF--", rocketArtillery: "UCFR-", mortar: "UCFM-",
  aviation: "UCA--", airForce: "MFF--", reconnaissance: "UUSR-",
  cavalry: "UCAC-", engineer: "UCE--", pioneer: "UCE--",
  signals: "USS--", cyber: "USC--", ew: "USE--",
  logistics: "USM--", maintenance: "USM--", medical: "UMC--",
  airDefence: "UCAA-", specialForces: "UUSF-", sniper: "UUIS-",
  antiTank: "UCAT-", naval: "SS---", cbrn: "UXC--",
  military_police: "UMP--", headquarters: "UCI--", generic: "UCI--",
};

function buildSidc(affiliation: string, icon: UnitIconType, echelon: EchelonLevel): string {
  return `S${AFF_CODES[affiliation] ?? "F"}GPP${ICON_FUNC[icon] ?? "UCI--"}${ECH_CODES[echelon] ?? "--"}---`;
}

function MilSymbolPreview({ sidc, size = 72 }: { sidc: string; size?: number }) {
  const src = useMemo(() => {
    try {
      const svg = new ms.Symbol(sidc, { size, square: true, strokeWidth: 1.5 }).asSVG();
      if (svg && svg.length > 50) return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch { /* fall through */ }
    return "";
  }, [sidc, size]);
  if (!src) return <div style={{ width: size, height: size, background: C.surface, borderRadius: 4, flexShrink: 0 }} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <img src={src} width={size} height={size} alt="milsymbol preview" style={{ display: "block" }} />
      <div style={{ fontSize: 9, color: C.muted, fontFamily: "monospace", letterSpacing: "0.05em" }}>
        {sidc}
      </div>
    </div>
  );
}

// ── Icon options ───────────────────────────────────────────────────────────

const ICON_OPTIONS: { value: UnitIconType; label: string }[] = [
  { value: "infantry",           label: "Infantry" },
  { value: "armour",             label: "Armour" },
  { value: "mechanisedInfantry", label: "Mechanised Infantry" },
  { value: "artillery",          label: "Artillery" },
  { value: "rocketArtillery",    label: "Rocket Artillery" },
  { value: "mortar",             label: "Mortar" },
  { value: "aviation",           label: "Aviation" },
  { value: "airForce",           label: "Air Force" },
  { value: "reconnaissance",     label: "Reconnaissance" },
  { value: "cavalry",            label: "Cavalry" },
  { value: "engineer",           label: "Engineer" },
  { value: "pioneer",            label: "Pioneer" },
  { value: "signals",            label: "Signals" },
  { value: "cyber",              label: "Cyber" },
  { value: "ew",                 label: "Electronic Warfare" },
  { value: "logistics",          label: "Logistics" },
  { value: "maintenance",        label: "Maintenance" },
  { value: "medical",            label: "Medical" },
  { value: "airDefence",         label: "Air Defence" },
  { value: "specialForces",      label: "Special Forces" },
  { value: "sniper",             label: "Sniper" },
  { value: "antiTank",           label: "Anti-Tank" },
  { value: "naval",              label: "Naval" },
  { value: "cbrn",               label: "CBRN" },
  { value: "military_police",    label: "Military Police" },
  { value: "headquarters",       label: "Headquarters" },
  { value: "generic",            label: "Generic" },
];

const ECHELON_PAX: Record<EchelonLevel, [number, number]> = {
  team: [2, 6], squad: [6, 14], section: [8, 14], platoon: [28, 56],
  company: [80, 250], battalion: [300, 1200], regiment: [500, 3000],
  brigade: [3000, 8000], division: [10000, 25000], corps: [20000, 80000],
  army: [80000, 400000], armyGroup: [400000, 1000000], theatre: [1000000, 10000000],
};

// ── Form state ─────────────────────────────────────────────────────────────

type DialogTab = "core" | "symbol" | "catalogue" | "capabilities";

interface FormState {
  name: string;
  echelon: EchelonLevel;
  personnelCount: number;
  notes: string;
  icon: UnitIconType;
  sector1: string;
  sector2: string;
  hqIndicator: string;
  reinforced: string;
  symbolStatus: string;
  callSign: string;
  primaryWeapon: string;
  combatEffectiveness: string;
  speedRoadKph: string;
  speedOffRoadKph: string;
  rangeKm: string;
  iffCode: string;
  radioFreqMhz: string;
  // Catalogue linkage
  entityType: "organisation" | "vehicle" | "human" | "aircraft";
  militaryService: string;
  owningSimulator: string;
  canonicalAssetKey: string;
  /** The chosen simulator catalogue row — persisted to NxgUnit.simulatorIdentifierCode. */
  simulatorIdentifierCode: string;
  equipmentTypeKey: string;
}

function nodeToForm(node?: UnitNode, templatePreFill?: Record<string, unknown>): FormState {
  if (templatePreFill && !node) {
    return {
      name: (templatePreFill.name as string) ?? "",
      echelon: (templatePreFill.echelon as EchelonLevel) ?? "section",
      personnelCount: (templatePreFill.personnelCount as number) ?? 10,
      notes: (templatePreFill.notes as string) ?? "",
      icon: (templatePreFill.symbolIcon as UnitIconType) ?? "infantry",
      sector1: "", sector2: "", hqIndicator: "", reinforced: "", symbolStatus: "",
      callSign: "", primaryWeapon: "", combatEffectiveness: "",
      speedRoadKph: "", speedOffRoadKph: "", rangeKm: "", iffCode: "", radioFreqMhz: "",
      entityType: "organisation", militaryService: "Army", owningSimulator: "vbs4",
      canonicalAssetKey: "", simulatorIdentifierCode: "", equipmentTypeKey: "",
    };
  }
  return {
    name:                node?.name                               ?? "",
    echelon:             node?.echelon                            ?? "section",
    personnelCount:      node?.personnelCount                     ?? 10,
    notes:               node?.notes                              ?? "",
    icon:                (node?.symbol.icon as UnitIconType)      ?? "infantry",
    sector1:             node?.symbol.sector1                     ?? "",
    sector2:             node?.symbol.sector2                     ?? "",
    hqIndicator:         node?.symbol.hqIndicator                 ?? "",
    reinforced:          node?.symbol.reinforced                  ?? "",
    symbolStatus:        node?.symbol.status                      ?? "",
    callSign:            node?.capabilities.callSign              ?? "",
    primaryWeapon:       node?.capabilities.primaryWeapon         ?? "",
    combatEffectiveness: node?.capabilities.combatEffectiveness   ?? "",
    speedRoadKph:        String(node?.capabilities.speedRoadKph    ?? ""),
    speedOffRoadKph:     String(node?.capabilities.speedOffRoadKph ?? ""),
    rangeKm:             String(node?.capabilities.rangeKm         ?? ""),
    iffCode:             node?.capabilities.iffCode               ?? "",
    radioFreqMhz:        String(node?.capabilities.radioFreqMhz    ?? ""),
    entityType:              "organisation",
    militaryService:         "Army",
    owningSimulator:         "vbs4",
    canonicalAssetKey:       node?.canonicalAssetKey              ?? "",
    simulatorIdentifierCode: node?.simulatorIdentifierCode        ?? "",
    equipmentTypeKey:        node?.equipmentTypeKey               ?? "",
  };
}

// ── Shared input style ─────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  padding: "5px 8px", background: C.surface, border: `1px solid ${C.borderLt}`,
  borderRadius: 3, color: C.text, fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box",
};

// ── Catalogue tab component ────────────────────────────────────────────────
// Lifted out so it can manage its own async VBS4 fetch

const CatalogueTab: React.FC<{
  refData: CompositionRefData;
  entityType: "organisation" | "vehicle" | "human" | "aircraft";
  militaryService: string;
  owningSimulator: string;
  canonicalAssetKey: string;
  simulatorIdentifierCode: string;
  equipmentTypeKey: string;
  onEntityTypeChange: (v: "organisation" | "vehicle" | "human" | "aircraft") => void;
  onMilitaryServiceChange: (v: string) => void;
  onOwningSimulatorChange: (v: string) => void;
  onCanonicalChange: (key: string) => void;
  onSimulatorAssetChange: (identifier: string) => void;
  onEquipmentChange: (key: string) => void;
}> = ({ refData, entityType, militaryService, owningSimulator, canonicalAssetKey, simulatorIdentifierCode, equipmentTypeKey, onEntityTypeChange, onMilitaryServiceChange, onOwningSimulatorChange, onCanonicalChange, onSimulatorAssetChange, onEquipmentChange }) => {

  const [assetSearch,       setAssetSearch]       = useState("");
  const [filterNationality, setFilterNationality] = useState("");
  const [filterCategory,    setFilterCategory]    = useState("");
  const [simAssets,         setSimAssets]         = useState<OSimAsset[]>([]);
  const [simLoading,        setSimLoading]        = useState(false);

  const targets = useMemo(
    () => effectiveTargets({ entityType, owningSimulator }),
    [entityType, owningSimulator],
  );
  const targetLabel = useMemo(() => targets.map((t) => SIM_TARGET_LABELS[t]).join(" / "), [targets]);

  // Fetch the concrete simulator models when the canonical selection changes
  useEffect(() => {
    if (!canonicalAssetKey || !targets.length) { setSimAssets([]); return; }
    let cancelled = false;
    setSimLoading(true);
    loadSimAssetsForTargets(canonicalAssetKey, targets)
      .then((a) => { if (!cancelled) setSimAssets(a.sort((x, y) => x.identifier.localeCompare(y.identifier))); })
      .catch(() => { if (!cancelled) setSimAssets([]); })
      .finally(() => { if (!cancelled) setSimLoading(false); });
    return () => { cancelled = true; };
  }, [canonicalAssetKey, targets]);

  const allAssets = useMemo(() => [...refData.canonicalAssets.values()], [refData.canonicalAssets]);

  // Only assets the target simulator can actually spawn. There is no
  // "show everything if the filter is empty" fallback here any more — that is
  // what let planners attach assets no simulator carries.
  const selectableAssets = useMemo(
    () => filterSelectableAssets(allAssets, entityType, undefined, owningSimulator),
    [allAssets, entityType, owningSimulator],
  );

  // Cosmetic narrowing on the catalogue's free-text Category/Domain, applied on
  // top of the hard filter and skipped when it would hide everything.
  const typeFiltered = useMemo(() => {
    if (entityType === "organisation" && !targets.length) return [];
    const filtered = selectableAssets.filter((a) => {
      const cat = a.assetCategory?.toLowerCase() ?? "";
      const dom = a.militaryDomain?.toLowerCase() ?? "";
      if (entityType === "vehicle") return cat.includes("vehicle") || cat.includes("ground") || dom.includes("ground");
      if (entityType === "aircraft") return cat.includes("aircraft") || cat.includes("air") || cat.includes("uav") || dom.includes("air");
      if (entityType === "human") return cat.includes("human") || cat.includes("infantry") || cat.includes("dismount") || dom.includes("ground");
      return true;
    });
    return (filtered.length > 0 ? filtered : selectableAssets).sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
  }, [selectableAssets, targets, entityType]);

  const nationalities = useMemo(() => [...new Set(typeFiltered.map((a) => a.nationality).filter(Boolean))].sort(), [typeFiltered]);
  const categories    = useMemo(() => [...new Set(typeFiltered.map((a) => a.assetCategory).filter(Boolean))].sort(), [typeFiltered]);

  const visible = useMemo(() => {
    let list = typeFiltered;
    if (filterNationality) list = list.filter((a) => a.nationality === filterNationality);
    if (filterCategory)    list = list.filter((a) => a.assetCategory === filterCategory);
    if (assetSearch.trim()) {
      const q = assetSearch.trim().toLowerCase();
      list = list.filter((a) => a.canonicalName.toLowerCase().includes(q) || a.simulationClass?.toLowerCase().includes(q));
    }
    return list;
  }, [typeFiltered, filterNationality, filterCategory, assetSearch]);

  const selectedCanonical = canonicalAssetKey ? refData.canonicalAssets.get(canonicalAssetKey) ?? null : null;
  const unitTypes    = useMemo(() => [...refData.unitTypes.values()], [refData.unitTypes]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ padding: "8px 10px", background: C.surface, border: `1px solid ${C.borderLt}`, borderLeft: `3px solid ${C.cyan}`, borderRadius: 2, fontSize: 11, color: C.text2, lineHeight: 1.5 }}>
        Link this unit to the <strong style={{ color: C.text }}>canonical asset catalogue</strong> to associate it with a VBS4, Sword, or SimWorks simulator asset.
        <br />Only needed for vehicle, aircraft, or human entity types.
      </div>

      <MilFormRow>
        <MilFormGroup label="Entity Type">
          <select value={entityType} onChange={(e) => { onEntityTypeChange(e.target.value as typeof entityType); onCanonicalChange(""); onEquipmentChange(""); }} style={inp}>
            {(["organisation", "vehicle", "human", "aircraft"] as const).map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </MilFormGroup>
        <MilFormGroup label="Military Service">
          <select value={militaryService} onChange={(e) => onMilitaryServiceChange(e.target.value)} style={inp}>
            {["Army", "Navy", "Air Force", "Marines", "Special Operations Force"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </MilFormGroup>
      </MilFormRow>

      <MilFormGroup label="Owning Simulator">
        {/* Decides which catalogue applies, so it has to be set before the
            asset list means anything. */}
        <select value={owningSimulator} onChange={(e) => { onOwningSimulatorChange(e.target.value); onCanonicalChange(""); onSimulatorAssetChange(""); }} style={inp}>
          {["vbs4", "sword", "simworks", "none"].map((s) => (
            <option key={s} value={s}>{s === "none" ? "none (not federated)" : SIM_TARGET_LABELS[s as keyof typeof SIM_TARGET_LABELS] ?? s}</option>
          ))}
        </select>
      </MilFormGroup>

      {/* Unit type (organisations only) */}
      {entityType === "organisation" && unitTypes.length > 0 && (
        <MilFormGroup label="Unit Type">
          <select value={equipmentTypeKey} onChange={(e) => onEquipmentChange(e.target.value)} style={inp}>
            <option value="">— None —</option>
            {unitTypes.map((t) => (
              <option key={t.primaryKey} value={t.primaryKey}>
                {t.unitType}{t.abbreviatedUnitType ? ` (${t.abbreviatedUnitType})` : ""}
              </option>
            ))}
          </select>
        </MilFormGroup>
      )}

      {/* Canonical asset (non-organisations) */}
      {entityType !== "organisation" && (
        <>
          <MilFormGroup label={`Canonical Asset${typeFiltered.length > 0 ? ` (${visible.length}/${typeFiltered.length})` : ""}`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 4 }}>
              <input value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)} placeholder="Search name or sim class…" style={inp} />
              <div style={{ display: "flex", gap: 4 }}>
                <select value={filterNationality} onChange={(e) => setFilterNationality(e.target.value)} style={{ ...inp, flex: 1, fontSize: 11 }}>
                  <option value="">All nationalities</option>
                  {nationalities.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={{ ...inp, flex: 1, fontSize: 11 }}>
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <select value={canonicalAssetKey} onChange={(e) => { onCanonicalChange(e.target.value); onSimulatorAssetChange(""); }} style={{ ...inp, height: 90 }} size={5}>
              <option value="">— None —</option>
              {visible.map((a) => (
                <option key={a.primaryKey} value={a.primaryKey}>
                  {a.canonicalName}{a.nationality ? ` · ${a.nationality}` : ""}
                </option>
              ))}
            </select>
            {refData.canonicalAssets.size === 0 && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>No canonical assets loaded from Foundry</div>
            )}
            {refData.canonicalAssets.size > 0 && selectableAssets.length === 0 && targets.length > 0 && (
              <div style={{ fontSize: 10, color: C.amber, marginTop: 3, lineHeight: 1.4 }}>
                Nothing in the catalogue can be spawned as a {entityType} in {targetLabel}. Change the entity type or the owning simulator.
              </div>
            )}
            {selectableAssets.length > 0 && targets.length > 0 && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
                {selectableAssets.length} of {refData.canonicalAssets.size} assets can be spawned in {targetLabel}.
              </div>
            )}
          </MilFormGroup>

          {/* The concrete simulator model. Written to simulatorIdentifierCode,
              which is the FK the export resolves — NOT equipmentTypeKey, which
              is the link to real-world equipment nomenclature. */}
          {canonicalAssetKey && targets.length > 0 && (
            <MilFormGroup label={simLoading ? `${targetLabel} Model (loading…)` : simAssets.length > 0 ? `${targetLabel} Model (${simAssets.length} available)` : `${targetLabel} Model (none found)`}>
              {simAssets.length > 0
                ? (
                  <select value={simulatorIdentifierCode} onChange={(e) => onSimulatorAssetChange(e.target.value)} style={inp}>
                    <option value="">— Choose a model —</option>
                    {simAssets.map((a) => (
                      <option key={`${a.simulator}:${a.identifier}`} value={a.identifier}>
                        {a.displayName}{a.description ? ` — ${a.description}` : ""}
                      </option>
                    ))}
                  </select>
                )
                : (
                  <div style={{ fontSize: 11, color: C.muted, padding: "4px 0", fontStyle: "italic" }}>
                    {simLoading ? "Loading…" : `No ${targetLabel} model is linked to "${selectedCanonical?.canonicalName ?? canonicalAssetKey}"`}
                  </div>
                )
              }
              {selectedCanonical?.simulationClass && (
                <div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace", marginTop: 2 }}>
                  sim class: {selectedCanonical.simulationClass}
                </div>
              )}
            </MilFormGroup>
          )}
        </>
      )}
    </div>
  );
};

// ── Main dialog component ─────────────────────────────────────────────────

export interface UnitFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: Record<string, unknown>, relationshipMode?: RelationshipMode) => void;
  existingNode?: UnitNode;
  templatePreFill?: Record<string, unknown>;
  parentName?: string | null;
  defaultRelMode?: RelationshipMode;
  /** Affiliation of the owning group — used to derive SIDC */
  affiliation: string;
  /** Foundry reference data for catalogue tab */
  refData: CompositionRefData;
}

export const UnitFormDialog: React.FC<UnitFormDialogProps> = ({
  isOpen, onClose, onSubmit, existingNode, templatePreFill, parentName, defaultRelMode, affiliation, refData,
}) => {
  const [form,      setForm]      = useState<FormState>(() => nodeToForm(existingNode, templatePreFill));
  const [activeTab, setActiveTab] = useState<DialogTab>("core");
  const [relMode,   setRelMode]   = useState<RelationshipMode>(defaultRelMode ?? "child");

  useEffect(() => {
    if (isOpen) {
      setForm(nodeToForm(existingNode, templatePreFill));
      setActiveTab("core");
      setRelMode(defaultRelMode ?? "child");
    }
  }, [isOpen, existingNode, templatePreFill, defaultRelMode]);

  if (!isOpen) return null;

  const set = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const isAdding = !existingNode;

  // Derive SIDC from current form for live preview
  const currentSidc = buildSidc(affiliation, form.icon, form.echelon);

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    onSubmit({
      name: form.name.trim(), echelon: form.echelon,
      personnelCount: form.personnelCount, notes: form.notes,
      symbolIcon: form.icon,
      sector1: form.sector1 || undefined, sector2: form.sector2 || undefined,
      hqIndicator: form.hqIndicator || undefined, reinforced: form.reinforced || undefined,
      symbolStatus: form.symbolStatus || undefined,
      capabilities: {
        callSign: form.callSign || undefined, primaryWeapon: form.primaryWeapon || undefined,
        combatEffectiveness: form.combatEffectiveness || undefined,
        speedRoadKph:    form.speedRoadKph    ? Number(form.speedRoadKph)    : undefined,
        speedOffRoadKph: form.speedOffRoadKph ? Number(form.speedOffRoadKph) : undefined,
        rangeKm:         form.rangeKm         ? Number(form.rangeKm)         : undefined,
        iffCode: form.iffCode || undefined,
        radioFreqMhz: form.radioFreqMhz ? Number(form.radioFreqMhz) : undefined,
      },
      canonicalAssetKey:       form.canonicalAssetKey       || null,
      simulatorIdentifierCode: form.simulatorIdentifierCode || null,
      owningSimulator:         form.owningSimulator,
      equipmentTypeKey:        form.equipmentTypeKey        || null,
    }, isAdding ? relMode : undefined);
    onClose();
  };

  const TABS: { id: DialogTab; label: string }[] = [
    { id: "core",         label: "Core" },
    { id: "symbol",       label: "Symbol" },
    { id: "catalogue",    label: "Catalogue" },
    { id: "capabilities", label: "Capabilities" },
  ];

  const [paxMin, paxMax] = ECHELON_PAX[form.echelon] ?? [0, 99999];

  return (
    <MilModal
      title={existingNode ? `Edit — ${existingNode.name}` : parentName ? `New Unit — ${REL_META[relMode].label} ${parentName}` : "Add Root Unit"}
      onClose={onClose}
      actions={[
        { label: "Cancel",                              variant: "default", onClick: onClose },
        { label: existingNode ? "Save Changes" : "Add Unit", variant: "primary", disabled: !form.name.trim(), onClick: handleSubmit },
      ]}
    >
      {/* Relationship picker — only when adding relative to an existing unit */}
      {isAdding && parentName && (
        <div style={{ margin: "-16px -16px 0", padding: "12px 16px", background: C.bg, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Relationship to <strong style={{ color: C.text }}>{parentName}</strong>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["child", "sibling", "parent"] as RelationshipMode[]).map((mode) => {
              const meta = REL_META[mode];
              const active = relMode === mode;
              return (
                <button key={mode} onClick={() => setRelMode(mode)} style={{
                  flex: 1, display: "flex", flexDirection: "column", gap: 4, padding: "10px 10px",
                  borderRadius: 2, cursor: "pointer", textAlign: "left",
                  background: active ? `${meta.color}18` : C.surface,
                  border: `2px solid ${active ? meta.color : C.border}`,
                  transition: "all 0.1s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: meta.color, width: 22, textAlign: "center" }}>{meta.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: active ? C.text : C.text2 }}>{meta.label}</span>
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4, paddingLeft: 28 }}>{meta.desc(parentName)}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: "flex", margin: "-16px -16px 0", borderBottom: `1px solid ${C.border}`, background: C.bg2, overflowX: "auto", flexShrink: 0, position: "sticky", top: 0, zIndex: 2 }}>
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: "9px 16px", background: "none", border: "none", cursor: "pointer",
            fontSize: 11, fontWeight: activeTab === tab.id ? 700 : 400, whiteSpace: "nowrap",
            color: activeTab === tab.id ? C.oliveLt : C.text2,
            borderBottom: activeTab === tab.id ? `2px solid ${C.olive}` : "2px solid transparent",
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ paddingTop: 16 }}>

        {/* ── CORE ── */}
        {activeTab === "core" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <MilFormGroup label="Unit Name">
              <MilTextInput value={form.name} onChange={(v) => set({ name: v })} placeholder="e.g. Battalion HQ" autoFocus />
            </MilFormGroup>

            <MilFormGroup label="Echelon">
              <MilSelect value={form.echelon} onChange={(v) => set({ echelon: v as EchelonLevel })} options={ECHELON_ORDER.map((e) => ({ value: e, label: ECHELON_LABELS[e] }))} />
            </MilFormGroup>

            <MilFormRow>
              <MilFormGroup label="Personnel Count">
                <input type="number" min={0} value={form.personnelCount} onChange={(e) => set({ personnelCount: Math.max(0, Number(e.target.value)) })} style={inp} />
              </MilFormGroup>
              <MilFormGroup label="Typical range" compact>
                <div style={{ padding: "6px 0", fontSize: 11, color: C.muted }}>
                  {paxMin.toLocaleString()} – {paxMax.toLocaleString()} pax
                </div>
              </MilFormGroup>
            </MilFormRow>

            <MilFormGroup label="Notes / Role">
              <MilTextArea value={form.notes} onChange={(v) => set({ notes: v })} placeholder="e.g. HQ element, primary ATGM platoon" rows={3} />
            </MilFormGroup>
          </div>
        )}

        {/* ── SYMBOL ── */}
        {activeTab === "symbol" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <MilSymbolPreview sidc={currentSidc} size={80} />
            </div>

            <MilFormGroup label="Unit Function (Icon)">
              <select value={form.icon} onChange={(e) => set({ icon: e.target.value as UnitIconType })} style={inp}>
                {ICON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </MilFormGroup>

            <MilFormRow>
              <MilFormGroup label="Sector 1 — Capability">
                <select value={form.sector1} onChange={(e) => set({ sector1: e.target.value })} style={inp}>
                  <option value="">None</option>
                  <option value="airborne">Airborne</option>
                  <option value="airAssault">Air Assault</option>
                  <option value="mountain">Mountain</option>
                  <option value="amphibious">Amphibious</option>
                  <option value="arctic">Arctic</option>
                  <option value="light">Light</option>
                  <option value="humint">HUMINT</option>
                  <option value="combinedCbrn">Combined CBRN</option>
                </select>
              </MilFormGroup>
              <MilFormGroup label="Sector 2 — Mobility">
                <select value={form.sector2} onChange={(e) => set({ sector2: e.target.value })} style={inp}>
                  <option value="">None</option>
                  <option value="wheeled">Wheeled</option>
                  <option value="tracked">Tracked</option>
                  <option value="towed">Towed</option>
                  <option value="selfPropelled">Self-Propelled</option>
                  <option value="motorised">Motorised</option>
                  <option value="highMobility">High Mobility</option>
                </select>
              </MilFormGroup>
            </MilFormRow>

            <MilFormRow>
              <MilFormGroup label="HQ / Task Force">
                <select value={form.hqIndicator} onChange={(e) => set({ hqIndicator: e.target.value })} style={inp}>
                  <option value="">None</option>
                  <option value="hq">HQ — Headquarters</option>
                  <option value="taskForce">TF — Task Force</option>
                  <option value="hqTaskForce">HQ TF — Both</option>
                  <option value="feint">Feint</option>
                  <option value="dummy">Dummy</option>
                </select>
              </MilFormGroup>
              <MilFormGroup label="Symbol Status">
                <select value={form.symbolStatus} onChange={(e) => set({ symbolStatus: e.target.value })} style={inp}>
                  <option value="">Present (default)</option>
                  <option value="planned">Planned — dashed frame</option>
                  <option value="damaged">Damaged</option>
                  <option value="destroyed">Destroyed</option>
                </select>
              </MilFormGroup>
            </MilFormRow>

            <MilFormGroup label="Reinforced / Reduced">
              <select value={form.reinforced} onChange={(e) => set({ reinforced: e.target.value })} style={inp}>
                <option value="">None</option>
                <option value="+">+ Reinforced</option>
                <option value="-">- Reduced</option>
                <option value="±">± Both</option>
              </select>
            </MilFormGroup>
          </div>
        )}

        {/* ── CATALOGUE ── */}
        {activeTab === "catalogue" && (
          <CatalogueTab
            refData={refData}
            entityType={form.entityType}
            militaryService={form.militaryService}
            owningSimulator={form.owningSimulator}
            canonicalAssetKey={form.canonicalAssetKey}
            simulatorIdentifierCode={form.simulatorIdentifierCode}
            equipmentTypeKey={form.equipmentTypeKey}
            onEntityTypeChange={(v) => set({ entityType: v, canonicalAssetKey: "", simulatorIdentifierCode: "", equipmentTypeKey: "" })}
            onMilitaryServiceChange={(v) => set({ militaryService: v })}
            onOwningSimulatorChange={(v) => set({ owningSimulator: v, canonicalAssetKey: "", simulatorIdentifierCode: "" })}
            onCanonicalChange={(k) => set({ canonicalAssetKey: k, simulatorIdentifierCode: "" })}
            onSimulatorAssetChange={(k) => set({ simulatorIdentifierCode: k })}
            onEquipmentChange={(k) => set({ equipmentTypeKey: k })}
          />
        )}

        {/* ── CAPABILITIES ── */}
        {activeTab === "capabilities" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: "Call Sign",       key: "callSign",        placeholder: "e.g. SIGMA PHI",  type: "text" },
              { label: "Primary Weapon",  key: "primaryWeapon",   placeholder: "e.g. SA80A3",     type: "text" },
              { label: "IFF / SIF Code",  key: "iffCode",         placeholder: "e.g. 34534",      type: "text" },
              { label: "Speed Road km/h", key: "speedRoadKph",    placeholder: "e.g. 67",         type: "number" },
              { label: "Speed Off-Road",  key: "speedOffRoadKph", placeholder: "e.g. 40",         type: "number" },
              { label: "Range km",        key: "rangeKm",         placeholder: "e.g. 546",        type: "number" },
              { label: "Radio MHz",       key: "radioFreqMhz",    placeholder: "e.g. 456",        type: "number" },
            ].map(({ label, key, placeholder, type }) => (
              <div key={key}>
                <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: C.muted, marginBottom: 4, display: "block" }}>{label}</label>
                <input type={type} placeholder={placeholder} value={form[key as keyof FormState] as string}
                  onChange={(e) => set({ [key]: e.target.value } as Partial<FormState>)} style={inp} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: C.muted, marginBottom: 4, display: "block" }}>Combat Effectiveness</label>
              <select value={form.combatEffectiveness} onChange={(e) => set({ combatEffectiveness: e.target.value })} style={inp}>
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
      </div>
    </MilModal>
  );
};
