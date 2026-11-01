// src/shared/orbat/hierarchy.ts
//
// The scenario hierarchy reconciler — pure functions only.
//
// ─── Model ───────────────────────────────────────────────────────────────────
//
// ONE NxgUnitHierarchy per scenario, holding two trees (friendly and enemy).
// A hierarchy is a container; nothing requires it to have a single root, so
// there are no synthetic "Blue Force" / "Red Force" units — each side's root is
// a REAL unit, the most senior one the planner placed on that side.
//
//   hier-{scenarioId}                     "… — Scenario ORBAT"
//   ├── 22nd AC MRBDE      ← enemy root
//   │   └── EW BATTALION   ← re-parented placed unit
//   └── 1 Mech Bn (West)   ← friendly root
//       └── AD Bty …
//
// Everything below a placed unit — the sub-tree its own ORBAT defines — is that
// unit's business and is never touched here. This file only decides where each
// placed unit sits in the wider graph.
//
// ─── Why it is a reconciler ─────────────────────────────────────────────────
//
// Parentage is DERIVED from the set of placed units, not decided by whichever
// write happens to run. Place three battalions, then a brigade: the brigade
// becomes the root and the battalions move under it. Incremental logic cannot
// express that, because it has no idea the earlier edges are now wrong. So we
// compute the whole intended shape and let the server diff it — which also
// means a partial failure heals on the next run.
//
// The apply half lives in the reconcile_scenario_orbat Foundry function: one
// transactional Action for the whole hierarchy instead of an edge at a time.

import type { PlacedUnit, UnitEchelon } from "../../apps/scenarioPlanner/map/types";
import { UNIT_ARCHETYPES, UNIT_TEMPLATES } from "../../apps/scenarioPlanner/map/unitTemplates";
import { ECHELON_LADDER, echelonForPlacedUnit } from "./skeleton";
import { isOrbatEligible } from "./eligibility";
import {
  ORGANIC_RELATIONSHIP_KEY,
  ontologyDate,
  sideForSidc,
  type Side,
} from "./model";

// ─── Echelon seniority ───────────────────────────────────────────────────────

/**
 * Seniority of an echelon: higher outranks lower, 0 = unknown.
 *
 * Derived from ECHELON_LADDER (largest first) so the ladder stays the single
 * definition of seniority.
 */
export function echelonRank(echelon: UnitEchelon | undefined): number {
  if (!echelon) return 0;
  const index = ECHELON_LADDER.indexOf(echelon);
  if (index === -1) return 0;
  return ECHELON_LADDER.length - index;
}

// ─── Members ─────────────────────────────────────────────────────────────────

/** A placed unit's ORBAT root, as the reconciler sees it. */
export interface OrbatMember {
  /** primaryKey of the root NxgUnit of this placement's ORBAT. */
  unitKey: string;
  label: string;
  echelon: UnitEchelon;
  side: Side;
  /**
   * HQ / command formation. Only used to break a tie for the side root, where
   * a headquarters is the better answer than a random peer.
   */
  isHeadquarters: boolean;
  /**
   * Parent the planner chose explicitly. Beats the derived answer, which is
   * the point: echelon ranking is a good default and a poor authority.
   */
  parentOverrideKey?: string;
}

/** True when a placement is an HQ or command formation. */
function isHeadquarters(unit: Pick<PlacedUnit, "templateId" | "sidc" | "label">): boolean {
  const templateId = unit.templateId;
  if (templateId) {
    const archetype =
      UNIT_ARCHETYPES.find((a) => a.id === templateId) ??
      UNIT_ARCHETYPES.find((a) => templateId.startsWith(`${a.id}__`));
    if (archetype) return archetype.category === "HQ";
    const template = UNIT_TEMPLATES.find((t) => t.id === templateId);
    if (template) return template.category === "HQ";
  }
  // APP-6 land function id "UH…" — headquarters. Positions 5-10 of the SIDC.
  return unit.sidc?.slice(4, 6).toUpperCase() === "UH";
}

/**
 * Project a placed unit into a reconciler member.
 *
 * Returns null when the placement takes no part: no ORBAT written yet (nothing
 * to parent), or not a land unit (see eligibility.ts).
 */
export function memberForPlacement(unit: PlacedUnit): OrbatMember | null {
  if (!unit.orbatRootUnitKey) return null;
  if (!isOrbatEligible(unit)) return null;
  return memberWithKey(unit, unit.orbatRootUnitKey);
}

/**
 * Member for a placement whose ORBAT root key has just been allocated but is
 * not on the placement yet — bulk generation writes the units and works out
 * the parentage in the same call, so the two have to be describable together.
 */
export function memberWithKey(unit: PlacedUnit, unitKey: string): OrbatMember {
  return {
    unitKey,
    label: unit.label,
    echelon: echelonForPlacedUnit(unit),
    side: sideForSidc(unit.sidc),
    isHeadquarters: isHeadquarters(unit),
    parentOverrideKey: unit.orbatParentUnitKey,
  };
}

