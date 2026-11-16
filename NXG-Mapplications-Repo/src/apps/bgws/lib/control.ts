// ── bgws/lib/control.ts ────────────────────────────────────────────────────
// Loading a scenario into BGWS and driving its clock: the parameters for
// hla_bgws_load_scenario and hla_bgws_control (CONTRACT §2e), and reading what
// a Commander function returns.
//
// Both functions are new and not in the generated SDK yet, so they are called
// through shared/lib/platformFunctions' executeQuery, which tries the SDK and
// then the Ontology Queries REST API under each name given. Once the SDK is
// regenerated with them nothing here changes.

import type { ControlCommand } from "../types";

export const LOAD_SCENARIO_FUNCTION = ["hlaBgwsLoadScenario", "hla_bgws_load_scenario"];
export const CONTROL_FUNCTION = ["hlaBgwsControl", "hla_bgws_control"];

export const CONTROL_COMMANDS: readonly ControlCommand[] = ["start", "pause", "resume", "stop", "speed"];

/** Sim seconds per wall second BGWS will be asked for. */
export const SPEED_LIMITS = { min: 0.1, max: 100 } as const;

export function validSpeed(speed: unknown): speed is number {
  return typeof speed === "number" && Number.isFinite(speed) && speed >= SPEED_LIMITS.min && speed <= SPEED_LIMITS.max;
}

/**
 * Parameters for hla_bgws_load_scenario.
 *
 * Optional parameters are left out rather than sent empty: an empty federate
 * already means "every BGWS federate", and leaving speed out keeps BGWS's own
 * default rather than forcing 1×.
 */
export function loadScenarioParams(
  scenarioJson: string,
  federate: string,
  speed?: number,
): Record<string, unknown> {
  const params: Record<string, unknown> = { scenario_json: scenarioJson };
  if (federate.trim()) params.federate = federate.trim();
  if (validSpeed(speed)) params.speed = speed;
  return params;
}

/** Parameters for hla_bgws_control. `speed` is required for the speed command and ignored otherwise. */
export function controlParams(
  command: ControlCommand,
  federate: string,
  speed?: number,
): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
  if (!CONTROL_COMMANDS.includes(command)) return { ok: false, error: `Unknown command "${command}".` };
  const params: Record<string, unknown> = { command };
  if (federate.trim()) params.federate = federate.trim();
  if (command === "speed") {
    if (!validSpeed(speed)) {
      return { ok: false, error: `Speed must be ${SPEED_LIMITS.min}–${SPEED_LIMITS.max}× real time.` };
    }
    params.speed = speed;
  }
  return { ok: true, params };
}

export interface FunctionResult {
  ok: boolean;
  /** The command row's id, to correlate with the outcome stream and federate.status. */
  commandId?: string;
  error?: string;
  data?: unknown;
}

/**
 * Read a Commander function's return value.
 *
 * The functions return JSON text: `{"ok": true, "status": "queued",
 * "commandId": …}` on success. The BGWS functions are specified to return
 * `request_id` (= command_id); older and newer builds spell the id three ways,
 * so all are accepted. A refusal is `{"ok": false, "error": …}` or
 * `{"error": …, "detail": …}`, where the detail often holds the one sentence
 * worth reading.
 */
export function readFunctionResult(raw: unknown): FunctionResult {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { ok: true, data: raw };
    }
  }
  if (!value || typeof value !== "object") return { ok: true, data: value };
  const v = value as Record<string, unknown>;
  const id = [v.commandId, v.command_id, v.request_id, v.requestId].find(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  if (v.ok === false || "error" in v) {
    let message = String(v.error ?? "Command call failed");
    if (v.detail !== undefined) {
      const detail = typeof v.detail === "string" ? v.detail : JSON.stringify(v.detail);
      try {
        const inner = JSON.parse(detail) as { error?: unknown };
        message += ` — ${inner && typeof inner === "object" && inner.error !== undefined ? String(inner.error) : detail}`;
      } catch {
        message += ` — ${detail}`;
      }
    }
    return { ok: false, error: message, commandId: id, data: v };
  }
  return { ok: true, commandId: id, data: v };
}
