// ============================================================
//  ORBAT Validation Rules Engine
//  Implements rules A–K from the ORBAT structural specification.
//  Returns a list of RuleViolation objects; callers decide how to render.
// ============================================================

import type { UnitNode, EchelonLevel, StandardIdentity } from "./types.js";
import { ECHELON_INDEX, ECHELON_ORDER } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RuleSeverity = "ERROR" | "WARNING" | "INFO";

/**
 * A concrete fix that can be applied automatically without any user input.
 * Each fix describes *what* will change so the UI can surface it clearly.
 */
export interface AutoFix {
  /** Short label for the fix button, e.g. "Set strength to 87" */
  label: string;
  /** One-sentence explanation of what the fix does */
  description: string;
  /**
   * Apply the fix. Returns a flat map of unitId → partial UnitNode update
   * that the panel should dispatch via onUpdateUnit for each entry.
   */
  apply: () => Array<{ unitId: string; patch: Partial<UnitNode> }>;
}

export interface RuleViolation {
  /** e.g. "A-1", "G-3" */
  code: string;
  severity: RuleSeverity;
  /** Short summary shown in the list row */
  message: string;
  /** Full explanation with specific field values */
  detail: string;
  /** IDs of the units involved */
  unitIds: string[];
  /** Human-readable names for quick context */
  unitNames: string[];
  /** Whether the user has dismissed this violation */
  dismissed?: boolean;
  /**
   * If present, the violation can be auto-fixed.
   * The UI should show a "Fix" button when this is set.
   */
  autoFix?: AutoFix;
}

// ─── Fix Priority System ─────────────────────────────────────────────────────
//
//  When multiple rules propose conflicting fixes for the same unit,
//  higher-priority fixes win. This eliminates the A-1 ↔ G-3 and
//  G-2 ↔ G-3 oscillations that "Fix All" used to hit.
//
//  Rationale (priority = confidence in the fix):
//    100 — STRUCTURAL POSITION: F-3 (root), B-1 (HQ echelon).
//          These express the unit's *role* in the tree — non-negotiable.
//    90  — HIERARCHY CORRECTNESS: A-1 (echelon inversion).
//          The unit is in the wrong place — its echelon MUST change.
//          Demote-child is our chosen resolution direction.
//    80  — AFFILIATION: E-1 (opposing sides).
//          Simple metadata alignment; doesn't affect echelon.
//    70  — STRENGTH CONSISTENCY: G-2 (parent < children sum).
//          Structural: children exist and sum to a number — parent must match.
//    50  — STRENGTH BAND (LOW): G-3 too-low.
//          A "gentle" nudge — pax value only, no structural change.
//    40  — STRENGTH BAND (HIGH): G-3 too-high.
//          The lowest-priority fix — deliberately yields to A-1, B-1, G-2
//          which may have already restructured the unit.
//
//  When two fixes target the SAME unit:
//    • Different fields (e.g. E-1 sets standardIdentity, G-2 sets pax) → merge.
//    • Same field (e.g. A-1 sets echelon=platoon, G-2 sets echelon=battalion)
//      → higher priority wins; lower is dropped for this pass and re-evaluated
//        on the next pass with the new state.
// ─────────────────────────────────────────────────────────────────────────────

export const FIX_PRIORITY: Record<string, number> = {
  "F-3": 100,
  "B-1": 100,
  "A-1": 90,
  "E-1": 80,
  "G-2": 70,
  "G-3-low": 50,
  "G-3-high": 40,
};

/**
 * Returns the priority of a violation's fix. Higher wins in a conflict.
 * G-3 is split by severity/message content because the same code covers
 * both "too low" (safe, high-confidence) and "too high" (contentious).
 */
export function getFixPriority(v: RuleViolation): number {
  if (v.code === "G-3") {
    return v.message.includes("too low")
      ? FIX_PRIORITY["G-3-low"]
      : FIX_PRIORITY["G-3-high"];
  }
  return FIX_PRIORITY[v.code] ?? 60; // default mid-priority for unlisted codes
}

