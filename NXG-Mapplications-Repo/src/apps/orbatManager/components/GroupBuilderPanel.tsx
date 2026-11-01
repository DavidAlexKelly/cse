/**
 * GroupBuilderPanel.tsx — hierarchy builder for a single UnitGroup.
 *
 * Features:
 *   - Flat list view with collapse/expand + drag-to-reorder
 *   - Org-chart (SVG tree) view with pan/zoom
 *   - Unit template picker toolbar
 *   - Group template picker (apply pre-built hierarchy)
 *   - Save-as-group-template modal with sub-tree scope selector
 *   - Inline unit add/edit via UnitFormDialog
 *   - milsymbol icons in list rows (no NatoSymbol component)
 *
 * No hardcoded asset/weapon catalogues.
 * Catalogue linkage is handled inside UnitFormDialog's Catalogue tab.
 */

import React, { useState, useMemo, useCallback } from "react";
import ms from "milsymbol";
import type {
  UnitNode, UnitGroup, UnitTemplate, GroupTemplate,
  EchelonLevel, UnitIconType, GroupTemplateNode,
} from "@/shared/types";
import { ECHELON_LABELS } from "@/shared/types";
import { countPersonnel, countUnits, flattenTree, getDescendantIds } from "../lib/treeUtils";
import { filterTree, DEFAULT_FILTERS, type FilterState } from "../lib/filterUtils";
import { MilButton } from "./shared/MilButton";
import { MilModal, MilFormGroup, MilTextInput, MilTextArea } from "./shared/MilModal";
import { C } from "./shared/milStyles";
import { UnitFormDialog, type RelationshipMode } from "./UnitFormDialog";
import type { CompositionRefData } from "@/shared/hooks/useCompositionData";

// ── milsymbol helper ───────────────────────────────────────────────────────

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
const AFF_CODES: Record<string, string> = { "Friend": "F", "Hostile": "H", "Neutral": "N", "Unknown": "U", "Assumed Friend": "A", "Suspect": "S" };

function buildSidc(aff: string, icon: UnitIconType, echelon: EchelonLevel) {
  return `S${AFF_CODES[aff] ?? "F"}GPP${ICON_FUNC[icon] ?? "UCI--"}${ECH_CODES[echelon] ?? "--"}---`;
}

