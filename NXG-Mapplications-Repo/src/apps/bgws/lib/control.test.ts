import { describe, expect, it } from "vitest";
import { CONTROL_FUNCTION, LOAD_SCENARIO_FUNCTION, controlParams, loadScenarioParams, readFunctionResult } from "./control";

describe("function names", () => {
  it("tries the SDK's camelCase name, then the Python name", () => {
    expect(LOAD_SCENARIO_FUNCTION).toEqual(["hlaBgwsLoadScenario", "hla_bgws_load_scenario"]);
    expect(CONTROL_FUNCTION).toEqual(["hlaBgwsControl", "hla_bgws_control"]);
  });
});

describe("loadScenarioParams", () => {
  it("sends only scenario_json when addressing every federate at default speed", () => {
    expect(loadScenarioParams("{}", "")).toEqual({ scenario_json: "{}" });
  });
  it("adds a trimmed federate and a valid speed", () => {
    expect(loadScenarioParams("{}", " BGWS-1-1 ", 4)).toEqual({ scenario_json: "{}", federate: "BGWS-1-1", speed: 4 });
  });
  it("drops an invalid speed rather than sending it", () => {
    expect(loadScenarioParams("{}", "", 0)).toEqual({ scenario_json: "{}" });
  });
});

describe("controlParams", () => {
  it("builds start/pause/resume/stop without speed", () => {
    expect(controlParams("start", "")).toEqual({ ok: true, params: { command: "start" } });
    expect(controlParams("pause", "BGWS-1-1", 5)).toEqual({ ok: true, params: { command: "pause", federate: "BGWS-1-1" } });
  });
  it("requires a sane speed for the speed command", () => {
    expect(controlParams("speed", "", 10)).toEqual({ ok: true, params: { command: "speed", speed: 10 } });
    expect(controlParams("speed", "").ok).toBe(false);
    expect(controlParams("speed", "", 1000).ok).toBe(false);
  });
  it("refuses unknown commands", () => {
    expect(controlParams("rewind" as never, "").ok).toBe(false);
  });
});

describe("readFunctionResult", () => {
  it("reads the queued JSON text and its commandId", () => {
    const raw = JSON.stringify({ ok: true, status: "queued", commandId: "abc", operation: "MOVE" });
    expect(readFunctionResult(raw)).toMatchObject({ ok: true, commandId: "abc" });
  });
  it("accepts request_id and command_id spellings", () => {
    expect(readFunctionResult({ ok: true, request_id: "r1" }).commandId).toBe("r1");
    expect(readFunctionResult({ command_id: "c1" }).commandId).toBe("c1");
  });
  it("surfaces the nested detail of an error", () => {
    const raw = { error: "HTTP 400", detail: JSON.stringify({ error: "scenario_json format must be bgws.foundry" }) };
    expect(readFunctionResult(raw)).toMatchObject({ ok: false, error: "HTTP 400 — scenario_json format must be bgws.foundry" });
  });
  it("treats ok:false as a failure", () => {
    expect(readFunctionResult('{"ok": false, "error": "no"}')).toMatchObject({ ok: false, error: "no" });
  });
  it("passes through a non-JSON string as success", () => {
    expect(readFunctionResult("done")).toEqual({ ok: true, data: "done" });
  });
});
