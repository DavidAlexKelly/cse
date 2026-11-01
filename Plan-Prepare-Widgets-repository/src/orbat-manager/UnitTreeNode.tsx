// ============================================================
//  OrgChart — top-down hierarchy view
//  SVG lines + absolutely-positioned HTML cards, pan + zoom
// ============================================================

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { UnitNode, Side, CommandRelationshipType } from "./types.js";
import { COMMAND_REL_COLOUR } from "./types.js";
import { NatoSymbol } from "./NatoSymbol.js";
import { countPersonnel, flattenTree } from "./treeUtils.js";
import { PlatformInlineView } from "./PlatformInlineView.js";

// ── Layout constants ──────────────────────────────────────────────────────────
const CW   = 120;
const CH   = 88;
const CAH  = 22;
const HGAP = 24;
const VGAP = 70;
const PAD  = 48;

interface NodeLayout { node: UnitNode; x: number; y: number; }

function subtreeWidth(node: UnitNode, collapsed: Set<string>): number {
  if (collapsed.has(node.id) || node.children.length === 0) return CW;
  const total = node.children.reduce((acc, c, i) =>
    acc + subtreeWidth(c, collapsed) + (i > 0 ? HGAP : 0), 0);
  return Math.max(CW, total);
}

function computeLayout(nodes: UnitNode[], collapsed: Set<string>): NodeLayout[] {
  const layouts: NodeLayout[] = [];
  function place(node: UnitNode, cx: number, y: number) {
    layouts.push({ node, x: cx, y });
    if (!collapsed.has(node.id) && node.children.length > 0) {
      const childY = y + CH + VGAP;
      const totalW = node.children.reduce(
        (acc, c, i) => acc + subtreeWidth(c, collapsed) + (i > 0 ? HGAP : 0), 0);
      let childX = cx - totalW / 2;
      for (const child of node.children) {
        const w = subtreeWidth(child, collapsed);
        place(child, childX + w / 2, childY);
        childX += w + HGAP;
      }
    }
  }
  let startX = PAD;
  for (const node of nodes) {
    const w = subtreeWidth(node, collapsed);
    place(node, startX + w / 2, PAD);
    startX += w + HGAP;
  }
  return layouts;
}

// Returns SVG stroke props for a given command relationship type
function relStroke(relType: CommandRelationshipType | undefined): {
  stroke: string; strokeWidth: number; strokeDasharray?: string;
} {
  if (!relType) return { stroke: "#2f3860", strokeWidth: 1.5 };
  const col = COMMAND_REL_COLOUR[relType].line;
  switch (relType) {
    case "ORGANIC":    return { stroke: col, strokeWidth: 2 };
    case "OPCON":      return { stroke: col, strokeWidth: 2, strokeDasharray: "6 3" };
    case "TACON":      return { stroke: col, strokeWidth: 2, strokeDasharray: "2 3" };
    case "ATTACHED":   return { stroke: col, strokeWidth: 1.5, strokeDasharray: "8 4" };
    case "ASSIGNED":   return { stroke: col, strokeWidth: 2, strokeDasharray: "10 3 2 3" };
    case "SUPPORTCON": return { stroke: col, strokeWidth: 1.5, strokeDasharray: "2 4" };
    case "ADCON":      return { stroke: col, strokeWidth: 1.5, strokeDasharray: "10 4 2 4" };
    default:           return { stroke: col, strokeWidth: 1.5 };
  }
}

