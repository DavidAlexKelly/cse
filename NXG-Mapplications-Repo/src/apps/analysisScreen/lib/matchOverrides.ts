// analysisScreen/lib/matchOverrides.ts
//
// The analyst's corrections to planned↔entity matching, for a rehearsed demo.
//
// HLA handles change every execution, so a correction cannot name an entity
// id. It names what the simulator CALLS the unit (callsign, else unit name),
// which comes from the ORBAT and is the same run after run — so a phase's
// corrections, made once in rehearsal, hold for the run shown on the day.
//
//   "<simulator name>"   this planned unit is that entity
//   NOT_IN_RUN           this planned unit is not in the simulation — do not
//                        guess one by position
import type { PlannedUnit } from "@/shared/hla/balticShieldPlan";
import { type EntityCandidate, normaliseName } from "./entityMatch";
import { distanceKm } from "./geo";

export const NOT_IN_RUN = "\u0000not-in-run";

/** Planned unit id → simulator name, or NOT_IN_RUN. */
export type MatchOverrides = Readonly<Record<string, string>>;

/** What the simulator calls an entity — the name a correction is kept under. */
export function simulatorName(e: Pick<EntityCandidate, "id" | "callsign" | "unit">): string {
  return e.callsign?.trim() || e.unit?.trim() || e.id;
}

export interface ResolvedOverrides {
  /** Planned id → entity id in THIS run. */
  manual: Record<string, string>;
  /** Planned ids the analyst says are not in the run. */
  exclude: Set<string>;
  /** Corrections whose simulator name is not in this run. */
  stale: string[];
}

/**
 * Turn a phase's corrections into entity ids for one run. Several entities can
 * share a name (the vehicles of one unit); the one nearest the planned start
 * is taken, and each entity is used once.
 */
export function resolveOverrides(
  overrides: MatchOverrides,
  units: readonly PlannedUnit[],
  entities: readonly EntityCandidate[],
): ResolvedOverrides {
  const manual: Record<string, string> = {};
  const exclude = new Set<string>();
  const stale: string[] = [];
  const used = new Set<string>();
  const byName = new Map<string, EntityCandidate[]>();
  for (const e of entities) {
    const key = normaliseName(simulatorName(e));
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), e]);
  }
  for (const unit of units) {
    const name = overrides[unit.id];
    if (name === undefined) continue;
    if (name === NOT_IN_RUN) {
      exclude.add(unit.id);
      continue;
    }
    const pick = (byName.get(normaliseName(name)) ?? [])
      .filter((e) => !used.has(e.id))
      .sort(
        (a, b) =>
          distanceKm({ lat: unit.lat, lng: unit.lng }, { lat: a.lat, lng: a.lon }) -
          distanceKm({ lat: unit.lat, lng: unit.lng }, { lat: b.lat, lng: b.lon }),
      )[0];
    if (!pick) {
      stale.push(unit.id);
      continue;
    }
    manual[unit.id] = pick.id;
    used.add(pick.id);
  }
  return { manual, exclude, stale };
}

/** Set or clear one correction; undefined clears it (back to automatic). */
export function withOverride(
  overrides: MatchOverrides,
  plannedId: string,
  value: string | undefined,
): Record<string, string> {
  const next = { ...overrides };
  if (value === undefined) delete next[plannedId];
  else next[plannedId] = value;
  return next;
}
