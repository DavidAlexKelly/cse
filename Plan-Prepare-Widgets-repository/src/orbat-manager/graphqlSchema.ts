// ============================================================
//  In-Memory "GraphQL-like" Schema + Resolvers
//  (Pure in-memory; no external graphql package dependency)
// ============================================================

import type {
  StoreState,
  Side,
  UnitGroup,
  UnitNode,
  UnitTemplate,
  GroupTemplate,
  GroupTemplateNode,
  CommandRelationshipType,
  EquipmentTypeRef,
} from "./types.js";
import {
  flattenTree,
  removeNode,
  upsertNode,
  findParentId,
  countPersonnel,
  countUnits,
} from "./treeUtils.js";

// ---- Simple GQL-compatible response type ----
export interface GqlResult {
  data?: Record<string, unknown> | null;
  errors?: { message: string }[];
}

// ---- Utility ----
function uid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function computeTotals(group: UnitGroup) {
  return {
    ...group,
    totalPersonnel: countPersonnel(group.units),
    totalUnits: countUnits(group.units),
  };
}

function computeSideTotals(side: Side) {
  return {
    ...side,
    totalPersonnel: side.groups.reduce(
      (acc, g) => acc + countPersonnel(g.units),
      0
    ),
    groups: side.groups.map(computeTotals),
  };
}

function inputToNode(
  input: Record<string, unknown>,
  standardIdentity: Side["standardIdentity"],
  existingNode?: UnitNode
): UnitNode {
  const weapons = input.weaponsJson
    ? JSON.parse(input.weaponsJson as string)
    : existingNode?.weapons ?? [];
  const assets = input.assetsJson
    ? JSON.parse(input.assetsJson as string)
    : existingNode?.assets ?? [];

  const capabilities = {
    ...(existingNode?.capabilities ?? {}),
    ...((input.capabilities as Record<string, unknown>) ?? {}),
  };

  const customProperties = input.customPropertiesJson
    ? JSON.parse(input.customPropertiesJson as string)
    : existingNode?.customProperties ?? [];

  return {
    id: existingNode?.id ?? uid(),
    name: (input.name as string) ?? existingNode?.name ?? "Unit",
    echelon:
      (input.echelon as UnitNode["echelon"]) ??
      existingNode?.echelon ??
      "squad",
    personnelCount:
      (input.personnelCount as number) ?? existingNode?.personnelCount ?? 0,
    notes: (input.notes as string) ?? existingNode?.notes ?? "",
    commandRelationshipType:
      (input.commandRelationshipType as CommandRelationshipType | undefined) ??
      existingNode?.commandRelationshipType,
    symbol: {
      standardIdentity,
      echelon:
        (input.echelon as UnitNode["echelon"]) ??
        existingNode?.echelon ??
        "squad",
      icon:
        (input.symbolIcon as UnitNode["symbol"]["icon"]) ??
        existingNode?.symbol.icon ??
        "infantry",
      sector1:
        (input.sector1 as UnitNode["symbol"]["sector1"]) ??
        existingNode?.symbol.sector1,
      sector2:
        (input.sector2 as UnitNode["symbol"]["sector2"]) ??
        existingNode?.symbol.sector2,
      hqIndicator:
        (input.hqIndicator as UnitNode["symbol"]["hqIndicator"]) ??
        existingNode?.symbol.hqIndicator,
      reinforced:
        (input.reinforced as UnitNode["symbol"]["reinforced"]) ??
        existingNode?.symbol.reinforced,
      status:
        (input.symbolStatus as UnitNode["symbol"]["status"]) ??
        existingNode?.symbol.status,
    },
    capabilities,
    customProperties,
    state: existingNode?.state ?? { status: "active", lastUpdated: now() },
    weapons,
    assets,
    equipment: existingNode?.equipment ?? [],
    children: existingNode?.children ?? [],
    // ── Equipment Type (ontology-linked) ───────────────────────────────
    // Input may supply either:
    //   • equipmentType — a full EquipmentTypeRef { key, nomenclature, description? }
    //   • equipmentTypeKey — a bare primary key (then we look up the label
    //     from the existing node's ref or fall back to the key itself)
    // An explicit `null` clears the reference.
    equipmentType: (() => {
      if (input.equipmentType === null) return undefined;
      if (input.equipmentType && typeof input.equipmentType === "object") {
        return input.equipmentType as EquipmentTypeRef;
      }
      if (typeof input.equipmentTypeKey === "string") {
        const key = input.equipmentTypeKey;
        if (!key) return undefined;
        // Preserve existing name if we only got a key
        if (existingNode?.equipmentType?.key === key) {
          return existingNode.equipmentType;
        }
        return { key, nomenclature: key };
      }
      return existingNode?.equipmentType;
    })(),
  };
}

