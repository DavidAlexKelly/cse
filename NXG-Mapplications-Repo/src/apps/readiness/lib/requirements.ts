// apps/readiness/lib/requirements.ts
//
// Every ontology resource the demo path depends on, grouped by the act of the
// demo that needs it, and how to read a probe of it.
//
// "required"     the act fails without it
// "recommended"  the act works without it, but worse (e.g. no AI drafting,
//                or a REST fallback that has not been proven on this stack)
// "optional"     a feature that degrades gracefully and says so on screen
//
// Expected fields are the parameters (actions, functions) or properties
// (object types) the app actually sends or reads — a resource that exists but
// lacks one fails at the worst moment, so it is checked here.
import type { ResourceKind } from "@/shared/lib/metadataFields";
import {
  ASSESSMENT_ACTIONS,
  ASSESSMENT_OBJECT_PARAM,
  ASSESSMENT_OBJECT_TYPE,
  ASSESSMENT_PROPERTIES,
} from "../../analysisScreen/lib/assessmentRecord";

export type Stage = "plan" | "force" | "execute" | "analyse";
export type Need = "required" | "recommended" | "optional";
export type CheckState = "pending" | "ok" | "warn" | "fail";

export const STAGES: { id: Stage; title: string; screen: string }[] = [
  { id: "plan", title: "Plan & prepare", screen: "Scenario Planner" },
  { id: "force", title: "Build the phase's force", screen: "Scenario Planner · ORBAT Manager" },
  { id: "execute", title: "Execute", screen: "Execute · HLA Map" },
  { id: "analyse", title: "Analyse & debrief", screen: "Analysis" },
];

export interface Requirement {
  id: string;
  stage: Stage;
  kind: ResourceKind;
  /** Every API name it may go by; the first that answers wins. */
  names: string[];
  need: Need;
  /** Called by name at runtime (not imported from the SDK). */
  byName?: boolean;
  /** Parameters or properties the app relies on. */
  fields?: string[];
  why: string;
  /** Where the fix is written up. */
  doc: string;
}

const PLANNER_DOC = "WORKSHOP.md";
const ORBAT_DOC = "docs/PHASE_ORBAT_PLAN.md";
const EXECUTE_DOC = "docs/EXECUTE.md";
const ANALYSE_DOC = "docs/ANALYSE.md";

