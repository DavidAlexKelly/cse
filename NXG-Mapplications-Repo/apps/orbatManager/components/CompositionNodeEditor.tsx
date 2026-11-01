// components/CompositionNodeEditor.tsx
import React, { useMemo, useState, useEffect } from "react";
import ms from "milsymbol";
import type { CompositionNode, OSimAsset } from "../../../types";
import { SIM_TARGET_LABELS } from "../../../types";
import type { CompositionRefData } from "../hooks/useCompositionData";
import { loadSimAssetsForTargets } from "../lib/foundry";
import {
  assetIneligibleReason,
  effectiveTargets,
  filterSelectableAssets,
} from "../../../shared/orbat/assetEligibility";
import {
  SIDC_AFF_CODES,
  ECHELON_TO_SIDC_CHAR,
  SIDC_CHAR_TO_ECHELON,
  ENTITY_BATTLE_DIM,
  ENTITY_DEFAULT_FUNC6,
  parseSidc,
  buildSidc,
} from "../lib/sidc";

interface Props {
  node: CompositionNode;
  refData: CompositionRefData;
  onChange: (updates: Partial<CompositionNode>) => void;
  /** Echelon of the parent node — used to constrain the echelon dropdown */
  parentEchelon?: string;
  /** The direct parent node, for display */
  parentNode?: CompositionNode;
  /** Called when the user clicks a related node to navigate to it */
  onSelectNode?: (id: string) => void;
}

// All SIDC constants and helpers are imported from lib/sidc.ts (no circular deps)
const AFFILIATION_CODES = SIDC_AFF_CODES;
const AFFILIATION_FROM_CODE: Record<string, string> = {
  "F": "Friend", "H": "Hostile", "N": "Neutral", "U": "Unknown",
  "A": "Assumed Friend", "S": "Suspect",
};

// ── Echelon hierarchy rules (mirrors CompositionBuilder) ─────────────────────
// Defines valid CHILD echelons for each parent echelon.
const ECHELON_CHILDREN: Record<string, string[]> = {
  "army group":  ["Field Army", "Corps"],
  "field army":  ["Corps"],
  "corps":       ["Division"],
  "division":    ["Brigade", "Regiment", "Squadron", "Wing"],
  "brigade":     ["Regiment", "Battalion", "Squadron", "Group", "Wing"],
  "regiment":    ["Battalion", "Squadron", "Battery", "Troop", "Group"],
  "battalion":   ["Company", "Battery", "Squadron", "Flight", "Troop"],
  "company":     ["Platoon", "Flight"],
  "battery":     ["Platoon", "Section"],
  "squadron":    ["Troop", "Flight", "Platoon"],
  "troop":       ["Platoon", "Section"],
  "wing":        ["Group", "Squadron"],
  "group":       ["Squadron"],
  "flight":      ["Element", "Section", "Crew"],
  "platoon":     ["Squad", "Section", "Element", "Crew"],
  "squad":       ["Fireteam", "Team", "Crew", "Section"],
  "fireteam":    ["Crew"],
  "team":        ["Crew"],
  "section":     ["Gun", "Crew", "Fireteam", "Team"],
  "element":     ["Crew"],
  "crew":        [],
  "gun":         [],
};

const ALL_ECHELONS_ORDERED = [
  "", "Crew", "Gun", "Fireteam", "Team", "Element", "Squad", "Section",
  "Platoon", "Flight", "Detachment",
  "Company", "Battery", "Troop",
  "Battalion", "Squadron",
  "Regiment", "Group",
  "Brigade", "Wing",
  "Division", "Corps", "Field Army", "Army Group", "Command",
];

/** Return the echelons available for this node given parent echelon */
function echelonOptions(parentEchelon?: string): string[] {
  if (!parentEchelon) return ALL_ECHELONS_ORDERED;
  const pNorm = parentEchelon.toLowerCase().trim();
  const children = ECHELON_CHILDREN[pNorm];
  if (!children) return ALL_ECHELONS_ORDERED; // unknown parent → show all
  return children;
}

