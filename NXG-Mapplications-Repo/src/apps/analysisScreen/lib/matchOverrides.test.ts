import { describe, expect, it } from "vitest";
import type { PlannedUnit } from "@/shared/hla/balticShieldPlan";
import { type EntityCandidate, matchPlannedUnits } from "./entityMatch";
import { NOT_IN_RUN, resolveOverrides, simulatorName, withOverride } from "./matchOverrides";

const planned = (id: string, label: string, lat: number, lng: number): PlannedUnit => ({
  id,
  label,
  sidc: "",
  lat,
  lng,
  force: "blue",
  category: "Infantry",
});
const entity = (
  id: string,
  callsign: string,
  lat: number,
  lon: number,
  unit = "",
): EntityCandidate => ({
  id,
  callsign,
  unit,
  force: "blue",
  lat,
  lon,
});

const UNITS = [
  planned("bn", "1 Mech Bn", 54.1, 20.2),
  planned("art", "Long-Range Artillery", 54.0, 20.0),
];

describe("resolveOverrides", () => {
  it("finds the corrected entity by simulator name in this run's handles", () => {
    // Run 2: same callsigns, new HLA handles.
    const run = [entity("H9", "TANK-01", 54.1, 20.2), entity("H8", "GUN-7", 54.3, 20.4)];
    const r = resolveOverrides({ art: "gun 7" }, UNITS, run);
    expect(r.manual).toEqual({ art: "H8" });
    expect(r.stale).toEqual([]);
  });

  it("takes the vehicle nearest the planned start when several share a name", () => {
    const run = [entity("V1", "", 54.4, 20.4, "A Coy"), entity("V2", "", 54.11, 20.21, "A Coy")];
    expect(resolveOverrides({ bn: "A Coy" }, UNITS, run).manual).toEqual({ bn: "V2" });
  });

  it("reports corrections whose name is not in the run, and passes exclusions through", () => {
    const r = resolveOverrides({ bn: "NOBODY", art: NOT_IN_RUN }, UNITS, []);
    expect(r.stale).toEqual(["bn"]);
    expect([...r.exclude]).toEqual(["art"]);
  });

  it("drives the matcher: corrections win, exclusions are never guessed by position", () => {
    const run = [entity("H1", "TANK-01", 54.1, 20.2), entity("H2", "GUN-7", 54.0, 20.0)];
    const resolved = resolveOverrides({ bn: "GUN-7", art: NOT_IN_RUN }, UNITS, run);
    const result = matchPlannedUnits(UNITS, run, resolved);
    expect(result.matches.map((m) => [m.plannedId, m.entityId, m.method])).toEqual([
      ["bn", "H2", "manual"],
    ]);
    expect(result.unmatchedPlanned).toEqual(["art"]);
  });
});

describe("helpers", () => {
  it("names an entity by callsign, else unit, else id", () => {
    expect(simulatorName({ id: "H1", callsign: "ALPHA", unit: "A Coy" })).toBe("ALPHA");
    expect(simulatorName({ id: "H1", callsign: " ", unit: "A Coy" })).toBe("A Coy");
    expect(simulatorName({ id: "H1", callsign: "", unit: "" })).toBe("H1");
  });
  it("sets and clears a correction", () => {
    const set = withOverride({}, "bn", "X");
    expect(set).toEqual({ bn: "X" });
    expect(withOverride(set, "bn", undefined)).toEqual({});
  });
});
