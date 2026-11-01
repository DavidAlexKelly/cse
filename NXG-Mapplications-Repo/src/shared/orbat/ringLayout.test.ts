import { describe, expect, it } from "vitest";
import {
  RING_RADII_M,
  autoLevelForZoom,
  offsetLatLng,
  ringPositions,
  ringRadiusForDepth,
} from "./ringLayout";

const KALININGRAD = { lat: 54.7, lng: 20.5 };

/** Haversine metres, for checking the layout independently of offsetLatLng. */
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

describe("ring layout", () => {
  it("shrinks with depth and bottoms out at the 40 m ring", () => {
    for (let d = 2; d < 10; d++) {
      expect(ringRadiusForDepth(d)).toBeLessThanOrEqual(ringRadiusForDepth(d - 1));
    }
    expect(ringRadiusForDepth(9)).toBe(RING_RADII_M[RING_RADII_M.length - 1]);
    expect(ringRadiusForDepth(9)).toBe(40);
  });

  it("puts children on the ring around their parent", () => {
    const positions = ringPositions(KALININGRAD, 3, 2);
    expect(positions).toHaveLength(3);
    for (const p of positions) {
      expect(distanceM(KALININGRAD, p)).toBeCloseTo(1500, -1);
    }
    // First child due north.
    expect(positions[0].lng).toBeCloseTo(KALININGRAD.lng, 9);
    expect(positions[0].lat).toBeGreaterThan(KALININGRAD.lat);
  });

  it("spills large families onto a wider second ring", () => {
    const positions = ringPositions(KALININGRAD, 20, 3);
    const radii = positions.map((p) => distanceM(KALININGRAD, p));
    expect(Math.min(...radii)).toBeCloseTo(600, -1);
    expect(Math.max(...radii)).toBeCloseTo(960, -1);
  });

  it("offsets by metres", () => {
    const p = offsetLatLng(KALININGRAD.lat, KALININGRAD.lng, 1000, 0);
    expect(distanceM(KALININGRAD, p)).toBeCloseTo(1000, 0);
  });
});

describe("autoLevelForZoom", () => {
  it("is monotonic in zoom", () => {
    let previous = -1;
    for (let zoom = 4; zoom <= 20; zoom += 0.5) {
      const level = autoLevelForZoom(zoom, KALININGRAD.lat, 8);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it("never exceeds the tree's depth", () => {
    expect(autoLevelForZoom(22, KALININGRAD.lat, 2)).toBe(2);
    expect(autoLevelForZoom(22, KALININGRAD.lat, 0)).toBe(0);
  });

  it("shows only the top level when zoomed out, and the bottom by zoom 17", () => {
    expect(autoLevelForZoom(6, KALININGRAD.lat, 8)).toBe(0);
    expect(autoLevelForZoom(17, KALININGRAD.lat, 8)).toBe(8);
    expect(autoLevelForZoom(17, 0, 8)).toBe(8);
  });
});