export const REQUIREMENTS: Requirement[] = [
  // ── Plan & prepare ──────────────────────────────────────────────────────
  {
    id: "o-scenario",
    stage: "plan",
    kind: "objectType",
    names: ["NxgScenario"],
    need: "required",
    why: "The exercise.",
    doc: PLANNER_DOC,
  },
  {
    id: "o-phase",
    stage: "plan",
    kind: "objectType",
    names: ["NxgPhase"],
    need: "required",
    why: "The exercise's phases.",
    doc: PLANNER_DOC,
  },
  {
    id: "o-mapstate",
    stage: "plan",
    kind: "objectType",
    names: ["NxgPhaseMapState"],
    need: "required",
    fields: ["phaseId", "startStateMapJson", "endStateMapJson"],
    why: "Each phase's map: units, orders, control measures, predicted end state.",
    doc: PLANNER_DOC,
  },
  {
    id: "o-objective",
    stage: "plan",
    kind: "objectType",
    names: ["NxgTrainingObjective"],
    need: "required",
    fields: ["functionalArea", "priority"],
    why: "Training objectives — the debrief is organised around them.",
    doc: PLANNER_DOC,
  },
  {
    id: "o-inject",
    stage: "plan",
    kind: "objectType",
    names: ["NxgInject"],
    need: "recommended",
    why: "MEL/MIL injects, linked to objectives in the debrief.",
    doc: PLANNER_DOC,
  },
  {
    id: "a-phase",
    stage: "plan",
    kind: "action",
    names: ["createNxgPPhase"],
    need: "required",
    why: "Add Phase, and Plan next phase from actuals.",
    doc: PLANNER_DOC,
  },
  {
    id: "a-mapstate-create",
    stage: "plan",
    kind: "action",
    names: ["createNxgPPhaseMapState"],
    need: "required",
    fields: ["phaseId", "startStateMapJson"],
    why: "Saving a new phase's map.",
    doc: PLANNER_DOC,
  },
  {
    id: "a-mapstate-update",
    stage: "plan",
    kind: "action",
    names: ["updateNxgPPhaseMapState"],
    need: "required",
    fields: ["startStateMapJson"],
    why: "Saving map edits.",
    doc: PLANNER_DOC,
  },
  {
    id: "q-phase-map",
    stage: "plan",
    kind: "query",
    names: ["nxgGeneratePhaseMap"],
    need: "recommended",
    why: "AI draft of a phase's map.",
    doc: PLANNER_DOC,
  },
  {
    id: "q-orders",
    stage: "plan",
    kind: "query",
    names: ["nxgGenerateOrders"],
    need: "recommended",
    why: "AI draft of orders.",
    doc: PLANNER_DOC,
  },

  // ── Build the phase's force ─────────────────────────────────────────────
  {
    id: "o-hierarchy",
    stage: "force",
    kind: "objectType",
    names: ["NxgUnitHierarchy"],
    need: "required",
    fields: ["operationKey", "phaseKey"],
    why: "One ORBAT per phase. Without phaseKey the Translator cannot find a phase's ORBAT.",
    doc: ORBAT_DOC,
  },
  {
    id: "o-unit",
    stage: "force",
    kind: "objectType",
    names: ["NxgUnit"],
    need: "required",
    fields: ["latitude", "longitude", "sidc", "echelon"],
    why: "The units, each with its own position per phase.",
    doc: ORBAT_DOC,
  },
  {
    id: "o-edge",
    stage: "force",
    kind: "objectType",
    names: ["NxgUnitHierachyEdge"],
    need: "required",
    fields: ["hierarchyKey", "parentUnitKey", "childUnitKey"],
    why: "Chain of command.",
    doc: ORBAT_DOC,
  },
  {
    id: "a-hierarchy",
    stage: "force",
    kind: "action",
    names: ["createNxgUnitHierarchy"],
    need: "required",
    fields: ["phaseKey"],
    why: "Creates a phase's ORBAT, stamped with its phase.",
    doc: ORBAT_DOC,
  },
  {
    id: "a-reconcile",
    stage: "force",
    kind: "action",
    names: ["nxgOReconcileScenarioOrbat"],
    need: "required",
    fields: ["scenario_json"],
    why: "Every ORBAT change, in one transactional write. Needs the Translator change that records phaseKey.",
    doc: ORBAT_DOC,
  },
  {
    id: "o-sword",
    stage: "force",
    kind: "objectType",
    names: ["NxgOSwordAssetCatalogue"],
    need: "recommended",
    why: "SWORD building blocks for auto-generated ORBATs; without it they are structural only.",
    doc: ORBAT_DOC,
  },

  // ── Execute ─────────────────────────────────────────────────────────────
  {
    id: "q-preflight",
    stage: "execute",
    kind: "query",
    names: ["nxgPreflightOrbatFromPhase", "preflightOrbatFromPhase"],
    need: "required",
    byName: true,
    fields: ["operation_key", "phase_key"],
    why: "Will every unit actually spawn? Launch is blocked until it passes.",
    doc: EXECUTE_DOC,
  },
  {
    id: "q-translate",
    stage: "execute",
    kind: "query",
    names: ["nxgTranslateOrbatToXmlFromPhase", "translateOrbatToXmlFromPhase"],
    need: "required",
    byName: true,
    fields: ["operation_key", "phase_key"],
    why: "Phase ORBAT → CSE ORBAT XML.",
    doc: EXECUTE_DOC,
  },
  {
    id: "q-compositions",
    stage: "execute",
    kind: "query",
    names: ["nxgCseGetCompositions", "cseGetCompositions"],
    need: "recommended",
    byName: true,
    why: "Lists CSE compositions; without it the name is typed by hand.",
    doc: EXECUTE_DOC,
  },
  {
    id: "q-add-project",
    stage: "execute",
    kind: "query",
    names: ["nxgCseAddProject"],
    need: "required",
    byName: true,
    fields: ["project_name", "composition"],
    why: "Creates the CSE project.",
    doc: EXECUTE_DOC,
  },
  {
    id: "q-validate",
    stage: "execute",
    kind: "query",
    names: ["nxgCseValidateOrbat"],
    need: "recommended",
    byName: true,
    fields: ["project_name", "orbat_content"],
    why: "CSE's own check of the ORBAT (advised, not required).",
    doc: EXECUTE_DOC,
  },
  {
    id: "q-add-orbat",
    stage: "execute",
    kind: "query",
    names: ["nxgCseAddOrbatToProject", "cseAddOrbatToProject"],
    need: "required",
    byName: true,
    fields: ["project", "orbat_content"],
    why: "Loads the ORBAT into the project.",
    doc: EXECUTE_DOC,
  },
  {
    id: "q-publish",
    stage: "execute",
    kind: "query",
    names: ["nxgCsePublishProject", "csePublishProject"],
    need: "required",
    byName: true,
    fields: ["project_name"],
    why: "Deploys the project; the federation comes up.",
    doc: EXECUTE_DOC,
  },
  {
    id: "q-start",
    stage: "execute",
    kind: "query",
    names: ["hlaSimStart"],
    need: "required",
    why: "Starts simulation time.",
    doc: EXECUTE_DOC,
  },
  {
    id: "q-move",
    stage: "execute",
    kind: "query",
    names: ["hlaMoveToLocation"],
    need: "recommended",
    why: "Live tasking from the HLA Map.",
    doc: EXECUTE_DOC,
  },

  // ── Analyse & debrief ───────────────────────────────────────────────────
  {
    id: "o-assessment",
    stage: "analyse",
    kind: "objectType",
    names: [ASSESSMENT_OBJECT_TYPE],
    need: "optional",
    byName: true,
    fields: [...ASSESSMENT_PROPERTIES],
    why: "Shared analyst ratings. Without it ratings are kept on the analyst's device.",
    doc: ANALYSE_DOC,
  },
  {
    id: "a-assessment-create",
    stage: "analyse",
    kind: "action",
    names: [ASSESSMENT_ACTIONS.create],
    need: "optional",
    byName: true,
    fields: [...ASSESSMENT_PROPERTIES],
    why: "Saves a new analyst rating.",
    doc: ANALYSE_DOC,
  },
  {
    id: "a-assessment-modify",
    stage: "analyse",
    kind: "action",
    names: [ASSESSMENT_ACTIONS.modify],
    need: "optional",
    byName: true,
    fields: [ASSESSMENT_OBJECT_PARAM, "rating", "note"],
    why: "Updates an analyst rating.",
    doc: ANALYSE_DOC,
  },
  {
    id: "a-assessment-delete",
    stage: "analyse",
    kind: "action",
    names: [ASSESSMENT_ACTIONS.delete],
    need: "optional",
    byName: true,
    fields: [ASSESSMENT_OBJECT_PARAM],
    why: "Clears an analyst rating.",
    doc: ANALYSE_DOC,
  },
];

