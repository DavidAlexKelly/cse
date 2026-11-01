// ── analysisScreen/lib/planEvents.ts ───────────────────────────────────────
// Turning one order's compliance into markers on the run timeline.
//
// Only ever for the order the analyst has selected. The temptation is to mark
// every order's deadline and arrival at once, but this plan has twenty orders
// and the scrub track is 26 pixels tall — the result is a row of overlapping
// badges that hides both the track and the scripted narrative events already
// on it. Selection is what makes "planned here, actually there" legible.

import type { OrderCompliance } from "./compliance";
import type { KeyEvent } from "../types";

/**
 * Planned deadline, actual arrival and worst deviation for one order, placed on
 * the run's absolute clock.
 *
 * `runStartS` is the run's epoch start; compliance works in seconds since the
 * start of the run, the timeline works in epoch seconds.
 */
export function planKeyEvents(
  compliance: OrderCompliance | null,
  runStartS: number,
): KeyEvent[] {
  if (!compliance) return [];

  const events: KeyEvent[] = [];
  const unit = compliance.unitLabel;
  const task = compliance.taskLabel;

  // No deadline worth drawing for an order that had no axis, or whose unit was
  // never observed — there is nothing on the track for it to relate to.
  const measurable =
    compliance.status !== "NO_PLANNED_ROUTE" && compliance.status !== "NOT_OBSERVED";

  if (measurable && Number.isFinite(compliance.plannedRunSec)) {
    events.push({
      id: `${compliance.orderId}-planned`,
      ts: runStartS + compliance.plannedRunSec,
      kind: "plan",
      label:
        `PLANNED — ${unit} was to complete ${task} by here ` +
        `(${compliance.plannedDurationHours.toFixed(1)} h of the phase)`,
    });
  }

  if (compliance.actualArrivalSec != null) {
    const delta = compliance.deltaPhaseHours ?? 0;
    const timing =
      delta > 0 ? `${delta.toFixed(1)} h late` : `${Math.abs(delta).toFixed(1)} h early`;
    events.push({
      id: `${compliance.orderId}-arrival`,
      ts: runStartS + compliance.actualArrivalSec,
      kind: "arrival",
      label: `ARRIVED — ${unit} reached its ${task} objective, ${timing}`,
    });
  }

  // Only worth a marker when the deviation is large enough to be the reason
  // someone is looking; every track is a few hundred metres off a straight line.
  if (compliance.maxCrossTrackAtSec != null && compliance.maxCrossTrackKm >= 1) {
    events.push({
      id: `${compliance.orderId}-deviation`,
      ts: runStartS + compliance.maxCrossTrackAtSec,
      kind: "deviation",
      label:
        `OFF AXIS — ${unit} was ${compliance.maxCrossTrackKm.toFixed(1)} km from its ` +
        `${task} axis at its furthest`,
    });
  }

  return events;
}

export default planKeyEvents;
