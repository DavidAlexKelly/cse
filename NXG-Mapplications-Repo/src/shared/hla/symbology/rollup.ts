// ── shared/hla/symbology/rollup.ts ─────────────────────────────────────────────
// Decide which entities are drawn at a given zoom, and which are folded into
// somebody else's symbol.
//
// The problem this solves
// -----------------------
// SWORD publishes a formation *and* its subordinates as separate entities, all
// within a few hundred metres of each other. A single mechanised company
// arrives as seven tracks:
//
//   INF.Mechanised company [425]_483   58.53313, 24.12097
//   INF.Company CP         [426]_484   58.53313, 24.12097   ← identical position
//   INF.Mechanised platoon [428]_486   58.53339, 24.12261
//   INF.Mechanised platoon [429]_487   58.53239, 24.12196
//   INF.Mechanised platoon [430]_488   58.53241, 24.11994
//   INF.Mortar section     [427]_485   58.53403, 24.12099
//   INF.Anti-tank section  [431]_489   58.53342, 24.11934
//
// Drawn literally that is seven overlapping icons saying one thing: "a mech
// company is here". Across the live federation about seven in ten entities sit
// in a cluster of four or more, so most of the map is this.
//
// Two independent foldings happen here.
//
// 1. Echelon roll-up. Subordinates are hidden below the zoom at which they
//    could be told apart anyway — platoons sit ~250 m apart, which is under
//    three pixels until roughly zoom 13 — and counted on their parent instead.
// 2. Command posts. A CP is published at the *exact* coordinates of the
//    formation it commands, so it can never be seen or clicked separately. It
//    is removed and the parent is flagged as a headquarters, which APP-6 draws
//    as a staff on the frame: the standard way to say "this company, with its
//    CP", in one symbol.
//
// What is deliberately never hidden
// ---------------------------------
//   * anything with no echelon in its name — ships, aircraft, the HLA drone
//     mockups. They are independent tracks, not part of a ground formation, and
//     have no parent to fold into.
//   * a subordinate with no higher-echelon formation near it. An orphan draws
//     itself rather than vanishing.
//   * the selected unit, and everything while a fire mission is picking a
//     target — see RollupOptions.
//
// So the count on a marker is the only thing a user can lose sight of, and it
// comes back by zooming in.

import { echelonFromName, isHeadquarters } from "./app6";

/** The minimum an entity has to look like for roll-up to reason about it. */
export interface RollupCandidate {
  id: string;
  lat: number;
  lon: number;
}

export interface Renderable<T extends RollupCandidate> {
  entity: T;
  /** Subordinates folded into this marker; drawn as a "+N" badge, not as icons. */
  rolledUp: T[];
  /** A co-located command post was folded in — draw the HQ staff. */
  headquarters: boolean;
  /** APP-6 echelon rank, 0 = none. Drives symbol size. */
  rank: number;
}

export interface RollupOptions {
  /**
   * Never fold this entity away. The selected unit has to stay on the map: the
   * command panel is showing it, and a unit that disappears when the map is
   * nudged looks like a bug rather than a level of detail.
   */
  pinnedId?: string | null;
  /**
   * Draw every entity individually. Used while a fire mission is picking a
   * target, where a hidden entity is an untargetable one.
   */
  disabled?: boolean;
}

/**
 * APP-6 echelon letter (see app6.echelonFromName) → a comparable rank.
 * 0 means the name states no echelon, which is not the same as "small".
 */
const ECHELON_RANK: Readonly<Record<string, number>> = {
  "-": 0,
  A: 1, // team / crew
  B: 2, // squad
  C: 3, // section
  D: 4, // platoon / detachment
  E: 5, // company / battery / troop
  F: 6, // battalion / squadron
  G: 7, // regiment / group
  H: 8, // brigade
  I: 9, // division
};

const COMPANY_RANK = ECHELON_RANK.E;
const BATTALION_RANK = ECHELON_RANK.F;

/**
 * The lowest echelon worth drawing at a zoom level.
 *
 * The thresholds come from the geometry of the live federation rather than
 * taste. Subordinates of a company sit roughly 250 m from it; separating them
 * by a marker's width (~30 px) needs about 8 m/pixel, which is zoom 13. Below
 * that they are drawn on top of each other whatever else is done, so they are
 * better counted than plotted. Companies are ~1 km apart and stop being
 * separable around zoom 11.
 */
export function minRankForZoom(zoom: number): number {
  if (zoom >= 13) return 0; // everything
  if (zoom >= 11) return COMPANY_RANK; // companies and above
  return BATTALION_RANK; // battalions and above
}

/** Ground resolution at a latitude, for turning a pixel budget into metres. */
function metresPerPixel(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/** Metres between two points; equirectangular is ample over a few kilometres. */
function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const midLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const dLat = (aLat - bLat) * 111_320;
  const dLon = (aLon - bLon) * 111_320 * Math.cos(midLat);
  return Math.hypot(dLat, dLon);
}

/**
 * How close a command post has to be to count as "the same place".
 *
 * SWORD publishes CP and parent at coordinates identical to five decimal
 * places, so this only has to be bigger than nothing. It is kept tight on
 * purpose: a CP that has genuinely moved away from its formation is a real
 * thing on the map and must keep its own marker.
 */
const HQ_COLOCATION_M = 40;

