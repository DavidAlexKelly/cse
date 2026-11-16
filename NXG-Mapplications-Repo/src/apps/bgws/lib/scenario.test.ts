import { describe, expect, it } from "vitest";
import type { ScenarioDraft } from "../types";
import {
  buildScenario,
  defaultDraft,
  draftFromScenario,
  hasErrors,
  importScenario,
  newObjective,
  newUnit,
  nextId,
  scenarioJson,
  validateScenario,
} from "./scenario";

const NOW = new Date("2026-06-01T07:20:00Z");
const AREA = { south: 54.65, west: 20.4, north: 54.75, east: 20.55 };

/** The contract's own example (CONTRACT §2c), as a draft. */
function exampleDraft(): ScenarioDraft {
  const d = defaultDraft(NOW);
  return {
    ...d,
    name: "Op Example",
    startUtc: "2026-06-01T08:00:00Z",
    area: AREA,
    units: [
      { id: "b-1", label: "Blue 1 tanks", side: "blue", platform: "generic/mbt", count: 4, quality: "regular", lat: 54.68, lon: 20.46, headingDeg: 0 },
      { id: "r-1", label: "Red 1 infantry", side: "red", platform: "generic/infantrySection", count: 3, quality: "veteran", lat: 54.72, lon: 20.5, headingDeg: 180 },
    ],
    objectives: [{ id: "o-1", side: "blue", label: "OBJ GOLD", lat: 54.71, lon: 20.47, radiusM: 600, holdMin: 10 }],
  };
}

describe("defaultDraft", () => {
  it("starts on the next whole hour, in UTC, with no milliseconds", () => {
    expect(defaultDraft(NOW).startUtc).toBe("2026-06-01T08:00:00Z");
  });
  it("has no area, so it cannot be built until one is drawn", () => {
    expect(defaultDraft(NOW).area).toBeNull();
    expect(buildScenario(defaultDraft(NOW))).toBeNull();
  });
});

describe("buildScenario", () => {
  it("produces the contract's bgws.foundry v1 document, key for key", () => {
    expect(buildScenario(exampleDraft())).toEqual({
      format: "bgws.foundry",
      version: 1,
      name: "Op Example",
      seed: 1,
      durationMin: 90,
      startUtc: "2026-06-01T08:00:00Z",
      weather: "clear",
      area: AREA,
      terrain: "real",
      command: { blue: "rules", red: "rules" },
      units: [
        { id: "b-1", label: "Blue 1 tanks", side: "blue", platform: "generic/mbt", count: 4, quality: "regular", lat: 54.68, lon: 20.46, headingDeg: 0 },
        { id: "r-1", label: "Red 1 infantry", side: "red", platform: "generic/infantrySection", count: 3, quality: "veteran", lat: 54.72, lon: 20.5, headingDeg: 180 },
      ],
      objectives: [{ side: "blue", label: "OBJ GOLD", lat: 54.71, lon: 20.47, radiusM: 600, holdMin: 10 }],
      breakpointPct: 60,
    });
  });

  it("keeps the contract's key order in the JSON text", () => {
    const keys = Object.keys(JSON.parse(scenarioJson(exampleDraft())!));
    expect(keys).toEqual([
      "format", "version", "name", "seed", "durationMin", "startUtc", "weather",
      "area", "terrain", "command", "units", "objectives", "breakpointPct",
    ]);
  });

  it("does not leak the editor's objective ids onto the wire", () => {
    expect(buildScenario(exampleDraft())!.objectives[0]).not.toHaveProperty("id");
  });

  it("rounds coordinates, normalises heading and falls back to the id for an empty label", () => {
    const d = exampleDraft();
    d.units[0] = { ...d.units[0], lat: 54.680000049, lon: 20.4612345678, headingDeg: -90, label: "  " };
    const u = buildScenario(d)!.units[0];
    expect(u.lat).toBe(54.68);
    expect(u.lon).toBe(20.461235);
    expect(u.headingDeg).toBe(270);
    expect(u.label).toBe("b-1");
  });

  it("names the neutral side's command only when there are neutral units", () => {
    const d = exampleDraft();
    expect(buildScenario(d)!.command).toEqual({ blue: "rules", red: "rules" });
    d.units.push({ ...d.units[0], id: "n-1", side: "neutral" });
    d.command = { blue: "foundry", red: "rules" };
    expect(buildScenario(d)!.command).toEqual({ blue: "foundry", red: "rules", neutral: "rules" });
  });
});

