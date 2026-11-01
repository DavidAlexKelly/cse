// analysisScreen/lib/entityMatch.ts
//
// Which simulated entity IS each planned unit?
//
// The planner's units and the federation's entities have no shared key: HLA
// object handles are issued per execution, and CSE names what it spawns from
// the ORBAT rather than carrying our ids through. So the match is inferred,
// and every match says how it was made:
//
//   manual    an explicit table, for a rehearsed demo — always wins
//   name      the entity's callsign or unit name is the planned unit's name
//   position  nearest same-side entity to the planned start, within maxKm
//
// Name first, because callsigns are derived from ORBAT names and a name match
// is evidence; position is a guess, shown as one. Each entity is used once.
// Where a planned unit is an aggregate and the federation publishes its
// platforms, the nearest platform stands in for the unit — good enough to
// measure where it went, labelled for what it is.
import type { PlannedUnit } from "@/shared/hla/balticShieldPlan";
import { distanceKm } from "./geo";

export interface EntityCandidate {
  id: string;
  callsign: string;
  unit: string;
  force: "blue" | "red";
  /** Position at the start of the run. */
  lat: number;
  lon: number;
}

export type MatchMethod = "manual" | "name" | "position";

export interface EntityMatch {
  plannedId: string;
  entityId: string;
  method: MatchMethod;
  /** Planned start to the entity's start position. */
  distanceKm: number;
}

export interface MatchResult {
  matches: EntityMatch[];
  unmatchedPlanned: string[];
  /** Map planned id → entity id, for withEntityIds. */
  entityFor: Map<string, string>;
}

export const DEFAULT_MATCH_RADIUS_KM = 10;

/** Lower-case, punctuation to spaces, collapsed — "1 Mech Bn (West)" → "1 mech bn west". */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatch(planned: string, entity: string): boolean {
  const a = normaliseName(planned);
  const b = normaliseName(entity);
  if (!a || !b) return false;
  if (a === b) return true;
  // One containing the other, but only for names long enough to mean it —
  // "bn" inside "1 mech bn west" is not a match.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 6 && long.includes(short);
}

export function matchPlannedUnits(
  units: readonly PlannedUnit[],
  entities: readonly EntityCandidate[],
  options: { maxKm?: number; manual?: Readonly<Record<string, string>> } = {},
): MatchResult {
  const maxKm = options.maxKm ?? DEFAULT_MATCH_RADIUS_KM;
  const used = new Set<string>();
  const matched = new Map<string, EntityMatch>();
  const byId = new Map(entities.map((e) => [e.id, e]));
  const dist = (u: PlannedUnit, e: EntityCandidate) =>
    distanceKm({ lat: u.lat, lng: u.lng }, { lat: e.lat, lng: e.lon });

  // 1. Manual.
  for (const unit of units) {
    const id = options.manual?.[unit.id];
    const entity = id ? byId.get(id) : undefined;
    if (!entity || used.has(entity.id)) continue;
    matched.set(unit.id, {
      plannedId: unit.id,
      entityId: entity.id,
      method: "manual",
      distanceKm: dist(unit, entity),
    });
    used.add(entity.id);
  }

  // 2. Name — a unique name match per unit; ties go to the nearest same-side entity.
  for (const unit of units) {
    if (matched.has(unit.id)) continue;
    const candidates = entities
      .filter((e) => !used.has(e.id) && e.force === unit.force)
      .filter((e) => namesMatch(unit.label, e.callsign) || namesMatch(unit.label, e.unit))
      .sort((a, b) => dist(unit, a) - dist(unit, b));
    const entity = candidates[0];
    if (!entity) continue;
    matched.set(unit.id, {
      plannedId: unit.id,
      entityId: entity.id,
      method: "name",
      distanceKm: dist(unit, entity),
    });
    used.add(entity.id);
  }

  // 3. Position — closest pairs first across the whole force, so one unit
  //    cannot take another's obvious match just because it came first.
  const pairs: { unit: PlannedUnit; entity: EntityCandidate; km: number }[] = [];
  for (const unit of units) {
    if (matched.has(unit.id)) continue;
    for (const entity of entities) {
      if (used.has(entity.id) || entity.force !== unit.force) continue;
      const km = dist(unit, entity);
      if (km <= maxKm) pairs.push({ unit, entity, km });
    }
  }
  pairs.sort((a, b) => a.km - b.km);
  for (const { unit, entity, km } of pairs) {
    if (matched.has(unit.id) || used.has(entity.id)) continue;
    matched.set(unit.id, {
      plannedId: unit.id,
      entityId: entity.id,
      method: "position",
      distanceKm: km,
    });
    used.add(entity.id);
  }

  const matches = units.flatMap((u) => (matched.has(u.id) ? [matched.get(u.id)!] : []));
  return {
    matches,
    unmatchedPlanned: units.filter((u) => !matched.has(u.id)).map((u) => u.id),
    entityFor: new Map(matches.map((m) => [m.plannedId, m.entityId])),
  };
}
