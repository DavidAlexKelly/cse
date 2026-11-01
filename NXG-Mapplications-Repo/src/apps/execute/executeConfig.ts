import type { IConfigDefinition } from "@osdk/workshop-iframe-custom-widget";

// ── Workshop iframe config (Execute) ─────────────────────────────────────────
//
//  scenario       — the exercise. Wire the same NxgScenario object-set variable
//                   the Scenario Planner gets ([NXG-P] Selected Scenario).
//  selectedPhase  — bidirectional. The phase to execute; the screen writes back
//                   the phase picked in its own selector.
//  mockDemo       — bidirectional boolean. When true every CSE / federation call
//                   is simulated (with the real phase ORBAT where it can be
//                   read), so the launch can be shown with no simulator.
//                   Wire it to the same boolean as HLA Map and Analysis.
//  onLaunched     — fired when a launch completes, so a Workshop page can move
//                   on to its live-map tab.
export const EXECUTE_CONFIG = [
  {
    fieldId: "scenario",
    field: {
      type: "single" as const,
      label: "Scenario (NxgScenario object set)",
      helperText: "The exercise to execute. Leave unset to fall back to Operation BALTIC SHIELD.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "selectedPhase",
    field: {
      type: "single" as const,
      label: "Selected Phase (NxgPhase object set)",
      helperText: "Bidirectional. The phase whose ORBAT is checked and launched.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "mockDemo",
    field: {
      type: "single" as const,
      label: "mock-demo",
      helperText:
        "When true, CSE and federation calls are simulated. Wire to the same Workshop " +
        "boolean as HLA Map and Analysis so the whole flow switches together.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "boolean" as const, defaultValue: false },
      },
    },
  },
  {
    fieldId: "onLaunched",
    field: {
      type: "single" as const,
      label: "On Launched",
      fieldValue: { type: "event" as const },
    },
  },
] as const satisfies IConfigDefinition;
