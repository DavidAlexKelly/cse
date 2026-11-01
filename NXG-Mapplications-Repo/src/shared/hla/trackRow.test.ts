import { describe, expect, it } from "vitest";
import { accumulateIdentity, damageState, entityFromRow, mergeRow, positioned } from "./trackRow";
import type { TrackRow } from "./trackRow";

describe("damageState", () => {
  it("accepts both spellings the publishers use", () => {
    expect(damageState("no_damage")).toBe("NoDamage");
    expect(damageState("NoDamage")).toBe("NoDamage");
    expect(damageState("slight_damage")).toBe("SlightDamage");
    expect(damageState("ModerateDamage")).toBe("ModerateDamage");
    expect(damageState("destroyed")).toBe("Destroyed");
  });

  it("degrades to NoDamage for anything unrecognised", () => {
    expect(damageState(null)).toBe("NoDamage");
    expect(damageState(undefined)).toBe("NoDamage");
    expect(damageState("something new")).toBe("NoDamage");
  });
});

describe("mergeRow", () => {
  it("needs an identifier", () => {
    expect(mergeRow(undefined, { name: "orphan" })).toBeNull();
  });

  it("starts an unpositioned entity at NaN, not 0,0", () => {
    // 0,0 is in the Gulf of Guinea and is a real coordinate; NaN is the only
    // honest way to say "not yet known".
    const entity = mergeRow(undefined, { entity_id: "e1", name: "INF.Rifle platoon [1]" })!;
    expect(Number.isNaN(entity.lat)).toBe(true);
    expect(positioned(entity)).toBe(false);
  });

  it("keeps a known position when a later sparse row omits it", () => {
    const first = mergeRow(undefined, { entity_id: "e1", latitude: 58.5, longitude: 24.1 })!;
    const second = mergeRow(first, { entity_id: "e1" })!;
    expect(second.lat).toBe(58.5);
    expect(second.lon).toBe(24.1);
  });

  it("reads hostile force ids in any casing or synonym", () => {
    for (const forceId of ["Opposing", "OPFOR", "enemy", "hostile", "RED"]) {
      expect(mergeRow(undefined, { entity_id: "e", force_id: forceId })!.force).toBe("RED");
    }
    expect(mergeRow(undefined, { entity_id: "e", force_id: "Friendly" })!.force).toBe("BLUE");
  });

  it("converts speed from m/s to km/h", () => {
    const entity = mergeRow(undefined, { entity_id: "e", speed_mps: 10 })!;
    expect(entity.speed).toBeCloseTo(36);
  });

  it("falls back to the name when no callsign has ever arrived", () => {
    const entity = mergeRow(undefined, { entity_id: "e1", name: "SWORD_1_INF.Rifle platoon" })!;
    expect(entity.callsign).toBe("SWORD_1_INF.Rifle platoon");
  });
});

describe("accumulateIdentity", () => {
  it("fills identity in from whichever row happened to carry it", () => {
    const identities = new Map<string, TrackRow>();
    accumulateIdentity(
      [
        { entity_id: "e1", latitude: 58.1, longitude: 24.1 },
        { entity_id: "e1", name: "INF.Rifle platoon [388]", callsign: "INF.Rifle platoon [388]" },
      ],
      identities
    );
    expect(identities.get("e1")?.name).toBe("INF.Rifle platoon [388]");
  });

  it("does not carry dynamic state across frames", () => {
    // The whole point of the split: a position seen later in the window must
    // not become part of an entity's identity, or scrubbing backwards would
    // show a unit somewhere it had not reached yet.
    const identities = new Map<string, TrackRow>();
    accumulateIdentity([{ entity_id: "e1", latitude: 58.1, longitude: 24.1 }], identities);
    const identity = identities.get("e1")!;
    expect(identity.latitude).toBeUndefined();
    expect(identity.longitude).toBeUndefined();
    expect(identity.heading_deg).toBeUndefined();
    expect(identity.damage_state).toBeUndefined();
  });

  it("accumulates across separate calls, as chunks arrive out of order", () => {
    const identities = new Map<string, TrackRow>();
    accumulateIdentity([{ entity_id: "e1", name: "INF.Company CP [412]" }], identities);
    accumulateIdentity([{ entity_id: "e1", simulator: "sword" }], identities);
    expect(identities.get("e1")).toMatchObject({
      name: "INF.Company CP [412]",
      simulator: "sword",
    });
  });

  it("ignores rows with no identifier", () => {
    const identities = new Map<string, TrackRow>();
    accumulateIdentity([{ name: "nobody" }], identities);
    expect(identities.size).toBe(0);
  });
});

describe("entityFromRow", () => {
  it("names a positional row from the accumulated identity", () => {
    const identity: TrackRow = {
      entity_id: "e1",
      name: "ARMOR.Medium tank platoon [300]",
      force_id: "Friendly",
      simulator: "vbs4",
    };
    const entity = entityFromRow(identity, {
      entity_id: "e1",
      latitude: 59.22,
      longitude: 24.13,
      heading_deg: 204,
    })!;

    expect(entity.unit).toBe("ARMOR.Medium tank platoon [300]");
    expect(entity.force).toBe("BLUE");
    expect(entity.simulator).toBe("vbs4");
    expect(entity.lat).toBe(59.22);
    expect(entity.heading).toBe(204);
    expect(positioned(entity)).toBe(true);
  });

  it("lets the row win over the identity where both carry a value", () => {
    const entity = entityFromRow(
      { entity_id: "e1", name: "old name" },
      { entity_id: "e1", name: "new name", latitude: 1, longitude: 2 }
    )!;
    expect(entity.unit).toBe("new name");
  });

  it("works with no identity at all", () => {
    const entity = entityFromRow(undefined, { entity_id: "e1", latitude: 1, longitude: 2 })!;
    expect(entity.id).toBe("e1");
    expect(positioned(entity)).toBe(true);
  });
});