/** Which fields a given fix touches — used for conflict detection. */
export function fixTouchedFields(v: RuleViolation): Set<string> {
  const fields = new Set<string>();
  if (!v.autoFix) return fields;
  // Rather than actually running apply() (which we don't want to do
  // twice), we infer from the code what fields the fix will write.
  switch (v.code) {
    case "F-3":
    case "B-1":
    case "A-1":
      fields.add("echelon");
      fields.add("symbol.echelon");
      break;
    case "E-1":
      fields.add("symbol.standardIdentity");
      break;
    case "G-2":
      fields.add("personnelCount");
      // G-2 may also touch echelon when needsPromotion is true
      fields.add("echelon");
      fields.add("symbol.echelon");
      break;
    case "G-3":
      if (v.message.includes("too low") || v.message.includes("too high")) {
        // G-3 "cap" and "set to lo" only touch personnelCount.
        // G-3 "promote" touches echelon — inferred from label prefix.
        if (v.autoFix.label.startsWith("Promote")) {
          fields.add("echelon");
          fields.add("symbol.echelon");
        } else {
          fields.add("personnelCount");
        }
      }
      break;
  }
  return fields;
}

// ─── Strength bands (G-3, configurable) ─────────────────────────────────────

const STRENGTH_BANDS: Record<EchelonLevel, [number, number]> = {
  team: [2, 4],
  squad: [8, 12],
  section: [10, 40],
  platoon: [16, 44],
  company: [60, 250],
  battalion: [300, 1000],
  regiment: [1500, 5000],
  brigade: [1500, 5000],
  division: [10000, 20000],
  corps: [20000, 60000],
  army: [100000, Infinity],
  armyGroup: [100000, Infinity],
  theatre: [100000, Infinity],
};

// ─── HQ detection ────────────────────────────────────────────────────────────

function isHqNode(unit: UnitNode): boolean {
  const name = unit.name.toLowerCase();
  const icon = unit.symbol?.icon ?? "";
  return (
    icon === "headquarters" || /\bhq\b|\bheadquarters?\b|\bcommand\b/.test(name)
  );
}

function isManoeuvreIcon(icon: string): boolean {
  return [
    "infantry",
    "armour",
    "mechanisedInfantry",
    "cavalry",
    "reconnaissance",
    "specialForces",
    "aviation",
    "airForce",
  ].includes(icon);
}

function isLogSigMedIcon(icon: string): boolean {
  return ["logistics", "signals", "medical", "maintenance"].includes(icon);
}

// ─── Build an ancestor→descendant map for cycle and ancestry checks ──────────

