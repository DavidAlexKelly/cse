/* eslint-disable jsx-a11y/no-autofocus */
// ============================================================
//  Templates Panel — Unit Templates + Group Templates
//  Two tabs: UNIT TEMPLATES (single-unit configs) and
//            GROUP TEMPLATES (full hierarchy structures)
//  Unit templates: individual unit configs (squad, platoon, etc.)
//  Group templates: entire hierarchy relationships saved and reusable
// ============================================================

import React, { useState } from "react";
import type { UnitTemplate, GroupTemplate, UnitIconType, EchelonLevel } from "./types.js";
import { ECHELON_ORDER, ECHELON_LABELS, ECHELON_SHORT } from "./types.js";
import { NatoSymbol } from "./NatoSymbol.js";
import { MilButton } from "../shared/components/Button.js";
import { MilLabel } from "../shared/components/Label.js";
import {
  MilModal, MilFormGroup, MilFormRow,
  MilTextInput, MilTextArea, MilSelect,
} from "../shared/components/Modal.js";
import type { Sector1Modifier, Sector2Modifier, HqIndicator, SymbolStatus } from "./symbolSpec.js";

interface TemplatesPanelProps {
  templates: UnitTemplate[];
  groupTemplates: GroupTemplate[];
  onCreateTemplate: (input: Record<string, unknown>) => Promise<void>;
  onUpdateTemplate: (id: string, input: Record<string, unknown>) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
  onDeleteGroupTemplate: (id: string) => Promise<void>;
}

// ── Full template form state (incl. symbol fields) ─────────────────────────
interface TemplateForm {
  name: string;
  echelon: EchelonLevel;
  defaultPersonnelCount: number;
  description: string;
  tags: string;
  // Symbol
  icon: UnitIconType;
  sector1: Sector1Modifier | "";
  sector2: Sector2Modifier | "";
  hqIndicator: HqIndicator | "";
  reinforced: "+" | "-" | "±" | "";
  symbolStatus: SymbolStatus | "";
}

function templateToForm(t?: UnitTemplate): TemplateForm {
  return {
    name: t?.name ?? "",
    echelon: t?.echelon ?? "section",
    defaultPersonnelCount: t?.defaultPersonnelCount ?? 10,
    description: t?.description ?? "",
    tags: t?.tags.join(", ") ?? "",
    icon: (t?.symbol.icon as UnitIconType) ?? "infantry",
    sector1: (t?.symbol.sector1 as Sector1Modifier | "") ?? "",
    sector2: (t?.symbol.sector2 as Sector2Modifier | "") ?? "",
    hqIndicator: (t?.symbol.hqIndicator as HqIndicator | "") ?? "",
    reinforced: (t?.symbol.reinforced as "+" | "-" | "±" | "") ?? "",
    symbolStatus: (t?.symbol.status as SymbolStatus | "") ?? "",
  };
}

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

const sharedSelect: React.CSSProperties = {
  background: "var(--mil-bg-2)", border: "1px solid var(--mil-border-lt)", borderRadius: 2,
  color: "var(--mil-text)", fontSize: 12, padding: "5px 9px", width: "100%", outline: "none",
};

// Echelon indicator marks matching the spec screenshots
const ECHELON_MARK: Record<string, string> = {
  team: "Ø", squad: "•", section: "••", platoon: "•••",
  company: "|", battalion: "||", regiment: "|||",
  brigade: "X", division: "XX", corps: "XXX",
  army: "XXXX", armyGroup: "XXXXX", theatre: "XXXXXX",
};

const ECHELON_MARK_COLOR: Record<string, string> = {
  team: "#22a8c0", squad: "#22a8c0", section: "#22a8c0", platoon: "#22a8c0",
  company: "#8b7cf6", battalion: "#8b7cf6", regiment: "#8b7cf6",
  brigade: "#f0a83c", division: "#f0a83c", corps: "#f0a83c",
  army: "#ef4d4d", armyGroup: "#ef4d4d", theatre: "#ef4d4d",
};

