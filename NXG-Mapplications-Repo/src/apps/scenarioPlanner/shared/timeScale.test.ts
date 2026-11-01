import { describe, expect, it } from "vitest";
import { formatPhaseOffset, parsePhaseOffset } from "./timeScale";
import type { PhaseOffsetUnit } from "./types";

// Phase offsets are stored on NxgPhase as scenario-relative strings ("D+2",
// "H+18"). The widget holds them as a number plus a unit. Until phases became
// writable only the parse direction existed, so a formatting mistake could not
// corrupt anything. Now that createNxgPPhase / modifyNxgPPhase write these
// strings back, the two directions have to be exact inverses — a stray "D2" or
// "+2" would be unparseable on the next load and silently collapse the phase
// to a zero-length window, which breaks order feasibility and the timeline.

describe("formatPhaseOffset", () => {
  it("renders the wire format the ontology expects", () => {
    expect(formatPhaseOffset(0, "day")).toBe("D+0");
    expect(formatPhaseOffset(2, "day")).toBe("D+2");
    expect(formatPhaseOffset(-1, "day")).toBe("D-1");
    expect(formatPhaseOffset(18, "hour")).toBe("H+18");
    expect(formatPhaseOffset(-6, "hour")).toBe("H-6");
  });

  it("defaults to the day scale when no unit is given", () => {
    expect(formatPhaseOffset(3, undefined)).toBe("D+3");
  });
});

describe("parsePhaseOffset", () => {
  it("reads both scales", () => {
    expect(parsePhaseOffset("D+2")).toEqual({ value: 2, unit: "day" });
    expect(parsePhaseOffset("H+18")).toEqual({ value: 18, unit: "hour" });
    expect(parsePhaseOffset("D-1")).toEqual({ value: -1, unit: "day" });
  });

  it("accepts the zero spellings and is whitespace/case tolerant", () => {
    expect(parsePhaseOffset("D-Day")).toEqual({ value: 0, unit: "day" });
    expect(parsePhaseOffset("H-Hour")).toEqual({ value: 0, unit: "hour" });
    expect(parsePhaseOffset(" h+4 ")).toEqual({ value: 4, unit: "hour" });
  });

  it("returns null for values it cannot read rather than guessing zero", () => {
    // The caller warns and falls back to 0; silently mapping junk to 0 here
    // would hide the warning.
    expect(parsePhaseOffset(undefined)).toBeNull();
    expect(parsePhaseOffset("")).toBeNull();
    expect(parsePhaseOffset("tomorrow")).toBeNull();
    expect(parsePhaseOffset("D+")).toBeNull();
  });
});

describe("offset round-trip", () => {
  it("survives format → parse for every scale and sign", () => {
    const units: PhaseOffsetUnit[] = ["day", "hour"];
    for (const unit of units) {
      for (const value of [-12, -1, 0, 1, 7, 42, 336]) {
        const wire = formatPhaseOffset(value, unit);
        expect(parsePhaseOffset(wire), `round-trip of ${wire}`).toEqual({ value, unit });
      }
    }
  });
});
