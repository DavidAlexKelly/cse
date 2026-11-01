/**
 * Client-side validation.
 *
 * Checks structural integrity of the ORBAT using the current data model:
 * - OUnit carries entityType, owningSimulator, simulatorIdentifierCode directly
 * - SimulatorConfig no longer exists
 * - assets (OAsset) are keyed by simulatorIdentifierCode / VBS4 identifier
 */

import type {
  OUnit,
  OSymbol,
  OAsset,
  OEdge,
  ValidationIssue,
  TreeNode,
} from "../types/index";

export interface ValidationContext {
  units: Map<string, OUnit>;
  symbols: Map<string, OSymbol>;  // keyed by unitKey
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configs: Map<string, any>;      // kept for API compat — no longer used
  assets: Map<string, OAsset>;    // keyed by simulatorIdentifierCode
  edges: OEdge[];
  tree: TreeNode[];
}

// Returns all unit keys present in the tree (flattened)
function collectTreeKeys(nodes: TreeNode[]): string[] {
  const keys: string[] = [];
  function walk(n: TreeNode) {
    keys.push(n.unitKey);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return keys;
}

export function validate(ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const treeKeys = collectTreeKeys(ctx.tree);

  for (const unitKey of treeKeys) {
    const unit = ctx.units.get(unitKey);
    const symbol = ctx.symbols.get(unitKey);

    if (!unit) {
      issues.push({
        unitKey,
        severity: "ERROR",
        code: "UNIT_NOT_FOUND",
        message: `Unit data not found for key ${unitKey}`,
      });
      continue;
    }

    const name = unit.unitIdentifier || unitKey;
    const entityType = unit.entityType;

    if (entityType === "vehicle" || entityType === "aircraft") {
      // Sim-linked units must have a simulatorIdentifierCode
      if (!unit.simulatorIdentifierCode) {
        issues.push({
          unitKey,
          severity: "ERROR",
          code: "NO_SIM_ID",
          message: `${name} (${entityType}) has no simulator identifier code`,
        });
      } else if (!ctx.assets.has(unit.simulatorIdentifierCode)) {
        // Code exists but not found in the VBS4 catalogue
        issues.push({
          unitKey,
          severity: "ERROR",
          code: "UNKNOWN_SIM_ID",
          message: `${name}: simulator identifier "${unit.simulatorIdentifierCode}" not found in VBS4 asset catalogue`,
        });
      }

      // Must have a map position
      const hasPosition =
        symbol &&
        symbol.latitude !== null &&
        symbol.longitude !== null &&
        !(symbol.latitude === 0 && symbol.longitude === 0);

      if (!hasPosition) {
        issues.push({
          unitKey,
          severity: "ERROR",
          code: "NO_POSITION",
          message: `${name} has no map position — drag the symbol onto the map`,
        });
      }

      // Should have an owning simulator
      if (!unit.owningSimulator || unit.owningSimulator === "none") {
        issues.push({
          unitKey,
          severity: "WARNING",
          code: "NO_SIMULATOR",
          message: `${name} has no owning simulator set`,
        });
      }
    }

    if (entityType === "human") {
      // Humans that are sim-linked should have a valid code
      if (unit.simulatorIdentifierCode && !ctx.assets.has(unit.simulatorIdentifierCode)) {
        issues.push({
          unitKey,
          severity: "WARNING",
          code: "UNKNOWN_SIM_ID",
          message: `${name}: simulator identifier "${unit.simulatorIdentifierCode}" not found in VBS4 asset catalogue`,
        });
      }
    }

    if (entityType === "organisation") {
      if (!unit.sidc) {
        issues.push({
          unitKey,
          severity: "WARNING",
          code: "NO_SIDC",
          message: `${name} has no SIDC`,
        });
      }
    }
  }

  validateHierarchyDepth(ctx, issues);

  return issues;
}

function validateHierarchyDepth(
  ctx: ValidationContext,
  issues: ValidationIssue[]
): void {
  const HIGH_ECHELONS = new Set(["CORPS", "DIVISION", "BRIGADE", "REGIMENT"]);

  function walk(node: TreeNode, parentUnit: OUnit | null) {
    const unit = ctx.units.get(node.unitKey);

    if (unit && parentUnit) {
      const entityType = unit.entityType;
      if (
        (entityType === "vehicle" || entityType === "aircraft") &&
        HIGH_ECHELONS.has(parentUnit.echelon?.toUpperCase())
      ) {
        issues.push({
          unitKey: node.unitKey,
          severity: "WARNING",
          code: "SUSPICIOUS_DEPTH",
          message: `${unit.unitIdentifier} is a ${entityType} directly under a ${parentUnit.echelon} — check hierarchy`,
        });
      }
    }

    for (const child of node.children) {
      walk(child, unit ?? null);
    }
  }

  for (const root of ctx.tree) {
    walk(root, null);
  }
}

export function issuesByUnit(
  issues: ValidationIssue[]
): Map<string, ValidationIssue[]> {
  const map = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const existing = map.get(issue.unitKey) ?? [];
    existing.push(issue);
    map.set(issue.unitKey, existing);
  }
  return map;
}

export function canTranslate(issues: ValidationIssue[]): boolean {
  return !issues.some((i) => i.severity === "ERROR");
}
