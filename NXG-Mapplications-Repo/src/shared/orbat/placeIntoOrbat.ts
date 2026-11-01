// src/shared/orbat/placeIntoOrbat.ts
//
// Where a newly placed unit slots into a phase's command tree — pure.
//
// Two decisions, both made from what is already on the map:
//
//   PARENT    The next echelon up on the same side. A battalion goes under a
//             brigade (not straight under the division) when a brigade exists;
//             among several brigades, the nearest wins. Nothing senior on the
//             side → the unit is a root.
//
//   ADOPTEES  Units it now commands: same-side ROOTS it outranks, within
//             ADOPT_RADIUS_KM. Place three battalions, then a brigade among
//             them, and the brigade picks them up. Only roots are adopted — a
//             unit that already has a superior keeps it; moving it is an
//             explicit "Change parent".
//
// Distance is used here, unlike the scenario-wide reconciler (hierarchy.ts),
// because this is a one-off choice made at the moment of placing, written as
// an explicit edge — not a rule re-evaluated on every edit. It cannot churn.
import type { UnitEchelon } from "../../apps/scenarioPlanner/map/types";
import { echelonRank } from "./hierarchy";
import type { Side } from "./model";
import { type ForestIndex, effectivePosition } from "./orbatLevels";

/** Same-side roots within this distance are adopted by a more senior unit. */
export const ADOPT_RADIUS_KM = 25;

export interface PlacementCandidate {
  echelon: string;
  side: Side;
  lat: number;
  lng: number;
}

/** Great-circle distance in km. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function rankOf(echelon: string): number {
  return echelonRank(echelon as UnitEchelon);
}

/**
 * The parent a new unit should take: the lowest-ranked same-side unit that
 * still outranks it, nearest first. Null → it becomes a root.
 *
 * Units of unknown echelon are never chosen as parents, and a candidate of
 * unknown echelon gets none — guessing a command relationship is worse than
 * leaving the unit at the top for the planner to place.
 */
export function chooseParent(
  index: ForestIndex,
  candidate: PlacementCandidate,
  exclude: ReadonlySet<string> = new Set(),
): string | null {
  const rank = rankOf(candidate.echelon);
  if (rank === 0) return null;

  let best: { key: string; rank: number; km: number } | null = null;
  for (const node of index.nodes.values()) {
    if (node.side !== candidate.side || exclude.has(node.key)) continue;
    const nodeRank = rankOf(node.echelon);
    if (nodeRank <= rank) continue;
    const pos = effectivePosition(index, node.key);
    const km = pos ? distanceKm(candidate, pos) : Number.POSITIVE_INFINITY;
    if (
      !best ||
      nodeRank < best.rank ||
      (nodeRank === best.rank && km < best.km) ||
      (nodeRank === best.rank && km === best.km && node.key < best.key)
    ) {
      best = { key: node.key, rank: nodeRank, km };
    }
  }
  return best?.key ?? null;
}

/**
 * Same-side roots the new unit outranks within ADOPT_RADIUS_KM, nearest first.
 * Never includes the chosen parent's chain — a unit cannot adopt its superior.
 */
export function adoptees(
  index: ForestIndex,
  candidate: PlacementCandidate,
  radiusKm = ADOPT_RADIUS_KM,
): string[] {
  const rank = rankOf(candidate.echelon);
  if (rank === 0) return [];
  return index.roots
    .map((key) => index.nodes.get(key)!)
    .filter((node) => node.side === candidate.side && rankOf(node.echelon) > 0)
    .filter((node) => rankOf(node.echelon) < rank)
    .map((node) => ({ node, pos: effectivePosition(index, node.key) }))
    .filter(({ pos }) => pos !== null && distanceKm(candidate, pos) <= radiusKm)
    .sort((a, b) => distanceKm(candidate, a.pos!) - distanceKm(candidate, b.pos!))
    .map(({ node }) => node.key);
}

/** The level the new unit will appear on: one below its parent, or 0 as a root. */
export function landingLevel(index: ForestIndex, parentKey: string | null): number {
  if (!parentKey) return 0;
  return (index.depthOf.get(parentKey) ?? -1) + 1;
}

/**
 * Units a node may be re-parented under: same side, senior to it, not in its
 * own subtree. Nearest first, capped — the menu is a shortlist, not a census.
 */
export function parentCandidates(
  index: ForestIndex,
  key: string,
  subtree: ReadonlySet<string>,
  limit = 12,
): string[] {
  const node = index.nodes.get(key);
  if (!node) return [];
  const rank = rankOf(node.echelon);
  const here = effectivePosition(index, key);
  return [...index.nodes.values()]
    .filter((n) => n.side === node.side && n.key !== key && !subtree.has(n.key))
    .filter((n) => rank === 0 || rankOf(n.echelon) > rank)
    .map((n) => {
      const pos = effectivePosition(index, n.key);
      return { key: n.key, km: here && pos ? distanceKm(here, pos) : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.km - b.km || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((c) => c.key);
}