function MilImg({ node, size = 22 }: { node: UnitNode; size?: number }) {
  const src = useMemo(() => {
    try {
      const sidc = node.symbol.sidc ?? buildSidc(node.symbol.standardIdentity ?? "Friend", node.symbol.icon, node.echelon);
      const svg = new ms.Symbol(sidc, { size, square: true, strokeWidth: 1.5 }).asSVG();
      if (svg && svg.length > 50) return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch { /* fall through */ }
    return "";
  }, [node, size]);
  if (!src) return <div style={{ width: size, height: size, borderRadius: 2, background: C.surface, flexShrink: 0 }} />;
  return <img src={src} width={size} height={size} alt={node.symbol.icon} style={{ display: "block", flexShrink: 0, pointerEvents: "none" }} />;
}

// ── Echelon marks ──────────────────────────────────────────────────────────

const ECHELON_MARK: Record<string, string> = {
  team: "Ø", squad: "•", section: "••", platoon: "•••",
  company: "|", battalion: "||", regiment: "|||",
  brigade: "X", division: "XX", corps: "XXX",
};

const CE_BG: Record<string, string> = {
  FO: "rgba(61,139,92,0.25)", SO: "rgba(61,139,92,0.15)",
  MO: "rgba(201,146,42,0.22)", NO: "rgba(176,58,46,0.22)", UNK: "rgba(90,97,120,0.2)",
};
const CE_FG: Record<string, string> = {
  FO: "#5dc485", SO: "#5dc485", MO: "#d9ad4a", NO: "#d96b5b", UNK: "#9aa3c4",
};

// ── Flat list row ──────────────────────────────────────────────────────────

const INDENT = 20;

interface ListRowProps {
  node: UnitNode;
  group: UnitGroup;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onAddChild: () => void;
  onAddParent: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDrop: (dragId: string, targetId: string | null, pos: number) => void;
}

const ListRow: React.FC<ListRowProps> = ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  node, group: _group, depth, hasChildren, collapsed, selected,
  onSelect, onToggleCollapse, onAddChild, onAddParent, onEdit, onDelete, onDrop,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const totalPax = countPersonnel([node]);
  const ce = node.capabilities.combatEffectiveness;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const dragId = e.dataTransfer.getData("text/plain");
    const descendants = getDescendantIds(node);
    if (dragId !== node.id && !descendants.includes(dragId)) setIsDragOver(true);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const dragId = e.dataTransfer.getData("text/plain");
    const descendants = getDescendantIds(node);
    if (dragId && dragId !== node.id && !descendants.includes(dragId)) {
      onDrop(dragId, node.id, node.children.length);
    }
    setIsDragOver(false);
  };

  const bg = isDragOver ? "rgba(74,124,89,0.12)" : selected ? "rgba(34,168,192,0.08)" : "transparent";
  const bl = selected ? `2px solid ${C.cyanLt}` : isDragOver ? `2px solid ${C.olive}` : "2px solid transparent";

  return (
    <div
      draggable role="row" tabIndex={0}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", node.id); e.dataTransfer.effectAllowed = "move"; setIsDragging(true); }}
      onDragEnd={() => { setIsDragging(false); setIsDragOver(false); }}
      onDragOver={handleDragOver} onDrop={handleDrop} onDragLeave={() => setIsDragOver(false)}
      onClick={onSelect} onKeyDown={(e) => { if (e.key === "Enter") onSelect(); }}
      style={{
        display: "grid", gridTemplateColumns: "1fr 90px 52px 56px 50px 96px",
        alignItems: "center", paddingLeft: 10 + depth * INDENT, paddingRight: 8,
        paddingTop: 3, paddingBottom: 3, minHeight: 34,
        cursor: "pointer", borderBottom: `1px solid ${C.border}`,
        background: bg, borderLeft: bl, opacity: isDragging ? 0.4 : 1,
        outline: "none", transition: "background 0.1s", userSelect: "none",
      }}
    >
      {/* Name */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
        {depth > 0 && <span style={{ width: 10, height: 1, background: C.borderLt, flexShrink: 0, display: "block" }} />}
        {hasChildren
          ? <button onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.text2, fontSize: 9, padding: "0 2px", flexShrink: 0, width: 14 }}>
              {collapsed ? "▶" : "▼"}
            </button>
          : <span style={{ width: 14, flexShrink: 0 }} />
        }
        <MilImg node={node} size={22} />
        <span style={{ fontSize: 12, fontWeight: depth === 0 ? 700 : 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>
        {node.canonicalAssetKey && <span style={{ fontSize: 9, color: C.cyan, flexShrink: 0 }} title="Has catalogue asset link">🔗</span>}
      </div>
      {/* Echelon */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: C.surface, border: `1px solid ${C.borderLt}`, color: C.text2, whiteSpace: "nowrap" }}>
          {ECHELON_MARK[node.echelon] ?? ""} {ECHELON_LABELS[node.echelon]}
        </span>
      </div>
      {/* Own pax */}
      <div style={{ textAlign: "center", fontSize: 11, color: C.text2 }}>{node.personnelCount}</div>
      {/* Total pax */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: C.cyanDim, color: C.cyanLt, border: `1px solid rgba(34,168,192,0.3)` }}>
          {totalPax.toLocaleString()}
        </span>
      </div>
      {/* CE */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        {ce
          ? <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: CE_BG[ce] ?? "transparent", color: CE_FG[ce] ?? C.muted }}>{ce}</span>
          : <span style={{ fontSize: 10, color: C.muted }}>—</span>
        }
      </div>
      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 2 }} onClick={(e) => e.stopPropagation()}>
        {[
          { title: "Add parent unit (wrap above)", onClick: onAddParent,  color: C.amber,   label: "↑" },
          { title: "Add child unit",               onClick: onAddChild,   color: C.cyanLt,  label: "⊕" },
          { title: "Edit unit",                    onClick: onEdit,       color: C.text2,   label: "✎" },
          { title: "Delete unit",                  onClick: onDelete,     color: "#ef9a9a", label: "🗑" },
        ].map(({ title, onClick, color, label }) => (
          <button key={title} title={title} onClick={onClick}
            style={{ background: "none", border: "none", cursor: "pointer", color, padding: "3px 4px", borderRadius: 2, fontSize: 13, lineHeight: 1, opacity: 0.75 }}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};

// ── Org-chart (SVG tree) view ──────────────────────────────────────────────

const CW = 130; const CH = 82; const CAH = 22; const HGAP = 20; const VGAP = 60; const PAD = 40;

function subtreeW(node: UnitNode, collapsed: Set<string>): number {
  if (collapsed.has(node.id) || !node.children.length) return CW;
  return Math.max(CW, node.children.reduce((a, c, i) => a + subtreeW(c, collapsed) + (i > 0 ? HGAP : 0), 0));
}

interface NodeLayout { node: UnitNode; x: number; y: number }

function computeLayout(nodes: UnitNode[], collapsed: Set<string>): NodeLayout[] {
  const out: NodeLayout[] = [];
  function place(node: UnitNode, cx: number, y: number) {
    out.push({ node, x: cx, y });
    if (!collapsed.has(node.id) && node.children.length > 0) {
      const childY = y + CH + VGAP;
      const totalW = node.children.reduce((a, c, i) => a + subtreeW(c, collapsed) + (i > 0 ? HGAP : 0), 0);
      let childX = cx - totalW / 2;
      for (const ch of node.children) {
        const w = subtreeW(ch, collapsed);
        place(ch, childX + w / 2, childY);
        childX += w + HGAP;
      }
    }
  }
  let startX = PAD;
  for (const node of nodes) {
    const w = subtreeW(node, collapsed);
    place(node, startX + w / 2, PAD);
    startX += w + HGAP;
  }
  return out;
}

function buildConnectors(layouts: NodeLayout[], collapsed: Set<string>): React.ReactNode[] {
  const byId = new Map(layouts.map((l) => [l.node.id, l]));
  const lines: React.ReactNode[] = [];
  for (const { node, x: cx, y } of layouts) {
    if (collapsed.has(node.id) || !node.children.length) continue;
    const jY = y + CH + VGAP / 2;
    lines.push(<line key={`v-${node.id}`} x1={cx} y1={y + CH} x2={cx} y2={jY} stroke={C.border} strokeWidth={1.5} />);
    const xs = node.children.map((c) => byId.get(c.id)?.x).filter((v): v is number => v !== undefined);
    if (xs.length > 1) lines.push(<line key={`h-${node.id}`} x1={Math.min(...xs)} y1={jY} x2={Math.max(...xs)} y2={jY} stroke={C.border} strokeWidth={1.5} />);
    for (const child of node.children) {
      const cl = byId.get(child.id);
      if (!cl) continue;
      lines.push(<line key={`d-${node.id}-${child.id}`} x1={cl.x} y1={jY} x2={cl.x} y2={cl.y} stroke={C.border} strokeWidth={1.5} />);
    }
  }
  return lines;
}

const OrgCard: React.FC<{
  layout: NodeLayout; selected: boolean; collapsed: boolean;
  onSelect: () => void; onCollapse: () => void;
  onAddChild: () => void; onAddParent: () => void; onEdit: () => void; onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void; onDragLeave: () => void;
}> = ({ layout, selected, collapsed, onSelect, onCollapse, onAddChild, onAddParent, onEdit, onDelete, onDragStart, onDragEnd, onDragOver, onDrop, onDragLeave }) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [hov, setHov] = useState(false);
  const { node, x, y } = layout;
  const totalPax = countPersonnel([node]);
  const ce = node.capabilities.combatEffectiveness;
  const showActions = hov || selected;
  const bc = selected ? C.cyanLt : hov ? C.borderLt : C.border;

  return (
    <div draggable data-card="true"
      onDragStart={onDragStart} onDragEnd={onDragEnd}
      onDragOver={onDragOver} onDrop={onDrop} onDragLeave={onDragLeave}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ position: "absolute", left: x - CW / 2, top: y, width: CW, zIndex: selected || hov ? 3 : 1 }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div onClick={onSelect} style={{
        background: selected ? "rgba(34,168,192,0.08)" : hov ? C.surface : C.bg3,
        border: `1px solid ${bc}`, borderTop: `3px solid ${selected ? C.cyanLt : C.olive}`,
        borderRadius: 3, overflow: "hidden", cursor: "pointer",
        boxShadow: selected ? `0 0 0 2px rgba(34,168,192,0.2)` : "none",
      }}>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 6, paddingBottom: 1 }}>
          <MilImg node={node} size={32} />
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.text, textAlign: "center", padding: "1px 5px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "3px 4px 5px" }}>
          <span style={{ fontSize: 9, color: C.text2 }}>{node.personnelCount} pax</span>
          {totalPax !== node.personnelCount && (
            <span style={{ fontSize: 9, color: C.cyanLt, padding: "0 3px", borderRadius: 2, background: C.cyanDim }}>Σ{totalPax.toLocaleString()}</span>
          )}
          {ce && <span style={{ fontSize: 8, fontWeight: 700, padding: "0 3px", borderRadius: 2, background: CE_BG[ce] ?? "transparent", color: CE_FG[ce] ?? C.muted }}>{ce}</span>}
        </div>
        {showActions && (
          <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", borderTop: `1px solid ${C.border}`, padding: "2px", background: C.bg, height: CAH }}>
            {node.children.length > 0 && (
              <button onClick={(e) => { e.stopPropagation(); onCollapse(); }} title={collapsed ? "Expand" : "Collapse"}
                style={{ background: "none", border: "none", cursor: "pointer", color: C.text2, fontSize: 11, padding: "0 3px" }}>
                {collapsed ? "▶" : "▼"}
              </button>
            )}
            {[
              { label: "↑", title: "Add parent", color: C.amber,   fn: onAddParent },
              { label: "⊕", title: "Add child",  color: C.cyanLt,  fn: onAddChild  },
              { label: "✎", title: "Edit",        color: C.text2,   fn: onEdit      },
              { label: "🗑",title: "Delete",      color: "#ef9a9a", fn: onDelete    },
            ].map(({ label, title, color, fn }) => (
              <button key={title} title={title} onClick={(e) => { e.stopPropagation(); fn(); }}
                style={{ background: "none", border: "none", cursor: "pointer", color, fontSize: 12, padding: "0 3px" }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const OrgChart: React.FC<{
  nodes: UnitNode[]; selectedId: string | null;
  onSelect: (n: UnitNode) => void; onAddChild: (id: string) => void;
  onAddParent: (id: string) => void; onEdit: (n: UnitNode) => void; onDelete: (id: string) => void;
  onDrop: (dragId: string, targetId: string | null, pos: number) => void;
}> = ({ nodes, selectedId, onSelect, onAddChild, onAddParent, onEdit, onDelete, onDrop }) => {
  const [collapsed, setCollapsed]   = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [, setDragOverId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [pan,  setPan]  = useState({ x: 40, y: 30 });
  const isPanning = React.useRef(false);
  const panAnchor = React.useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const allNodes    = useMemo(() => flattenTree(nodes), [nodes]);
  const parentIds   = useMemo(() => allNodes.filter((n) => n.children.length > 0).map((n) => n.id), [allNodes]);
  const allCollapsed = collapsed.size === parentIds.length && parentIds.length > 0;

  const toggleCollapse = useCallback((id: string) => setCollapsed((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }), []);
  const collapseAll    = useCallback(() => setCollapsed(new Set(parentIds)), [parentIds]);
  const expandAll      = useCallback(() => setCollapsed(new Set()), []);

  const layouts    = useMemo(() => computeLayout(nodes, collapsed), [nodes, collapsed]);
  const connectors = useMemo(() => buildConnectors(layouts, collapsed), [layouts, collapsed]);

  const canvasW = layouts.length ? Math.max(...layouts.map((l) => l.x + CW / 2)) + PAD : PAD * 2;
  const canvasH = layouts.length ? Math.max(...layouts.map((l) => l.y + CH + CAH)) + PAD : PAD * 2;

  const isDesc = useCallback((target: UnitNode, dragId: string): boolean =>
    target.children.some((c) => c.id === dragId || isDesc(c, dragId)), []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(2, Math.max(0.25, z + (e.deltaY < 0 ? 0.08 : -0.08))));
  }, []);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      style={{ position: "relative", flex: "1 1 0", minHeight: 0, overflow: "hidden", background: C.bg, cursor: "grab", userSelect: "none" }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-card]")) return;
        isPanning.current = true;
        panAnchor.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
        e.preventDefault();
      }}
      onMouseMove={(e) => { if (!isPanning.current) return; setPan({ x: panAnchor.current.px + (e.clientX - panAnchor.current.mx), y: panAnchor.current.py + (e.clientY - panAnchor.current.my) }); }}
      onMouseUp={() => { isPanning.current = false; }}
      onMouseLeave={() => { isPanning.current = false; }}
      onWheel={onWheel}
    >
      <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 20, pointerEvents: "none", background: "rgba(10,12,15,0.9)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "3px 12px", fontSize: 10, color: C.muted, whiteSpace: "nowrap" }}>
        Drag background to pan · Scroll to zoom
      </div>
      <div style={{ position: "absolute", left: pan.x, top: pan.y, transform: `scale(${zoom})`, transformOrigin: "0 0", width: canvasW, height: canvasH, willChange: "transform" }}>
        <svg style={{ position: "absolute", top: 0, left: 0, width: canvasW, height: canvasH, pointerEvents: "none", overflow: "visible" }}>
          {connectors}
        </svg>
        <div style={{ position: "absolute", top: 0, left: 0, width: canvasW, height: canvasH }}>
          {layouts.map((layout) => {
            const { node } = layout;
            return (
              <OrgCard key={node.id} layout={layout}
                selected={selectedId === node.id} collapsed={collapsed.has(node.id)}
                onSelect={() => onSelect(node)} onCollapse={() => toggleCollapse(node.id)}
                onAddChild={() => onAddChild(node.id)} onAddParent={() => onAddParent(node.id)}
                onEdit={() => onEdit(node)} onDelete={() => onDelete(node.id)}
                onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData("text/plain", node.id); e.dataTransfer.effectAllowed = "move"; setDraggingId(node.id); }}
                onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!draggingId || draggingId === node.id) return; const t = allNodes.find((n) => n.id === node.id); if (t && !isDesc(t, draggingId)) setDragOverId(node.id); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const dragId = e.dataTransfer.getData("text/plain") || draggingId; if (!dragId || dragId === node.id) return; const t = allNodes.find((n) => n.id === node.id); if (t && !isDesc(t, dragId)) onDrop(dragId, node.id, t.children.length); setDragOverId(null); setDraggingId(null); }}
                onDragLeave={() => setDragOverId(null)}
              />
            );
          })}
        </div>
      </div>
      {/* Controls */}
      <div style={{ position: "absolute", bottom: 12, right: 12, zIndex: 20, display: "flex", flexDirection: "column", gap: 4 }}>
        {parentIds.length > 0 && <>
          <CtrlBtn onClick={expandAll}   active={!allCollapsed} title="Expand all">⊞</CtrlBtn>
          <CtrlBtn onClick={collapseAll} active={allCollapsed}  title="Collapse all">⊟</CtrlBtn>
          <div style={{ height: 1, background: C.borderLt }} />
        </>}
        <CtrlBtn onClick={() => setZoom((z) => Math.min(2, z + 0.1))} title="Zoom in">+</CtrlBtn>
        <CtrlBtn onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))} title="Zoom out">−</CtrlBtn>
        <CtrlBtn onClick={() => { setZoom(0.85); setPan({ x: 40, y: 30 }); }} title="Reset view">⊡</CtrlBtn>
      </div>
      <div style={{ position: "absolute", bottom: 16, left: 12, zIndex: 20, fontSize: 10, color: C.muted }}>{Math.round(zoom * 100)}%</div>
    </div>
  );
};