function buildConnectors(layouts: NodeLayout[], collapsed: Set<string>): React.ReactNode[] {
  const byId = new Map(layouts.map(l => [l.node.id, l]));
  const lines: React.ReactNode[] = [];
  for (const { node, x: cx, y } of layouts) {
    if (collapsed.has(node.id) || node.children.length === 0) continue;
    const parentBottom = y + CH;
    const junctionY    = parentBottom + VGAP / 2;

    // Vertical stem from parent card bottom to junction
    lines.push(
      <line key={`v-${node.id}`}
        x1={cx} y1={parentBottom} x2={cx} y2={junctionY}
        stroke="#2f3860" strokeWidth={1.5} />
    );

    const childXs = node.children
      .map(c => byId.get(c.id)?.x)
      .filter((v): v is number => v !== undefined);

    // Horizontal bar connecting all children at junction — use default colour
    if (childXs.length > 1) {
      lines.push(
        <line key={`h-${node.id}`}
          x1={Math.min(...childXs)} y1={junctionY}
          x2={Math.max(...childXs)} y2={junctionY}
          stroke="#2f3860" strokeWidth={1.5} />
      );
    }

    // Drop lines from junction to each child — styled per relationship type
    for (const child of node.children) {
      const cl = byId.get(child.id);
      if (!cl) continue;
      const relType = child.commandRelationshipType as CommandRelationshipType | undefined;
      const stroke  = relStroke(relType);
      lines.push(
        <line key={`d-${node.id}-${child.id}`}
          x1={cl.x} y1={junctionY} x2={cl.x} y2={cl.y}
          {...stroke} />
      );
      // Relationship badge on the drop line (mid-point)
      if (relType) {
        const midY = (junctionY + cl.y) / 2;
        const col  = COMMAND_REL_COLOUR[relType];
        lines.push(
          <g key={`badge-${node.id}-${child.id}`}>
            <rect
              x={cl.x - 18} y={midY - 7}
              width={36} height={14}
              rx={3}
              fill={col.bg.replace("0.12", "0.85")}
              stroke={col.line} strokeWidth={0.8}
            />
            <text
              x={cl.x} y={midY + 4}
              textAnchor="middle"
              fontSize={7} fontWeight={800}
              fill={col.badge}
              fontFamily="monospace"
            >
              {relType}
            </text>
          </g>
        );
      }
    }
  }
  return lines;
}

interface CardProps {
  layout: NodeLayout;
  side: Side;
  selected: boolean;
  collapsed: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  allNodes: UnitNode[];
  onSelect: () => void;
  onCollapse: () => void;
  onAddChild: () => void;
  onAddParent: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onUpdateUnit?: (unitId: string, input: Record<string, unknown>) => void;
  onUpdateParentAssets?: (parentId: string, assets: UnitNode["assets"]) => void;
}

