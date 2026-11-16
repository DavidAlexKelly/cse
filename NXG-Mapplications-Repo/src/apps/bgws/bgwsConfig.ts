import type { IConfigDefinition } from "@osdk/workshop-iframe-custom-widget";

// ── Workshop iframe config (BGWS) ────────────────────────────────────────────
//
//  mockDemo        bidirectional boolean ("mock-demo"), the same switch as HLA
//                  Map, Execute and Analysis. True: BGWS, the streams and the
//                  functions are all simulated in the browser.
//
//  mode            "build" or "live" — which half of the screen to open on.
//                  Lets one module put the builder on a Plan tab and the live
//                  view on an Execute tab with the same widget. Empty = build.
//
//  federate        which BGWS federate the control bar addresses, e.g.
//                  "BGWS-1-1". Empty = every BGWS federate (the contract's
//                  default). Bidirectional: the operator's choice is written
//                  back, so other widgets can follow it.
//
//  eventStreamRid  the HLA Events stream. Overrides the built-in default,
//                  which is empty until the stream exists (the screen then says
//                  "event stream not configured").
//
//  scenarioJson    input: a "bgws.foundry" (or "bgws.scenario") document to
//                  open in the builder, e.g. from an object property. Output:
//                  the JSON of the last scenario loaded into BGWS from here.
//
//  selectedUnitUuid / selectedUnitCallsign / onUnitSelected
//                  the live view's selection. The UUID (NETN UniqueId) rather
//                  than an HLA handle: BGWS's UUIDs are name-based and stable
//                  across runs, so a Workshop page can key on them.
//
//  onScenarioLoaded  fired when hla_bgws_load_scenario has queued a scenario.
//
// Strings, not object sets, for the same reason as HLA Map: live BGWS units are
// federation tracks, not ontology objects.
export const BGWS_CONFIG = [
  {
    fieldId: "mockDemo",
    field: {
      type: "single" as const,
      label: "mock-demo",
      helperText:
        "When true, simulates BGWS, its streams and the Commander functions in the browser. " +
        "Nothing is sent to Foundry. Leave false for the live federation.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "boolean" as const, defaultValue: false },
      },
    },
  },
  {
    fieldId: "mode",
    field: {
      type: "single" as const,
      label: "Mode",
      helperText: '"build" (scenario builder) or "live" (live view and orders). Empty opens the builder.',
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },
  {
    fieldId: "federate",
    field: {
      type: "single" as const,
      label: "BGWS federate",
      helperText: 'Federate the controls address, e.g. "BGWS-1-1". Empty = every BGWS federate.',
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },
  {
    fieldId: "eventStreamRid",
    field: {
      type: "single" as const,
      label: "HLA Events stream RID",
      helperText: "Dataset RID of the HLA Events stream. Empty uses the app's built-in default.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },
  {
    fieldId: "scenarioJson",
    field: {
      type: "single" as const,
      label: "Scenario JSON",
      helperText:
        "Input: a bgws.foundry document to open in the builder. " +
        "Output: the JSON of the last scenario loaded into BGWS from this widget.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },
  {
    fieldId: "selectedUnitUuid",
    field: {
      type: "single" as const,
      label: "Selected unit UUID",
      helperText: "Output: NETN UniqueId of the selected BGWS unit, or empty.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },
  {
    fieldId: "selectedUnitCallsign",
    field: {
      type: "single" as const,
      label: "Selected unit callsign",
      helperText: "Output: callsign of the selected BGWS unit, or empty.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },
  {
    fieldId: "onUnitSelected",
    field: {
      type: "single" as const,
      label: "On Unit Selected",
      fieldValue: { type: "event" as const },
    },
  },
  {
    fieldId: "onScenarioLoaded",
    field: {
      type: "single" as const,
      label: "On Scenario Loaded",
      fieldValue: { type: "event" as const },
    },
  },
] as const satisfies IConfigDefinition;
