// ============================================================
//  Group Builder Panel — List view + Tree view
// ============================================================

import React, { useState } from "react";
import type {
  UnitGroup,
  UnitNode,
  Side,
  UnitTemplate,
  GroupTemplate,
} from "./types.js";
import { ECHELON_LABELS } from "./types.js";
import { countPersonnel, countUnits, flattenTree } from "./treeUtils.js";
import {
  DEFAULT_FILTERS,
  filterTree,
  type FilterState,
} from "./filterUtils.js";
import { UnitListRow } from "./UnitListRow.js";
import { UnitTreeNode } from "./UnitTreeNode.js";
import { UnitDetailPanel } from "./UnitDetailPanel.js";
import { UnitFormDialog } from "./UnitFormDialog.js";
import type { RelationshipMode } from "./UnitFormDialog.js";
import { MilButton } from "../shared/components/Button.js";
import {
  MilModal,
  MilFormGroup,
  MilTextInput,
  MilTextArea,
} from "../shared/components/Modal.js";
import type { LayerId } from "./layers.js";
import { LAYERS } from "./layers.js";
import { OrbatValidationPanel } from "./OrbatValidationPanel.js";
import { FormationCardView } from "./FormationCardView.js";
import { AiStructurePanel } from "./AiStructurePanel.js";
import { PlatformsLayerPanel, WeaponsLayerPanel } from "./LayerPanels.js";

type ViewMode = "list" | "tree" | "card" | "layer" | "validate" | "ai";

interface GroupBuilderPanelProps {
  group: UnitGroup;
  side: Side;
  unitTemplates: UnitTemplate[];
  groupTemplates: GroupTemplate[];
  onClose: () => void;
  /**
   * Insert a new unit under the given parent.  MUST return the newly-created
   * node (or at least `{ id }`) — the AI Structure and Child Generation
   * builders rely on this id to map their temporary tempIds → real store ids
   * so that grandchildren are attached to the correct parent.
   */
  onAddUnit: (
    parentId: string | null,
    input: Record<string, unknown>
  ) => Promise<unknown>;

  /** Insert a new unit as the parent of an existing one */
  onWrapUnit: (
    targetUnitId: string,
    input: Record<string, unknown>
  ) => Promise<void>;
  onUpdateUnit: (
    unitId: string,
    input: Record<string, unknown>
  ) => Promise<void>;
  onRemoveUnit: (unitId: string) => Promise<void>;
  onReorderUnit: (
    unitId: string,
    newParentId: string | null,
    position: number
  ) => Promise<void>;
  onApplyGroupTemplate: (templateId: string) => Promise<void>;
  onSaveGroupTemplate: (input: Record<string, unknown>) => Promise<void>;
  onDeleteGroupTemplate: (id: string) => Promise<void>;
  onUpdateParentAssets?: (
    parentUnitId: string,
    newAssets: UnitNode["assets"]
  ) => void;
  /**
   * Pre-built SWORD-shaped ORBAT payload from Workshop (produced by the
   * operation→SWORD helper function).  Passed straight through to the CSE
   * Validation tab, which uses it verbatim as `orbatContent`.  Empty string
   * when Workshop hasn't supplied one yet.
   */
  validationPayload?: string;
  /**
   * `cse_validate_orbat.projectName` override supplied by Workshop.  When
   * non-empty, replaces the widget's default project name (side/group).
   */
  validationProjectName?: string;
  /**
   * Invoked with the raw JSON string returned by the CSE validator every
   * time a validation run completes.  The root widget wires this up to
   * emit the `onValidationCompleted` event so Workshop can react.
   */
  onValidationCompleted?: (rawResult: string) => void;
}

interface FlatRow {
  node: UnitNode;
  depth: number;
  hasChildren: boolean;
}

function flattenVisible(
  nodes: UnitNode[],
  depth: number,
  collapsed: Set<string>
): FlatRow[] {
  const result: FlatRow[] = [];
  for (const node of nodes) {
    result.push({ node, depth, hasChildren: node.children.length > 0 });
    if (!collapsed.has(node.id) && node.children.length > 0) {
      result.push(...flattenVisible(node.children, depth + 1, collapsed));
    }
  }
  return result;
}

const ViewBtn: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      padding: "3px 10px",
      background: active ? "var(--mil-olive)" : "var(--mil-surface)",
      border: `1px solid ${
        active ? "var(--mil-olive)" : "var(--mil-border-lt)"
      }`,
      borderRadius: 2,
      cursor: "pointer",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.05em",
      color: active ? "#fff" : "var(--mil-text-2)",
      transition: "all 0.1s",
    }}
  >
    {children}
  </button>
);

