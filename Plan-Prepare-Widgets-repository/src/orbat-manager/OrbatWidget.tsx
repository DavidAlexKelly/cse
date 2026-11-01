// ============================================================
//  ORBAT Manager — Root Widget Component
// ============================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import type OrbatConfig from "./orbatManager.config.js";
import "../shared/styling/index.css";
import "./military.css";
import { useOrbatStore } from "./useOrbatStore.js";
import { countPersonnel } from "./treeUtils.js";
import { serialiseOrbatForValidation } from "./cseValidateSerialise.js";
import type { UnitNode, Side } from "./types.js";
import { SidesPanel } from "./SidesPanel.js";
import { GroupBuilderPanel } from "./GroupBuilderPanel.js";
import { TemplatesPanel } from "./TemplatesPanel.js";
import { ForceSummaryPanel } from "./ForceSummaryPanel.js";
import { EchelonHierarchyChart } from "./EchelonHierarchyChart.js";
import { GraphQLConsole } from "./GraphQLConsole.js";
import { UnitDetailPanel } from "./UnitDetailPanel.js";
import { UnitFormDialog } from "./UnitFormDialog.js";
import { FoundryImportPanel } from "./FoundryImportPanel.js";
import { EquipmentTypeContext } from "./equipmentTypeContext.js";
import { useEquipmentTypesLoader } from "./useEquipmentTypesLoader.js";

type Tab = "sides" | "templates" | "summary" | "foundry" | "ref" | "gql";

const TABS: { id: Tab; label: string }[] = [
  { id: "sides", label: "SIDES" },
  { id: "templates", label: "TEMPLATES" },
  { id: "summary", label: "SUMMARY" },
  { id: "foundry", label: "FOUNDRY" },
  { id: "ref", label: "REF" },
  { id: "gql", label: "GQL" },
];

const useWidgetContext =
  useFoundryWidgetContext.withTypes<typeof OrbatConfig>();

