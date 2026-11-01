// ============================================================
//  Auto Child Generation Engine
// ============================================================
//
//  Purpose
//  ───────
//  Given any "bare" unit (one with no children) that has a doctrine
//  entry, automatically propose a full child sub-tree down to the
//  lowest applicable echelon (squad or team).
//
//  Strategy — two-phase, highest-score wins
//  ────────────────────────────────────────
//  PHASE A — Clone from an existing peer
//    Search all other units in the ORBAT for a "donor": a unit at
//    the same echelon that already has children.  Score every
//    candidate; the highest-scoring donor's sub-tree is cloned
//    (fresh IDs always).  If the donor's tree is shallower than
//    doctrine prescribes, the missing lower levels are extended
//    synthetically so the full depth is always reached.
//
//    Donor scoring (additive):
//      +60  Same echelon
//      +30  Exact icon match
//      +15  Same icon group (manoeuvre / logsigmed / other)
//      +20  Same affiliation
//      +15  Donor has ≥ 2 levels of depth (rich structure)
//      + 5  Donor has 1 level of children
//      +10  Personnel count within 30% of target
//      + 4  Personnel count within 30–60% of target
//      + 5  Name shares ≥ 1 meaningful word with target
//    Tie-break: more total descendants → alphabetical
//
//  PHASE B — Synthetic generation (no peer found)
//    Use the DOCTRINE table to build a standard sub-tree.  Every
//    entry has recurse:true so the tree is built all the way to the
//    leaf echelon defined per branch (squad for infantry, etc.).
//    The depth cap is the echelon floor — generation stops when
//    the current echelon has no doctrine entry (e.g. team → nothing).
//
//  Hard rules (never violated)
//  ───────────────────────────
//  GR-A1   Every generated child must be strictly below the parent
//  GR-A3X  No skip of more than 2 echelon levels
//  GR-LEAF Recursion stops when the echelon has no DOCTRINE entry
//           or when the child echelon would already be at index 0
//
//  Eligible bare units
//  ───────────────────
//  Any unit with no children whose echelon has a DOCTRINE entry.
//  This now includes company, platoon, section and squad —
//  not just battalion and above.
// ============================================================

import type { UnitNode, EchelonLevel, StandardIdentity } from "./types.js";
import { ECHELON_INDEX } from "./types.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface GeneratedUnit {
  id: string;
  name: string;
  echelon: EchelonLevel;
  personnelCount: number;
  icon: string;
  standardIdentity: StandardIdentity;
  children: GeneratedUnit[];
  note: string;
}

export interface DonorScoreBreakdown {
  donor: UnitNode;
  score: number;
  breakdown: string[];
}

export interface GenerationProposal {
  targetUnit: UnitNode;
  source: "clone" | "synthetic";
  donor?: UnitNode;
  donorScore: number;
  scoredDonors: DonorScoreBreakdown[];
  children: GeneratedUnit[];
  treeScore: number;
  reason: string;
}

// ─── Doctrine table ───────────────────────────────────────────────────────────
//
//  Every entry has recurse: true.  Recursion stops naturally when the
//  child echelon has no entry in DOCTRINE (e.g. "team" has no entry).
//  This means a battalion generates companies → platoons → sections →
//  squads → teams, all the way to the bottom.

interface DoctrineEntry {
  childEchelon: EchelonLevel;
  count: number;            // non-HQ sub-units
  includeHq: boolean;
  typicalPax: number;       // per child
}

