// ── analysisScreen/lib/debriefNarrative.ts ─────────────────────────────────
// The written debrief.
//
// This is the "LLM summary" of the run — faked, as agreed, but not faked in the
// way that phrase usually means. There is no hardcoded paragraph here. Every
// sentence is composed from the statistics, the event log and the plan
// compliance, so the text cannot say something the data does not, and editing
// the scenario changes the write-up with it. A canned paragraph would look the
// same in a screenshot and be a lie the moment anybody touched the mock.
//
// It is labelled as machine-composed wherever it is rendered. `source` carries
// that so the UI cannot forget.
//
// Replacing this with a real model
// --------------------------------
// This function is the seam. A real debrief would be an AIP Logic function —
// the repo already calls one for Phase Creator (nxgGenerateOrders) — handed the
// same RunStatistics, RunEvent[] and RunCompliance and asked for the same
// Debrief shape. The only changes at the call site are that it becomes async
// and `source` becomes the model's name. Everything downstream is unaffected,
// which is why the shape is defined here rather than inside the component.

import type { RunEvent } from "@/shared/hla/runEvents";
import type { OrderCompliance, RunCompliance } from "./compliance";
import { describeCompliance } from "./compliance";
import { CONTACT_RANGE_KM, type RunStatistics } from "./runStatistics";

export interface DebriefSection {
  heading: string;
  /** Paragraphs. Rendered one under another. */
  paragraphs: string[];
}

export interface Debrief {
  /**
   * Who wrote this.
   *
   * "local-template" means it was composed in the browser from the run data. A
   * real model would name itself here, and the UI would stop calling it
   * synthetic.
   */
  source: "local-template";
  /** One sentence, the thing to take away. */
  headline: string;
  sections: DebriefSection[];
  /** The handful of things worth opening the replay for. */
  findings: string[];
}

/**
 * Everything the debrief view needs, bundled so the playback contract carries
 * one optional field rather than three that must all be present together.
 */
export interface RunDebrief {
  events: RunEvent[];
  statistics: RunStatistics;
  narrative: Debrief;
}

export interface DebriefInput {
  phaseName: string;
  objectiveStatement?: string;
  statistics: RunStatistics;
  events: RunEvent[];
  compliance?: RunCompliance;
}

// ── Phrasing helpers ────────────────────────────────────────────────────────

function km(value: number): string {
  return value >= 100 ? `${Math.round(value)} km` : `${value.toFixed(1)} km`;
}

function hoursOfPhase(value: number): string {
  return Math.abs(value) >= 10 ? `${value.toFixed(0)} h` : `${value.toFixed(1)} h`;
}

function minutes(seconds: number): string {
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
}

