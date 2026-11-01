import { defineConfig } from "@osdk/widget.client";

export default defineConfig({
  id: "orbatManager",
  name: "ORBAT Manager",
  description:
    "NATO Structure Order of Battle – manage unit templates and build armies",
  type: "workshop",
  parameters: {
    activeArmyName: { displayName: "Active Army Name", type: "string" },
    totalPersonnel: { displayName: "Total Personnel", type: "number" },
    lastUpdated: { displayName: "Last Updated", type: "string" },
    /** RID of the AIP Agent used for AI structure generation.
     *  Set this in Workshop to point at your deployed agent. */
    aiAgentRid: { displayName: "AI Structure Agent RID", type: "string" },

    /**
     * Primary key of the currently-imported NxgOperation.  The widget writes
     * this whenever the user imports an operation from Foundry; Workshop
     * should bind it to a variable and feed it into the workshop-side helper
     * function that produces the SWORD ORBAT payload for CSE validation.
     */
    selectedOperationKey: {
      displayName: "Selected Operation Key",
      type: "string",
    },

    // ── cse_validate_orbat function inputs ────────────────────────────
    //   The CSE Validate tab wraps the ontology function
    //   `cse_validate_orbat`, which has this signature:
    //
    //     (orbatContent: string, projectName: string) => string
    //
    //   Both inputs are exposed here as widget parameters so Workshop can
    //   drive them directly (bind variables, wire actions, etc.). Any
    //   value supplied by Workshop OVERRIDES the widget's own defaults.

    /**
     * `cse_validate_orbat.orbatContent` — SWORD-shaped ORBAT JSON string.
     *
     * PRIMARY input, corresponds directly to the `orbatContent` function
     * argument.  Typically populated in Workshop from the operation→SWORD
     * helper function and fed back to the widget.  Used VERBATIM as the
     * `orbatContent` argument — no re-serialisation.
     *
     * If left empty the widget falls back to serialising its own live
     * builder tree (useful for previewing, usually rejected by CSE).
     */
    validationPayload: {
      displayName: "CSE · orbatContent (JSON)",
      type: "string",
    },

    /**
     * `cse_validate_orbat.projectName` — free-text project / operation
     * name passed as the `projectName` function argument.
     *
     * When set from Workshop this OVERRIDES the widget's default (which
     * is derived from `<side name> — <group name>`).  Bind this to a
     * Workshop variable to control what project the CSE server-side rules
     * treat the ORBAT as belonging to.
     */
    validationProjectName: {
      displayName: "CSE · projectName",
      type: "string",
    },

    /**
     * Live SWORD-shaped ORBAT JSON, always kept in sync with the widget's
     * builder tree (first side / first group).  Workshop can bind this OUT
     * to a variable and feed it into any function that expects an ORBAT —
     * including the CSE validator itself when the user is building a
     * structure by hand or with the AI panel (no NXG Operation involved).
     *
     * When present and no `validationPayload` has been supplied, the CSE
     * Validate tab does not need a Workshop round-trip — Workshop can just
     * pipe `currentOrbatJson` → its function → back into
     * `validationPayload` for the widget to display, or `validationResult`
     * for the calling module to consume directly.
     */
    currentOrbatJson: {
      displayName: "Current ORBAT (JSON)",
      type: "string",
    },

    /**
     * Raw result string returned by the last CSE validation run inside the
     * widget.  Whatever the compute-module function returned — verbatim
     * JSON string.  Workshop can bind this OUT to trigger downstream
     * actions (persist the run, show a summary card, send a notification,
     * feed it to another function, etc.).
     */
    validationResult: {
      displayName: "Validation Result (JSON)",
      type: "string",
    },
  },
  events: {
    onArmyUpdated: {
      displayName: "On Army Updated",
      parameterUpdateIds: ["activeArmyName", "totalPersonnel", "lastUpdated"],
    },
    /**
     * Fired when the user imports (or reselects) an NXG Operation inside the
     * widget.  Workshop should bind this to update its own operation-key
     * variable, then trigger the workshop-side helper function.
     */
    onOperationSelected: {
      displayName: "On Operation Selected",
      parameterUpdateIds: ["selectedOperationKey"],
    },
    /**
     * Fired whenever the widget's live builder tree changes and a fresh
     * SWORD-shaped JSON has been generated.  Workshop should bind this to
     * update its own ORBAT variable, then (optionally) trigger a function
     * such as `cse_validate_orbat` or a persistence helper.
     *
     * Debounced upstream — see OrbatWidget for the trailing-edge timer.
     */
    onOrbatChanged: {
      displayName: "On ORBAT Changed",
      parameterUpdateIds: ["currentOrbatJson"],
    },
    /**
     * Fired when the CSE Validate tab finishes a run.  Carries the raw
     * server response so Workshop can react to pass/fail without needing
     * to inspect the widget state.
     */
    onValidationCompleted: {
      displayName: "On Validation Completed",
      parameterUpdateIds: ["validationResult"],
    },
  },
});

export type OrbatConfig = typeof import("./orbatManager.config.js").default;
