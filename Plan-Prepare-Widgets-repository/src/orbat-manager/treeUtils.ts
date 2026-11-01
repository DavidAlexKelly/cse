// ============================================================
//  Tree Utility Helpers + Unified DisplayNode Tree
// ============================================================

import type { UnitNode, AssetNode, AssetSection, WeaponItem } from "./types.js";

// ── Core tree helpers ──────────────────────────────────────────────────────

/** Flatten all nodes in a tree (breadth-first) */
export function flattenTree(nodes: UnitNode[]): UnitNode[] {
  const result: UnitNode[] = [];
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    queue.push(...node.children);
  }
  return result;
}

/** Walk tree and call visitor for each node */
export function walkTree(
  nodes: UnitNode[],
  visitor: (node: UnitNode, parent: UnitNode | null) => void,
  parent: UnitNode | null = null
): void {
  for (const node of nodes) {
    visitor(node, parent);
    walkTree(node.children, visitor, node);
  }
}

/** Find a node by ID in a tree */
export function findNode(nodes: UnitNode[], id: string): UnitNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Remove a node from the tree (returns new tree without the node) */
export function removeNode(nodes: UnitNode[], id: string): UnitNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

/** Get all descendant IDs of a node */
export function getDescendantIds(node: UnitNode): string[] {
  const ids: string[] = [];
  walkTree(node.children, (n) => ids.push(n.id));
  return ids;
}

/** Count total personnel in a tree */
export function countPersonnel(nodes: UnitNode[]): number {
  let total = 0;
  walkTree(nodes, (n) => {
    total += n.personnelCount;
  });
  return total;
}

/** Count total units in a tree */
export function countUnits(nodes: UnitNode[]): number {
  let total = 0;
  walkTree(nodes, () => {
    total++;
  });
  return total;
}

/**
 * Find the direct parent ID of a node in a tree.
 * Returns null if the node is at the root level (no parent).
 */