/** "a, b and c" */
function list(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// ── Sections ────────────────────────────────────────────────────────────────

function whatHappened(input: DebriefInput): DebriefSection {
  const { events, statistics } = input;
  const paragraphs: string[] = [];

  const firstDetection = events.find((event) => event.kind === "detection");
  const objectives = events.filter((event) => event.kind === "objective");
  const closing = [...events].reverse().find((event) => event.kind === "phase");

  const opening = firstDetection
    ? `First contact with the adversary picture came at T+${minutes(firstDetection.tSec)}, when ` +
      `${firstDetection.actor?.label ?? "an ISR asset"} reported ` +
      `${firstDetection.target?.label ?? "an adversary formation"}.`
    : `No detection was reported during the run.`;

  const contact =
    statistics.contact.firstContactSec != null
      ? ` Opposing forces first closed inside ${CONTACT_RANGE_KM} km at ` +
        `T+${minutes(statistics.contact.firstContactSec)}, and were within that range for ` +
        `${minutes(statistics.contact.secondsInContact)} of the ` +
        `${minutes(statistics.runDurationSec)} run.`
      : ` The two forces never closed to within contact range of one another.`;

  paragraphs.push(opening + contact);

  if (statistics.attrition) {
    const { blueLosses, redLosses, engagements, heaviestExchange, exchangeRatio } =
      statistics.attrition;
    const ratio =
      exchangeRatio != null
        ? ` an exchange of ${exchangeRatio.toFixed(1)} adversary platforms for each of ours`
        : ` no friendly losses`;

    let attrition =
      `${plural(engagements, "engagement")} produced ${plural(blueLosses, "friendly platform")} ` +
      `lost against ${plural(redLosses, "adversary platform")} —${ratio}.`;

    if (heaviestExchange) {
      // Not lower-cased: these labels are full of unit designations and
      // acronyms, and "2 mech bn destroys 22nd ac" reads like a typo.
      attrition +=
        ` The costliest single action was at T+${minutes(heaviestExchange.tSec)} — ` +
        `${heaviestExchange.label}.`;
    }
    paragraphs.push(attrition);
  }

  if (objectives.length > 0) {
    paragraphs.push(
      `${plural(objectives.length, "objective")} ${objectives.length === 1 ? "was" : "were"} ` +
        `reported reached during the phase: ${list(objectives.map((event) => event.label))}.`,
    );
  }

  if (closing) paragraphs.push(closing.detail);

  return { heading: "What happened", paragraphs };
}

function manoeuvre(input: DebriefInput): DebriefSection {
  const [blue, red] = input.statistics.movement;
  const paragraphs: string[] = [];

  for (const force of [blue, red]) {
    if (!force || force.unitCount === 0) continue;
    const side = force.force === "BLUE" ? "Friendly forces" : "Adversary forces";

    let text =
      `${side}: ${plural(force.unitCount, "unit")} covering ${km(force.totalDistanceKm)} between ` +
      `them, ${km(force.meanDistanceKm)} each on average.`;

    if (force.furthestAdvanceUnit) {
      text +=
        ` The furthest advance was ${force.furthestAdvanceUnit} at ${km(force.furthestAdvanceKm)} ` +
        `from where it started.`;
    }
    if (force.staticUnits > 0) {
      text += ` ${plural(force.staticUnits, "unit")} did not move at all.`;
    }
    paragraphs.push(text);
  }

  const { closestApproachKm, closestApproachPair, closestApproachAtSec } = input.statistics.contact;
  if (closestApproachKm != null && closestApproachPair && closestApproachAtSec != null) {
    paragraphs.push(
      `The closest the two sides came was ${km(closestApproachKm)}, between ` +
        `${closestApproachPair[0]} and ${closestApproachPair[1]} at ` +
        `T+${minutes(closestApproachAtSec)}.`,
    );
  }

  return { heading: "Manoeuvre", paragraphs };
}

function planExecution(input: DebriefInput): DebriefSection | null {
  const stats = input.statistics.plan;
  if (!stats) return null;

  const paragraphs: string[] = [];

  paragraphs.push(
    `${plural(stats.totalOrders, "order")} were issued for this phase, of which ` +
      `${stats.measurable} could be measured against the run. ${stats.arrived} reached the ` +
      `position they were given.`,
  );

  if (stats.late > 0 && stats.medianLatePhaseHours != null) {
    paragraphs.push(
      `Every one of those arrivals was later in the phase than the plan assumed — a median of ` +
        `${hoursOfPhase(stats.medianLatePhaseHours)} late. That consistency is the finding: the ` +
        `plan's timings come from its cross-country movement rates, and the tempo the run ` +
        `actually ran at does not match them. It is worth revisiting the rate table before ` +
        `reading anything into any individual order being late.`,
    );
  }

  const problems: string[] = [];
  if (stats.withdrew > 0) {
    problems.push(`${plural(stats.withdrew, "unit")} reached an objective and then left it`);
  }
  if (stats.neverMoved > 0) {
    problems.push(`${plural(stats.neverMoved, "unit")} never left its start position`);
  }
  if (stats.notObserved > 0) {
    problems.push(
      `${plural(stats.notObserved, "order")} went to units that were never published into the ` +
        `federation`,
    );
  }
  if (stats.conflictedUnits > 0) {
    problems.push(`${plural(stats.conflictedUnits, "unit")} held more than one order at once`);
  }
  if (problems.length > 0) {
    paragraphs.push(`Beyond the timing: ${list(problems)}.`);
  }

  return { heading: "Plan execution", paragraphs };
}

function dataQuality(input: DebriefInput): DebriefSection {
  const paragraphs: string[] = [];

  if (input.statistics.attrition?.provenance === "scripted") {
    paragraphs.push(
      `Contact, losses and effects in this debrief are scripted scenario content, not ` +
        `measurements. The HLA entity-tracks feed carries position, heading and identity only — ` +
        `its damage state is never populated — so attrition cannot be derived from a real run ` +
        `without the bridge publishing it.`,
    );
  }

  paragraphs.push(
    `Movement, separation and contact time are measured from the track and would be just as ` +
      `valid for a real run. Plan timings are compared as fractions of the phase rather than ` +
      `wall clock, because the replay compresses the phase.`,
  );

  return { heading: "What this is based on", paragraphs };
}

// ── Findings ────────────────────────────────────────────────────────────────

function findingsFor(input: DebriefInput): string[] {
  const findings: string[] = [];
  const orders = input.compliance?.orders ?? [];

  const pick = (predicate: (order: OrderCompliance) => boolean) => orders.filter(predicate);

  for (const order of pick((o) => o.withdrewAfterArrival).slice(0, 2)) {
    findings.push(describeCompliance(order));
  }
  for (const order of pick((o) => o.status === "NEVER_MOVED").slice(0, 2)) {
    findings.push(describeCompliance(order));
  }
  for (const order of pick((o) => o.conflictingOrderIds.length > 0).slice(0, 1)) {
    // Which of the competing orders was actually carried out has to be read off
    // the run, not assumed to be this one — `order` here is just whichever came
    // first in the plan.
    const siblings = orders.filter((candidate) => candidate.unitId === order.unitId);
    const carried = siblings.filter((candidate) => candidate.actualArrivalSec != null);
    const outcome =
      carried.length === 0
        ? "Neither was carried out."
        : carried.length === 1
          ? `Only the ${carried[0].taskLabel} was carried out.`
          : `${carried.length} of them were carried out.`;

    findings.push(
      `${order.unitLabel} was given ${plural(siblings.length, "order")} for the same phase. ` +
        outcome,
    );
  }

  const notObserved = pick((o) => o.status === "NOT_OBSERVED");
  if (notObserved.length > 0) {
    findings.push(
      `${plural(notObserved.length, "order")} were written against units that never appeared in ` +
        `the federation — a gap between the plan and the laydown that was loaded, not a failure ` +
        `during the run.`,
    );
  }

  const heaviest = input.statistics.attrition?.heaviestExchange;
  if (heaviest) findings.push(heaviest.detail);

  return findings;
}

// ── Headline ────────────────────────────────────────────────────────────────

function headlineFor(input: DebriefInput): string {
  const { statistics } = input;
  const plan = statistics.plan;
  const attrition = statistics.attrition;

  const outcome =
    attrition == null
      ? `${input.phaseName} ran to completion`
      : attrition.redLosses > attrition.blueLosses
        ? `${input.phaseName} closed in our favour on attrition`
        : attrition.redLosses < attrition.blueLosses
          ? `${input.phaseName} cost us more than it cost the adversary`
          : `${input.phaseName} closed with attrition even`;

  if (!plan) return `${outcome}.`;

  if (plan.late > 0 && plan.late === plan.arrived) {
    return `${outcome}, but nothing happened when the plan said it would — all ${plan.arrived} arrivals were late.`;
  }
  if (plan.notObserved > 0 || plan.withdrew > 0) {
    const gaps: string[] = [];
    if (plan.withdrew > 0) gaps.push(`${plan.withdrew} objectives were taken and not held`);
    if (plan.notObserved > 0) gaps.push(`${plan.notObserved} orders had no unit to carry them out`);
    return `${outcome}, but ${list(gaps)}.`;
  }
  return `${outcome}, broadly as planned.`;
}

/**
 * Compose the debrief.
 *
 * Synchronous and deterministic: the same run always produces the same text,
 * which matters for a demo and matters more for the test that pins it.
 */
export function generateDebrief(input: DebriefInput): Debrief {
  const sections = [
    whatHappened(input),
    manoeuvre(input),
    planExecution(input),
    dataQuality(input),
  ].filter((section): section is DebriefSection => section != null && section.paragraphs.length > 0);

  return {
    source: "local-template",
    headline: headlineFor(input),
    sections,
    findings: findingsFor(input),
  };
}

export default generateDebrief;