/**
 * How far a subordinate may be from its parent formation, as a pixel budget
 * converted to metres at the current zoom, then clamped.
 *
 * The clamp is the important part. Unclamped, a wide zoom would let a company
 * adopt a battalion five kilometres away that it has nothing to do with. At
 * 1.5 km the worst case is that two genuinely adjacent formations merge for a
 * moment; anything further apart stays separate, and an unattached subordinate
 * simply draws itself.
 */
const ANCHOR_PIXELS = 40;
const ANCHOR_MIN_M = 300;
const ANCHOR_MAX_M = 1_500;

interface Meta<T extends RollupCandidate> {
  entity: T;
  name: string;
  rank: number;
  isHq: boolean;
}

/**
 * Which entities to draw, and what each one stands for.
 *
 * O(n²) over the live entity set (~300), which is a fraction of a millisecond
 * and far cheaper than the marker churn it prevents.
 */
export function planRollup<T extends RollupCandidate>(
  entities: readonly T[],
  nameOf: (entity: T) => string,
  zoom: number,
  options: RollupOptions = {}
): Renderable<T>[] {
  const meta: Meta<T>[] = entities.map((entity) => {
    const name = nameOf(entity) ?? "";
    return {
      entity,
      name,
      rank: ECHELON_RANK[echelonFromName(name)] ?? 0,
      // Nature is left empty: the catalogue row is looked up per *asset type*
      // and CPs are named explicitly ("Company CP", "Battle group CP"), so the
      // name alone settles it.
      isHq: isHeadquarters(name, ""),
    };
  });

  if (options.disabled) {
    return meta.map((m) => ({ entity: m.entity, rolledUp: [], headquarters: false, rank: m.rank }));
  }

  // ── 1. Fold each command post into the formation it is standing on ───────
  const folded = new Set<string>();
  const commands = new Set<string>();
  for (const cp of meta) {
    if (!cp.isHq || cp.entity.id === options.pinnedId) continue;

    let best: { target: Meta<T>; distance: number } | null = null;
    for (const other of meta) {
      // Same or higher echelon only: a CP belongs to its own formation, never
      // to a subordinate that happens to be parked on it.
      if (other === cp || other.isHq || other.rank < cp.rank) continue;
      const distance = distanceM(cp.entity.lat, cp.entity.lon, other.entity.lat, other.entity.lon);
      if (distance <= HQ_COLOCATION_M && (!best || distance < best.distance)) {
        best = { target: other, distance };
      }
    }

    if (best) {
      folded.add(cp.entity.id);
      commands.add(best.target.entity.id);
    }
  }

  // ── 2. Roll subordinates into a higher-echelon formation near them ───────
  const minRank = minRankForZoom(zoom);
  const remaining = meta.filter((m) => !folded.has(m.entity.id));

  const drawn: Meta<T>[] = [];
  const candidates: Meta<T>[] = [];
  for (const m of remaining) {
    // Rank 0 is "no echelon stated", not "smallest": ships, aircraft and the
    // drone mockups have no formation to fold into and always draw.
    const keep = m.rank === 0 || m.rank >= minRank || m.entity.id === options.pinnedId;
    (keep ? drawn : candidates).push(m);
  }

  // Highest echelon first so a subordinate prefers the largest formation it
  // could belong to, and ties break on id rather than on array order — the
  // stream's ordering is not stable between ticks and markers must not swap
  // parents underneath the user.
  const byEchelon = (a: Meta<T>, b: Meta<T>) => b.rank - a.rank || a.entity.id.localeCompare(b.entity.id);
  const anchors = [...drawn].sort(byEchelon);

  const children = new Map<string, T[]>();
  const orphans: Meta<T>[] = [];

  // Candidates are resolved from the top down, and one that ends up drawn
  // anyway becomes an anchor for the ranks below it.
  //
  // Without this the roll-up inverts at low zoom: below zoom 11 a company is
  // itself a candidate, so it is not in the initial anchor set, so its platoons
  // find no parent, so all seven markers come back — the wide view would be
  // busier than the close one. Descending rank makes the company resolve first
  // (as an orphan, since it has no battalion nearby), after which its platoons
  // fold into it as they do at every other zoom.
  for (const child of [...candidates].sort(byEchelon)) {
    const radius = Math.min(
      ANCHOR_MAX_M,
      Math.max(ANCHOR_MIN_M, metresPerPixel(zoom, child.entity.lat) * ANCHOR_PIXELS)
    );

    let best: { anchor: Meta<T>; distance: number } | null = null;
    for (const anchor of anchors) {
      if (anchor.rank <= child.rank) continue;
      const distance = distanceM(
        child.entity.lat,
        child.entity.lon,
        anchor.entity.lat,
        anchor.entity.lon
      );
      if (distance <= radius && (!best || distance < best.distance)) {
        best = { anchor, distance };
      }
    }

    if (!best) {
      // Nothing to fold into — draw it rather than lose it, and let the ranks
      // below fold into it.
      orphans.push(child);
      anchors.push(child);
      continue;
    }
    const list = children.get(best.anchor.entity.id);
    if (list) list.push(child.entity);
    else children.set(best.anchor.entity.id, [child.entity]);
  }

  return [...drawn, ...orphans].map((m) => ({
    entity: m.entity,
    rolledUp: children.get(m.entity.id) ?? [],
    headquarters: commands.has(m.entity.id),
    rank: m.rank,
  }));
}

export default planRollup;