export function findParentId(
  nodes: UnitNode[],
  targetId: string
): string | null {
  for (const node of nodes) {
    if (node.children.some((c) => c.id === targetId)) return node.id;
    const found = findParentId(node.children, targetId);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Insert or update a node inside a tree.
 * - parentId = null → insert/replace at root level
 * - parentId = string → insert/replace as a child of that parent
 *
 * NOTE: When parentId is null and the node does not already exist at root,
 * the node is appended at root. Callers that are updating a potentially
 * deeply-nested node should resolve the correct parentId first via
 * findParentId() before calling this function.
 */
export function upsertNode(
  nodes: UnitNode[],
  node: UnitNode,
  parentId: string | null
): UnitNode[] {
  if (parentId === null) {
    // Check if it exists at root
    const idx = nodes.findIndex((n) => n.id === node.id);
    if (idx >= 0) {
      const updated = [...nodes];
      updated[idx] = node;
      return updated;
    }
    return [...nodes, node];
  }
  return nodes.map((n) => {
    if (n.id === parentId) {
      const idx = n.children.findIndex((c) => c.id === node.id);
      const newChildren =
        idx >= 0
          ? n.children.map((c, i) => (i === idx ? node : c))
          : [...n.children, node];
      return { ...n, children: newChildren };
    }
    return { ...n, children: upsertNode(n.children, node, parentId) };
  });
}

// ── Weapon aggregation ─────────────────────────────────────────────────────

export interface AggregatedWeapon {
  /** Canonical key: name + calibre combined */
  key: string;
  name: string;
  calibre?: string;
  /** Total quantity across all sources that carry this weapon */
  totalQuantity: number;
  /** Total rounds (quantity × roundsCarried) summed across all sources */
  totalRounds: number;
}

/** Merge a WeaponItem list into an aggregation map (key → AggregatedWeapon) */
function mergeWeapons(
  map: Map<string, AggregatedWeapon>,
  weapons: WeaponItem[],
  multiplier = 1
): void {
  for (const w of weapons) {
    const key = `${w.name}||${w.calibre ?? ""}`;
    const existing = map.get(key);
    const qty = w.quantity * multiplier;
    const rounds = (w.roundsCarried ?? 0) * qty;
    if (existing) {
      existing.totalQuantity += qty;
      existing.totalRounds += rounds;
    } else {
      map.set(key, {
        key,
        name: w.name,
        calibre: w.calibre,
        totalQuantity: qty,
        totalRounds: rounds,
      });
    }
  }
}
/**
 * Aggregate all weapons carried by a node AND all its descendants
 * (units + platforms). Returns a sorted list by totalQuantity desc.
 */
export function aggregateWeapons(node: UnitNode): AggregatedWeapon[] {
  const map = new Map<string, AggregatedWeapon>();

  function walkUnit(u: UnitNode): void {
    // Unit's own carried weapons
    mergeWeapons(map, u.weapons);
    // Platform weapons (multiplied by platform quantity)
    for (const asset of u.assets) {
      mergeWeapons(map, asset.weapons, asset.quantity);
    }
    for (const child of u.children) walkUnit(child);
  }

  walkUnit(node);
  return Array.from(map.values()).sort(
    (a, b) => b.totalQuantity - a.totalQuantity
  );
}

/**
 * Aggregate weapons across a flat array of root nodes (e.g. a full group).
 */
export function aggregateWeaponsForGroup(
  units: UnitNode[]
): AggregatedWeapon[] {
  const map = new Map<string, AggregatedWeapon>();
  for (const u of units) {
    const sub = aggregateWeapons(u);
    mergeWeapons(
      map,
      sub.map((a) => ({
        id: a.key,
        name: a.name,
        calibre: a.calibre,
        quantity: a.totalQuantity,
        roundsCarried:
          a.totalRounds > 0
            ? Math.round(a.totalRounds / a.totalQuantity)
            : undefined,
      }))
    );
  }
  return Array.from(map.values()).sort(
    (a, b) => b.totalQuantity - a.totalQuantity
  );
}

// ── Weapon tree node (for hierarchical weapons layer view) ──────────────────

/** Source kind for a weapon entry in the tree view */
export type WeaponSourceKind = "unit" | "platform";

export interface WeaponTreeEntry {
  /** Unit or platform that directly carries this weapon */
  sourceId: string;
  sourceName: string;
  sourceKind: WeaponSourceKind;
  /** Echelon of the unit (undefined for platforms) */
  echelon?: string;
  /** Icon emoji */
  icon: string;
  /** Depth in the command hierarchy (0 = root unit) */
  depth: number;
  /** Path of ancestor names for breadcrumb display */
  path: string[];
  weapons: WeaponItem[];
  /** All aggregated weapons for this node and descendants */
  aggregated: AggregatedWeapon[];
  /** Child entries (sub-units that also have weapons) */
  children: WeaponTreeEntry[];
  /** Whether this node or any descendant has weapons */
  hasWeapons: boolean;
}

const PLATFORM_ICON_MAP: [string, string][] = [
  ["mbt", "🛡"],
  ["challenger", "🛡"],
  ["abrams", "🛡"],
  ["leopard", "🛡"],
  ["t-90", "🛡"],
  ["ifv", "🚖"],
  ["warrior", "🚖"],
  ["bradley", "🚖"],
  ["bmp", "🚖"],
  ["cv-90", "🚖"],
  ["apc", "🚌"],
  ["boxer", "🚌"],
  ["m113", "🚌"],
  ["helicopter", "🚁"],
  ["apache", "🚁"],
  ["chinook", "🚁"],
  ["merlin", "🚁"],
  ["wildcat", "🚁"],
  ["puma", "🚁"],
  ["blackhawk", "🚁"],
  ["fixed", "✈"],
  ["typhoon", "✈"],
  ["f-35", "✈"],
  ["f-16", "✈"],
  ["a-10", "✈"],
  ["destroyer", "⚓"],
  ["frigate", "⚓"],
  ["corvette", "⚓"],
  ["submarine", "🤿"],
  ["sub", "🤿"],
  ["carrier", "⛴"],
];

function platformIcon(presetId: string): string {
  const cat = presetId.toLowerCase();
  for (const [key, icon] of PLATFORM_ICON_MAP) {
    if (cat.includes(key)) return icon;
  }
  return "🔲";
}

/**
 * Build a hierarchical WeaponTreeEntry for a unit subtree.
 * Only includes nodes that directly carry weapons or have descendants that do.
 */
function buildWeaponTreeEntry(
  unit: UnitNode,
  depth: number,
  path: string[]
): WeaponTreeEntry | null {
  const childPath = [...path, unit.name];

  // Recurse into children
  const childEntries: WeaponTreeEntry[] = [];
  for (const child of unit.children) {
    const entry = buildWeaponTreeEntry(child, depth + 1, childPath);
    if (entry) childEntries.push(entry);
  }

  // Platform entries that have weapons
  const platformEntries: WeaponTreeEntry[] = [];
  for (const asset of unit.assets) {
    if (asset.weapons.length === 0) continue;
    const agg = new Map<string, AggregatedWeapon>();
    mergeWeapons(agg, asset.weapons, asset.quantity);
    platformEntries.push({
      sourceId: asset.id,
      sourceName: `${asset.quantity > 1 ? `${asset.quantity}× ` : ""}${asset.name}`,
      sourceKind: "platform",
      icon: platformIcon(asset.presetId),
      depth: depth + 1,
      path: childPath,
      weapons: asset.weapons,
      aggregated: Array.from(agg.values()).sort(
        (a, b) => b.totalQuantity - a.totalQuantity
      ),
      children: [],
      hasWeapons: true,
    });
  }

  const ownWeapons = unit.weapons.length > 0;
  const hasWeapons =
    ownWeapons || platformEntries.length > 0 || childEntries.length > 0;
  if (!hasWeapons) return null;

  const allChildren = [...childEntries, ...platformEntries];
  const aggregated = aggregateWeapons(unit);

  return {
    sourceId: unit.id,
    sourceName: unit.name,
    sourceKind: "unit",
    echelon: unit.echelon,
    icon: "◉",
    depth,
    path,
    weapons: unit.weapons,
    aggregated,
    children: allChildren,
    hasWeapons: true,
  };
}

/**
 * Build weapon tree entries for a list of root units.
 * Returns only entries that contain at least one weapon somewhere in their subtree.
 */
export function buildWeaponTree(units: UnitNode[]): WeaponTreeEntry[] {
  return units
    .map((u) => buildWeaponTreeEntry(u, 0, []))
    .filter((e): e is WeaponTreeEntry => e !== null);
}

// ── Platform tree (for hierarchical platform layer view) ────────────────────

/** A fully resolved node in the platform hierarchy tree */
export interface PlatformTreeNode {
  kind: "unit" | "platform" | "section" | "assigned-unit";
  id: string;
  label: string;
  sublabel?: string;
  /** Platform icon or unit echelon mark */
  icon: string;
  color: string;
  /** Personnel count at this level only */
  pax: number;
  /** Total pax including all children */
  totalPax: number;
  depth: number;
  status?: "active" | "reserve" | "destroyed" | "unknown";
  /** Weapons on this node directly (platform weapons) */
  weapons?: WeaponItem[];
  /** Back-reference to the source unit (for click-to-select) */
  unit?: UnitNode;
  asset?: AssetNode;
  section?: AssetSection;
  children: PlatformTreeNode[];
}

const PLAT_ICON_MAP: [string, string][] = [
  ["mbt", "🛡"], ["challenger", "🛡"], ["abrams", "🛡"], ["leopard", "🛡"], ["t-90", "🛡"],
  ["ifv", "🚖"], ["warrior", "🚖"], ["bradley", "🚖"], ["bmp", "🚖"], ["cv-90", "🚖"],
  ["apc", "🚌"], ["boxer", "🚌"], ["m113", "🚌"],
  ["helicopter", "🚁"], ["apache", "🚁"], ["chinook", "🚁"], ["merlin", "🚁"], ["wildcat", "🚁"], ["puma", "🚁"], ["blackhawk", "🚁"],
  ["fixed", "✈"], ["typhoon", "✈"], ["f-35", "✈"], ["f-16", "✈"], ["a-10", "✈"],
  ["destroyer", "⚓"], ["frigate", "⚓"], ["corvette", "⚓"],
  ["submarine", "🤿"], ["sub", "🤿"],
  ["carrier", "⛴"],
];

export function getPlatformIcon(presetId: string): string {
  const cat = presetId.toLowerCase();
  for (const [key, icon] of PLAT_ICON_MAP) if (cat.includes(key)) return icon;
  return "🔲";
}

const PLAT_COLOR_MAP: [string, string][] = [
  ["mbt", "#f59e0b"], ["challenger", "#f59e0b"], ["abrams", "#f59e0b"], ["leopard", "#f59e0b"], ["t-90", "#f59e0b"],
  ["ifv", "#fb923c"], ["warrior", "#fb923c"], ["bradley", "#fb923c"], ["bmp", "#fb923c"], ["cv-90", "#fb923c"],
  ["apc", "#fbbf24"], ["boxer", "#fbbf24"], ["m113", "#fbbf24"],
  ["helicopter", "#34d399"], ["apache", "#34d399"], ["chinook", "#34d399"], ["merlin", "#34d399"], ["wildcat", "#34d399"], ["puma", "#34d399"], ["blackhawk", "#34d399"],
  ["fixed", "#60a5fa"], ["typhoon", "#60a5fa"], ["f-35", "#60a5fa"],
  ["destroyer", "#818cf8"], ["frigate", "#818cf8"], ["corvette", "#818cf8"],
  ["submarine", "#a78bfa"], ["sub", "#a78bfa"],
  ["carrier", "#f472b6"],
];

export function getPlatformColor(presetId: string): string {
  const cat = presetId.toLowerCase();
  for (const [key, color] of PLAT_COLOR_MAP) if (cat.includes(key)) return color;
  return "#fb923c";
}

/**
 * Build a platform tree from a flat pool of all group units.
 * Each unit that owns platforms becomes a top-level node;
 * its platforms expand to show sections, and each section shows
 * which child units are assigned to it.
 */
function buildPlatformTreeForUnit(
  unit: UnitNode,
  lookup: Map<string, UnitNode>,
  depth: number
): PlatformTreeNode {
  const color = "#22a8c0";

  // Recurse command children first
  const commandChildren = unit.children.map((c) =>
    buildPlatformTreeForUnit(c, lookup, depth + 1)
  );

  // Build platform nodes
  const platformNodes: PlatformTreeNode[] = unit.assets.map((asset) => {
    const pColor = getPlatformColor(asset.presetId);
    const pIcon = getPlatformIcon(asset.presetId);

    // Section children
    function buildSection(sec: AssetSection, secDepth: number): PlatformTreeNode {
      const assignedUnitNodes: PlatformTreeNode[] = (sec.assignedUnitIds ?? []).flatMap((uid) => {
        const u = lookup.get(uid);
        if (!u) return [];
        return [{
          kind: "assigned-unit" as const,
          id: `${sec.id}-${u.id}`,
          label: u.name,
          sublabel: `${u.echelon} · ${u.personnelCount} pax`,
          icon: "◉",
          color: "#22a8c0",
          pax: u.personnelCount,
          totalPax: u.personnelCount,
          depth: secDepth + 1,
          status: u.state.status,
          unit: u,
          children: [],
        }];
      });

      const subSectionNodes = sec.subSections.map((ss) => buildSection(ss, secDepth + 1));
      const childNodes = [...subSectionNodes, ...assignedUnitNodes];
      const childPax = childNodes.reduce((s, c) => s + c.totalPax, 0);

      return {
        kind: "section" as const,
        id: sec.id,
        label: sec.name,
        sublabel: sec.role,
        icon: "👥",
        color: pColor + "88",
        pax: sec.personnelCount,
        totalPax: sec.personnelCount + childPax,
        depth: secDepth,
        status: "active" as const,
        section: sec,
        children: childNodes,
      };
    }

    // Asset-level assigned units (not in a section)
    const assetLevelUnits: PlatformTreeNode[] = (asset.assignedUnitIds ?? []).flatMap((uid) => {
      const u = lookup.get(uid);
      if (!u) return [];
      return [{
        kind: "assigned-unit" as const,
        id: `${asset.id}-${u.id}`,
        label: u.name,
        sublabel: `${u.echelon} · ${u.personnelCount} pax`,
        icon: "◉",
        color: "#22a8c0",
        pax: u.personnelCount,
        totalPax: u.personnelCount,
        depth: depth + 2,
        status: u.state.status,
        unit: u,
        children: [],
      }];
    });

    const sectionNodes = asset.sections.map((sec) => buildSection(sec, depth + 2));
    const allPlatChildren = [...sectionNodes, ...assetLevelUnits];
    const platChildPax = allPlatChildren.reduce((s, c) => s + c.totalPax, 0);

    const qtyLabel = asset.quantity > 1 ? `${asset.quantity}× ` : "";
    return {
      kind: "platform" as const,
      id: asset.id,
      label: `${qtyLabel}${asset.name}`,
      sublabel: `${asset.crewCount} crew · ${asset.state.status}`,
      icon: pIcon,
      color: pColor,
      pax: asset.crewCount,
      totalPax: asset.crewCount + platChildPax,
      depth: depth + 1,
      status: asset.state.status,
      weapons: asset.weapons.length > 0 ? asset.weapons : undefined,
      asset,
      children: allPlatChildren,
    };
  });

  const allChildren = [...commandChildren, ...platformNodes];
  const childPax = allChildren.reduce((s, c) => s + c.totalPax, 0);

  return {
    kind: "unit",
    id: unit.id,
    label: unit.name,
    sublabel: unit.echelon,
    icon: "◉",
    color,
    pax: unit.personnelCount,
    totalPax: unit.personnelCount + childPax,
    depth,
    status: unit.state.status,
    unit,
    children: allChildren,
  };
}

/**
 * Build the full platform tree for a list of root units.
 * Returns all root unit nodes (even those without platforms, so the command
 * structure is always visible and units can be expanded to reveal platforms).
 */
export function buildPlatformTree(units: UnitNode[]): PlatformTreeNode[] {
  const lookup = buildUnitLookup(units);
  return units.map((u) => buildPlatformTreeForUnit(u, lookup, 0));
}

// ── Unified DisplayNode tree (merges command + platform hierarchies) ────────

export type DisplayNodeKind = "unit" | "asset" | "section";

export interface DisplayNode {
  id: string;
  kind: DisplayNodeKind;
  label: string;
  sublabel?: string;
  pax: number;
  icon: string;
  color: string;
  children: DisplayNode[];
  unit?: UnitNode;
  asset?: AssetNode;
  section?: AssetSection;
  weapons?: WeaponItem[];
  status?: "active" | "reserve" | "destroyed" | "unknown";
  isPlatform: boolean;
  totalPax: number;
}

// Platform category colour/icon lookup
const ASSET_META: Record<string, { color: string; icon: string }> = {
  mbt: { color: "#f59e0b", icon: "🛡" },
  ifv: { color: "#fb923c", icon: "🚖" },
  apc: { color: "#fb923c", icon: "🚌" },
  wheeled: { color: "#fbbf24", icon: "🛻" },
  helicopter: { color: "#34d399", icon: "🚁" },
  fixed: { color: "#60a5fa", icon: "✈" },
  destroyer: { color: "#818cf8", icon: "⚓" },
  frigate: { color: "#818cf8", icon: "⚓" },
  submarine: { color: "#a78bfa", icon: "🤿" },
  corvette: { color: "#818cf8", icon: "⚓" },
  carrier: { color: "#f472b6", icon: "⛴" },
};

function assetMeta(presetId: string): { color: string; icon: string } {
  const cat = presetId.toLowerCase();
  for (const [key, meta] of Object.entries(ASSET_META)) {
    if (cat.includes(key)) return meta;
  }
  return { color: "#6a7292", icon: "🔲" };
}

/** Build a flat id→UnitNode lookup for the ENTIRE group tree. */
function buildUnitLookup(units: UnitNode[]): Map<string, UnitNode> {
  const map = new Map<string, UnitNode>();
  function walk(u: UnitNode) {
    map.set(u.id, u);
    u.children.forEach(walk);
  }
  units.forEach(walk);
  return map;
}

function sectionToDisplayNode(
  sec: AssetSection,
  accentColor: string,
  lookup: Map<string, UnitNode>
): DisplayNode {
  const subChildren = sec.subSections.map((s) =>
    sectionToDisplayNode(s, accentColor, lookup)
  );
  const assignedChildren = (sec.assignedUnitIds ?? []).flatMap((uid) => {
    const u = lookup.get(uid);
    return u ? [unitToDisplayInner(u, lookup)] : [];
  });
  const children = [...subChildren, ...assignedChildren];
  const childPax = children.reduce((s, c) => s + c.totalPax, 0);
  return {
    id: sec.id,
    kind: "section",
    label: sec.name,
    sublabel: sec.role,
    pax: sec.personnelCount,
    icon: "👥",
    color: accentColor + "99",
    children,
    section: sec,
    isPlatform: true,
    status: "active",
    totalPax: sec.personnelCount + childPax,
  };
}

function assetToDisplayInner(
  asset: AssetNode,
  lookup: Map<string, UnitNode>
): DisplayNode {
  const { color, icon } = assetMeta(asset.presetId);
  const sectionChildren = asset.sections.map((sec) =>
    sectionToDisplayNode(sec, color, lookup)
  );
  const assignedChildren = (asset.assignedUnitIds ?? []).flatMap((uid) => {
    const u = lookup.get(uid);
    return u ? [unitToDisplayInner(u, lookup)] : [];
  });
  const children = [...sectionChildren, ...assignedChildren];
  const childPax = children.reduce((s, c) => s + c.totalPax, 0);
  const qtyLabel = asset.quantity > 1 ? `${asset.quantity}× ` : "";
  return {
    id: asset.id,
    kind: "asset",
    label: `${qtyLabel}${asset.name}`,
    pax: asset.crewCount,
    icon,
    color,
    children,
    asset,
    weapons: asset.weapons,
    isPlatform: true,
    status: asset.state.status,
    totalPax: asset.crewCount + childPax,
  };
}

function unitToDisplayInner(
  unit: UnitNode,
  lookup: Map<string, UnitNode>
): DisplayNode {
  const unitChildren = unit.children.map((c) => unitToDisplayInner(c, lookup));
  const assetChildren = (unit.assets ?? []).map((a) =>
    assetToDisplayInner(a, lookup)
  );
  const allChildren = [...unitChildren, ...assetChildren];
  const childPax = allChildren.reduce((s, c) => s + c.totalPax, 0);
  return {
    id: unit.id,
    kind: "unit",
    label: unit.name,
    pax: unit.personnelCount,
    icon: "◉",
    color: "#22a8c0",
    children: allChildren,
    unit,
    weapons: unit.weapons,
    isPlatform: false,
    status: unit.state.status,
    totalPax: unit.personnelCount + childPax,
  };
}

/**
 * Convert a UnitNode into a unified DisplayNode tree that includes both
 * command children AND platform/section children.
 * Pass the full group units array so assignedUnitIds can resolve cross-hierarchy.
 */
export function unitToDisplay(
  unit: UnitNode,
  siblingPool?: UnitNode[]
): DisplayNode {
  const pool = siblingPool ?? [unit];
  const lookup = buildUnitLookup(pool);
  return unitToDisplayInner(unit, lookup);
}

/** Flatten a DisplayNode tree into depth-annotated rows */
export function flattenDisplay(
  nodes: DisplayNode[]
): Array<{ node: DisplayNode; depth: number }> {
  const result: Array<{ node: DisplayNode; depth: number }> = [];
  function walk(n: DisplayNode, d: number) {
    result.push({ node: n, depth: d });
    n.children.forEach((c) => walk(c, d + 1));
  }
  nodes.forEach((n) => walk(n, 0));
  return result;
}

