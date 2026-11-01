// OrbatTreeView.tsx — collapsible indented tree view of a CompositionNode hierarchy

import { useState, useMemo } from "react";
import ms from "milsymbol";
import type { CompositionNode } from "@/shared/types";

const ENTITY_COLOURS: Record<string, string> = {
  organisation: "#3B5BA5",
  vehicle:      "#2E7D32",
  aircraft:     "#E65100",
  human:        "#CE93D8",
};

const AFF_COLOURS: Record<string, string> = {
  Friend: "#5B9BD5", Hostile: "#E74C3C", Neutral: "#27AE60",
  Unknown: "#F1C40F", "Assumed Friend": "#9ab8d8", Suspect: "#e07070",
};

// ── Side classification ─────────────────────────────────────────────────────
// Group affiliations into two coarse "sides" so the tree can be split into
// Allied Forces (friend-ish) and Hostile Forces (enemy-ish).
//   - Friend / Assumed Friend / Neutral → "allied"
//   - Hostile / Suspect                  → "hostile"
//   - Unknown / anything else            → "unknown" (rendered under Allied
//     when only one recognised side is present, otherwise its own group)
type SideKey = "allied" | "hostile" | "unknown";

function affiliationSide(affiliation: string): SideKey {
  const a = (affiliation || "").trim();
  if (a === "Hostile" || a === "Suspect") return "hostile";
  if (a === "Friend" || a === "Assumed Friend" || a === "Neutral") return "allied";
  return "unknown";
}

/**
 * Recursively determine the side of a subtree. A subtree counts as "hostile"
 * if any node in it is hostile-affiliated and none/fewer are friendly, etc.
 * We use a simple rule: the top node's own affiliation wins; if unknown, fall
 * back to the majority of its descendants.
 */
function subtreeSide(node: CompositionNode): SideKey {
  const own = affiliationSide(node.affiliation);
  if (own !== "unknown") return own;
  let allied = 0, hostile = 0;
  const walk = (n: CompositionNode) => {
    const s = affiliationSide(n.affiliation);
    if (s === "allied") allied++;
    else if (s === "hostile") hostile++;
    n.children.forEach(walk);
  };
  node.children.forEach(walk);
  if (hostile > allied) return "hostile";
  if (allied > 0)       return "allied";
  return "unknown";
}

