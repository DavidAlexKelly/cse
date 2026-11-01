import { describe, expect, it } from "vitest";
import type { PlannedUnit } from "@/shared/hla/balticShieldPlan";
import { type EntityCandidate, matchPlannedUnits, normaliseName } from "./entityMatch";

function planned(
  id: string,
  label: string,
  lat: number,
  lng: number,
  force: "blue" | "red" = "blue",
): PlannedUnit {
  return { id, label, sidc: "", lat, lng, force, category: "Infantry" };
}
function entity(
  id: string,
  callsign: string,
  lat: number,
  lon: number,
  force: "blue" | "red" = "blue",
  unit = "",
): EntityCandidate {
  return { id, callsign, unit, force, lat, lon };
}

describe("matchPlannedUnits", () => {
  it("matches by name first, then by nearest position, each entity once", () => {
    const result = matchPlannedUnits(
      [
        planned("bn", "1 Mech Bn (West)", 54.1, 20.2),
        planned("coy", "A Coy", 54.2, 20.3),
        planned("far", "Recce Tp", 56, 25),
      ],
      [
        // Named exactly — though a different entity is nearer to the planned spot.
        entity("H1", "1 MECH BN WEST", 54.15, 20.25),
        entity("H2", "TANK-01", 54.1, 20.2),
        entity("H3", "TANK-02", 54.21, 20.31),
      ],
    );
    expect(result.matches).toEqual([
      expect.objectContaining({ plannedId: "bn", entityId: "H1", method: "name" }),
      expect.objectContaining({ plannedId: "coy", entityId: "H3", method: "position" }),
    ]);
    expect(result.unmatchedPlanned).toEqual(["far"]);
    expect(result.entityFor.get("coy")).toBe("H3");
  });

  it("never matches across sides", () => {
    const result = matchPlannedUnits(
      [planned("red", "22nd MRBDE", 54, 20, "red")],
      [entity("H1", "22nd MRBDE", 54, 20, "blue")],
    );
    expect(result.matches).toEqual([]);
  });

  it("assigns position matches closest-pair first", () => {
    const result = matchPlannedUnits(
      [planned("a", "A", 54.0, 20.0), planned("b", "B", 54.05, 20.0)],
      [entity("E1", "x", 54.049, 20.0), entity("E2", "y", 54.0, 20.001)],
    );
    expect(result.entityFor.get("a")).toBe("E2");
    expect(result.entityFor.get("b")).toBe("E1");
  });

  it("lets a manual table override everything", () => {
    const result = matchPlannedUnits(
      [planned("bn", "1 Mech Bn", 54, 20)],
      [entity("H1", "1 Mech Bn", 54, 20), entity("H9", "other", 60, 30)],
      {
        manual: { bn: "H9" },
      },
    );
    expect(result.matches[0]).toMatchObject({ entityId: "H9", method: "manual" });
  });

  it("does not treat short fragments as names", () => {
    const result = matchPlannedUnits(
      [planned("bn", "Bn", 54, 20)],
      [entity("H1", "1 Mech Bn", 70, 20)],
    );
    expect(result.matches).toEqual([]);
    expect(normaliseName("1 Mech Bn (West)")).toBe("1 mech bn west");
  });
});