const DOCTRINE: Partial<Record<EchelonLevel, DoctrineEntry>> = {
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

/** Designation suffixes used when generating names */
const ECHELON_SUFFIX: Partial<Record<EchelonLevel, string[]>> = {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _idCounter = 0;
export function freshId(): string {
  _idCounter++;
  return `gen_${Date.now()}_${_idCounter}`;
}

function descendantCount(u: UnitNode): number {
  let n = 0;
  const walk = (x: UnitNode) => { n += x.children.length; x.children.forEach(walk); };
  walk(u);
  return n;
}

function treeDepthU(u: UnitNode): number {
  if (u.children.length === 0) return 0;
  return 1 + Math.max(...u.children.map(treeDepthU));
}

export function flattenGenerated(g: GeneratedUnit): GeneratedUnit[] {
  const out: GeneratedUnit[] = [g];
  g.children.forEach(c => out.push(...flattenGenerated(c)));
  return out;
}

function iconGroupOf(icon: string): string {
  const MANOEUVRE = new Set(["infantry","armour","mechanisedInfantry","cavalry","reconnaissance","specialForces","aviation","airForce"]);
  const LOGSIGMED = new Set(["logistics","signals","medical","maintenance"]);
  if (MANOEUVRE.has(icon)) return "manoeuvre";
  if (LOGSIGMED.has(icon)) return "logsigmed";
  return "other";
}

/** Strip common echelon words to get a bare formation name */
function stripEchelonWords(name: string): string {
  return name
    .replace(/\b(battalion|company|platoon|section|squad|team|regiment|brigade|division|corps|army|group|theatre|bn|coy|pl|sect|regt|bde|div|hq|headquarters)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Synthetic generation (recursive, no hard depth cap) ─────────────────────

/**
 * Build a synthetic sub-tree for a given parent echelon.
 * Recurses through DOCTRINE until there is no child doctrine entry (leaf).
 *
 * GR-A1 and GR-A3X are enforced; if violated, returns [].
 */
function generateSyntheticChildren(
  parentName: string,
  parentEchelon: EchelonLevel,
  parentIcon: string,
  affiliation: StandardIdentity,
): GeneratedUnit[] {
  const entry = DOCTRINE[parentEchelon];
  if (!entry) return []; // GR-LEAF: no doctrine → this is the leaf

  const { childEchelon, count, includeHq, typicalPax } = entry;

  // GR-A1: child strictly below parent
  if (ECHELON_INDEX[childEchelon] >= ECHELON_INDEX[parentEchelon]) return [];
  // GR-A3X: no skip > 2
  if (ECHELON_INDEX[parentEchelon] - ECHELON_INDEX[childEchelon] - 1 > 2) return [];

  const baseName = stripEchelonWords(parentName) || parentName;
  const suffixes = ECHELON_SUFFIX[childEchelon] ?? ["1","2","3","4"];
  const units: GeneratedUnit[] = [];

  // Optional HQ node (always a leaf — HQ elements don't recurse further)
  if (includeHq) {
    units.push({
      id: freshId(),
      name: `HQ ${parentName}`,
      echelon: childEchelon,
      personnelCount: Math.max(2, Math.round(typicalPax * 0.3)),
      icon: "headquarters",
      standardIdentity: affiliation,
      children: [],
      note: `Synthetic HQ for ${parentEchelon}`,
    });
  }

  // Main sub-units — each recursively builds its own children
  for (let i = 0; i < count; i++) {
    const suffix = suffixes[i % suffixes.length];
    const name = `${baseName} ${suffix}`.trim();
    const grandchildren = generateSyntheticChildren(name, childEchelon, parentIcon, affiliation);

    units.push({
      id: freshId(),
      name,
      echelon: childEchelon,
      personnelCount: typicalPax,
      icon: parentIcon,
      standardIdentity: affiliation,
      children: grandchildren,
      note: `Synthetic ${childEchelon} (doctrine)`,
    });
  }

  return units;
}

// ─── Clone + extend ───────────────────────────────────────────────────────────

/**
 * Clone a donor UnitNode subtree.
 * If the donor's subtree is shallower than doctrine prescribes for that
 * echelon, extend the missing levels synthetically.
 */
function cloneSubtree(
  donorNode: UnitNode,
  targetAffiliation: StandardIdentity,
  parentIcon: string,
): GeneratedUnit {
  // Clone existing children, or extend if the donor is a leaf but doctrine says otherwise
  let children: GeneratedUnit[];
  if (donorNode.children.length > 0) {
    children = donorNode.children.map(c =>
      cloneSubtree(c, targetAffiliation, donorNode.symbol?.icon ?? parentIcon)
    );
  } else {
    // Donor has no children — synthesise if there is a doctrine entry
    children = generateSyntheticChildren(
      donorNode.name,
      donorNode.echelon,
      donorNode.symbol?.icon ?? parentIcon,
      targetAffiliation,
    );
  }

  return {
    id: freshId(),
    name: donorNode.name,
    echelon: donorNode.echelon,
    personnelCount: donorNode.personnelCount,
    icon: donorNode.symbol?.icon ?? parentIcon,
    standardIdentity: targetAffiliation,
    children,
    note: children.length > 0 && donorNode.children.length === 0
      ? `Cloned from "${donorNode.name}" + synthetic extension`
      : `Cloned from "${donorNode.name}"`,
  };
}

// ─── Donor scoring ────────────────────────────────────────────────────────────

function scoreDonor(target: UnitNode, donor: UnitNode): DonorScoreBreakdown {
  let score = 0;
  const breakdown: string[] = [];

  score += 60;
  breakdown.push(`+60 Same echelon (${donor.echelon})`);

  const tIcon = target.symbol?.icon ?? "";
  const dIcon = donor.symbol?.icon  ?? "";
  if (dIcon === tIcon) {
    score += 30;
    breakdown.push(`+30 Exact icon match (${dIcon || "generic"})`);
  } else if (iconGroupOf(dIcon) === iconGroupOf(tIcon)) {
    score += 15;
    breakdown.push(`+15 Same icon group (${iconGroupOf(dIcon)})`);
  }

  const tAff = target.symbol?.standardIdentity ?? "unknown";
  const dAff = donor.symbol?.standardIdentity  ?? "unknown";
  if (tAff === dAff) {
    score += 20;
    breakdown.push(`+20 Same affiliation`);
  }

  const depth = treeDepthU(donor);
  if (depth >= 2) {
    score += 15;
    breakdown.push(`+15 Rich structure (${depth} levels)`);
  } else if (depth === 1) {
    score += 5;
    breakdown.push(`+5 Single level of children`);
  }

  const tPax = target.personnelCount;
  const dPax = donor.personnelCount;
  if (tPax > 0 && dPax > 0) {
    const ratio = Math.min(tPax, dPax) / Math.max(tPax, dPax);
    if (ratio >= 0.7) {
      score += 10;
      breakdown.push(`+10 Similar pax (${dPax} vs ${tPax})`);
    } else if (ratio >= 0.4) {
      score += 4;
      breakdown.push(`+4 Moderately similar pax`);
    }
  }

  const tWords = new Set(target.name.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const shared = donor.name.toLowerCase().split(/\W+/).filter(w => w.length > 2 && tWords.has(w));
  if (shared.length > 0) {
    score += 5;
    breakdown.push(`+5 Name overlap ("${shared[0]}")`);
  }

  return { donor, score, breakdown };
}

// ─── Tree quality scoring ─────────────────────────────────────────────────────

function scoreGeneratedTree(targetEchelon: EchelonLevel, children: GeneratedUnit[]): number {
  if (children.length === 0) return 0;
  let score = 0;

  const entry = DOCTRINE[targetEchelon];
  const idealCount = entry?.count ?? 3;
  const nonHqChildren = children.filter(c => c.icon !== "headquarters");

  if (nonHqChildren.length === idealCount) score += 20;
  else if (Math.abs(nonHqChildren.length - idealCount) === 1) score += 10;

  // All immediate children at adjacent echelon
  const allAdjacent = children.every(c =>
    ECHELON_INDEX[targetEchelon] - ECHELON_INDEX[c.echelon] === 1
  );
  if (allAdjacent) score += 20;

  if (children.some(c => c.icon === "headquarters")) score += 10;

  // Reward depth — the deeper the better (more complete structure)
  const allFlat = children.flatMap(flattenGenerated);
  const n = allFlat.length;
  if (n >= 20) score += 25;
  else if (n >= 10) score += 18;
  else if (n >= 5)  score += 10;
  else if (n >= 2)  score += 5;

  return score;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Compute generation proposals for all bare units.
 *
 * "Bare" = has no children AND has a DOCTRINE entry (i.e. there is something
 * meaningful to generate).  This now includes company, platoon, section,
 * squad — not just battalion and above.
 *
 * @param bareUnits   Pre-filtered bare units (caller supplies)
 * @param allUnits    Entire group unit tree (donor search pool)
 * @param affiliation Default affiliation for generated units
 */
export function computeChildGenerationProposals(
  bareUnits: UnitNode[],
  allUnits: UnitNode[],
  affiliation: StandardIdentity = "unknown",
): GenerationProposal[] {
  // Flatten all units to a searchable pool
  const allFlat: UnitNode[] = [];
  const walkAll = (u: UnitNode) => { allFlat.push(u); u.children.forEach(walkAll); };
  allUnits.forEach(walkAll);

  return bareUnits.map(target => {
    const targetAff = target.symbol?.standardIdentity ?? affiliation;
    const targetIcon = target.symbol?.icon ?? "infantry";

    // ── Phase A: find donor ─────────────────────────────────────────────
    const donorCandidates = allFlat.filter(u =>
      u.id !== target.id &&
      u.echelon === target.echelon &&
      u.children.length > 0,
    );

    const scoredDonors: DonorScoreBreakdown[] = donorCandidates
      .map(d => scoreDonor(target, d))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        const ad = descendantCount(a.donor);
        const bd = descendantCount(b.donor);
        if (ad !== bd) return bd - ad;
        return a.donor.name.localeCompare(b.donor.name);
      });

    if (scoredDonors.length > 0) {
      const best = scoredDonors[0];
      const clonedChildren = best.donor.children.map(c =>
        cloneSubtree(c, targetAff, targetIcon)
      );
      const treeScore = scoreGeneratedTree(target.echelon, clonedChildren);
      const totalNodes = clonedChildren.flatMap(flattenGenerated).length + clonedChildren.length;

      // Check if any extension happened
      const extended = clonedChildren.some(c => c.note.includes("extension"));

      return {
        targetUnit: target,
        source: "clone" as const,
        donor: best.donor,
        donorScore: best.score,
        scoredDonors,
        children: clonedChildren,
        treeScore,
        reason: extended
          ? `Cloned from "${best.donor.name}" (score ${best.score}) + extended synthetically to full depth — ${totalNodes} units`
          : `Cloned from "${best.donor.name}" (score ${best.score}) — ${totalNodes} units`,
      };
    }

    // ── Phase B: full synthetic generation ─────────────────────────────
    const syntheticChildren = generateSyntheticChildren(
      target.name,
      target.echelon,
      targetIcon,
      targetAff,
    );
    const treeScore = scoreGeneratedTree(target.echelon, syntheticChildren);
    const totalNodes =
      syntheticChildren.flatMap(flattenGenerated).length + syntheticChildren.length;

    const entry = DOCTRINE[target.echelon];
    const leafEchelon = getLeafEchelon(target.echelon);
    const reason = entry
      ? `No peer found — generated doctrine-standard structure down to ${leafEchelon} (${totalNodes} units)`
      : `No peer and no doctrine entry for ${target.echelon} — cannot generate children`;

    return {
      targetUnit: target,
      source: "synthetic" as const,
      donorScore: 0,
      scoredDonors: [],
      children: syntheticChildren,
      treeScore,
      reason,
    };
  });
}

/** Walk the DOCTRINE chain to find the deepest echelon that will be generated */
function getLeafEchelon(echelon: EchelonLevel): EchelonLevel {
  let cur = echelon;
  for (;;) {
    const entry = DOCTRINE[cur];
    if (!entry) return cur;
    cur = entry.childEchelon;
  }
}

// ─── Operation flattening (BFS for insertion order) ──────────────────────────

export interface AddUnitOp {
  parentId: string;
  input: Record<string, unknown>;
  generated: GeneratedUnit;
}

export function flattenGenerationOps(
  targetId: string,
  children: GeneratedUnit[],
): AddUnitOp[] {
  const ops: AddUnitOp[] = [];
  const queue: Array<{ parentId: string; unit: GeneratedUnit }> =
    children.map(c => ({ parentId: targetId, unit: c }));

  while (queue.length > 0) {
    const { parentId, unit } = queue.shift()!;
    ops.push({
      parentId,
      input: {
        name:           unit.name,
        echelon:        unit.echelon,
        personnelCount: unit.personnelCount,
        symbolIcon:     unit.icon,
        notes:          unit.note,
      },
      generated: unit,
    });
    unit.children.forEach(c => queue.push({ parentId: unit.id, unit: c }));
  }

  return ops;
}
