// analysisScreen/lib/assessmentRecord.ts
//
// An analyst's call on a training objective, as the ontology stores it —
// pure. One NxgObjectiveAssessment per (run, phase, objective), keyed
// deterministically so saving the same call twice converges on one object.
// The object type and its actions are specified in docs/ANALYSE.md.
import type { AnalystCall, ObjectiveRating } from "./objectiveAssessment";

export const ASSESSMENT_OBJECT_TYPE = "NxgObjectiveAssessment";
export const ASSESSMENT_ACTIONS = {
  create: "createNxgObjectiveAssessment",
  modify: "modifyNxgObjectiveAssessment",
  delete: "deleteNxgObjectiveAssessment",
} as const;
/** Parameter naming the object on modify / delete (Ontology Manager's default). */
export const ASSESSMENT_OBJECT_PARAM = "nxgObjectiveAssessment";

const RATINGS: readonly ObjectiveRating[] = [
  "DEMONSTRATED",
  "PARTIALLY_DEMONSTRATED",
  "NOT_DEMONSTRATED",
  "NOT_OBSERVED",
  "NEEDS_JUDGEMENT",
];

export interface AssessmentContext {
  scenarioId: string;
  phaseId: string;
  runId: string;
  runStartS: number;
  runEndS: number;
}

export function assessmentId(
  ctx: Pick<AssessmentContext, "runId" | "phaseId">,
  objectiveId: string,
): string {
  return `${ctx.runId}|${ctx.phaseId}|${objectiveId}`;
}

function iso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

/** Properties for create / modify. Suggested rating and basis are kept for audit. */
export function assessmentProperties(
  ctx: AssessmentContext,
  objectiveId: string,
  call: AnalystCall,
  suggestion: { rating: ObjectiveRating; basis: string },
  now: Date = new Date(),
): Record<string, string | null> {
  return {
    assessmentId: assessmentId(ctx, objectiveId),
    objectiveId,
    phaseId: ctx.phaseId,
    scenarioId: ctx.scenarioId,
    runId: ctx.runId,
    runStartTime: iso(ctx.runStartS),
    runEndTime: iso(ctx.runEndS),
    rating: call.rating ?? null,
    note: call.note ?? null,
    suggestedRating: suggestion.rating,
    suggestionBasis: suggestion.basis,
    assessedAt: now.toISOString(),
  };
}

/** Read stored objects back into calls, keyed by objective. Unknown ratings are dropped, not guessed. */
export function callsFromObjects(
  objects: readonly Record<string, unknown>[],
): Record<string, AnalystCall> {
  const out: Record<string, AnalystCall> = {};
  for (const o of objects) {
    const objectiveId = typeof o.objectiveId === "string" ? o.objectiveId : null;
    if (!objectiveId) continue;
    const rating = RATINGS.includes(o.rating as ObjectiveRating)
      ? (o.rating as ObjectiveRating)
      : undefined;
    const note = typeof o.note === "string" && o.note.trim() ? o.note : undefined;
    if (rating || note) out[objectiveId] = { rating, note };
  }
  return out;
}
