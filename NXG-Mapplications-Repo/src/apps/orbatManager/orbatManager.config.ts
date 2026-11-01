import type { IConfigDefinition } from "@osdk/workshop-iframe-custom-widget";

// ── Workshop iframe config (ORBAT Manager) ───────────────────────────────────
//
// Lifted out of App.tsx, where it sat as an inline literal and so was invisible
// next to the other widgets' configs.
//
// The principle, same as the Scenario Planner: tell the widget WHICH ontology
// object to work on, not what that object contains. Objects come in as object
// sets rather than bare primary keys, so Workshop can type-check the wiring and
// the widget can traverse links from there.
//
//  INPUTS (Workshop → widget):
//    operation         — NxgOperation object set. The widget loads that
//                        operation's hierarchies, units, edges and symbols.
//                        Was a bare `operationKey` string; unset still falls
//                        back to OPERATION-BALTIC-SHIELD.
//    phase             — NxgPhase object set. When set, the widget imports that
//                        phase's ORBAT from the Template Orbat Graph record the
//                        Scenario Planner wrote for it (tagged "phase:<id>").
//                        Replaces phaseOrbatJson, which required another widget
//                        to push the whole ORBAT across as a JSON string.
//    phaseDescription  — free text asking the widget to GENERATE a phase ORBAT
//                        via the llmPhaseToOrbat function. Kept as a string: it
//                        is a command, not data, and there is no object for it.
//
//  OUTPUTS (widget → Workshop):
//    selectedUnit      — temporaryObjectSetRid for the NxgUnit in focus.
//    hierarchy         — temporaryObjectSetRid for the NxgUnitHierarchy being
//                        edited, so a page can show its units alongside.
//
//  EVENTS:
//    onUnitSelected    — the user selected a different unit.
//    onOrbatSaved      — a composition was written to the ontology.
//
//  LEGACY (unchanged, see below):
//    orbatJson, translatedInputOrbat
//
export const ORBAT_CONFIG = [
  // ── Inputs ─────────────────────────────────────────────────────────────────
  {
    fieldId: "operation",
    field: {
      type: "single" as const,
      label: "Operation (NxgOperation object set)",
      helperText:
        "The operation whose ORBAT to manage. Wire a Workshop NxgOperation object-set " +
        "variable here; the widget reads the first operation in the set and loads its " +
        "hierarchies, units and symbols. Leave unset to fall back to OPERATION-BALTIC-SHIELD.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "phase",
    field: {
      type: "single" as const,
      label: "Phase to import (NxgPhase object set)",
      helperText:
        "Optional. When set, the widget imports the ORBAT the Scenario Planner stored for " +
        "that phase and places it on the map. Wire this to the Scenario Planner's " +
        "Selected Phase output to have the two widgets follow each other.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "phaseDescription",
    field: {
      type: "single" as const,
      label: "Phase description (generate ORBAT)",
      helperText:
        "Write a phase description here to have the widget generate an ORBAT for it with " +
        "the llmPhaseToOrbat function and import the result. A request, not data — which " +
        "is why it stays a string rather than becoming an object set.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },

  // ── Outputs ────────────────────────────────────────────────────────────────
  {
    fieldId: "selectedUnit",
    field: {
      type: "single" as const,
      label: "Selected Unit (NxgUnit object)",
      helperText:
        "Output: temporary object-set RID resolving to the unit the user selected. Wire " +
        "this to a Workshop variable of type NxgUnit object set to show its details, " +
        "equipment or simulator asset alongside the ORBAT.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
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
    fieldId: "hierarchy",
    field: {
      type: "single" as const,
      label: "Active Hierarchy (NxgUnitHierarchy object)",
      helperText:
        "Output: temporary object-set RID resolving to the hierarchy currently being " +
        "edited. Traverse from it to reach that ORBAT's units in the ontology.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "onOrbatSaved",
    field: {
      type: "single" as const,
      label: "On ORBAT Saved",
      fieldValue: { type: "event" as const },
    },
  },

  // ── Legacy CSE round-trip ──────────────────────────────────────────────────
  //
  // DEPRECATED — no longer read or written. The widget used to write its placed
  // ORBAT to `orbatJson`, a Workshop translation function rewrote it into
  // `translatedInputOrbat`, and that was sent to the older cseValidateOrbat.
  // Validation now happens on the phase ORBAT in the ontology (Translator
  // preflight here, CSE in Execute). Both fields stay declared for one release
  // so existing Workshop wiring does not break; then remove them and the
  // Workshop translation function (docs/ORBAT_PIPELINE_PLAN.md, 3.2).
  {
    fieldId: "orbatJson",
    field: {
      type: "single" as const,
      label: "ORBAT JSON output (legacy)",
      helperText:
        "Deprecated — no longer written. Unwire it; it will be removed in the next release.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },
  {
    fieldId: "translatedInputOrbat",
    field: {
      type: "single" as const,
      label: "Translated Input Orbat (legacy)",
      helperText:
        "Deprecated — no longer read. Unwire it and remove the Workshop translation function " +
        "that fed it.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "string" as const, defaultValue: "" },
      },
    },
  },
] as const satisfies IConfigDefinition;

export default ORBAT_CONFIG;
