import type { IConfigDefinition } from "@osdk/workshop-iframe-custom-widget";

// ── Workshop iframe config (Analysis Screen) ─────────────────────────────────
//
//  mockDemo — bidirectional boolean. When true the screen replays a synthetic
//             OP-BALTIC-SHIELD-2026 run instead of querying the HLA tracks
//             dataset, so after-action playback is demonstrable with no
//             simulator having ever run. Wire it to the same Workshop boolean
//             as the HLA Map widget so both switch together.
//
//  run      — bidirectional string. The run being replayed. Workshop writes it
//             to open the screen on a particular run; the screen writes it back
//             whenever the user picks a different one, so a debrief page can
//             follow along.
//
//             A string rather than an object set, unlike the Scenario Planner's
//             outputs: runs are detected from the HLA Entity Tracks dataset and
//             have no object type, so there is nothing to point an object set
//             at. If runs ever become ontology objects, this should become one.
//
//  selectedEntity / onEntitySelected — which track the user has selected, and
//             an event when that changes. Also a plain string: HLA handles are
//             federation-execution ids, not NxgUnit primary keys, and they are
//             only unique within one run.
//
export const ANALYSIS_CONFIG = [
  {
    fieldId: "mockDemo",
    field: {
      type: "single" as const,
      label: "mock-demo",
      helperText:
        "When true, replays a synthetic OP-BALTIC-SHIELD-2026 run instead of reading the " +
        "HLA Entity Tracks dataset. Use when no simulation has been run. Wire this to the " +
        "same Workshop boolean as the HLA Map widget so both switch together.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "boolean" as const, defaultValue: false },
      },
    },
  },
  {
    fieldId: "run",
    field: {
      type: "single" as const,
      label: "Run",
      helperText:
        "Bidirectional. The run id being replayed — the screen writes the run the user " +
        "selects, and Workshop can write one to open the screen on it. Ids come from the " +
        "HLA Entity Tracks dataset and are only meaningful for the live source; the mock " +
        "run has an id of its own.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },
  {
    fieldId: "selectedEntity",
    field: {
      type: "single" as const,
      label: "Selected Entity",
      helperText:
        "Output: the HLA handle of the track the user selected, or empty when nothing is " +
        "selected. Unique within a run only.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },
  {
    fieldId: "onEntitySelected",
    field: {
      type: "single" as const,
      label: "On Entity Selected",
      fieldValue: { type: "event" as const },
    },
  },
] as const satisfies IConfigDefinition;
