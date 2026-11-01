// ============================================================
//  Auto-Relationship Engine — Points-Based Scoring System
// ============================================================
//
//  Architecture
//  ────────────
//  STEP 1 — Hard-rule elimination
//    Candidate (child → parent) pairings that violate any hard
//    rule are discarded entirely before scoring begins.
//
//  STEP 2 — Points scoring
//    Each surviving pairing receives an additive score defined
//    in POINTS.  Higher is always better.
//
//  STEP 3 — Unit prioritisation
//    When multiple units compete for the same parent slot, the
//    unit whose best surviving score is highest is assigned
//    first (preferential treatment).
//    Tie-breaking order:
//      a) Higher best-candidate score
//      b) Simpler subtree (fewer total descendants)
//      c) Alphabetical by unit name
//
//  STEP 4 — Sequential assignment
//    Units are processed in priority order.  Each assignment
//    increments that parent's pending child-count, which feeds
//    back into the span-of-control scoring for later units.
//
//  Hard rules (eliminate — never overridden by points)
//  ────────────────────────────────────────────────────
//  HR-A1   Child echelon must be strictly below parent
//  HR-A4   Equal-echelon containment is forbidden
//  HR-A3X  Skip of more than 2 echelon levels is prohibited
//  HR-F1   No cycles (child cannot be an ancestor of parent)
//  HR-E1   Opposing-side affiliations cannot share a chain
//
//  Scoring rules (additive)
//  ────────────────────────
//  +50  Adjacent echelon (0 skip — ideal)
//  +30  One-level skip (A-2 warn, structurally valid)
//  +10  Two-level skip (A-3 warn, last resort)
//  +20  Parent is an HQ / command node
//  +10  Parent has ≤ 3 pending children (balanced span)
//   −5  Parent has 4–6 pending children (moderate span)
//  −15  Parent has 7–10 pending children (heavy span)
//  −30  Parent has >10 pending children (H-1 territory)
//  +10  Icon/function type compatible (manoeuvre under manoeuvre, etc.)
//   −5  Suspicious pairing (manoeuvre under log/med/sig)
//   +5  Same affiliation as parent
//   +5  Personnel count within the expected child band for parent echelon
// ============================================================

import type { UnitNode, EchelonLevel, StandardIdentity } from "./types.js";
import { ECHELON_INDEX } from "./types.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ScoredCandidate {
  parent: UnitNode;
  /** Raw total points */
  score: number;
  /** Echelon distance (0 = adjacent) */
  skipLevels: number;
  /** Human-readable per-factor breakdown */
  breakdown: string[];
  /** True only on the winning candidate */
  isBest?: boolean;
}

export interface RelationshipProposal {
  child: UnitNode;
  /** null → unit stays as root */
  parent: UnitNode | null;
  /** Score of the winning candidate (0 when root) */
  score: number;
  /** Plain-English summary of the decision */
  reason: string;
  skipLevels: number;
  /** All surviving candidates, best first */
  candidates: ScoredCandidate[];
  /** Candidates removed by hard rules */
  eliminations: Array<{ candidateName: string; rule: string; reason: string }>;
}

// ─── Scoring constants ────────────────────────────────────────────────────────

const POINTS = {
  adjacentEchelon:     50,
  oneSkip:             30,
  twoSkip:             10,
  hqBonus:             20,
  fewChildren:         10,   // ≤ 3 children
  mildSpan:            -5,   // 4–6 children
  heavySpan:          -15,   // 7–10 children
  excessiveSpan:      -30,   // > 10 children
  functionCompat:      10,
  functionSuspicious:  -5,
  sameAffiliation:      5,
  strengthBandFit:      5,
} as const;

const MAX_SKIP = 2;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isHq(unit: UnitNode): boolean {
  const name = unit.name.toLowerCase();
  const icon = unit.symbol?.icon ?? "";
  return icon === "headquarters" || /\bhq\b|\bheadquarters?\b|\bcommand\b/.test(name);
}

const MANOEUVRE_ICONS = new Set([
  "infantry", "armour", "mechanisedInfantry", "cavalry",
  "reconnaissance", "specialForces", "aviation", "airForce",
]);
const LOGSIGMED_ICONS = new Set([
  "logistics", "signals", "medical", "maintenance",
]);