function buildParentMap(units: UnitNode[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  function walk(node: UnitNode, parentId: string | null) {
    map.set(node.id, parentId);
    for (const c of node.children) walk(c, node.id);
  }
  for (const u of units) walk(u, null);
  return map;
}

function buildNodeMap(units: UnitNode[]): Map<string, UnitNode> {
  const map = new Map<string, UnitNode>();
  function walk(node: UnitNode) {
    map.set(node.id, node);
    for (const c of node.children) walk(c);
  }
  for (const u of units) walk(u);
  return map;
}

function ancestors(
  id: string,
  parentMap: Map<string, string | null>
): string[] {
  const result: string[] = [];
  let cur = parentMap.get(id) ?? null;
  while (cur !== null) {
    result.push(cur);
    cur = parentMap.get(cur) ?? null;
  }
  return result;
}

// ─── Main validation engine ───────────────────────────────────────────────────

/**
 * Run all structural rules against a flat array of root units (one group).
 * The `affiliation` parameter is the standardIdentity of the owning side.
 */
export function validateOrbat(
  roots: UnitNode[],
  affiliation: StandardIdentity,
  dismissedCodes: Set<string> = new Set()
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const parentMap = buildParentMap(roots);
  void buildNodeMap(roots); // built but reserved for future rules (D, I, K)
  const seenIds = new Set<string>();
  const seenNames = new Map<string, string[]>(); // parentId → names seen

  function addViolation(v: Omit<RuleViolation, "dismissed">) {
    violations.push({
      ...v,
      dismissed: dismissedCodes.has(`${v.code}:${v.unitIds.join(",")}`),
    });
  }

  function walk(node: UnitNode, parent: UnitNode | null) {
    const pIdx = parent ? ECHELON_INDEX[parent.echelon] : Infinity;
    const cIdx = ECHELON_INDEX[node.echelon];
    const nodeIsHq = isHqNode(node);

    // ── F-5: Unique IDs ──────────────────────────────────────────────────────
    if (seenIds.has(node.id)) {
      addViolation({
        code: "F-5",
        severity: "ERROR",
        message: `Duplicate unit ID: "${node.name}"`,
        detail: `Unit "${node.name}" (id: ${node.id}) appears more than once in the ORBAT. Every unit must have a unique primary key. This requires manual resolution — rename or remove the duplicate.`,
        unitIds: [node.id],
        unitNames: [node.name],
      });
    }
    seenIds.add(node.id);

    // ── F-6: Duplicate display names under same parent ───────────────────────
    const parentKey = parent?.id ?? "__root__";
    const siblingsNames = seenNames.get(parentKey) ?? [];
    if (siblingsNames.includes(node.name)) {
      addViolation({
        code: "F-6",
        severity: "WARNING",
        message: `Duplicate sibling name: "${node.name}"`,
        detail: `Two units named "${node.name}" share the same parent "${
          parent?.name ?? "(root)"
        }". This is likely a modelling error — rename one to distinguish them.`,
        unitIds: [node.id],
        unitNames: [node.name],
      });
    }
    siblingsNames.push(node.name);
    seenNames.set(parentKey, siblingsNames);

    // ── F-1: Cycle detection ─────────────────────────────────────────────────
    if (parent && ancestors(parent.id, parentMap).includes(node.id)) {
      addViolation({
        code: "F-1",
        severity: "ERROR",
        message: `Cycle detected involving "${node.name}"`,
        detail: `Unit "${node.name}" is an ancestor of its own parent "${parent.name}", forming a cycle. Re-parent one of the units to break the cycle.`,
        unitIds: [node.id, parent.id],
        unitNames: [node.name, parent.name],
      });
    }

    // ── F-3: Root must be a formation ────────────────────────────────────────
    if (!parent) {
      if (cIdx < ECHELON_INDEX["company"]) {
        // Auto-fixable: promote echelon to company
        addViolation({
          code: "F-3",
          severity: "ERROR",
          message: `Root node "${node.name}" is too low an echelon (${node.echelon})`,
          detail: `The root of an ORBAT must be a formation (company or higher). "${node.name}" at echelon "${node.echelon}" is too low.`,
          unitIds: [node.id],
          unitNames: [node.name],
          autoFix: {
            label: `Promote to Company`,
            description: `Set "${node.name}" echelon to "company" — the minimum valid root echelon.`,
            apply: () => [
              {
                unitId: node.id,
                patch: {
                  echelon: "company" as EchelonLevel,
                  symbol: {
                    ...node.symbol,
                    echelon: "company" as EchelonLevel,
                  },
                },
              },
            ],
          },
        });
      }
    }

    if (parent) {
      const skipLevels = pIdx - cIdx - 1; // 0 = adjacent, 1 = one skip, etc.

      // ── A-1: Echelon inversion ─────────────────────────────────────────────
      // Direction choice: strictly demote the CHILD to one below the parent.
      // We deliberately do NOT promote the parent — that would trigger a
      // cascade of G-2/G-3 recalculations on ancestors and can loop.
      // Fix suppressed entirely if the parent is at "team" (no lower echelon).
      if (!nodeIsHq && cIdx >= pIdx) {
        const targetIdx = pIdx - 1;
        const targetEchelon =
          targetIdx >= 0
            ? (ECHELON_ORDER[targetIdx] as EchelonLevel | undefined)
            : undefined;
        addViolation({
          code: "A-1",
          severity: "ERROR",
          message: `Echelon inversion: "${node.name}" (${node.echelon}) under "${parent.name}" (${parent.echelon})`,
          detail: `A child's echelon must be strictly below its parent's. "${node.name}" (${node.echelon}, index ${cIdx}) is at the same or higher echelon than "${parent.name}" (${parent.echelon}, index ${pIdx}).`,
          unitIds: [node.id, parent.id],
          unitNames: [node.name, parent.name],
          autoFix: targetEchelon
            ? {
                label: `Demote "${node.name}" to ${targetEchelon}`,
                description: `Set "${node.name}" echelon from "${node.echelon}" to "${targetEchelon}" (one below "${parent.echelon}").`,
                apply: () => [
                  {
                    unitId: node.id,
                    patch: {
                      echelon: targetEchelon,
                      symbol: { ...node.symbol, echelon: targetEchelon },
                    },
                  },
                ],
              }
            : undefined,
        });
      }

      // ── A-2: Echelon skip ─────────────────────────────────────────────────
      if (!nodeIsHq && skipLevels === 1) {
        addViolation({
          code: "A-2",
          severity: "WARNING",
          message: `Echelon skip: "${parent.name}" (${parent.echelon}) → "${node.name}" (${node.echelon})`,
          detail: `Skipping one echelon level is legitimate but worth reviewing. "${parent.name}" at ${parent.echelon} directly commands "${node.name}" at ${node.echelon}.`,
          unitIds: [node.id, parent.id],
          unitNames: [node.name, parent.name],
        });
      }

      // ── A-3: Deep echelon skip ────────────────────────────────────────────
      if (!nodeIsHq && skipLevels >= 2) {
        addViolation({
          code: "A-3",
          severity: "WARNING",
          message: `Deep echelon skip (${skipLevels + 1} levels): "${
            parent.name
          }" → "${node.name}"`,
          detail: `Skipping more than two echelon levels (${parent.echelon} → ${node.echelon}) almost always indicates a missing intermediate node in the hierarchy.`,
          unitIds: [node.id, parent.id],
          unitNames: [node.name, parent.name],
        });
      }

      // ── A-4: Equal-echelon containment ───────────────────────────────────
      // A-1 already fires for cIdx >= pIdx which includes equality — we
      // could skip A-4 to avoid two overlapping fixes on the same unit.
      // Keeping A-4 as INFO-only when A-1 is already active on this pair.
      if (!nodeIsHq && cIdx === pIdx) {
        addViolation({
          code: "A-4",
          severity: "INFO",
          message: `Equal-echelon containment: "${node.name}" (${node.echelon}) under "${parent.name}" (${parent.echelon})`,
          detail: `A unit may not contain a child of the same echelon. This is already covered by A-1 (echelon inversion) — apply the A-1 fix to resolve both.`,
          unitIds: [node.id, parent.id],
          unitNames: [node.name, parent.name],
          // No autoFix — A-1's fix resolves this case
        });
      }

      // ── E-1 / E-3: Affiliation ────────────────────────────────────────────
      const nodeAff = node.symbol?.standardIdentity ?? affiliation;
      const parentAff = parent.symbol?.standardIdentity ?? affiliation;
      const opposingSides =
        (parentAff === "friend" && nodeAff === "hostile") ||
        (parentAff === "hostile" && nodeAff === "friend") ||
        (parentAff === "neutral" && nodeAff === "hostile") ||
        (parentAff === "hostile" && nodeAff === "neutral");
      if (opposingSides) {
        addViolation({
          code: "E-1",
          severity: "ERROR",
          message: `Affiliation conflict: "${nodeAff}" unit under "${parentAff}" parent`,
          detail: `"${node.name}" (${nodeAff}) is a child of "${parent.name}" (${parentAff}). Opposing-side units may not appear in the same command chain.`,
          unitIds: [node.id, parent.id],
          unitNames: [node.name, parent.name],
          // Fix: align the child's affiliation to match the parent
          autoFix: {
            label: `Set "${node.name}" affiliation to "${parentAff}"`,
            description: `Change "${node.name}" standardIdentity from "${nodeAff}" to "${parentAff}" to match its parent.`,
            apply: () => [
              {
                unitId: node.id,
                patch: {
                  symbol: { ...node.symbol, standardIdentity: parentAff },
                },
              },
            ],
          },
        });
      }

      // ── B-1: HQ echelon must match formation ─────────────────────────────
      if (nodeIsHq && node.children.length > 0) {
        // If HQ commands children that are all of a higher echelon than the HQ, it's misconfigured
        const childEchelons = node.children.map(
          (c) => ECHELON_INDEX[c.echelon]
        );
        const maxChildIdx = Math.max(...childEchelons);
        if (cIdx <= maxChildIdx) {
          const neededIdx = maxChildIdx + 1;
          const neededEchelon = ECHELON_ORDER[neededIdx] as
            | EchelonLevel
            | undefined;
          addViolation({
            code: "B-1",
            severity: "ERROR",
            message: `HQ echelon too low: "${node.name}" (${node.echelon}) commands ${node.echelon}+ units`,
            detail: `An HQ commanding a formation must carry the formation's echelon. "${node.name}" at ${node.echelon} commands children up to echelon index ${maxChildIdx}, which is at or above the HQ echelon.`,
            unitIds: [node.id],
            unitNames: [node.name],
            autoFix: neededEchelon
              ? {
                  label: `Promote HQ to ${neededEchelon}`,
                  description: `Set "${node.name}" echelon to "${neededEchelon}" so it is above its highest-echelon child.`,
                  apply: () => [
                    {
                      unitId: node.id,
                      patch: {
                        echelon: neededEchelon,
                        symbol: { ...node.symbol, echelon: neededEchelon },
                      },
                    },
                  ],
                }
              : undefined,
          });
        }
      }

      // ── C-2: Suspicious function pairing ─────────────────────────────────
      const nodeIcon = node.symbol?.icon ?? "generic";
      const parentIcon = parent.symbol?.icon ?? "generic";
      const nodeIsManoeuvre = isManoeuvreIcon(nodeIcon);
      const parentIsLogSigMed = isLogSigMedIcon(parentIcon);
      if (nodeIsManoeuvre && parentIsLogSigMed) {
        addViolation({
          code: "C-2",
          severity: "WARNING",
          message: `Suspicious pairing: "${nodeIcon}" unit under "${parentIcon}" parent`,
          detail: `"${node.name}" (${nodeIcon}) is a manoeuvre unit placed under "${parent.name}" which is a ${parentIcon} unit. This usually indicates a mis-drop. Combined arms is fine (C-1), but manoeuvre under logistics/signals/medical is suspect.`,
          unitIds: [node.id, parent.id],
          unitNames: [node.name, parent.name],
        });
      }
    }

    // ── B-3: Single HQ per formation ─────────────────────────────────────────
    const hqChildren = node.children.filter(isHqNode);
    if (hqChildren.length > 1) {
      addViolation({
        code: "B-3",
        severity: "WARNING",
        message: `Multiple HQs under "${node.name}" (${hqChildren.length} found)`,
        detail: `"${node.name}" has ${
          hqChildren.length
        } HQ/command nodes: ${hqChildren
          .map((h) => `"${h.name}"`)
          .join(", ")}. Each formation should have exactly one HQ.`,
        unitIds: [node.id, ...hqChildren.map((h) => h.id)],
        unitNames: [node.name, ...hqChildren.map((h) => h.name)],
      });
    }

    // ── A-5: Sibling echelon inconsistency ────────────────────────────────────
    if (node.children.length >= 3) {
      const echelons = node.children.map((c) => ECHELON_INDEX[c.echelon]);
      const median = echelons.slice().sort((a, b) => a - b)[
        Math.floor(echelons.length / 2)
      ];
      for (const child of node.children) {
        if (Math.abs(ECHELON_INDEX[child.echelon] - median) >= 2) {
          addViolation({
            code: "A-5",
            severity: "WARNING",
            message: `Sibling echelon outlier: "${child.name}" (${child.echelon}) among ${node.echelon} children`,
            detail: `Most children of "${
              node.name
            }" are around echelon index ${median}, but "${
              child.name
            }" is at index ${
              ECHELON_INDEX[child.echelon]
            }. This unit may be misplaced.`,
            unitIds: [child.id, node.id],
            unitNames: [child.name, node.name],
          });
        }
      }
    }

    // ── G-2: Parent total not less than children sum ──────────────────────────
    // Evaluated BEFORE G-3 so we can suppress G-3 on the same unit when G-2
    // is active (G-3 "too high" would fight G-2 if both offered fixes).
    const childrenPax = node.children.reduce((s, c) => s + c.personnelCount, 0);
    const hasG2 = node.personnelCount > 0 && childrenPax > node.personnelCount;
    if (hasG2) {
      // Find the echelon whose upper-band comfortably covers childrenPax.
      // Walk up from the current echelon until we find a band that fits, or
      // land on the current echelon + 1 if the current one is just miscounted.
      let promoteTo: EchelonLevel | undefined;
      const currentIdx = ECHELON_INDEX[node.echelon];
      for (let i = currentIdx; i < ECHELON_ORDER.length; i++) {
        const echelon = ECHELON_ORDER[i] as EchelonLevel;
        const [, hi] = STRENGTH_BANDS[echelon];
        if (hi === Infinity || childrenPax <= hi) {
          // Only suggest promotion if we actually need to go higher
          promoteTo = i > currentIdx ? echelon : undefined;
          break;
        }
      }

      const needsPromotion = promoteTo !== undefined;

      addViolation({
        code: "G-2",
        severity: "ERROR",
        message: `Strength undercount: "${node.name}" organic=${node.personnelCount} but children sum=${childrenPax}`,
        detail: `"${node.name}" has organic strength ${
          node.personnelCount
        } but its children total ${childrenPax}. The fix sets the parent strength to ${childrenPax}${
          needsPromotion
            ? ` and promotes the echelon to ${promoteTo} so the strength is consistent with the formation size`
            : ""
        }.`,
        unitIds: [node.id],
        unitNames: [node.name],
        autoFix: {
          label: needsPromotion
            ? `Set strength to ${childrenPax} & promote to ${promoteTo}`
            : `Set strength to ${childrenPax}`,
          description: needsPromotion
            ? `Update "${node.name}" personnelCount to ${childrenPax} and echelon to "${promoteTo}" — both changes together ensure no further G-3 violation fires.`
            : `Update "${node.name}" personnelCount from ${node.personnelCount} to ${childrenPax} to match the children's combined total.`,
          apply: () => {
            const patch: Partial<UnitNode> = { personnelCount: childrenPax };
            if (needsPromotion) {
              patch.echelon = promoteTo;
              patch.symbol = { ...node.symbol, echelon: promoteTo! };
            }
            return [{ unitId: node.id, patch }];
          },
        },
      });
    }

    // ── G-3: Echelon-typical strength bands ──────────────────────────────────
    // Skipped for "too high" when G-2 is also active on the same node —
    // the G-2 fix already resolves the apparent over-strength by bumping the
    // parent to match its children. Showing a "cap to X" fix alongside the
    // "set to Y" fix causes them to toggle each other endlessly.
    const pax = node.personnelCount;
    if (pax > 0) {
      const [lo, hi] = STRENGTH_BANDS[node.echelon];

      if (pax < lo * 0.5) {
        // "Too low" — safe to auto-fix regardless of G-2 state.
        // (G-2 only fires when children > parent, not when parent is just small.)
        addViolation({
          code: "G-3",
          severity: "WARNING",
          message: `Strength too low: "${node.name}" (${node.echelon}) has ${pax} pax`,
          detail: `A ${node.echelon} typically has ${lo}–${
            hi === Infinity ? `${lo}+` : hi
          } personnel. "${
            node.name
          }" has only ${pax}, below 50% of the lower bound.`,
          unitIds: [node.id],
          unitNames: [node.name],
          autoFix: {
            label: `Set strength to ${lo} (echelon minimum)`,
            description: `Update "${node.name}" personnelCount from ${pax} to ${lo}, the lower bound for a ${node.echelon}.`,
            apply: () => [{ unitId: node.id, patch: { personnelCount: lo } }],
          },
        });
      } else if (hi !== Infinity && pax > hi * 1.5) {
        // "Too high" — the naive fix is to cap pax to `hi`, but if this unit
        // has children whose sum already exceeds `hi`, capping would immediately
        // re-trigger G-2, which would then re-inflate pax, which would then
        // re-trigger G-3 → infinite loop.
        //
        // Resolution:
        //   • If G-2 is NOT active and children sum ≤ hi → safe to cap
        //   • Otherwise → promote the echelon (single, terminal fix)
        //   • Otherwise (already at highest echelon) → INFO only, no fix
        if (!hasG2 && childrenPax <= hi) {
          addViolation({
            code: "G-3",
            severity: "WARNING",
            message: `Strength too high: "${node.name}" (${node.echelon}) has ${pax} pax`,
            detail: `A ${node.echelon} typically has ${lo}–${hi} personnel. "${node.name}" has ${pax}, well above the upper bound. Consider raising the echelon or reducing personnel.`,
            unitIds: [node.id],
            unitNames: [node.name],
            autoFix: {
              label: `Cap strength to ${hi} (echelon maximum)`,
              description: `Update "${node.name}" personnelCount from ${pax} to ${hi}, the upper bound for a ${node.echelon}.`,
              apply: () => [{ unitId: node.id, patch: { personnelCount: hi } }],
            },
          });
        } else {
          // Capping would trigger G-2. Try to find an echelon whose upper
          // band comfortably covers this unit's pax AND its children's sum.
          const targetPax = Math.max(pax, childrenPax);
          let promoteTo: EchelonLevel | undefined;
          const currentIdx = ECHELON_INDEX[node.echelon];
          for (let i = currentIdx + 1; i < ECHELON_ORDER.length; i++) {
            const ech = ECHELON_ORDER[i] as EchelonLevel;
            const [, ehi] = STRENGTH_BANDS[ech];
            if (ehi === Infinity || targetPax <= ehi) {
              promoteTo = ech;
              break;
            }
          }

          if (promoteTo) {
            addViolation({
              code: "G-3",
              severity: "WARNING",
              message: `Strength too high: "${node.name}" (${node.echelon}) has ${pax} pax`,
              detail: `A ${node.echelon} typically has ${lo}–${hi} personnel. "${node.name}" has ${pax} pax with ${childrenPax} in children. Capping would fight the G-2 rule — promoting the echelon to "${promoteTo}" resolves both.`,
              unitIds: [node.id],
              unitNames: [node.name],
              autoFix: {
                label: `Promote to ${promoteTo}`,
                description: `Set "${node.name}" echelon from "${node.echelon}" to "${promoteTo}" so its ${pax}-pax strength (and ${childrenPax}-pax children total) is consistent with the formation size.`,
                apply: () => [
                  {
                    unitId: node.id,
                    patch: {
                      echelon: promoteTo,
                      symbol: { ...node.symbol, echelon: promoteTo! },
                    },
                  },
                ],
              },
            });
          } else {
            // Already at the highest echelon — nothing sensible to fix
            addViolation({
              code: "G-3",
              severity: "INFO",
              message: `Strength exceeds ${node.echelon} band — no higher echelon available`,
              detail: `"${node.name}" has ${pax} pax which exceeds the ${node.echelon} upper bound (${hi}), but there is no higher echelon to promote to. This is likely intentional or a data-entry issue.`,
              unitIds: [node.id],
              unitNames: [node.name],
            });
          }
        }
      }
    }

    // ── H-1: Excessive span ───────────────────────────────────────────────────
    if (node.children.length > 10) {
      addViolation({
        code: "H-1",
        severity: "WARNING",
        message: `Excessive span: "${node.name}" has ${node.children.length} direct children`,
        detail: `"${node.name}" has ${node.children.length} direct subordinates. More than 7–10 children of the same type usually signals a missing intermediate echelon.`,
        unitIds: [node.id],
        unitNames: [node.name],
      });
    }

    // ── H-2: Single-child chain ───────────────────────────────────────────────
    if (node.children.length === 1) {
      let cur: UnitNode = node;
      let chainLength = 0;
      while (cur.children.length === 1) {
        cur = cur.children[0];
        chainLength++;
      }
      if (chainLength >= 3) {
        addViolation({
          code: "H-2",
          severity: "WARNING",
          message: `Single-child chain of ${chainLength} from "${node.name}"`,
          detail: `"${node.name}" starts a chain of ${chainLength} units where each has exactly one child. This is usually a modelling artefact and should be collapsed or reviewed.`,
          unitIds: [node.id],
          unitNames: [node.name],
        });
      }
    }

    // ── F-4: Leaf nodes ───────────────────────────────────────────────────────
    if (
      node.children.length === 0 &&
      ECHELON_INDEX[node.echelon] >= ECHELON_INDEX["battalion"]
    ) {
      addViolation({
        code: "F-4",
        severity: "WARNING",
        message: `Large formation with no children: "${node.name}" (${node.echelon})`,
        detail: `"${node.name}" is a ${node.echelon} with no subordinate units. This is probably incomplete — a formation of this size should have at least some sub-units modelled.`,
        unitIds: [node.id],
        unitNames: [node.name],
      });
    }

    // ── J-4: Organisation nodes without SIDC ─────────────────────────────────
    if (!node.symbol?.sidc) {
      addViolation({
        code: "J-4",
        severity: "WARNING",
        message: `No SIDC on "${node.name}"`,
        detail: `"${node.name}" has no Symbol Identification Code (SIDC). It will not render correctly on map overlays. Open the unit editor to generate or enter a valid SIDC.`,
        unitIds: [node.id],
        unitNames: [node.name],
        // No autoFix — SIDC generation requires the full symbol builder context
      });
    }

    // Recurse
    for (const child of node.children) walk(child, node);
  }

  for (const root of roots) walk(root, null);

  // Deduplicate by code+unitIds
  const seen = new Set<string>();
  return violations.filter((v) => {
    const key = `${v.code}:${v.unitIds.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Quick summary helpers ────────────────────────────────────────────────────

export function countBySeverity(violations: RuleViolation[]) {
  return {
    errors: violations.filter((v) => v.severity === "ERROR" && !v.dismissed)
      .length,
    warnings: violations.filter((v) => v.severity === "WARNING" && !v.dismissed)
      .length,
    info: violations.filter((v) => v.severity === "INFO" && !v.dismissed)
      .length,
  };
}

/** Count how many active (non-dismissed) violations have an autoFix */
export function countAutoFixable(violations: RuleViolation[]): number {
  return violations.filter((v) => !v.dismissed && v.autoFix).length;
}
