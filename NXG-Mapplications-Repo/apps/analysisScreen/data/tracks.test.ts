import { describe, expect, it } from "vitest";
import { groupMinutesIntoRuns } from "./runs";
import { parseCsv } from "./csv";

describe("groupMinutesIntoRuns", () => {
  it("returns nothing for an empty feed", () => {
    expect(groupMinutesIntoRuns([])).toEqual([]);
  });

  it("treats a contiguous block as one run and covers the last minute", () => {
    const runs = groupMinutesIntoRuns([100, 101, 102]);
    expect(runs).toHaveLength(1);
    expect(runs[0].startS).toBe(100 * 60);
    // The run must extend to the END of minute 102, not its start, or the last
    // minute of every run is unreachable on the timeline.
    expect(runs[0].endS).toBe(103 * 60);
    expect(runs[0].activeMinutes).toBe(3);
  });

  it("tolerates a gap at or below the threshold", () => {
    // 100 -> 102 is a two-minute gap: still the same run at the default of 2.
    expect(groupMinutesIntoRuns([100, 102, 103])).toHaveLength(1);
  });

  it("splits on a gap above the threshold", () => {
    const runs = groupMinutesIntoRuns([100, 101, 200, 201]);
    expect(runs).toHaveLength(2);
    // Newest first.
    expect(runs[0].startS).toBe(200 * 60);
    expect(runs[1].startS).toBe(100 * 60);
  });

  it("counts only active minutes, not the span", () => {
    const [run] = groupMinutesIntoRuns([10, 12, 14]);
    expect(run.activeMinutes).toBe(3);
    expect(run.endS - run.startS).toBe(5 * 60);
  });

  it("handles a single isolated minute", () => {
    const runs = groupMinutesIntoRuns([500]);
    expect(runs).toHaveLength(1);
    expect(runs[0].endS - runs[0].startS).toBe(60);
  });
});

describe("parseCsv", () => {
  it("parses a plain result set", () => {
    const table = parseCsv("a,b\n1,2\n3,4\n");
    expect(table.columns).toEqual(["a", "b"]);
    expect(table.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("keeps commas inside quoted unit names intact", () => {
    const table = parseCsv('id,name\n1,"INF.Rifle platoon [388], det"\n');
    expect(table.rows[0]).toEqual(["1", "INF.Rifle platoon [388], det"]);
  });

  it("unescapes doubled quotes", () => {
    const table = parseCsv('id,name\n1,"say ""hi"""\n');
    expect(table.rows[0]).toEqual(["1", 'say "hi"']);
  });

  it("handles a final row with no trailing newline", () => {
    const table = parseCsv("a,b\n1,2");
    expect(table.rows).toEqual([["1", "2"]]);
  });

  it("treats empty fields as empty strings, not missing columns", () => {
    const table = parseCsv("a,b,c\n1,,3\n");
    expect(table.rows[0]).toEqual(["1", "", "3"]);
  });
});
