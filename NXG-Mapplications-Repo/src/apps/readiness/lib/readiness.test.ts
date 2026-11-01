import { describe, expect, it } from "vitest";
import { fieldNames } from "@/shared/lib/metadataFields";
import {
  type PhaseFacts,
  bestPhase,
  demoModeCheck,
  mapFacts,
  phaseVerdict,
  runCheck,
} from "./dataChecks";
import { headline, readinessReport } from "./report";
import {
  type ProbeFinding,
  REQUIREMENTS,
  type Requirement,
  evaluateResource,
} from "./requirements";

const req = (id: string): Requirement => {
  const r = REQUIREMENTS.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};

const present = (fields: string[], inSdk = true, apiName = "x"): ProbeFinding => ({
  apiName,
  status: "present",
  inSdk,
  fields,
  detail: "",
});

describe("requirements", () => {
  it("have unique ids", () => {
    const ids = REQUIREMENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("include every function the Execute screen calls by name", () => {
    const names = REQUIREMENTS.flatMap((r) => r.names);
    for (const n of [
      "nxgPreflightOrbatFromPhase",
      "nxgTranslateOrbatToXmlFromPhase",
      "nxgCseAddOrbatToProject",
      "nxgCsePublishProject",
      "cseAddProject",
    ])
      expect(names).toContain(n);
  });
});

describe("evaluateResource", () => {
  it("fails a missing required resource and says where the fix is", () => {
    const r = evaluateResource(req("q-preflight"), {
      ...present([]),
      status: "missing",
      detail: "HTTP 404",
    });
    expect(r.state).toBe("fail");
    expect(r.message).toMatch(/will fail/);
    expect(r.fix).toMatch(/Developer Console/);
    expect(r.fix).toMatch(/EXECUTE\.md/);
  });

  it("only warns for an optional resource", () => {
    const r = evaluateResource(req("o-assessment"), { ...present([]), status: "missing" });
    expect(r.state).toBe("warn");
    expect(r.message).toMatch(/falls back/);
  });

  it("catches a resource that exists without a field the app sends", () => {
    const r = evaluateResource(req("a-hierarchy"), present(["primaryKey", "name", "operationKey"]));
    expect(r.state).toBe("fail");
    expect(r.message).toMatch(/no parameter phaseKey/);
  });

  it("names object type properties as properties", () => {
    const r = evaluateResource(req("o-hierarchy"), present(["operationKey"]));
    expect(r.message).toMatch(/no property phaseKey/);
  });

  it("passes, noting the REST fallback for by-name functions outside the SDK", () => {
    const r = evaluateResource(req("q-publish"), present(["project_name"], false));
    expect(r.state).toBe("ok");
    expect(r.message).toMatch(/REST fallback/);
    expect(r.fix).toMatch(/regenerate the SDK/);
  });

  it("does not fail fields it could not list", () => {
    const r = evaluateResource(req("a-hierarchy"), present([]));
    expect(r.state).toBe("ok");
    expect(r.message).toMatch(/not checked/);
  });

  it("is pending until probed", () => {
    expect(evaluateResource(req("o-phase"), null).state).toBe("pending");
  });
});

describe("fieldNames", () => {
  it("reads maps and lists", () => {
    expect(fieldNames("action", { parameters: { a: {}, b: {} } })).toEqual(["a", "b"]);
    expect(fieldNames("objectType", { properties: { p: {} } })).toEqual(["p"]);
    expect(fieldNames("objectType", { objectType: { properties: { q: {} } } })).toEqual(["q"]);
    expect(fieldNames("query", { parameters: [{ apiName: "x" }, { name: "y" }] })).toEqual([
      "x",
      "y",
    ]);
    expect(fieldNames("query", null)).toEqual([]);
  });
});

const READY: PhaseFacts = {
  phaseId: "p1",
  phaseName: "Phase 1",
  mapUnits: 10,
  linkedUnits: 10,
  orders: 6,
  orbat: { blue: 120, red: 80 },
  phaseObjectives: 3,
  scenarioObjectives: 0,
};

describe("phaseVerdict", () => {
  it("passes a fully built phase", () => {
    expect(phaseVerdict(READY)).toEqual({
      state: "ok",
      findings: ["Ready for the whole demo path."],
    });
  });

  it("fails a phase with no ORBAT", () => {
    const v = phaseVerdict({ ...READY, orbat: { blue: 0, red: 0 } });
    expect(v.state).toBe("fail");
    expect(v.findings[0]).toMatch(/Save phase ORBAT/);
  });

  it("fails an unplanned phase", () => {
    expect(phaseVerdict({ ...READY, mapUnits: null }).state).toBe("fail");
  });

  it("warns about no orders, unlinked units, one side, no objectives — worst first", () => {
    const v = phaseVerdict({
      ...READY,
      orders: 0,
      linkedUnits: 7,
      orbat: { blue: 50, red: 0 },
      phaseObjectives: 0,
    });
    expect(v.state).toBe("warn");
    expect(v.findings.join(" ")).toMatch(/No orders/);
    expect(v.findings.join(" ")).toMatch(/3 of 10 map units/);
    expect(v.findings.join(" ")).toMatch(/Only blue/);
    expect(v.findings.join(" ")).toMatch(/No training objectives/);
  });

  it("accepts scenario-wide objectives, and says so", () => {
    const v = phaseVerdict({ ...READY, phaseObjectives: 0, scenarioObjectives: 4 });
    expect(v.state).toBe("ok");
    expect(v.findings[0]).toMatch(/4 scenario-wide ones/);
  });

  it("picks the readiest, most built phase", () => {
    const empty = { ...READY, phaseId: "p0", orbat: { blue: 0, red: 0 } };
    const small = { ...READY, phaseId: "p2", orbat: { blue: 5, red: 5 } };
    expect(bestPhase([empty, small, READY])?.phaseId).toBe("p1");
    expect(bestPhase([])).toBeNull();
  });
});

describe("mapFacts", () => {
  it("counts units, ORBAT links and orders (arrows assigned to a unit on the map)", () => {
    const state = {
      units: [{ id: "u1", orbatRootUnitKey: "k1" }, { id: "u2" }],
      arrows: [
        { id: "a1", assignedUnitId: "u1" },
        { id: "a2", assignedUnitId: "gone" },
        { id: "a3" },
      ],
      objectives: [],
    } as unknown as Parameters<typeof mapFacts>[0];
    expect(mapFacts(state)).toEqual({ mapUnits: 2, linkedUnits: 1, orders: 1 });
    expect(mapFacts(null)).toEqual({ mapUnits: null, linkedUnits: 0, orders: 0 });
  });
});

describe("runs and demo mode", () => {
  it("warns when nothing has been recorded", () => {
    expect(runCheck({ runs: 0, latestEndS: null }).state).toBe("warn");
  });
  it("says how recent the last run is", () => {
    const now = Date.UTC(2026, 10, 1);
    expect(runCheck({ runs: 3, latestEndS: now / 1000 - 2 * 86400 }, now).message).toBe(
      "3 runs recorded, the latest 2 days ago.",
    );
  });
  it("needs obs_phase_01 and its map for demo-mode next phase", () => {
    expect(demoModeCheck({ phase: true, mapState: true }).state).toBe("ok");
    expect(demoModeCheck({ phase: false, mapState: false }).message).toMatch(/not in the ontology/);
  });
});

describe("report", () => {
  const results = [
    evaluateResource(req("q-preflight"), {
      ...present([], false, "nxgPreflightOrbatFromPhase"),
      status: "missing",
      detail: "HTTP 404",
    }),
    evaluateResource(req("o-phase"), present([], true, "NxgPhase")),
  ];

  it("leads with what blocks the demo", () => {
    expect(headline(results)).toEqual({
      state: "fail",
      text: "1 problem will stop part of the demo.",
    });
    expect(headline([results[1]]).state).toBe("ok");
  });

  it("writes every finding with its fix, by stage, then the phases", () => {
    const text = readinessReport({
      scenarioName: "BALTIC SHIELD",
      generatedAt: new Date("2026-11-01T10:00:00Z"),
      results,
      phases: [{ ...READY, orbat: { blue: 0, red: 0 } }],
    });
    expect(text).toContain("Demo readiness — BALTIC SHIELD");
    expect(text).toContain("[FAIL] nxgPreflightOrbatFromPhase (function) — Not found.");
    expect(text).toContain("Fix: Create it");
    expect(text).toContain("[OK  ] NxgPhase (object type) — Present.");
    expect(text).toMatch(/Phases\n {2}\[FAIL\] Phase 1 — map 10, orders 6, ORBAT 0 blue \/ 0 red/);
  });
});