const ENTITY_TYPES = ["organisation", "vehicle", "human", "aircraft"] as const;
const MILITARY_SERVICES = ["Army", "Navy", "Air Force", "Marines", "Coast Guard", "Special Operations Force", "Joint"];
const AFFILIATIONS = ["Friend", "Hostile", "Neutral", "Unknown", "Assumed Friend", "Suspect"];
// "simworks" was missing here even though 54 units in the ontology are owned by
// SIMWORKS and it has 391 catalogue entries — so those units could not be
// represented correctly from this editor at all.
const SIMULATORS = ["vbs4", "sword", "simworks", "none"];

// Common SIDC presets — 20-digit MIL-STD-2525D / APP-6D numeric format
// Structure: VV AA SS ST EE EEEEEE MM MM
//   VV=10 (version), AA=03 (friendly), SS=10 (land unit), ST=00 (present)
//   EE = echelon (11=team 12=squad 13=section 14=platoon 15=coy 16=bn 17=regt 18=bde 19=div)
//   EEEEEE = entity code, MM MM = modifiers

const AFF_COLOURS: Record<string, string> = {
  Friend: "#5B9BD5", Hostile: "#E74C3C", Neutral: "#27AE60",
  Unknown: "#F1C40F", "Assumed Friend": "#9ab8d8", Suspect: "#e07070",
};

const ENTITY_COLOURS: Record<string, string> = {
  organisation: "#3B5BA5",
  vehicle:      "#2E7D32",
  human:        "#CE93D8",
  aircraft:     "#E65100",
};

