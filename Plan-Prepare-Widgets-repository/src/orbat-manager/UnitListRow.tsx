// ============================================================
//  Unit List Row — flat table row + expandable platform panel
// ============================================================

import React, { useState } from "react";
import type { UnitNode, Side, CommandRelationshipType } from "./types.js";
import { ECHELON_LABELS, COMMAND_REL_COLOUR, COMMAND_REL_LABELS } from "./types.js";
import { NatoSymbol } from "./NatoSymbol.js";
import { countPersonnel, getDescendantIds } from "./treeUtils.js";
import { PlatformInlineView } from "./PlatformInlineView.js";

const CE_COLOURS: Record<string, { bg: string; fg: string; border: string }> = {
  FO:  { bg: "rgba(36, 180, 126,0.25)",  fg: "#4ade80", border: "rgba(36, 180, 126,0.5)" },
  SO:  { bg: "rgba(36, 180, 126,0.15)",  fg: "#4ade80", border: "rgba(36, 180, 126,0.3)" },
  MO:  { bg: "rgba(240, 168, 60,0.22)", fg: "#f5b955", border: "rgba(240, 168, 60,0.4)" },
  NO:  { bg: "rgba(239, 77, 77,0.22)",  fg: "#f2726b", border: "rgba(239, 77, 77,0.4)" },
  UNK: { bg: "rgba(106, 114, 146,0.2)",   fg: "#98a1c0", border: "rgba(106, 114, 146,0.35)" },
};

const ECHELON_MARK: Record<string, string> = {
  team: "Ø", squad: "•", section: "••", platoon: "•••",
  company: "|", battalion: "||", regiment: "|||",
  brigade: "X", division: "XX", corps: "XXX",
};

interface UnitListRowProps {
  node: UnitNode;
  side: Side;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  selected: boolean;
  groupUnits?: UnitNode[];
  onUpdateUnit?: (unitId: string, input: Record<string, unknown>) => void;
  onUpdateParentAssets?: (parentId: string, assets: UnitNode["assets"]) => void;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onAddChild: () => void;
  onAddParent: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDrop: (dragId: string, targetId: string | null, position: number) => void;
}

const INDENT = 22;

