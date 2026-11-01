import { describe, expect, it } from "vitest";
import { type LaunchRecord, launchForRun } from "./launchRecords";

const rec = (phaseId: string, launchedAtS: number, demo = false): LaunchRecord => ({
  scenarioId: "s",
  phaseId,
  phaseName: phaseId,
  launchedAtS,
  demo,
});

describe("launchForRun", () => {
  const run = { startS: 10_000, endS: 20_000 };

  it("finds the launch that preceded the run's first track", () => {
    expect(launchForRun(run, [rec("p1", 9_500), rec("p0", 2_000)])?.phaseId).toBe("p1");
  });

  it("prefers the latest launch in the window", () => {
    expect(launchForRun(run, [rec("p1", 9_200), rec("p2", 9_800)])?.phaseId).toBe("p2");
  });

  it("ignores launches far from the run, and demo launches", () => {
    expect(
      launchForRun(run, [rec("p1", 5_000), rec("p2", 9_900, true), rec("p3", 12_000)]),
    ).toBeNull();
  });
});
