// App.tsx — operation-driven single-hierarchy ORBAT Manager
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import React from "react";
import ms from "milsymbol";
import { useWorkshopContext } from "@osdk/workshop-iframe-custom-widget";
import { ORBAT_CONFIG } from "./orbatManager.config";
import { CompositionBuilder, NodeEditorSidebar, blankNode, makeSidc, echelonFromSidc, affiliationFromSidc, findNode, addChildToNode } from "./components/CompositionBuilder";
import { OrbatTreeView } from "./components/OrbatTreeView";
import "./orbatManager.css";
import { HierarchyMap, type OrbatExport, type NodePositionMap, type MapAvailableItem } from "./components/HierarchyMap";
// PhaseSwitcher import removed — switcher UI is disabled; type kept for compatibility
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { PhaseSwitcherItem } from "./components/PhaseSwitcher";
import { HierarchySelector } from "./components/HierarchySelector";
import {
  loadHierarchies,
  saveHierarchies,
  createHierarchyFromRoot,
  createPhaseHierarchy,
  addPhaseSlotToHierarchy,
  updateHierarchyRoot,
  slotToPositionMap,
  type Hierarchy,
  type HierarchyPhaseSlot,
} from "./lib/hierarchyStore";
import { C } from "./components/shared/milStyles";
import { loadOrbatForest, loadOrbatSubtree } from "../../shared/orbat/loadOrbatSubtree";
import { buildOrbatSkeleton } from "../../shared/orbat/skeleton";
import {
  commitOrbatForPlacement,
  describeActionError,
} from "../../shared/orbat/scenarioOrbat";
import {
  clearOrbatDefinitionRequest,
  publishOrbatDefinitionResult,
  readOrbatDefinitionRequest,
  type OrbatDefineRequest,
} from "../../shared/orbat/defineHandoff";
import { useNavigate } from "react-router-dom";
import { useOrbatStore } from "./store/useOrbatStore";
import { useCompositionData } from "@/shared/hooks/useCompositionData";
import { AiTemplateGenerator } from "./components/AiTemplateGenerator";
import {
  parsePhaseOrbatPayload,
  ingestPhaseOrbat,
  positionsMapToObject,
  positionsObjectToMap,
  matchIncomingToBaseline,
  applyIdRemap,
  remapPositions,
  extractRelationships,
  PHASE_TEMPLATE_TAG,
  type PhaseTemplateExtras,
} from "./lib/phaseOrbatIngest";
import {
  loadPhaseGroups,
  savePhaseGroups,
  createPhaseGroup,
  addPhaseToGroup,
  renamePhase,
  type OperationPhaseGroup,
  type PhaseSlot,
} from "./lib/phaseGroupStore";
import type { PhaseGroupView } from "./components/HierarchyMap";
import type { HierarchyTemplate } from "@/shared/types";
import {
  loadEdgesForOperation,
  loadUnits,
  loadHierarchyTemplates,
  loadPhaseMapStates,
  loadSwordFormations,
  createHierarchyTemplateFn,
  editHierarchyTemplateFn,
  deleteHierarchyTemplateFn,
  type OPhaseMapState,
} from "@/shared/lib/foundry";
import { client } from "@/client";
import { AppSwitcher } from "@/components/AppSwitcher";
import {
  cseAddComposition,
  cseAddProject,
  cseValidateOrbat,
  llmPhaseToOrbat,
  NxgUnit,
  NxgUnitHierarchy,
} from "@nxg-simulation-execution-testing/sdk";
// Same import the Scenario Planner uses for its object-set outputs — it lives
// in the internal export of @osdk/client >= 2.0.
import { createAndFetchTempObjectSetRid } from "@osdk/client/internal";
import type { CompositionNode } from "@/shared/types";

const CSE_COMPOSITION_NAME = "orbat-manager-env";
const CSE_COMPOSITION_TYPE = "vbs4";
const CSE_PROJECT  = "orbat-manager-project";

// Workshop config lives in orbatManager.config.ts — see ORBAT_CONFIG.

/**
 * First primary key out of a Workshop object-set field, or "" when unset.
 *
 * Workshop delivers an object-set variable as a list of primary keys
 * (ObjectSetLocators). Object sets are used instead of plain string inputs so
 * the wiring is typed, but everything downstream here is keyed on the id.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstPrimaryKey(field: any): string {
  const value = field?.fieldValue?.status === "LOADED" ? field.fieldValue.value : undefined;
  const keys = value?.type === "string" ? value.primaryKeys : undefined;
  return Array.isArray(keys) && keys.length > 0 ? String(keys[0]).trim() : "";
}

const AFF_COLOR: Record<string, string> = {
  Friend: "#5B9BD5", Hostile: "#E74C3C", Neutral: "#27AE60",
  Unknown: "#F1C40F", "Assumed Friend": "#9ab8d8", Suspect: "#e07070",
};

function countNodes(n: CompositionNode): number {
  return 1 + n.children.reduce((s, c) => s + countNodes(c), 0);
}

function MilThumb({ sidc, size = 28 }: { sidc: string; size?: number }) {
  const src = useMemo(() => {
    try {
      const svg = new ms.Symbol(sidc, { size, square: true, strokeWidth: 1.5 }).asSVG();
      if (svg && svg.length > 50) return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch { /* fall through */ }
    return "";
  }, [sidc, size]);
  if (!src) return <div style={{ width: size, height: size, borderRadius: 2, background: C.surface, flexShrink: 0 }} />;
  return <img src={src} width={size} height={size} alt="" style={{ display: "block", flexShrink: 0 }} />;
}

async function loadOperationTree(operationKey: string): Promise<CompositionNode> {
  const edges = await loadEdgesForOperation(operationKey);
  const unitKeySet = new Set<string>();
  for (const e of edges) { unitKeySet.add(e.childUnitKey); unitKeySet.add(e.parentUnitKey); }
  const units = await loadUnits([...unitKeySet]);
  const childIds = new Set(edges.map((e) => e.childUnitKey));
  const unitMap  = new Map(units.map((u) => [u.primaryKey, u]));
  const rootIds  = units.map((u) => u.primaryKey).filter((id) => !childIds.has(id));

  function buildNode(id: string): CompositionNode | null {
    const u = unitMap.get(id);
    if (!u) return null;
    // Derive echelon + affiliation from the SIDC if the text field is blank,
    // so we always have consistent values regardless of ontology data quality.
    const echelon    = u.echelon    || echelonFromSidc(u.sidc)    || "";
    const affiliation = u.affiliation || affiliationFromSidc(u.sidc) || "Friend";
    return {
      id: u.primaryKey, unitIdentifier: u.unitIdentifier, echelon, sidc: u.sidc,
      entityType: (u.entityType as CompositionNode["entityType"]) || "organisation",
      militaryService: u.militaryService, affiliation, allegiance: u.allegiance,
      owningSimulator: u.owningSimulator,
      // Carry the existing links through, so a unit loaded from the ontology is
      // not shown as unlinked (and then re-saved that way).
      canonicalAssetKey: u.canonicalAssetKey,
      simulatorIdentifierCode: u.simulatorIdentifierCode,
      unitTypeKey: u.unitTypeKey, equipmentTypeKey: u.equipmentTypeKey, quantity: 1,
      children: edges.filter((e) => e.parentUnitKey === id).map((e) => buildNode(e.childUnitKey)).filter((n): n is CompositionNode => n !== null),
    };
  }

  const roots = rootIds.map(buildNode).filter((n): n is CompositionNode => n !== null);
  if (roots.length === 1) return roots[0];

  return {
    id: `op-root-${operationKey}`,
    unitIdentifier: operationKey,
    echelon: "Corps",
    sidc: makeSidc("headquarters", "Corps", "Friend", "organisation"),
    entityType: "organisation",
    militaryService: "Army",
    affiliation: "Friend",
    allegiance: "GBR",
    owningSimulator: "vbs4",
    canonicalAssetKey: null, simulatorIdentifierCode: null, unitTypeKey: null, equipmentTypeKey: null, quantity: 1,
    children: roots,
  };
}

type TopTab = "hierarchy" | "templates" | "map";

// ── Echelon ordering ──────────────────────────────────────────────────────────
const ECHELON_ORDER = [
  "team", "squad", "section", "platoon", "troop",
  "company", "battery", "squadron",
  "battalion", "regiment",
  "brigade", "division", "corps", "army",
  // capitalised variants
  "Team", "Squad", "Section", "Platoon", "Troop",
  "Company", "Battery", "Squadron",
  "Battalion", "Regiment",
  "Brigade", "Division", "Corps", "Army",
];

function echelonRank(echelon: string): number {
  const idx = ECHELON_ORDER.findIndex((e) => e.toLowerCase() === echelon.toLowerCase());
  return idx === -1 ? 99 : idx;
}

function normaliseEchelon(echelon: string): string {
  return echelon.charAt(0).toUpperCase() + echelon.slice(1).toLowerCase();
}

// ── Phase ORBAT import panel (shared, used in Hierarchy tab) ─────────────────
//
// Accepts either a pasted JSON payload or a text prompt (generate via LLM).
// Both paths call runPhaseIngest which creates/extends a Hierarchy in the
// session store and switches to the map tab.

function PhaseImportPanel({
  onImport,
  onGenerate,
  onClose,
}: {
  onImport: (rawJson: string, parentNodeName?: string) => Promise<string | null>;
  onGenerate: (description: string, nationalityHint?: string, parentNodeName?: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [mode, setMode]       = useState<"paste" | "generate">("paste");
  const [raw, setRaw]         = useState("");
  const [desc, setDesc]       = useState("");
  const [nat, setNat]         = useState("");
  const [parentName, setParentName] = useState("");
  const [err, setErr]         = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);

  const reset = () => { setRaw(""); setDesc(""); setNat(""); setParentName(""); setErr(null); };

  const handleSubmit = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const nameOverride = parentName.trim() || undefined;
    let result: string | null;
    if (mode === "generate") {
      if (!desc.trim()) { setBusy(false); return; }
      result = await onGenerate(desc.trim(), nat.trim() || undefined, nameOverride);
    } else {
      if (!raw.trim()) { setBusy(false); return; }
      result = await onImport(raw, nameOverride);
    }
    setBusy(false);
    if (result) { setErr(result); }
    else { reset(); onClose(); }
  };

  const canSubmit = mode === "generate" ? !!desc.trim() : !!raw.trim();

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "6px 10px",
    background: "var(--bg-surface-flat)", border: "1px solid var(--border-default)", borderRadius: 3,
    color: "var(--text-primary)", outline: "none", fontFamily: "inherit", fontSize: 12,
  };

  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--om-border-subtle)", flexShrink: 0, background: "rgba(121,134,203,0.04)" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#7986cb", flex: 1 }}>
          ⇪ Import Phase ORBAT
        </span>
        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 2, background: "var(--bg-base)", border: "1px solid var(--border-default)", borderRadius: 3, padding: 2 }}>
          {(["paste", "generate"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setErr(null); }}
              disabled={busy}
              style={{
                padding: "3px 10px", border: "none", borderRadius: 2,
                background: mode === m ? "#7986cb" : "transparent",
                color: mode === m ? "#fff" : "var(--om-text-muted)",
                fontSize: 10, fontWeight: 700, cursor: busy ? "default" : "pointer",
              }}
            >
              {m === "paste" ? "⇪ Paste JSON" : "✦ Generate via LLM"}
            </button>
          ))}
        </div>
        <button onClick={() => { reset(); onClose(); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--om-text-muted)", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>✕</button>
      </div>

      {/* Paste mode */}
      {mode === "paste" && (
        <>
          <div style={{ fontSize: 10, color: "var(--om-text-muted)", marginBottom: 6 }}>
            Payload: <code style={{ color: "#7986cb" }}>{"{ description, units[{ name, echelon, location: { lat, lon }, children }] }"}</code>
          </div>
          <textarea
            value={raw}
            onChange={(e) => { setRaw(e.target.value); setErr(null); }}
            placeholder='{"description":"Phase 1 — Advance to Contact","units":[{"name":"A Coy","echelon":"company","location":{"lat":54.4,"lon":18.3},"children":[…]}]}'
            rows={6}
            disabled={busy}
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11, resize: "vertical", minHeight: 110 }}
          />
        </>
      )}

      {/* Parent node name — shared by both paste and generate modes */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 10, color: "#607d8b", textTransform: "uppercase" as const, letterSpacing: "0.06em", display: "block", marginBottom: 3 }}>
          Parent node name{" "}
          <span style={{ color: "var(--om-text-muted)", fontWeight: 400, textTransform: "none" as const, letterSpacing: 0 }}>
            (optional — overrides the top-level HQ name)
          </span>
        </label>
        <input
          value={parentName}
          onChange={(e) => setParentName(e.target.value)}
          placeholder="e.g. 3 PARA BG, TF IRON, 1st Bn…"
          disabled={busy}
          style={inputStyle}
        />
      </div>

      {/* Generate mode */}
      {mode === "generate" && (
        <>
          <div style={{ fontSize: 10, color: "var(--om-text-muted)", marginBottom: 8, lineHeight: 1.5 }}>
            Describe the phase and the AI will generate a doctrine-aware ORBAT with map coordinates, creating a new Hierarchy in the left panel.
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 10, color: "#607d8b", textTransform: "uppercase" as const, letterSpacing: "0.06em", display: "block", marginBottom: 3 }}>Phase description *</label>
            <textarea
              value={desc}
              onChange={(e) => { setDesc(e.target.value); setErr(null); }}
              placeholder='e.g. "Seizure of Bridge VEGA H+6, assault crossing 54.38°N 18.22°E → 54.42°N 18.35°E, British battalion"'
              rows={4}
              disabled={busy}
              style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#607d8b", textTransform: "uppercase" as const, letterSpacing: "0.06em", display: "block", marginBottom: 3 }}>Nationality hint (optional)</label>
            <input value={nat} onChange={(e) => setNat(e.target.value)} placeholder="e.g. British, US, German…" disabled={busy} style={inputStyle} />
          </div>
        </>
      )}

      {/* Error */}
      {err && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#ef9a9a", padding: "6px 8px", background: "rgba(176,58,46,0.12)", border: "1px solid rgba(176,58,46,0.3)", borderRadius: 3 }}>
          ⚠ {err}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
        <button onClick={() => { reset(); onClose(); }} disabled={busy} className="mil-btn mil-btn--default mil-btn--sm">Cancel</button>
        <button onClick={handleSubmit} disabled={!canSubmit || busy} className="mil-btn mil-btn--primary mil-btn--sm"
          style={{ background: "#7986cb", borderColor: "#7986cb" }}>
          {busy
            ? (mode === "generate" ? "Generating…" : "Importing…")
            : (mode === "generate" ? "✦ Generate hierarchy" : "⇪ Import as hierarchy")}
        </button>
      </div>
    </div>
  );
}