const CtrlBtn: React.FC<{ onClick: () => void; title: string; active?: boolean; children: React.ReactNode }> = ({ onClick, title, active, children }) => (
  <button onClick={onClick} title={title} style={{ width: 30, height: 30, background: active ? C.oliveMut : C.bg3, border: `1px solid ${active ? C.olive : C.borderLt}`, borderRadius: 2, cursor: "pointer", color: active ? C.oliveLt : C.text2, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>
    {children}
  </button>
);

// ── Template picker row ────────────────────────────────────────────────────

const TemplatePicker: React.FC<{
  options: { id: string; name: string }[];
  buttonLabel: string;
  emptyText: string;
  onApply: (id: string) => void;
  variant?: "primary" | "default";
}> = ({ options, buttonLabel, emptyText, onApply, variant = "default" }) => {
  const [selected, setSelected] = useState(options[0]?.id ?? "");
  React.useEffect(() => { if (options.length && !options.find((o) => o.id === selected)) setSelected(options[0]?.id ?? ""); }, [options, selected]);
  if (!options.length) return <span style={{ fontSize: 10, color: C.muted, fontStyle: "italic" }}>{emptyText}</span>;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ height: 26, background: C.bg2, border: `1px solid ${C.borderLt}`, borderRadius: 2, color: C.text, fontSize: 11, padding: "0 6px", maxWidth: 160 }}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <MilButton variant={variant} onClick={() => selected && onApply(selected)} disabled={!selected}>{buttonLabel}</MilButton>
    </div>
  );
};