function iconGroup(icon: string): "manoeuvre" | "logsigmed" | "other" {
  if (MANOEUVRE_ICONS.has(icon)) return "manoeuvre";
  if (LOGSIGMED_ICONS.has(icon)) return "logsigmed";
  return "other";
}

/** Existing children + pending assignments that target this parent */
function pendingChildCount(
  parentId: string,
  parent: UnitNode,
  assignments: Map<string, string>,
): number {
  let pending = 0;
  for (const pid of assignments.values()) {
    if (pid === parentId) pending++;
  }
  return parent.children.length + pending;
}

/** Transitive ancestor check in the pending assignments map */
function isAssignedChildOf(
  unitId: string,
  ancestorId: string,
  assignments: Map<string, string>,
): boolean {
  let cur = assignments.get(unitId);
  while (cur !== undefined) {
    if (cur === ancestorId) return true;
    cur = assignments.get(cur);
  }
  return false;
}

/** Total number of descendants (recursive) */
function descendantCount(unit: UnitNode): number {
  let n = 0;
  const walk = (u: UnitNode) => { n += u.children.length; u.children.forEach(walk); };
  walk(unit);
  return n;
}

/** Expected personnel band for a child of the given parent echelon */
const CHILD_BAND: Record<EchelonLevel, [number, number]> = {
  team:      [0,       0],
  squad:     [2,       4],
  section:   [8,      12],
  platoon:   [9,      15],
  company:   [20,     50],
  battalion: [50,    250],
  regiment:  [100,   500],
  brigade:   [100,   500],
  division:  [300,  1200],
  corps:     [1000, 5000],
  army:      [5000,  Infinity],
  armyGroup: [10000, Infinity],
  theatre:   [20000, Infinity],
};

// ─── Hard-rule checker ────────────────────────────────────────────────────────

interface HardRuleResult {
  eliminated: boolean;
  rule?: string;
  reason?: string;
}

function checkHardRules(
  child: UnitNode,
  parent: UnitNode,
  skipLevels: number,
  assignments: Map<string, string>,
  defaultAffiliation: StandardIdentity,
): HardRuleResult {
  const cIdx = ECHELON_INDEX[child.echelon];
  const pIdx = ECHELON_INDEX[parent.echelon];

  // HR-A1 / HR-A4 — echelon ordering (covers equal and inverted cases)
  if (cIdx >= pIdx) {
    return {
      eliminated: true, rule: "HR-A1",
      reason: `"${child.echelon}" is not strictly below "${parent.echelon}"`,
    };
  }

  // HR-A3X — skip ceiling
  if (skipLevels > MAX_SKIP) {
    return {
      eliminated: true, rule: "HR-A3X",
      reason: `Skip of ${skipLevels} levels exceeds the maximum of ${MAX_SKIP}`,
    };
  }

  // HR-F1 — cycle prevention (both directions)
  if (isAssignedChildOf(child.id, parent.id, assignments)) {
    return {
      eliminated: true, rule: "HR-F1",
      reason: `Cycle: "${child.name}" is already an ancestor of "${parent.name}"`,
    };
  }
  if (isAssignedChildOf(parent.id, child.id, assignments)) {
    return {
      eliminated: true, rule: "HR-F1",
      reason: `Cycle: "${parent.name}" is already an ancestor of "${child.name}"`,
    };
  }

  // HR-E1 — opposing affiliations
  const childAff  = child.symbol?.standardIdentity  ?? defaultAffiliation;
  const parentAff = parent.symbol?.standardIdentity ?? defaultAffiliation;
  const opposing =
    (parentAff === "friend"  && childAff === "hostile") ||
    (parentAff === "hostile" && childAff === "friend")  ||
    (parentAff === "neutral" && childAff === "hostile") ||
    (parentAff === "hostile" && childAff === "neutral");
  if (opposing) {
    return {
      eliminated: true, rule: "HR-E1",
      reason: `"${childAff}" unit cannot be subordinate to a "${parentAff}" parent`,
    };
  }

  return { eliminated: false };
}

// ─── Candidate scoring ────────────────────────────────────────────────────────