export const OrbatWidget: React.FC = () => {
  const { emitEvent, parameters } = useWidgetContext();
  const { state, runQuery, resetStore } = useOrbatStore();

  // ── CSE validation plumbing ──────────────────────────────────────────
  //   selectedOperationKey     — widget writes it whenever the user
  //     imports an operation from Foundry, via
  //     emitEvent("onOperationSelected", …).
  //   validationPayload        — Workshop→widget: `orbatContent` arg to
  //     `cse_validate_orbat`; used verbatim when non-empty.
  //   validationProjectName    — Workshop→widget: `projectName` arg to
  //     `cse_validate_orbat`; overrides the widget's own default when set.
  const validationPayload = parameters.values.validationPayload ?? "";
  const validationProjectName = parameters.values.validationProjectName ?? "";

  // ── Ontology equipment-type catalogue ────────────────────────────────
  // Loaded once at widget mount so the picker in UnitFormDialog and the
  // display in UnitDetailPanel work everywhere (edit dialog, summary
  // panel, imported sides). Kept alive for the widget lifetime; the
  // Foundry Import panel refreshes independently.
  const equipmentTypes = useEquipmentTypesLoader();
  const equipmentCtx = useMemo(
    () => ({
      types: equipmentTypes.types,
      loading: equipmentTypes.loading,
      error: equipmentTypes.error,
    }),
    [equipmentTypes.types, equipmentTypes.loading, equipmentTypes.error]
  );

  // Keep a ref to the latest state so callbacks can access it without
  // becoming stale or needing to re-declare on every state change.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [activeTab, setActiveTab] = useState<Tab>("sides");

  // Builder state: which group is open in the builder
  const [builderSideId, setBuilderSideId] = useState<string | null>(null);
  const [builderGroupId, setBuilderGroupId] = useState<string | null>(null);

  // Summary detail state — derive live unit from state so changes are always visible
  const [summarySelectedUnitId, setSummarySelectedUnitId] = useState<
    string | null
  >(null);
  const [summarySelectedSideId, setSummarySelectedSideId] = useState<
    string | null
  >(null);
  const [summaryDetailOpen, setSummaryDetailOpen] = useState(false);
  const [summaryEditOpen, setSummaryEditOpen] = useState(false);

  // Always resolve the live unit/side from current state
  const summarySelectedSide =
    state.sides.find((s) => s.id === summarySelectedSideId) ?? null;
  const summarySelectedUnit = summarySelectedSide
    ? summarySelectedSide.groups
        .flatMap((g) => {
          const flat: UnitNode[] = [];
          const q = [...g.units];
          while (q.length) {
            const n = q.shift()!;
            flat.push(n);
            q.push(...n.children);
          }
          return flat;
        })
        .find((u) => u.id === summarySelectedUnitId) ?? null
    : null;

  // Derived totals for navbar
  const totalPax = useMemo(
    () =>
      state.sides.reduce(
        (a, s) => a + s.groups.reduce((b, g) => b + countPersonnel(g.units), 0),
        0
      ),
    [state.sides]
  );

  // Emit event when sides change
  useEffect(() => {
    if (state.sides.length > 0) {
      emitEvent("onArmyUpdated", {
        parameterUpdates: {
          activeArmyName: state.sides[0].name,
          totalPersonnel: totalPax,
          lastUpdated: new Date().toISOString(),
        },
      });
    }
  }, [state.sides, totalPax, emitEvent]);

  // ── Live SWORD ORBAT JSON export ─────────────────────────────────────
  //   Debounced serialise of (side[0]/group[0]) → SWORD envelope → emit as
  //   `onOrbatChanged` with `currentOrbatJson`.  Workshop can bind
  //   `currentOrbatJson` OUT to a variable and pipe it through any
  //   function that expects an ORBAT (validation, persistence, …).
  //
  //   Debounce is trailing-edge only — mutations often arrive in bursts
  //   (add unit → auto-fix → reorder).  400 ms feels responsive without
  //   spamming the host on every keystroke of a name field.
  //
  //   We use side[0]/group[0] to mirror the same tree the builder shows.
  //   For a multi-group future we can add per-group emission.
  const lastEmittedRef = useRef<string>("");
  useEffect(() => {
    const side = state.sides[0];
    const group = side?.groups[0];
    if (!side || !group) return;
    const t = setTimeout(() => {
      try {
        const envelope = serialiseOrbatForValidation(group.units, {
          title: `${side.name} — ${group.name}`,
        });
        const json = JSON.stringify(envelope);
        if (json === lastEmittedRef.current) return;
        lastEmittedRef.current = json;
        emitEvent("onOrbatChanged", {
          parameterUpdates: { currentOrbatJson: json },
        });
      } catch (e) {
        console.warn("[Orbat] failed to serialise for onOrbatChanged", e);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [state.sides, emitEvent]);

  // ---- Mutation helpers ----

  const openBuilder = (sideId: string, groupId: string) => {
    setBuilderSideId(sideId);
    setBuilderGroupId(groupId);
  };
  const closeBuilder = () => {
    setBuilderSideId(null);
    setBuilderGroupId(null);
  };

  const builderSide = state.sides.find((s) => s.id === builderSideId);
  const builderGroup = builderSide?.groups.find((g) => g.id === builderGroupId);
  const showBuilder = !!(builderSide && builderGroup);

  // Sides
  const handleCreateSide = useCallback(
    async (input: Record<string, string>) => {
      await runQuery(
        `mutation CreateSide($input: CreateSideInput!) { createSide(input: $input) { id } }`,
        { input }
      );
    },
    [runQuery]
  );
  const handleUpdateSide = useCallback(
    async (id: string, input: Record<string, string>) => {
      await runQuery(
        `mutation UpdateSide($id: ID!, $input: UpdateSideInput!) { updateSide(id: $id, input: $input) { id } }`,
        { id, input }
      );
    },
    [runQuery]
  );
  const handleDeleteSide = useCallback(
    async (id: string) => {
      await runQuery(`mutation DeleteSide($id: ID!) { deleteSide(id: $id) }`, {
        id,
      });
      if (builderSideId === id) closeBuilder();
    },
    [runQuery, builderSideId]
  );
  // Groups
  const handleCreateGroup = useCallback(
    async (sideId: string, input: Record<string, string>) => {
      await runQuery(
        `mutation CreateGroup($sideId: ID!, $input: CreateGroupInput!) { createGroup(sideId: $sideId, input: $input) { id } }`,
        { sideId, input }
      );
    },
    [runQuery]
  );
  const handleDeleteGroup = useCallback(
    async (sideId: string, groupId: string) => {
      await runQuery(
        `mutation DeleteGroup($sideId: ID!, $groupId: ID!) { deleteGroup(sideId: $sideId, groupId: $groupId) }`,
        { sideId, groupId }
      );
      if (builderGroupId === groupId) closeBuilder();
    },
    [runQuery, builderGroupId]
  );
  // Units
  //
  //  IMPORTANT: this handler must RETURN the newly created UnitNode (or at
  //  minimum an object with an `id` field).  The AI Structure builder and the
  //  ChildGenerationPanel both rely on the returned id to map their temporary
  //  BFS tempId → real store id, so that subsequent children of this node can
  //  be attached with the correct parentUnitId.  If we don't return anything
  //  every child is inserted with `parentUnitId = null` and the whole
  //  hierarchy collapses to a flat list of siblings at the root — which is
  //  exactly what caused the "AI just makes disconnected units" bug.
  const handleAddUnit = useCallback(
    async (parentId: string | null, input: Record<string, unknown>) => {
      if (!builderSideId || !builderGroupId) return null;
      const res = await runQuery(
        `mutation AddUnit($sideId: ID!, $groupId: ID!, $parentUnitId: ID, $input: UnitInput!) { addUnit(sideId: $sideId, groupId: $groupId, parentUnitId: $parentUnitId, input: $input) { id } }`,
        {
          sideId: builderSideId,
          groupId: builderGroupId,
          parentUnitId: parentId ?? undefined,
          input,
        }
      );
      // executeQuery wraps the resolver's return value as `{ data: { addUnit: <node> } }`
      const created = (res?.data as Record<string, unknown> | null | undefined)
        ?.addUnit;
      return created ?? null;
    },
    [runQuery, builderSideId, builderGroupId]
  );

  /** Insert a new unit as the parent of an existing one (wraps target under the new node). */
  const handleWrapUnit = useCallback(
    async (targetUnitId: string, input: Record<string, unknown>) => {
      if (!builderSideId || !builderGroupId) return;
      await runQuery(
        `mutation WrapUnit($sideId: ID!, $groupId: ID!, $targetUnitId: ID!, $input: UnitInput!) { wrapUnit(sideId: $sideId, groupId: $groupId, targetUnitId: $targetUnitId, input: $input) { id } }`,
        { sideId: builderSideId, groupId: builderGroupId, targetUnitId, input }
      );
    },
    [runQuery, builderSideId, builderGroupId]
  );

  /**
   * Universal updateUnit — works from both the builder and the summary panel.
   * Finds the sideId/groupId from current state if not already known.
   */
  const handleUpdateUnit = useCallback(
    async (unitId: string, input: Record<string, unknown>) => {
      // If we have a builder context, use it directly (fast path)
      if (builderSideId && builderGroupId) {
        await runQuery(
          `mutation UpdateUnit($sideId: ID!, $groupId: ID!, $unitId: ID!, $input: UnitInput!) { updateUnit(sideId: $sideId, groupId: $groupId, unitId: $unitId, input: $input) { id } }`,
          { sideId: builderSideId, groupId: builderGroupId, unitId, input }
        );
        return;
      }
      // Fallback: scan all sides/groups to find which one owns this unit
      for (const side of stateRef.current.sides) {
        for (const group of side.groups) {
          const q = [...group.units];
          while (q.length) {
            const n = q.shift()!;
            if (n.id === unitId) {
              await runQuery(
                `mutation UpdateUnit($sideId: ID!, $groupId: ID!, $unitId: ID!, $input: UnitInput!) { updateUnit(sideId: $sideId, groupId: $groupId, unitId: $unitId, input: $input) { id } }`,
                { sideId: side.id, groupId: group.id, unitId, input }
              );
              return;
            }
            q.push(...n.children);
          }
        }
      }
    },
    [runQuery, builderSideId, builderGroupId]
  );

  /**
   * Universal updateParentAssets — works from both the builder and the summary panel.
   */
  const handleUpdateParentAssets = useCallback(
    async (parentUnitId: string, newAssets: UnitNode["assets"]) => {
      await handleUpdateUnit(parentUnitId, {
        assetsJson: JSON.stringify(newAssets),
      });
    },
    [handleUpdateUnit]
  );

  const handleRemoveUnit = useCallback(
    async (unitId: string) => {
      // Fast path: inside the builder
      if (builderSideId && builderGroupId) {
        await runQuery(
          `mutation RemoveUnit($sideId: ID!, $groupId: ID!, $unitId: ID!) { removeUnit(sideId: $sideId, groupId: $groupId, unitId: $unitId) }`,
          { sideId: builderSideId, groupId: builderGroupId, unitId }
        );
        return;
      }
      // Fallback: scan all sides/groups (used from Summary panel and detail overlay)
      for (const side of stateRef.current.sides) {
        for (const group of side.groups) {
          const q = [...group.units];
          while (q.length) {
            const n = q.shift()!;
            if (n.id === unitId) {
              await runQuery(
                `mutation RemoveUnit($sideId: ID!, $groupId: ID!, $unitId: ID!) { removeUnit(sideId: $sideId, groupId: $groupId, unitId: $unitId) }`,
                { sideId: side.id, groupId: group.id, unitId }
              );
              return;
            }
            q.push(...n.children);
          }
        }
      }
    },
    [runQuery, builderSideId, builderGroupId]
  );

  const handleReorderUnit = useCallback(
    async (unitId: string, newParentId: string | null, position: number) => {
      if (!builderSideId || !builderGroupId) return;
      await runQuery(
        `mutation ReorderUnit($sideId: ID!, $groupId: ID!, $unitId: ID!, $newParentId: ID, $position: Int!) { reorderUnit(sideId: $sideId, groupId: $groupId, unitId: $unitId, newParentId: $newParentId, position: $position) }`,
        {
          sideId: builderSideId,
          groupId: builderGroupId,
          unitId,
          newParentId: newParentId ?? undefined,
          position,
        }
      );
    },
    [runQuery, builderSideId, builderGroupId]
  );

  // Import a fully-built Side from the OSDK data layer
  const handleImportSide = useCallback(
    async (side: Side) => {
      await runQuery(
        `mutation ImportSide($side: SideInput!) { importSide(side: $side) { id } }`,
        { side }
      );
    },
    [runQuery]
  );

  // Templates
  const handleCreateTemplate = useCallback(
    async (input: Record<string, unknown>) => {
      await runQuery(
        `mutation CreateTemplate($input: CreateTemplateInput!) { createTemplate(input: $input) { id } }`,
        { input }
      );
    },
    [runQuery]
  );
  const handleUpdateTemplate = useCallback(
    async (id: string, input: Record<string, unknown>) => {
      await runQuery(
        `mutation UpdateTemplate($id: ID!, $input: UpdateTemplateInput!) { updateTemplate(id: $id, input: $input) { id } }`,
        { id, input }
      );
    },
    [runQuery]
  );
  const handleDeleteTemplate = useCallback(
    async (id: string) => {
      await runQuery(
        `mutation DeleteTemplate($id: ID!) { deleteTemplate(id: $id) }`,
        { id }
      );
    },
    [runQuery]
  );
  const handleApplyGroupTemplate = useCallback(
    async (sideId: string, groupId: string, templateId: string) => {
      await runQuery(
        `mutation ApplyTemplate($sideId: ID!, $groupId: ID!, $templateId: ID!) { applyGroupTemplate(sideId: $sideId, groupId: $groupId, templateId: $templateId) }`,
        { sideId, groupId, templateId }
      );
    },
    [runQuery]
  );
  const handleSaveGroupTemplate = useCallback(
    async (input: Record<string, unknown>) => {
      await runQuery(
        `mutation SaveGroupTemplate($input: SaveGroupTemplateInput!) { saveGroupTemplate(input: $input) { id } }`,
        { input }
      );
    },
    [runQuery]
  );
  const handleDeleteGroupTemplate = useCallback(
    async (id: string) => {
      await runQuery(
        `mutation DeleteGroupTemplate($id: ID!) { deleteGroupTemplate(id: $id) }`,
        { id }
      );
    },
    [runQuery]
  );

  return (
    <EquipmentTypeContext.Provider value={equipmentCtx}>
      <div className="orbat-widget bp5-dark">
        {/* ── Top tab bar — uses shared mil-header background / border ── */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            flexShrink: 0,
            background: "var(--mil-navy)",
            borderBottom: "1px solid var(--mil-border-dk)",
          }}
        >
          {/* Widget identity mark */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 14px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "var(--mil-olive-lt)",
              textTransform: "uppercase",
              borderRight: "1px solid var(--mil-border-dk)",
              flexShrink: 0,
            }}
          >
            ⬡ ORBAT
          </div>

          {/* Navigation tabs */}
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                closeBuilder();
              }}
              style={{
                padding: "10px 14px",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color:
                  activeTab === tab.id
                    ? "var(--mil-cyan-lt)"
                    : "var(--mil-text-2)",
                borderBottom:
                  activeTab === tab.id
                    ? "2px solid var(--mil-cyan)"
                    : "2px solid transparent",
                transition: "color 0.12s, border-color 0.12s",
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
            </button>
          ))}

          {/* Spacer + stats */}
          <div style={{ flex: 1 }} />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 12px",
              fontSize: 10,
              color: "var(--mil-text-2)",
              letterSpacing: "0.06em",
            }}
          >
            <span>
              <span
                style={{
                  color: "var(--mil-cyan-lt)",
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {totalPax.toLocaleString()}
              </span>{" "}
              PAX
            </span>
            <span style={{ color: "var(--mil-border-lt)" }}>|</span>
            <span>
              <span style={{ color: "var(--mil-text-2)", fontWeight: 700 }}>
                {state.sides.length}
              </span>{" "}
              SIDES
            </span>
          </div>

          {/* Reset / Settings */}
          <button
            onClick={() => {
              if (confirm("Reset all ORBAT data?")) resetStore();
            }}
            title="Reset ORBAT data"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--mil-muted)",
              padding: "0 12px",
              fontSize: 14,
              borderLeft: "1px solid var(--mil-border-dk)",
              transition: "color 0.12s",
            }}
          >
            ⚙
          </button>
        </div>

        {/* ── Body ── */}
        <div className="orbat-body">
          {/* Left panel (or full width when no builder) */}
          <div className={`orbat-left ${showBuilder ? "" : "full-width"}`}>
            {activeTab === "sides" && (
              <SidesPanel
                sides={state.sides}
                onBuildGroup={openBuilder}
                onCreateSide={handleCreateSide}
                onUpdateSide={handleUpdateSide}
                onDeleteSide={handleDeleteSide}
                onCreateGroup={handleCreateGroup}
                onDeleteGroup={handleDeleteGroup}
                onApplyGroupTemplate={handleApplyGroupTemplate}
                groupTemplates={state.groupTemplates}
              />
            )}
            {activeTab === "templates" && (
              <TemplatesPanel
                templates={state.templates}
                groupTemplates={state.groupTemplates}
                onCreateTemplate={handleCreateTemplate}
                onUpdateTemplate={handleUpdateTemplate}
                onDeleteTemplate={handleDeleteTemplate}
                onDeleteGroupTemplate={handleDeleteGroupTemplate}
              />
            )}
            {activeTab === "summary" && (
              <ForceSummaryPanel
                sides={state.sides}
                onSelectUnit={(unit, side) => {
                  setSummarySelectedUnitId(unit.id);
                  setSummarySelectedSideId(side.id);
                  setSummaryDetailOpen(true);
                }}
              />
            )}
            {activeTab === "foundry" && (
              <FoundryImportPanel
                onImportSide={handleImportSide}
                onImportTemplate={handleCreateTemplate}
                onOperationSelected={(operationKey) => {
                  // Publish the freshly-imported operation key out to
                  // Workshop so the workshop-side helper can build a
                  // validation payload.  We fire the event synchronously
                  // after the widget-store insert has resolved so the
                  // ordering is: (1) tree visible, (2) operation key
                  // emitted, (3) Workshop triggers helper, (4) payload
                  // arrives back via the `validationPayload` parameter.
                  emitEvent("onOperationSelected", {
                    parameterUpdates: { selectedOperationKey: operationKey },
                  });
                }}
              />
            )}
            {activeTab === "ref" && <EchelonHierarchyChart />}
            {activeTab === "gql" && <GraphQLConsole onQuery={runQuery} />}
          </div>

          {/* Centre: Group Builder (visible when a group is selected) */}
          {showBuilder && builderSide && builderGroup && (
            <div className="orbat-center">
              <GroupBuilderPanel
                group={builderGroup}
                side={builderSide}
                unitTemplates={state.templates}
                groupTemplates={state.groupTemplates}
                onClose={closeBuilder}
                onAddUnit={handleAddUnit}
                onWrapUnit={handleWrapUnit}
                onUpdateUnit={handleUpdateUnit}
                onRemoveUnit={handleRemoveUnit}
                onReorderUnit={handleReorderUnit}
                onApplyGroupTemplate={(id) =>
                  handleApplyGroupTemplate(builderSideId!, builderGroupId!, id)
                }
                onSaveGroupTemplate={handleSaveGroupTemplate}
                onDeleteGroupTemplate={handleDeleteGroupTemplate}
                onUpdateParentAssets={handleUpdateParentAssets}
                validationPayload={validationPayload}
                validationProjectName={validationProjectName}
                onValidationCompleted={(raw) => {
                  emitEvent("onValidationCompleted", {
                    parameterUpdates: { validationResult: raw },
                  });
                }}
              />
            </div>
          )}
        </div>

        {/* Summary unit detail overlay — node is derived live from state so platforms/weapons are always current */}
        {summarySelectedSide && (
          <UnitDetailPanel
            node={summarySelectedUnit}
            side={summarySelectedSide}
            isOpen={summaryDetailOpen}
            onClose={() => setSummaryDetailOpen(false)}
            onEdit={(node) => {
              setSummaryEditOpen(true);
              setSummarySelectedUnitId(node.id);
            }}
            onAddChild={() => {
              /* summary panel: add via builder only */
            }}
            onDelete={async (nodeId) => {
              if (confirm("Delete this unit and all its sub-units?")) {
                await handleRemoveUnit(nodeId);
                setSummaryDetailOpen(false);
                setSummarySelectedUnitId(null);
              }
            }}
            groupUnits={summarySelectedSide.groups.flatMap((g) => g.units)}
            onUpdateUnit={async (unitId, input) => {
              await handleUpdateUnit(unitId, input);
            }}
            onUpdateParentAssets={(parentId, assets) => {
              void handleUpdateParentAssets(parentId, assets);
            }}
          />
        )}

        {summarySelectedUnit &&
          summarySelectedSide &&
          summaryEditOpen &&
          (() => {
            const side = summarySelectedSide;
            const group = side.groups.find((g) => {
              const q = [...g.units];
              while (q.length) {
                const n = q.shift()!;
                if (n.id === summarySelectedUnit.id) return true;
                q.push(...n.children);
              }
              return false;
            });
            if (!group) return null;
            return (
              <UnitFormDialog
                isOpen={summaryEditOpen}
                onClose={() => setSummaryEditOpen(false)}
                onSubmit={async (input) => {
                  await handleUpdateUnit(summarySelectedUnit.id, input);
                  setSummaryEditOpen(false);
                }}
                existingNode={summarySelectedUnit}
                side={side}
              />
            );
          })()}
      </div>
    </EquipmentTypeContext.Provider>
  );
};
