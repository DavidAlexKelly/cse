import { describe, expect, it } from "vitest";
import { assessmentId, assessmentProperties, callsFromObjects } from "./assessmentRecord";

const CTX = { scenarioId: "s", phaseId: "p1", runId: "run-1000", runStartS: 1000, runEndS: 4600 };

describe("assessment records", () => {
  it("keys one object per run, phase and objective", () => {
    expect(assessmentId(CTX, "TO-1")).toBe("run-1000|p1|TO-1");
  });

  it("stores the call with the suggestion beside it for audit", () => {
    const props = assessmentProperties(
      CTX,
      "TO-1",
      { rating: "DEMONSTRATED", note: "Seen in the JOC" },
      { rating: "PARTIALLY_DEMONSTRATED", basis: "2 measured orders" },
      new Date("2026-11-01T12:00:00Z"),
    );
    expect(props).toEqual({
      assessmentId: "run-1000|p1|TO-1",
      objectiveId: "TO-1",
      phaseId: "p1",
      scenarioId: "s",
      runId: "run-1000",
      runStartTime: "1970-01-01T00:16:40.000Z",
      runEndTime: "1970-01-01T01:16:40.000Z",
      rating: "DEMONSTRATED",
      note: "Seen in the JOC",
      suggestedRating: "PARTIALLY_DEMONSTRATED",
      suggestionBasis: "2 measured orders",
      assessedAt: "2026-11-01T12:00:00.000Z",
    });
  });

  it("reads objects back, dropping unknown ratings and empty rows", () => {
    expect(
      callsFromObjects([
        { objectiveId: "a", rating: "DEMONSTRATED", note: "" },
        { objectiveId: "b", rating: "EXCELLENT", note: "great" },
        { objectiveId: "c", rating: null, note: "  " },
        { rating: "DEMONSTRATED" },
      ]),
    ).toEqual({
      a: { rating: "DEMONSTRATED", note: undefined },
      b: { rating: undefined, note: "great" },
    });
  });
});
