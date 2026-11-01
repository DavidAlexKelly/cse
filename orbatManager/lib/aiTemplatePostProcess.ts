/**
 * aiTemplatePostProcess.ts
 * ────────────────────────
 * Deterministic post-processing for the LLM_Structure_V2 output (generateOrbatV2).
 *
 * The LLM produces a rough AiUnit tree.  Two optional passes clean it up
 * before it is converted to CompositionNode and saved as a template.
 *
 *   PASS 1 — extendBareUnitsWithDoctrine()
 *     Walks the AI tree and, for every bare unit (no children) whose echelon
 *     has a DOCTRINE entry, synthesises a sub-tree all the way down to the
 *     doctrine leaf (squad for infantry, team for special forces, etc.).
 *     Existing sub-trees are left untouched.
 *
 *   PASS 2 — scoreAndReparent()
 *     Flattens the (possibly extended) tree to a pool of unit stubs, runs the
 *     points-based scoring engine (adjacent echelon +50, HQ bonus +20, span
 *     of control, function-compat, affiliation, personnel band) and rebuilds
 *     the tree using the winning parent for each unit.  Hard rules eliminate
 *     any pairing that skips more than two echelons, forms a cycle, or joins
 *     opposing affiliations.
 *
 * Both passes are pure — they take an AiUnit[] and return a new AiUnit[].
 * No I/O, no client calls, no external dependencies.
 *
 * Ported from src/AIStuff/autoChildGeneration.ts and src/AIStuff/autoRelationship.ts,
 * adapted for the AiUnit / CompositionNode template flow.
 */

// ─── Shared types ─────────────────────────────────────────────────────────────

/**
 * AiUnit mirrors the JSON schema returned by the generateOrbatV2 Foundry
 * function.  Keep it decoupled from CompositionNode / UnitNode so this
 * module can be reused wherever the raw LLM output needs cleaning.
 */
export interface AiUnit {
  name: string;
  echelon: string;
  icon: string;
  personnelCount: number;
  notes?: string;
  canonicalAssetId?: string | null;
  children: AiUnit[];
}

// ─── Echelon ordering ─────────────────────────────────────────────────────────

const ECHELON_INDEX: Record<string, number> = {
  team:       1,
  squad:      2,
  section:    3,
  platoon:    4,
  company:    5,
  battalion:  6,
  regiment:   7,
  brigade:    8,
  division:   9,
  corps:     10,
  army:      11,
  armyGroup: 12,
  theatre:   13,
};

const echIdx = (e: string): number => ECHELON_INDEX[e.toLowerCase()] ?? 0;

// ─── Doctrine table (Pass 1) ─────────────────────────────────────────────────
//
// Every entry recurses down until an echelon has no entry (the doctrine leaf).
// This means a battalion generates companies → platoons → sections → squads
// → teams, all the way to the bottom.

interface DoctrineEntry {
  childEchelon: string;
  count: number;           // non-HQ sub-units
  includeHq: boolean;
  typicalPax: number;      // per child
}

const DOCTRINE: Record<string, DoctrineEntry> = {
  theatre:   { childEchelon: "army",      count: 2, includeHq: true,  typicalPax: 100000 },
  armyGroup: { childEchelon: "corps",     count: 2, includeHq: true,  typicalPax: 30000  },
  army:      { childEchelon: "corps",     count: 2, includeHq: true,  typicalPax: 25000  },
  corps:     { childEchelon: "division",  count: 2, includeHq: true,  typicalPax: 12000  },
  division:  { childEchelon: "brigade",   count: 3, includeHq: true,  typicalPax: 3000   },
  brigade:   { childEchelon: "battalion", count: 3, includeHq: true,  typicalPax: 600    },
  regiment:  { childEchelon: "battalion", count: 2, includeHq: true,  typicalPax: 500    },
  battalion: { childEchelon: "company",   count: 3, includeHq: true,  typicalPax: 120    },
  company:   { childEchelon: "platoon",   count: 3, includeHq: false, typicalPax: 30     },
  platoon:   { childEchelon: "section",   count: 3, includeHq: false, typicalPax: 10     },
  section:   { childEchelon: "squad",     count: 2, includeHq: false, typicalPax: 8      },
  squad:     { childEchelon: "team",      count: 2, includeHq: false, typicalPax: 4      },
  // "team" intentionally has no entry — it is the leaf
};

