/**
 * treeUtils.ts — UnitNode tree helpers for the ORBAT Group Builder.
 *
 * Ported and trimmed from temp-orbat-example-tobe-merged/orbat-manager/treeUtils.ts.
 * Weapon/platform/display-tree helpers intentionally excluded (not needed without LayerPanels).
 */

import type { UnitNode } from "../../../types";

// ── Core traversal ─────────────────────────────────────────────────────────

/** Flatten all UnitNodes breadth-first */
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

/** Walk tree calling visitor for every node */
export function walkTree(
  nodes: UnitNode[],
  visitor: (node: UnitNode, parent: UnitNode | null) => void,
  parent: UnitNode | null = null,
): void {
  for (const node of nodes) {
    visitor(node, parent);
    walkTree(node.children, visitor, node);
  }
}

/** Find a node by id */
export function findNode(nodes: UnitNode[], id: string): UnitNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Remove a node (returns new tree without it) */
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

/** Count total personnel across a tree */
export function countPersonnel(nodes: UnitNode[]): number {
  let total = 0;
  walkTree(nodes, (n) => { total += n.personnelCount; });
  return total;
}

/** Count total units (nodes) in a tree */
export function countUnits(nodes: UnitNode[]): number {
  let total = 0;
  walkTree(nodes, () => { total++; });
  return total;
}

/**
 * Find the direct parent id of a node.
 * Returns null if the node is at the root level.
 */
export function findParentId(nodes: UnitNode[], targetId: string): string | null {
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
 */
export function upsertNode(
  nodes: UnitNode[],
  node: UnitNode,
  parentId: string | null,
): UnitNode[] {
  if (parentId === null) {
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
