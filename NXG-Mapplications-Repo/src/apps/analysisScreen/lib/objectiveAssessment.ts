// analysisScreen/lib/objectiveAssessment.ts
//
// Training objectives, assessed against what the run actually did — pure.
//
// The question an exercise planner asks of a debrief is not "was the 2nd Bn
// late" but "did the training audience demonstrate TO-02". Nothing in the
// ontology links an objective to the orders or injects that exercise it, so
// the link is INFERRED here, and every link says why it was made:
//
//   functional area   the objective's area (Fires, Manoeuvre, Sustainment…)
//                     covers the order's task or the tasked unit's type
//   shared wording    only when the objective's area is not recognised: the
//                     objective and the order name the same thing
//
// From the measured orders behind an objective comes a SUGGESTED rating. It is
// a suggestion: the analyst can override it with a rating and a note, and the
// final call is theirs. Where no order exercises an objective at all (staff
// work, C2 processes, information activities) the rating is "needs observer
// judgement" — the track feed cannot see those, and saying so is the point.
import type { PlannedCategory } from "@/shared/hla/balticShieldPlan";
import type { NxgInject, NxgTrainingObjective } from "../../scenarioPlanner/shared/types";
import type { ComplianceStatus, OrderCompliance } from "./compliance";

export type ObjectiveRating =
  | "DEMONSTRATED"
  | "PARTIALLY_DEMONSTRATED"
  | "NOT_DEMONSTRATED"
  | "NOT_OBSERVED"
  | "NEEDS_JUDGEMENT";

export const RATING_LABEL: Record<ObjectiveRating, string> = {
  DEMONSTRATED: "Demonstrated",
  PARTIALLY_DEMONSTRATED: "Partially demonstrated",
  NOT_DEMONSTRATED: "Not demonstrated",
  NOT_OBSERVED: "Not observed",
  NEEDS_JUDGEMENT: "Needs observer judgement",
};

export interface OrderEvidence {
  orderId: string;
  unitLabel: string;
  taskLabel: string;
  status: ComplianceStatus;
  /** Why this order counts as evidence for the objective. */
  reason: string;
}

export interface InjectEvidence {
  injectId: string;
  title: string;
  category: string;
  dayOffset: string;
  expectedResponse: string;
  reason: string;
}

export interface ObjectiveAssessment {
  objectiveId: string;
  ref: string;
  objective: string;
  functionalArea: string;
  priority: string;
  suggested: ObjectiveRating;
  /** One line on how the suggestion was reached. */
  basis: string;
  orders: OrderEvidence[];
  injects: InjectEvidence[];
}

/** An order as the assessment needs it: its measurement plus what kind of unit it tasks. */
export interface MeasuredOrder {
  compliance: OrderCompliance;
  category: PlannedCategory;
}

// ── Functional areas ────────────────────────────────────────────────────────
// What each area covers, in the vocabulary the planner and the plan use:
// tasked unit categories, task wording, and MEL/MIL inject categories. Matched
// on the objective's functional area AND its text, since areas are free text
// in the data ("Fires", "J3 Fires", "Joint Fires & Targeting").

interface AreaProfile {
  id: string;
  label: string;
  /** Words in a functional area or objective that select this profile. */
  cues: string[];
  categories: PlannedCategory[];
  tasks: string[];
  injectCategories: string[];
}

