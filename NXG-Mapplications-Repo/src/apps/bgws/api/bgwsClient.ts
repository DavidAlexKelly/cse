// ── bgws/api/bgwsClient.ts ─────────────────────────────────────────────────
// Every call the BGWS screen makes to Foundry, behind one small interface so
// mock mode can stand in for all of it (hooks/useBgwsMock).
//
//   loadScenario  hla_bgws_load_scenario  {scenario_json, federate?, speed?}
//   control       hla_bgws_control        {command, federate?, speed?}
//   order         hla_* via hlamap's bridge client, addressed by UniqueId
//
// The two BGWS functions are not in the generated SDK yet, so they go through
// executeQuery (SDK first, then the Ontology Queries REST API, under both the
// camelCase API name and the Python name). Orders reuse hlamap/bridgeClient
// unchanged: it already wraps the SDK's hla_* functions and owns the mapping
// from map vocabulary to the Commander's.
//
// Every method resolves — never rejects — with ok/error and, when the command
// was queued, its commandId: the key for its outcome rows and for the
// federate.status events BGWS sends back (requestId = command_id).

import { bridge } from "@/apps/hlamap/bridgeClient";
import { executeQuery } from "@/shared/lib/platformFunctions";
import type { ControlCommand } from "../types";
import {
  CONTROL_FUNCTION,
  LOAD_SCENARIO_FUNCTION,
  controlParams,
  loadScenarioParams,
  readFunctionResult,
  type FunctionResult,
} from "../lib/control";
import type { OrderCall } from "../lib/orders";

export interface BgwsApi {
  loadScenario(scenarioJson: string, federate: string, speed?: number): Promise<FunctionResult>;
  control(command: ControlCommand, federate: string, speed?: number): Promise<FunctionResult>;
  order(call: OrderCall): Promise<FunctionResult>;
}

function failure(err: unknown): FunctionResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** Dispatch an order to the matching bridge method; the argument tuple matches its signature. */
async function callBridge(call: OrderCall) {
  const method = bridge[call.method] as (...args: unknown[]) => ReturnType<typeof bridge.cancelTasks>;
  return method(...call.args);
}

export const realBgwsApi: BgwsApi = {
  async loadScenario(scenarioJson, federate, speed) {
    try {
      return readFunctionResult(
        await executeQuery(LOAD_SCENARIO_FUNCTION, loadScenarioParams(scenarioJson, federate, speed)),
      );
    } catch (err) {
      return failure(err);
    }
  },

  async control(command, federate, speed) {
    const built = controlParams(command, federate, speed);
    if (!built.ok) return { ok: false, error: built.error };
    try {
      return readFunctionResult(await executeQuery(CONTROL_FUNCTION, built.params));
    } catch (err) {
      return failure(err);
    }
  },

  async order(call) {
    try {
      const result = await callBridge(call);
      if (!result.ok) return { ok: false, error: result.error ?? "Command call failed", data: result.data };
      // The bridge client has already parsed the JSON; read the id out of it.
      return readFunctionResult(result.data);
    } catch (err) {
      return failure(err);
    }
  },
};
