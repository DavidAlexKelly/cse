import { describe, expect, it } from "vitest";
import { iconSignature, type IconOptions } from "./iconSignature";
import { mergeRow } from "./trackRow";
import type { HlaEntity } from "./types";

function entity(overrides: Partial<HlaEntity> = {}): HlaEntity {
  const base = mergeRow(undefined, {
    entity_id: "e1",
    name: "INF.Rifle platoon [388]",
    force_id: "Friendly",
    latitude: 58.5,
    longitude: 24.1,
    heading_deg: 200,
  })!;
  return { ...base, ...overrides };
}

const options: IconOptions = {
  selected: false,
  targetable: false,
  headquarters: false,
  rolledUp: 0,
  rank: 4,
  faded: false,
};

describe("iconSignature", () => {
  it("ignores position", () => {
    // The whole point: an interpolated tick moves the marker with setLatLng and
    // must not rebuild its icon. If lat/lon ever enter the signature, every
    // marker is torn down 15 times a second and comes unstuck from the map.
    const a = iconSignature(entity({ lat: 58.5, lon: 24.1 }), options, 81);
    const b = iconSignature(entity({ lat: 59.9, lon: 21.7 }), options, 81);
    expect(a).toBe(b);
  });

  it("ignores a heading change too small to see", () => {
    const a = iconSignature(entity({ heading: 200 }), options, 81);
    const b = iconSignature(entity({ heading: 201 }), options, 81);
    expect(a).toBe(b);
  });

  it("notices a heading change big enough to see", () => {
    const a = iconSignature(entity({ heading: 200 }), options, 81);
    const b = iconSignature(entity({ heading: 215 }), options, 81);
    expect(a).not.toBe(b);
  });

  it("notices selection", () => {
    expect(iconSignature(entity(), { ...options, selected: true }, 81)).not.toBe(
      iconSignature(entity(), options, 81)
    );
  });

  it("notices the roll-up count, so a +N badge repaints", () => {
    expect(iconSignature(entity(), { ...options, rolledUp: 3 }, 81)).not.toBe(
      iconSignature(entity(), { ...options, rolledUp: 2 }, 81)
    );
  });

  it("notices becoming a headquarters", () => {
    expect(iconSignature(entity(), { ...options, headquarters: true }, 81)).not.toBe(
      iconSignature(entity(), options, 81)
    );
  });

  it("notices echelon rank, which changes the symbol size", () => {
    expect(iconSignature(entity(), { ...options, rank: 5 }, 81)).not.toBe(
      iconSignature(entity(), options, 81)
    );
  });

  it("notices the catalogue arriving", () => {
    // Symbols are drawn from dimension-only frames until the catalogue loads,
    // then every one of them changes.
    expect(iconSignature(entity(), options, 0)).not.toBe(iconSignature(entity(), options, 81));
  });

  it("notices a change of side", () => {
    expect(iconSignature(entity({ force: "RED" }), options, 81)).not.toBe(
      iconSignature(entity({ force: "BLUE" }), options, 81)
    );
  });

  it("notices the name arriving, since it picks the symbol", () => {
    expect(iconSignature(entity({ unit: "" }), options, 81)).not.toBe(
      iconSignature(entity({ unit: "ARMOR.Medium tank platoon [300]" }), options, 81)
    );
  });

  it("tolerates a non-finite heading", () => {
    expect(() => iconSignature(entity({ heading: Number.NaN }), options, 81)).not.toThrow();
  });
});