const Card: React.FC<CardProps> = ({
  layout, side, selected, collapsed, isDragging, isDragOver,
  allNodes, onSelect, onCollapse, onAddChild, onAddParent, onEdit, onDelete,
  onDragStart, onDragEnd, onDragOver, onDrop, onDragLeave,
  onUpdateUnit, onUpdateParentAssets,
}) => {
  const [hovered, setHovered] = useState(false);
  const [platOpen, setPlatOpen] = useState(false);
  const { node, x, y } = layout;
  const totalPax    = countPersonnel([node]);
  const hasChildren = node.children.length > 0;
  const ce          = node.capabilities.combatEffectiveness;
  const showActions = hovered || selected;

  // All colours via CSS vars via inline style strings
  const borderColor = isDragOver ? "var(--mil-olive)"   : selected ? "var(--mil-cyan)"    : hovered ? "var(--mil-border-lt)" : "var(--mil-border)";
  const topColor    = isDragOver ? "var(--mil-olive)"   : selected ? "var(--mil-cyan)"    : "var(--mil-olive)";
  const bgColor     = isDragOver ? "rgba(108, 92, 231,0.1)" : selected ? "rgba(34,168,192,0.08)" : hovered ? "var(--mil-surface)" : "var(--mil-bg-3)";

  return (
    <div
      draggable
      data-card="true"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: x - CW / 2,
        top: y,
        width: CW,
        zIndex: selected || hovered ? 3 : 1,
        opacity: isDragging ? 0.4 : 1,
        transition: "opacity 0.1s",
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        onClick={onSelect}
        style={{
          background: bgColor,
          border: `1px solid ${borderColor}`,
          borderTop: `3px solid ${topColor}`,
          borderRadius: 3, overflow: "hidden",
          boxShadow: selected
            ? "0 0 0 2px rgba(34,168,192,0.2), 0 4px 12px rgba(0,0,0,0.5)"
            : isDragOver ? "0 0 0 2px rgba(108, 92, 231,0.3)"
            : hovered    ? "0 2px 8px rgba(0,0,0,0.4)"
            : "none",
          transition: "all 0.1s",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 6, paddingBottom: 1 }}>
          <NatoSymbol
            standardIdentity={side.standardIdentity}
            echelon={node.echelon} icon={node.symbol.icon}
            hq={node.symbol.hqIndicator}
            sector1={node.symbol.sector1}
            sector2={node.symbol.sector2}
            status={node.symbol.status}
            size={36}
          />
        </div>

        <div style={{
          fontSize: 10, fontWeight: 700, color: "var(--mil-text)",
          textAlign: "center", padding: "1px 6px 0",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {node.name}
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: 4, padding: "3px 4px 5px",
        }}>
          <span style={{ fontSize: 9, color: "var(--mil-text-2)", fontVariantNumeric: "tabular-nums" }}>
            {node.personnelCount} pax
          </span>
          {totalPax !== node.personnelCount && (
            <span style={{
              fontSize: 9, color: "var(--mil-cyan-lt)", fontVariantNumeric: "tabular-nums",
              padding: "0 3px", borderRadius: 2, background: "var(--mil-cyan-dim)",
            }}>
              Σ{totalPax.toLocaleString()}
            </span>
          )}
          {ce && (
            <span style={{
              fontSize: 8, fontWeight: 700, padding: "0 3px", borderRadius: 2,
              background: ce === "FO" ? "rgba(36, 180, 126,0.25)"
                : ce === "MO" ? "rgba(240, 168, 60,0.25)" : "rgba(239, 77, 77,0.25)",
              color: ce === "FO" ? "#4ade80" : ce === "MO" ? "var(--mil-amber)" : "#f87171",
            }}>
              {ce}
            </span>
          )}
        </div>

        {node.assets.length > 0 && (
          <div style={{ display: "flex", justifyContent: "center", paddingBottom: 2 }}>
            <button
              onClick={e => { e.stopPropagation(); setPlatOpen(p => !p); }}
              style={{
                fontSize: 8, padding: "0 5px", borderRadius: 8, cursor: "pointer",
                background: platOpen ? "rgba(240, 168, 60,0.25)" : "var(--mil-amber-mut)",
                color: "var(--mil-amber)", border: "1px solid rgba(240, 168, 60,0.35)",
              }}>
              🚁 {node.assets.length} platform{node.assets.length > 1 ? "s" : ""}
            </button>
          </div>
        )}

        {showActions && (
          <div style={{
            display: "flex", justifyContent: "space-around", alignItems: "center",
            borderTop: "1px solid var(--mil-border)", padding: "2px",
            background: "var(--mil-bg)", height: CAH,
          }}>
            {hasChildren && (
              <CBtn c="var(--mil-text-2)" title={collapsed ? "Expand" : "Collapse"}
                onClick={e => { e.stopPropagation(); onCollapse(); }}>
                {collapsed ? "▶" : "▼"}
              </CBtn>
            )}
            <CBtn c="var(--mil-amber)"   title="Add parent unit (wrap above)" onClick={e => { e.stopPropagation(); onAddParent(); }}>↑</CBtn>
            <CBtn c="var(--mil-cyan-lt)" title="Add child unit"               onClick={e => { e.stopPropagation(); onAddChild(); }}>⊕</CBtn>
            <CBtn c="var(--mil-text-2)"  title="Edit unit"                    onClick={e => { e.stopPropagation(); onEdit(); }}>✎</CBtn>
            <CBtn c="var(--mil-red)"     title="Delete unit"                  onClick={e => { e.stopPropagation(); onDelete(); }}>🗑</CBtn>
          </div>
        )}
      </div>

      {platOpen && onUpdateUnit && onUpdateParentAssets && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          style={{
            position: "absolute", top: CH + (showActions ? CAH : 0) + 4, left: 0,
            width: 280, zIndex: 100,
            border: "1px solid var(--mil-border-lt)", borderRadius: 3,
            boxShadow: "0 8px 24px rgba(0,0,0,0.7)",
            maxHeight: 320, overflowY: "auto",
          }}
          onClick={e => e.stopPropagation()}
        >
          <PlatformInlineView
            unit={node}
            groupUnits={allNodes}
            onUpdateUnit={input => onUpdateUnit!(node.id, input)}
            onUpdateParentAssets={onUpdateParentAssets!}
          />
        </div>
      )}
    </div>
  );
};

