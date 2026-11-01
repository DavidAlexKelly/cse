import type { IConfigDefinition } from "@osdk/workshop-iframe-custom-widget";

// ── Workshop iframe config ────────────────────────────────────────────────────
//
// The scenario is the only thing this widget needs to be told.
//
// Everything about an exercise — its phases, tasks, injects, PMESII domains,
// training audiences and objectives — hangs off NxgScenario in the ontology:
//
//     NxgScenario → phases, tasks, injects, pmesiiDomains,
//                   trainingAudiences, trainingObjectives, composition
//     NxgPhase    → tasks, injects, trainingObjectives, scenario
//
// so passing any of it in as a Workshop variable would be describing the same
// facts twice, with no guarantee the two descriptions agree. This config used
// to carry eight scalar inputs; six of them (phasesJson, selectedPhaseId,
// exerciseName, currentPhaseLabel, nations, dDayOffset) said things the
// scenario already knows, and one output (selectedPhaseTasks) said something
// the selected phase already links to. They are gone.
//
// If you find yourself wanting to add an input here, check first whether the
// ontology can answer it from the scenario. Add a property or a link if it
// cannot; that way every application gets the answer, not just this widget.
//
//  INPUTS (Workshop → widget):
//    scenario   — NxgScenario object set. The widget takes the first scenario
//                 in the set and loads everything from it. Unset falls back to
//                 Operation BALTIC SHIELD (DEFAULT_SCENARIO_ID).
//    readOnly   — lock the widget from edits. Not derivable: it is a property
//                 of how the widget is being used, not of the scenario.
//
//  INPUT/OUTPUT (both directions):
//    selectedPhase — NxgPhase object set holding the phase in focus. Workshop
//                    writes it to deep-link the widget onto a phase; the widget
//                    writes it back whenever the user selects a different one.
//                    Downstream widgets traverse NxgPhase → tasks / injects /
//                    trainingObjectives themselves.
//
//  OUTPUTS (widget → Workshop), each a temporaryObjectSetRid for a single object:
//    selectedTask, selectedAudience, selectedPmesiiDomain,
//    selectedObjective, selectedInject
//
//  EVENTS:
//    onPhaseSelected, onTaskSelected, onAudienceSelected,
//    onPmesiiSelected, onObjectiveSelected, onInjectSelected
//
export const SCENARIO_CONFIG = [
  // ── Input: the scenario, and nothing else ──────────────────────────────────
  {
    fieldId: "scenario",
    field: {
      type: "single" as const,
      label: "Scenario (NxgScenario object set)",
      helperText:
        "The exercise to plan. Wire a Workshop NxgScenario object-set variable here. " +
        "The widget reads the first scenario in the set and loads its phases, exercise " +
        "metadata, tasks, injects and planning data from the ontology. " +
        "Leave unset to fall back to the Operation BALTIC SHIELD scenario.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "readOnly",
    field: {
      type: "single" as const,
      label: "Read Only",
      helperText:
        "Lock the widget from edits. Use for briefing or review pages where the " +
        "plan should be visible but not changed.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "boolean" as const, defaultValue: false },
      },
    },
  },

  // ── Selected phase: in and out ─────────────────────────────────────────────
  {
    fieldId: "selectedPhase",
    field: {
      type: "single" as const,
      label: "Selected Phase (NxgPhase object set)",
      helperText:
        "Bidirectional. The widget writes the phase the user selects; Workshop can " +
        "write it to open the widget on a particular phase. Traverse NxgPhase → tasks, " +
        "injects or trainingObjectives downstream rather than asking for them here.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "onPhaseSelected",
    field: {
      type: "single" as const,
      label: "On Phase Selected",
      fieldValue: { type: "event" as const },
    },
  },

  // ── Selection outputs ──────────────────────────────────────────────────────
  {
    fieldId: "selectedTask",
    field: {
      type: "single" as const,
      label: "Selected Task (NxgTask object)",
      helperText:
        "Output: temporary object-set RID resolving to the NxgTask the user clicked. " +
        "Wire this to a Workshop variable of type NxgTask object set.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "onTaskSelected",
    field: {
      type: "single" as const,
      label: "On Task Selected",
      fieldValue: { type: "event" as const },
    },
  },
  {
    fieldId: "selectedAudience",
    field: {
      type: "single" as const,
      label: "Selected Training Audience (NxgTrainingAudience object)",
      helperText:
        "Output: temporary object-set RID resolving to the NxgTrainingAudience the user " +
        "clicked. Wire this to a Workshop variable of type NxgTrainingAudience object set " +
        "to open the full Training Audience widget.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "onAudienceSelected",
    field: {
      type: "single" as const,
      label: "On Training Audience Selected",
      fieldValue: { type: "event" as const },
    },
  },
  {
    fieldId: "selectedPmesiiDomain",
    field: {
      type: "single" as const,
      label: "Selected PMESII Domain (NxgPmesiiDomain object)",
      helperText:
        "Output: temporary object-set RID resolving to the NxgPmesiiDomain the user " +
        "clicked. Wire this to a Workshop variable of type NxgPmesiiDomain object set " +
        "to open the full PMESII widget.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "onPmesiiSelected",
    field: {
      type: "single" as const,
      label: "On PMESII Domain Selected",
      fieldValue: { type: "event" as const },
    },
  },
  {
    fieldId: "selectedObjective",
    field: {
      type: "single" as const,
      label: "Selected Training Objective (NxgTrainingObjective object)",
      helperText:
        "Output: temporary object-set RID resolving to the NxgTrainingObjective the user " +
        "clicked. Wire this to a Workshop variable of type NxgTrainingObjective object set " +
        "to open the full Task Management widget on the selected objective.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "onObjectiveSelected",
    field: {
      type: "single" as const,
      label: "On Training Objective Selected",
      fieldValue: { type: "event" as const },
    },
  },
  {
    fieldId: "selectedInject",
    field: {
      type: "single" as const,
      label: "Selected MEL/MIL Inject (NxgInject object)",
      helperText:
        "Output: temporary object-set RID resolving to the NxgInject the user clicked in " +
        "the MIL & MEL tab. Wire this to a Workshop variable of type NxgInject object set " +
        "to open the full MEL/MIL / Task Management widget on the selected inject.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
  {
    fieldId: "onInjectSelected",
    field: {
      type: "single" as const,
      label: "On MEL/MIL Inject Selected",
      fieldValue: { type: "event" as const },
    },
  },
] as const satisfies IConfigDefinition;
