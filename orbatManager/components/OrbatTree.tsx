/**
 * OrbatTree — renders the force structure as a collapsible tree.
 *
 * Each node shows:
 *  - milsymbol SVG icon (16px) derived from the unit's SIDC
 *  - unit name
 *  - entity type badge (organisation / vehicle / human / aircraft)
 *  - validation badges (ERROR count, WARNING count)
 *
 * Clicking a node selects it and flies the map to the unit's position.
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import type { TreeNode, OUnit, OSimulatorConfig, ValidationIssue } from "../../../types";
import ms from "milsymbol";

interface Props {
  tree: TreeNode[];
  units: Map<string, OUnit>;
  configs: Map<string, OSimulatorConfig>;
  issuesByUnit: Map<string, ValidationIssue[]>;
  selectedUnitKey: string | null;
  onSelect: (unitKey: string) => void;
}

// Render a tiny milsymbol icon as a data URI for use in <img>
function sidcToDataUri(sidc: string): string {
  try {
    const sym = new ms.Symbol(sidc, { size: 20 });
    const svg = sym.asSVG();
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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

function EntityBadge({ type }: { type: string }) {
  const colour = ENTITY_COLOURS[type] ?? "#555";
  return (
    <span
      style={{
        fontSize: 10,
        background: colour,
        color: "#fff",
        borderRadius: 3,
        padding: "1px 5px",
        marginLeft: 6,
        whiteSpace: "nowrap",
      }}
    >
      {type}
    </span>
  );
}

function IssueBadges({ issues }: { issues: ValidationIssue[] }) {
  const errors = issues.filter((i) => i.severity === "ERROR").length;
  const warnings = issues.filter((i) => i.severity === "WARNING").length;
  return (
    <>
      {errors > 0 && (
        <span
          style={{
            fontSize: 10,
            background: "#C62828",
            color: "#fff",
            borderRadius: 3,
            padding: "1px 5px",
            marginLeft: 4,
          }}
          title={issues
            .filter((i) => i.severity === "ERROR")
            .map((i) => i.message)
            .join("\n")}
        >
          {errors} error{errors !== 1 ? "s" : ""}
        </span>
      )}
      {warnings > 0 && (
        <span
          style={{
            fontSize: 10,
            background: "#E65100",
            color: "#fff",
            borderRadius: 3,
            padding: "1px 5px",
            marginLeft: 4,
          }}
          title={issues
            .filter((i) => i.severity === "WARNING")
            .map((i) => i.message)
            .join("\n")}
        >
          {warnings} warn
        </span>
      )}
    </>
  );
}

interface NodeProps {
  node: TreeNode;
  depth: number;
  units: Map<string, OUnit>;
  configs: Map<string, OSimulatorConfig>;
  issuesByUnit: Map<string, ValidationIssue[]>;
  selectedUnitKey: string | null;
  onSelect: (key: string) => void;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
  registerRef: (key: string, el: HTMLDivElement | null) => void;
}

function TreeNodeRow({
  node,
  depth,
  units,
  configs,
  issuesByUnit,
  selectedUnitKey,
  onSelect,
  expandedKeys,
  onToggle,
  registerRef,
}: NodeProps) {
  const unit = units.get(node.unitKey);
  const config = configs.get(node.unitKey);
  const issues = issuesByUnit.get(node.unitKey) ?? [];
  const isSelected = node.unitKey === selectedUnitKey;
  const isExpanded = expandedKeys.has(node.unitKey);
  const hasChildren = node.children.length > 0;
  const iconUri = unit?.sidc ? sidcToDataUri(unit.sidc) : "";

  return (
    <>
      <div
        ref={(el) => registerRef(node.unitKey, el)}
        onClick={() => onSelect(node.unitKey)}
        style={{
          display: "flex",
          alignItems: "center",
          paddingLeft: 8 + depth * 20,
          paddingRight: 8,
          paddingTop: 5,
          paddingBottom: 5,
          cursor: "pointer",
          background: isSelected ? "#1a3a5c" : "transparent",
          borderLeft: isSelected ? "3px solid #4fc3f7" : "3px solid transparent",
          userSelect: "none",
        }}
        onMouseEnter={(e) => {
          if (!isSelected)
            (e.currentTarget as HTMLDivElement).style.background = "#1a2b3c";
        }}
        onMouseLeave={(e) => {
          if (!isSelected)
            (e.currentTarget as HTMLDivElement).style.background = "transparent";
        }}
      >
        {/* Expand/collapse toggle */}
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(node.unitKey);
          }}
          style={{
            width: 16,
            display: "inline-block",
            textAlign: "center",
            color: "#90a4ae",
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : " "}
        </span>

        {/* SIDC icon */}
        {iconUri && (
          <img
            src={iconUri}
            width={20}
            height={20}
            style={{ marginRight: 6, flexShrink: 0 }}
            alt=""
          />
        )}

        {/* Unit name */}
        <span
          style={{
            fontSize: 13,
            color: "#e0e0e0",
            flexGrow: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {unit?.unitIdentifier ?? node.unitKey}
        </span>

        {/* Badges */}
        {config && <EntityBadge type={config.entityType} />}
        <IssueBadges issues={issues} />
      </div>

      {/* Tooltip on hover showing all issue messages */}
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.unitKey}
              node={child}
              depth={depth + 1}
              units={units}
              configs={configs}
              issuesByUnit={issuesByUnit}
              selectedUnitKey={selectedUnitKey}
              onSelect={onSelect}
              expandedKeys={expandedKeys}
              onToggle={onToggle}
              registerRef={registerRef}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function OrbatTree({
  tree,
  units,
  configs,
  issuesByUnit,
  selectedUnitKey,
  onSelect,
}: Props) {
  // Start with all top-level nodes expanded
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () => new Set(tree.map((n) => n.unitKey))
  );

  // Ref map: unitKey → DOM row element, for scrolling
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  }, []);

  // When selectedUnitKey changes, expand all ancestors and scroll into view
  useEffect(() => {
    if (!selectedUnitKey) return;

    // Find the path from root to the selected node
    function findPath(nodes: TreeNode[], target: string, path: string[]): string[] | null {
      for (const node of nodes) {
        const next = [...path, node.unitKey];
        if (node.unitKey === target) return next;
        const found = findPath(node.children, target, next);
        if (found) return found;
      }
      return null;
    }

    const path = findPath(tree, selectedUnitKey, []);
    if (!path) return;

    // Expand all ancestors (everything in path except the selected node itself)
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      for (const key of path.slice(0, -1)) next.add(key);
      return next;
    });

    // Scroll the selected row into view after the expand renders
    requestAnimationFrame(() => {
      rowRefs.current.get(selectedUnitKey)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [selectedUnitKey, tree]);

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalErrors = useMemo(
    () =>
      [...issuesByUnit.values()].flat().filter((i) => i.severity === "ERROR")
        .length,
    [issuesByUnit]
  );
  const totalWarnings = useMemo(
    () =>
      [...issuesByUnit.values()].flat().filter((i) => i.severity === "WARNING")
        .length,
    [issuesByUnit]
  );

  if (tree.length === 0) {
    return (
      <div style={{ padding: 16, color: "#90a4ae", fontSize: 13 }}>
        No units loaded. Enter an operation key above.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Summary bar */}
      <div
        style={{
          padding: "6px 12px",
          borderBottom: "1px solid #1e3a4a",
          display: "flex",
          gap: 12,
          alignItems: "center",
          fontSize: 12,
          color: "#90a4ae",
          flexShrink: 0,
        }}
      >
        <span>{units.size} units</span>
        {totalErrors > 0 && (
          <span style={{ color: "#ef9a9a" }}>
            ✕ {totalErrors} error{totalErrors !== 1 ? "s" : ""}
          </span>
        )}
        {totalWarnings > 0 && (
          <span style={{ color: "#ffcc80" }}>
            ⚠ {totalWarnings} warning{totalWarnings !== 1 ? "s" : ""}
          </span>
        )}
        {totalErrors === 0 && totalWarnings === 0 && (
          <span style={{ color: "#a5d6a7" }}>✓ Ready to translate</span>
        )}
      </div>

      {/* Tree */}
      <div style={{ overflowY: "auto", flexGrow: 1 }}>
        {tree.map((node) => (
          <TreeNodeRow
            key={node.unitKey}
            node={node}
            depth={0}
            units={units}
            configs={configs}
            issuesByUnit={issuesByUnit}
            selectedUnitKey={selectedUnitKey}
            onSelect={onSelect}
            expandedKeys={expandedKeys}
            onToggle={toggle}
            registerRef={registerRef}
          />
        ))}
      </div>
    </div>
  );
}