function scoreCandidate(
  child: UnitNode,
  parent: UnitNode,
  skipLevels: number,
  assignments: Map<string, string>,
): ScoredCandidate {
  let score = 0;
  const breakdown: string[] = [];

  // Echelon proximity
  if (skipLevels === 0) {
    score += POINTS.adjacentEchelon;
    breakdown.push(`+${POINTS.adjacentEchelon} Adjacent echelon (ideal)`);
  } else if (skipLevels === 1) {
    score += POINTS.oneSkip;
    breakdown.push(`+${POINTS.oneSkip} One-level skip (A-2, valid)`);
  } else {
    score += POINTS.twoSkip;
    breakdown.push(`+${POINTS.twoSkip} Two-level skip (A-3, last resort)`);
  }

  // HQ / command node bonus
  if (isHq(parent)) {
    score += POINTS.hqBonus;
    breakdown.push(`+${POINTS.hqBonus} Parent is HQ / command node`);
  }

  // Span-of-control
  const children = pendingChildCount(parent.id, parent, assignments);
  if (children <= 3) {
    score += POINTS.fewChildren;
    breakdown.push(`+${POINTS.fewChildren} Parent has ${children} children (balanced)`);
  } else if (children <= 6) {
    score += POINTS.mildSpan;
    breakdown.push(`${POINTS.mildSpan} Parent has ${children} children (moderate span)`);
  } else if (children <= 10) {
    score += POINTS.heavySpan;
    breakdown.push(`${POINTS.heavySpan} Parent has ${children} children (heavy span)`);
  } else {
    score += POINTS.excessiveSpan;
    breakdown.push(`${POINTS.excessiveSpan} Parent has ${children} children (H-1 territory)`);
  }

  // Function / icon compatibility
  const childGroup  = iconGroup(child.symbol?.icon  ?? "");
  const parentGroup = iconGroup(parent.symbol?.icon ?? "");
  if (childGroup === parentGroup && childGroup !== "other") {
    score += POINTS.functionCompat;
    breakdown.push(`+${POINTS.functionCompat} Compatible function types (${childGroup})`);
  } else if (childGroup === "manoeuvre" && parentGroup === "logsigmed") {
    score += POINTS.functionSuspicious;
    breakdown.push(`${POINTS.functionSuspicious} Suspicious pairing: manoeuvre under ${parentGroup}`);
  }

  // Affiliation match
  const childAff  = child.symbol?.standardIdentity;
  const parentAff = parent.symbol?.standardIdentity;
  if (childAff && parentAff && childAff === parentAff) {
    score += POINTS.sameAffiliation;
    breakdown.push(`+${POINTS.sameAffiliation} Same affiliation`);
  }

  // Personnel strength band
  const pax = child.personnelCount ?? 0;
  if (pax > 0) {
    const [lo, hi] = CHILD_BAND[parent.echelon];
    if (pax >= lo && (hi === Infinity || pax <= hi)) {
      score += POINTS.strengthBandFit;
      breakdown.push(`+${POINTS.strengthBandFit} Personnel count within expected band for ${parent.echelon}`);
    }
  }

  return { parent, score, skipLevels, breakdown };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Compute auto-relationship proposals for a pool of units.
 *
 * Algorithm:
 *   1. For each unit, generate every possible (child → parent) pair.
 *   2. Eliminate pairs that violate a hard rule.
 *   3. Score surviving pairs.
 *   4. Determine each unit's best achievable score (used for priority ordering).
 *   5. Sort units by priority: echelon DESC → best score DESC →
 *      fewer descendants → name ASC.
 *   6. Assign in priority order, updating pending child-counts after each.
 *
 * @param pool              Units to structure (user selection)
 * @param allGroupUnits     All units in the group (reserved for future use)
 * @param affiliation       Default affiliation for HR-E1 when symbol is absent
 */
export function computeAutoRelationships(
  pool: UnitNode[],
  allGroupUnits: UnitNode[],
  affiliation: StandardIdentity = "unknown",
): RelationshipProposal[] {
  if (pool.length < 2) return [];

  // allGroupUnits is accepted for API compatibility; child counts come from
  // pool + pending assignments which are always up-to-date.
  void allGroupUnits;

  /** All pool members with strictly higher echelon than `unit` */
  const possibleParents = (unit: UnitNode): UnitNode[] =>
    pool.filter(
      p => p.id !== unit.id && ECHELON_INDEX[p.echelon] > ECHELON_INDEX[unit.echelon],
    );

  // ── Pass 1: compute each unit's best reachable score (empty assignments) ──
  // This is purely for priority ordering; it does not commit any assignments.
  const emptyAssignments = new Map<string, string>();

  function bestReachableScore(unit: UnitNode): number {
    let best = -Infinity;
    for (const p of possibleParents(unit)) {
      const skip = ECHELON_INDEX[p.echelon] - ECHELON_INDEX[unit.echelon] - 1;
      const hr = checkHardRules(unit, p, skip, emptyAssignments, affiliation);
      if (hr.eliminated) continue;
      const { score } = scoreCandidate(unit, p, skip, emptyAssignments);
      if (score > best) best = score;
    }
    return best === -Infinity ? 0 : best;
  }

  // ── Pass 2: build priority list ───────────────────────────────────────────
  interface Prioritised { unit: UnitNode; bestScore: number; descendants: number }

  const prioritised: Prioritised[] = pool.map(unit => ({
    unit,
    bestScore:   bestReachableScore(unit),
    descendants: descendantCount(unit),
  }));

  prioritised.sort((a, b) => {
    // Primary: echelon descending (ensures potential parents are always
    // encountered before their children during assignment)
    const echelonDiff =
      ECHELON_INDEX[b.unit.echelon] - ECHELON_INDEX[a.unit.echelon];
    if (echelonDiff !== 0) return echelonDiff;

    // Within the same echelon tier — preferential-treatment tiebreakers:
    // 1. Higher best-candidate score wins
    if (a.bestScore !== b.bestScore) return b.bestScore - a.bestScore;
    // 2. Simpler subtree (fewer descendants) wins
    if (a.descendants !== b.descendants) return a.descendants - b.descendants;
    // 3. Alphabetical by name
    return a.unit.name.localeCompare(b.unit.name);
  });

  // ── Pass 3: assign in priority order ─────────────────────────────────────
  const assignments = new Map<string, string>(); // childId → parentId
  const proposals:   RelationshipProposal[] = [];

  for (const { unit } of prioritised) {
    const parents = possibleParents(unit);

    // No higher-echelon units available → root
    if (parents.length === 0) {
      proposals.push({
        child: unit, parent: null, score: 0,
        reason:     "Highest echelon in selection — remains as root",
        skipLevels: 0,
        candidates:   [],
        eliminations: [],
      });
      continue;
    }

    const surviving:   ScoredCandidate[] = [];
    const eliminations: RelationshipProposal["eliminations"] = [];

    for (const p of parents) {
      const skip = ECHELON_INDEX[p.echelon] - ECHELON_INDEX[unit.echelon] - 1;
      const hr   = checkHardRules(unit, p, skip, assignments, affiliation);

      if (hr.eliminated) {
        eliminations.push({ candidateName: p.name, rule: hr.rule!, reason: hr.reason! });
        continue;
      }

      surviving.push(scoreCandidate(unit, p, skip, assignments));
    }

    // All candidates eliminated → root
    if (surviving.length === 0) {
      proposals.push({
        child: unit, parent: null, score: 0,
        reason:     "All candidates eliminated by hard rules — remains as root",
        skipLevels: 0,
        candidates:   [],
        eliminations,
      });
      continue;
    }

    // Sort surviving candidates: highest score first; tiebreak by fewest
    // pending children (span balance), then parent name alphabetically
    surviving.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const ac = pendingChildCount(a.parent.id, a.parent, assignments);
      const bc = pendingChildCount(b.parent.id, b.parent, assignments);
      if (ac !== bc) return ac - bc;
      return a.parent.name.localeCompare(b.parent.name);
    });

    surviving[0].isBest = true;
    const best = surviving[0];

    let reason: string;
    if (best.skipLevels === 0) {
      reason = `"${best.parent.name}" (${best.parent.echelon}) — adjacent echelon, score ${best.score}`;
    } else if (best.skipLevels === 1) {
      reason = `"${best.parent.name}" (${best.parent.echelon}) — one-level skip, score ${best.score}`;
    } else {
      reason = `"${best.parent.name}" (${best.parent.echelon}) — two-level skip, score ${best.score} (last resort)`;
    }

    assignments.set(unit.id, best.parent.id);

    proposals.push({
      child:     unit,
      parent:    best.parent,
      score:     best.score,
      reason,
      skipLevels: best.skipLevels,
      candidates: surviving,
      eliminations,
    });
  }

  return proposals;
}