// ── Save-template scope tree ───────────────────────────────────────────────

const SaveTreeNode: React.FC<{ node: UnitNode; depth: number; selectedId: string | null; onSelect: (id: string) => void }> = ({ node, depth, selectedId, onSelect }) => {
  const [open, setOpen] = useState(depth < 1);
  const sel = selectedId === node.id;
  return (
    <div>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div onClick={() => onSelect(node.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onSelect(node.id); }}
        style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 8 + depth * 14, paddingRight: 8, paddingTop: 5, paddingBottom: 5, cursor: "pointer", background: sel ? C.oliveMut : "transparent", border: `1px solid ${sel ? C.olive : "transparent"}`, borderRadius: 2, marginBottom: 2 }}>
        {node.children.length > 0 && (
          <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 9, padding: "0 2px" }}>
            {open ? "▼" : "▶"}
          </button>
        )}
        {node.children.length === 0 && <span style={{ width: 14 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: sel ? 700 : 500, color: sel ? C.oliveLt : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</div>
          <div style={{ fontSize: 10, color: C.muted }}>{node.echelon} · {countUnits([node])} units · {countPersonnel([node]).toLocaleString()} pax</div>
        </div>
        {sel && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 2, background: C.olive, color: "#fff" }}>SELECTED</span>}
      </div>
      {open && node.children.map((c) => <SaveTreeNode key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />)}
    </div>
  );
};

