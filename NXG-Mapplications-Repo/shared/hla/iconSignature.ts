// ── shared/hla/iconSignature.ts ────────────────────────────────────────────
// When a marker's icon actually needs rebuilding.
//
// Rebuilding a Leaflet DivIcon replaces the marker's DOM element. Doing that
// when nothing visible changed is not just wasted work — a marker re-created
// mid-gesture stops tracking the basemap, which reads as the units coming
// unstuck from the map. The analysis replay drives entities at 15 Hz, so ~300
// markers would otherwise be torn down and rebuilt fifteen times a second.
//
// Lives in its own module so the contract below can be tested without pulling
// in EntityMap (and with it Leaflet's stylesheet).

import type { HlaEntity } from "./types";

/** The icon-affecting state of a marker, separate from where it is. */
export interface IconOptions {
  selected: boolean;
  targetable: boolean;
  /** A co-located command post was folded in — draw the APP-6 HQ staff. */
  headquarters: boolean;
  /** Subordinate units folded into this marker, shown as a "+N" badge. */
  rolledUp: number;
  /** APP-6 echelon rank, drives the symbol size. */
  rank: number;
  /** Dim the marker — used for entities the replay knows are destroyed. */
  faded: boolean;
}

/** Heading quantisation, in degrees. */
const HEADING_STEP = 5;

/**
 * Everything the rendered icon depends on, as a comparable string.
 *
 * Two deliberate omissions:
 *
 *   * Position. Moving a marker is `setLatLng`, which does not touch the icon.
 *     If lat/lon were in here, every interpolated tick would rebuild every
 *     icon and the optimisation would do nothing at all.
 *   * Heading, exactly. It is quantised to 5°, because the heading tick is a
 *     2 px spoke on a ~22 px symbol and finer steps rebuild the DOM for a
 *     change nobody can see.
 */
export function iconSignature(
  entity: HlaEntity,
  options: IconOptions,
  /** Catalogue size: it arrives after the first entities and changes every symbol. */
  catalogueSize: number
): string {
  const heading = Number.isFinite(entity.heading)
    ? Math.round(entity.heading / HEADING_STEP)
    : -1;

  return [
    entity.unit || entity.callsign,
    entity.force,
    entity.sisoType,
    heading,
    options.selected ? 1 : 0,
    options.targetable ? 1 : 0,
    options.headquarters ? 1 : 0,
    options.rolledUp,
    options.rank,
    options.faded ? 1 : 0,
    catalogueSize,
  ].join("|");
}