// Intent map for echelon-level tag colours
const echelonIntent = (e: string): "blue" | "green" | "amber" | "red" => {
  if (["team","squad","section","platoon"].includes(e)) return "blue";
  if (["company","battalion","regiment"].includes(e)) return "green";
  if (["brigade","division","corps"].includes(e)) return "amber";
  return "red";
};

// ── Group template tree preview ───────────────────────────────────────────────
interface GtNodeProps { node: { name: string; echelon: string; personnelCount: number; children: GtNodeProps["node"][] }; depth: number; }
const GtNode: React.FC<GtNodeProps> = ({ node, depth }) => (
  <div>
      <div style={{
      display: "flex", alignItems: "center", gap: 5,
      paddingLeft: depth * 14, paddingTop: 2, paddingBottom: 2,
      borderLeft: depth > 0 ? "1px solid var(--mil-border)" : "none",
      marginLeft: depth > 0 ? 6 : 0,
      }}>
      <span style={{ fontSize: 10, fontFamily: "monospace", color: ECHELON_MARK_COLOR[node.echelon] ?? "var(--mil-text-2)", minWidth: 16 }}>
        {ECHELON_MARK[node.echelon] ?? "·"}
      </span>
      <span style={{ fontSize: 11, color: "var(--mil-text)", flex: 1 }}>{node.name}</span>
      <span style={{ fontSize: 9, color: "var(--mil-muted)" }}>{node.personnelCount} pax</span>
        </div>
    {node.children.map((c, i) => <GtNode key={i} node={c} depth={depth + 1} />)}
      </div>
  );

// Count total pax and units in a GroupTemplate tree
function countGtPax(nodes: GtNodeProps["node"][]): number {
  return nodes.reduce((a, n) => a + n.personnelCount + countGtPax(n.children), 0);
}
function countGtUnits(nodes: GtNodeProps["node"][]): number {
  return nodes.reduce((a, n) => a + 1 + countGtUnits(n.children), 0);
}

// ── Panel tabs ────────────────────────────────────────────────────────────────
type PanelTab = "unit" | "group";
type FormTab  = "core" | "symbol";