// ── Main GroupBuilderPanel ─────────────────────────────────────────────────

type ViewMode = "list" | "tree";

interface GroupBuilderPanelProps {
  group: UnitGroup;
  unitTemplates: UnitTemplate[];
  groupTemplates: GroupTemplate[];
  refData: CompositionRefData;
  onClose: () => void;
  onAddUnit:    (parentId: string | null, input: Record<string, unknown>) => Promise<void>;
  onWrapUnit:   (targetUnitId: string,    input: Record<string, unknown>) => Promise<void>;
  onUpdateUnit: (unitId: string,          input: Record<string, unknown>) => Promise<void>;
  onRemoveUnit: (unitId: string) => Promise<void>;
  onReorderUnit: (unitId: string, newParentId: string | null, position: number) => Promise<void>;
  onApplyGroupTemplate:  (templateId: string) => Promise<void>;
  onSaveGroupTemplate:   (input: Record<string, unknown>) => Promise<void>;
  onDeleteGroupTemplate: (id: string) => Promise<void>;
}

interface FlatRow { node: UnitNode; depth: number; hasChildren: boolean }

function flattenVisible(nodes: UnitNode[], depth: number, collapsed: Set<string>): FlatRow[] {
  const result: FlatRow[] = [];
  for (const node of nodes) {
    result.push({ node, depth, hasChildren: node.children.length > 0 });
    if (!collapsed.has(node.id) && node.children.length > 0) {
      result.push(...flattenVisible(node.children, depth + 1, collapsed));
    }
  }
  return result;
}

