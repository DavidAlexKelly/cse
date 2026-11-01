/**
 * filterUtils.ts — search/filter state for the Group Builder unit list.
 *
 * Ported from temp-orbat-example-tobe-merged/orbat-manager/filterUtils.ts.
 */

import type { UnitNode, EchelonLevel } from "../../../types";

export interface FilterState {
  text: string;
  echelon: EchelonLevel | "";
  status: "" | "active" | "reserve" | "destroyed" | "unknown";
  ce: "" | "FO" | "SO" | "MO" | "NO" | "UNK";
  callSign: string;
  minPax: number;
  maxPax: number;
}

export const DEFAULT_FILTERS: FilterState = {
  text: "",
  echelon: "",
  status: "",
  ce: "",
  callSign: "",
  minPax: 0,
  maxPax: 99999,
};

export function isDefaultFilters(f: FilterState): boolean {
  return (
    f.text === "" &&
    f.echelon === "" &&
    f.status === "" &&
    f.ce === "" &&
    f.callSign === "" &&
    f.minPax === 0 &&
    f.maxPax === 99999
  );
}

export function matchesFilters(node: UnitNode, f: FilterState): boolean {
  if (f.text && !node.name.toLowerCase().includes(f.text.toLowerCase())) return false;
  if (f.echelon && node.echelon !== f.echelon) return false;
  if (f.status && node.state.status !== f.status) return false;
  if (f.ce && node.capabilities.combatEffectiveness !== f.ce) return false;
  if (
    f.callSign &&
    !(node.capabilities.callSign ?? "").toLowerCase().includes(f.callSign.toLowerCase())
  ) return false;
  if (node.personnelCount < f.minPax || node.personnelCount > f.maxPax) return false;
  return true;
}

export function filterTree(nodes: UnitNode[], f: FilterState): UnitNode[] {
  if (isDefaultFilters(f)) return nodes;
  return nodes.reduce<UnitNode[]>((acc, node) => {
    const filteredChildren = filterTree(node.children, f);
    if (matchesFilters(node, f) || filteredChildren.length > 0) {
      acc.push({ ...node, children: filteredChildren });
    }
    return acc;
  }, []);
}