const AREAS: AreaProfile[] = [
  {
    id: "manoeuvre",
    label: "Manoeuvre",
    cues: [
      "manoeuvre",
      "maneuver",
      "manoeuver",
      "movement",
      "advance",
      "attack",
      "offensive",
      "defen",
      "j3",
      "land",
    ],
    categories: ["Infantry", "Armour", "Recce", "Special Forces", "Aviation"],
    tasks: [
      "advance",
      "attack",
      "seize",
      "secure",
      "clear",
      "defend",
      "delay",
      "block",
      "move",
      "occupy",
      "counterattack",
      "penetrate",
      "envelop",
    ],
    injectCategories: [],
  },
  {
    id: "fires",
    label: "Fires",
    cues: ["fire", "targeting", "artillery", "strike", "effects"],
    categories: ["Artillery"],
    tasks: [
      "fire",
      "interdict",
      "suppress",
      "neutralize",
      "neutralise",
      "destroy",
      "strike",
      "support by fire",
    ],
    injectCategories: [],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    cues: ["intel", "isr", "reconnaissance", "surveillance", "j2", "recce"],
    categories: ["Recce", "UAS"],
    tasks: ["screen", "recon", "reconnoiter", "observe", "guard", "surveil"],
    injectCategories: ["intel"],
  },
  {
    id: "sustainment",
    label: "Sustainment",
    cues: [
      "sustain",
      "logistic",
      "j4",
      "reception",
      "staging",
      "rsom",
      "rsoi",
      "supply",
      "medical",
    ],
    categories: ["Logistics", "Medical"],
    tasks: ["resupply", "sustain", "stage", "receive", "move"],
    injectCategories: ["log", "logistics", "medical"],
  },
  {
    id: "protection",
    label: "Protection",
    cues: ["protect", "air defen", "gbad", "force protection", "cbrn", "counter"],
    categories: ["Air Defence", "CBRN", "Military Police", "Engineer"],
    tasks: ["cover", "protect", "guard", "defend"],
    injectCategories: ["cbrn", "force protection"],
  },
  {
    id: "c2",
    label: "Command and control",
    cues: ["command", "c2", "control", "j3", "j5", "planning", "coordination", "synchron"],
    categories: ["HQ", "Signal"],
    tasks: [],
    injectCategories: ["polmil", "c2"],
  },
  {
    id: "information",
    label: "Information",
    cues: [
      "information",
      "info ops",
      "cyber",
      "ew",
      "electronic",
      "cimic",
      "strat com",
      "stratcom",
      "media",
    ],
    categories: ["Signal"],
    tasks: ["suppress", "jam", "disrupt"],
    injectCategories: ["cyber", "info ops", "cimic", "media", "ew"],
  },
];

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "into",
  "from",
  "that",
  "this",
  "their",
  "they",
  "will",
  "able",
  "conduct",
  "ensure",
  "maintain",
  "within",
  "during",
  "under",
  "while",
  "across",
  "through",
  "training",
  "audience",
  "objective",
  "operation",
  "operations",
  "forces",
  "force",
  "phase",
  "plan",
  "planning",
  "effective",
  "effectively",
  "demonstrate",
  "including",
  "against",
  "order",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/** Two words are the same word if one is a stem of the other ("defend"/"defence" share "defen"). */
function sameWord(a: string, b: string): boolean {
  const stem = (w: string) => w.slice(0, Math.max(5, Math.ceil(w.length * 0.7)));
  return (
    a === b ||
    stem(a) === stem(b) ||
    (a.length >= 5 && b.startsWith(a)) ||
    (b.length >= 5 && a.startsWith(b))
  );
}

/** The functional-area profiles an objective falls under. */
export function areasFor(
  objective: Pick<NxgTrainingObjective, "functionalArea" | "objective">,
): AreaProfile[] {
  const area = objective.functionalArea.toLowerCase();
  const fromArea = AREAS.filter((p) => p.cues.some((cue) => area.includes(cue)));
  if (fromArea.length > 0) return fromArea;
  // No recognisable area: fall back to the objective's own wording.
  const text = objective.objective.toLowerCase();
  return AREAS.filter((p) => p.cues.some((cue) => text.includes(cue)));
}

/** Areas that claim a unit category as their own. */
function areasClaiming(category: PlannedCategory): string[] {
  return AREAS.filter((a) => a.categories.includes(category)).map((a) => a.id);
}