describe("validateScenario", () => {
  it("passes the contract example", () => {
    expect(hasErrors(validateScenario(exampleDraft()))).toBe(false);
  });

  it("requires an area", () => {
    const issues = validateScenario({ ...exampleDraft(), area: null });
    expect(issues.some((i) => i.level === "error" && i.field === "area")).toBe(true);
  });

  it("requires at least one blue and one red unit", () => {
    const d = exampleDraft();
    d.units = d.units.filter((u) => u.side === "blue");
    const errors = validateScenario(d).filter((i) => i.level === "error");
    expect(errors.map((e) => e.message)).toContain("Place at least one red unit.");
  });

  it("flags a unit outside the area and points at it", () => {
    const d = exampleDraft();
    d.units[1] = { ...d.units[1], lat: 55.5 };
    const issue = validateScenario(d).find((i) => i.ref === "r-1");
    expect(issue).toMatchObject({ level: "error", field: "unit" });
    expect(issue!.message).toMatch(/outside the area/);
  });

  it("flags an objective outside the area", () => {
    const d = exampleDraft();
    d.objectives[0] = { ...d.objectives[0], lon: 21.5 };
    expect(validateScenario(d).some((i) => i.ref === "o-1" && i.level === "error")).toBe(true);
  });

  it("rejects bad counts, durations, breakpoints and start times", () => {
    const d = exampleDraft();
    d.units[0] = { ...d.units[0], count: 0 };
    d.durationMin = 0;
    d.breakpointPct = 0;
    d.startUtc = "tomorrow";
    const fields = validateScenario(d).filter((i) => i.level === "error").map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(["unit", "durationMin", "breakpointPct", "startUtc"]));
  });

  it("rejects duplicate unit ids", () => {
    const d = exampleDraft();
    d.units.push({ ...d.units[0] });
    expect(validateScenario(d).some((i) => /Duplicate unit id/.test(i.message))).toBe(true);
  });

  it("only warns about a platform the local catalogue does not know", () => {
    const d = exampleDraft();
    d.units[0] = { ...d.units[0], platform: "future/hovertank" };
    const issue = validateScenario(d).find((i) => i.ref === "b-1");
    expect(issue?.level).toBe("warning");
    expect(hasErrors(validateScenario(d))).toBe(false);
  });

  it("warns when a side has more than one command post", () => {
    const d = exampleDraft();
    d.units.push({ ...d.units[0], id: "b-2", platform: "generic/cp-company" });
    d.units.push({ ...d.units[0], id: "b-3", platform: "generic/cp-battalion" });
    expect(validateScenario(d).some((i) => i.level === "warning" && /command posts/.test(i.message))).toBe(true);
  });

  it("rejects an area far too large and warns about a large real-terrain one", () => {
    const huge = validateScenario({ ...exampleDraft(), area: { south: 50, west: 10, north: 56, east: 20 } });
    expect(huge.some((i) => i.field === "area" && i.level === "error")).toBe(true);
    const big = { ...exampleDraft(), area: { south: 54, west: 20, north: 55.2, east: 21 } };
    big.units = big.units.map((u) => ({ ...u }));
    expect(validateScenario(big).some((i) => i.field === "area" && i.level === "warning")).toBe(true);
  });
});

describe("ids and placement", () => {
  it("takes the first free id", () => {
    expect(nextId("b", ["b-1", "b-3"])).toBe("b-2");
  });

  it("labels a placed unit by side, ordinal and platform", () => {
    const u = newUnit(exampleDraft(), "blue", "generic/mbt", { lat: 54.7, lon: 20.5 });
    expect(u.id).toBe("b-2");
    expect(u.label).toBe("Blue 2 Main battle tank troop");
    expect(u.quality).toBe("regular");
  });

  it("numbers objectives", () => {
    const o = newObjective(exampleDraft(), "red", { lat: 54.7, lon: 20.5 });
    expect(o).toMatchObject({ id: "o-2", label: "OBJ 2", side: "red" });
  });
});

describe("importScenario", () => {
  it("round-trips an export", () => {
    const result = importScenario(scenarioJson(exampleDraft(), true)!, NOW);
    expect(result.kind).toBe("draft");
    if (result.kind === "draft") expect(buildScenario(result.draft)).toEqual(buildScenario(exampleDraft()));
  });

  it("passes a native BGWS scenario through unchanged", () => {
    const native = { format: "bgws.scenario", version: 4, name: "Native", sides: [] };
    const result = importScenario(JSON.stringify(native));
    expect(result).toEqual({ kind: "native", name: "Native", json: JSON.stringify(native) });
  });

  it("refuses other formats, other versions and non-JSON", () => {
    expect(importScenario("{").kind).toBe("error");
    expect(importScenario("[]").kind).toBe("error");
    expect(importScenario('{"format":"other"}').kind).toBe("error");
    expect(importScenario('{"format":"bgws.foundry","version":2}').kind).toBe("error");
  });

  it("fills what a partial document leaves out", () => {
    const d = draftFromScenario({ format: "bgws.foundry", version: 1, units: [{ side: "red", lat: 1, lon: 2 }, { side: "red", lat: 1, lon: 2 }] }, NOW);
    expect(d.units.map((u) => u.id)).toEqual(["r-1", "r-2"]);
    expect(d.units[0].quality).toBe("regular");
    expect(d.area).toBeNull();
    expect(d.weather).toBe("clear");
  });
});