const CBtn: React.FC<{
  c: string; title: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}> = ({ c, title, onClick, children }) => (
  <button title={title} onClick={onClick}
    style={{
      background: "none", border: "none", cursor: "pointer",
      color: c, fontSize: 12, padding: "0 3px", lineHeight: 1, opacity: 0.8,
    }}
    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.8"; }}
  >
    {children}
  </button>
);

const CtrlBtn: React.FC<{
  onClick: () => void; title: string; active?: boolean; children: React.ReactNode;
}> = ({ onClick, title, active, children }) => (
  <button onClick={onClick} title={title}
    style={{
      width: 32, height: 32,
      background: active ? "var(--mil-olive-mut)" : "var(--mil-bg-3)",
      border: `1px solid ${active ? "var(--mil-olive)" : "var(--mil-border-lt)"}`,
      borderRadius: 2, cursor: "pointer",
      color: active ? "#4ade80" : "var(--mil-text-2)",
      fontSize: 13, fontWeight: 700,
      display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none",
      transition: "all 0.1s",
      }}>
    {children}
  </button>
  );

interface OrgChartProps {
  nodes: UnitNode[];
  side: Side;
  selectedId: string | null;
  onSelect: (n: UnitNode) => void;
  onAddChild: (parentId: string) => void;
  onAddParent: (childId: string) => void;
  onEdit: (n: UnitNode) => void;
  onDelete: (id: string) => void;
  onDrop: (dragId: string, targetId: string | null, position: number) => void;
  onUpdateUnit?: (unitId: string, input: Record<string, unknown>) => void;
  onUpdateParentAssets?: (parentId: string, assets: UnitNode["assets"]) => void;
}