// Fixed-height select + button row — no wrapping / overlap issues
const TemplatePicker: React.FC<{
  label: string;
  options: { id: string; name: string }[];
  buttonLabel: string;
  buttonVariant?: "primary" | "default";
  onApply: (id: string) => void;
  emptyText: string;
}> = ({
  label,
  options,
  buttonLabel,
  buttonVariant = "default",
  onApply,
  emptyText,
}) => {
  const [selected, setSelected] = useState(options[0]?.id ?? "");

  React.useEffect(() => {
    if (options.length && !options.find((o) => o.id === selected)) {
      setSelected(options[0]?.id ?? "");
    }
  }, [options, selected]);

  if (options.length === 0) {
    return (
      <span
        style={{
          fontSize: 10,
          color: "var(--mil-muted)",
          fontStyle: "italic",
          padding: "0 4px",
        }}
      >
        {emptyText}
      </span>
    );
  }

  return (
    <div
      style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}
    >
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        style={{
          height: 26,
          background: "var(--mil-bg-2)",
          border: "1px solid var(--mil-border-lt)",
          borderRadius: 2,
          color: "var(--mil-text)",
          fontSize: 11,
          padding: "0 6px",
          maxWidth: 160,
          lineHeight: "26px",
          boxSizing: "border-box",
          appearance: "auto",
        }}
        title={label}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <MilButton
        variant={buttonVariant}
        onClick={() => {
          if (selected) onApply(selected);
        }}
        disabled={!selected}
      >
        {buttonLabel}
      </MilButton>
    </div>
  );
};

