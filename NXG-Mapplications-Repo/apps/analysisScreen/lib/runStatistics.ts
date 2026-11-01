// ── analysisScreen/lib/runStatistics.ts ────────────────────────────────────
// The run in numbers.
//
// Pure, and deliberately split by where each number comes from, because they
// are not equally trustworthy:
//
//   movement, contact   measured from the track. True of a real run too, once
//                       there is a track query to feed this.
//   plan                measured against the phase plan (see compliance.ts).
//   attrition           taken from the event log, which today is scripted. It
//                       carries its provenance so the debrief can never present
//                       an authored number as an observed one.
//
// The HLA feed publishes no attrition at all — damage_state is no_damage or
// null across every row — so if this ever runs against a real run, `attrition`
// will be absent rather than zero. Absent and zero mean very different things
// here and the types keep them apart.

import { distanceKm } from "@/apps/scenarioPlanner/shared/timeScale";
import type { RunEvent, RunEventKind } from "@/shared/hla/runEvents";
import { tallyLosses } from "@/shared/hla/runEvents";
import { summariseCompliance, type RunCompliance } from "./compliance";
import type { SampledTrack, TrackSample } from "./sampleMockTrack";

/**
 * How close two opposing units have to be to count as in contact.
 *
 * 15 km is the engagement radius the planner's own table gives a brigade (see
 * scenarioPlanner/shared/timeScale), which is the echelon most of this laydown
 * is drawn at. It is a proximity measure and nothing more: the feed cannot say
 * whether anybody actually engaged.
 */
export const CONTACT_RANGE_KM = 15;

/** Below this much total movement across the run, a unit did not go anywhere. */
const STATIC_UNIT_THRESHOLD_KM = 0.5;

export interface RosterEntry {
  label: string;
  force: "BLUE" | "RED";
}

/** Who is on which side. The track carries positions only. */
export type Roster = Map<string, RosterEntry>;

export interface ForceMovement {
  force: "BLUE" | "RED";
  unitCount: number;
  /** Ground covered by the whole force, however indirectly. */
  totalDistanceKm: number;
  meanDistanceKm: number;
  /** Greatest straight-line displacement start to finish, by any one unit. */
  furthestAdvanceKm: number;
  furthestAdvanceUnit: string | null;
  maxSpeedKmh: number;
  /** Units that never left their start position. */
  staticUnits: number;
}

export interface ContactStatistics {
  closestApproachKm: number | null;
  closestApproachAtSec: number | null;
  /** The two units involved, blue first. */
  closestApproachPair: [string, string] | null;
  /** First moment any opposing pair came within CONTACT_RANGE_KM. */
  firstContactSec: number | null;
  /** How much of the run had at least one opposing pair inside that range. */
  secondsInContact: number;
}

export interface AttritionStatistics {
  /** Always "scripted" today — see the header. */
  provenance: "scripted" | "observed";
  blueLosses: number;
  redLosses: number;
  /** Red platforms lost per blue platform lost. Null when blue lost nothing. */
  exchangeRatio: number | null;
  engagements: number;
  firstEngagementSec: number | null;
  /** The single costliest event of the run, by total platforms lost. */
  heaviestExchange: RunEvent | null;
}

export interface PlanStatistics {
  totalOrders: number;
  measurable: number;
  arrived: number;
  late: number;
  neverMoved: number;
  notObserved: number;
  withdrew: number;
  conflictedUnits: number;
  medianLatePhaseHours: number | null;
}

export interface RunStatistics {
  runDurationSec: number;
  movement: ForceMovement[];
  contact: ContactStatistics;
  /** Absent when the run has no event log to take losses from. */
  attrition: AttritionStatistics | null;
  /** Absent when the run has no plan to be measured against. */
  plan: PlanStatistics | null;
  eventCounts: Record<RunEventKind, number>;
}

export interface RunStatisticsInput {
  track: SampledTrack;
  roster: Roster;
  runDurationSec: number;
  events?: RunEvent[];
  compliance?: RunCompliance;
}

function point(sample: TrackSample) {
  return { lat: sample.lat, lng: sample.lon };
}

interface UnitMovement {
  entityId: string;
  force: "BLUE" | "RED";
  label: string;
  distanceKm: number;
  displacementKm: number;
  maxSpeedKmh: number;
}

function movementPerUnit(track: SampledTrack, roster: Roster): UnitMovement[] {
  const units: UnitMovement[] = [];

  for (const [entityId, samples] of track) {
    const entry = roster.get(entityId);
    // A unit nobody can place on a side cannot be counted into either force's
    // totals without quietly biasing them.
    if (!entry || samples.length < 2) continue;

    let distance = 0;
    let maxSpeedKmh = 0;

    for (let i = 1; i < samples.length; i += 1) {
      const legKm = distanceKm(point(samples[i - 1]), point(samples[i]));
      distance += legKm;

      const dtSec = samples[i].tSec - samples[i - 1].tSec;
      if (dtSec > 0) {
        const speed = (legKm / dtSec) * 3600;
        if (speed > maxSpeedKmh) maxSpeedKmh = speed;
      }
    }

    units.push({
      entityId,
      force: entry.force,
      label: entry.label,
      distanceKm: distance,
      displacementKm: distanceKm(point(samples[0]), point(samples[samples.length - 1])),
      maxSpeedKmh,
    });
  }

  return units;
}

