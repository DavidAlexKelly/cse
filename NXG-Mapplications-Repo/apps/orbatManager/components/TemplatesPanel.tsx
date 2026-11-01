/**
 * TemplatesPanel.tsx — Unit Templates + Group Templates browser.
 *
 * Unit Templates: reusable single-unit configurations with milsymbol preview.
 * Group Templates: full hierarchy structures, expandable tree preview.
 *
 * Milsymbol rendering uses the same btoa(asSVG()) pattern as HierarchyMap/ScenarioMap.
 * No NatoSymbol component — uses the existing milsymbol library directly.
 */

import React, { useState, useMemo } from "react";
import ms from "milsymbol";
import type { UnitTemplate, GroupTemplate, UnitIconType, EchelonLevel, GroupTemplateNode } from "../../../types";
import { ECHELON_ORDER, ECHELON_LABELS, ECHELON_SHORT } from "../../../types";
import { MilButton } from "./shared/MilButton";
import { MilLabel } from "./shared/MilModal";
import {
  MilModal, MilFormGroup, MilFormRow,
  MilTextInput, MilTextArea, MilSelect,
} from "./shared/MilModal";
import { C } from "./shared/milStyles";

// ── SIDC builder for milsymbol preview ────────────────────────────────────

const AFF_CODES: Record<string, string> = { "Friend": "F", "Hostile": "H", "Neutral": "N", "Unknown": "U" };

const ECH_CODES: Record<EchelonLevel, string> = {
  team: "B-", squad: "C-", section: "D-", platoon: "D-", company: "E-",
  battalion: "F-", regiment: "G-", brigade: "H-", division: "I-",
  corps: "J-", army: "K-", armyGroup: "K-", theatre: "L-",
};

const ICON_FUNC: Record<UnitIconType, string> = {
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

function buildSidcForTemplate(icon: UnitIconType, echelon: EchelonLevel, affiliation = "Friend"): string {
  const aff = AFF_CODES[affiliation] ?? "F";
  const func = ICON_FUNC[icon] ?? "UCI--";
  const ech  = ECH_CODES[echelon] ?? "--";
  return `S${aff}GPP${func}${ech}---`;
}

function MilSymbolImg({ icon, echelon, size = 36 }: { icon: UnitIconType; echelon: EchelonLevel; size?: number }) {
  const src = useMemo(() => {
    try {
      const sidc = buildSidcForTemplate(icon, echelon);
      const svg = new ms.Symbol(sidc, { size, square: true, strokeWidth: 1.5 }).asSVG();
      if (svg && svg.length > 50) return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch { /* fall through */ }
    return "";
  }, [icon, echelon, size]);

  if (!src) return <div style={{ width: size, height: size, borderRadius: 3, background: C.surface, flexShrink: 0 }} />;
  return <img src={src} width={size} height={size} alt={icon} style={{ display: "block", flexShrink: 0 }} />;
}

// ── Echelon marks & colours ───────────────────────────────────────────────

const ECHELON_MARK: Record<string, string> = {
  team: "Ø", squad: "•", section: "••", platoon: "•••",
  company: "|", battalion: "||", regiment: "|||",
  brigade: "X", division: "XX", corps: "XXX",
  army: "XXXX", armyGroup: "XXXXX", theatre: "XXXXXX",
};

const ECHELON_MARK_COLOR: Record<string, string> = {
  team: "#22a8c0", squad: "#22a8c0", section: "#22a8c0", platoon: "#22a8c0",
  company: "#50c988", battalion: "#50c988", regiment: "#50c988",
  brigade: "#f0a83c", division: "#f0a83c", corps: "#f0a83c",
  army: "#ef5350", armyGroup: "#ef5350", theatre: "#ef5350",
};

const echelonIntent = (e: string): "blue" | "green" | "amber" | "red" => {
  if (["team","squad","section","platoon"].includes(e)) return "blue";
  if (["company","battalion","regiment"].includes(e)) return "green";
  if (["brigade","division","corps"].includes(e)) return "amber";
  return "red";
};

// ── Icon options ──────────────────────────────────────────────────────────

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

// ── Form state ────────────────────────────────────────────────────────────

interface TemplateForm {
  name: string;
  echelon: EchelonLevel;
  defaultPersonnelCount: number;
  description: string;
  tags: string;
  icon: UnitIconType;
}

function blankForm(t?: UnitTemplate): TemplateForm {
  return {
    name:                 t?.name                ?? "",
    echelon:              t?.echelon             ?? "section",
    defaultPersonnelCount: t?.defaultPersonnelCount ?? 10,
    description:          t?.description         ?? "",
    tags:                 t?.tags.join(", ")     ?? "",
    icon:                 (t?.symbol.icon as UnitIconType) ?? "infantry",
  };
}

// ── Group template tree preview ───────────────────────────────────────────

const GtNode: React.FC<{ node: GroupTemplateNode; depth: number }> = ({ node, depth }) => (
  <div>
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      paddingLeft: depth * 14, paddingTop: 2, paddingBottom: 2,
      borderLeft: depth > 0 ? `1px solid ${C.border}` : "none",
      marginLeft: depth > 0 ? 6 : 0,
    }}>
      <span style={{ fontSize: 10, fontFamily: "monospace", color: ECHELON_MARK_COLOR[node.echelon] ?? C.text2, minWidth: 16 }}>
        {ECHELON_MARK[node.echelon] ?? "·"}
      </span>
      <span style={{ fontSize: 11, color: C.text, flex: 1 }}>{node.name}</span>
      <span style={{ fontSize: 9, color: C.muted }}>{node.personnelCount} pax</span>
    </div>
    {node.children.map((c, i) => <GtNode key={i} node={c} depth={depth + 1} />)}
  </div>
);