// ── Recursive tree node for the save-template scope selector ─────────────────
interface SaveTreeNodeProps {
  node: UnitNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const SaveTreeNode: React.FC<SaveTreeNodeProps> = ({
  node,
  depth,
  selectedId,
  onSelect,
}) => {
  const [open, setOpen] = useState(depth < 1);
  const pax = countPersonnel([node]);
  const units = countUnits([node]);
  const sel = selectedId === node.id;
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(node.id);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          paddingLeft: 8 + depth * 16,
          paddingRight: 8,
          paddingTop: 5,
          paddingBottom: 5,
          cursor: "pointer",
          background: sel ? "var(--mil-olive-mut)" : "transparent",
          border: `1px solid ${sel ? "var(--mil-olive)" : "transparent"}`,
          borderRadius: 2,
          marginBottom: 2,
          transition: "background 0.1s",
        }}
      >
        {node.children.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--mil-muted)",
              fontSize: 9,
              padding: "0 2px",
              flexShrink: 0,
            }}
          >
            {open ? "▼" : "▶"}
          </button>
        )}
        {node.children.length === 0 && (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: sel ? 700 : 500,
              color: sel ? "var(--mil-olive-lt)" : "var(--mil-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {node.name}
          </div>
          <div style={{ fontSize: 10, color: "var(--mil-muted)" }}>
            {node.echelon} · {units} units · {pax.toLocaleString()} pax
          </div>
        </div>
        {sel && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 2,
              background: "var(--mil-olive)",
              color: "#fff",
              flexShrink: 0,
            }}
          >
            SELECTED
          </span>
        )}
      </div>

      {open &&
        node.children.map((child) => (
          <SaveTreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
};

// ── Comms Layer ─────────────────────────────────────────────────────────────
//   Flat table of every unit's radio / call-sign / IFF configuration.
//   Rows are clickable — dispatches onSelect(unit) so the detail overlay
//   opens with the same behaviour as the other views.
const CommsLayerTable: React.FC<{
  units: UnitNode[];
  onSelect: (unit: UnitNode) => void;
}> = ({ units, onSelect }) => {
  const flat = React.useMemo(() => flattenTree(units), [units]);
  const withComms = flat.filter(
    (u) =>
      u.capabilities.callSign ||
      u.capabilities.radioFreqMhz !== undefined ||
      u.capabilities.iffCode
  );
  if (withComms.length === 0) {
    return (
      <div className="mil-empty" style={{ padding: 40 }}>
        <div style={{ fontSize: 28, opacity: 0.3 }}>📻</div>
        <div className="mil-empty__text">No comms data</div>
        <div
          style={{
            fontSize: 11,
            color: "var(--mil-muted)",
            maxWidth: 260,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Set call-signs, radio frequencies and IFF codes in a unit&apos;s
          Capabilities tab.
        </div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}
      >
        <thead>
          <tr>
            {["Unit", "Echelon", "Call-Sign", "Radio (MHz)", "IFF/SIF"].map(
              (label) => (
                <th
                  key={label}
                  style={{
                    textAlign: "left",
                    padding: "5px 10px",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--mil-muted)",
                    background: "var(--mil-bg-2)",
                    borderBottom: "1px solid var(--mil-border)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {withComms.map((u, i) => (
            <tr
              key={u.id}
              onClick={() => onSelect(u)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(u);
              }}
              tabIndex={0}
              style={{
                background: i % 2 === 0 ? "var(--mil-bg)" : "var(--mil-bg-2)",
                cursor: "pointer",
              }}
            >
              <td
                style={{
                  padding: "6px 10px",
                  color: "var(--mil-text)",
                  fontWeight: 600,
                }}
              >
                {u.name}
              </td>
              <td style={{ padding: "6px 10px", color: "var(--mil-text-2)" }}>
                {ECHELON_LABELS[u.echelon]}
              </td>
              <td
                style={{
                  padding: "6px 10px",
                  fontFamily: "monospace",
                  color: "var(--mil-cyan-lt)",
                }}
              >
                {u.capabilities.callSign ?? (
                  <span style={{ color: "var(--mil-muted)" }}>—</span>
                )}
              </td>
              <td
                style={{
                  padding: "6px 10px",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--mil-text-2)",
                }}
              >
                {u.capabilities.radioFreqMhz !== undefined ? (
                  `${u.capabilities.radioFreqMhz} MHz`
                ) : (
                  <span style={{ color: "var(--mil-muted)" }}>—</span>
                )}
              </td>
              <td
                style={{
                  padding: "6px 10px",
                  fontFamily: "monospace",
                  color: "var(--mil-text-2)",
                }}
              >
                {u.capabilities.iffCode ?? (
                  <span style={{ color: "var(--mil-muted)" }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Logistics Layer ────────────────────────────────────────────────────────
//   Fuel / ammo levels come from UnitState; range from capabilities.
const LogisticsLayerTable: React.FC<{
  units: UnitNode[];
  onSelect: (unit: UnitNode) => void;
}> = ({ units, onSelect }) => {
  const flat = React.useMemo(() => flattenTree(units), [units]);
  const withLogi = flat.filter(
    (u) =>
      u.state.fuelLevel !== undefined ||
      u.state.ammoLevel !== undefined ||
      u.capabilities.rangeKm !== undefined
  );
  if (withLogi.length === 0) {
    return (
      <div className="mil-empty" style={{ padding: 40 }}>
        <div style={{ fontSize: 28, opacity: 0.3 }}>⛽</div>
        <div className="mil-empty__text">No logistics data</div>
        <div
          style={{
            fontSize: 11,
            color: "var(--mil-muted)",
            maxWidth: 260,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Fuel / ammo levels are set via the state model. Range is on the
          Capabilities tab.
        </div>
      </div>
    );
  }
  const bar = (value: number | undefined, colour: string) => {
    if (value === undefined)
      return <span style={{ color: "var(--mil-muted)" }}>—</span>;
    const clamped = Math.max(0, Math.min(100, value));
    return (
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 100 }}
      >
        <div
          style={{
            flex: 1,
            height: 6,
            background: "var(--mil-border)",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${clamped}%`,
              height: "100%",
              background: colour,
              transition: "width 0.2s",
            }}
          />
        </div>
        <span
          style={{
            fontSize: 10,
            color: "var(--mil-text-2)",
            fontVariantNumeric: "tabular-nums",
            minWidth: 30,
            textAlign: "right",
          }}
        >
          {clamped}%
        </span>
      </div>
    );
  };
  return (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}
      >
        <thead>
          <tr>
            {["Unit", "Echelon", "Fuel", "Ammo", "Range (km)"].map((label) => (
              <th
                key={label}
                style={{
                  textAlign: "left",
                  padding: "5px 10px",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--mil-muted)",
                  background: "var(--mil-bg-2)",
                  borderBottom: "1px solid var(--mil-border)",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {withLogi.map((u, i) => (
            <tr
              key={u.id}
              onClick={() => onSelect(u)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(u);
              }}
              tabIndex={0}
              style={{
                background: i % 2 === 0 ? "var(--mil-bg)" : "var(--mil-bg-2)",
                cursor: "pointer",
              }}
            >
              <td
                style={{
                  padding: "6px 10px",
                  color: "var(--mil-text)",
                  fontWeight: 600,
                }}
              >
                {u.name}
              </td>
              <td style={{ padding: "6px 10px", color: "var(--mil-text-2)" }}>
                {ECHELON_LABELS[u.echelon]}
              </td>
              <td style={{ padding: "6px 10px" }}>
                {bar(u.state.fuelLevel, "#4ade80")}
              </td>
              <td style={{ padding: "6px 10px" }}>
                {bar(u.state.ammoLevel, "#f87171")}
              </td>
              <td
                style={{
                  padding: "6px 10px",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--mil-text-2)",
                }}
              >
                {u.capabilities.rangeKm !== undefined ? (
                  u.capabilities.rangeKm
                ) : (
                  <span style={{ color: "var(--mil-muted)" }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const GroupBuilderPanel: React.FC<GroupBuilderPanelProps> = ({
  group,
  side,
  unitTemplates,
  groupTemplates,
  onClose,
  onAddUnit,
  onWrapUnit,
  onUpdateUnit,
  onRemoveUnit,
  onReorderUnit,
  onApplyGroupTemplate,
  onSaveGroupTemplate,
  onDeleteGroupTemplate,
  onUpdateParentAssets,
  validationPayload,
  validationProjectName,
  onValidationCompleted,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [activeLayer, setActiveLayer] = useState<LayerId>("platforms");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [allListExpanded, setAllListExpanded] = useState(true);
  const [selectedNode, setSelectedNode] = useState<UnitNode | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<UnitNode | undefined>(
    undefined
  );
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [addParentName, setAddParentName] = useState<string | null>(null);
  // "parent" relationship: the node that the new unit will wrap
  const [wrapTargetId, setWrapTargetId] = useState<string | null>(null);

  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [saveTemplateDesc, setSaveTemplateDesc] = useState("");
  const [saveRootId, setSaveRootId] = useState<"all" | string>("all");
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);
  const [pendingTemplateInput, setPendingTemplateInput] = useState<
    Record<string, unknown> | undefined
  >(undefined);

  const totalPax = countPersonnel(group.units);
  const totalUnits = countUnits(group.units);

  const filtered = filterTree(group.units, filters);
  const rows = flattenVisible(filtered, 0, collapsed);

  // Flat list of all nodes (for collapse/expand all)
  const allNodes = flattenTree(group.units);
  const allParentIdsInGroup = allNodes
    .filter((n) => n.children.length > 0)
    .map((n) => n.id);

  // Always derive selectedNode from LIVE group.units so detail panel
  // reflects the latest state (platforms, weapons, etc.) after any mutation.
  const liveSelectedNode = selectedNode
    ? allNodes.find((u) => u.id === selectedNode.id) ?? null
    : null;

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const collapseAllList = () => {
    setCollapsed(new Set(allParentIdsInGroup));
    setAllListExpanded(false);
  };
  const expandAllList = () => {
    setCollapsed(new Set());
    setAllListExpanded(true);
  };

  const openAdd = (parentId: string | null) => {
    setEditingNode(undefined);
    setPendingTemplateInput(undefined);
    setWrapTargetId(null);
    setAddParentId(parentId);
    const parent = parentId
      ? allNodes.find((u) => u.id === parentId) ?? null
      : null;
    setAddParentName(parent?.name ?? null);
    setDialogOpen(true);
  };

  const openAddFromTemplate = (parentId: string | null, tpl: UnitTemplate) => {
    setEditingNode(undefined);
    setWrapTargetId(null);
    setAddParentId(parentId);
    const parent = parentId
      ? allNodes.find((u) => u.id === parentId) ?? null
      : null;
    setAddParentName(parent?.name ?? null);
    setPendingTemplateInput({
      name: tpl.name,
      echelon: tpl.echelon,
      personnelCount: tpl.defaultPersonnelCount,
      notes: tpl.description,
      symbolIcon: (tpl.symbol.icon as string) ?? "infantry",
    });
    setDialogOpen(true);
  };

  const openEdit = (node: UnitNode) => {
    // Always resolve from live group.units so the edit form shows current data
    const liveNode = allNodes.find((u) => u.id === node.id) ?? node;
    setEditingNode(liveNode);
    setAddParentId(null);
    setAddParentName(null);
    setWrapTargetId(null);
    setPendingTemplateInput(undefined);
    setDetailOpen(false);
    setDialogOpen(true);
  };

  /** Open add dialog pre-set to "parent of" relationship for a given node */
  const openAddParentOf = (node: UnitNode) => {
    setEditingNode(undefined);
    setPendingTemplateInput(undefined);
    setWrapTargetId(node.id);
    setAddParentId(null);
    setAddParentName(node.name);
    setDialogOpen(true);
  };

  const handleFormSubmit = async (
    input: Record<string, unknown>,
    relMode?: RelationshipMode
  ) => {
    if (editingNode) {
      await onUpdateUnit(editingNode.id, input);
      setSelectedNode(null);
      return;
    }
    if (relMode === "parent" && wrapTargetId) {
      // New unit should become the parent of the reference node
      await onWrapUnit(wrapTargetId, input);
    } else if (relMode === "sibling" && addParentId) {
      // Sibling: add at the parent of the reference node
      const grandparentId =
        allNodes.find((n) => n.children.some((c) => c.id === addParentId))
          ?.id ?? null;
      await onAddUnit(grandparentId, input);
    } else {
      // "child" (default) or root
      await onAddUnit(addParentId, input);
    }
  };

  const handleSelect = (node: UnitNode) => {
    // Store only the ID; the live node is derived from group.units above
    setSelectedNode(node);
    setDetailOpen(true);
  };
  const handleDelete = async (nodeId: string) => {
    // Note: the UnitListRow already shows inline confirmation before calling this
    await onRemoveUnit(nodeId);
    if (selectedNode?.id === nodeId) {
      setSelectedNode(null);
      setDetailOpen(false);
    }
  };
  const handleDrop = async (
    dragId: string,
    targetId: string | null,
    position: number
  ) => {
    await onReorderUnit(dragId, targetId, position);
  };
  const handleUpdateParentAssets = (
    parentUnitId: string,
    newAssets: UnitNode["assets"]
  ) => {
    if (onUpdateParentAssets) onUpdateParentAssets(parentUnitId, newAssets);
    else
      void onUpdateUnit(parentUnitId, {
        assetsJson: JSON.stringify(newAssets),
      });
  };

  function unitToNode(u: UnitNode): GroupTemplate["rootNodes"][0] {
    return {
      name: u.name,
      echelon: u.echelon,
      personnelCount: u.personnelCount,
      notes: u.notes,
      icon: u.symbol.icon,
      children: u.children.map(unitToNode),
    };
  }

  const handleSaveTemplate = async () => {
    if (!saveTemplateName.trim()) return;
    let rootNodes: GroupTemplate["rootNodes"];
    if (saveRootId === "all") {
      rootNodes = group.units.map(unitToNode);
    } else {
      const target = allNodes.find((u) => u.id === saveRootId);
      rootNodes = target ? [unitToNode(target)] : group.units.map(unitToNode);
    }
    await onSaveGroupTemplate({
      name: saveTemplateName.trim(),
      description: saveTemplateDesc.trim(),
      tags: [side.name.toLowerCase(), group.name.toLowerCase()],
      branch: group.branch,
      rootNodes,
    });
    setSaveTemplateOpen(false);
    setSaveTemplateName("");
    setSaveTemplateDesc("");
    setSaveRootId("all");
  };

  const openSaveTemplate = () => {
    setSaveRootId("all");
    setSaveTemplateName("");
    setSaveTemplateDesc("");
    setSaveTemplateOpen(true);
  };

  const isEmpty = group.units.length === 0;
  const unitTemplateOptions = unitTemplates.map((t) => ({
    id: t.id,
    name: `${ECHELON_LABELS[t.echelon]} — ${t.name}`,
    template: t,
  }));

  // Derive name placeholder for save-template modal
  const saveNamePlaceholder =
    saveRootId === "all"
      ? group.name
      : allNodes.find((u) => u.id === saveRootId)?.name ?? group.name;

  return (
    <div className="orbat-panel" style={{ position: "relative" }}>
      {/* ── Top toolbar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 12px",
          background: "var(--mil-bg-2)",
          borderBottom: "1px solid var(--mil-border)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <MilButton
          variant="ghost"
          icon="arrow-left"
          onClick={onClose}
          title="Back"
        />

        <div
          style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}
        >
          <span style={{ fontSize: 11, color: "var(--mil-text-2)" }}>
            {side.name}
          </span>
          <span style={{ fontSize: 11, color: "var(--mil-muted)" }}>/</span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--mil-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 200,
            }}
          >
            {group.name}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginLeft: 4,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 2,
              background: "var(--mil-cyan-dim)",
              color: "var(--mil-cyan-lt)",
              border: "1px solid rgba(34,168,192,0.35)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {totalPax.toLocaleString()} PAX
          </span>
          <span style={{ fontSize: 10, color: "var(--mil-text-2)" }}>
            {totalUnits} units
          </span>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", gap: 4 }}>
          <ViewBtn
            active={viewMode === "list"}
            onClick={() => setViewMode("list")}
          >
            ≡ List
          </ViewBtn>
          <ViewBtn
            active={viewMode === "tree"}
            onClick={() => setViewMode("tree")}
          >
            ⎇ Tree
          </ViewBtn>
          <ViewBtn
            active={viewMode === "card"}
            onClick={() => setViewMode("card")}
          >
            ⊞ Cards
          </ViewBtn>
          <ViewBtn
            active={viewMode === "layer"}
            onClick={() => setViewMode("layer")}
          >
            ⊛ Layer
          </ViewBtn>
          <ViewBtn
            active={viewMode === "validate"}
            onClick={() => setViewMode("validate")}
          >
            ✓ Validate
          </ViewBtn>
          <ViewBtn active={viewMode === "ai"} onClick={() => setViewMode("ai")}>
            ✦ AI
          </ViewBtn>
        </div>
        <MilButton variant="primary" icon="add" onClick={() => openAdd(null)}>
          Add Unit
        </MilButton>
      </div>

      {/* ── Template row ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          background: "var(--mil-bg)",
          borderBottom: "1px solid var(--mil-border)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: "var(--mil-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            flexShrink: 0,
          }}
        >
          Unit:
        </span>
        <TemplatePicker
          label="Unit template"
          options={unitTemplateOptions}
          buttonLabel="Add"
          buttonVariant="default"
          emptyText="No unit templates"
          onApply={(id) => {
            const tpl = unitTemplates.find((t) => t.id === id);
            if (tpl) openAddFromTemplate(null, tpl);
          }}
        />
        <div
          style={{
            width: 1,
            height: 16,
            background: "var(--mil-border-lt)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 10,
            color: "var(--mil-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            flexShrink: 0,
          }}
        >
          Group:
        </span>
        <TemplatePicker
          label="Group template"
          options={groupTemplates.map((g) => ({ id: g.id, name: g.name }))}
          buttonLabel="Apply"
          buttonVariant="primary"
          emptyText="No group templates"
          onApply={(id) => onApplyGroupTemplate(id)}
        />
        <div style={{ flex: 1 }} />
        <MilButton
          variant="ghost"
          icon="floppy-disk"
          onClick={openSaveTemplate}
          title="Save current group as template"
        >
          Save Template
        </MilButton>
        {groupTemplates.length > 0 && (
          <MilButton
            variant="ghost"
            icon="settings"
            iconOnly
            onClick={() => setManageTemplatesOpen(true)}
            title="Manage group templates"
          />
        )}
      </div>

      {/* ── Search bar + collapse/expand (list mode) ── */}
      {viewMode === "list" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            background: "var(--mil-bg)",
            borderBottom: "1px solid var(--mil-border)",
            flexShrink: 0,
          }}
        >
          <input
            className="mel-input"
            placeholder="Search units..."
            value={filters.text}
            onChange={(e) =>
              setFilters((f) => ({ ...f, text: e.target.value }))
            }
            style={{ flex: 1, padding: "4px 8px", fontSize: 11 }}
          />
          <span
            style={{
              fontSize: 10,
              color: "var(--mil-text-2)",
              whiteSpace: "nowrap",
            }}
          >
            {rows.length} / {totalUnits}
          </span>
          {allParentIdsInGroup.length > 0 && (
            <>
              <button
                onClick={expandAllList}
                title="Expand all units"
                style={{
                  background: allListExpanded ? "var(--mil-olive-mut)" : "none",
                  border: `1px solid ${
                    allListExpanded
                      ? "var(--mil-olive)"
                      : "var(--mil-border-lt)"
                  }`,
                  borderRadius: 2,
                  cursor: "pointer",
                  color: allListExpanded ? "#4ade80" : "var(--mil-muted)",
                  fontSize: 12,
                  padding: "3px 7px",
                  lineHeight: 1,
                }}
              >
                ⊞
              </button>
              <button
                onClick={collapseAllList}
                title="Collapse all units"
                style={{
                  background: !allListExpanded
                    ? "var(--mil-olive-mut)"
                    : "none",
                  border: `1px solid ${
                    !allListExpanded
                      ? "var(--mil-olive)"
                      : "var(--mil-border-lt)"
                  }`,
                  borderRadius: 2,
                  cursor: "pointer",
                  color: !allListExpanded ? "#4ade80" : "var(--mil-muted)",
                  fontSize: 12,
                  padding: "3px 7px",
                  lineHeight: 1,
                }}
              >
                ⊟
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Layer selector bar ── */}
      {viewMode === "layer" && (
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "6px 12px",
            background: "var(--mil-bg)",
            borderBottom: "1px solid var(--mil-border)",
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          {LAYERS.filter((l) => l.id !== "base").map((layer) => (
            <button
              key={layer.id}
              onClick={() => setActiveLayer(layer.id)}
              style={{
                padding: "4px 12px",
                borderRadius: 2,
                cursor: "pointer",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                background:
                  activeLayer === layer.id
                    ? `${layer.accentColor}22`
                    : "var(--mil-surface)",
                border: `1px solid ${
                  activeLayer === layer.id
                    ? layer.accentColor
                    : "var(--mil-border-lt)"
                }`,
                color:
                  activeLayer === layer.id
                    ? layer.accentColor
                    : "var(--mil-text-2)",
                transition: "all 0.1s",
              }}
            >
              {layer.icon} {layer.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Column headers (list) ── */}
      {viewMode === "list" && !isEmpty && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 90px 56px 60px 54px 110px",
            padding: "3px 12px",
            background: "var(--mil-bg-2)",
            borderBottom: "1px solid var(--mil-border)",
            flexShrink: 0,
            fontSize: 9,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--mil-muted)",
          }}
        >
          <span>Unit</span>
          <span style={{ textAlign: "center" }}>Echelon</span>
          <span style={{ textAlign: "center" }}>Pax</span>
          <span style={{ textAlign: "center" }}>Total</span>
          <span style={{ textAlign: "center" }}>CE</span>
          <span />
        </div>
      )}

      {/* ── Content ── */}
      <div
        className="orbat-panel__content"
        style={{ padding: 0, display: "flex", flexDirection: "column" }}
      >
        {isEmpty && (
          <div className="mil-empty">
            <div style={{ fontSize: 32, opacity: 0.25 }}>🌲</div>
            <div className="mil-empty__text">No units yet</div>
            <div
              style={{
                fontSize: 11,
                color: "var(--mil-muted)",
                maxWidth: 240,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              Pick a unit template above, apply a group template, or add a
              custom unit.
            </div>
            <MilButton
              variant="primary"
              icon="add"
              onClick={() => openAdd(null)}
            >
              Add Root Unit
            </MilButton>
          </div>
        )}

        {viewMode === "list" &&
          !isEmpty &&
          (rows.length === 0 ? (
            <div
              style={{
                padding: "24px 0",
                textAlign: "center",
                fontSize: 11,
                color: "var(--mil-muted)",
              }}
            >
              No units match.
            </div>
          ) : (
            rows.map(({ node, depth, hasChildren }) => (
              <UnitListRow
                key={node.id}
                node={node}
                side={side}
                depth={depth}
                hasChildren={hasChildren}
                collapsed={collapsed.has(node.id)}
                selected={selectedNode?.id === node.id}
                groupUnits={group.units}
                onUpdateUnit={(unitId, input) => onUpdateUnit(unitId, input)}
                onUpdateParentAssets={handleUpdateParentAssets}
                onSelect={() => handleSelect(node)}
                onToggleCollapse={() => toggleCollapse(node.id)}
                onAddChild={() => openAdd(node.id)}
                onAddParent={() => openAddParentOf(node)}
                onEdit={() => openEdit(node)}
                onDelete={() => handleDelete(node.id)}
                onDrop={handleDrop}
              />
            ))
          ))}

        {viewMode === "card" && !isEmpty && (
          <FormationCardView
            units={filtered}
            side={side}
            selectedId={selectedNode?.id ?? null}
            onSelect={handleSelect}
            onReorderUnit={onReorderUnit}
          />
        )}

        {viewMode === "tree" && !isEmpty && (
          <UnitTreeNode
            nodes={filtered}
            side={side}
            selectedId={selectedNode?.id ?? null}
            onSelect={handleSelect}
            onAddChild={openAdd}
            onAddParent={(nodeId) => {
              const target = allNodes.find((u) => u.id === nodeId);
              if (target) openAddParentOf(target);
            }}
            onEdit={openEdit}
            onDelete={handleDelete}
            onDrop={handleDrop}
            onUpdateUnit={(unitId, input) => onUpdateUnit(unitId, input)}
            onUpdateParentAssets={handleUpdateParentAssets}
          />
        )}

        {viewMode === "layer" && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            {/*
              The layer selector bar above sets `activeLayer` — this block
              renders the appropriate panel for that layer.  Previously this
              always rendered <FormationCardView/>, which made every layer
              look identical to the Cards view.

              Layer routing:
                • platforms  → PlatformsLayerPanel (hierarchy + flat platform list)
                • weapons    → WeaponsLayerPanel   (per-unit tree + summary table)
                • comms      → CommsLayer         (call-signs + radio + IFF table)
                • logistics  → LogisticsLayer     (fuel / ammo / range table)
                • (base is filtered out of the selector — the primary views
                  already show that data.)
            */}
            {activeLayer === "platforms" && (
              <PlatformsLayerPanel
                units={group.units}
                onSelectUnit={handleSelect}
              />
            )}
            {activeLayer === "weapons" && (
              <WeaponsLayerPanel units={group.units} />
            )}
            {activeLayer === "comms" && (
              <CommsLayerTable units={group.units} onSelect={handleSelect} />
            )}
            {activeLayer === "logistics" && (
              <LogisticsLayerTable
                units={group.units}
                onSelect={handleSelect}
              />
            )}
            {activeLayer === "base" && (
              // "base" is filtered out of the selector — kept as a safety
              // fallback so we don't render nothing if the state ever gets
              // into that mode via defaultLayer or hot reload.
              <FormationCardView
                units={group.units}
                side={side}
                selectedId={selectedNode?.id ?? null}
                onSelect={handleSelect}
                onReorderUnit={onReorderUnit}
              />
            )}
          </div>
        )}

        {viewMode === "ai" && (
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            <AiStructurePanel
              affiliation={side.standardIdentity}
              onAddUnit={onAddUnit}
              onReorderUnit={onReorderUnit}
              onUpdateUnit={async (unitId, input) => {
                await onUpdateUnit(unitId, input);
              }}
            />
          </div>
        )}

        {viewMode === "validate" && (
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            <OrbatValidationPanel
              units={group.units}
              affiliation={side.standardIdentity}
              onUpdateUnit={(unitId, patch) =>
                onUpdateUnit(unitId, patch as Record<string, unknown>)
              }
              onReorderUnit={onReorderUnit}
              onAddUnit={onAddUnit}
              projectName={
                // Workshop override takes precedence — this is what the
                // user sees in the "Project" meta line and what gets sent
                // as `projectName` to `cse_validate_orbat`.  Falling back
                // to the widget-derived side/group name preserves the
                // previous behaviour when Workshop hasn't bound anything.
                validationProjectName && validationProjectName.trim()
                  ? validationProjectName
                  : `${side.name} — ${group.name}`
              }
              validationPayload={validationPayload}
              onValidationCompleted={onValidationCompleted}
            />
          </div>
        )}
      </div>

      {/* ── Detail panel ── */}
      <UnitDetailPanel
        node={liveSelectedNode}
        side={side}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        onEdit={openEdit}
        onAddChild={openAdd}
        onAddParent={openAddParentOf}
        onDelete={handleDelete}
        groupUnits={group.units}
        onUpdateUnit={onUpdateUnit}
        onUpdateParentAssets={handleUpdateParentAssets}
        onSelectUnit={(u) => {
          setSelectedNode(u);
          setDetailOpen(true);
        }}
        parentNode={
          liveSelectedNode
            ? (() => {
                const parentId =
                  allNodes.find((u) =>
                    u.children.some((c) => c.id === liveSelectedNode.id)
                  )?.id ?? null;
                return parentId
                  ? allNodes.find((u) => u.id === parentId) ?? null
                  : null;
              })()
            : null
        }
      />

      {/* ── Add/Edit dialog ── */}
      <UnitFormDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleFormSubmit}
        existingNode={editingNode}
        templatePreFill={pendingTemplateInput}
        parentName={addParentName}
        defaultRelMode={wrapTargetId ? "parent" : "child"}
        side={side}
      />

      {/* ── Save Group Template modal ── */}
      {saveTemplateOpen && (
        <MilModal
          title="Save Group as Template"
          titleIcon="floppy-disk"
          onClose={() => setSaveTemplateOpen(false)}
          actions={[
            {
              label: "Cancel",
              variant: "default",
              onClick: () => setSaveTemplateOpen(false),
            },
            {
              label: "Save Template",
              variant: "primary",
              disabled: !saveTemplateName.trim(),
              onClick: handleSaveTemplate,
            },
          ]}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--mil-text-2)",
              marginBottom: 10,
              lineHeight: 1.5,
            }}
          >
            Choose the scope to save — the full group, or any specific unit
            sub-tree. Click a unit in the tree below to select it as the root of
            the template.
          </div>

          {/* Scope: full group */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setSaveRootId("all")}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSaveRootId("all");
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 2,
              cursor: "pointer",
              marginBottom: 6,
              background:
                saveRootId === "all"
                  ? "var(--mil-olive-mut)"
                  : "var(--mil-bg-2)",
              border: `1px solid ${
                saveRootId === "all" ? "var(--mil-olive)" : "var(--mil-border)"
              }`,
              transition: "background 0.1s",
            }}
          >
            <span style={{ fontSize: 16 }}>🌐</span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color:
                    saveRootId === "all"
                      ? "var(--mil-olive-lt)"
                      : "var(--mil-text)",
                }}
              >
                Full group — {group.name}
              </div>
              <div style={{ fontSize: 10, color: "var(--mil-muted)" }}>
                {totalUnits} units · {totalPax.toLocaleString()} pax
              </div>
            </div>
            {saveRootId === "all" && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 2,
                  background: "var(--mil-olive)",
                  color: "#fff",
                }}
              >
                SELECTED
              </span>
            )}
          </div>

          {/* Unit tree picker */}
          {group.units.length > 0 && (
            <MilFormGroup label="Or select a sub-hierarchy root:">
              <div
                style={{
                  maxHeight: 200,
                  overflowY: "auto",
                  background: "var(--mil-bg)",
                  border: "1px solid var(--mil-border)",
                  borderRadius: 2,
                  padding: "4px",
                }}
              >
                {group.units.map((u) => (
                  <SaveTreeNode
                    key={u.id}
                    node={u}
                    depth={0}
                    selectedId={saveRootId === "all" ? null : saveRootId}
                    onSelect={(id) => setSaveRootId(id)}
                  />
                ))}
              </div>
            </MilFormGroup>
          )}

          <MilFormGroup label="Template Name">
            <MilTextInput
              value={saveTemplateName}
              onChange={setSaveTemplateName}
              placeholder={saveNamePlaceholder}
            />
          </MilFormGroup>

          <MilFormGroup label="Description">
            <MilTextArea
              value={saveTemplateDesc}
              onChange={setSaveTemplateDesc}
              placeholder="e.g. 'Full UIB with 3 rifle companies + support'"
              rows={2}
            />
          </MilFormGroup>
        </MilModal>
      )}

      {/* ── Manage Group Templates modal ── */}
      {manageTemplatesOpen && (
        <MilModal
          title="Manage Group Templates"
          titleIcon="application"
          onClose={() => setManageTemplatesOpen(false)}
          actions={[
            {
              label: "Close",
              variant: "default",
              onClick: () => setManageTemplatesOpen(false),
            },
          ]}
        >
          {groupTemplates.map((gt) => (
            <div
              key={gt.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                marginBottom: 6,
                background: "var(--mil-bg-2)",
                border: "1px solid var(--mil-border)",
                borderRadius: 2,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--mil-text)",
                  }}
                >
                  {gt.name}
                </div>
                {gt.description && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--mil-text-2)",
                      marginTop: 1,
                    }}
                  >
                    {gt.description}
                  </div>
                )}
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--mil-muted)",
                    marginTop: 2,
                  }}
                >
                  {gt.rootNodes.length} root unit
                  {gt.rootNodes.length !== 1 ? "s" : ""} · {gt.branch}
                </div>
              </div>
              <MilButton
                variant="danger"
                icon="trash"
                iconOnly
                onClick={() => {
                  if (confirm(`Delete template "${gt.name}"?`))
                    onDeleteGroupTemplate(gt.id);
                }}
                title="Delete template"
              />
            </div>
          ))}
        </MilModal>
      )}
    </div>
  );
};
