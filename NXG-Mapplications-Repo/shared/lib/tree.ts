/**
 * Tree builder — resolves flat OEdge[] into a nested TreeNode[] hierarchy.
 * Mirrors the graph resolution logic in ontology_store.py _build_indexes().
 */

import type { OEdge, TreeNode } from "../types";

export function buildTree(edges: OEdge[]): TreeNode[] {
  // Build children index
  const childrenIndex = new Map<string, string[]>();
  const allChildKeys = new Set<string>();

  for (const edge of edges) {
    const children = childrenIndex.get(edge.parentUnitKey) ?? [];
    children.push(edge.childUnitKey);
    childrenIndex.set(edge.parentUnitKey, children);
    allChildKeys.add(edge.childUnitKey);
  }

  // Collect all unique keys
  const allKeys = new Set<string>();
  for (const edge of edges) {
    allKeys.add(edge.parentUnitKey);
    allKeys.add(edge.childUnitKey);
  }

  // Root keys are those that never appear as a child
  const rootKeys = [...allKeys].filter((k) => !allChildKeys.has(k));

  function buildNode(key: string): TreeNode {
    const childKeys = childrenIndex.get(key) ?? [];
    return {
      unitKey: key,
      children: childKeys.map(buildNode),
    };
  }

  return rootKeys.map(buildNode);
}

// Flatten a tree back to a list of all unit keys
export function flattenTree(nodes: TreeNode[]): string[] {
  const result: string[] = [];
  function walk(n: TreeNode) {
    result.push(n.unitKey);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}