export const TemplatesPanel: React.FC<TemplatesPanelProps> = ({
  templates, groupTemplates,
  onCreateTemplate, onUpdateTemplate, onDeleteTemplate, onDeleteGroupTemplate,
}) => {
  const [panelTab, setPanelTab]               = useState<PanelTab>("unit");
  const [dialogOpen, setDialogOpen]           = useState(false);
  const [formTab, setFormTab]                 = useState<FormTab>("core");
  const [editingTemplate, setEditingTemplate] = useState<UnitTemplate | null>(null);
  const [form, setForm]                       = useState<TemplateForm>(templateToForm());
  const [search, setSearch]                   = useState("");
  const [expandedGt, setExpandedGt]           = useState<Set<string>>(new Set());
  // Inline delete confirmation (avoids confirm() being blocked in iframe)
  const [confirmDeleteId, setConfirmDeleteId]       = useState<string | null>(null);
  const [confirmDeleteGtId, setConfirmDeleteGtId]   = useState<string | null>(null);

  const openCreate = () => {
    setEditingTemplate(null);
    setForm(templateToForm());
    setFormTab("core");
    setDialogOpen(true);
};
  const openEdit = (t: UnitTemplate) => {
    setEditingTemplate(t);
    setForm(templateToForm(t));
    setFormTab("core");
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    const input = {
      name: form.name.trim(),
      echelon: form.echelon,
      defaultPersonnelCount: form.defaultPersonnelCount,
      description: form.description,
      tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      symbol: {
        icon:        form.icon          || undefined,
        sector1:     form.sector1       || undefined,
        sector2:     form.sector2       || undefined,
        hqIndicator: form.hqIndicator   || undefined,
        reinforced:  form.reinforced    || undefined,
        status:      form.symbolStatus  || undefined,
      },
    };
    if (editingTemplate) await onUpdateTemplate(editingTemplate.id, input);
    else await onCreateTemplate(input);
    setDialogOpen(false);
  };

  const set = (partial: Partial<TemplateForm>) => setForm(f => ({ ...f, ...partial }));

  const toggleGtExpand = (id: string) => {
    setExpandedGt(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredUnit = search
    ? templates.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.tags.some(g => g.toLowerCase().includes(search.toLowerCase()))
      )
    : templates;

  const filteredGroup = search
    ? groupTemplates.filter(g =>
        g.name.toLowerCase().includes(search.toLowerCase()) ||
        g.description.toLowerCase().includes(search.toLowerCase()) ||
        g.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
      )
    : groupTemplates;

  return (
    <div className="orbat-panel">
      {/* ── Panel tabs ── */}
      <div style={{
        display: "flex", borderBottom: "1px solid var(--mil-border)", flexShrink: 0, background: "var(--mil-bg-2)",
      }}>
        {([
          { id: "unit",  label: "Unit Templates",  count: templates.length,      icon: "◉" },
          { id: "group", label: "Group Templates",  count: groupTemplates.length, icon: "⎇" },
        ] as { id: PanelTab; label: string; count: number; icon: string }[]).map(tab => (
          <button key={tab.id} onClick={() => setPanelTab(tab.id)}
            style={{
              flex: 1, padding: "10px 8px", background: "none", border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
              color: panelTab === tab.id ? "var(--mil-text)" : "var(--mil-muted)",
              borderBottom: panelTab === tab.id ? "2px solid var(--mil-olive)" : "2px solid transparent",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            <span style={{ fontSize: 12 }}>{tab.icon}</span>
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                fontSize: 9, padding: "0 5px", borderRadius: 8,
                background: panelTab === tab.id ? "var(--mil-olive-mut)" : "var(--mil-surface)",
                color: panelTab === tab.id ? "#4ade80" : "var(--mil-muted)",
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
        {panelTab === "unit" && (
          <div style={{ display: "flex", alignItems: "center", paddingRight: 8 }}>
            <MilButton variant="primary" icon="add" onClick={openCreate}>New</MilButton>
          </div>
        )}
      </div>

      {/* ── Info banners ── */}
      {panelTab === "unit" && (
        <div style={{
          margin: "6px 8px 0", padding: "8px 12px",
          background: "var(--mil-surface)", border: "1px solid var(--mil-border-lt)",
          borderLeft: "3px solid var(--mil-olive)",
          borderRadius: 2, fontSize: 11, color: "var(--mil-text-2)", lineHeight: 1.5,
        }}>
          <strong style={{ color: "var(--mil-text)" }}>Unit templates</strong> define reusable single-unit configurations with full symbology.
          Drop them into the builder toolbar to instantly add pre-configured units.
        </div>
      )}
      {panelTab === "group" && (
        <div style={{
          margin: "6px 8px 0", padding: "8px 12px",
          background: "var(--mil-surface)", border: "1px solid var(--mil-border-lt)",
          borderLeft: "3px solid var(--mil-cyan)",
          borderRadius: 2, fontSize: 11, color: "var(--mil-text-2)", lineHeight: 1.5,
        }}>
          <strong style={{ color: "var(--mil-text)" }}>Group templates</strong> save entire hierarchy structures.
          Save them from the Builder panel, then Apply them to any group.
        </div>
      )}

      {/* ── Search ── */}
      <div style={{ padding: "6px 8px", flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <input
            className="mel-input"
            placeholder={panelTab === "unit" ? "Search unit templates…" : "Search group templates…"}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 28, width: "100%" }}
          />
          <span style={{
            position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
            fontSize: 12, color: "var(--mil-muted)", pointerEvents: "none",
          }}>
            🔍
          </span>
        </div>
      </div>

      {/* ── UNIT TEMPLATES ── */}
      {panelTab === "unit" && (
        <div className="orbat-panel__content">
          {filteredUnit.length === 0 ? (
            <div className="mil-empty">
              <div className="mil-empty__text">No unit templates found</div>
              <MilButton variant="primary" icon="add" onClick={openCreate}>Create Template</MilButton>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {filteredUnit.map(t => {
                const isConfirming = confirmDeleteId === t.id;
                return (
                  <div key={t.id} style={{
                    background: "var(--mil-bg-3)",
                    border: `1px solid ${isConfirming ? "rgba(239, 77, 77,0.5)" : "var(--mil-border)"}`,
                    borderLeft: `3px solid ${isConfirming ? "#ef4d4d" : (ECHELON_MARK_COLOR[t.echelon] ?? "var(--mil-border-lt)")}`,
                    borderRadius: 2, padding: "10px",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}>
                    {/* Symbol preview + name */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <NatoSymbol
                        standardIdentity="friend"
                        echelon={t.echelon}
                        icon={(t.symbol.icon as UnitIconType) ?? "infantry"}
                        hq={t.symbol.hqIndicator as HqIndicator | undefined}
                        sector1={t.symbol.sector1 as Sector1Modifier | undefined}
                        sector2={t.symbol.sector2 as Sector2Modifier | undefined}
                        reinforced={t.symbol.reinforced as "+" | "-" | "±" | undefined}
                        status={t.symbol.status as SymbolStatus | undefined}
                        size={36}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--mil-text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.name}
                        </div>
                        <div style={{ fontSize: 9, color: "var(--mil-text-2)", marginTop: 1 }}>
                          {ECHELON_MARK[t.echelon] ?? ""} {ECHELON_SHORT[t.echelon]} · {t.defaultPersonnelCount} pax
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    {t.description && (
                      <div style={{ fontSize: 11, color: "var(--mil-text-2)", lineHeight: 1.4 }}>
                        {t.description}
                      </div>
                    )}

                    {/* Symbol fields preview */}
                    {(t.symbol.icon || t.symbol.sector1 || t.symbol.sector2 || t.symbol.hqIndicator) && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {t.symbol.icon && t.symbol.icon !== "infantry" && (
                          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "var(--mil-cyan-dim)", color: "var(--mil-cyan-lt)", border: "1px solid rgba(34,168,192,0.3)" }}>
                            {t.symbol.icon}
                          </span>
                        )}
                        {t.symbol.sector1 && (
                          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "rgba(106, 114, 146,0.2)", color: "var(--mil-text-2)" }}>{t.symbol.sector1}</span>
                        )}
                        {t.symbol.sector2 && (
                          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "rgba(106, 114, 146,0.2)", color: "var(--mil-text-2)" }}>{t.symbol.sector2}</span>
                        )}
                        {t.symbol.hqIndicator && (
                          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "rgba(240, 168, 60,0.2)", color: "var(--mil-amber)" }}>{t.symbol.hqIndicator}</span>
                        )}
                      </div>
                    )}

                    {/* Pax + echelon badge */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <MilLabel intent={echelonIntent(t.echelon)}>
                        {ECHELON_SHORT[t.echelon]}
                      </MilLabel>
                      {/* Tags */}
                      {t.tags.map(tag => (
                        <span key={tag} style={{
                          fontSize: 9, padding: "1px 5px", borderRadius: 2,
                          background: "rgba(106, 114, 146,0.2)",
                          border: "1px solid rgba(106, 114, 146,0.35)",
                          color: "var(--mil-text-2)",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          fontWeight: 600,
                        }}>
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* Actions + inline delete confirm */}
                    <div style={{ marginTop: 2, borderTop: "1px solid var(--mil-border)", paddingTop: 8 }}>
                      {isConfirming ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ fontSize: 11, color: "#ef4d4d", fontWeight: 600 }}>Delete this template?</div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <MilButton variant="danger" icon="trash" fill onClick={() => { void onDeleteTemplate(t.id); setConfirmDeleteId(null); }}>Yes, delete</MilButton>
                            <MilButton variant="default" fill onClick={() => setConfirmDeleteId(null)}>Cancel</MilButton>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 6 }}>
                          <MilButton variant="default" icon="edit" fill onClick={() => openEdit(t)}>Edit</MilButton>
                          <MilButton variant="danger" icon="trash" iconOnly
                            onClick={() => setConfirmDeleteId(t.id)}
                            title="Delete template"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── GROUP TEMPLATES ── */}
      {panelTab === "group" && (
        <div className="orbat-panel__content">
          {filteredGroup.length === 0 ? (
            <div className="mil-empty">
              <div className="mil-empty__text">No group templates yet</div>
              <div style={{ fontSize: 11, color: "var(--mil-muted)", maxWidth: 240, textAlign: "center", lineHeight: 1.5 }}>
                Go to the Builder panel, build a structure, then click
                <strong style={{ color: "var(--mil-text)" }}> Save Template</strong>.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredGroup.map(gt => {
                const isExpanded   = expandedGt.has(gt.id);
                const isConfirming = confirmDeleteGtId === gt.id;
                const totalPax     = countGtPax(gt.rootNodes);
                const totalUnits   = countGtUnits(gt.rootNodes);
                const maxEchelon   = gt.rootNodes[0]?.echelon ?? "section";

                return (
                  <div key={gt.id} style={{
                    background: "var(--mil-bg-3)",
                    border: `1px solid ${isConfirming ? "rgba(239, 77, 77,0.5)" : "var(--mil-border)"}`,
                    borderLeft: `3px solid ${isConfirming ? "#ef4d4d" : "var(--mil-cyan)"}`,
                    borderRadius: 2, overflow: "hidden",
                  }}>
                    {/* Header */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                      background: "var(--mil-bg-2)",
                    }}>
                      {/* Expand toggle */}
                      <button onClick={() => toggleGtExpand(gt.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--mil-cyan-lt)", fontSize: 10, width: 16, flexShrink: 0 }}>
                        {isExpanded ? "▼" : "▶"}
                      </button>

                      {/* Echelon mark */}
                      <span style={{
                        fontSize: 11, fontFamily: "monospace", fontWeight: 700,
                        color: ECHELON_MARK_COLOR[maxEchelon] ?? "var(--mil-cyan-lt)", minWidth: 20,
                      }}>
                        {ECHELON_MARK[maxEchelon] ?? "·"}
                      </span>

                      {/* Name + desc */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--mil-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {gt.name}
                        </div>
                        {gt.description && (
                          <div style={{ fontSize: 10, color: "var(--mil-text-2)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {gt.description}
                          </div>
                        )}
                      </div>

                      {/* Stats */}
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 2,
                          background: "var(--mil-cyan-dim)", color: "var(--mil-cyan-lt)",
                          border: "1px solid rgba(34,168,192,0.3)",
                          fontVariantNumeric: "tabular-nums",
                        }}>
                          {totalPax.toLocaleString()} pax
                        </span>
                        <span style={{ fontSize: 9, color: "var(--mil-muted)" }}>{totalUnits} units</span>
                      </div>

                      {/* Delete */}
                      <MilButton variant="danger" icon="trash" iconOnly
                        onClick={() => setConfirmDeleteGtId(gt.id)}
                        title="Delete group template"
                      />
                    </div>

                    {/* Inline group template delete confirm */}
                    {isConfirming && (
                      <div style={{ padding: "8px 12px", background: "rgba(239, 77, 77,0.08)", borderTop: "1px solid rgba(239, 77, 77,0.3)", display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 11, color: "#ef4d4d", flex: 1 }}>Delete &quot;{gt.name}&quot;?</span>
                        <MilButton variant="danger" icon="trash" onClick={() => { void onDeleteGroupTemplate(gt.id); setConfirmDeleteGtId(null); }}>Delete</MilButton>
                        <MilButton variant="default" onClick={() => setConfirmDeleteGtId(null)}>Cancel</MilButton>
                      </div>
                    )}

                    {/* Tags */}
                    {gt.tags.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "4px 10px" }}>
                        <span style={{ fontSize: 9, color: "var(--mil-muted)" }}>Branch: {gt.branch}</span>
                        {gt.tags.map(tag => (
                          <span key={tag} style={{
                            fontSize: 9, padding: "0 5px", borderRadius: 2,
                            background: "rgba(106, 114, 146,0.2)", color: "var(--mil-text-2)",
                            textTransform: "uppercase", letterSpacing: "0.05em",
                          }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Tree preview (expanded) */}
                    {isExpanded && (
                      <div style={{ padding: "8px 10px", borderTop: "1px solid var(--mil-border)", background: "var(--mil-bg)" }}>
                        <div style={{ fontSize: 9, color: "var(--mil-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                          Structure preview:
                        </div>
                        {gt.rootNodes.map((node, i) => (
                          <GtNode key={i} node={node} depth={0} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      {dialogOpen && (
        <MilModal
          title={editingTemplate ? "Edit Unit Template" : "New Unit Template"}
          titleIcon="document"
          onClose={() => setDialogOpen(false)}
          actions={[
            { label: "Cancel",                             variant: "default", onClick: () => setDialogOpen(false) },
            { label: editingTemplate ? "Save" : "Create",  variant: "primary",
              disabled: !form.name.trim(), onClick: handleSubmit },
          ]}
        >
          {/* ── Form tabs — sticky so they stay visible while scrolling ── */}
          <div style={{ display: "flex", margin: "-16px -16px 0", borderBottom: "1px solid var(--mil-border)", background: "var(--mil-bg-2)", position: "sticky", top: 0, zIndex: 2, flexShrink: 0 }}>
            {([
              { id: "core" as FormTab,   label: "Core" },
              { id: "symbol" as FormTab, label: "⬡ Symbol" },
            ]).map(tab => (
              <button key={tab.id} onClick={() => setFormTab(tab.id)}
                style={{
                  padding: "9px 18px", background: "none", border: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: 700,
                  color: formTab === tab.id ? "var(--mil-olive-lt)" : "var(--mil-text-2)",
                  borderBottom: formTab === tab.id ? "2px solid var(--mil-olive)" : "2px solid transparent",
                }}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Tab content ── */}
          <div style={{ paddingTop: 16 }}>

          {/* ── CORE TAB ── */}
          {formTab === "core" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Live symbol preview */}
              <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 8px" }}>
                <NatoSymbol
                  standardIdentity="friend"
                  echelon={form.echelon}
                  icon={form.icon}
                  hq={form.hqIndicator as HqIndicator || undefined}
                  sector1={form.sector1 as Sector1Modifier || undefined}
                  sector2={form.sector2 as Sector2Modifier || undefined}
                  reinforced={form.reinforced as "+" | "-" | "±" || undefined}
                  status={form.symbolStatus as SymbolStatus || undefined}
                  size={64}
                  showSidc
                />
              </div>

              <MilFormGroup label="Template Name">
                <MilTextInput
                  value={form.name}
                  onChange={v => set({ name: v })}
                  placeholder="e.g. Rifle Section, Heavy Weapons Platoon"
                  autoFocus
                />
              </MilFormGroup>

              <MilFormRow>
                <MilFormGroup label="Echelon">
                  <MilSelect
                    value={form.echelon}
                    onChange={v => set({ echelon: v as EchelonLevel })}
                    options={ECHELON_ORDER.map(e => ({ value: e, label: ECHELON_LABELS[e] }))}
                  />
                </MilFormGroup>
                <MilFormGroup label="Default Pax" compact>
                  <input
                    type="number"
                    className="mel-input"
                    value={form.defaultPersonnelCount}
                    min={0}
                    onChange={e => set({ defaultPersonnelCount: Number(e.target.value) })}
                    style={{ width: "100%" }}
                  />
                </MilFormGroup>
              </MilFormRow>

              <MilFormGroup label="Description">
                <MilTextArea
                  value={form.description}
                  onChange={v => set({ description: v })}
                  placeholder="What role does this unit fill?"
                  rows={2}
                />
              </MilFormGroup>

              <MilFormGroup label="Tags (comma-separated)">
                <MilTextInput
                  value={form.tags}
                  onChange={v => set({ tags: v })}
                  placeholder="infantry, platoon, british, light"
                />
              </MilFormGroup>
            </div>
          )}

          {/* ── SYMBOL TAB ── */}
          {formTab === "symbol" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Live symbol preview */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "8px 0" }}>
                <NatoSymbol
                  standardIdentity="friend"
                  echelon={form.echelon}
                  icon={form.icon}
                  hq={form.hqIndicator as HqIndicator || undefined}
                  sector1={form.sector1 as Sector1Modifier || undefined}
                  sector2={form.sector2 as Sector2Modifier || undefined}
                  reinforced={form.reinforced as "+" | "-" | "±" || undefined}
                  status={form.symbolStatus as SymbolStatus || undefined}
                  size={80}
                  showSidc
                />
                <div style={{ fontSize: 9, color: "var(--mil-muted)", fontFamily: "monospace" }}>APP-06(E)(2) live preview</div>
              </div>

              <MilFormGroup label="Unit Function (Icon)">
                <select style={sharedSelect} value={form.icon} onChange={e => set({ icon: e.target.value as UnitIconType })}>
                  {ICON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </MilFormGroup>

              <MilFormRow>
                <MilFormGroup label="Sector 1 — Capability">
                  <select style={sharedSelect} value={form.sector1} onChange={e => set({ sector1: e.target.value as Sector1Modifier | "" })}>
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
                  <select style={sharedSelect} value={form.sector2} onChange={e => set({ sector2: e.target.value as Sector2Modifier | "" })}>
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
                  <select style={sharedSelect} value={form.hqIndicator} onChange={e => set({ hqIndicator: e.target.value as HqIndicator | "" })}>
                    <option value="">None</option>
                    <option value="hq">HQ — Headquarters</option>
                    <option value="taskForce">TF — Task Force</option>
                    <option value="hqTaskForce">HQ TF — Both</option>
                    <option value="feint">Feint</option>
                    <option value="dummy">Dummy</option>
                  </select>
                </MilFormGroup>
                <MilFormGroup label="Symbol Status">
                  <select style={sharedSelect} value={form.symbolStatus} onChange={e => set({ symbolStatus: e.target.value as SymbolStatus | "" })}>
                    <option value="">Present (default)</option>
                    <option value="planned">Planned — dashed frame</option>
                    <option value="damaged">Damaged</option>
                    <option value="destroyed">Destroyed</option>
                    <option value="fullCapacity">Full to Capacity</option>
                  </select>
                </MilFormGroup>
              </MilFormRow>

              <MilFormGroup label="Reinforced / Reduced">
                <select style={sharedSelect} value={form.reinforced} onChange={e => set({ reinforced: e.target.value as "+" | "-" | "±" | "" })}>
                  <option value="">None</option>
                  <option value="+">+ Reinforced</option>
                  <option value="-">- Reduced</option>
                  <option value="±">± Both</option>
                </select>
              </MilFormGroup>
            </div>
          )}
          </div>{/* end tab content wrapper */}
        </MilModal>
      )}
    </div>
  );
};