function unitToGtNode(u: UnitNode): GroupTemplateNode {
  return { name: u.name, echelon: u.echelon, personnelCount: u.personnelCount, notes: u.notes, icon: u.symbol.icon, children: u.children.map(unitToGtNode) };
}

export const GroupBuilderPanel: React.FC<GroupBuilderPanelProps> = ({
  group, unitTemplates, groupTemplates, refData,
  onClose, onAddUnit, onWrapUnit, onUpdateUnit, onRemoveUnit, onReorderUnit,
  onApplyGroupTemplate, onSaveGroupTemplate,   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onDeleteGroupTemplate: _onDeleteGroupTemplate,

}) => {
  const [viewMode,   setViewMode]   = useState<ViewMode>("list");
  const [filters,    setFilters]    = useState<FilterState>(DEFAULT_FILTERS);
  const [collapsed,  setCollapsed]  = useState<Set<string>>(new Set());
  const [allExpanded,setAllExpanded]= useState(true);
  const [selectedNode, setSelectedNode] = useState<UnitNode | null>(null);

  // Form dialog state
  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [editingNode,     setEditingNode]      = useState<UnitNode | undefined>(undefined);
  const [addParentId,     setAddParentId]      = useState<string | null>(null);
  const [addParentName,   setAddParentName]    = useState<string | null>(null);
  const [wrapTargetId,    setWrapTargetId]     = useState<string | null>(null);
  const [defaultRelMode,  setDefaultRelMode]   = useState<RelationshipMode>("child");
  const [templatePreFill, setTemplatePrefill]  = useState<Record<string, unknown> | undefined>(undefined);

  // Save template modal
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [saveTemplateDesc, setSaveTemplateDesc] = useState("");
  const [saveRootId,       setSaveRootId]        = useState<"all" | string>("all");

  const allNodes   = useMemo(() => flattenTree(group.units), [group.units]);
  const totalPax   = countPersonnel(group.units);
  const totalUnits = countUnits(group.units);
  const filtered   = filterTree(group.units, filters);
  const rows       = flattenVisible(filtered, 0, collapsed);
  const allParentIds = allNodes.filter((n) => n.children.length > 0).map((n) => n.id);

  const liveSelected = selectedNode ? (allNodes.find((u) => u.id === selectedNode.id) ?? null) : null;

  const toggleCollapse = (id: string) => setCollapsed((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const collapseAllList = () => { setCollapsed(new Set(allParentIds)); setAllExpanded(false); };
  const expandAllList   = () => { setCollapsed(new Set()); setAllExpanded(true); };

  const openAdd = (parentId: string | null) => {
    setEditingNode(undefined); setTemplatePrefill(undefined); setWrapTargetId(null);
    setAddParentId(parentId); setDefaultRelMode("child");
    const parent = parentId ? (allNodes.find((u) => u.id === parentId) ?? null) : null;
    setAddParentName(parent?.name ?? null);
    setDialogOpen(true);
  };

  const openAddFromTemplate = (parentId: string | null, tpl: UnitTemplate) => {
    setEditingNode(undefined); setWrapTargetId(null); setAddParentId(parentId); setDefaultRelMode("child");
    const parent = parentId ? (allNodes.find((u) => u.id === parentId) ?? null) : null;
    setAddParentName(parent?.name ?? null);
    setTemplatePrefill({ name: tpl.name, echelon: tpl.echelon, personnelCount: tpl.defaultPersonnelCount, notes: tpl.description, symbolIcon: tpl.symbol.icon ?? "infantry" });
    setDialogOpen(true);
  };

  const openEdit = (node: UnitNode) => {
    const live = allNodes.find((u) => u.id === node.id) ?? node;
    setEditingNode(live); setAddParentId(null); setAddParentName(null); setWrapTargetId(null); setTemplatePrefill(undefined); setDefaultRelMode("child");
    setDialogOpen(true);
  };

  const openWrap = (node: UnitNode) => {
    setEditingNode(undefined); setTemplatePrefill(undefined); setWrapTargetId(node.id); setAddParentId(null); setAddParentName(node.name); setDefaultRelMode("parent");
    setDialogOpen(true);
  };

  const handleFormSubmit = async (input: Record<string, unknown>, relMode?: RelationshipMode) => {
    if (editingNode) { await onUpdateUnit(editingNode.id, input); return; }
    if (relMode === "parent" && wrapTargetId) {
      await onWrapUnit(wrapTargetId, input);
    } else if (relMode === "sibling" && addParentId) {
      const grandparentId = allNodes.find((n) => n.children.some((c) => c.id === addParentId))?.id ?? null;
      await onAddUnit(grandparentId, input);
    } else {
      await onAddUnit(addParentId, input);
    }
  };

  const handleDelete = async (unitId: string) => {
    await onRemoveUnit(unitId);
    if (selectedNode?.id === unitId) setSelectedNode(null);
  };

  const handleDrop = async (dragId: string, targetId: string | null, position: number) => {
    await onReorderUnit(dragId, targetId, position);
  };

  const handleSaveTemplate = async () => {
    if (!saveTemplateName.trim()) return;
    let rootNodes: GroupTemplateNode[];
    if (saveRootId === "all") {
      rootNodes = group.units.map(unitToGtNode);
    } else {
      const target = allNodes.find((u) => u.id === saveRootId);
      rootNodes = target ? [unitToGtNode(target)] : group.units.map(unitToGtNode);
    }
    await onSaveGroupTemplate({ name: saveTemplateName.trim(), description: saveTemplateDesc.trim(), tags: [group.affiliation.toLowerCase()], branch: "army", rootNodes });
    setSaveTemplateOpen(false); setSaveTemplateName(""); setSaveTemplateDesc(""); setSaveRootId("all");
  };

  const unitTemplateOptions = unitTemplates.map((t) => ({ id: t.id, name: `${ECHELON_LABELS[t.echelon]} — ${t.name}` }));
  const saveNamePlaceholder = saveRootId === "all" ? group.name : (allNodes.find((u) => u.id === saveRootId)?.name ?? group.name);
  const isEmpty = group.units.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>

      {/* Top toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: C.bg2, borderBottom: `1px solid ${C.border}`, flexShrink: 0, flexWrap: "wrap" }}>
        <MilButton variant="ghost" onClick={onClose} title="Back">← Back</MilButton>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{group.name}</span>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 2, background: C.cyanDim, color: C.cyanLt, border: `1px solid rgba(34,168,192,0.35)` }}>{totalPax.toLocaleString()} PAX</span>
        <span style={{ fontSize: 10, color: C.text2 }}>{totalUnits} units</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {(["list", "tree"] as ViewMode[]).map((m) => (
            <button key={m} onClick={() => setViewMode(m)} style={{ padding: "3px 10px", background: viewMode === m ? C.olive : C.surface, border: `1px solid ${viewMode === m ? C.olive : C.borderLt}`, borderRadius: 2, cursor: "pointer", fontSize: 11, fontWeight: 700, color: viewMode === m ? "#fff" : C.text2 }}>
              {m === "list" ? "≡ List" : "⎇ Tree"}
            </button>
          ))}
        </div>
        <MilButton variant="primary" onClick={() => openAdd(null)}>+ Add Unit</MilButton>
      </div>

      {/* Template toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", background: C.bg, borderBottom: `1px solid ${C.border}`, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Unit:</span>
        <TemplatePicker options={unitTemplateOptions} buttonLabel="Add" emptyText="No unit templates" onApply={(id) => { const tpl = unitTemplates.find((t) => t.id === id); if (tpl) openAddFromTemplate(null, tpl); }} />
        <div style={{ width: 1, height: 16, background: C.borderLt }} />
        <span style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Group:</span>
        <TemplatePicker options={groupTemplates.map((g) => ({ id: g.id, name: g.name }))} buttonLabel="Apply" variant="primary" emptyText="No group templates" onApply={onApplyGroupTemplate} />
        <div style={{ flex: 1 }} />
        <MilButton variant="ghost" onClick={() => setSaveTemplateOpen(true)}>💾 Save Template</MilButton>
      </div>

      {/* Search + collapse/expand (list view) */}
      {viewMode === "list" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", background: C.bg, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <input placeholder="Search units…" value={filters.text} onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))}
            style={{ flex: 1, padding: "4px 8px", background: C.surface, border: `1px solid ${C.borderLt}`, borderRadius: 3, color: C.text, fontSize: 11, outline: "none" }} />
          <span style={{ fontSize: 10, color: C.text2, whiteSpace: "nowrap" }}>{rows.length} / {totalUnits}</span>
          {allParentIds.length > 0 && <>
            <button onClick={expandAllList}   title="Expand all"   style={{ background: allExpanded  ? C.oliveMut : "none", border: `1px solid ${allExpanded  ? C.olive : C.borderLt}`, borderRadius: 2, cursor: "pointer", color: allExpanded  ? C.oliveLt : C.muted, fontSize: 12, padding: "3px 7px" }}>⊞</button>
            <button onClick={collapseAllList} title="Collapse all" style={{ background: !allExpanded ? C.oliveMut : "none", border: `1px solid ${!allExpanded ? C.olive : C.borderLt}`, borderRadius: 2, cursor: "pointer", color: !allExpanded ? C.oliveLt : C.muted, fontSize: 12, padding: "3px 7px" }}>⊟</button>
          </>}
        </div>
      )}

      {/* Column headers (list) */}
      {viewMode === "list" && !isEmpty && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 52px 56px 50px 96px", padding: "3px 12px", background: C.bg2, borderBottom: `1px solid ${C.border}`, flexShrink: 0, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.muted }}>
          <span>Unit</span><span style={{ textAlign: "center" }}>Echelon</span><span style={{ textAlign: "center" }}>Pax</span><span style={{ textAlign: "center" }}>Total</span><span style={{ textAlign: "center" }}>CE</span><span />
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: isEmpty || viewMode === "tree" ? "hidden" : "auto", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {isEmpty && (
          <div style={{ textAlign: "center", padding: "48px 20px", color: C.muted }}>
            <div style={{ fontSize: 32, opacity: 0.25 }}>🌲</div>
            <div style={{ fontSize: 13, marginTop: 8, marginBottom: 6 }}>No units yet</div>
            <div style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 16 }}>Pick a unit template above, apply a group template, or add a custom unit.</div>
            <MilButton variant="primary" onClick={() => openAdd(null)}>+ Add Root Unit</MilButton>
          </div>
        )}

        {viewMode === "list" && !isEmpty && (
          rows.length === 0
            ? <div style={{ padding: "24px", textAlign: "center", fontSize: 11, color: C.muted }}>No units match the search.</div>
            : rows.map(({ node, depth, hasChildren }) => (
              <ListRow key={node.id} node={node} group={group}
                depth={depth} hasChildren={hasChildren}
                collapsed={collapsed.has(node.id)}
                selected={selectedNode?.id === node.id}
                onSelect={() => setSelectedNode(node)}
                onToggleCollapse={() => toggleCollapse(node.id)}
                onAddChild={() => openAdd(node.id)}
                onAddParent={() => openWrap(node)}
                onEdit={() => openEdit(node)}
                onDelete={() => void handleDelete(node.id)}
                onDrop={handleDrop}
              />
            ))
        )}

        {viewMode === "tree" && !isEmpty && (
          <OrgChart nodes={filtered} selectedId={liveSelected?.id ?? null}
            onSelect={setSelectedNode} onAddChild={openAdd} onAddParent={(id) => { const n = allNodes.find((u) => u.id === id); if (n) openWrap(n); }}
            onEdit={openEdit} onDelete={(id) => void handleDelete(id)} onDrop={handleDrop}
          />
        )}
      </div>

      {/* Add/Edit dialog */}
      <UnitFormDialog
        isOpen={dialogOpen} onClose={() => setDialogOpen(false)} onSubmit={handleFormSubmit}
        existingNode={editingNode} templatePreFill={templatePreFill}
        parentName={addParentName} defaultRelMode={defaultRelMode}
        affiliation={group.affiliation} refData={refData}
      />

      {/* Save group template modal */}
      {saveTemplateOpen && (
        <MilModal title="Save Group as Template" onClose={() => setSaveTemplateOpen(false)}
          actions={[
            { label: "Cancel",        variant: "default", onClick: () => setSaveTemplateOpen(false) },
            { label: "Save Template", variant: "primary",  disabled: !saveTemplateName.trim(), onClick: handleSaveTemplate },
          ]}>
          <div style={{ fontSize: 11, color: C.text2, marginBottom: 8, lineHeight: 1.5 }}>
            Choose the scope to save — the full group, or a specific sub-hierarchy.
          </div>

          {/* Full group option */}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div onClick={() => setSaveRootId("all")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setSaveRootId("all"); }}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 2, cursor: "pointer", marginBottom: 8, background: saveRootId === "all" ? C.oliveMut : C.bg2, border: `1px solid ${saveRootId === "all" ? C.olive : C.border}` }}>
            <span style={{ fontSize: 16 }}>🌐</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: saveRootId === "all" ? C.oliveLt : C.text }}>Full group — {group.name}</div>
              <div style={{ fontSize: 10, color: C.muted }}>{totalUnits} units · {totalPax.toLocaleString()} pax</div>
            </div>
            {saveRootId === "all" && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 2, background: C.olive, color: "#fff" }}>SELECTED</span>}
          </div>

          {/* Unit tree picker */}
          {group.units.length > 0 && (
            <MilFormGroup label="Or select a sub-hierarchy root:">
              <div style={{ maxHeight: 180, overflowY: "auto", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, padding: 4 }}>
                {group.units.map((u) => (
                  <SaveTreeNode key={u.id} node={u} depth={0} selectedId={saveRootId === "all" ? null : saveRootId} onSelect={(id) => setSaveRootId(id)} />
                ))}
              </div>
            </MilFormGroup>
          )}

          <MilFormGroup label="Template Name">
            <MilTextInput value={saveTemplateName} onChange={setSaveTemplateName} placeholder={saveNamePlaceholder} />
          </MilFormGroup>
          <MilFormGroup label="Description">
            <MilTextArea value={saveTemplateDesc} onChange={setSaveTemplateDesc} placeholder="e.g. 'Full UIB with 3 rifle companies + support'" rows={2} />
          </MilFormGroup>
        </MilModal>
      )}
    </div>
  );
};