export const OrgChart: React.FC<OrgChartProps> = ({
  nodes, side, selectedId,
  onSelect, onAddChild, onAddParent, onEdit, onDelete, onDrop,
  onUpdateUnit, onUpdateParentAssets,
}) => {
  const [collapsed, setCollapsed]   = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan]   = useState({ x: 40, y: 30 });

  const isPanning = useRef(false);
  const panAnchor = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const allNodes = useMemo(() => flattenTree(nodes), [nodes]);
  const allParentIds = useMemo(() =>
    allNodes.filter(n => n.children.length > 0).map(n => n.id), [allNodes]);
  const allCollapsed = collapsed.size === allParentIds.length && allParentIds.length > 0;

  const collapseAll = useCallback(() => setCollapsed(new Set(allParentIds)), [allParentIds]);
  const expandAll   = useCallback(() => setCollapsed(new Set()), []);
  const toggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const layouts    = useMemo(() => computeLayout(nodes, collapsed), [nodes, collapsed]);
  const connectors = useMemo(() => buildConnectors(layouts, collapsed), [layouts, collapsed]);

  const canvasW = layouts.length ? Math.max(...layouts.map(l => l.x + CW / 2)) + PAD : PAD * 2;
  const canvasH = layouts.length ? Math.max(...layouts.map(l => l.y + CH + CAH)) + PAD : PAD * 2;

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-card]")) return;
    isPanning.current = true;
    panAnchor.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
    e.preventDefault();
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    setPan({
      x: panAnchor.current.px + (e.clientX - panAnchor.current.mx),
      y: panAnchor.current.py + (e.clientY - panAnchor.current.my),
    });
  }, []);

  const onMouseUp = useCallback(() => { isPanning.current = false; }, []);
  const onWheel   = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(2, Math.max(0.25, z + (e.deltaY < 0 ? 0.08 : -0.08))));
  }, []);

  const isDesc = useCallback((target: UnitNode, dragId: string): boolean =>
    target.children.some(c => c.id === dragId || isDesc(c, dragId)), []);

  const resetView = useCallback(() => { setZoom(0.85); setPan({ x: 40, y: 30 }); }, []);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      style={{
        position: "relative", flex: "1 1 0", minHeight: 0,
        overflow: "hidden", background: "var(--mil-bg)", cursor: "grab",
        userSelect: "none",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      {/* Hint */}
      <div style={{
        position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
        zIndex: 20, pointerEvents: "none",
        background: "rgba(10,12,15,0.92)", border: "1px solid var(--mil-border)",
        borderRadius: 12, padding: "3px 14px",
        fontSize: 10, color: "var(--mil-muted)", whiteSpace: "nowrap",
      }}>
        Drag background to pan · Scroll to zoom · Click card to select
      </div>

      {/* Canvas */}
      <div
        style={{
          position: "absolute",
          left: pan.x, top: pan.y,
          transform: `scale(${zoom})`,
          transformOrigin: "0 0",
          width: canvasW, height: canvasH,
          willChange: "transform",
        }}
      >
        <svg style={{
          position: "absolute", top: 0, left: 0,
          width: canvasW, height: canvasH,
          pointerEvents: "none", overflow: "visible",
        }}>
          {connectors}
        </svg>

        <div style={{ position: "absolute", top: 0, left: 0, width: canvasW, height: canvasH }}>
          {layouts.map(layout => {
            const { node } = layout;
            return (
              <Card
                key={node.id}
                layout={layout} side={side} allNodes={allNodes}
                selected={selectedId === node.id}
                collapsed={collapsed.has(node.id)}
                isDragging={draggingId === node.id}
                isDragOver={dragOverId === node.id}
                onSelect={() => onSelect(node)}
                onUpdateUnit={onUpdateUnit}
                onUpdateParentAssets={onUpdateParentAssets}
                onCollapse={() => toggleCollapse(node.id)}
                onAddChild={() => onAddChild(node.id)}
                onAddParent={() => onAddParent(node.id)}
                onEdit={() => onEdit(node)}
                onDelete={() => onDelete(node.id)}
                onDragStart={e => {
                  e.stopPropagation();
                  e.dataTransfer.setData("text/plain", node.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingId(node.id);
                }}
                onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                onDragOver={e => {
                  e.preventDefault(); e.stopPropagation();
                  const dragId = draggingId;
                  if (!dragId || dragId === node.id) return;
                  const target = allNodes.find(n => n.id === node.id);
                  if (target && !isDesc(target, dragId)) setDragOverId(node.id);
                }}
                onDrop={e => {
                  e.preventDefault(); e.stopPropagation();
                  const dragId = e.dataTransfer.getData("text/plain") || draggingId;
                  if (!dragId || dragId === node.id) return;
                  const target = allNodes.find(n => n.id === node.id);
                  if (target && !isDesc(target, dragId)) {
                    onDrop(dragId, node.id, target.children.length);
                  }
                  setDragOverId(null); setDraggingId(null);
                }}
                onDragLeave={() => setDragOverId(null)}
              />
            );
          })}
        </div>
      </div>

      {/* ── Bottom-right controls ── */}
      <div style={{
        position: "absolute", bottom: 12, right: 12, zIndex: 20,
        display: "flex", flexDirection: "column", gap: 4,
      }}>
        {allParentIds.length > 0 && (
          <>
            <CtrlBtn onClick={expandAll}   title="Expand all"   active={!allCollapsed}>⊞</CtrlBtn>
            <CtrlBtn onClick={collapseAll} title="Collapse all" active={allCollapsed}>⊟</CtrlBtn>
            <div style={{ height: 1, background: "var(--mil-border-lt)", margin: "2px 0" }} />
          </>
        )}
        <CtrlBtn onClick={() => setZoom(z => Math.min(2,    z + 0.1))} title="Zoom in">+</CtrlBtn>
        <CtrlBtn onClick={() => setZoom(z => Math.max(0.25, z - 0.1))} title="Zoom out">−</CtrlBtn>
        <CtrlBtn onClick={resetView} title="Reset view">⊡</CtrlBtn>
      </div>

      {/* Zoom % */}
      <div style={{
        position: "absolute", bottom: 16, left: 12, zIndex: 20,
        fontSize: 10, color: "var(--mil-muted)", fontVariantNumeric: "tabular-nums",
      }}>
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
};

export { OrgChart as UnitTreeNode };

