import { describe, expect, it } from "vitest";
import {
  assessReadiness,
  compositionXmlOf,
  cseValidationErrors,
  defaultProjectName,
  extractCompositions,
  extractNames,
  isAlreadyExists,
  orbatState,
  parseCseResult,
  parsePreflight,
  preflightState,
  storedCseVerdict,
  storedVerdictState,
} from "./executePlan";

describe("parsePreflight", () => {
  it("reads the Translator's report", () => {
    const report = parsePreflight(
      JSON.stringify({
        summary: "ORBAT has 1 error(s) and 1 warning(s).",
        errors: 1,
        warnings: 1,
        issues: [
          { severity: "ERROR", code: "NO_ASSET", message: "1 Bn has no asset", entity_id: 4 },
          { severity: "WARNING", code: "PLACEHOLDER_DIS", message: "DIS 0.0.0.0.0.0.0" },
        ],
      }),
    );
    expect(report).toMatchObject({ errors: 1, warnings: 1 });
    expect(report!.issues[0]).toEqual({
      severity: "ERROR",
      code: "NO_ASSET",
      message: "1 Bn has no asset",
    });
    expect(preflightState(report)).toBe("fail");
  });

  it("counts issues when the totals are missing", () => {
    const report = parsePreflight({ issues: [{ severity: "WARNING", code: "X", message: "m" }] });
    expect(report).toMatchObject({ errors: 0, warnings: 1 });
    expect(preflightState(report)).toBe("warn");
  });

  it("treats an unreadable answer as a failure, never a pass", () => {
    expect(parsePreflight("not json")).toBeNull();
    expect(preflightState(null)).toBe("fail");
  });

  it("passes a clean report", () => {
    expect(preflightState(parsePreflight({ errors: 0, warnings: 0, issues: [] }))).toBe("ok");
  });
});

describe("CSE answers", () => {
  it("separates a failed call from a successful one", () => {
    expect(
      parseCseResult('{"success": false, "error": "unavailable", "code": "UNAVAILABLE"}'),
    ).toEqual({
      ok: false,
      data: null,
      error: "unavailable (UNAVAILABLE)",
    });
    expect(parseCseResult('{"success": true, "data": {"id": "c1"}}')).toMatchObject({
      ok: true,
      data: { id: "c1" },
    });
    expect(parseCseResult("garbage").ok).toBe(false);
  });

  it("lists validation errors inside a successful call", () => {
    const result = parseCseResult({
      success: true,
      data: { errors: [{ path: "/Orbat/Unit[3]", message: "unknown class" }, "plain"] },
    });
    expect(cseValidationErrors(result)).toEqual(["/Orbat/Unit[3]: unknown class", "plain"]);
  });

  it("finds composition names anywhere in a decoded answer", () => {
    expect(
      extractNames({
        compositions: [{ name: "BALTIC-SWORD-VBS4" }, { info: { Name: "TEST" } }, { name: "" }],
      }),
    ).toEqual(["BALTIC-SWORD-VBS4", "TEST"]);
  });

  it("recognises 'already exists'", () => {
    expect(isAlreadyExists("Project CSP-X already exists")).toBe(true);
    expect(isAlreadyExists("timeout")).toBe(false);
    expect(isAlreadyExists(null)).toBe(false);
  });
});

describe("readiness", () => {
  it("needs an ORBAT and a clean preflight; CSE is advised", () => {
    expect(assessReadiness("fail", "pending", "pending").canLaunch).toBe(false);
    expect(assessReadiness("ok", "pending", "pending").canLaunch).toBe(false);
    expect(assessReadiness("ok", "fail", "ok").canLaunch).toBe(false);
    const warned = assessReadiness("ok", "warn", "pending");
    expect(warned.canLaunch).toBe(true);
    expect(warned.reason).toMatch(/recommended/);
    const rejected = assessReadiness("ok", "ok", "fail");
    expect(rejected.canLaunch).toBe(true);
    expect(rejected.reason).toMatch(/rejected/);
  });

  it("warns when only one side has forces", () => {
    expect(orbatState({ blue: 3, red: 0 })).toBe("warn");
    expect(orbatState({ blue: 3, red: 2 })).toBe("ok");
    expect(orbatState({ blue: 0, red: 0 })).toBe("fail");
    expect(orbatState(null)).toBe("pending");
  });

  it("derives a stable CSE project name", () => {
    expect(defaultProjectName("scenario_operation_baltic_shield")).toBe(
      "CSP-OPERATION-BALTIC-SHIELD",
    );
    expect(defaultProjectName("")).toBe("CSP-EXERCISE");
  });
});

describe("compositions", () => {
  const XML = '<Composition Name="CSP-SWORD-VBS4"><Systems/></Composition>';

  it("reads names and the composition document", () => {
    expect(
      extractCompositions({
        compositions: [
          {
            id: "1",
            name: "CSP-SWORD-VBS4",
            files: [{ path: "composition/composition.xml", content: XML }],
          },
          { id: "2", name: "Pitch only" },
        ],
      }),
    ).toEqual([
      { name: "CSP-SWORD-VBS4", xml: XML },
      { name: "Pitch only", xml: null },
    ]);
  });

  it("accepts a single composition and a single file (heuristic decoding)", () => {
    expect(
      extractCompositions(
        JSON.stringify({
          compositions: { name: "A", files: { path: "x/comp.xml", content: XML } },
        }),
      ),
    ).toEqual([{ name: "A", xml: XML }]);
  });

  it("prefers composition.xml, else any <Composition> document", () => {
    expect(
      compositionXmlOf([
        { path: "orbat.xml", content: "<Orbat/>" },
        { path: "a/composition.xml", content: XML },
      ]),
    ).toBe(XML);
    expect(compositionXmlOf([{ path: "orbat.xml", content: "<Orbat/>" }])).toBeNull();
  });

  it("falls back to names when the shape is unrecognised", () => {
    expect(extractCompositions({ data: [{ compositionName: "B" }] })).toEqual([
      { name: "B", xml: null },
    ]);
  });
});

describe("stored CSE verdict", () => {
  it("reads either spelling and the time", () => {
    const v = storedCseVerdict({
      cse_validation_status: "FAILED",
      cse_validation_detail: "2 errors",
      cse_validated_at: "2026-11-01T10:00:00Z",
    });
    expect(v).toEqual({ status: "FAILED", detail: "2 errors", atS: 1793527200 });
    expect(storedVerdictState(v)).toBe("warn");
    expect(storedVerdictState(storedCseVerdict({ cseValidationStatus: "PASSED" }))).toBe("ok");
  });
  it("is absent for a hierarchy never checked", () => {
    expect(storedCseVerdict({ name: "x" })).toBeNull();
    expect(storedVerdictState(null)).toBe("pending");
  });
});