/**
 * Members for a whole scenario, de-duplicated.
 *
 * Placements get FRESH IDS PER PHASE (see the inheritance code in the planner)
 * but keep their ORBAT keys, so the same real unit appears once per phase it
 * exists in. Keying on unitKey collapses those back to one member — reconciling
 * per placement instead would try to parent the same unit four times.
 */
export function membersForScenario(placements: PlacedUnit[]): OrbatMember[] {
  const byKey = new Map<string, OrbatMember>();
  for (const placement of placements) {
    const member = memberForPlacement(placement);
    if (member && !byKey.has(member.unitKey)) byKey.set(member.unitKey, member);
  }
  return [...byKey.values()];
}

// ─── Root selection ──────────────────────────────────────────────────────────

/**
 * The root of a side: the most senior unit placed on it.
 *
 * Ties break on HQ first, then input order (which is placement order — the
 * earliest-placed unit wins), then label. Deterministic throughout, so two
 * clients reconciling the same scenario always agree.
 */
export function sideRoot(members: OrbatMember[], side: Side): OrbatMember | undefined {
  const candidates = members
    .map((member, placementOrder) => ({ member, placementOrder }))
    .filter(({ member }) => member.side === side);
  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => {
    const byRank = echelonRank(b.member.echelon) - echelonRank(a.member.echelon);
    if (byRank !== 0) return byRank;
    const byHq = Number(b.member.isHeadquarters) - Number(a.member.isHeadquarters);
    if (byHq !== 0) return byHq;
    if (a.placementOrder !== b.placementOrder) return a.placementOrder - b.placementOrder;
    return a.member.label.localeCompare(b.member.label);
  });

  return candidates[0].member;
}

// ─── Desired parentage ───────────────────────────────────────────────────────

export interface DesiredParentage {
  /** unitKey → parent unitKey. Roots are absent. */
  parentByChild: Record<string, string>;
  /** The chosen root per side, if that side has any members. */
  roots: Partial<Record<Side, string>>;
  /**
   * Members that could not be parented anywhere — only possible when a side
   * has exactly one member, which is then its own root.
   */
  unparented: string[];
}

/**
 * Compute the intended parentage for every placed unit.
 *
 * RULE B — nearest higher echelon. A unit attaches to the LOWEST-ranked unit on
 * its side that still outranks it, so a battalion lands under a brigade rather
 * than jumping straight to the division. Anything with nothing above it
 * attaches to the side root.
 *
 * Ties are NOT broken by map proximity, which the original sketch proposed.
 * Positions change from phase to phase, so a parent chosen by distance in
 * Phase 1 quietly becomes the wrong answer in Phase 3 and the reconciler churns
 * edges to follow it. When several candidates share the lowest outranking
 * echelon we attach to the side root instead: arbitrary but stable, and visibly
 * "not yet decided" rather than plausibly wrong. A parent override is the
 * intended fix for those.
 *
 * Because a parent always STRICTLY outranks its child, the result cannot
 * contain a cycle. (The function still validates that server-side, which is
 * what catches a manual override.)
 */
export function desiredParentage(members: OrbatMember[]): DesiredParentage {
  const parentByChild: Record<string, string> = {};
  const roots: Partial<Record<Side, string>> = {};
  const unparented: string[] = [];
  const known = new Set(members.map((m) => m.unitKey));

  for (const side of ["blue", "red"] as Side[]) {
    const sideMembers = members.filter((m) => m.side === side);
    if (sideMembers.length === 0) continue;

    const root = sideRoot(sideMembers, side);
    if (!root) continue;
    roots[side] = root.unitKey;

    for (const member of sideMembers) {
      if (member.unitKey === root.unitKey) continue;

      // An explicit choice wins, as long as it still refers to a unit that is
      // on the map. A stale override (its parent deleted) falls back to the
      // derived answer rather than dropping the unit out of the hierarchy.
      const override = member.parentOverrideKey;
      if (override && override !== member.unitKey && known.has(override)) {
        parentByChild[member.unitKey] = override;
        continue;
      }
      if (override) {
        console.warn(
          `[hierarchy] ignoring parent override for ${member.unitKey}: ` +
            `${override} is not a unit in this scenario`,
        );
      }

      const rank = echelonRank(member.echelon);

      // Candidates that outrank this unit, and the lowest rank among them.
      let candidateRank = Number.POSITIVE_INFINITY;
      let candidates: OrbatMember[] = [];
      for (const other of sideMembers) {
        if (other.unitKey === member.unitKey) continue;
        const otherRank = echelonRank(other.echelon);
        if (otherRank <= rank) continue;
        if (otherRank < candidateRank) {
          candidateRank = otherRank;
          candidates = [other];
        } else if (otherRank === candidateRank) {
          candidates.push(other);
        }
      }

      if (candidates.length === 1) {
        parentByChild[member.unitKey] = candidates[0].unitKey;
      } else {
        // None, or an unbroken tie → the side root.
        parentByChild[member.unitKey] = root.unitKey;
      }
    }

    // Overrides are the one way a cycle can be asked for — "A under B" and
    // "B under A". The reconcile function rejects the whole call if it sees
    // one, which would block every other correction in the same run, so break
    // it here and fall back to the root for the unit that closed the loop.
    for (const member of sideMembers) {
      const seen = new Set<string>([member.unitKey]);
      let node = member.unitKey;
      for (;;) {
        const parent = parentByChild[node];
        if (!parent) break;
        if (seen.has(parent)) {
          console.warn(
            `[hierarchy] parent override on ${member.unitKey} would make it its own ` +
              `ancestor (via ${parent}); using the side root instead`,
          );
          parentByChild[member.unitKey] =
            member.unitKey === root.unitKey ? "" : root.unitKey;
          if (member.unitKey === root.unitKey) delete parentByChild[member.unitKey];
          break;
        }
        seen.add(parent);
        node = parent;
      }
    }

    if (sideMembers.length === 1) unparented.push(root.unitKey);
  }

  return { parentByChild, roots, unparented };
}

