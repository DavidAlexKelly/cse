import type { IConfigDefinition } from "@osdk/workshop-iframe-custom-widget";

// ── Workshop iframe config (HLA Map) ─────────────────────────────────────────
//
//  mockDemo — bidirectional boolean, surfaced in Workshop as "mock-demo".
//
//    false (default) — entities come from the live HLA track stream, and
//                      commands go to the real bridge.
//    true            — the app fakes the federation entirely: a realtime
//                      OP-BALTIC-SHIELD-2026 order of battle advances on the
//                      map with no simulator, bridge or RTI involved.
//
//  selectedEntity / selectedCallsign / onEntitySelected
//                  — which entity the operator has selected. The map previously
//                    kept this to itself, so a Workshop page could not put a
//                    detail card, task list or comms panel beside it.
//
// Why strings and not object sets: entities on this map are live federation
// tracks, not ontology objects. Their ids are HLA handles issued per federation
// execution — they are not NxgUnit primary keys and do not survive a restart,
// so there is nothing for an object-set variable to resolve to. The callsign is
// published alongside the id because it is the part a human can act on.
//
// There is deliberately no scenario or operation input: the live stream reads
// the whole track feed and has no filter to drive, so an input here would look
// like scoping without doing any. Add one when useEntityTrackStream can filter.
//
export const HLAMAP_CONFIG = [
  {
    fieldId: "mockDemo",
    field: {
      type: "single" as const,
      label: "mock-demo",
      helperText:
        "When true, fakes the simulation: a realtime OP-BALTIC-SHIELD-2026 " +
        "order of battle is generated client-side and no bridge, simulator or " +
        "RTI is contacted. Use when no working sim is available. " +
        "Leave false for the live HLA federation.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "boolean" as const, defaultValue: false },
      },
    },
  },
  {
    fieldId: "selectedEntity",
    field: {
      type: "single" as const,
      label: "Selected Entity",
      helperText:
        "Output: the HLA handle of the selected entity, or empty when nothing is selected. " +
        "Valid for the current federation execution only.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },
  {
    fieldId: "selectedCallsign",
    field: {
      type: "single" as const,
      label: "Selected Callsign",
      helperText:
        "Output: the callsign of the selected entity — the human-readable half of the " +
        "selection, for page titles and headers.",
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