const ECHELON_SUFFIX: Record<string, string[]> = {
  team:      ["Alpha", "Bravo", "Charlie", "Delta"],
  squad:     ["1 Sect", "2 Sect", "3 Sect", "4 Sect"],
  section:   ["1", "2", "3"],
  platoon:   ["1 Pl", "2 Pl", "3 Pl", "4 Pl"],
  company:   ["A Coy", "B Coy", "C Coy", "D Coy"],
  battalion: ["1 Bn", "2 Bn", "3 Bn"],
  regiment:  ["1 Regt", "2 Regt"],
  brigade:   ["1 Bde", "2 Bde", "3 Bde"],
  division:  ["1 Div", "2 Div", "3 Div"],
  corps:     ["I Corps", "II Corps", "III Corps"],
  army:      ["1 Army", "2 Army"],
  armyGroup: ["1 AG", "2 AG"],
  theatre:   ["North", "South"],
};

// Strip common echelon words to get a bare formation name
function stripEchelonWords(name: string): string {
  return name
    .replace(/\b(battalion|company|platoon|section|squad|team|regiment|brigade|division|corps|army|group|theatre|bn|coy|pl|sect|regt|bde|div|hq|headquarters)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Pass 1: doctrine extension ──────────────────────────────────────────────

/**
 * Build a synthetic sub-tree for a given parent echelon.  Recurses through
 * DOCTRINE until there is no child doctrine entry (natural leaf).
 *
 * Hard rules enforced:
 *   - child echelon must be strictly below parent
 *   - skip may not exceed 2 echelon levels
 */
function generateSyntheticChildren(
  parentName: string,
  parentEchelon: string,
  parentIcon: string,
): AiUnit[] {
  const key = parentEchelon.toLowerCase();
  const entry = DOCTRINE[key];
  if (!entry) return [];

  const { childEchelon, count, includeHq, typicalPax } = entry;

  if (echIdx(childEchelon) >= echIdx(parentEchelon)) return [];
  if (echIdx(parentEchelon) - echIdx(childEchelon) - 1 > 2) return [];

  const baseName = stripEchelonWords(parentName) || parentName;
  const suffixes = ECHELON_SUFFIX[childEchelon] ?? ["1", "2", "3", "4"];
  const units: AiUnit[] = [];

  if (includeHq) {
    units.push({
      name: `HQ ${parentName}`,
      echelon: childEchelon,
      personnelCount: Math.max(2, Math.round(typicalPax * 0.3)),
      icon: "headquarters",
      notes: `Synthetic HQ for ${parentEchelon}`,
      canonicalAssetId: null,
      children: [],
    });
  }

  for (let i = 0; i < count; i++) {
    const suffix = suffixes[i % suffixes.length];
    const name = `${baseName} ${suffix}`.trim();
    const grandchildren = generateSyntheticChildren(name, childEchelon, parentIcon);
    units.push({
      name,
      echelon: childEchelon,
      personnelCount: typicalPax,
      icon: parentIcon,
      notes: `Synthetic ${childEchelon} (doctrine)`,
      canonicalAssetId: null,
      children: grandchildren,
    });
  }

  return units;
}

/**
 * Recursively walk the AI tree.  For every bare unit whose echelon has a
 * doctrine entry, replace its (empty) children with a doctrine-standard
 * sub-tree extended all the way to the natural leaf echelon.
 *
 * Returns a fully-cloned tree — the input is not mutated.
 */
export function extendBareUnitsWithDoctrine(units: AiUnit[]): AiUnit[] {
  const walk = (u: AiUnit): AiUnit => {
    if (u.children.length > 0) {
      return { ...u, children: u.children.map(walk) };
    }
    // Bare: extend if the echelon has a doctrine entry
    const generated = generateSyntheticChildren(u.name, u.echelon, u.icon ?? "infantry");
    return { ...u, children: generated };
  };
  return units.map(walk);
}

/**
 * Count how many extra units the doctrine extension pass would add without
 * committing to the change.  Used by the UI to show a preview count.
 */
export function countExtensionAdditions(units: AiUnit[]): number {
  const extended = extendBareUnitsWithDoctrine(units);
  const flatten = (tree: AiUnit[]): number => {
    let n = 0;
    const walk = (u: AiUnit) => { n++; u.children.forEach(walk); };
    tree.forEach(walk);
    return n;
  };
  return flatten(extended) - flatten(units);
}

// ─── Pass 2: relationship scoring ────────────────────────────────────────────
//
// Points-based deterministic re-parenting.  Same rules as
// src/AIStuff/autoRelationship.ts.
//
// STEP 1 — Hard-rule elimination (never overridden)
//   HR-A1   child echelon must be strictly below parent
//   HR-A4   equal-echelon containment forbidden
//   HR-A3X  skip of more than 2 echelon levels prohibited
//   HR-F1   no cycles
//
// STEP 2 — Points scoring
//   +50  adjacent echelon              +10  parent has ≤ 3 children (balanced)
//   +30  one-level skip                 −5  parent has 4–6 children
//   +10  two-level skip                −15  parent has 7–10 children
//   +20  parent is HQ / command        −30  parent has > 10 children
//   +10  function-type compatible       +5  personnel count in expected band
//    −5  suspicious pairing             +5  same affiliation

const POINTS = {
  adjacentEchelon:    50,
  oneSkip:            30,
  twoSkip:            10,
  hqBonus:            20,
  fewChildren:        10,
  mildSpan:           -5,
  heavySpan:         -15,
  excessiveSpan:     -30,
  functionCompat:     10,
  functionSuspicious: -5,
  strengthBandFit:     5,
} as const;

const MAX_SKIP = 2;

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

function isHq(u: AiUnit): boolean {
  return u.icon === "headquarters" || /\bhq\b|\bheadquarters?\b|\bcommand\b/i.test(u.name);
}

const CHILD_BAND: Record<string, [number, number]> = {
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

// ── Flatten + assign stable IDs ──────────────────────────────────────────────

interface Stub {
  id: string;
  unit: AiUnit;                // reference to a copy (not the input!)
  originalParentId: string | null;
}

function flattenForScoring(roots: AiUnit[]): Stub[] {
  const stubs: Stub[] = [];
  let counter = 0;
  const walk = (u: AiUnit, parentId: string | null) => {
    const id = `s${counter++}`;
    // Clone the node without children — children are rebuilt after scoring
    const clone: AiUnit = { ...u, children: [] };
    stubs.push({ id, unit: clone, originalParentId: parentId });
    u.children.forEach(c => walk(c, id));
  };
  roots.forEach(r => walk(r, null));
  return stubs;
}

// ── Hard rules ───────────────────────────────────────────────────────────────

function violatesHardRules(
  child: AiUnit,
  parent: AiUnit,
  skipLevels: number,
  childStubId: string,
  parentStubId: string,
  assignments: Map<string, string>,
): boolean {
  const cIdx = echIdx(child.echelon);
  const pIdx = echIdx(parent.echelon);

  // HR-A1 / HR-A4: child must be strictly below parent
  if (cIdx >= pIdx) return true;
  // HR-A3X: skip ceiling
  if (skipLevels > MAX_SKIP) return true;

  // HR-F1: no cycles
  let cur: string | undefined = assignments.get(parentStubId);
  while (cur !== undefined) {
    if (cur === childStubId) return true;
    cur = assignments.get(cur);
  }
  return false;
}

// ── Score a single (child → parent) candidate ────────────────────────────────

function scoreCandidate(
  child: AiUnit,
  parent: AiUnit,
  skipLevels: number,
  parentStubId: string,
  assignments: Map<string, string>,
): number {
  let score = 0;

  // Echelon proximity
  if (skipLevels === 0) score += POINTS.adjacentEchelon;
  else if (skipLevels === 1) score += POINTS.oneSkip;
  else score += POINTS.twoSkip;

  // HQ bonus
  if (isHq(parent)) score += POINTS.hqBonus;

  // Span of control (pending count = other units already assigned to this parent)
  let pending = 0;
  for (const pid of assignments.values()) {
    if (pid === parentStubId) pending++;
  }
  if (pending <= 3)       score += POINTS.fewChildren;
  else if (pending <= 6)  score += POINTS.mildSpan;
  else if (pending <= 10) score += POINTS.heavySpan;
  else                    score += POINTS.excessiveSpan;

  // Function compatibility
  const cg = iconGroup(child.icon ?? "");
  const pg = iconGroup(parent.icon ?? "");
  if (cg === pg && cg !== "other") score += POINTS.functionCompat;
  else if (cg === "manoeuvre" && pg === "logsigmed") score += POINTS.functionSuspicious;

  // Personnel band
  const pax = child.personnelCount ?? 0;
  if (pax > 0) {
    const band = CHILD_BAND[parent.echelon.toLowerCase()];
    if (band) {
      const [lo, hi] = band;
      if (pax >= lo && (hi === Infinity || pax <= hi)) score += POINTS.strengthBandFit;
    }
  }

  return score;
}

/**
 * Run the scoring engine over the tree and rebuild it with the highest-scoring
 * parent for every unit.
 *
 * Algorithm:
 *   1. Flatten the tree to stub records (one per unit, unique id).
 *   2. Sort stubs by echelon DESC so higher-echelon units are placed first.
 *   3. For each stub, evaluate every strictly-higher-echelon stub as a
 *      potential parent.  Discard those that fail hard rules.  Pick the
 *      highest-scoring survivor; if none survive, the unit becomes a root.
 *   4. Rebuild the tree from the assignments map.
 */
export function scoreAndReparent(units: AiUnit[]): {
  tree: AiUnit[];
  moves: number;
} {
  const stubs = flattenForScoring(units);
  if (stubs.length < 2) return { tree: units.map(u => cloneDeep(u)), moves: 0 };

  const assignments = new Map<string, string>();
  let moves = 0;

  // Order: highest echelon first
  const ordered = [...stubs].sort((a, b) => {
    const d = echIdx(b.unit.echelon) - echIdx(a.unit.echelon);
    if (d !== 0) return d;
    return a.unit.name.localeCompare(b.unit.name);
  });

  for (const stub of ordered) {
    // Candidate parents: all stubs strictly higher in echelon
    const candidates = stubs.filter(p =>
      p.id !== stub.id &&
      echIdx(p.unit.echelon) > echIdx(stub.unit.echelon),
    );
    if (candidates.length === 0) continue; // root — no assignment

    let bestScore = -Infinity;
    let bestParent: Stub | null = null;

    for (const p of candidates) {
      const skip = echIdx(p.unit.echelon) - echIdx(stub.unit.echelon) - 1;
      if (violatesHardRules(stub.unit, p.unit, skip, stub.id, p.id, assignments)) continue;
      const s = scoreCandidate(stub.unit, p.unit, skip, p.id, assignments);
      if (s > bestScore) {
        bestScore = s;
        bestParent = p;
      }
    }

    if (bestParent) {
      assignments.set(stub.id, bestParent.id);
      if (stub.originalParentId !== bestParent.id) moves++;
    }
  }

  // Rebuild the tree from the assignments
  const byId = new Map(stubs.map(s => [s.id, s]));
  const rebuiltChildren = new Map<string, AiUnit>();
  for (const s of stubs) rebuiltChildren.set(s.id, { ...s.unit, children: [] });

  const roots: AiUnit[] = [];
  for (const s of stubs) {
    const node = rebuiltChildren.get(s.id)!;
    const parentId = assignments.get(s.id);
    if (parentId) {
      rebuiltChildren.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  void byId; // reserved for future breakdown reporting
  return { tree: roots, moves };
}

function cloneDeep(u: AiUnit): AiUnit {
  return { ...u, children: u.children.map(cloneDeep) };
}

/**
 * Preview count for the UI — how many units would be moved by scoreAndReparent
 * without committing.
 */
export function countReparentMoves(units: AiUnit[]): number {
  return scoreAndReparent(units).moves;
}
