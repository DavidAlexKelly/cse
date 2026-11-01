// components/CompositionTreeView.tsx
import React from "react";
import ms from "milsymbol";
import type { CompositionNode } from "@/shared/types";

interface Props {
  node: CompositionNode;
  selectedId: string;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  depth: number;
  isRoot?: boolean;
}

function sidcToUri(sidc: string): string {
  try {
    const sym = new ms.Symbol(sidc, { size: 18 });
    return `data:image/svg+xml;utf8,${encodeURIComponent(sym.asSVG())}`;
  } catch {
    return "";
  }
}

const ENTITY_COLOURS: Record<string, string> = {
  organisation: "#3B5BA5",
  vehicle: "#2E7D32",
  aircraft: "#1565C0",
  human: "#6A1B9A",
};

export function CompositionTreeView({
  node,
  selectedId,
  onSelect,
  onAddChild,
  onDuplicate,
  onRemove,
  depth,
  isRoot = false,
}: Props) {
  const [expanded, setExpanded] = React.useState(true);
  const isSelected = node.id === selectedId;
  const iconUri = sidcToUri(node.sidc);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          paddingLeft: 8 + depth * 16,
          paddingRight: 4,
          paddingTop: 4,
          paddingBottom: 4,
          cursor: "pointer",
          background: isSelected ? "#1a3a5c" : "transparent",
          borderLeft: isSelected
            ? "3px solid #4fc3f7"
            : "3px solid transparent",
          gap: 4,
        }}
        onClick={() => onSelect(node.id)}
      >
        {/* Expand toggle */}
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (node.children.length > 0) setExpanded((v) => !v);
          }}
          style={{
            width: 14,
            fontSize: 10,
            color: "#607d8b",
            flexShrink: 0,
            textAlign: "center",
          }}
        >
          {node.children.length > 0 ? (expanded ? "▾" : "▸") : " "}
        </span>

        {/* SIDC icon */}
        {iconUri && (
          <img src={iconUri} width={18} height={18} alt="" style={{ flexShrink: 0 }} />
        )}

        {/* Name */}
        <span
          style={{
            fontSize: 12,
            color: "#e0e0e0",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.unitIdentifier || "(unnamed)"}
        </span>

        {/* Quantity badge */}
        {node.quantity > 1 && (
          <span
            style={{
              fontSize: 10,
              background: "#37474f",
              color: "#90a4ae",
              borderRadius: 3,
              padding: "1px 5px",
              flexShrink: 0,
            }}
          >
            ×{node.quantity}
          </span>
        )}

        {/* Entity type badge */}
        <span
          style={{
            fontSize: 9,
            background: ENTITY_COLOURS[node.entityType] ?? "#555",
            color: "#fff",
            borderRadius: 3,
            padding: "1px 4px",
            flexShrink: 0,
          }}
        >
          {node.entityType.slice(0, 3).toUpperCase()}
        </span>

        {/* Action buttons — shown on hover via CSS trick with inline state */}
        <NodeActions
          nodeId={node.id}
          isRoot={isRoot}
          onAddChild={onAddChild}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
        />
      </div>

      {/* Children */}
      {expanded && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <CompositionTreeView
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onDuplicate={onDuplicate}
              onRemove={onRemove}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NodeActions({
  nodeId,
  isRoot,
  onAddChild,
  onDuplicate,
  onRemove,
}: {
  nodeId: string;
  isRoot: boolean;
  onAddChild: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [hover, setHover] = React.useState(false);

  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        gap: 2,
        opacity: hover ? 1 : 0,
        transition: "opacity 0.1s",
        flexShrink: 0,
      }}
    >
      <ActionBtn
        title="Add child unit"
        onClick={(e) => {
          e.stopPropagation();
          onAddChild(nodeId);
        }}
        color="#4fc3f7"
      >
        +
      </ActionBtn>
      {!isRoot && (
        <>
          <ActionBtn
            title="Duplicate"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(nodeId);
            }}
            color="#90a4ae"
          >
            ⧉
          </ActionBtn>
          <ActionBtn
            title="Remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(nodeId);
            }}
            color="#ef9a9a"
          >
            ×
          </ActionBtn>
        </>
      )}
    </span>
  );
}

function ActionBtn({
  children,
  title,
  onClick,
  color,
}: {
  children: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  color: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        color,
        cursor: "pointer",
        fontSize: 13,
        padding: "0 2px",
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}