// ── Domain mapping helpers ─────────────────────────────────────────────────
// Map entity type + militaryService to rough filters for canonical assets
function canonicalDomainFilter(entityType: string, militaryService: string) {
  if (entityType === "aircraft") return (d: string) => d?.toLowerCase().includes("air");
  if (entityType === "vehicle") {
    if (militaryService === "NAVY") return (d: string) => d?.toLowerCase().includes("sea") || d?.toLowerCase().includes("naval");
    return (d: string) => d?.toLowerCase().includes("ground") || d?.toLowerCase().includes("land");
  }
  if (entityType === "human") return (d: string) => d?.toLowerCase().includes("ground") || d?.toLowerCase().includes("land") || d?.toLowerCase().includes("infantry");
  return () => true;
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function EditModal({
  node,
  refData,
  parentEchelon,
  onSave,
  onClose,
}: {
  node: CompositionNode;
  refData: CompositionRefData;
  parentEchelon?: string;
  onSave: (updates: Partial<CompositionNode>) => void;
  onClose: () => void;
}) {
  const availableEchelons = useMemo(() => echelonOptions(parentEchelon), [parentEchelon]);
  const parsed = useMemo(() => parseSidc(node.sidc), [node.sidc]);

  const sidcAffiliation = parsed ? (AFFILIATION_FROM_CODE[parsed.affiliation] ?? node.affiliation) : node.affiliation;
  const sidcEchelon = parsed ? (SIDC_CHAR_TO_ECHELON[parsed.echelonChar] ?? node.echelon) : node.echelon;

  // Local draft state
  const [draft, setDraft] = useState<Partial<CompositionNode>>({
    unitIdentifier: node.unitIdentifier,
    sidc: node.sidc,
    entityType: node.entityType,
    affiliation: sidcAffiliation,
    echelon: sidcEchelon,
    militaryService: node.militaryService,
    allegiance: node.allegiance,
    owningSimulator: node.owningSimulator,
    quantity: node.quantity,
    unitTypeKey: node.unitTypeKey,
    equipmentTypeKey: node.equipmentTypeKey,
    canonicalAssetKey: node.canonicalAssetKey,
  });

  const currentAff  = draft.affiliation ?? sidcAffiliation;
  const currentType = draft.entityType  ?? node.entityType;
  const currentEch  = draft.echelon     ?? sidcEchelon;

  /** Recompute a valid SIDC when affiliation, entity type, or echelon changes */
  function updateSidcFrom(updates: { affiliation?: string; entityType?: string; echelon?: string }) {
    const newAff  = updates.affiliation ?? currentAff;
    const newType = updates.entityType  ?? currentType;
    const newEch  = updates.echelon     ?? currentEch;

    const affCode     = AFFILIATION_CODES[newAff] ?? "F";
    const battleDim   = ENTITY_BATTLE_DIM[newType] ?? "GP";
    const echelonChar = ECHELON_TO_SIDC_CHAR[newEch] ?? ECHELON_TO_SIDC_CHAR[newEch?.toLowerCase()] ?? "-";

    // Preserve the existing function ID when only affiliation/echelon change;
    // reset to entity-type default when the battle dimension changes.
    const currentFunc = parsed?.functionId ?? ENTITY_DEFAULT_FUNC6[node.entityType];
    const dimChanged  = updates.entityType && ENTITY_BATTLE_DIM[updates.entityType] !== parsed?.battleDim;
    const funcId6     = dimChanged ? (ENTITY_DEFAULT_FUNC6[newType] ?? "UCI---") : (currentFunc ?? "UCI---");

    return buildSidc(affCode, battleDim, funcId6, echelonChar);
  }

  function set(updates: Partial<CompositionNode>) {
    setDraft((prev) => ({ ...prev, ...updates }));
  }

  const currentSimulator = draft.owningSimulator ?? node.owningSimulator;

  // The simulators this unit has to be instantiable in. Empty = structural or
  // unfederated, in which case no asset is required.
  const targets = useMemo(
    () => effectiveTargets({ entityType: currentType, owningSimulator: currentSimulator }),
    [currentType, currentSimulator],
  );
  const targetLabel = useMemo(
    () => targets.map((t) => SIM_TARGET_LABELS[t]).join(" / "),
    [targets],
  );

  /** Live verdict on the draft, so the planner sees the problem before saving. */
  const draftIssue = useMemo(
    () => assetIneligibleReason({ ...node, ...draft } as CompositionNode, refData.canonicalAssets),
    [node, draft, refData.canonicalAssets],
  );

  // ── Canonical asset filtering ──────────────────────────────────────────
  //
  // Two stages, and the order matters:
  //   1. HARD  — only assets the target simulator actually carries. No
  //              fallback: if this is empty the list stays empty. The previous
  //              `filtered.length ? filtered : all` fallback is exactly how
  //              unusable assets ended up in ORBATs.
  //   2. SOFT  — entity-type/domain heuristics over the catalogue's free-text
  //              Category/Domain, purely to shorten the list. Skipped when it
  //              would hide everything, because the data is inconsistent.
  const selectableAssets = useMemo(
    () => filterSelectableAssets(refData.canonicalAssets.values(), currentType, undefined, currentSimulator),
    [refData.canonicalAssets, currentType, currentSimulator],
  );

  const filteredCanonicalAssets = useMemo(() => {
    if (currentType === "organisation" && !targets.length) return [];
    const domainFilter = canonicalDomainFilter(currentType, draft.militaryService ?? node.militaryService);
    const narrowed = selectableAssets.filter((a) => {
      const cat = a.assetCategory?.toLowerCase() ?? "";
      const dom = a.militaryDomain?.toLowerCase() ?? "";
      if (currentType === "human" && (cat.includes("human") || cat.includes("infantry") || cat.includes("dismount"))) return true;
      if (currentType === "vehicle" && (cat.includes("vehicle") || cat.includes("ground"))) return true;
      if (currentType === "aircraft" && (cat.includes("aircraft") || cat.includes("air") || cat.includes("rotary") || cat.includes("uav"))) return true;
      return domainFilter(dom);
    });
    return narrowed.length > 0 ? narrowed : selectableAssets;
  }, [selectableAssets, targets, currentType, draft.militaryService, node.militaryService]);

  // ── Simulator assets — fetched on-demand via the ontology links ──────────
  const [simAssets, setSimAssets] = useState<OSimAsset[]>([]);
  const [simLoading, setSimLoading] = useState(false);

  useEffect(() => {
    if (!draft.canonicalAssetKey || !targets.length) { setSimAssets([]); return; }
    let cancelled = false;
    setSimLoading(true);
    loadSimAssetsForTargets(draft.canonicalAssetKey, targets)
      .then((assets) => { if (!cancelled) setSimAssets(assets.sort((a, b) => a.identifier.localeCompare(b.identifier))); })
      .catch(() => { if (!cancelled) setSimAssets([]); })
      .finally(() => { if (!cancelled) setSimLoading(false); });
    return () => { cancelled = true; };
  }, [draft.canonicalAssetKey, targets]);

  const unitTypes      = useMemo(() => [...refData.unitTypes.values()],      [refData.unitTypes]);
  const equipmentTypes = useMemo(() => [...refData.equipmentTypes.values()], [refData.equipmentTypes]);

  // ── Canonical asset filter state ──────────────────────────────────────
  const [assetSearch,        setAssetSearch]        = useState("");
  const [filterNationality,  setFilterNationality]  = useState("");
  const [filterCategory,     setFilterCategory]     = useState("");

  // Derive unique facet values from the pre-filtered (by entity type) list
  const nationalities = useMemo(() =>
    [...new Set(filteredCanonicalAssets.map((a) => a.nationality).filter(Boolean))].sort(),
    [filteredCanonicalAssets]
  );
  const categories = useMemo(() =>
    [...new Set(filteredCanonicalAssets.map((a) => a.assetCategory).filter(Boolean))].sort(),
    [filteredCanonicalAssets]
  );

  // Apply the user's facet/search filters on top of the entity-type pre-filter
  const visibleCanonicalAssets = useMemo(() => {
    let list = filteredCanonicalAssets;
    if (filterNationality) list = list.filter((a) => a.nationality === filterNationality);
    if (filterCategory)    list = list.filter((a) => a.assetCategory === filterCategory);
    if (assetSearch.trim()) {
      const q = assetSearch.trim().toLowerCase();
      list = list.filter((a) =>
        a.canonicalName.toLowerCase().includes(q) ||
        a.simulationClass?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [filteredCanonicalAssets, filterNationality, filterCategory, assetSearch]);

  const selectedCanonical = draft.canonicalAssetKey
    ? refData.canonicalAssets.get(draft.canonicalAssetKey)
    : null;

  const handleSave = () => { onSave(draft); onClose(); };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ background: "#0f1e2d", border: "1px solid #1e3a4a", borderRadius: 6, width: 480, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 16px 48px rgba(0,0,0,0.8)", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #1e3a4a", flexShrink: 0, background: "#071018" }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#e0e0e0" }}>
            Edit — <em style={{ color: "#4fc3f7", fontStyle: "normal" }}>{node.unitIdentifier || "(unnamed)"}</em>
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#607d8b", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* Modal body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Live eligibility verdict — shown while editing rather than as a
              save-time error, so the planner can see what is missing and fix
              it in the same pass. */}
          {draftIssue && (
            <div style={{
              padding: "7px 10px", background: "rgba(255,183,77,0.08)",
              border: "1px solid rgba(255,183,77,0.35)", borderLeft: "3px solid #ffb74d",
              borderRadius: 2, fontSize: 11, color: "#ffcc80", lineHeight: 1.45,
            }}>
              {draftIssue}
            </div>
          )}

          <MField label="Unit Name">
            <input value={draft.unitIdentifier ?? ""} onChange={(e) => set({ unitIdentifier: e.target.value })} style={inp} placeholder="e.g. 1 Platoon" autoFocus />
          </MField>

          <MField label="SIDC (15-char APP-6D)">
            <input value={draft.sidc ?? ""} onChange={(e) => set({ sidc: e.target.value })} style={{ ...inp, fontFamily: "monospace", fontSize: 11 }} maxLength={15} />
          </MField>

          <div style={{ display: "flex", gap: 10 }}>
            {/* Entity type — also updates SIDC symbol set */}
            <MField label="Entity Type">
              <select value={currentType} onChange={(e) => {
                const newType = e.target.value as CompositionNode["entityType"];
                // Clearing the asset is deliberate: the catalogue that applies
                // changes with the entity type (organisations are SWORD
                // automats, everything else is a VBS4/SIMWORKS platform), so a
                // carried-over asset would be one the new type cannot use.
                set({ entityType: newType, sidc: updateSidcFrom({ entityType: newType }), canonicalAssetKey: null, simulatorIdentifierCode: null, unitTypeKey: null, equipmentTypeKey: null });
              }} style={sel}>
                {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </MField>

            {/* Affiliation — also updates SIDC */}
            <MField label="Affiliation">
              <select value={currentAff} onChange={(e) => set({ affiliation: e.target.value, sidc: updateSidcFrom({ affiliation: e.target.value }) })} style={sel}>
                {AFFILIATIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </MField>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            {/* Echelon — constrained to valid children of the parent echelon */}
            <MField label={parentEchelon ? `Echelon (under ${parentEchelon})` : "Echelon"}>
              <select value={currentEch} onChange={(e) => set({ echelon: e.target.value, sidc: updateSidcFrom({ echelon: e.target.value }) })} style={sel}>
                {availableEchelons.map((e) => <option key={e} value={e}>{e || "— None —"}</option>)}
                {/* If the current value isn't in the list (e.g. loaded from ontology), show it */}
                {currentEch && !availableEchelons.includes(currentEch) && (
                  <option value={currentEch}>{currentEch} ⚠</option>
                )}
              </select>
            </MField>

            {/* Military service */}
            <MField label="Military Service">
              <select value={draft.militaryService ?? node.militaryService} onChange={(e) => set({ militaryService: e.target.value, canonicalAssetKey: null })} style={sel}>
                {MILITARY_SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </MField>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            {/* Allegiance */}
            <MField label="Allegiance">
              <input value={draft.allegiance ?? ""} onChange={(e) => set({ allegiance: e.target.value.toUpperCase().slice(0, 3) })} style={inp} maxLength={3} placeholder="GBR" />
            </MField>

            {/* Owning simulator */}
            <MField label="Owning Simulator">
              {/* Changing simulator invalidates the chosen model: a VBS4
                  identifier means nothing to SIMWORKS. */}
              <select value={draft.owningSimulator ?? node.owningSimulator} onChange={(e) => set({ owningSimulator: e.target.value, simulatorIdentifierCode: null })} style={sel}>
                {SIMULATORS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </MField>

            {/* Quantity */}
            <MField label="Quantity">
              <input type="number" min={1} max={99} value={draft.quantity ?? 1} onChange={(e) => set({ quantity: Math.max(1, parseInt(e.target.value) || 1) })} style={{ ...inp, width: 60 }} />
            </MField>
          </div>

          {/* Unit type — organisations only */}
          {currentType === "organisation" && unitTypes.length > 0 && (
            <MField label="Unit Type">
              <select value={draft.unitTypeKey ?? ""} onChange={(e) => set({ unitTypeKey: e.target.value || null })} style={sel}>
                <option value="">— None —</option>
                {unitTypes.map((t) => <option key={t.primaryKey} value={t.primaryKey}>{t.unitType}{t.abbreviatedUnitType ? ` (${t.abbreviatedUnitType})` : ""}</option>)}
              </select>
            </MField>
          )}

          {/* Equipment type — vehicles/aircraft */}
          {(currentType === "vehicle" || currentType === "aircraft") && equipmentTypes.length > 0 && (
            <MField label="Equipment Type">
              <select value={draft.equipmentTypeKey ?? ""} onChange={(e) => set({ equipmentTypeKey: e.target.value || null })} style={sel}>
                <option value="">— None —</option>
                {equipmentTypes.map((e) => <option key={e.primaryKey} value={e.primaryKey}>{e.nomenclature}</option>)}
              </select>
            </MField>
          )}

          {/* ── Step 1: Canonical Asset ── */}
          {currentType !== "organisation" && (
            <>
              <MField label={`Canonical Asset${filteredCanonicalAssets.length > 0 ? ` (${visibleCanonicalAssets.length}/${filteredCanonicalAssets.length})` : ""}`}>
                {/* Filter bar */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 4 }}>
                  <input value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)} placeholder="Search name or sim class…" style={{ ...inp, fontSize: 11 }} />
                  <div style={{ display: "flex", gap: 4 }}>
                    <select value={filterNationality} onChange={(e) => setFilterNationality(e.target.value)} style={{ ...sel, flex: 1, fontSize: 11 }}>
                      <option value="">All nationalities</option>
                      {nationalities.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={{ ...sel, flex: 1, fontSize: 11 }}>
                      <option value="">All categories</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <select
                  value={draft.canonicalAssetKey ?? ""}
                  onChange={(e) => set({ canonicalAssetKey: e.target.value || null, simulatorIdentifierCode: null })}
                  style={{ ...sel, height: 80 }}
                  size={4}
                >
                  <option value="">— None —</option>
                  {visibleCanonicalAssets.map((a) => <option key={a.primaryKey} value={a.primaryKey}>{a.canonicalName}{a.nationality ? ` · ${a.nationality}` : ""}</option>)}
                </select>
                {refData.canonicalAssets.size === 0 && (
                  <div style={{ fontSize: 10, color: "#607d8b", marginTop: 3 }}>No canonical assets loaded</div>
                )}
                {refData.canonicalAssets.size > 0 && selectableAssets.length === 0 && targetLabel && (
                  <div style={{ fontSize: 10, color: "#ffb74d", marginTop: 3, lineHeight: 1.4 }}>
                    No asset in the catalogue has a {targetLabel} entry for a {currentType}. Change the owning simulator or the entity type.
                  </div>
                )}
                {selectableAssets.length > 0 && targetLabel && (
                  <div style={{ fontSize: 10, color: "#607d8b", marginTop: 3 }}>
                    {selectableAssets.length} of {refData.canonicalAssets.size} assets can be spawned in {targetLabel}.
                  </div>
                )}
              </MField>

              {/* ── Step 2: the concrete simulator model ──────────────────────
                  Written to simulatorIdentifierCode — the FK the simulator
                  export resolves. It used to be written to equipmentTypeKey,
                  which is the FK to NxgEquipmentType, so the catalogue link
                  was never actually made. */}
              {draft.canonicalAssetKey && targets.length > 0 && (
                <MField label={
                  simLoading
                    ? `${targetLabel} Model (loading…)`
                    : simAssets.length > 0
                      ? `${targetLabel} Model (${simAssets.length} available)`
                      : `${targetLabel} Model (none found)`
                }>
                  {simAssets.length > 0 ? (
                    <select value={draft.simulatorIdentifierCode ?? ""} onChange={(e) => set({ simulatorIdentifierCode: e.target.value || null })} style={sel}>
                      <option value="">— Choose a model —</option>
                      {simAssets.map((a) => (
                        <option key={`${a.simulator}:${a.identifier}`} value={a.identifier}>
                          {SIM_TARGET_LABELS[a.simulator]} · {a.displayName}{a.description ? ` — ${a.description}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ fontSize: 11, color: "#607d8b", padding: "4px 0" }}>
                      {simLoading
                        ? "Loading…"
                        : `No ${targetLabel} model is linked to "${selectedCanonical?.canonicalName ?? draft.canonicalAssetKey}"`}
                    </div>
                  )}
                  {selectedCanonical?.simulationClass && (
                    <div style={{ fontSize: 10, color: "#456", fontFamily: "monospace", marginTop: 2 }}>
                      sim class: {selectedCanonical.simulationClass}
                    </div>
                  )}
                </MField>
              )}
            </>
          )}
        </div>

        {/* Modal footer */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "10px 16px", borderTop: "1px solid #1e3a4a", background: "#071018", flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: "5px 16px", background: "#1a2b3c", border: "1px solid #2a4a5a", borderRadius: 3, color: "#90a4ae", fontSize: 12, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ padding: "5px 16px", background: "#1565C0", border: "none", borderRadius: 3, color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Read-only property row ────────────────────────────────────────────────────

function PropRow({ label, value, colour }: { label: string; value: React.ReactNode; colour?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "5px 0", borderBottom: "1px solid #0d1e2d" }}>
      <span style={{ fontSize: 10, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: colour ?? "#c8d0da", textAlign: "right", wordBreak: "break-all" }}>{value || <span style={{ color: "#37474f" }}>—</span>}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export function CompositionNodeEditor({ node, refData, onChange, parentEchelon, parentNode, onSelectNode }: Props) {
  const [editOpen, setEditOpen] = useState(false);

  const parsed = useMemo(() => parseSidc(node.sidc), [node.sidc]);
  const sidcAffiliation = parsed ? (AFFILIATION_FROM_CODE[parsed.affiliation] ?? node.affiliation) : node.affiliation;
  const sidcEchelon     = parsed ? (SIDC_CHAR_TO_ECHELON[parsed.echelonChar]  ?? node.echelon)     : node.echelon;

  const selectedCanonical = node.canonicalAssetKey ? refData.canonicalAssets.get(node.canonicalAssetKey) : null;
  const unitType          = node.unitTypeKey        ? refData.unitTypes.get(node.unitTypeKey)             : null;

  // Note: the parent entity type is not threaded in here, so crew inside a
  // vehicle are checked as if they were dismounted. That errs towards showing
  // a warning that does not apply rather than hiding one that does; the tree
  // walk in validateComposition has the parent context and is authoritative.
  const ineligibleReason = useMemo(
    () => assetIneligibleReason(node, refData.canonicalAssets),
    [node, refData.canonicalAssets],
  );

  const affColour = AFF_COLOURS[sidcAffiliation] ?? "#607d8b";

  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Edit button */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button
          onClick={() => setEditOpen(true)}
          style={{ padding: "4px 14px", background: "#1565C0", border: "none", borderRadius: 3, color: "#fff", fontSize: 11, cursor: "pointer", fontWeight: 700, letterSpacing: "0.04em" }}
        >
          ✎ Edit
        </button>
      </div>

      {/* Read-only property list */}
      <PropRow label="Unit Name"       value={node.unitIdentifier || "(unnamed)"} />
      <PropRow label="Affiliation"     value={sidcAffiliation} colour={affColour} />
      <PropRow label="Echelon"         value={sidcEchelon} />
      <PropRow label="Entity Type"     value={node.entityType ? node.entityType.charAt(0).toUpperCase() + node.entityType.slice(1) : undefined} colour={ENTITY_COLOURS[node.entityType]} />
      <PropRow label="Military Service" value={node.militaryService} />
      <PropRow label="Allegiance"      value={node.allegiance} />
      <PropRow label="Simulator"       value={node.owningSimulator} />
      <PropRow label="Quantity"        value={node.quantity > 1 ? `${node.quantity} ×` : "1"} />
            {unitType && <PropRow label="Unit Type" value={unitType.unitType} />}
      {selectedCanonical && <PropRow label="Canonical Asset" value={selectedCanonical.canonicalName} />}
      {node.simulatorIdentifierCode && (
        <PropRow
          label="Simulator Model"
          value={<span style={{ fontFamily: "monospace", fontSize: 11 }}>{node.simulatorIdentifierCode}</span>}
        />
      )}
      <PropRow label="SIDC" value={<span style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: "0.06em" }}>{node.sidc || "—"}</span>} />

      {/* Why this unit cannot be exported, if it cannot. Saved state, not draft. */}
      {ineligibleReason && (
        <div style={{
          marginTop: 10, padding: "7px 10px", background: "rgba(255,183,77,0.08)",
          border: "1px solid rgba(255,183,77,0.35)", borderLeft: "3px solid #ffb74d",
          borderRadius: 2, fontSize: 11, color: "#ffcc80", lineHeight: 1.45,
        }}>
          {ineligibleReason}
        </div>
      )}

      {/* Parent & children */}
      {(parentNode || node.children.length > 0) && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>

          {/* Parent */}
          {parentNode && (
            <div>
              <div style={{ fontSize: 9, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Parent</div>
              <RelatedNodeRow node={parentNode} onSelect={onSelectNode} />
            </div>
          )}

          {/* Children */}
          {node.children.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>
                Children ({node.children.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {node.children.map((child) => (
                  <RelatedNodeRow key={child.id} node={child} onSelect={onSelectNode} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}



      {/* Edit modal */}
      {editOpen && (
        <EditModal
          node={node}
          refData={refData}
          parentEchelon={parentEchelon}
          onSave={(updates) => onChange(updates)}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}

// ── Related node row (parent / child) ────────────────────────────────────────

function RelatedNodeRow({ node, onSelect }: { node: CompositionNode; onSelect?: (id: string) => void }) {
  let imgSrc = "";
  try {
    const svg = new ms.Symbol(node.sidc, { size: 24, square: true, strokeWidth: 1.5 }).asSVG();
    if (svg && svg.length > 50) imgSrc = `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch { /* fall through */ }

  const affColour = AFF_COLOURS[node.affiliation] ?? "#607d8b";
  const clickable = !!onSelect;

  return (
    <div
      onClick={clickable ? () => onSelect!(node.id) : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 8px",
        background: "#071018",
        border: "1px solid #1a2b3c",
        borderRadius: 4,
        cursor: clickable ? "pointer" : "default",
        transition: "border-color 0.12s",
      }}
      onMouseEnter={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#2a4a6a"; } : undefined}
      onMouseLeave={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#1a2b3c"; } : undefined}
    >
      {imgSrc
        ? <img src={imgSrc} width={24} height={24} alt={node.sidc} style={{ display: "block", flexShrink: 0 }} />
        : <div style={{ width: 24, height: 24, borderRadius: 3, background: "#1a2b3c", flexShrink: 0 }} />
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
          {node.unitIdentifier || "(unnamed)"}
        </div>
        <div style={{ fontSize: 9, display: "flex", gap: 4, alignItems: "center", marginTop: 1 }}>
          {node.echelon && <span style={{ color: "#607d8b" }}>{node.echelon}</span>}
          {node.echelon && <span style={{ color: "#2a3a4a" }}>·</span>}
          <span style={{ color: affColour }}>{node.affiliation}</span>
        </div>
      </div>
      {clickable && <span style={{ fontSize: 10, color: "#2a4a6a", flexShrink: 0 }}>›</span>}
    </div>
  );
}

// ── Modal field helper ────────────────────────────────────────────────────────

function MField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
      <label style={{ fontSize: 10, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      {children}
    </div>
  );
}
const inp: React.CSSProperties = {
  padding: "5px 8px",
  background: "#1a2b3c",
  border: "1px solid #2a4a5a",
  borderRadius: 4,
  color: "#e0e0e0",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const sel: React.CSSProperties = { ...inp, cursor: "pointer" };