// ─── Reconcile payload ───────────────────────────────────────────────────────

export interface ReconcileEdge {
  parentUnitKey: string;
  childUnitKey: string;
  relationshipTypeKey: string;
  validFrom: string;
}

/**
 * A NxgUnit as the reconcile function expects it. Field names are the
 * function's JSON contract, not the OSDK's.
 */
export interface ReconcileUnit {
  primaryKey: string;
  unitIdentifier: string;
  entityType: string;
  owningSimulator: string;
  dis: string;
  canControlDrones: boolean;
  militaryService: string;
  echelon: string;
  sidc: string;
  affiliation: string;
  allegiance: string;
  latitude: number | null;
  longitude: number | null;
  unitTypeKey?: string | null;
  equipmentTypeKey?: string | null;
  /** The chosen catalogue row — the FK the simulator export resolves. */
  simulatorIdentifierCode?: string | null;
  /** The canonical asset, written to NxgUnit.dis6Code by the reconcile. */
  dis6Code?: string | null;
}

export interface ReconcilePayload {
  operation: { primaryKey: string };
  unitHierarchy: { primaryKey: string; name: string; validFrom: string };
  units: ReconcileUnit[];
  unitHierarchyEdges: ReconcileEdge[];
  managedChildUnitKeys: string[];
}

export interface BuildReconcilePayloadParams {
  operationKey: string;
  hierarchyKey: string;
  hierarchyName: string;
  members: OrbatMember[];
  /** Defaults to today. */
  validFrom?: string;
  /**
   * Units to create in the same call. Empty for a plain reconcile — the
   * members already exist — and populated when generating ORBATs in bulk.
   */
  units?: ReconcileUnit[];
  /**
   * Edges to write verbatim, on top of the derived parentage: the internal
   * structure of a generated ORBAT. Their children are NOT managed, so the
   * reconciler will never prune them.
   */
  extraEdges?: ReconcileEdge[];
}

/**
 * Build the payload for the [NXG-O] Reconcile Scenario Orbat action.
 *
 * `units` is deliberately empty: every member already exists as an NxgUnit —
 * it was written when the placement's ORBAT was created — so this call is only
 * about parentage and must not risk overwriting unit properties.
 *
 * `managedChildUnitKeys` lists EVERY member, including the roots, not just the
 * ones getting an edge. That is what lets the server prune: a unit promoted to
 * root has no desired edge, so its previous parent edge is deleted rather than
 * left behind as a second parent.
 */
export function buildReconcilePayload(
  params: BuildReconcilePayloadParams,
): ReconcilePayload {
  const validFrom = params.validFrom ?? ontologyDate();
  const { parentByChild } = desiredParentage(params.members);

  const derivedEdges: ReconcileEdge[] = Object.entries(parentByChild)
    // Stable order so the payload (and any log of it) is diffable run to run.
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([childUnitKey, parentUnitKey]) => ({
      parentUnitKey,
      childUnitKey,
      relationshipTypeKey: ORGANIC_RELATIONSHIP_KEY,
      validFrom,
    }));

  const extraEdges = [...(params.extraEdges ?? [])].sort(
    (a, b) =>
      a.childUnitKey.localeCompare(b.childUnitKey) ||
      a.parentUnitKey.localeCompare(b.parentUnitKey),
  );

  const unitHierarchyEdges = [...derivedEdges, ...extraEdges];

  return {
    operation: { primaryKey: params.operationKey },
    unitHierarchy: {
      primaryKey: params.hierarchyKey,
      name: params.hierarchyName,
      validFrom,
    },
    units: params.units ?? [],
    unitHierarchyEdges,
    managedChildUnitKeys: params.members
      .map((m) => m.unitKey)
      .sort((a, b) => a.localeCompare(b)),
  };
}

/** One-line summary of a reconcile, for logs and the "Rebuild hierarchy" toast. */
export function describeReconcile(payload: ReconcilePayload): string {
  return (
    `${payload.unitHierarchy.primaryKey}: ${payload.managedChildUnitKeys.length} units, ` +
    `${payload.unitHierarchyEdges.length} edges`
  );
}