function orderReason(
  objective: NxgTrainingObjective,
  areas: AreaProfile[],
  order: MeasuredOrder,
): string | null {
  const task = order.compliance.taskLabel.toLowerCase();
  for (const area of areas) {
    // The unit's own type is the strongest link.
    if (area.categories.includes(order.category))
      return `${area.label}: ${order.category.toLowerCase()} unit`;
    // Task wording counts only for a unit no other area claims — a logistics
    // convoy's "Move" is sustainment, not manoeuvre.
    const claimedElsewhere = areasClaiming(order.category).some((id) => id !== area.id);
    if (!claimedElsewhere && area.tasks.some((t) => task.includes(t))) {
      return `${area.label}: "${order.compliance.taskLabel}" task`;
    }
  }
  // Shared wording only when the objective's area is unrecognised: otherwise a
  // place name ("corridor") would tie every unit near it to the objective.
  if (areas.length > 0) return null;
  const objectiveWords = tokens(objective.objective);
  const orderWords = tokens(`${order.compliance.taskLabel} ${order.compliance.unitLabel}`);
  const shared = objectiveWords.find((w) => orderWords.some((o) => sameWord(w, o)));
  return shared ? `both mention "${shared}"` : null;
}

function injectReason(
  objective: NxgTrainingObjective,
  areas: AreaProfile[],
  inject: NxgInject,
): string | null {
  const category = inject.injectCategory.toLowerCase();
  for (const area of areas) {
    if (category && area.injectCategories.some((c) => category.includes(c))) {
      return `${area.label}: ${inject.injectCategory} inject`;
    }
  }
  if (areas.length > 0) return null;
  const objectiveWords = tokens(objective.objective);
  const injectWords = tokens(`${inject.injectTitle} ${inject.expectedResponse}`);
  const shared = objectiveWords.find((w) => injectWords.some((o) => sameWord(w, o)));
  return shared ? `both mention "${shared}"` : null;
}

const MEASURED_OUT: ReadonlySet<ComplianceStatus> = new Set(["NOT_OBSERVED", "NO_PLANNED_ROUTE"]);

/** Suggested rating from the measured orders behind an objective. */
export function suggestRating(orders: readonly OrderEvidence[]): {
  rating: ObjectiveRating;
  basis: string;
} {
  if (orders.length === 0) {
    return {
      rating: "NEEDS_JUDGEMENT",
      basis:
        "No order in the plan exercises this objective — the track feed cannot see it, so it needs an observer's call.",
    };
  }
  const measured = orders.filter((o) => !MEASURED_OUT.has(o.status));
  if (measured.length === 0) {
    return {
      rating: "NOT_OBSERVED",
      basis: `${orders.length} order${orders.length === 1 ? "" : "s"} exercise it, but none could be measured — the units never appeared in the run or the orders have no axis.`,
    };
  }
  const onTime = measured.filter((o) => o.status === "ACHIEVED_ON_TIME").length;
  const partial = measured.filter(
    (o) => o.status === "ACHIEVED_LATE" || o.status === "EN_ROUTE_AT_END",
  ).length;
  const failed = measured.length - onTime - partial;
  const counts =
    `${measured.length} measured order${measured.length === 1 ? "" : "s"}: ` +
    [
      onTime && `${onTime} on time`,
      partial && `${partial} late or still en route`,
      failed && `${failed} not achieved`,
    ]
      .filter(Boolean)
      .join(", ") +
    ".";
  // Late is not failed. In practice every arriving order arrives "late" —
  // the planner's estimate is distance over a rate table and the execution
  // is paced by something else (see summariseCompliance) — so lateness is a
  // finding about the plan's assumptions, not about the audience. Only when
  // most of the measured orders were not achieved at all is the objective
  // suggested as not demonstrated.
  if (onTime === measured.length) return { rating: "DEMONSTRATED", basis: counts };
  if (failed * 2 > measured.length) return { rating: "NOT_DEMONSTRATED", basis: counts };
  return { rating: "PARTIALLY_DEMONSTRATED", basis: counts };
}

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

/**
 * Assess every objective, high priority first.
 *
 * Only the TRAINING AUDIENCE's orders are evidence. The opposing force is
 * exercise furniture: an enemy battery interdicting on time says nothing about
 * whether the audience demonstrated fires. Blue by default.
 */
