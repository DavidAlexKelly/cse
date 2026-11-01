// src/shared/orbat/ringLayout.ts
//
// Where a generated ORBAT's subordinates sit on the ground, and which level of
// the command tree to show at a given zoom. Pure — no map, no OSDK.
//
// Every unit in a phase ORBAT needs a position: CSE spawns from NxgUnit
// lat/lng, so a battalion's companies cannot all sit on the battalion's point.
// Subordinates are laid out on a ring around their parent, and the ring
// shrinks with depth so a division's brigades are kilometres apart while a
// platoon's sections are tens of metres apart.
//
// The same radii drive the map's Auto level: at any zoom we show the deepest
// level whose units would still sit at least MIN_SEPARATION_PX from their
// parent on screen. Zoom in and the force breaks down; zoom out and it groups
// back up. Because the generator and the view share one table, what Auto shows
// is always legible.

/**
 * Ring radius in metres for units at each depth below their tree's root.
 * Index 0 is the root itself (no ring). Beyond the table the last entry holds:
 * the deepest levels share the 40 m ring.
 */
export const RING_RADII_M: readonly number[] = [0, 4000, 1500, 600, 250, 100, 40];

/** Minimum on-screen distance from parent for a level to count as legible. */
export const MIN_SEPARATION_PX = 40;

/** Children per ring before a second, wider ring is started. */
const RING_CAPACITY = 12;

export function ringRadiusForDepth(depth: number): number {
  if (depth <= 0) return 0;
  return RING_RADII_M[Math.min(depth, RING_RADII_M.length - 1)];
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Move a point by metres north / east. Accurate to well under a metre at these ranges. */
export function offsetLatLng(
  lat: number,
  lng: number,
  northM: number,
  eastM: number,
): { lat: number; lng: number } {
  const dLat = (northM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = (eastM / (EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

/**
 * Positions for `count` children around a parent at `depth`.
 *
 * The first child sits due north and the rest follow clockwise, so a layout is
 * deterministic and reads like a line-up. Large families spill onto a second
 * ring at 1.6× the radius rather than packing a circle so tightly the symbols
 * overlap.
 */
export function ringPositions(
  parent: { lat: number; lng: number },
  count: number,
  depth: number,
): { lat: number; lng: number }[] {
  const radius = ringRadiusForDepth(depth);
  const out: { lat: number; lng: number }[] = [];
  for (let i = 0; i < count; i++) {
    const ring = Math.floor(i / RING_CAPACITY);
    const onRing = Math.min(RING_CAPACITY, count - ring * RING_CAPACITY);
    const slot = i % RING_CAPACITY;
    // Offset alternate rings by half a slot so symbols don't line up radially.
    const angle = (2 * Math.PI * (slot + (ring % 2) * 0.5)) / onRing;
    const r = radius * (1 + 0.6 * ring);
    out.push(offsetLatLng(parent.lat, parent.lng, r * Math.cos(angle), r * Math.sin(angle)));
  }
  return out;
}

/** Ground metres per screen pixel for a Web Mercator map (512 px tiles, as MapLibre). */
export function metresPerPixel(zoom: number, lat: number): number {
  return (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * 6_378_137) / (512 * Math.pow(2, zoom));
}

/**
 * The deepest level that is legible at this zoom: every level down to it puts
 * its units at least MIN_SEPARATION_PX from their parent.
 *
 * Monotonic in zoom (zooming in never shows a shallower level) and capped at
 * the tree's depth.
 */
export function autoLevelForZoom(zoom: number, lat: number, maxDepth: number): number {
  const mpp = metresPerPixel(zoom, lat);
  let level = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    if (ringRadiusForDepth(depth) / mpp < MIN_SEPARATION_PX) break;
    level = depth;
  }
  return level;
}