export const UnitListRow: React.FC<UnitListRowProps> = ({
  node, side, depth, hasChildren, collapsed, selected,
  groupUnits, onUpdateUnit, onUpdateParentAssets,
  onSelect, onToggleCollapse, onAddChild, onAddParent, onEdit, onDelete, onDrop,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [platOpen, setPlatOpen]     = useState(false);

  const totalPax = countPersonnel([node]);
  const ce    = node.capabilities.combatEffectiveness;
  const ceCol = ce ? CE_COLOURS[ce] : null;

  const hasPlatforms = node.assets.length > 0 ||
    (groupUnits ? (groupUnits.flatMap(u => u.assets).some(a =>
      (a.assignedUnitIds ?? []).includes(node.id) ||
      a.sections.some(function check(s): boolean {
        return (s.assignedUnitIds ?? []).includes(node.id) || s.subSections.some(check);
      })
    )) : false);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", node.id);
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const dragId = e.dataTransfer.getData("text/plain");
    const descendants = getDescendantIds(node);
    if (dragId !== node.id && !descendants.includes(dragId)) setIsDragOver(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dragId = e.dataTransfer.getData("text/plain");
    const descendants = getDescendantIds(node);
    if (dragId && dragId !== node.id && !descendants.includes(dragId)) {
      onDrop(dragId, node.id, node.children.length);
    }
    setIsDragOver(false);
  };

  const rowBg = isDragOver  ? "rgba(108, 92, 231,0.1)"
    : selected    ? "rgba(34,168,192,0.08)"
    : isDragging  ? "rgba(255,255,255,0.02)"
    : "transparent";

  const rowBorderLeft = selected   ? "2px solid var(--mil-cyan)"
    : isDragOver ? "2px solid var(--mil-olive)"
    : "2px solid transparent";

  return (
    <div>
      {/* ── Main row ── */}
      <div
        role="row"
        draggable
        onDragStart={handleDragStart}
        onDragEnd={() => { setIsDragging(false); setIsDragOver(false); }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={() => setIsDragOver(false)}
        onClick={onSelect}
        onKeyDown={e => { if (e.key === "Enter") onSelect(); }}
        tabIndex={0}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 90px 56px 60px 54px 110px",
          alignItems: "center",
          paddingLeft: 12 + depth * INDENT,
          paddingRight: 8,
          paddingTop: 3,
          paddingBottom: 3,
          minHeight: 34,
          cursor: "pointer",
          borderBottom: platOpen ? "none" : "1px solid var(--mil-border)",
          background: rowBg,
          borderLeft: rowBorderLeft,
          opacity: isDragging ? 0.45 : 1,
          transition: "background 0.1s",
          userSelect: "none",
          outline: "none",
        }}
      >
        {/* ── Name column ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          {depth > 0 && (() => {
            const relType = node.commandRelationshipType as CommandRelationshipType | undefined;
            const col = relType ? COMMAND_REL_COLOUR[relType] : null;
            return (
              <div title={relType ? COMMAND_REL_LABELS[relType] : undefined} style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                <span style={{
                  display: "block",
                  width: 10, height: 0,
                  borderBottom: relType === "TACON"
                    ? `2px dotted ${col?.line ?? "var(--mil-border-lt)"}`
                    : relType === "OPCON" || relType === "ATTACHED"
                      ? `2px dashed ${col?.line ?? "var(--mil-border-lt)"}`
                      : relType === "ASSIGNED" || relType === "ADCON"
                        ? `2px dashed ${col?.line ?? "var(--mil-border-lt)"}`
                        : relType === "SUPPORTCON"
                          ? `2px dotted ${col?.line ?? "var(--mil-border-lt)"}`
                          : `1px solid var(--mil-border-lt)`,
                }} />
                {relType && (
                  <span style={{
                    fontSize: 7, fontWeight: 800, padding: "0 3px", borderRadius: 2,
                    background: col?.bg, color: col?.badge,
                    border: `1px solid ${col?.line}`,
                    letterSpacing: "0.04em", lineHeight: "14px",
                    flexShrink: 0,
                  }}>
                    {relType}
                  </span>
                )}
              </div>
            );
          })()}

          {hasChildren ? (
            <button
              onClick={e => { e.stopPropagation(); onToggleCollapse(); }}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--mil-text-2)", fontSize: 9, padding: "0 2px",
                flexShrink: 0, lineHeight: 1, width: 14,
              }}
            >
              {collapsed ? "▶" : "▼"}
  </button>
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}

          <NatoSymbol
            standardIdentity={side.standardIdentity}
            echelon={node.echelon} icon={node.symbol.icon}
            hq={node.symbol.hqIndicator}
            sector1={node.symbol.sector1}
            sector2={node.symbol.sector2}
            status={node.symbol.status}
            size={22}
            style={{ flexShrink: 0 }}
          />

          <span style={{
            fontSize: 12, fontWeight: depth === 0 ? 700 : 500, color: "var(--mil-text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {node.name}
          </span>

          {node.assets.length > 0 && (
            <span style={{
              fontSize: 9, padding: "0 4px", borderRadius: 2, flexShrink: 0,
              background: "var(--mil-amber-mut)", color: "var(--mil-amber)",
              border: "1px solid rgba(240, 168, 60,0.35)",
            }}>
              🚁{node.assets.length}
            </span>
          )}

          {node.equipmentType && (
            <span
              title={`Equipment: ${node.equipmentType.nomenclature}${node.equipmentType.description ? ` — ${node.equipmentType.description}` : ""}`}
              style={{
                fontSize: 9, padding: "0 5px", borderRadius: 2, flexShrink: 0,
                background: "var(--mil-cyan-dim)", color: "var(--mil-cyan-lt)",
                border: "1px solid rgba(34,168,192,0.3)",
                maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontWeight: 600,
              }}
            >
              ⚙ {node.equipmentType.nomenclature || node.equipmentType.key}
            </span>
          )}
        </div>

        {/* ── Echelon ── */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <span style={{
            fontSize: 9, fontFamily: "monospace", fontWeight: 700,
            padding: "1px 5px", borderRadius: 2,
            background: "var(--mil-surface)", border: "1px solid var(--mil-border-lt)",
            color: "var(--mil-text-2)", whiteSpace: "nowrap",
          }}>
            {ECHELON_MARK[node.echelon] ?? ""} {ECHELON_LABELS[node.echelon]}
          </span>
        </div>

        {/* ── Own Pax ── */}
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--mil-text-2)", fontVariantNumeric: "tabular-nums" }}>
          {node.personnelCount}
        </div>

        {/* ── Total Pax ── */}
        <div style={{ textAlign: "center" }}>
          <span style={{
            fontSize: 10, fontWeight: 700, fontVariantNumeric: "tabular-nums",
            padding: "1px 5px", borderRadius: 2,
            background: "var(--mil-cyan-dim)", color: "var(--mil-cyan-lt)",
            border: "1px solid rgba(34,168,192,0.3)",
          }}>
            {totalPax.toLocaleString()}
          </span>
      </div>

        {/* ── CE badge ── */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          {ceCol ? (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2,
              background: ceCol.bg, color: ceCol.fg, border: `1px solid ${ceCol.border}`,
            }}>
              {ce}
            </span>
          ) : (
            <span style={{ fontSize: 10, color: "var(--mil-muted)" }}>—</span>
          )}
        </div>

        {/* ── Actions ── */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: 2 }}
          onClick={e => e.stopPropagation()}
        >
          {hasPlatforms && (
            <ActionBtn
              title={platOpen ? "Hide platforms" : "Show platforms"}
              onClick={e => { e.stopPropagation(); setPlatOpen(p => !p); }}
              colour={platOpen ? "var(--mil-amber)" : "var(--mil-muted)"}
            >
              🚁
            </ActionBtn>
          )}
          <ActionBtn title="Add parent unit (wrap above)" onClick={e => { e.stopPropagation(); onAddParent(); }} colour="var(--mil-amber)">↑</ActionBtn>
          <ActionBtn title="Add child unit"               onClick={e => { e.stopPropagation(); onAddChild(); }}  colour="var(--mil-cyan-lt)">⊕</ActionBtn>
          <ActionBtn title="Edit unit"                    onClick={e => { e.stopPropagation(); onEdit(); }}      colour="var(--mil-text-2)">✎</ActionBtn>
          <ActionBtn title="Delete unit" onClick={e => { e.stopPropagation(); onDelete(); }} colour="var(--mil-red)">🗑</ActionBtn>
        </div>
      </div>

      {/* ── Platform inline panel ── */}
      {platOpen && hasPlatforms && groupUnits && onUpdateUnit && onUpdateParentAssets && (
        <PlatformInlineView
          unit={node}
          groupUnits={groupUnits}
          onUpdateUnit={input => onUpdateUnit(node.id, input)}
          onUpdateParentAssets={onUpdateParentAssets}
        />
      )}
      {platOpen && <div style={{ borderBottom: "1px solid var(--mil-border)" }} />}
    </div>
  );
};

const ActionBtn: React.FC<{
  title: string;
  onClick: (e: React.MouseEvent) => void;
  colour: string;
  children: React.ReactNode;
}> = ({ title, onClick, colour, children }) => (
  <button
    title={title}
    onClick={onClick}
    style={{
      background: "none", border: "none", cursor: "pointer",
      color: colour, padding: "3px 5px", borderRadius: 2,
      fontSize: 13, lineHeight: 1, opacity: 0.75,
      transition: "opacity 0.1s, background 0.1s",
    }}
    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; }}
    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.75"; (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
  >
    {children}
  </button>
);