function summariseForce(units: UnitMovement[], force: "BLUE" | "RED"): ForceMovement {
  const mine = units.filter((unit) => unit.force === force);

  let furthest: UnitMovement | null = null;
  let totalDistanceKm = 0;
  let maxSpeedKmh = 0;
  let staticUnits = 0;

  for (const unit of mine) {
    totalDistanceKm += unit.distanceKm;
    if (unit.maxSpeedKmh > maxSpeedKmh) maxSpeedKmh = unit.maxSpeedKmh;
    if (unit.distanceKm < STATIC_UNIT_THRESHOLD_KM) staticUnits += 1;
    if (!furthest || unit.displacementKm > furthest.displacementKm) furthest = unit;
  }

  return {
    force,
    unitCount: mine.length,
    totalDistanceKm,
    meanDistanceKm: mine.length > 0 ? totalDistanceKm / mine.length : 0,
    furthestAdvanceKm: furthest?.displacementKm ?? 0,
    furthestAdvanceUnit: furthest?.label ?? null,
    maxSpeedKmh,
    staticUnits,
  };
}

/** Positions at each sampled instant, grouped so opposing pairs can be walked. */
function byTime(track: SampledTrack, roster: Roster) {
  const frames = new Map<number, { entityId: string; entry: RosterEntry; sample: TrackSample }[]>();

  for (const [entityId, samples] of track) {
    const entry = roster.get(entityId);
    if (!entry) continue;
    for (const sample of samples) {
      const frame = frames.get(sample.tSec);
      const item = { entityId, entry, sample };
      if (frame) frame.push(item);
      else frames.set(sample.tSec, [item]);
    }
  }

  return [...frames.entries()].sort((a, b) => a[0] - b[0]);
}

function contactStatistics(track: SampledTrack, roster: Roster): ContactStatistics {
  const frames = byTime(track, roster);

  let closestApproachKm: number | null = null;
  let closestApproachAtSec: number | null = null;
  let closestApproachPair: [string, string] | null = null;
  let firstContactSec: number | null = null;
  let contactFrames = 0;

  // Cadence, so "frames in contact" can be reported as time rather than as a
  // count of samples nobody outside this file knows the spacing of.
  const cadenceSec =
    frames.length > 1 ? Math.max(1, frames[1][0] - frames[0][0]) : 0;

  for (const [tSec, items] of frames) {
    const blue = items.filter((item) => item.entry.force === "BLUE");
    const red = items.filter((item) => item.entry.force === "RED");

    let frameClosest = Number.POSITIVE_INFINITY;
    let framePair: [string, string] | null = null;

    for (const b of blue) {
      for (const r of red) {
        const separation = distanceKm(point(b.sample), point(r.sample));
        if (separation < frameClosest) {
          frameClosest = separation;
          framePair = [b.entry.label, r.entry.label];
        }
      }
    }

    if (!Number.isFinite(frameClosest)) continue;

    if (closestApproachKm == null || frameClosest < closestApproachKm) {
      closestApproachKm = frameClosest;
      closestApproachAtSec = tSec;
      closestApproachPair = framePair;
    }

    if (frameClosest <= CONTACT_RANGE_KM) {
      contactFrames += 1;
      if (firstContactSec == null) firstContactSec = tSec;
    }
  }

  return {
    closestApproachKm,
    closestApproachAtSec,
    closestApproachPair,
    firstContactSec,
    secondsInContact: contactFrames * cadenceSec,
  };
}

function attritionStatistics(events: RunEvent[]): AttritionStatistics {
  const losses = tallyLosses(events);
  const engagements = events.filter(
    (event) => event.kind === "engagement" || event.kind === "loss",
  );

  let heaviestExchange: RunEvent | null = null;
  for (const event of events) {
    const cost = (event.losses?.blue ?? 0) + (event.losses?.red ?? 0);
    const best =
      (heaviestExchange?.losses?.blue ?? 0) + (heaviestExchange?.losses?.red ?? 0);
    if (cost > best) heaviestExchange = event;
  }

  return {
    // Every event in the log carries its own provenance; the aggregate is only
    // "observed" if all of them are.
    provenance: events.every((event) => event.provenance === "observed")
      ? "observed"
      : "scripted",
    blueLosses: losses.blue,
    redLosses: losses.red,
    exchangeRatio: losses.blue > 0 ? losses.red / losses.blue : null,
    engagements: engagements.length,
    firstEngagementSec: engagements.length > 0 ? Math.min(...engagements.map((e) => e.tSec)) : null,
    heaviestExchange,
  };
}

function planStatistics(compliance: RunCompliance): PlanStatistics {
  const summary = summariseCompliance(compliance);
  return {
    totalOrders: summary.total,
    measurable: summary.measurable,
    arrived: summary.arrived,
    late: summary.lateCount,
    neverMoved: summary.byStatus.NEVER_MOVED,
    notObserved: summary.byStatus.NOT_OBSERVED,
    withdrew: summary.withdrewCount,
    conflictedUnits: summary.conflictedUnitCount,
    medianLatePhaseHours: summary.medianLatePhaseHours,
  };
}

function countKinds(events: RunEvent[]): Record<RunEventKind, number> {
  const counts: Record<RunEventKind, number> = {
    detection: 0,
    engagement: 0,
    loss: 0,
    objective: 0,
    ew: 0,
    command: 0,
    phase: 0,
  };
  for (const event of events) counts[event.kind] += 1;
  return counts;
}

export function computeRunStatistics(input: RunStatisticsInput): RunStatistics {
  const { track, roster, runDurationSec, events, compliance } = input;
  const units = movementPerUnit(track, roster);

  return {
    runDurationSec,
    movement: [summariseForce(units, "BLUE"), summariseForce(units, "RED")],
    contact: contactStatistics(track, roster),
    attrition: events && events.length > 0 ? attritionStatistics(events) : null,
    plan: compliance ? planStatistics(compliance) : null,
    eventCounts: countKinds(events ?? []),
  };
}