// ── Templates tab ─────────────────────────────────────────────────────────────

function TemplatesTab({
  templates,
  onSelect,
  onSave,
  onReloadTemplates,
  onImportPhaseOrbat: _onImportPhaseOrbat,
  onGeneratePhaseOrbat: _onGeneratePhaseOrbat,
}: {
  templates: HierarchyTemplate[];
  onSelect: (id: string) => void;
  onSave: (input: Record<string, unknown>) => Promise<void>;
  onReloadTemplates: () => Promise<void>;
  onImportPhaseOrbat?: (rawJson: string) => Promise<string | null>;
  onGeneratePhaseOrbat?: (description: string, nationalityHint?: string) => Promise<string | null>;
}) {
  const [search, setSearch]       = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [newName, setNewName]     = useState("");
  const [newDesc, setNewDesc]     = useState("");
  const [newEchelon, setNewEchelon] = useState("Battalion");

  const existingNames = useMemo(() => new Set(templates.map((t) => t.name)), [templates]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? templates.filter((t) => t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q)))
    : templates;

  // Group by normalised root echelon, sorted by echelon rank then name
  const groups = useMemo(() => {
    const map = new Map<string, HierarchyTemplate[]>();
    for (const tpl of filtered) {
      const key = normaliseEchelon(tpl.root.echelon || "Unknown");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tpl);
    }
    // Sort keys by echelon rank
    const sorted = [...map.entries()].sort(([a], [b]) => echelonRank(a) - echelonRank(b));
    // Sort templates within each group by name
    sorted.forEach(([, tpls]) => tpls.sort((a, b) => a.name.localeCompare(b.name)));
    return sorted;
  }, [filtered]);

  async function handleCreateNew() {
    if (!newName.trim()) return;
    await onSave({
      name: newName.trim(),
      description: newDesc.trim(),
      tags: [],
      root: blankNode({ unitIdentifier: newName.trim(), affiliation: "Friend", echelon: newEchelon }),
    });
    setCreatingNew(false);
    setNewName(""); setNewDesc("");
  }

  const ECHELONS_LIST = ["Team", "Squad", "Section", "Platoon", "Company", "Battalion", "Regiment", "Brigade", "Division", "Corps"];

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "var(--om-bg-panel)", borderBottom: "1px solid var(--om-border-subtle)", flexShrink: 0 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates…"
          className="mel-input" style={{ width: 240 }} />
        <span style={{ fontSize: 11, color: "var(--om-text-muted)" }}>{filtered.length} template{filtered.length !== 1 ? "s" : ""}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => { setShowAiGenerator((v) => !v); setCreatingNew(false); }}
          className={`mil-btn mil-btn--sm${showAiGenerator ? "" : " mil-btn--primary"}`}
          style={showAiGenerator ? { borderColor: "rgba(79,195,247,0.5)", color: "#4fc3f7" } : { background: "rgba(79,195,247,0.15)", borderColor: "rgba(79,195,247,0.4)", color: "#4fc3f7" }}
        >
          ✦ AI Generate
        </button>
        <button onClick={() => { setCreatingNew(true); setShowAiGenerator(false); }} className="mil-btn mil-btn--default mil-btn--sm">
          + New Template
        </button>
      </div>

      {/* AI Generator panel */}
      {showAiGenerator && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--om-border-subtle)", flexShrink: 0 }}>
          <AiTemplateGenerator
            onTemplateSaved={async () => { await onReloadTemplates(); setShowAiGenerator(false); }}
            onClose={() => setShowAiGenerator(false)}
            existingNames={existingNames}
          />
        </div>
      )}

      {/* New template inline form */}
      {creatingNew && !showAiGenerator && (
        <div className="om-create-strip">
          <div className="om-create-strip__field" style={{ flex: "1 1 200px" }}>
            <label className="mel-form-label">Name *</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Rifle Platoon" className="mel-input" autoFocus />
          </div>
          <div className="om-create-strip__field" style={{ flex: "0 0 140px" }}>
            <label className="mel-form-label">Echelon</label>
            <select value={newEchelon} onChange={(e) => setNewEchelon(e.target.value)} className="mel-select">
              {ECHELONS_LIST.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div className="om-create-strip__field" style={{ flex: "2 1 260px" }}>
            <label className="mel-form-label">Description</label>
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Optional…" className="mel-input" />
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-end" }}>
            <button onClick={handleCreateNew} disabled={!newName.trim()} className="mil-btn mil-btn--primary mil-btn--sm">
              Create
            </button>
            <button onClick={() => { setCreatingNew(false); setNewName(""); setNewDesc(""); }} className="mil-btn mil-btn--default mil-btn--sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {groups.length === 0 && (
          <div className="om-empty">
            <div className="om-empty__icon">⬡</div>
            <div className="om-empty__title">{search ? "No templates match" : "No templates yet"}</div>
            {!search && <div className="om-empty__hint">Click <strong style={{ color: "var(--om-accent)" }}>+ New Template</strong> to create one.</div>}
          </div>
        )}

        {groups.map(([echelon, tpls]) => (
          <div key={echelon} style={{ marginBottom: 28 }}>
            {/* Section header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--om-accent)", textTransform: "uppercase", letterSpacing: "0.12em" }}>{echelon}</span>
              <span className="mil-badge mil-badge--grey">{tpls.length}</span>
              <div style={{ flex: 1, height: 1, background: "var(--om-border-subtle)" }} />
            </div>

            {/* Cards grid */}
            <div className="om-cards-grid">
              {tpls.map((tpl) => {
                const builtin   = tpl.id.startsWith("htpl-");
                const nodeCount = countNodes(tpl.root);
                // Phase-origin templates carry map coordinates in templateJson.phaseExtras
                // — flag them so the user can see at a glance which templates
                // will hydrate the map when re-selected.
                const isPhaseOrigin = tpl.tags.includes(PHASE_TEMPLATE_TAG)
                  || !!(tpl as HierarchyTemplate & { phaseExtras?: { origin?: string } }).phaseExtras?.origin;
                return (
                  <div key={tpl.id} onClick={() => onSelect(tpl.id)} className="om-card">
                    <div className="om-card__header">
                      <MilThumb sidc={tpl.root.sidc} size={40} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="om-card__name">{tpl.name}</div>
                        <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                          {builtin && <span className="mil-badge mil-badge--grey">built-in</span>}
                          {isPhaseOrigin && (
                            <span
                              className="mil-badge"
                              style={{ background: "rgba(192,132,252,0.18)", borderColor: "rgba(192,132,252,0.4)", color: "#c084fc" }}
                              title="Phase-origin template — includes map coordinates"
                            >
                              ⌖ phase + map
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {tpl.description && <div className="om-card__desc">{tpl.description}</div>}
                    <div className="om-card__meta">
                      <span>{nodeCount} node{nodeCount !== 1 ? "s" : ""}</span>
                      <span className="om-card__meta-sep">·</span>
                      <span>{tpl.root.children.length} child{tpl.root.children.length !== 1 ? "ren" : ""}</span>
                      {tpl.tags.length > 0 && (
                        <>
                          <span className="om-card__meta-sep">·</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tpl.tags.slice(0, 2).join(", ")}</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

}

// ── Template detail view (graph editor) ───────────────────────────────────────

// ── Save-as-copy dialog ───────────────────────────────────────────────────────

function SaveAsCopyDialog({
  existingNames,
  suggestedName,
  onConfirm,
  onClose,
}: {
  existingNames: Set<string>;
  suggestedName: string;
  onConfirm: (name: string, description: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(suggestedName);
  const [desc, setDesc] = useState("");
  const isDuplicate = existingNames.has(name.trim());
  const canSave = name.trim() && !isDuplicate;

  return (
    <div className="mel-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mel-modal mel-modal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="mel-modal__header">
          <div className="mel-modal__title">⎘ Save as copy</div>
          <button onClick={onClose} className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only">×</button>
        </div>
        <div className="mel-modal__body">
          <div className="mel-form-group">
            <label className="mel-form-label">Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mel-input" autoFocus placeholder="Unique template name" />
            {isDuplicate && <div style={{ fontSize: 10, color: "#ef9a9a", marginTop: 3 }}>⚠ A template with this name already exists.</div>}
          </div>
          <div className="mel-form-group">
            <label className="mel-form-label">Description</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} className="mel-input" placeholder="Optional description…" />
          </div>
        </div>
        <div className="mel-modal__footer">
          <button onClick={onClose} className="mil-btn mil-btn--default mil-btn--sm">Cancel</button>
          <button onClick={() => canSave && onConfirm(name.trim(), desc.trim())} disabled={!canSave}
            className="mil-btn mil-btn--primary mil-btn--sm">
            Save copy
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Template detail view ──────────────────────────────────────────────────────

function DeleteConfirmDialog({
  templateName,
  onConfirm,
  onCancel,
}: {
  templateName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mel-overlay" style={{ zIndex: 3000 }} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="mel-modal mel-modal--sm" style={{ borderColor: "rgba(176,58,46,0.5)" }} onClick={(e) => e.stopPropagation()}>
        <div className="mel-modal__header" style={{ borderColor: "rgba(176,58,46,0.4)" }}>
          <div className="mel-modal__title" style={{ color: "#ef9a9a" }}>✕ Delete template?</div>
        </div>
        <div className="mel-modal__body">
          <p style={{ fontSize: 13, color: "var(--text-primary)", margin: 0 }}>
            Are you sure you want to delete <strong>"{templateName}"</strong>? This cannot be undone.
          </p>
        </div>
        <div className="mel-modal__footer">
          <button onClick={onCancel} className="mil-btn mil-btn--default mil-btn--sm">Cancel</button>
          <button onClick={onConfirm} className="mil-btn mil-btn--danger mil-btn--sm"
            style={{ background: "rgba(176,58,46,0.8)", border: "1px solid rgba(176,58,46,0.6)", color: "#fff" }}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateDetailView({
  template,
  allTemplates,
  onBack,
  onDelete,
  onSave,
  onSaveAsCopy,
}: {
  template: HierarchyTemplate;
  allTemplates: HierarchyTemplate[];
  onBack: () => void;
  onDelete: (id: string) => Promise<void>;
  onSave: (id: string, root: CompositionNode, meta: { name: string; description: string }) => Promise<void>;
  onSaveAsCopy: (root: CompositionNode, name: string, description: string) => void;
}) {
  const isBuiltin = template.id.startsWith("htpl-");

  const [draft, setDraft]         = useState<CompositionNode>(template.root);
  const [draftName, setDraftName] = useState(template.name);
  const [draftDesc, setDraftDesc] = useState(template.description ?? "");
  const [editingMeta, setEditingMeta] = useState(false);
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // "saved baseline" — what the last successful save looked like.
  // We update this immediately on save so isDirty clears without waiting for
  // the round-trip reload from Foundry.
  const [savedRoot, setSavedRoot]   = useState<CompositionNode>(template.root);
  const [savedName, setSavedName]   = useState(template.name);
  const [savedDesc, setSavedDesc]   = useState(template.description ?? "");

  const isDirty = draft !== savedRoot || draftName !== savedName || draftDesc !== savedDesc;

  // When navigating to a different template, reset everything
  useEffect(() => {
    setDraft(template.root);
    setDraftName(template.name);
    setDraftDesc(template.description ?? "");
    setSavedRoot(template.root);
    setSavedName(template.name);
    setSavedDesc(template.description ?? "");
    setEditingMeta(false);
  }, [template.id]);

  const handleSaveClick = async () => {
    if (saving || !isDirty) return;
    setSaving(true);
    try {
      await onSave(template.id, draft, { name: draftName, description: draftDesc });
      // Clear dirty state immediately — don't wait for Foundry reload
      setSavedRoot(draft);
      setSavedName(draftName);
      setSavedDesc(draftDesc);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraft(savedRoot);
    setDraftName(savedName);
    setDraftDesc(savedDesc);
  };

  const existingNames = useMemo(
    () => new Set(allTemplates.filter((t) => t.id !== template.id).map((t) => t.name)),
    [allTemplates, template.id],
  );

  const melInp: React.CSSProperties = { background: "var(--bg-surface-flat)", border: "1px solid var(--border-default)", borderRadius: 2, color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit", padding: "4px 8px", outline: "none", boxSizing: "border-box" as const };

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      {/* Header */}
      <div className="om-detail-header">
        <button onClick={onBack} className="mil-btn mil-btn--default mil-btn--sm">← Back</button>
        <MilThumb sidc={draft.sidc} size={22} />

        {editingMeta ? (
          <>
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)}
              style={{ ...melInp, width: 180 }} placeholder="Template name" />
            <input value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)}
              style={{ ...melInp, width: 240 }} placeholder="Description (optional)" />
            <button onClick={() => setEditingMeta(false)} className="mil-btn mil-btn--ghost mil-btn--sm">Done</button>
          </>
        ) : (
          <>
            <span className="om-detail-header__title">{draftName}</span>
            {draftDesc && <span style={{ fontSize: 11, color: "var(--om-text-muted)" }}>{draftDesc}</span>}
            {isBuiltin && <span className="mil-badge mil-badge--amber">built-in</span>}
            <button onClick={() => setEditingMeta(true)} className="mil-btn mil-btn--ghost mil-btn--sm">✎ Edit</button>
          </>
        )}

        <span style={{ fontSize: 10, color: "var(--om-text-muted)" }}>{countNodes(draft)} nodes</span>

        <div className="om-detail-header__spacer" />
        <div className="om-detail-header__actions">
          {isDirty && !saving && <span className="om-unsaved">● Unsaved changes</span>}
          {saving   && <span className="om-saving">⟳ Saving…</span>}

          {!isBuiltin && (
            <button onClick={handleSaveClick} disabled={!isDirty || saving}
              className={`mil-btn mil-btn--sm ${isDirty && !saving ? "mil-btn--primary" : "mil-btn--default"}`}>
              ✓ Save
            </button>
          )}
          {isBuiltin && (
            <span style={{ fontSize: 10, color: "var(--om-text-muted)", fontStyle: "italic" }}>Built-in — use Save as copy</span>
          )}

          <button onClick={() => setShowCopyDialog(true)} className="mil-btn mil-btn--primary mil-btn--sm"
            style={{ background: "var(--om-accent)", borderColor: "var(--om-accent)" }}>
            ⎘ Save as copy
          </button>

          {!isBuiltin && (
            <button onClick={() => setShowDeleteConfirm(true)} className="mil-btn mil-btn--danger mil-btn--sm">
              ✕ Delete
            </button>
          )}

          {isDirty && (
            <button onClick={handleDiscard} className="mil-btn mil-btn--ghost mil-btn--sm">Discard</button>
          )}
        </div>
      </div>

      {/* Graph */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <CompositionBuilder
          key={template.id}
          root={draft}
          onRootChange={setDraft}
          hierarchyTemplates={allTemplates}
          onSaveHierarchyTemplate={async () => {}}
          onDeleteHierarchyTemplate={async () => {}}
        />
      </div>

      {/* Save-as-copy dialog */}
      {showCopyDialog && (
        <SaveAsCopyDialog
          existingNames={existingNames}
          suggestedName={`${draftName} (copy)`}
          onConfirm={(name, description) => {
            onSaveAsCopy(draft, name, description);
            setShowCopyDialog(false);
          }}
          onClose={() => setShowCopyDialog(false)}
        />
      )}

      {/* Delete confirmation dialog — replaces sandboxed confirm() */}
      {showDeleteConfirm && (
        <DeleteConfirmDialog
          templateName={template.name}
          onConfirm={() => { setShowDeleteConfirm(false); void onDelete(template.id); }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

export default function App() {
  const workshopCtxAsync = useWorkshopContext(ORBAT_CONFIG);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workshopCtx = workshopCtxAsync.status === "LOADED" ? (workshopCtxAsync.value as any) : null;

  // The operation arrives as an object set rather than a bare key, so Workshop
  // can type-check the wiring. We still work in primary keys internally — the
  // whole app is keyed on operationKey — so take the first key from the set.
  const operationKey: string =
    firstPrimaryKey(workshopCtx?.operation) || "OP-NORDIC-2026";

  // Phase to import, likewise an object set. Replaces the phaseOrbatJson
  // string: rather than another widget pushing an entire ORBAT across as JSON,
  // we are told which phase to show and read its ORBAT from the ontology.
  const phaseKey: string = firstPrimaryKey(workshopCtx?.phase);

  // ── Operation Phase Groups ───────────────────────────────────────────────
  // Session-scoped store of multi-phase operation timelines.
  // Each group has a canonical CompositionNode tree (stable ids) and one
  // PhaseSlot per imported phase (positions + relationship overrides).
  const [phaseGroups, setPhaseGroups] = useState<OperationPhaseGroup[]>(() => loadPhaseGroups());

  // Persist to sessionStorage whenever groups change.
  useEffect(() => { savePhaseGroups(phaseGroups); }, [phaseGroups]);

  // The group for the currently-active operationKey, or null if none yet.
  const activePhaseGroup = useMemo(
    () => phaseGroups.find((g) => g.operationKey === operationKey) ?? null,
    [phaseGroups, operationKey],
  );

  // Currently-selected phase slot id within the active group.
  const [selectedPhaseSlotId, setSelectedPhaseSlotId] = useState<string | null>(null);

  // Keep selectedPhaseSlotId in sync when the active group changes
  // (e.g. operationKey switched, or a new phase was added).
  useEffect(() => {
    if (!activePhaseGroup) { setSelectedPhaseSlotId(null); return; }
    const still = activePhaseGroup.phases.find((p) => p.id === selectedPhaseSlotId);
    if (!still && activePhaseGroup.phases.length > 0) {
      // Auto-select the latest phase.
      const latest = [...activePhaseGroup.phases].sort((a, b) => a.phaseIndex - b.phaseIndex);
      setSelectedPhaseSlotId(latest[latest.length - 1].id);
    }
  }, [activePhaseGroup, selectedPhaseSlotId]);

  // setMapPositions and setTopTab are declared further below.
  // We use refs to bridge the forward-references so switchToPhaseSlot can be
  // declared here alongside the rest of the phase-group state.
  const setMapPositionsRef = useRef<((updater: NodePositionMap | ((prev: NodePositionMap) => NodePositionMap)) => void) | null>(null);
  const setTopTabRef = useRef<((tab: TopTab) => void) | null>(null);
  const setMapRootIdsRef = useRef<((fn: (prev: string[]) => string[]) => void) | null>(null);

  // switchToPhaseSlot needs to read `hierarchies` and `activePhaseGroup` which
  // are declared later.  We use a stable ref + a concrete callback defined
  // after both state declarations (see below).
  const switchToPhaseSlotRef = useRef<(slotId: string) => void>(() => undefined);

  // Public stable wrapper — safe to pass as a prop now.
  const switchToPhaseSlot = useCallback((slotId: string) => switchToPhaseSlotRef.current(slotId), []);

  // ── "Link phase" manual-assignment state ─────────────────────────────────
  // When a phase payload arrives without a matching group (no operationKey,
  // or op key differs from all groups), we stash the parsed result here and
  // show the user a dialog to either create a new group or assign it to an
  // existing group.
  //
  // TODO(phase-link-dialog): implement the dialog UI (see PhaseGroupLinkDialog stub).
  // For now, unlinked phases fall back to the old per-template behaviour.
  const [_pendingLinkPayload, _setPendingLinkPayload] = useState<null | {
    ingestResult: ReturnType<typeof ingestPhaseOrbat>;
    suggestedOpKey: string;
  }>(null);
  // translatedInputOrbat: written by a Workshop translation function after
  // orbatJson (map placement output) is processed. This is what gets sent to CSE.
  const translatedOrbatRaw = workshopCtx?.translatedInputOrbat?.fieldValue;
  const translatedInputOrbat: string = (translatedOrbatRaw?.status === "LOADED" ? (translatedOrbatRaw.value as string) ?? "" : "").trim();
  // phaseDescription: written by an external application to request that
  // this widget generate a phase ORBAT via the llmPhaseToOrbat function.
  // See ORBAT_CONFIG.
  const phaseDescriptionRaw = workshopCtx?.phaseDescription?.fieldValue;
  const phaseDescription: string = (phaseDescriptionRaw?.status === "LOADED" ? (phaseDescriptionRaw.value as string) ?? "" : "").trim();

  const { state: orbatState } = useOrbatStore();

  // ── Templates loaded from the ontology ────────────────────────────────────
  const [ontologyTemplates, setOntologyTemplates] = useState<HierarchyTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading]  = useState(false);
  const [templatesError,   setTemplatesError]    = useState<string | null>(null);
  void templatesLoading; void templatesError; // surfaced in Templates tab header below

  const reloadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const raw = await loadHierarchyTemplates();
      const parsed: HierarchyTemplate[] = raw.map((t) => {
        try {
          const json = JSON.parse(t.templateJson) as Partial<HierarchyTemplate> & { phaseExtras?: unknown };
          const template: HierarchyTemplate = {
            id: t.primaryKey,
            name: t.name || json.name || "Unnamed",
            description: t.description || json.description || "",
            tags: t.tags ? t.tags.split(",").map((s) => s.trim()).filter(Boolean) : (json.tags ?? []),
            createdAt: t.createdAt,
            root: json.root!,
          };
          // Carry phase-origin coordinate data through as a non-typed extra
          // field so downstream code (map hydration) can access it without
          // widening the shared HierarchyTemplate type.
          if (json.phaseExtras) {
            (template as HierarchyTemplate & { phaseExtras?: unknown }).phaseExtras = json.phaseExtras;
          }
          // Stash the raw ontology echelon string so the phase-filter below
          // can check it without relying on the parsed tags array.
          (template as HierarchyTemplate & { _rawEchelon?: string })._rawEchelon = t.echelon ?? "";
          return template;
        } catch {
          return null;
        }
      }).filter((t): t is HierarchyTemplate => t !== null && !!t.root);
      setOntologyTemplates(parsed);
    } catch (e) {
      setTemplatesError(e instanceof Error ? e.message : String(e));
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => { void reloadTemplates(); }, [reloadTemplates]);

  // A template is "phase-type" if it has the phase-orbat tag, an echelon of
  // "Phase", or a name ending in " - ORBAT Template" (the canonical naming
  // convention used by the Scenario Planner).  Phase-type templates are
  // routed into the Hierarchy panel as phase hierarchies; all others are
  // surfaced in the Templates tab as reusable building blocks.
  const templates = ontologyTemplates.filter((t) => {
    // Exclude records that are identified as phase templates — they are
    // routed into the Hierarchy panel via the phaseMapStates pipeline instead.
    if (t.tags.includes(PHASE_TEMPLATE_TAG)) return false;
    if (t.tags.includes("phase-orbat")) return false;
    const rawEchelon = (t as HierarchyTemplate & { _rawEchelon?: string })._rawEchelon ?? "";
    if (rawEchelon === "Phase") return false;
    if (t.name.endsWith(" - ORBAT Template")) return false;
    return true;
  });

  // ── Phase Template polling ────────────────────────────────────────────────
  // Load all NxgOTemplateOrbatGraph records that are identified as phase
  // templates (tag "phase-orbat" or echelon "Phase" or name ending in
  // " - ORBAT Template"). We ingest them as "phase" kind Hierarchies so they
  // appear in the Hierarchy tab tagged as "⌖ Ontology".
  const [phaseMapStates, setPhaseMapStates] = useState<OPhaseMapState[]>([]);

  const reloadPhaseMapStates = useCallback(async () => {
    try {
      const states = await loadPhaseMapStates();
      setPhaseMapStates(states);
    } catch (e) {
      console.warn("[phaseMapState] Failed to load:", e);
    }
  }, []);

  useEffect(() => { void reloadPhaseMapStates(); }, [reloadPhaseMapStates]);

  // ── Hierarchy session store (declared early — used by phase ingest below) ──
  const [hierarchies, setHierarchies] = useState<Hierarchy[]>(() => loadHierarchies());
  useEffect(() => { saveHierarchies(hierarchies); }, [hierarchies]);

  // ── Phase-ORBAT ingest ────────────────────────────────────────────────────
  //
  // When a phase arrives on the `phase` Workshop input, we look up the ORBAT
  // the Scenario Planner stored for it and:
  //   1. Parse & convert it into a CompositionNode tree + NodePositionMap
  //   2. Save it as a HierarchyTemplate whose templateJson carries the
  //      per-node coordinates under a `phaseExtras` field (see PhaseTemplateExtras).
  //   3. Reload the templates list so the new template shows up in the UI.
  //   4. Auto-hydrate map placement from the coordinates.
  //
  // The ref holds the last phase id ingested, so Workshop's polling re-renders
  // do not re-import the same phase. (It previously held the last payload
  // string, back when the ORBAT itself was pushed in over a Workshop variable.)
  const lastIngestedPhaseRef = useRef<string>("");
  const [phaseIngestError, setPhaseIngestError] = useState<string | null>(null);
  const [phaseIngestBusy, setPhaseIngestBusy] = useState(false);
  const [pendingPhaseHydration, setPendingPhaseHydration] = useState<{
    rootId: string;
    positions: Map<string, import("./lib/localStore").NodePosition>;
  } | null>(null);

  /**
   * Shared ingest pipeline used by all of:
   *   (b) the `phase` Workshop input (imports that phase's stored ORBAT)
   *   (c) the manual paste-in importer on the Templates tab
   *   (d) llmPhaseToOrbat generation from `phaseDescription`.
   *
   * Returns null on success, or a user-facing error message on failure.
   * Never throws — callers can safely `await` and just check the return value.
   */
  const runPhaseIngest = useCallback(async (rawJson: string, parentNodeName?: string): Promise<string | null> => {
    if (!rawJson.trim()) return "Payload is empty.";
    setPhaseIngestError(null);
    setPhaseIngestBusy(true);
    try {
      const payload = parsePhaseOrbatPayload(rawJson);
      const result  = ingestPhaseOrbat(payload, { affiliation: "Friend", syntheticRootName: parentNodeName });

      const groupingOpKey = payload.operationKey ?? operationKey;
      const assignedPhaseName =
        payload.phaseName ?? `Phase ${
          (hierarchies.find((h) => h.kind === "phase" && h.operationKey === groupingOpKey)?.phases.length ?? 0) + 1
        }`;

      // ── Look up an existing phase hierarchy for this operation key ────────
      const existingHierarchy = hierarchies.find(
        (h) => h.kind === "phase" && h.operationKey === groupingOpKey,
      ) ?? null;

      let finalPositions = result.positions;
      let finalRelationships: Record<string, string> = {};
      let canonicalRoot = result.root;

      if (existingHierarchy) {
        // ── Second-or-later phase — remap ids to canonical tree ─────────────
        const { matches, unmatchedIncoming } = matchIncomingToBaseline(
          result.root,
          existingHierarchy.canonicalRoot,
        );
        const { idMap } = applyIdRemap(result.root, matches);
        finalPositions    = remapPositions(result.positions, idMap);
        finalRelationships = extractRelationships(result.root, payload.units, idMap);
        canonicalRoot     = existingHierarchy.canonicalRoot;

        if (unmatchedIncoming.length > 0) {
          console.warn(`[phaseIngest] ${unmatchedIncoming.length} unmatched unit(s) for "${groupingOpKey}"`);
        }

        const newSlot: Omit<HierarchyPhaseSlot, "id" | "phaseIndex"> = {
          phaseName: assignedPhaseName,
          positionsById: positionsMapToObject(finalPositions),
          relationshipsByEdgeId: finalRelationships,
          sourceRef: null,
        };
        const updated = addPhaseSlotToHierarchy(existingHierarchy, newSlot, payload.phaseIndex ?? undefined);
        setHierarchies((prev) => prev.map((h) => h.id === existingHierarchy.id ? updated : h));

        const newestSlot = updated.phases[updated.phases.length - 1];
        setSelectedHierarchyId(updated.id);
        setSelectedPhaseSlotId(newestSlot.id);
        // Merge new slot's positions — keep all other ORBATs on the map
        const newestPositions = slotToPositionMap(newestSlot);
        setMapPositions((prev) => {
          const next = new Map(prev);
          newestPositions.forEach((v, k) => next.set(k, v));
          return next;
        });
      } else {
        // ── First phase — create a new Hierarchy ─────────────────────────────
        finalRelationships = extractRelationships(result.root, payload.units, new Map());
        const hierarchyName =
          (payload.description ? payload.description.slice(0, 60).replace(/\.$/, "") : "")
          || canonicalRoot.unitIdentifier
          || `Phase ORBAT ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

        const newH = createPhaseHierarchy({
          name: hierarchyName,
          description: result.description,
          operationKey: groupingOpKey,
          canonicalRoot,
          firstSlot: {
            phaseName: assignedPhaseName,
            positionsById: positionsMapToObject(result.positions),
            relationshipsByEdgeId: finalRelationships,
            sourceRef: null,
          },
        });
        setHierarchies((prev) => [...prev, newH]);

        setSelectedHierarchyId(newH.id);
        setSelectedPhaseSlotId(newH.phases[0].id);
        setPendingPhaseHydration({ rootId: canonicalRoot.id, positions: result.positions });
      }

      // Switch to Map tab so user immediately sees the placed ORBAT.
      setTopTab("map");
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPhaseIngestError(msg);
      return msg;
    } finally {
      setPhaseIngestBusy(false);
    }
  }, [operationKey, hierarchies]);

  // (b) Auto-ingest whenever the `phase` Workshop input changes.
  //
  // Previously another widget pushed the whole ORBAT here as a JSON string.
  // Now we are told which phase to show and read its ORBAT out of the Template
  // Orbat Graph record the Scenario Planner wrote for it — one source of truth,
  // and the payload cannot drift from the phase it belongs to.
  //
  // The ref guard remains: Workshop re-renders on a poll, so without it the
  // same phase would be re-imported repeatedly.
  useEffect(() => {
    if (!phaseKey) return;
    if (phaseKey === lastIngestedPhaseRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const states = await loadPhaseMapStates();
        const match = states.find((s) => s.phaseId === phaseKey);
        if (cancelled) return;

        if (!match?.startStateMapJson) {
          console.warn(
            `[ORBAT] Phase ${phaseKey} has no stored ORBAT template — nothing to import. ` +
            `The Scenario Planner writes one when units are placed on that phase.`,
          );
          setPhaseIngestError(
            `No ORBAT has been planned for this phase yet. Place units on it in the Scenario Planner first.`,
          );
          return;
        }

        lastIngestedPhaseRef.current = phaseKey;
        await runPhaseIngest(match.startStateMapJson);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ORBAT] Could not load the ORBAT for phase ${phaseKey}:`, err);
        setPhaseIngestError(msg);
      }
    })();

    return () => { cancelled = true; };
  }, [phaseKey, runPhaseIngest]);

  /**
   * Prompt-driven generation via the `llmPhaseToOrbat` Foundry function.
   *
   * The function returns the same {description, units[…]} JSON shape as the
   * Workshop-variable payload — including per-unit `location.lat` / `location.lon`
   * fields — so we can pipe its output straight through `runPhaseIngest`.
   *
   * We update `lastIngestedPhaseRef` before ingest so that if the Workshop
   * variable happens to be updated with the same payload later, we don't
   * double-import it.
   */
  const runPhaseGenerate = useCallback(async (
    description: string,
    nationalityHint?: string,
    parentNodeName?: string,
  ): Promise<string | null> => {
    if (!description.trim()) return "Description is empty.";
    setPhaseIngestError(null);
    setPhaseIngestBusy(true);
    try {
      console.log("[llmPhaseToOrbat] Calling with description:", description.slice(0, 120));
      const raw = await (client(llmPhaseToOrbat as unknown as Parameters<typeof client>[0]) as unknown as {
        executeFunction: (args: { description: string; nationalityHint?: string }) => Promise<string>;
      }).executeFunction({
        description: description.trim(),
        ...(nationalityHint ? { nationalityHint: nationalityHint.trim() } : {}),
      });
      console.log(`[llmPhaseToOrbat] ✓ Got ${raw.length} chars back`);
      lastIngestedPhaseRef.current = raw;
      return await runPhaseIngest(raw, parentNodeName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[llmPhaseToOrbat] ✗ Failed:", e);
      setPhaseIngestError(msg);
      return msg;
    } finally {
      setPhaseIngestBusy(false);
    }
  }, [runPhaseIngest]);

  // (d) Auto-generate whenever the `phaseDescription` Workshop variable changes.
  //
  // This mirrors the (b) phaseOrbatJson auto-ingest, but for the *generate*
  // path — another app can write a phase description here and we'll call
  // llmPhaseToOrbat with it, then feed the returned JSON through the same
  // pipeline.  Separate ref-guard from lastIngestedPhaseRef so a prompt that
  // happens to coincide with a previous JSON payload doesn't clash.
  const lastGeneratedPromptRef = useRef<string>("");
  useEffect(() => {
    if (!phaseDescription) return;
    if (phaseDescription === lastGeneratedPromptRef.current) return;
    lastGeneratedPromptRef.current = phaseDescription;
    void runPhaseGenerate(phaseDescription);
  }, [phaseDescription, runPhaseGenerate]);

  // ── Hierarchy session store (second declaration — remove duplicate early one) ──

  // ── Operation root loader ─────────────────────────────────────────────────
  const [opLoading, setOpLoading] = useState(false);
  const [opError,   setOpError]   = useState<string | null>(null);
  const prevOpKeyRef = useRef("");

  // Keep a plain ref to the raw op root for map exports
  const opRoot = useMemo(
    () => hierarchies.find((h) => h.kind === "operation" && h.operationKey === operationKey)?.canonicalRoot ?? null,
    [hierarchies, operationKey],
  );

  useEffect(() => {
    const key = operationKey.trim();
    if (!key || key === prevOpKeyRef.current) return;
    prevOpKeyRef.current = key;
    // Check if we already have this op loaded
    if (hierarchies.some((h) => h.kind === "operation" && h.operationKey === key)) return;
    setOpLoading(true); setOpError(null);
    loadOperationTree(key)
      .then((root) => {
        const h = createHierarchyFromRoot({ name: root.unitIdentifier || key, kind: "operation", operationKey: key, root });
        setHierarchies((prev) => {
          // Replace any existing op hierarchy for this key
          const without = prev.filter((x) => !(x.kind === "operation" && x.operationKey === key));
          return [...without, h];
        });
        setSelectedHierarchyId(h.id);
      })
      .catch((e) => setOpError(e instanceof Error ? e.message : String(e)))
      .finally(() => setOpLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationKey]);

  // ── Selected hierarchy ────────────────────────────────────────────────────
  const [selectedHierarchyId, setSelectedHierarchyId] = useState<string | null>(null);

  // Auto-select the op hierarchy when it first appears
  useEffect(() => {
    if (selectedHierarchyId) return;
    const opH = hierarchies.find((h) => h.kind === "operation" && h.operationKey === operationKey);
    if (opH) setSelectedHierarchyId(opH.id);
  }, [hierarchies, operationKey, selectedHierarchyId]);

  // ── Define-ORBAT session from the Scenario Planner ───────────────────────
  // /orbat?define=1 with a request parked in sessionStorage. We seed a DRAFT
  // hierarchy from the placed unit's type — nothing is written to the ontology
  // until the planner presses Confirm in the banner below.
  const navigate = useNavigate();
  const [defineRequest, setDefineRequest] = useState<OrbatDefineRequest | null>(null);
  const [defineBusy, setDefineBusy] = useState(false);
  const [defineError, setDefineError] = useState<string | null>(null);
  const defineSeededRef = useRef(false);

  useEffect(() => {
    if (defineSeededRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("define") !== "1") return;
    const request = readOrbatDefinitionRequest();
    if (!request) return;
    defineSeededRef.current = true;
    setDefineRequest(request);

    // Draft tree, local to this session — the planner can edit it in the graph
    // or list view, or regenerate it with a prompt, before confirming.
    //
    // The SWORD catalogue is loaded first so generated formations arrive with
    // an asset already attached. Without it every node came out blank, which
    // is what "the graph comes up and I can't see the assigned asset" was.
    // A catalogue failure is not fatal: the draft is still worth showing, and
    // the missing links are visible as badges rather than silently accepted.
    void (async () => {
      const swordFormations = await loadSwordFormations().catch((err: unknown) => {
        console.warn("[OrbatManager] SWORD catalogue unavailable; draft will be structural:", err);
        return undefined;
      });

      const draftRoot = buildOrbatSkeleton(
        {
          id: request.unitId,
          templateId: request.templateId ?? "",
          label: request.unitLabel,
          sidc: request.sidc,
          lat: request.lat,
          lng: request.lng,
        },
        { depth: 2, swordFormations },
      );
      const draft = createHierarchyFromRoot({
        name: `${request.unitLabel} (draft)`,
        kind: "force",
        operationKey,
        root: draftRoot,
      });
      setHierarchies((prev) => [...prev, draft]);
      setSelectedHierarchyId(draft.id);
      console.log(
        `[OrbatManager] defining ORBAT for "${request.unitLabel}" — draft seeded, not yet saved`,
      );
    })();
  }, [operationKey]);

  /** Write the confirmed tree to the ontology and hand the keys back. */
  const handleConfirmDefine = useCallback(async () => {
    if (!defineRequest || defineBusy) return;
    const hierarchy = hierarchies.find((h) => h.id === selectedHierarchyId);
    const root = hierarchy?.canonicalRoot;
    if (!root) {
      setDefineError("Nothing to save — build the ORBAT first.");
      return;
    }

    setDefineBusy(true);
    setDefineError(null);
    try {
      const result = await commitOrbatForPlacement({
        scenarioId: defineRequest.scenarioId,
        scenarioName: defineRequest.scenarioName,
        root,
        side: defineRequest.side,
        lat: defineRequest.lat,
        lng: defineRequest.lng,
        unitLabel: defineRequest.unitLabel,
      });
      publishOrbatDefinitionResult({
        unitId: defineRequest.unitId,
        rootUnitKey: result.rootUnitKey,
        hierarchyKey: result.hierarchyKey,
        unitsCreated: result.unitsCreated,
      });
      // Tell the host page the ontology changed, so anything showing this
      // operation's units can refresh instead of going stale.
      workshopCtx?.onOrbatSaved?.executeEvent?.(undefined);
      clearOrbatDefinitionRequest();
      navigate(defineRequest.returnTo);
    } catch (err) {
      const detail = err instanceof Error ? err.message : describeActionError(err);
      console.error("[OrbatManager] Could not save the ORBAT:", detail, err);
      setDefineError(detail);
    } finally {
      setDefineBusy(false);
    }
  }, [defineRequest, defineBusy, hierarchies, selectedHierarchyId, navigate]);

  const handleCancelDefine = useCallback(() => {
    const returnTo = defineRequest?.returnTo ?? "/scenario-plan";
    clearOrbatDefinitionRequest();
    setDefineRequest(null);
    navigate(returnTo);
  }, [defineRequest, navigate]);

  // ── Deep link from the Scenario Planner ──────────────────────────────────
  // /orbat?hierarchy=<NxgUnitHierarchy key>&root=<NxgUnit key>
  //
  // The planner writes a placed unit's ORBAT straight into the ontology, then
  // sends the planner here to refine it. Load that sub-tree, wrap it in a
  // session Hierarchy and select it, so the user lands on their unit's ORBAT
  // instead of having to hunt for it in the selector.
  const deepLinkHandledRef = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hierarchyKey = params.get("hierarchy");
    const rootUnitKey = params.get("root");
    if (!hierarchyKey) return;

    const linkId = `${hierarchyKey}::${rootUnitKey ?? "*"}`;
    if (deepLinkHandledRef.current === linkId) return;
    deepLinkHandledRef.current = linkId;

    let cancelled = false;

    // ── Whole hierarchy: /orbat?hierarchy=… with no root ──────────────────
    // A scenario hierarchy holds one tree per side, so there is no single
    // root to open. Load the forest and add an entry per side, which is what
    // the "Blue Force" / "Red Force" links land on when the planner has not
    // told us which unit is on top.
    if (!rootUnitKey) {
      (async () => {
        try {
          const forest = await loadOrbatForest(hierarchyKey);
          if (cancelled) return;
          if (forest.trees.length === 0) {
            console.warn(`[OrbatManager] deep link: ${hierarchyKey} has no edges yet`);
            return;
          }
          const created = forest.trees.map((tree) =>
            createHierarchyFromRoot({
              name: tree.root.unitIdentifier || "Scenario ORBAT",
              kind: "force",
              operationKey,
              root: tree.root,
            }),
          );
          setHierarchies((prev) => [...prev, ...created]);
          setSelectedHierarchyId(created[0].id);
          console.log(
            `[OrbatManager] deep link: loaded ${forest.trees.length} force(s) from ` +
              `${hierarchyKey} (${forest.nodeCount} nodes` +
              `${forest.truncated ? ", truncated" : ""})`,
          );
        } catch (err) {
          console.error("[OrbatManager] deep link (forest) failed:", err);
        }
      })();
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        const subtree = await loadOrbatSubtree(hierarchyKey, rootUnitKey);
        if (cancelled) return;
        if (!subtree) {
          console.warn(
            `[OrbatManager] deep link: unit ${rootUnitKey} not found in hierarchy ${hierarchyKey}`,
          );
          return;
        }

        // Reuse an already-loaded view of the same root rather than stacking
        // duplicates every time the planner links across.
        const existing = hierarchies.find((h) => h.canonicalRoot?.id === subtree.root.id);
        if (existing) {
          setSelectedHierarchyId(existing.id);
          return;
        }

        const created = createHierarchyFromRoot({
          name: subtree.root.unitIdentifier || "Scenario ORBAT",
          kind: "force",
          operationKey,
          root: subtree.root,
        });
        setHierarchies((prev) => [...prev, created]);
        setSelectedHierarchyId(created.id);
        console.log(
          `[OrbatManager] deep link: loaded "${subtree.root.unitIdentifier}" ` +
            `(${subtree.nodeCount} nodes${subtree.truncated ? ", truncated" : ""})`,
        );
      } catch (err) {
        console.error("[OrbatManager] deep link failed:", err);
      }
    })();

    return () => { cancelled = true; };
    // `hierarchies` is intentionally omitted: this must run once per link, not
    // on every hierarchy-list change (which this effect itself causes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationKey]);

  const activeHierarchy = hierarchies.find((h) => h.id === selectedHierarchyId) ?? null;
  const activeRoot = activeHierarchy?.canonicalRoot ?? null;

  // ── Auto-ingest phase templates from NxgOTemplateOrbatGraph ─────────────
  // For every phase-tagged Template Orbat Graph record we try to parse its
  // templateJson (the ORBAT JSON from llmPhaseToOrbat) as a PhaseOrbatPayload
  // and turn it into a Hierarchy.
  //
  // The phase slot is always added, even when parsing fails, so the hierarchy
  // row appears in the selector.  Failed slots carry a `parseError` message
  // and an empty positionsById; the selector renders them with an error badge.
  //
  // Each slot carries `ontologyMapStateId` (set to the template's primary key)
  // so the UI can show "⌖ Ontology" vs "✎ Manual" badges, and
  // `sourceRef = "start:<id>"` as the deduplication key.
  useEffect(() => {
    if (phaseMapStates.length === 0) return;

    setHierarchies((prev) => {
      // Build a dedupe set from all existing sourceRefs across all hierarchies
      const existingSourceRefs = new Set(
        prev.flatMap((h) => h.phases.map((p) => p.sourceRef ?? "")),
      );

      const toAdd: Hierarchy[] = [];

      for (const pms of phaseMapStates) {
        // sourceRef key — same pattern as before for deduplication
        const slot = `start:${pms.mapStateId}`;
        if (existingSourceRefs.has(slot)) continue;

        const jsonStr = pms.startStateMapJson;

        // ── Derive a human-readable hierarchy name ────────────────────────
        // The template name convention is:
        //   "{operation} - {phase} - ORBAT Template"
        // We look it up from ontologyTemplates (already loaded) so we can
        // show the full human-readable name.  Fall back to "Phase <id>".
        const matchingTemplate = ontologyTemplates.find(
          (t) => t.id === pms.mapStateId,
        );
        const hierarchyName = (() => {
          if (matchingTemplate?.name) {
            // Strip the " - ORBAT Template" suffix for a cleaner label
            const n = matchingTemplate.name;
            return n.endsWith(" - ORBAT Template")
              ? n.slice(0, n.length - " - ORBAT Template".length)
              : n;
          }
          const phaseLabel = pms.phaseId ?? pms.mapStateId.slice(0, 8);
          return `Phase ${phaseLabel}`;
        })();

        // Attempt to parse + ingest the ORBAT JSON
        let parsed: ReturnType<typeof ingestPhaseOrbat> | null = null;
        let parseError: string | null = null;

        if (!jsonStr || !jsonStr.trim()) {
          parseError = "No ORBAT JSON stored on this Template Orbat Graph object.";
        } else {
          try {
            const payload = parsePhaseOrbatPayload(jsonStr);
            // Respect a parentNodeName that was embedded in the payload by the
            // Scenario Planner's publish pipeline (stored under the key
            // "parentNodeName" alongside the description + units fields).
            const embeddedParentName = (() => {
              try {
                const obj = JSON.parse(jsonStr) as Record<string, unknown>;
                return typeof obj.parentNodeName === "string" && obj.parentNodeName.trim()
                  ? obj.parentNodeName.trim()
                  : undefined;
              } catch { return undefined; }
            })();
            parsed = ingestPhaseOrbat(payload, { affiliation: "Friend", syntheticRootName: embeddedParentName });
          } catch (e) {
            parseError = e instanceof Error ? e.message : String(e);
            console.warn(`[phaseMapState] Failed to parse ORBAT for ${slot}:`, e);
          }
        }

        const newH = createPhaseHierarchy({
          name: hierarchyName,
          description: [
            `Source: [NXG-O] Template Orbat Graph — id: ${pms.mapStateId}`,
            pms.phaseId ? `Phase ID: ${pms.phaseId}` : null,
            parseError ? `⚠ Parse error: ${parseError}` : null,
          ].filter(Boolean).join(" · "),
          operationKey: operationKey,
          canonicalRoot: parsed?.root ?? {
            id: `placeholder-${pms.mapStateId}`,
            unitIdentifier: hierarchyName,
            echelon: "Battalion",
            sidc: "SFGPUCI---MBI-",
            entityType: "organisation",
            militaryService: "Army",
            affiliation: "Friend",
            allegiance: "GBR",
            owningSimulator: "vbs4",
            canonicalAssetKey: null,
            simulatorIdentifierCode: null,
            unitTypeKey: null,
            equipmentTypeKey: null,
            quantity: 1,
            children: [],
          },
          firstSlot: {
            phaseName: "ORBAT",
            positionsById: parsed ? positionsMapToObject(parsed.positions) : {},
            relationshipsByEdgeId: parsed
              ? extractRelationships(parsed.root, [], new Map())
              : {},
            sourceRef: slot,
            ontologyMapStateId: pms.mapStateId,
            parseError: parseError,
          },
        });

        toAdd.push(newH);
      }

      if (toAdd.length === 0) return prev;
      console.log(`[phaseMapState] Auto-ingesting ${toAdd.length} phase template hierarchies from NxgOTemplateOrbatGraph`);
      return [...prev, ...toAdd];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseMapStates]);

  // Build HierarchyEntry list for the selector
  const hierarchyEntries = useMemo(() =>
    hierarchies.map((h) => ({
      hierarchy: h,
      displayRoot: h.canonicalRoot,
      isDirty: false, // structural edits are committed immediately into the store
    })),
  [hierarchies]);

  /** Commit a structural edit to the active hierarchy. */
  const handleRootChange = useCallback((root: CompositionNode) => {
    if (!activeHierarchy) return;
    setHierarchies((prev) =>
      prev.map((h) => h.id === activeHierarchy.id ? updateHierarchyRoot(h, root) : h),
    );
  }, [activeHierarchy]);

  const handleResetRoot = useCallback(() => {
    // No-op in the new model — edits are immediately committed.
    // A future "undo" feature could implement this properly.
  }, []);

  /** Back-compat alias used by map export code below. */
  const editedRoot = activeRoot;

  // ── New hierarchy prompt ──────────────────────────────────────────────────
  const [showNewHierarchyDialog, setShowNewHierarchyDialog] = useState(false);
  void showNewHierarchyDialog; // not yet rendered — placeholder for future dialog
  const [newHierarchyName, setNewHierarchyName] = useState("");
  void newHierarchyName; void setNewHierarchyName; // same
  const [showPhaseImportPanel, setShowPhaseImportPanel] = useState(false);

  const [topTab, setTopTab] = useState<TopTab>("hierarchy");
  const [hierarchyView, setHierarchyView] = useState<"graph" | "tree">("graph");
  // Single shared selection — used by both graph and tree views
  const [hierarchySelectedId, setHierarchySelectedId] = useState<string | null>(null);
  // Alias for tree view code below
  const treeSelectedId = hierarchySelectedId;

  // ── Outputs: selected unit and active hierarchy ───────────────────────────
  //
  // The widget had no outputs at all, so a Workshop page could hand it an
  // operation but never learn anything back — you could not put a unit detail
  // card next to the ORBAT. Both are pushed as object sets, so the rest of the
  // page can traverse links (unit → simulator asset, hierarchy → units) rather
  // than being handed a copy of the data.
  useEffect(() => {
    if (!workshopCtx) return;
    const unitKey = treeSelectedId;
    if (!unitKey) {
      workshopCtx.selectedUnit?.setLoading?.();
      return;
    }

    let cancelled = false;
    workshopCtx.selectedUnit?.setLoading?.();

    (async () => {
      try {
        // Nodes that have not been written to the ontology yet carry a local
        // uuid, so this object set comes back empty for them. That is the
        // honest answer: there is no NxgUnit to point at until it is saved.
        const rid = await createAndFetchTempObjectSetRid(
          client,
          client(NxgUnit).where({ $primaryKey: unitKey }),
        );
        if (cancelled) return;
        workshopCtx.selectedUnit?.setLoadedValue?.(rid);
        workshopCtx.onUnitSelected?.executeEvent?.(undefined);
      } catch (err) {
        if (cancelled) return;
        console.warn("[OrbatManager] Could not publish the selected unit:", err);
        workshopCtx.selectedUnit?.setFailedWithError?.("Failed to resolve unit object set");
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeSelectedId, !!workshopCtx]);

  useEffect(() => {
    if (!workshopCtx) return;
    if (!selectedHierarchyId) {
      workshopCtx.hierarchy?.setLoading?.();
      return;
    }

    let cancelled = false;
    workshopCtx.hierarchy?.setLoading?.();

    (async () => {
      try {
        const rid = await createAndFetchTempObjectSetRid(
          client,
          client(NxgUnitHierarchy).where({ $primaryKey: selectedHierarchyId }),
        );
        if (cancelled) return;
        workshopCtx.hierarchy?.setLoadedValue?.(rid);
      } catch (err) {
        if (cancelled) return;
        console.warn("[OrbatManager] Could not publish the active hierarchy:", err);
        workshopCtx.hierarchy?.setFailedWithError?.("Failed to resolve hierarchy object set");
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHierarchyId, !!workshopCtx]);
  const setTreeSelectedId = setHierarchySelectedId;
  // Ref that the graph view's CompositionBuilder will populate so tree can trigger focus
  const graphFocusNodeRef = useRef<((id: string) => void) | null>(null);
  // Pending focus request — set when switching from tree→graph before canvas is ready
  const pendingFocusIdRef = useRef<string | null>(null);
  const [treeAddChildParentId, setTreeAddChildParentId] = useState<string | null>(null);
  const { refData } = useCompositionData();

  const treeSelectedNode = useMemo(() => {
    if (!activeRoot || !treeSelectedId) return null;
    return findNode(activeRoot, treeSelectedId);
  }, [activeRoot, treeSelectedId]);

  const treeParentNode = useMemo(() => {
    if (!activeRoot || !treeSelectedId) return null;
    function findParent(node: CompositionNode, targetId: string): CompositionNode | null {
      for (const child of node.children) {
        if (child.id === targetId) return node;
        const found = findParent(child, targetId);
        if (found) return found;
      }
      return null;
    }
    return findParent(activeRoot, treeSelectedId);
  }, [activeRoot, treeSelectedId]);

  function updateNodeInTree(node: CompositionNode, id: string, fn: (n: CompositionNode) => CompositionNode): CompositionNode {
    if (node.id === id) return fn(node);
    return { ...node, children: node.children.map((c) => updateNodeInTree(c, id, fn)) };
  }

  function removeNodeFromTree(node: CompositionNode, id: string): CompositionNode | null {
    if (node.id === id) return null;
    return { ...node, children: node.children.map((c) => removeNodeFromTree(c, id)).filter((c): c is CompositionNode => c !== null) };
  }

  const handleTreeUpdate = useCallback((id: string, updates: Partial<CompositionNode>) => {
    if (!activeRoot) return;
    handleRootChange(updateNodeInTree(activeRoot, id, (n) => ({ ...n, ...updates })));
  }, [activeRoot, handleRootChange]);

  const handleTreeRemove = useCallback((id: string) => {
    if (!activeRoot) return;
    handleRootChange(removeNodeFromTree(activeRoot, id) ?? activeRoot);
    setTreeSelectedId(activeRoot.id);
  }, [activeRoot, handleRootChange]);

  const handleTreeAddChildConfirm = useCallback((parentId: string, child: CompositionNode) => {
    if (!activeRoot) return;
    handleRootChange(addChildToNode(activeRoot, parentId, child));
    setTreeSelectedId(child.id);
    setTreeAddChildParentId(null);
  }, [activeRoot, handleRootChange]);

  // ── Template editor state ──────────────────────────────────────────────────
  const [selectedTplId, setSelectedTplId] = useState<string | null>(null);
  const [mapPositions, setMapPositions] = useState<NodePositionMap>(new Map());
  // Wire setMapPositions / setTopTab / setMapRootIds into refs so
  // switchToPhaseSlot can call them without forward-reference problems.
  useEffect(() => { setMapPositionsRef.current = setMapPositions; }, []);
  useEffect(() => { setTopTabRef.current = setTopTab; }, []);
  useEffect(() => { setMapRootIdsRef.current = setMapRootIds; }, []);

  // Wire the concrete switchToPhaseSlot implementation now that hierarchies and
  // activePhaseGroup are in scope.
  useEffect(() => {
    switchToPhaseSlotRef.current = (slotId: string) => {
      // New hierarchies store — covers ontology-ingested phases
      for (const h of hierarchies) {
        const slot = h.phases.find((p) => p.id === slotId);
        if (slot) {
          setSelectedPhaseSlotId(slotId);
          const rootId = h.canonicalRoot.id;
          setMapRootIdsRef.current?.((prev) => prev.includes(rootId) ? prev : [rootId, ...prev]);
          // Merge this slot's positions on top of existing ones (never wipe other ORBATs)
          const slotPositions = slotToPositionMap(slot);
          setMapPositionsRef.current?.((prev: NodePositionMap) => {
            const next = new Map(prev);
            slotPositions.forEach((v, k) => next.set(k, v));
            return next;
          });
          setTopTabRef.current?.("map");
          return;
        }
      }
      // Legacy phaseGroupStore fallback
      const phaseSlot = activePhaseGroup?.phases.find((p) => p.id === slotId);
      if (!phaseSlot) return;
      setSelectedPhaseSlotId(slotId);
      // Merge positions — keep all other ORBATs on the map
      const legacyPositions = slotToPositionMap(phaseSlot);
      setMapPositionsRef.current?.((prev: NodePositionMap) => {
        const next = new Map(prev);
        legacyPositions.forEach((v, k) => next.set(k, v));
        return next;
      });
    };
  }, [hierarchies, activePhaseGroup]);
  const [mapRootIds,   setMapRootIds]   = useState<string[]>([]);
  const [orbatExport,  setOrbatExport]  = useState<OrbatExport | null>(null);
  const handleExport = useCallback((data: OrbatExport) => setOrbatExport(data), []);

  // Map starts empty — user explicitly adds forces/templates via the sidebar.
  // (Previously auto-added the op root on load; that is now opt-in.)

  // Phase-origin templates: the ones whose templateJson carries `phaseExtras`.
  // Indexed by root.id so we can look them up when hydrating map placement or
  // when computing which items to expose in the map's "add to map" sidebar.
  const phaseTemplatesByRootId = useMemo(() => {
    const map = new Map<string, HierarchyTemplate & { phaseExtras?: PhaseTemplateExtras }>();
    for (const tpl of templates) {
      const withExtras = tpl as HierarchyTemplate & { phaseExtras?: PhaseTemplateExtras };
      if (withExtras.phaseExtras?.origin === PHASE_TEMPLATE_TAG && withExtras.root?.id) {
        map.set(withExtras.root.id, withExtras);
      }
    }
    return map;
  }, [templates]);

  // ── Phase-switcher state ───────────────────────────────────────────────────
  //
  // All phase-origin templates for the CURRENT operationKey, sorted by
  // phaseIndex.  The map-tab PhaseSwitcher lets the user flip between them;
  // switching swaps `mapPositions` to that phase's saved coordinates while
  // ── Phase-switcher items — derived from the session phaseGroupStore ────────
  //
  // The switcher now drives from `activePhaseGroup` (phaseGroupStore) rather
  // than the legacy phaseTemplatesByRootId map.  The legacy map is still kept
  // for the "add to map" sidebar (available items) but is no longer the source
  // of truth for which phase is selected or what positions are shown.
  // phaseSwitcherItems — kept for future use, not currently rendered in the UI
  void useMemo<PhaseSwitcherItem[]>(() => {
    if (!activePhaseGroup) return [];
    return [...activePhaseGroup.phases]
      .sort((a, b) => a.phaseIndex - b.phaseIndex)
      .map((slot, i) => ({
        id: slot.id,
        label: slot.phaseName ?? `Phase ${i + 1}`,
        phaseIndex: slot.phaseIndex,
        description: undefined,
      }));
  }, [activePhaseGroup]);

  // Mount the canonical root whenever the active group changes.
  // This is how the single stable unit tree gets on the map for the first time.
  useEffect(() => {
    if (!activePhaseGroup) return;
    const rootId = activePhaseGroup.canonicalRoot.id;
    setMapRootIds((prev) => prev.includes(rootId) ? prev : [rootId, ...prev]);
  }, [activePhaseGroup]);

  // Build a lookup of all hierarchy canonical roots so switchToPhaseSlot
  // can resolve any phase hierarchy root, not just the active group.
  const hierarchyRootsById = useMemo(() => {
    const m = new Map<string, CompositionNode>();
    for (const h of hierarchies) m.set(h.canonicalRoot.id, h.canonicalRoot);
    return m;
  }, [hierarchies]);

  const allMapRoots = useMemo(() => {
    const out: CompositionNode[] = [];
    for (const id of mapRootIds) {
      if (editedRoot?.id === id) { out.push(editedRoot); continue; }
      if (opRoot?.id === id)     { out.push(opRoot); continue; }
      // All hierarchy canonical roots (covers ontology-sourced phase hierarchies)
      const hRoot = hierarchyRootsById.get(id);
      if (hRoot) { out.push(hRoot); continue; }
      // Phase group canonical root — legacy phaseGroupStore path
      if (activePhaseGroup?.canonicalRoot.id === id) {
        out.push(activePhaseGroup.canonicalRoot); continue;
      }
      // Legacy fallback — phase templates written to ontology.
      const phaseTpl = phaseTemplatesByRootId.get(id);
      if (phaseTpl?.root) out.push(phaseTpl.root);
    }
    return out;
  }, [mapRootIds, opRoot, editedRoot, hierarchyRootsById, activePhaseGroup, phaseTemplatesByRootId]);

  // ── Map available items — ALL hierarchies, sorted stably ────────────────
  // The AddToMapSection inside HierarchyMap handles the compact/all toggle
  // itself, so we pass every item and let the component decide what to show.
  const mapAvailableItems = useMemo((): MapAvailableItem[] => {
    const kindRank = (k: string) => k === "force" ? 0 : k === "operation" ? 1 : 2;
    const sorted = [...hierarchies].sort((a, b) => {
      const kr = kindRank(a.kind) - kindRank(b.kind);
      if (kr !== 0) return kr;
      return a.name.localeCompare(b.name);
    });

    const seen = new Set<string>();
    return sorted
      .filter((h) => {
        if (seen.has(h.canonicalRoot.id)) return false;
        seen.add(h.canonicalRoot.id);
        return true;
      })
      .map((h) => {
        const firstSlot = [...h.phases].sort((a, b) => a.phaseIndex - b.phaseIndex)[0];
        return {
          id: h.canonicalRoot.id,
          name: h.name,
          sidc: h.canonicalRoot.sidc,
          affiliation: h.canonicalRoot.affiliation,
          echelon: h.canonicalRoot.echelon,
          nodeCount: countNodes(h.canonicalRoot),
          kind: "force" as const,
          root: h.canonicalRoot,
          ...(firstSlot && Object.keys(firstSlot.positionsById).length > 0
            ? {
                phaseOrigin: {
                  templateId: firstSlot.id,
                  operationKey: h.operationKey,
                  phaseIndex: firstSlot.phaseIndex,
                  phaseName: firstSlot.phaseName,
                  positionsById: firstSlot.positionsById,
                  relationshipsByEdgeId: firstSlot.relationshipsByEdgeId,
                },
              }
            : {}),
        };
      });
  }, [hierarchies]);

  // ── Phase group view model (kept for future sidebar use) ─────────────────
  void useMemo<PhaseGroupView[]>(() =>
    phaseGroups.map((g) => ({
      id: g.id,
      operationKey: g.operationKey,
      slots: g.phases.map((p) => ({
        id: p.id,
        phaseName: p.phaseName,
        phaseIndex: p.phaseIndex,
        templateId: p.sourceRef ?? null,
      })),
    })),
  [phaseGroups]);

  // ── Phase group mutations (fired from HierarchyMap sidebar) ───────────────

  /**
   * Create a new phase group from a user-selected set of phase-origin
   * template ids, in the order the user picked them.
   * Each template becomes one PhaseSlot; the first template's CompositionNode
   * tree becomes the canonical root.
   */
  const handleCreatePhaseGroup = useCallback((opKey: string, templateIds: string[]) => {
    if (templateIds.length === 0) return;

    // Resolve templates in order.
    const tpls = templateIds
      .map((id) => {
        // id may be a root.id OR a templateId — try both.
        for (const tpl of phaseTemplatesByRootId.values()) {
          if (tpl.id === id || tpl.root.id === id) return tpl;
        }
        return null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    if (tpls.length === 0) return;

    // First template → canonical root + first slot.
    const first = tpls[0];
    const firstSlot: Omit<PhaseSlot, "id" | "phaseIndex"> = {
      phaseName: first.phaseExtras?.phaseName ?? `Phase 1`,
      positionsById: first.phaseExtras?.positionsById ?? {},
      relationshipsByEdgeId: first.phaseExtras?.relationshipsByEdgeId ?? {},
      sourceRef: first.id,
    };
    let group = createPhaseGroup(opKey, first.root, firstSlot);

    // Remaining templates → additional slots.
    for (let i = 1; i < tpls.length; i++) {
      const tpl = tpls[i];
      const slot: Omit<PhaseSlot, "id" | "phaseIndex"> = {
        phaseName: tpl.phaseExtras?.phaseName ?? `Phase ${i + 1}`,
        positionsById: tpl.phaseExtras?.positionsById ?? {},
        relationshipsByEdgeId: tpl.phaseExtras?.relationshipsByEdgeId ?? {},
        sourceRef: tpl.id,
      };
      group = addPhaseToGroup(group, slot, i);
    }

    setPhaseGroups((prev) => [...prev, group]);

    // Add to map without removing existing ORBATs, merge positions
    const seed = positionsObjectToMap(first.phaseExtras?.positionsById ?? {});
    setMapRootIds((prev) => prev.includes(group.canonicalRoot.id) ? prev : [group.canonicalRoot.id, ...prev]);
    if (seed.size > 0) {
      setMapPositions((prev) => {
        const next = new Map(prev);
        seed.forEach((v, k) => next.set(k, v));
        return next;
      });
    }
    setSelectedPhaseSlotId(group.phases[0].id);
    setTopTab("map");
  }, [phaseTemplatesByRootId]);

  /**
   * Reassign a phase slot to a different template — swaps its positionsById
   * and sourceRef in-place.  The canonical root is NOT changed.
   */
  const handleAssignTemplateToSlot = useCallback((groupId: string, slotId: string, templateId: string) => {
    const tpl = [...phaseTemplatesByRootId.values()].find((t) => t.id === templateId);
    if (!tpl?.phaseExtras) return;

    setPhaseGroups((prev) => prev.map((g) => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        phases: g.phases.map((p) =>
          p.id !== slotId ? p : {
            ...p,
            positionsById: tpl.phaseExtras!.positionsById,
            relationshipsByEdgeId: tpl.phaseExtras!.relationshipsByEdgeId ?? {},
            sourceRef: tpl.id,
          },
        ),
      };
    }));

    // If this slot is currently selected, merge the updated positions in.
    if (slotId === selectedPhaseSlotId) {
      const newPositions = positionsObjectToMap(tpl.phaseExtras.positionsById);
      setMapPositions((prev) => {
        const next = new Map(prev);
        newPositions.forEach((v, k) => next.set(k, v));
        return next;
      });
    }
  }, [phaseTemplatesByRootId, selectedPhaseSlotId]);

  const handleRenamePhaseSlot = useCallback((groupId: string, slotId: string, newName: string) => {
    setPhaseGroups((prev) => prev.map((g) =>
      g.id !== groupId ? g : renamePhase(g, slotId, newName),
    ));
  }, []);

  const handleRemovePhaseGroup = useCallback((groupId: string) => {
    const group = phaseGroups.find((g) => g.id === groupId);
    if (group) {
      setMapRootIds((prev) => prev.filter((id) => id !== group.canonicalRoot.id));
      setMapPositions((prev) => { const n = new Map(prev); n.delete(group.canonicalRoot.id); return n; });
    }
    setPhaseGroups((prev) => prev.filter((g) => g.id !== groupId));
  }, [phaseGroups]);

  const handleAddToMap = useCallback((item: MapAvailableItem) => {
    // Seed saved coordinates when available so every unit lands in its
    // intended location instead of stacking on top of the root.
    //   1. Phase-template origin (legacy, from ontology-imported templates)
    //   2. Phase-hierarchy first slot (piped through phaseOrigin above)
    const phaseTpl = phaseTemplatesByRootId.get(item.id);
    const seedRecord =
      phaseTpl?.phaseExtras?.positionsById
      ?? item.phaseOrigin?.positionsById
      ?? null;

    // If the payload includes a position for the ROOT itself we can auto-
    // mount the force at that location — no "click map to place" step needed.
    // (`HierarchyMap` will still show it in "unplaced" state if the root has
    // no entry, so users retain the click-to-place UX for forces without
    // coordinate metadata.)
    const rootPosition = seedRecord?.[item.id]?.offsetFromParent;
    const hasRootPosition = !!rootPosition
      && typeof rootPosition.lat === "number"
      && typeof rootPosition.lng === "number";

    setMapRootIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));

    if (seedRecord && Object.keys(seedRecord).length > 0) {
      const seed = positionsObjectToMap(seedRecord);
      if (seed.size > 0) {
        setMapPositions((prev) => {
          const next = new Map(prev);
          seed.forEach((v, k) => next.set(k, v));
          return next;
        });
      }
    }

    // No root position on the payload → leave placingRootId untouched so the
    // click-to-place workflow kicks in (HierarchyMap already renders an
    // "unplaced / Place" state driven by whether the root has a position).
    // With a root position we do nothing extra; the seeding above already
    // put the force on the map.
    void hasRootPosition;
  }, [phaseTemplatesByRootId]);
  const handleRemoveFromMap = useCallback((id: string) => {
    setMapRootIds((prev) => prev.filter((r) => r !== id));
    setMapPositions((prev) => { const n = new Map(prev); n.delete(id); return n; });
  }, []);

  // ── Auto-hydrate a freshly-ingested phase template onto the map ────────────
  // This runs after the reloadTemplates() call in the phase-ingest effect has
  // completed and the new template appears in `phaseTemplatesByRootId`, OR
  // if the user has just imported one via paste-in.  We add its root to the
  // map, seed its positions, and switch to the Map tab so the user sees it.
  useEffect(() => {
    if (!pendingPhaseHydration) return;
    const { rootId, positions } = pendingPhaseHydration;
    setMapRootIds((prev) => (prev.includes(rootId) ? prev : [...prev, rootId]));
    setMapPositions((prev) => {
      const next = new Map(prev);
      positions.forEach((v, k) => next.set(k, v));
      return next;
    });
    setTopTab("map");
    setPendingPhaseHydration(null);
  }, [pendingPhaseHydration]);

  const [cseReady, setCseReady] = useState(false);
  useEffect(() => {
    (async () => {
      console.log("[CSE setup] Initialising composition + project…");
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client(cseAddComposition as any) as any).executeFunction({
          compositionName: CSE_COMPOSITION_NAME,
          compositionType: CSE_COMPOSITION_TYPE,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client(cseAddProject as any) as any).executeFunction({
          composition: CSE_COMPOSITION_NAME,
          projectName: CSE_PROJECT,
        });
        console.log("[CSE setup] Ready.");
      } catch (e) { console.warn("[CSE setup] Init failed (non-fatal):", e); }
      setCseReady(true);
    })();
  }, []);

  type CseStatus = "idle" | "running" | "done" | "error";
  interface CseError { type?: string; message?: string; description?: string; isWarning?: boolean; path?: string; }
  const [cseErrors, setCseErrors] = useState<CseError[]>([]);
  const [cseStatus, setCseStatus] = useState<CseStatus>("idle");

  // Track the last orbatExport JSON we validated against so we only call
  // cseValidateOrbat when placement actually changes — not on every re-render
  // or Workshop variable round-trip.
  const lastValidatedExportRef = useRef<string>("");

  // Run cseValidateOrbat when the translated ORBAT comes back from Workshop.
  // Flow: user places units → orbatJson written to Workshop variable →
  //       Workshop translation function runs → translatedInputOrbat updated →
  //       this effect fires and calls CSE.
  // Guard: compare against last validated string so Workshop polling doesn't
  //        cause repeated calls with the same payload.
  useEffect(() => {
    if (!translatedInputOrbat) {
      console.log("[CSE validate] translatedInputOrbat is empty — clearing state.");
      setCseErrors([]);
      setCseStatus("idle");
      lastValidatedExportRef.current = "";
      return;
    }

    if (!cseReady) {
      console.log("[CSE validate] CSE not ready yet — waiting.");
      return;
    }

    if (translatedInputOrbat === lastValidatedExportRef.current) {
      console.log("[CSE validate] translatedInputOrbat unchanged — skipping call.");
      return;
    }

    console.log(
      `[CSE validate] translatedInputOrbat updated (${translatedInputOrbat.length} chars). Queuing validation…`,
    );
    lastValidatedExportRef.current = translatedInputOrbat;
    setCseStatus("running");
    setCseErrors([]);

    const timer = setTimeout(async () => {
      console.log("[CSE validate] → cseValidateOrbat", {
        projectName: CSE_PROJECT,
        payloadLength: translatedInputOrbat.length,
        preview: translatedInputOrbat.slice(0, 120),
      });
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = await (client(cseValidateOrbat as any) as any).executeFunction({
          projectName: CSE_PROJECT,
          orbatContent: translatedInputOrbat,
        });
        const result = typeof raw === "string" ? JSON.parse(raw) : raw;
        const errors: CseError[] = result?.errors ?? [];
        console.log(`[CSE validate] ✓ Done — ${errors.length} issue(s):`, errors);
        setCseErrors(errors);
        setCseStatus("done");
      } catch (e) {
        console.error("[CSE validate] ✗ Call failed:", e);
        setCseStatus("error");
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [translatedInputOrbat, cseReady]);

  const workshopCtxRef = useRef(workshopCtx);
  useEffect(() => { workshopCtxRef.current = workshopCtx; }, [workshopCtx]);
  useEffect(() => {
    if (!orbatExport) return;
    const id = requestIdleCallback(() => { workshopCtxRef.current?.orbatJson?.setLoadedValue?.(JSON.stringify(orbatExport)); }, { timeout: 2000 });
    return () => cancelIdleCallback(id);
  }, [orbatExport]);

  const blockingCse = cseErrors.filter((e) => !e.isWarning).length;
  const warningCse  = cseErrors.filter((e) => e.isWarning).length;

  return (
    <div className="om-widget">

      {/* ── Define-ORBAT banner (from the Scenario Planner) ──────────────── */}
      {defineRequest && (
        <div
          role="region"
          aria-label="Define ORBAT"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 16px",
            background: "rgba(74,144,217,0.12)",
            borderBottom: "1px solid rgba(74,144,217,0.4)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "#e0e4ec" }}>
            Defining ORBAT for{" "}
            <strong>{defineRequest.unitLabel}</strong>{" "}
            <span style={{ color: "#8b95a8" }}>
              ({defineRequest.side === "red" ? "Red" : "Blue"} force · {defineRequest.scenarioName})
            </span>
            . Build or generate the structure, then save it — nothing is written
            until you do.
          </span>
          {defineError && (
            <span style={{ fontSize: 11, color: "#E74C3C" }} role="alert">
              ⚠ {defineError}
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleCancelDefine}
              disabled={defineBusy}
              style={{
                padding: "5px 12px", borderRadius: 4, cursor: "pointer",
                background: "transparent", color: "#8b95a8",
                border: "1px solid rgba(255,255,255,0.18)", fontSize: 11,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmDefine}
              disabled={defineBusy}
              style={{
                padding: "5px 14px", borderRadius: 4,
                cursor: defineBusy ? "wait" : "pointer",
                background: "#4A90D9", color: "#fff", border: "none",
                fontSize: 11, fontWeight: 700,
              }}
            >
              {defineBusy ? "Saving…" : "✓ Save ORBAT to scenario"}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="om-header">
        <span className="om-header__title">⬡ ORBAT Manager</span>
        <span className="om-header__badge">
          {opLoading ? "⟳ Loading…" : opError ? `⚠ ${opError}` : operationKey}
        </span>
        <div className="om-tabs">
          {([
            { id: "hierarchy" as TopTab, label: "Hierarchy" },
            { id: "templates" as TopTab, label: `Templates (${templates.length})` },
            { id: "map"       as TopTab, label: "Map Placement" },
          ]).map((tab) => (
            <button key={tab.id} onClick={() => setTopTab(tab.id)}
              className={`om-tab${topTab === tab.id ? " om-tab--active" : ""}`}>
              {tab.label}
            </button>
          ))}
        </div>
        {/* Import Phase ORBAT button — lives in the tab bar, only visible on the Hierarchy tab */}
        {topTab === "hierarchy" && (
          <button
            onClick={() => setShowPhaseImportPanel((v) => !v)}
            className="mil-btn mil-btn--sm"
            style={{
              marginLeft: 8,
              background: showPhaseImportPanel ? "rgba(121,134,203,0.25)" : "rgba(121,134,203,0.12)",
              border: "1px solid rgba(121,134,203,0.4)",
              color: "#9fa8da",
              fontSize: 11,
            }}
            title="Import a phase ORBAT JSON or generate one via AI — creates a new Hierarchy"
          >
            ⇪ Import Phase ORBAT
          </button>
        )}
        <div className="om-header__spacer" />
        <div className="om-header__actions">
          {orbatExport && orbatExport.units.length > 0 && (
            <span className="om-status-chip om-status-chip--ok">✓ {orbatExport.units.length} units placed</span>
          )}
          {/* Phase ingest status — surfaces to the user without needing devtools */}
          {phaseIngestBusy && (
            <span className="om-status-chip om-status-chip--info" title="Ingesting phase ORBAT payload">
              ⟳ Ingesting phase ORBAT…
            </span>
          )}
          {phaseIngestError && (
            <span
              className="om-status-chip om-status-chip--err"
              title={phaseIngestError}
              onClick={() => setPhaseIngestError(null)}
              style={{ cursor: "pointer" }}
            >
              ⚠ Phase ORBAT: {phaseIngestError.length > 40 ? phaseIngestError.slice(0, 40) + "…" : phaseIngestError}
            </span>
          )}
          {!cseReady && <span className="om-status-chip om-status-chip--info">⟳ CSE init…</span>}
          {cseReady && cseStatus === "running" && <span className="om-status-chip om-status-chip--info">⟳ CSE validating…</span>}
          {cseReady && cseStatus === "done" && (
            <span className={`om-status-chip ${blockingCse === 0 ? "om-status-chip--ok" : "om-status-chip--err"}`}>
              {blockingCse === 0 ? `✓ CSE valid${warningCse > 0 ? ` (${warningCse} warn)` : ""}` : `✗ ${blockingCse} error${blockingCse !== 1 ? "s" : ""}`}
            </span>
          )}
          <AppSwitcher />
        </div>
      </div>

      {/* Body */}
      <div className="om-body">

        {/* Hierarchy tab */}
        {topTab === "hierarchy" && (
          <>
            {/* ── Phase import panel (shown above the hierarchy split when open) ── */}
            {showPhaseImportPanel && (
              <PhaseImportPanel
                onImport={runPhaseIngest}
                onGenerate={runPhaseGenerate}
                onClose={() => setShowPhaseImportPanel(false)}
              />
            )}

            <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

            {/* ── Left panel: hierarchy selector ── */}
            <HierarchySelector
              entries={hierarchyEntries}
              selectedHierarchyId={selectedHierarchyId}
              selectedPhaseSlotId={selectedPhaseSlotId}
              onSelectHierarchy={(id) => {
                setSelectedHierarchyId(id);
                setHierarchySelectedId(null);
              }}
              onSelectPhaseSlot={switchToPhaseSlot}
              templates={templates}
              onStampTemplate={(tplRoot) => {
                if (!activeHierarchy) return;
                // Add the template root as a new child of the hierarchy root
                const stamped: CompositionNode = {
                  ...activeHierarchy.canonicalRoot,
                  children: [...activeHierarchy.canonicalRoot.children, tplRoot],
                };
                handleRootChange(stamped);
              }}
              onCreateNew={() => setShowNewHierarchyDialog(true)}
              onDeleteOntologyPhase={async (hierarchyId, ontologyIds) => {
                for (const id of ontologyIds) {
                  try { await deleteHierarchyTemplateFn(id); }
                  catch (e) { console.error(`[delete phase ORBAT] ontology record ${id}:`, e); }
                }
                void reloadTemplates();
                void reloadPhaseMapStates();
                setHierarchies((prev) => prev.filter((h) => h.id !== hierarchyId));
                if (selectedHierarchyId === hierarchyId) setSelectedHierarchyId(null);
              }}
              onDeleteHierarchy={(hierarchyId) => {
                setHierarchies((prev) => prev.filter((h) => h.id !== hierarchyId));
                if (selectedHierarchyId === hierarchyId) setSelectedHierarchyId(null);
              }}
            />

            {/* ── Canvas ── */}
            <div className="om-canvas">
              {opLoading && activeHierarchy?.kind === "operation" && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--om-text-muted)", fontSize: 13 }}>Loading operation hierarchy…</div>
              )}
              {opError && activeHierarchy?.kind === "operation" && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#ef9a9a", fontSize: 13 }}>⚠ {opError}</div>
              )}
              {/* ── Ontology source info + parse-error banner (phase hierarchies) ── */}
              {(() => {
                if (!activeHierarchy || activeHierarchy.kind !== "phase") return null;
                // Find the currently-selected slot, fall back to first slot
                const slot = activeHierarchy.phases.find((p) => p.id === selectedPhaseSlotId)
                  ?? activeHierarchy.phases[0]
                  ?? null;
                if (!slot) return null;

                const isOntology = !!slot.ontologyMapStateId;
                const error = slot.parseError;

                if (!isOntology && !error) return null; // manual + clean = no banner

                return (
                  <div style={{
                    flexShrink: 0,
                    padding: "6px 12px",
                    display: "flex", alignItems: "flex-start", gap: 8,
                    background: error ? "rgba(239,154,154,0.07)" : "rgba(245,73,139,0.07)",
                    borderBottom: `1px solid ${error ? "rgba(239,154,154,0.25)" : "rgba(245,73,139,0.2)"}`,
                    fontSize: 11,
                  }}>
                    <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                      {error ? "⚠" : "⌖"}
                    </span>
                    <div>
                      {isOntology && !error && (
                        <>
                          <span style={{ fontWeight: 700, color: "#F5498B", letterSpacing: "0.04em" }}>
                            From [NXG-O] Template Orbat Graph
                          </span>
                          <span style={{ color: "var(--om-text-muted)", marginLeft: 6 }}>
                            id: <code style={{ fontSize: 10, background: "rgba(255,255,255,0.05)", borderRadius: 2, padding: "0 4px" }}>{slot.ontologyMapStateId}</code>
                          </span>
                        </>
                      )}
                      {isOntology && error && (
                        <>
                          <span style={{ fontWeight: 700, color: "#ef9a9a", letterSpacing: "0.04em" }}>
                            Invalid ORBAT — parse failed
                          </span>
                          <div style={{ color: "#ef9a9a", marginTop: 2, lineHeight: 1.4 }}>
                            {error}
                          </div>
                          <div style={{ color: "var(--om-text-muted)", marginTop: 3, fontSize: 10 }}>
                            Source: [NXG-O] Template Orbat Graph <code style={{ fontSize: 9, background: "rgba(255,255,255,0.05)", borderRadius: 2, padding: "0 3px" }}>{slot.ontologyMapStateId}</code>.
                            The ORBAT JSON stored in <em>templateJson</em> does not conform to the{" "}
                            <code style={{ fontSize: 9 }}>{"{ description, units[] }"}</code> shape
                            expected by the PhaseToORBAT pipeline. Check the Scenario Planner or the
                            llmPhaseToOrbat function output for this phase.
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
              {!activeRoot && !opLoading && (
                <div className="om-empty">
                  <div className="om-empty__icon">⬡</div>
                  <div className="om-empty__title">Select a hierarchy</div>
                  <div className="om-empty__hint">Choose from the left panel, or load an operation key from Workshop</div>
                </div>
              )}
              {activeRoot && (
                <>
                  <div className="om-canvas__topbar">
                    {/* View toggle */}
                    <div style={{ display: "flex", gap: 2, background: "var(--bg-base)", border: "1px solid var(--om-border-subtle)", borderRadius: 3, padding: 2, flexShrink: 0 }}>
                      <button
                        onClick={() => setHierarchyView("graph")}
                        title="Graph view"
                        style={{ padding: "3px 8px", background: hierarchyView === "graph" ? "var(--om-accent)" : "transparent", border: "none", borderRadius: 2, color: hierarchyView === "graph" ? "#fff" : "var(--om-text-muted)", fontSize: 11, cursor: "pointer", fontWeight: 600, lineHeight: 1 }}
                      >
                        ⬡ Graph
                      </button>
                      <button
                        onClick={() => setHierarchyView("tree")}
                        title="Tree view"
                        style={{ padding: "3px 8px", background: hierarchyView === "tree" ? "var(--om-accent)" : "transparent", border: "none", borderRadius: 2, color: hierarchyView === "tree" ? "#fff" : "var(--om-text-muted)", fontSize: 11, cursor: "pointer", fontWeight: 600, lineHeight: 1 }}
                      >
                        ≡ Tree
                      </button>
                    </div>
                    <MilThumb sidc={activeRoot.sidc} size={22} />
                    <span className="om-canvas__title">{activeRoot.unitIdentifier}</span>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 2, background: `${AFF_COLOR[activeRoot.affiliation] ?? "var(--border-default)"}22`, color: AFF_COLOR[activeRoot.affiliation] ?? "var(--om-text-sec)", border: `1px solid ${AFF_COLOR[activeRoot.affiliation] ?? "var(--border-default)"}55` }}>
                      {activeRoot.affiliation}
                    </span>
                    {/* Kind badge */}
                    {activeHierarchy && (
                      <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2,
                        background: activeHierarchy.kind === "operation" ? "rgba(74,124,89,0.15)" : activeHierarchy.kind === "force" ? "rgba(201,146,42,0.15)" : "rgba(121,134,203,0.15)",
                        color: activeHierarchy.kind === "operation" ? "var(--accent-primary)" : activeHierarchy.kind === "force" ? "var(--accent-amber)" : "#7986cb",
                        fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" as const,
                      }}>
                        {activeHierarchy.kind}
                      </span>
                    )}
                    {/* Source badge for phase hierarchies — shown in the canvas topbar */}
                    {activeHierarchy?.kind === "phase" && (() => {
                      const slot = activeHierarchy.phases.find((p) => p.id === selectedPhaseSlotId)
                        ?? activeHierarchy.phases[0];
                      if (!slot) return null;
                      if (slot.ontologyMapStateId && !slot.parseError) {
                        return (
                          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "rgba(245,73,139,0.15)", color: "#F5498B", fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                            ⌖ Ontology
                          </span>
                        );
                      }
                      if (slot.ontologyMapStateId && slot.parseError) {
                        return (
                          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "rgba(239,154,154,0.15)", color: "#ef9a9a", fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                            ⚠ Invalid ORBAT
                          </span>
                        );
                      }
                      return (
                        <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "rgba(90,97,120,0.15)", color: "#8a92a8", fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                          ✎ Manual
                        </span>
                      );
                    })()}
                    <span className="om-canvas__spacer" />
                    <span style={{ fontSize: 10, color: "var(--om-text-muted)" }}>{countNodes(activeRoot)} nodes</span>
                    {editedRoot && (
                      <button onClick={handleResetRoot}
                        className="mil-btn mil-btn--danger mil-btn--sm">
                        Reset edits
                      </button>
                    )}
                  </div>
                  {hierarchyView === "graph" ? (
                    <CompositionBuilder
                      key={selectedHierarchyId ?? operationKey}
                      root={activeRoot}
                      onRootChange={handleRootChange}
                      hierarchyTemplates={templates}
                      onSaveHierarchyTemplate={async () => {}}
                      onDeleteHierarchyTemplate={async () => {}}
                      unitTemplates={orbatState.templates}
                      groupTemplates={orbatState.groupTemplates}
                      selectedId={hierarchySelectedId ?? activeRoot.id}
                      onSelectedIdChange={setHierarchySelectedId}
                      onFocusNodeReady={(fn) => {
                        graphFocusNodeRef.current = fn;
                          const id = pendingFocusIdRef.current;
                        if (id) {
                          pendingFocusIdRef.current = null;
                          // Try multiple times — React Flow needs a few frames after
                          // mount before fitView on a specific node works reliably.
                          let attempts = 0;
                          const tryFocus = () => {
                            attempts++;
                            fn(id);
                            if (attempts < 5) setTimeout(tryFocus, 300);
                          };
                          setTimeout(tryFocus, 300);
                        }
                      }}
                    />
                  ) : (
                    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                      <OrbatTreeView
                        root={activeRoot}
                        selectedId={treeSelectedId}
                        onSelect={(id) => { setTreeSelectedId(id); }}
                      />
                      {treeSelectedNode && (
                        <NodeEditorSidebar
                          root={activeRoot}
                          selectedNode={treeSelectedNode}
                          parentNode={treeParentNode}
                          addChildParentId={treeAddChildParentId}
                          setAddChildParentId={(id) => setTreeAddChildParentId(id)}
                          onUpdate={handleTreeUpdate}
                          onRemove={handleTreeRemove}
                          onAddChild={(parentId: string) => setTreeAddChildParentId(parentId)}
                          onAddChildConfirm={handleTreeAddChildConfirm}
                          onClose={() => setTreeSelectedId(null)}
                          onSelectNode={(id: string) => setTreeSelectedId(id)}
                          refData={refData}
                          hierarchyTemplates={templates}
                          onFocusNode={(id: string) => {
                            setHierarchyView("graph");
                            const fn = graphFocusNodeRef.current;
                            if (fn) {
                              let attempts = 0;
                              const tryFocus = () => { attempts++; fn(id); if (attempts < 5) setTimeout(tryFocus, 300); };
                              setTimeout(tryFocus, 300);
                            } else {
                              pendingFocusIdRef.current = id;
                            }
                          }}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          </>
        )}

        {/* Templates tab */}
        {topTab === "templates" && (() => {
          const selectedTpl = selectedTplId ? templates.find((t) => t.id === selectedTplId) ?? null : null;

          const handleSave = async (input: Record<string, unknown>) => {
            const root = input.root as CompositionNode;
            const name = (input.name as string) ?? "";
            const description = (input.description as string) ?? "";
            const echelon = root?.echelon ?? "";
            const tagsArr: string[] = Array.isArray(input.tags) ? (input.tags as string[]) : [];
            const tags = tagsArr.join(",");
            const templateJson = JSON.stringify({ name, description, tags: tagsArr, echelon, createdAt: new Date().toISOString(), root });
            await createHierarchyTemplateFn({ name, echelon, description, tags, templateJson });
            await reloadTemplates();
          };

          const handleDelete = async (id: string) => {
            await deleteHierarchyTemplateFn(id);
            setSelectedTplId(null);
            await reloadTemplates();
          };

          const handleDetailSave = async (id: string, root: CompositionNode, meta: { name: string; description: string }): Promise<void> => {
            const tpl = templates.find((t) => t.id === id);
            const echelon = root?.echelon ?? tpl?.root.echelon ?? "";
            const tags = (tpl?.tags ?? []).join(",");
            const createdAt = tpl?.createdAt ?? new Date().toISOString();
            const templateJson = JSON.stringify({ name: meta.name, description: meta.description, tags: tpl?.tags ?? [], echelon, createdAt, root });
            await editHierarchyTemplateFn({ primaryKey: id, name: meta.name, echelon, description: meta.description, tags, templateJson, createdAt });
            void reloadTemplates();
          };

          const handleSaveAsCopy = (root: CompositionNode, name: string, description: string) => {
            const echelon = root?.echelon ?? "";
            const createdAt = new Date().toISOString();
            const templateJson = JSON.stringify({ name, description, tags: [], echelon, createdAt, root });
            void createHierarchyTemplateFn({ name, echelon, description, tags: "", templateJson }).then(() => { reloadTemplates(); setSelectedTplId(null); });
          };

          if (selectedTpl) {
            return (
              <TemplateDetailView
                template={selectedTpl}
                allTemplates={templates}
                onBack={() => setSelectedTplId(null)}
                onDelete={handleDelete}
                onSave={handleDetailSave}
                onSaveAsCopy={handleSaveAsCopy}
              />
            );
          }
          return (
            <TemplatesTab
              templates={templates}
              onSelect={setSelectedTplId}
              onSave={handleSave}
              onReloadTemplates={reloadTemplates}
              onImportPhaseOrbat={runPhaseIngest}
              onGeneratePhaseOrbat={runPhaseGenerate}
            />
          );
        })()}

        {/* Map tab */}
        {topTab === "map" && (
          <HierarchyMap
            roots={allMapRoots}
            positions={mapPositions}
            onPositionsChange={setMapPositions}
            onExport={handleExport}
            availableItems={mapAvailableItems}
            onAddToMap={handleAddToMap}
            onRemoveFromMap={handleRemoveFromMap}
            cseErrors={cseErrors}
            cseStatus={cseStatus}
            onCreatePhaseGroup={handleCreatePhaseGroup}
            onAssignTemplateToSlot={handleAssignTemplateToSlot}
            onRenamePhaseSlot={handleRenamePhaseSlot}
            onRemovePhaseGroup={handleRemovePhaseGroup}
          />
        )}
      </div>
    </div>
  );
}