export interface CheckResult {
  id: string;
  stage: Stage;
  label: string;
  state: CheckState;
  message: string;
  /** What to do about it; empty when nothing needs doing. */
  fix: string;
}

/** What a probe found — the shape of shared/lib/platformMetadata's answer. */
export interface ProbeFinding {
  apiName: string;
  status: "present" | "missing" | "forbidden" | "error";
  inSdk: boolean;
  fields: string[];
  detail: string;
}

const KIND_LABEL: Record<ResourceKind, string> = {
  objectType: "object type",
  action: "action",
  query: "function",
};

function failState(need: Need): CheckState {
  return need === "required" ? "fail" : "warn";
}

function consequence(req: Requirement): string {
  if (req.need === "required") return "This step of the demo will fail.";
  if (req.need === "recommended") return "The demo works without it, with less.";
  return "The screen falls back and says so.";
}

/** Read one probe against what the app needs from the resource. */
export function evaluateResource(req: Requirement, probe: ProbeFinding | null): CheckResult {
  const label = `${probe?.apiName ?? req.names[0]} (${KIND_LABEL[req.kind]})`;
  const base = { id: req.id, stage: req.stage, label };
  if (!probe) return { ...base, state: "pending", message: "Checking…", fix: "" };

  switch (probe.status) {
    case "missing":
      return {
        ...base,
        state: failState(req.need),
        message: `Not found. ${consequence(req)}`,
        fix:
          `Create it, or add it to the Developer Console application's resources ` +
          `(an app only sees what it was granted). See ${req.doc}.`,
      };
    case "forbidden":
      return {
        ...base,
        state: failState(req.need),
        message: `This app may not use it (permission denied). ${consequence(req)}`,
        fix: `Add it to the Developer Console application's resources, and check your own access. See ${req.doc}.`,
      };
    case "error":
      return {
        ...base,
        state: "warn",
        message: `Could not check it (${probe.detail}).`,
        fix: "Re-run the check. If it persists, check the app's token and network.",
      };
    case "present":
      break;
  }

  const expected = req.fields ?? [];
  if (expected.length > 0 && probe.fields.length > 0) {
    const absent = expected.filter((f) => !probe.fields.includes(f));
    if (absent.length > 0) {
      const what = req.kind === "objectType" ? "property" : "parameter";
      return {
        ...base,
        state: failState(req.need),
        message: `Exists, but has no ${what}${absent.length > 1 ? "s" : ""} ${absent.join(", ")}. ${consequence(req)}`,
        fix: `Add ${absent.join(", ")} to it, or deploy the version that has ${absent.length > 1 ? "them" : "it"}. See ${req.doc}.`,
      };
    }
  }

  if (req.byName && !probe.inSdk && req.kind !== "objectType") {
    return {
      ...base,
      state: "ok",
      message:
        "Reachable by name. It is not in the app's SDK, so it is called through the REST fallback.",
      fix: "Recommended before the demo: add it to the Developer Console app and regenerate the SDK.",
    };
  }
  const unread = expected.length > 0 && probe.fields.length === 0;
  return {
    ...base,
    state: "ok",
    message: unread
      ? "Present (its fields could not be listed, so they were not checked)."
      : "Present.",
    fix: "",
  };
}

/**
 * When (almost) every probe failed the same way, the problem is reaching
 * Foundry at all, not any one resource — say that once instead of thirty
 * identical rows. Null when the probes tell resource-specific stories.
 */
export function unreachableSummary(
  probes: readonly (ProbeFinding | null | undefined)[],
): CheckResult | null {
  const answered = probes.filter((p): p is ProbeFinding => !!p);
  if (answered.length < probes.length || answered.length < 3) return null;
  const errors = answered.filter((p) => p.status === "error");
  if (errors.length < answered.length * 0.8) return null;
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(e.detail, (counts.get(e.detail) ?? 0) + 1);
  const [detail] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    id: "d-unreachable",
    stage: "plan",
    label: "Foundry Ontology API",
    state: "fail",
    message: `Could not reach it from this app (${detail}), so none of the ${answered.length} resources could be checked.`,
    fix: "Open this screen from the deployed app in Foundry (or check the app's sign-in and network), then Re-check.",
  };
}