function MilSym({ sidc, size = 24 }: { sidc: string; size?: number }) {
  const src = useMemo(() => {
    try {
      const svg = new ms.Symbol(sidc, { size, square: true, strokeWidth: 1.5 }).asSVG();
      if (svg && svg.length > 50) return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch { /* fall through */ }
    return "";
  }, [sidc]);

  if (!src) return <div style={{ width: size, height: size, borderRadius: 2, background: "#1a2b3c", flexShrink: 0 }} />;
  return <img src={src} width={size} height={size} alt="" style={{ display: "block", flexShrink: 0 }} />;
}

interface TreeNodeProps {
  node: CompositionNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  defaultOpen?: boolean;
}

function TreeNode({ node, depth, selectedId, onSelect, defaultOpen = true }: TreeNodeProps) {
  const [open, setOpen] = useState(defaultOpen || depth === 0);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;
  const entityColour = ENTITY_COLOURS[node.entityType] ?? "#607d8b";
  const affColour = AFF_COLOURS[node.affiliation] ?? "#607d8b";

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px 4px",
          paddingLeft: 8 + depth * 20,
          cursor: "pointer",
          background: isSelected ? "#1a3a5c" : "transparent",
          borderLeft: isSelected ? "2px solid #4fc3f7" : "2px solid transparent",
          transition: "background 0.1s",
        }}
        onClick={() => onSelect(node.id)}
        onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "#0d1e2d"; }}
        onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
      >
        {/* Expand / collapse toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); if (hasChildren) setOpen((v) => !v); }}
          style={{
            width: 14, height: 14, flexShrink: 0,
            background: "none", border: "none", cursor: hasChildren ? "pointer" : "default",
            color: hasChildren ? "#607d8b" : "transparent",
            fontSize: 9, padding: 0, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {hasChildren ? (open ? "▼" : "▶") : ""}
        </button>

        {/* Mil symbol */}
        <MilSym sidc={node.sidc} size={22} />

        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            fontWeight: isSelected ? 700 : 400,
            color: isSelected ? "#e0e0e0" : "#c8d0da",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {node.unitIdentifier || "(unnamed)"}
          </div>
          <div style={{ fontSize: 9, display: "flex", gap: 4, alignItems: "center", marginTop: 1 }}>
            {node.echelon && <span style={{ color: "#607d8b" }}>{node.echelon}</span>}
            {node.echelon && <span style={{ color: "#2a3a4a" }}>·</span>}
            <span style={{ color: entityColour }}>{node.entityType}</span>
            <span style={{ color: "#2a3a4a" }}>·</span>
            <span style={{ color: affColour }}>{node.affiliation}</span>
          </div>
        </div>

        {/* Child count badge */}
        {hasChildren && (
          <span style={{
            fontSize: 9, color: "#607d8b", flexShrink: 0,
            background: "#0d1e2d", border: "1px solid #1e3a4a",
            borderRadius: 8, padding: "0 5px", lineHeight: "16px",
          }}>
            {node.children.length}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && open && (
        <div style={{ borderLeft: "1px solid #1a2b3c", marginLeft: 8 + depth * 20 + 7 }}>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              defaultOpen={depth < 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Side-group header ────────────────────────────────────────────────────────
interface SideGroupProps {
  title: string;
  colour: string;
  accent: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function SideGroup({ title, colour, accent, count, children, defaultOpen = true }: SideGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          cursor: "pointer",
          background: accent,
          borderLeft: `3px solid ${colour}`,
          borderBottom: "1px solid #1a2b3c",
          userSelect: "none",
        }}
      >
        <span style={{
          width: 12, textAlign: "center",
          color: colour, fontSize: 10, lineHeight: 1,
        }}>
          {open ? "▼" : "▶"}
        </span>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
          color: colour,
        }}>
          {title}
        </span>
        <span style={{
          fontSize: 10, color: "#8a92a8",
          background: "#0d1e2d", border: "1px solid #1e3a4a",
          borderRadius: 8, padding: "0 6px", lineHeight: "16px",
        }}>
          {count}
        </span>
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

interface Props {
  root: CompositionNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function OrbatTreeView({ root, selectedId, onSelect }: Props) {
  // Group root's immediate children by side. If both allied AND hostile are
  // present we render a split view; otherwise fall back to the original
  // single-tree layout (which is what most operation/force hierarchies use).
  const { hasSplit, alliedChildren, hostileChildren, unknownChildren } = useMemo(() => {
    const allied: CompositionNode[]  = [];
    const hostile: CompositionNode[] = [];
    const unknown: CompositionNode[] = [];
    for (const child of root.children) {
      const side = subtreeSide(child);
      if (side === "hostile")     hostile.push(child);
      else if (side === "allied") allied.push(child);
      else                        unknown.push(child);
    }
    // Only split if we genuinely have both an allied and a hostile subtree.
    const hasSplit = allied.length > 0 && hostile.length > 0;
    return { hasSplit, alliedChildren: allied, hostileChildren: hostile, unknownChildren: unknown };
  }, [root]);

  if (!hasSplit) {
    // Single-side or ambiguous — keep the original flat rendering.
    return (
      <div style={{ flex: 1, overflowY: "auto", background: "#0a1520", paddingTop: 4, paddingBottom: 8 }}>
        <TreeNode
          node={root}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          defaultOpen={true}
        />
      </div>
    );
  }

  // Split view: render the root as a compact header, then two side groups.
  const rootIsSelected = root.id === selectedId;
  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#0a1520", paddingTop: 4, paddingBottom: 8 }}>
      {/* Root header (clickable so users can still select the root) */}
      <div
        onClick={() => onSelect(root.id)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 8px",
          cursor: "pointer",
          background: rootIsSelected ? "#1a3a5c" : "transparent",
          borderLeft: rootIsSelected ? "2px solid #4fc3f7" : "2px solid transparent",
          borderBottom: "1px solid #1a2b3c",
        }}
      >
        <MilSym sidc={root.sidc} size={22} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            fontWeight: rootIsSelected ? 700 : 600,
            color: rootIsSelected ? "#e0e0e0" : "#c8d0da",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {root.unitIdentifier || "(unnamed)"}
          </div>
          <div style={{ fontSize: 9, color: "#607d8b", marginTop: 1 }}>
            {root.echelon ? `${root.echelon} · ` : ""}{root.entityType}
          </div>
        </div>
      </div>

      <SideGroup
        title="Allied Forces"
        colour={AFF_COLOURS.Friend}
        accent="rgba(91,155,213,0.08)"
        count={alliedChildren.length}
      >
        {alliedChildren.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            defaultOpen={true}
          />
        ))}
      </SideGroup>

      <SideGroup
        title="Hostile Forces"
        colour={AFF_COLOURS.Hostile}
        accent="rgba(231,76,60,0.08)"
        count={hostileChildren.length}
      >
        {hostileChildren.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            defaultOpen={true}
          />
        ))}
      </SideGroup>

      {unknownChildren.length > 0 && (
        <SideGroup
          title="Unclassified"
          colour={AFF_COLOURS.Unknown}
          accent="rgba(241,196,15,0.06)"
          count={unknownChildren.length}
          defaultOpen={false}
        >
          {unknownChildren.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={0}
              selectedId={selectedId}
              onSelect={onSelect}
              defaultOpen={false}
            />
          ))}
        </SideGroup>
      )}
    </div>
  );
}

