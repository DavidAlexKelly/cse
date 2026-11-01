import { describe, expect, it } from "vitest";
import {
  LAUNCH_PROPERTIES,
  type LaunchRecord,
  digestOf,
  latestLaunchByPhase,
  launchForRun,
  launchFromObject,
  launchIdOf,
  launchProperties,
  mergeLaunches,
} from "./launchRecords";

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

describe("NxgCseLaunch records", () => {
  const full: LaunchRecord = {
    launchId: "L1",
    scenarioId: "s",
    phaseId: "p1",
    phaseName: "Phase 1",
    operationKey: "OP",
    project: "CSP-S",
    composition: "CSP-SWORD-VBS4",
    status: "launched",
    unitCount: 25,
    orbatDigest: "abc",
    startedAtS: 1_800_000_000,
    publishedAtS: 1_800_000_030,
    simStartedAtS: 1_800_000_040,
    launchedAtS: 1_800_000_040,
    demo: false,
  };

  it("round-trips through the ontology properties", () => {
    const props = launchProperties(full);
    expect(Object.keys(props).sort()).toEqual([...LAUNCH_PROPERTIES].sort());
    expect(props.launchedAt).toBe("2027-01-15T08:00:40.000Z");
    expect(launchFromObject(props)).toEqual({
      ...full,
      failedStep: undefined,
      error: undefined,
      endedAtS: undefined,
    });
  });

  it("gives legacy device records a stable id", () => {
    const legacy = { scenarioId: "s", phaseId: "p", phaseName: "P", launchedAtS: 5, demo: false };
    expect(launchIdOf(legacy)).toBe("legacy-s-p-5");
  });

  it("merges device and ontology records, the ontology winning, newest first", () => {
    const local = [
      { ...full, status: "running" as const },
      { ...full, launchId: "L0", launchedAtS: 1 },
    ];
    const merged = mergeLaunches(local, [full]);
    expect(merged.map((r) => [r.launchId, r.status])).toEqual([
      ["L1", "launched"],
      ["L0", "launched"],
    ]);
  });

  it("ignores failed launches when matching a run", () => {
    const failed = {
      ...full,
      launchId: "F",
      status: "failed" as const,
      launchedAtS: 1_800_000_050,
    };
    expect(
      launchForRun({ startS: 1_800_000_060, endS: 1_800_003_600 }, [failed, full])?.launchId,
    ).toBe("L1");
  });

  it("finds the latest launch per phase", () => {
    const older = { ...full, launchId: "L0", launchedAtS: 1 };
    expect(latestLaunchByPhase([older, full]).get("p1")?.launchId).toBe("L1");
  });

  it("digests stably", () => {
    expect(digestOf("<Orbat/>")).toBe(digestOf("<Orbat/>"));
    expect(digestOf("<Orbat/>")).not.toBe(digestOf("<Orbat />"));
    expect(digestOf("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});
