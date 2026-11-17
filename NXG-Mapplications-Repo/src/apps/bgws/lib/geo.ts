// ── bgws/lib/geo.ts ────────────────────────────────────────────────────────
// The little geometry the builder and the mock need. Flat-earth approximations
// throughout: areas are tens of kilometres across, where the error is far
// below what a click on a map can place.

import type { Area, LatLon } from "../types";

export const METRES_PER_DEG_LAT = 111_320;

/** An area from any two opposite corners, in whichever order they were dragged. */
export function areaFromCorners(a: LatLon, b: LatLon): Area {
  return {
    south: Math.min(a.lat, b.lat),
    north: Math.max(a.lat, b.lat),
    west: Math.min(a.lon, b.lon),
    east: Math.max(a.lon, b.lon),
  };
}

export function inArea(area: Area, p: LatLon): boolean {
  return p.lat >= area.south && p.lat <= area.north && p.lon >= area.west && p.lon <= area.east;
}

export function areaCentre(area: Area): LatLon {
  return { lat: (area.south + area.north) / 2, lon: (area.west + area.east) / 2 };
}

/** Width and height in kilometres, measured at the area's middle latitude. */
export function areaSizeKm(area: Area): { widthKm: number; heightKm: number } {
  const midLat = (area.south + area.north) / 2;
  return {
    widthKm: ((area.east - area.west) * METRES_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180)) / 1000,
    heightKm: ((area.north - area.south) * METRES_PER_DEG_LAT) / 1000,
  };
}

export function metresBetween(a: LatLon, b: LatLon): number {
  const dLat = b.lat - a.lat;
  const dLon = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) * METRES_PER_DEG_LAT;
}

/** Compass bearing a → b, degrees clockwise from north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const dLat = b.lat - a.lat;
  const dLon = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
}

/** The point `metres` from `from` towards `to`, stopping at `to`. */
export function stepTowards(from: LatLon, to: LatLon, metres: number): LatLon {
  const total = metresBetween(from, to);
  if (total <= metres || total === 0) return { ...to };
  const f = metres / total;
  return { lat: from.lat + (to.lat - from.lat) * f, lon: from.lon + (to.lon - from.lon) * f };
}

/** Round to 6 decimal places (~0.1 m) — enough for a scenario, short in JSON. */
export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