function countGtPax(nodes: GroupTemplateNode[]): number {
  return nodes.reduce((a, n) => a + n.personnelCount + countGtPax(n.children), 0);
}
function countGtUnits(nodes: GroupTemplateNode[]): number {
  return nodes.reduce((a, n) => a + 1 + countGtUnits(n.children), 0);
}

// ── Panel tabs ────────────────────────────────────────────────────────────

type PanelTab = "unit" | "group";

interface TemplatesPanelProps {
  templates: UnitTemplate[];
  groupTemplates: GroupTemplate[];
  onCreateTemplate: (input: Record<string, unknown>) => Promise<void>;
  onUpdateTemplate: (id: string, input: Record<string, unknown>) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
  onDeleteGroupTemplate: (id: string) => Promise<void>;
}

export const TemplatesPanel: React.FC<TemplatesPanelProps> = ({
  templates, groupTemplates,
  onCreateTemplate, onUpdateTemplate, onDeleteTemplate, onDeleteGroupTemplate,
}) => {
  const [panelTab, setPanelTab]       = useState<PanelTab>("unit");
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [editing, setEditing]         = useState<UnitTemplate | null>(null);
  const [form, setForm]               = useState<TemplateForm>(blankForm());
  const [search, setSearch]           = useState("");
  const [expandedGt, setExpandedGt]   = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete]   = useState<string | null>(null);
  const [confirmDeleteGt, setConfirmDeleteGt] = useState<string | null>(null);

  const openCreate = () => { setEditing(null); setForm(blankForm()); setDialogOpen(true); };
  const openEdit   = (t: UnitTemplate) => { setEditing(t); setForm(blankForm(t)); setDialogOpen(true); };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    const input = {
      name: form.name.trim(), echelon: form.echelon,
      defaultPersonnelCount: form.defaultPersonnelCount,
      description: form.description,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      symbol: { icon: form.icon },
    };
    if (editing) await onUpdateTemplate(editing.id, input);
    else         await onCreateTemplate(input);
    setDialogOpen(false);
  };

  const set = (p: Partial<TemplateForm>) => setForm((f) => ({ ...f, ...p }));

  const toggleGt = (id: string) => setExpandedGt((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const filteredUnit = search
    ? templates.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()) || t.tags.some((g) => g.toLowerCase().includes(search.toLowerCase())))
    : templates;

  const filteredGroup = search
    ? groupTemplates.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()) || g.description.toLowerCase().includes(search.toLowerCase()))
    : groupTemplates;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.bg2 }}>
        {([
          { id: "unit"  as PanelTab, label: "Unit Templates",  count: templates.length,      icon: "◉" },
          { id: "group" as PanelTab, label: "Group Templates", count: groupTemplates.length, icon: "⎇" },
        ]).map((tab) => (
          <button key={tab.id} onClick={() => setPanelTab(tab.id)} style={{
            flex: 1, padding: "10px 8px", background: "none", border: "none", cursor: "pointer",
            fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
            color: panelTab === tab.id ? C.text : C.muted,
            borderBottom: panelTab === tab.id ? `2px solid ${C.olive}` : "2px solid transparent",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <span style={{ fontSize: 12 }}>{tab.icon}</span>
            {tab.label}
            {tab.count > 0 && (
              <span style={{ fontSize: 9, padding: "0 5px", borderRadius: 8, background: panelTab === tab.id ? C.oliveMut : C.surface, color: panelTab === tab.id ? C.oliveLt : C.muted }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
        {panelTab === "unit" && (
          <div style={{ display: "flex", alignItems: "center", paddingRight: 8 }}>
            <MilButton variant="primary" onClick={openCreate}>+ New</MilButton>
          </div>
        )}
      </div>

      {/* Info banner */}
      <div style={{ margin: "6px 8px 0", padding: "7px 10px", background: C.surface, border: `1px solid ${C.borderLt}`, borderLeft: `3px solid ${panelTab === "unit" ? C.olive : C.cyan}`, borderRadius: 2, fontSize: 11, color: C.text2, lineHeight: 1.5, flexShrink: 0 }}>
        {panelTab === "unit"
          ? <><strong style={{ color: C.text }}>Unit templates</strong> define reusable single-unit configurations. Drag them into the builder to instantly add pre-configured units.</>
          : <><strong style={{ color: C.text }}>Group templates</strong> save entire hierarchy structures. Apply them to any group in the builder.</>
        }
      </div>

      {/* Search */}
      <div style={{ padding: "6px 8px", flexShrink: 0 }}>
        <input
          placeholder={panelTab === "unit" ? "Search unit templates…" : "Search group templates…"}
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", padding: "5px 8px", background: C.surface, border: `1px solid ${C.borderLt}`, borderRadius: 3, color: C.text, fontSize: 11, outline: "none", boxSizing: "border-box" }}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 12px" }}>

        {/* ── UNIT TEMPLATES ── */}
        {panelTab === "unit" && (
          filteredUnit.length === 0
            ? <div style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 12 }}>No unit templates found<br /><MilButton variant="primary" style={{ marginTop: 10 }} onClick={openCreate}>Create Template</MilButton></div>
            : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                {filteredUnit.map((t) => {
                  const isConfirming = confirmDelete === t.id;
                  return (
                    <div key={t.id} style={{ background: C.bg3, border: `1px solid ${isConfirming ? "rgba(176,58,46,0.5)" : C.border}`, borderLeft: `3px solid ${isConfirming ? C.red : (ECHELON_MARK_COLOR[t.echelon] ?? C.borderLt)}`, borderRadius: 2, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <MilSymbolImg icon={(t.symbol.icon as UnitIconType) ?? "infantry"} echelon={t.echelon} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                          <div style={{ fontSize: 9, color: C.text2, marginTop: 1 }}>
                            {ECHELON_MARK[t.echelon] ?? ""} {ECHELON_SHORT[t.echelon]} · {t.defaultPersonnelCount} pax
                          </div>
                        </div>
                      </div>
                      {t.description && <div style={{ fontSize: 11, color: C.text2, lineHeight: 1.4 }}>{t.description}</div>}
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <MilLabel intent={echelonIntent(t.echelon)}>{ECHELON_SHORT[t.echelon]}</MilLabel>
                        {t.tags.map((tag) => (
                          <span key={tag} style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "rgba(90,97,120,0.2)", border: "1px solid rgba(90,97,120,0.35)", color: C.text2, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{tag}</span>
                        ))}
                      </div>
                      <div style={{ marginTop: 2, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                        {isConfirming ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ fontSize: 11, color: "#e74c3c", fontWeight: 600 }}>Delete this template?</div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <MilButton variant="danger" fill onClick={() => { void onDeleteTemplate(t.id); setConfirmDelete(null); }}>Yes, delete</MilButton>
                              <MilButton variant="default" fill onClick={() => setConfirmDelete(null)}>Cancel</MilButton>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <MilButton variant="default" fill onClick={() => openEdit(t)}>Edit</MilButton>
                            <MilButton variant="danger" iconOnly onClick={() => setConfirmDelete(t.id)} title="Delete template">✕</MilButton>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
        )}

        {/* ── GROUP TEMPLATES ── */}
        {panelTab === "group" && (
          filteredGroup.length === 0
            ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 12 }}>
                No group templates yet.<br />
                <span style={{ fontSize: 11, lineHeight: 1.5, display: "block", marginTop: 6 }}>
                  Build a hierarchy in the Builder tab, then click <strong style={{ color: C.text }}>Save Template</strong>.
                </span>
              </div>
            )
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filteredGroup.map((gt) => {
                  const isExpanded    = expandedGt.has(gt.id);
                  const isConfirming  = confirmDeleteGt === gt.id;
                  const totalPax      = countGtPax(gt.rootNodes);
                  const totalUnits    = countGtUnits(gt.rootNodes);
                  const maxEchelon    = (gt.rootNodes[0]?.echelon ?? "section") as EchelonLevel;

                  return (
                    <div key={gt.id} style={{ background: C.bg3, border: `1px solid ${isConfirming ? "rgba(176,58,46,0.5)" : C.border}`, borderLeft: `3px solid ${isConfirming ? C.red : C.cyan}`, borderRadius: 2, overflow: "hidden" }}>
                      {/* Header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: C.bg2 }}>
                        <button onClick={() => toggleGt(gt.id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.cyanLt, fontSize: 10, width: 16, flexShrink: 0 }}>
                          {isExpanded ? "▼" : "▶"}
                        </button>
                        <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: ECHELON_MARK_COLOR[maxEchelon] ?? C.cyanLt, minWidth: 20 }}>
                          {ECHELON_MARK[maxEchelon] ?? "·"}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gt.name}</div>
                          {gt.description && <div style={{ fontSize: 10, color: C.text2, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gt.description}</div>}
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 2, background: C.cyanDim, color: C.cyanLt, border: `1px solid rgba(34,168,192,0.3)` }}>{totalPax.toLocaleString()} pax</span>
                          <span style={{ fontSize: 9, color: C.muted }}>{totalUnits} units</span>
                        </div>
                        <MilButton variant="danger" iconOnly onClick={() => setConfirmDeleteGt(gt.id)} title="Delete group template">✕</MilButton>
                      </div>

                      {isConfirming && (
                        <div style={{ padding: "8px 12px", background: "rgba(176,58,46,0.08)", borderTop: `1px solid rgba(176,58,46,0.3)`, display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 11, color: "#e74c3c", flex: 1 }}>Delete &quot;{gt.name}&quot;?</span>
                          <MilButton variant="danger" onClick={() => { void onDeleteGroupTemplate(gt.id); setConfirmDeleteGt(null); }}>Delete</MilButton>
                          <MilButton variant="default" onClick={() => setConfirmDeleteGt(null)}>Cancel</MilButton>
                        </div>
                      )}

                      {gt.tags.length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "4px 10px" }}>
                          <span style={{ fontSize: 9, color: C.muted }}>Branch: {gt.branch}</span>
                          {gt.tags.map((tag) => (
                            <span key={tag} style={{ fontSize: 9, padding: "0 5px", borderRadius: 2, background: "rgba(90,97,120,0.2)", color: C.text2, textTransform: "uppercase", letterSpacing: "0.05em" }}>{tag}</span>
                          ))}
                        </div>
                      )}

                      {isExpanded && (
                        <div style={{ padding: "8px 10px", borderTop: `1px solid ${C.border}`, background: C.bg }}>
                          <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Structure preview:</div>
                          {gt.rootNodes.map((node, i) => <GtNode key={i} node={node} depth={0} />)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
        )}
      </div>

      {/* ── Create / Edit Modal ── */}
      {dialogOpen && (
        <MilModal
          title={editing ? "Edit Unit Template" : "New Unit Template"}
          onClose={() => setDialogOpen(false)}
          actions={[
            { label: "Cancel",                          variant: "default", onClick: () => setDialogOpen(false) },
            { label: editing ? "Save" : "Create",       variant: "primary", disabled: !form.name.trim(), onClick: handleSubmit },
          ]}
        >
          {/* Live milsymbol preview */}
          <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 8px" }}>
            <MilSymbolImg icon={form.icon} echelon={form.echelon} size={64} />
          </div>

          <MilFormGroup label="Template Name">
            <MilTextInput value={form.name} onChange={(v) => set({ name: v })} placeholder="e.g. Rifle Section, Heavy Weapons Platoon" autoFocus />
          </MilFormGroup>

          <MilFormRow>
            <MilFormGroup label="Echelon">
              <MilSelect value={form.echelon} onChange={(v) => set({ echelon: v as EchelonLevel })} options={ECHELON_ORDER.map((e) => ({ value: e, label: ECHELON_LABELS[e] }))} />
            </MilFormGroup>
            <MilFormGroup label="Default Pax" compact>
              <input type="number" min={0} value={form.defaultPersonnelCount} onChange={(e) => set({ defaultPersonnelCount: Number(e.target.value) })}
                style={{ padding: "5px 8px", background: C.surface, border: `1px solid ${C.borderLt}`, borderRadius: 3, color: C.text, fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" as const }} />
            </MilFormGroup>
          </MilFormRow>

          <MilFormGroup label="Unit Function (Icon)">
            <select value={form.icon} onChange={(e) => set({ icon: e.target.value as UnitIconType })}
              style={{ padding: "5px 8px", background: C.surface, border: `1px solid ${C.borderLt}`, borderRadius: 3, color: C.text, fontSize: 12, outline: "none", width: "100%", cursor: "pointer" }}>
              {ICON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </MilFormGroup>

          <MilFormGroup label="Description">
            <MilTextArea value={form.description} onChange={(v) => set({ description: v })} placeholder="What role does this unit fill?" rows={2} />
          </MilFormGroup>

          <MilFormGroup label="Tags (comma-separated)">
            <MilTextInput value={form.tags} onChange={(v) => set({ tags: v })} placeholder="infantry, platoon, british, light" />
          </MilFormGroup>
        </MilModal>
      )}
    </div>
  );
};

// Re-export C for callers who only import from this file
export { C };