export function assessObjectives(
  objectives: readonly NxgTrainingObjective[],
  allOrders: readonly MeasuredOrder[],
  injects: readonly NxgInject[],
  options: { audience?: "blue" | "red" } = {},
): ObjectiveAssessment[] {
  const audience = options.audience ?? "blue";
  const orders = allOrders.filter((o) => o.compliance.force === audience);
  return [...objectives]
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3) ||
        a.ref.localeCompare(b.ref, undefined, { numeric: true }),
    )
    .map((objective) => {
      const areas = areasFor(objective);
      const orderEvidence: OrderEvidence[] = [];
      for (const order of orders) {
        const reason = orderReason(objective, areas, order);
        if (!reason) continue;
        orderEvidence.push({
          orderId: order.compliance.orderId,
          unitLabel: order.compliance.unitLabel,
          taskLabel: order.compliance.taskLabel,
          status: order.compliance.status,
          reason,
        });
      }
      const injectEvidence: InjectEvidence[] = [];
      for (const inject of injects) {
        const reason = injectReason(objective, areas, inject);
        if (!reason) continue;
        injectEvidence.push({
          injectId: inject.injectId,
          title: inject.injectTitle,
          category: inject.injectCategory,
          dayOffset: inject.dayOffset,
          expectedResponse: inject.expectedResponse,
          reason,
        });
      }
      const { rating, basis } = suggestRating(orderEvidence);
      return {
        objectiveId: objective.objectiveId,
        ref: objective.ref,
        objective: objective.objective,
        functionalArea: objective.functionalArea,
        priority: objective.priority,
        suggested: rating,
        basis,
        orders: orderEvidence,
        injects: injectEvidence,
      };
    });
}

// ── The analyst's call ──────────────────────────────────────────────────────

export interface AnalystCall {
  rating?: ObjectiveRating;
  note?: string;
}

/** The rating that stands: the analyst's if they made one, else the suggestion. */
export function finalRating(assessment: ObjectiveAssessment, call?: AnalystCall): ObjectiveRating {
  return call?.rating ?? assessment.suggested;
}

/** "3 of 5 demonstrated, 1 partially, 1 needs observer judgement." */
export function summariseObjectives(
  assessments: readonly ObjectiveAssessment[],
  calls: Readonly<Record<string, AnalystCall>>,
): string {
  if (assessments.length === 0) return "No training objectives are recorded for this phase.";
  const counts = new Map<ObjectiveRating, number>();
  for (const a of assessments) {
    const r = finalRating(a, calls[a.objectiveId]);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const part = (r: ObjectiveRating, text: string) =>
    counts.get(r) ? `${counts.get(r)} ${text}` : null;
  const demonstrated = counts.get("DEMONSTRATED") ?? 0;
  const rest = [
    part("PARTIALLY_DEMONSTRATED", "partially"),
    part("NOT_DEMONSTRATED", "not demonstrated"),
    part("NOT_OBSERVED", "not observed"),
    part(
      "NEEDS_JUDGEMENT",
      counts.get("NEEDS_JUDGEMENT") === 1 ? "needs observer judgement" : "need observer judgement",
    ),
  ].filter(Boolean);
  return `${demonstrated} of ${assessments.length} training objectives demonstrated${rest.length ? `, ${rest.join(", ")}` : ""}.`;
}

/** Plain text for a debrief slide or an email. */
export function objectivesAsText(
  phaseName: string,
  assessments: readonly ObjectiveAssessment[],
  calls: Readonly<Record<string, AnalystCall>>,
): string {
  const lines = [`Training objectives — ${phaseName}`, summariseObjectives(assessments, calls), ""];
  for (const a of assessments) {
    const call = calls[a.objectiveId];
    const rating = finalRating(a, call);
    lines.push(
      `${a.ref || "TO"} [${a.priority}] ${a.objective}`,
      `  ${RATING_LABEL[rating]}${call?.rating ? " (analyst)" : " (suggested)"} — ${a.basis}`,
    );
    if (call?.note) lines.push(`  Note: ${call.note}`);
  }
  return lines.join("\n");
}
