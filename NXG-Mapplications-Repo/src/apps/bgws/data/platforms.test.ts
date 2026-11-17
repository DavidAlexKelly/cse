import { describe, expect, it } from "vitest";
import { BGWS_PLATFORMS, groupedPlatforms, isCommandPost, platformById } from "./platforms";
import { sidcForPlatform } from "../lib/symbols";

describe("platform catalogue", () => {
  it("has every BGWS platform once", () => {
    const ids = BGWS_PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(94);
  });

  it("groups every platform exactly once, command posts first", () => {
    const groups = groupedPlatforms();
    expect(groups[0].label).toBe("Command posts");
    expect(groups.flatMap((g) => g.platforms).length).toBe(BGWS_PLATFORMS.length);
  });

  it("marks the four command posts as HQs", () => {
    expect(BGWS_PLATFORMS.filter((p) => p.hq).map((p) => p.id).sort()).toEqual([
      "generic/cp-battalion",
      "generic/cp-brigade",
      "generic/cp-company",
      "generic/cp-division",
    ]);
    expect(isCommandPost("generic/mbt")).toBe(false);
  });

  it("knows a platform by id", () => {
    expect(platformById("generic/mbt")?.name).toBe("Main battle tank troop");
    expect(platformById("nope")).toBeUndefined();
  });
});

describe("sidcForPlatform", () => {
  it("draws a friendly armour platoon for a blue tank troop", () => {
    expect(sidcForPlatform("generic/mbt", "blue")).toBe("SFGPUCA----D---");
  });
  it("draws a hostile HQ at company echelon for a red company CP", () => {
    expect(sidcForPlatform("generic/cp-company", "red")).toBe("SHGPUC----AE---");
  });
  it("uses the explicit function ID for drones and submarines", () => {
    expect(sidcForPlatform("generic/owaDrone", "red")).toBe("SHAPMFQ--------");
    expect(sidcForPlatform("generic/ssk", "neutral")).toBe("SNUPS----------");
  });
  it("draws an unknown platform as a bare ground frame", () => {
    expect(sidcForPlatform("future/x", "blue")).toBe("SFGP-----------");
  });
  it("always produces 15 characters", () => {
    for (const p of BGWS_PLATFORMS) {
      for (const side of ["blue", "red", "neutral"] as const) expect(sidcForPlatform(p.id, side)).toHaveLength(15);
    }
  });
});
