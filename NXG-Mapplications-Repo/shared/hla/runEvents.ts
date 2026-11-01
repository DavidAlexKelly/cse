// ── shared/hla/runEvents.ts ────────────────────────────────────────────────
// What happened during a run, as something richer than a timeline marker.
//
// analysisScreen's KeyEvent is a pin on the scrub bar: a time and a line of
// text. That is all a marker needs and nowhere near enough for a debrief, which
// has to say who did what to whom, with what, and what it cost. This is that.
//
// Where these come from
// ---------------------
// Today: only from the scripted mock (balticShieldEvents.ts). The HLA tracks
// feed cannot produce them — `damage_state` is `no_damage` or null on all 35M
// rows, and activity, posture, mission and combat_value are entirely null — so
// there is no attrition in the real feed to derive a loss from, and nothing to
// tell an engagement from two units being near each other.
//
// A real run could eventually supply a subset honestly: first appearance and
// last-seen, movement start and stop, closest approach between opposing forces,
// objective crossings, and every command issued (the Command Stream datasets
// carry issuer, operation, and the acknowledged/refused/expired outcome). It
// could not supply engagements or losses without the bridge publishing them.
// The type is shaped for that future, and the `provenance` field is here so a
// screen showing both can always say which is which rather than quietly
// presenting a script as an observation.

export type RunEventKind =
  /** One side saw the other. */
  | "detection"
  /** Weapons released. May or may not have cost anything. */
  | "engagement"
  /** A unit was destroyed or rendered combat-ineffective. */
  | "loss"
  /** An objective was reached, seized or handed over. */
  | "objective"
  /** Electronic warfare: jamming, spoofing, a net going down. */
  | "ew"
  /** An order was issued to the federation. */
  | "command"
  /** A phase boundary or other scenario milestone. */
  | "phase";

/**
 * Where an event came from, so a debrief can never imply a script was measured.
 *
 * - `observed`  derived from the track or the command stream.
 * - `scripted`  authored as part of a mock scenario.
 */
export type RunEventProvenance = "observed" | "scripted";

export interface RunEventParty {
  /** HLA entity id, when the party is a unit in the federation. */
  entityId?: string;
  label: string;
  force: "BLUE" | "RED";
}

/** Platforms lost, by side. */
export interface RunEventLosses {
  blue: number;
  red: number;
}

export interface RunEvent {
  id: string;
  /** Epoch seconds. */
  ts: number;
  /** Seconds since the start of the run. */
  tSec: number;
  kind: RunEventKind;
  provenance: RunEventProvenance;
  /** The side that acted. */
  force: "BLUE" | "RED";
  /** One line — this is what the timeline marker says. */
  label: string;
  /** Two or three sentences — this is what the debrief says. */
  detail: string;
  actor?: RunEventParty;
  target?: RunEventParty;
  /** Weapon, sensor or effector involved, where it is known. */
  means?: string;
  /** Platforms lost in this event. Absent means none, not unknown. */
  losses?: RunEventLosses;
  /** Where it happened, when that is known. */
  location?: { lat: number; lon: number };
}

/** Total platforms lost by each side across a set of events. */
export function tallyLosses(events: RunEvent[]): RunEventLosses {
  return events.reduce<RunEventLosses>(
    (total, event) => ({
      blue: total.blue + (event.losses?.blue ?? 0),
      red: total.red + (event.losses?.red ?? 0),
    }),
    { blue: 0, red: 0 },
  );
}