// ---- Resolver map ----
type Resolver = (
  args: Record<string, unknown>,
  state: StoreState,
  setState: (s: StoreState) => void
) => unknown;

const RESOLVERS: Record<string, Resolver> = {
  // --- Queries ---
  sides: (_args, state) => state.sides.map(computeSideTotals),
  side: ({ id }, state) => {
    const s = state.sides.find((x) => x.id === id);
    return s ? computeSideTotals(s) : null;
  },
  templates: (_args, state) => state.templates,
  template: ({ id }, state) => state.templates.find((t) => t.id === id) ?? null,
  groupTemplates: (_args, state) => state.groupTemplates,
  groupTemplate: ({ id }, state) =>
    state.groupTemplates.find((g) => g.id === id) ?? null,

  // --- Side mutations ---
  createSide: ({ input }, state, setState) => {
    const i = input as Record<string, string>;
    const newSide: Side = {
      id: uid(),
      name: i.name,
      standardIdentity:
        (i.standardIdentity as Side["standardIdentity"]) ?? "friend",
      colour: i.colour ?? "#3F7FBF",
      description: i.description ?? "",
      groups: [],
      createdAt: now(),
      updatedAt: now(),
    };
    setState({ ...state, sides: [...state.sides, newSide] });
    return computeSideTotals(newSide);
  },
  updateSide: ({ id, input }, state, setState) => {
    const i = input as Record<string, string>;
    const updated = state.sides.map((s) =>
      s.id === id ? { ...s, ...i, updatedAt: now() } : s
    );
    setState({ ...state, sides: updated });
    return computeSideTotals(updated.find((s) => s.id === id)!);
  },
  deleteSide: ({ id }, state, setState) => {
    setState({ ...state, sides: state.sides.filter((s) => s.id !== id) });
    return true;
  },

  // --- Group mutations ---
  createGroup: ({ sideId, input }, state, setState) => {
    const i = input as Record<string, string>;
    const newGroup: UnitGroup = {
      id: uid(),
      name: i.name,
      branch: (i.branch as UnitGroup["branch"]) ?? "army",
      description: i.description ?? "",
      units: [],
    };
    const updated = state.sides.map((s) =>
      s.id === sideId
        ? { ...s, groups: [...s.groups, newGroup], updatedAt: now() }
        : s
    );
    setState({ ...state, sides: updated });
    return computeTotals(newGroup);
  },
  updateGroup: ({ sideId, groupId, input }, state, setState) => {
    const i = input as Record<string, string>;
    const updated = state.sides.map((s) =>
      s.id !== sideId
        ? s
        : {
            ...s,
            updatedAt: now(),
            groups: s.groups.map((g) =>
              g.id !== groupId ? g : { ...g, ...i }
            ),
          }
    );
    setState({ ...state, sides: updated });
    return (
      updated
        .find((s) => s.id === sideId)
        ?.groups.find((g) => g.id === groupId) ?? null
    );
  },
  deleteGroup: ({ sideId, groupId }, state, setState) => {
    const updated = state.sides.map((s) =>
      s.id === sideId
        ? {
            ...s,
            groups: s.groups.filter((g) => g.id !== groupId),
            updatedAt: now(),
          }
        : s
    );
    setState({ ...state, sides: updated });
    return true;
  },

  // --- Unit mutations ---
  addUnit: ({ sideId, groupId, parentUnitId, input }, state, setState) => {
    const i = input as Record<string, unknown>;
    const side = state.sides.find((s) => s.id === sideId)!;
    const newNode = inputToNode(i, side.standardIdentity);
    const updated = state.sides.map((s) =>
      s.id !== sideId
        ? s
        : {
            ...s,
            updatedAt: now(),
            groups: s.groups.map((g) =>
              g.id !== groupId
                ? g
                : {
                    ...g,
                    units: upsertNode(
                      g.units,
                      newNode,
                      (parentUnitId as string | null) ?? null
                    ),
                  }
            ),
          }
    );
    setState({ ...state, sides: updated });
    return newNode;
  },

  /**
   * wrapUnit — inserts a new unit as the parent of an existing unit.
   * The target unit is removed from its current position and re-attached
   * as the first child of the new wrapper node, which takes the target's
   * original slot in the tree.
   */
  wrapUnit: ({ sideId, groupId, targetUnitId, input }, state, setState) => {
    const i = input as Record<string, unknown>;
    const side = state.sides.find((s) => s.id === sideId)!;
    const group = side.groups.find((g) => g.id === groupId)!;
    const target = flattenTree(group.units).find((u) => u.id === targetUnitId);
    if (!target) return false;

    // Build the new wrapper node; it adopts the target as its first child
    const wrapperNode = inputToNode(i, side.standardIdentity);
    const wrapperWithChild: UnitNode = { ...wrapperNode, children: [target] };

    // Replace the target in the tree with the wrapper (target's slot)
    function replaceInTree(nodes: UnitNode[]): UnitNode[] {
      return nodes.map((n) => {
        if (n.id === targetUnitId) return wrapperWithChild;
        return { ...n, children: replaceInTree(n.children) };
      });
    }

    const newUnits = replaceInTree(group.units);
    const updated = state.sides.map((s) =>
      s.id !== sideId
        ? s
        : {
            ...s,
            updatedAt: now(),
            groups: s.groups.map((g) =>
              g.id !== groupId ? g : { ...g, units: newUnits }
            ),
          }
    );
    setState({ ...state, sides: updated });
    return wrapperWithChild;
  },
  updateUnit: ({ sideId, groupId, unitId, input }, state, setState) => {
    const i = input as Record<string, unknown>;
    const side = state.sides.find((s) => s.id === sideId)!;
    const group = side.groups.find((g) => g.id === groupId)!;
    const existing = flattenTree(group.units).find((u) => u.id === unitId);
    const updated_node = {
      ...inputToNode(i, side.standardIdentity, existing),
      id: unitId as string,
    };
    // Resolve the node's actual parent so upsertNode updates it in-place
    // rather than appending a duplicate at root when the node is nested.
    const parentId = findParentId(group.units, unitId as string);
    const updated = state.sides.map((s) =>
      s.id !== sideId
        ? s
        : {
            ...s,
            updatedAt: now(),
            groups: s.groups.map((g) =>
              g.id !== groupId
                ? g
                : { ...g, units: upsertNode(g.units, updated_node, parentId) }
            ),
          }
    );
    setState({ ...state, sides: updated });
    return updated_node;
  },
  removeUnit: ({ sideId, groupId, unitId }, state, setState) => {
    const updated = state.sides.map((s) =>
      s.id !== sideId
        ? s
        : {
            ...s,
            updatedAt: now(),
            groups: s.groups.map((g) =>
              g.id !== groupId
                ? g
                : { ...g, units: removeNode(g.units, unitId as string) }
            ),
          }
    );
    setState({ ...state, sides: updated });
    return true;
  },
  reorderUnit: (
    { sideId, groupId, unitId, newParentId, position },
    state,
    setState
  ) => {
    const side = state.sides.find((s) => s.id === sideId)!;
    const group = side.groups.find((g) => g.id === groupId)!;
    const node = flattenTree(group.units).find((u) => u.id === unitId);
    if (!node) return false;
    const pos = position as number;
    let units = removeNode(group.units, unitId as string);
    if (!newParentId) {
      units = [...units.slice(0, pos), node, ...units.slice(pos)];
    } else {
      const insertInto = (nodes: UnitNode[]): UnitNode[] =>
        nodes.map((n) => {
          if (n.id === newParentId) {
            const children = removeNode(n.children, unitId as string);
            return {
              ...n,
              children: [
                ...children.slice(0, pos),
                node,
                ...children.slice(pos),
              ],
            };
          }
          return { ...n, children: insertInto(n.children) };
        });
      units = insertInto(units);
    }
    const updated = state.sides.map((s) =>
      s.id !== sideId
        ? s
        : {
            ...s,
            updatedAt: now(),
            groups: s.groups.map((g) =>
              g.id !== groupId ? g : { ...g, units }
            ),
          }
    );
    setState({ ...state, sides: updated });
    return true;
  },

  /**
   * duplicateUnit — deep-clones a unit (and all its descendants) and
   * inserts it immediately after the original at the same hierarchy level.
   */
  duplicateUnit: ({ sideId, groupId, unitId }, state, setState) => {
    const side = state.sides.find((s) => s.id === sideId)!;
    const group = side.groups.find((g) => g.id === groupId)!;
    const all = flattenTree(group.units);
    const src = all.find((u) => u.id === unitId);
    if (!src) return false;

    function deepCloneUnit(u: UnitNode): UnitNode {
      return {
        ...u,
        id: uid(),
        name: `${u.name} (copy)`,
        state: { ...u.state, lastUpdated: now() },
        assets: u.assets.map((a) => ({ ...a, id: uid() })),
        weapons: u.weapons.map((w) => ({ ...w, id: uid() })),
        children: u.children.map(deepCloneUnit),
      };
    }

    const cloned = deepCloneUnit(src);
    // Insert after the original at whatever level it lives
    function insertAfter(nodes: UnitNode[]): UnitNode[] {
      const idx = nodes.findIndex((n) => n.id === unitId);
      if (idx >= 0) {
        const next = [...nodes];
        next.splice(idx + 1, 0, cloned);
        return next;
      }
      return nodes.map((n) => ({ ...n, children: insertAfter(n.children) }));
    }

    const newUnits = insertAfter(group.units);
    const updated = state.sides.map((s) =>
      s.id !== sideId
        ? s
        : {
            ...s,
            updatedAt: now(),
            groups: s.groups.map((g) =>
              g.id !== groupId ? g : { ...g, units: newUnits }
            ),
          }
    );
    setState({ ...state, sides: updated });
    return cloned;
  },

  /**
   * moveUnitToGroup — moves a unit (and all its descendants) from one group
   * to another, optionally under a parentUnitId in the destination group.
   */
  moveUnitToGroup: (
    { sideId, fromGroupId, toGroupId, unitId, toParentUnitId },
    state,
    setState
  ) => {
    const side = state.sides.find((s) => s.id === sideId)!;
    const fromGroup = side.groups.find((g) => g.id === fromGroupId)!;
    const toGroup = side.groups.find((g) => g.id === toGroupId)!;
    const unit = flattenTree(fromGroup.units).find((u) => u.id === unitId);
    if (!unit || fromGroupId === toGroupId) return false;

    const srcUnits = removeNode(fromGroup.units, unitId as string);
    const destUnits = upsertNode(
      toGroup.units,
      unit,
      (toParentUnitId as string | null) ?? null
    );

    const updated = state.sides.map((s) =>
      s.id !== sideId
        ? s
        : {
            ...s,
            updatedAt: now(),
            groups: s.groups.map((g) => {
              if (g.id === fromGroupId) return { ...g, units: srcUnits };
              if (g.id === toGroupId) return { ...g, units: destUnits };
              return g;
            }),
          }
    );
    setState({ ...state, sides: updated });
    return true;
  },

  /**
   * updateUnitStatus — quick status toggle without a full form submit
   */
  updateUnitStatus: ({ sideId, groupId, unitId, status }, state, setState) => {
    const side = state.sides.find((s) => s.id === sideId)!;
    const group = side.groups.find((g) => g.id === groupId)!;
    const parentId = findParentId(group.units, unitId as string);
    const existing = flattenTree(group.units).find((u) => u.id === unitId);
    if (!existing) return false;
    const patched: UnitNode = {
      ...existing,
      state: {
        ...existing.state,
        status: status as UnitNode["state"]["status"],
        lastUpdated: now(),
      },
    };
    const updated = state.sides.map((s) =>
      s.id !== sideId
        ? s
        : {
            ...s,
            updatedAt: now(),
            groups: s.groups.map((g) =>
              g.id !== groupId
                ? g
                : { ...g, units: upsertNode(g.units, patched, parentId) }
            ),
          }
    );
    setState({ ...state, sides: updated });
    return true;
  },

  /**
   * updateUnitCE — quick CE (combat effectiveness) update
   */
  updateUnitCE: ({ sideId, groupId, unitId, ce }, state, setState) => {
    const side = state.sides.find((s) => s.id === sideId)!;
    const group = side.groups.find((g) => g.id === groupId)!;
    const parentId = findParentId(group.units, unitId as string);
    const existing = flattenTree(group.units).find((u) => u.id === unitId);
    if (!existing) return false;
    const patched: UnitNode = {
      ...existing,
      capabilities: {
        ...existing.capabilities,
        combatEffectiveness:
          (ce as UnitNode["capabilities"]["combatEffectiveness"]) || undefined,
      },
      state: { ...existing.state, lastUpdated: now() },
    };
    const updated = state.sides.map((s) =>
      s.id !== sideId
        ? s
        : {
            ...s,
            updatedAt: now(),
            groups: s.groups.map((g) =>
              g.id !== groupId
                ? g
                : { ...g, units: upsertNode(g.units, patched, parentId) }
            ),
          }
    );
    setState({ ...state, sides: updated });
    return true;
  },

  // --- Template mutations ---
  createTemplate: ({ input }, state, setState) => {
    const i = input as Record<string, unknown>;
    const t: UnitTemplate = {
      id: uid(),
      name: i.name as string,
      echelon: i.echelon as UnitTemplate["echelon"],
      defaultPersonnelCount: (i.defaultPersonnelCount as number) ?? 0,
      description: (i.description as string) ?? "",
      tags: (i.tags as string[]) ?? [],
      defaultChildren: [],
      symbol: (i.symbol as UnitTemplate["symbol"]) ?? {},
      defaultEquipment: [],
    };
    setState({ ...state, templates: [...state.templates, t] });
    return t;
  },
  updateTemplate: ({ id, input }, state, setState) => {
    const i = input as Record<string, unknown>;
    const updated = state.templates.map((t) =>
      t.id === id
        ? {
            ...t,
            name: (i.name as string) ?? t.name,
            echelon: (i.echelon as UnitTemplate["echelon"]) ?? t.echelon,
            defaultPersonnelCount:
              (i.defaultPersonnelCount as number) ?? t.defaultPersonnelCount,
            description: (i.description as string) ?? t.description,
            tags: (i.tags as string[]) ?? t.tags,
            symbol: (i.symbol as UnitTemplate["symbol"]) ?? t.symbol,
          }
        : t
    );
    setState({ ...state, templates: updated });
    return updated.find((t) => t.id === id)!;
  },
  deleteTemplate: ({ id }, state, setState) => {
    setState({
      ...state,
      templates: state.templates.filter((t) => t.id !== id),
    });
    return true;
  },

  // --- Import a fully-formed Side from an external source (e.g. OSDK) ---
  importSide: ({ side }, state, setState) => {
    const incoming = side as Side;
    // If a side with the same id already exists, replace it; otherwise append.
    const exists = state.sides.some((s) => s.id === incoming.id);
    const updated = exists
      ? state.sides.map((s) => (s.id === incoming.id ? incoming : s))
      : [...state.sides, incoming];
    setState({ ...state, sides: updated });
    return computeSideTotals(incoming);
  },

  // --- Group template mutations ---
  saveGroupTemplate: ({ input }, state, setState) => {
    const i = input as Record<string, unknown>;
    const gt: GroupTemplate = {
      id: uid(),
      name: i.name as string,
      description: (i.description as string) ?? "",
      tags: (i.tags as string[]) ?? [],
      branch: i.branch as GroupTemplate["branch"],
      rootNodes: (i.rootNodes as GroupTemplateNode[]) ?? [],
      createdAt: now(),
    };
    setState({ ...state, groupTemplates: [...state.groupTemplates, gt] });
    return gt;
  },
  deleteGroupTemplate: ({ id }, state, setState) => {
    setState({
      ...state,
      groupTemplates: state.groupTemplates.filter((t) => t.id !== id),
    });
    return true;
  },
  applyGroupTemplate: ({ sideId, groupId, templateId }, state, setState) => {
    const side = state.sides.find((s) => s.id === sideId);
    const gt = state.groupTemplates.find((t) => t.id === templateId);
    if (!side || !gt) return false;

    function templateNodeToUnit(tn: GroupTemplateNode): UnitNode {
      return {
        id: uid(),
        name: tn.name,
        echelon: tn.echelon,
        personnelCount: tn.personnelCount,
        notes: tn.notes,
        symbol: {
          standardIdentity: side!.standardIdentity,
          echelon: tn.echelon,
          icon: (tn.icon as UnitNode["symbol"]["icon"]) ?? "infantry",
        },
        capabilities: {},
        customProperties: [],
        state: { status: "active", lastUpdated: now() },
        weapons: [],
        assets: [],
        equipment: [],
        children: tn.children.map(templateNodeToUnit),
      };
    }

    const newUnits = gt.rootNodes.map(templateNodeToUnit);
    const updated = state.sides.map((s) =>
      s.id !== sideId
        ? s
        : {
            ...s,
            updatedAt: now(),
            groups: s.groups.map((g) =>
              g.id !== groupId ? g : { ...g, units: [...g.units, ...newUnits] }
            ),
          }
    );
    setState({ ...state, sides: updated });
    return true;
  },
};

// ---- Simple operation name extractor ----
function parseOperationName(source: string): string | null {
  const src = source.replace(/#[^\n]*/g, "").trim();
  const fieldMatch = src.match(
    /(?:query|mutation|subscription)?\s*(?:[a-zA-Z_][a-zA-Z_0-9]*)?\s*(?:\([^)]*\))?\s*\{\s*([a-zA-Z_][a-zA-Z_0-9]*)/
  );
  return fieldMatch?.[1] ?? null;
}

// ---- Execute query ----
export async function executeQuery(
  query: string,
  variables: Record<string, unknown>,
  getState: () => StoreState,
  setState: (s: StoreState) => void
): Promise<GqlResult> {
  try {
    const opName = parseOperationName(query);
    if (!opName)
      return {
        errors: [{ message: "Could not parse operation name from query" }],
      };

    const resolver = RESOLVERS[opName];
    if (!resolver)
      return { errors: [{ message: "Unknown operation: " + opName }] };

    const state = getState();
    const result = resolver(variables, state, setState);
    return { data: { [opName]: result } };
  } catch (e) {
    return { errors: [{ message: String(e) }] };
  }
}
