// ── shared/hla/trackRow.ts ─────────────────────────────────────────────────
// Turning rows of "HLA Entity Tracks (1 Hz stream)" into HlaEntity.
//
// Extracted from hlamap/hooks/useEntityTrackStream so the live map and the
// analysis replay read the feed the same way. They arrive at these rows very
// differently — hlamap tails the stream by offset, analysisScreen queries a
// time window with SQL — but a row means the same thing either way, and the
// two views must not disagree about what a unit is called or whose side it is
// on.
//
// Why merging is necessary
// ------------------------
// Rows are sparse, deliberately so: tracks.py publishes null rather than zero
// for anything the federation has not told it, because "no position" and
// "position 0,0" are different facts. About a quarter of the rows in a real
// run are discovery rows — an entity's name and nothing else, before its first
// attribute reflection arrives. Coercing those nulls to 0 would plant units in
// the Gulf of Guinea and, worse, teleport a previously-good unit there on its
// next attribute-less tick.
//
// So every field is applied only when the row actually carries it, and a
// previously-known value is kept otherwise.

import type { HlaEntity } from "./types";

/** One row of the stream, as published by tracks.py. */
export interface TrackRow {
  track_point_id?: string;
  observed_at?: string;
  bridge_last_updated?: string | null;
  first_seen_at?: string | null;
  unique_id?: string | null;
  entity_id?: string | null;
  name?: string | null;
  callsign?: string | null;
  entity_type?: string | null;
  dis_type?: string | null;
  force_id?: string | null;
  simulator?: string | null;
  symbol_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude_m?: number | null;
  heading_deg?: number | null;
  speed_mps?: number | null;
  damage_state?: string | null;
  aggregate_state?: string | null;
  activity?: string | null;
  posture?: string | null;
  mission?: string | null;
  echelon?: string | null;
  combat_value?: number | null;
  is_command_post?: boolean | null;
  federation?: string | null;
}

/** The identity of a row's entity, however the publisher spelled it. */
export function rowKey(row: TrackRow): string | null {
  const id = row.entity_id ?? row.unique_id;
  return id ? String(id) : null;
}

/**
 * Damage state, however it is spelled.
 *
 * The bridge DTO used snake_case ("no_damage"); the FOM decoder can also yield
 * PascalCase ("NoDamage"). Normalising rather than mapping literals means a
 * publisher-side change degrades to "NoDamage" only when the value is genuinely
 * unrecognised.
 */
export function damageState(raw: string | null | undefined): HlaEntity["damageState"] {
  const key = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  switch (key) {
    case "slightdamage":
      return "SlightDamage";
    case "moderatedamage":
      return "ModerateDamage";
    case "destroyed":
      return "Destroyed";
    default:
      return "NoDamage";
  }
}

/** A never-yet-seen entity. Position is NaN, which is never a valid location. */
function blankEntity(id: string): HlaEntity {
  return {
    id,
    callsign: id,
    unit: "",
    force: "BLUE",
    sisoType: "1.1.0.3.0.0.0",
    // NaN, not 0: "not yet known", and never a valid map position.
    lat: Number.NaN,
    lon: Number.NaN,
    heading: 0,
    speed: 0,
    damageState: "NoDamage",
    aggregateState: "disaggregated",
    roe: "return_fire",
    simulator: "unknown",
  };
}

/**
 * Merge one stream row into what is already known about that entity.
 *
 * Two fields are display defaults rather than observations: the federation
 * reports back neither ROE nor aggregate state.
 */
export function mergeRow(previous: HlaEntity | undefined, row: TrackRow): HlaEntity | null {
  const id = rowKey(row);
  if (!id) return null;

  const base = previous ?? blankEntity(id);
  const next: HlaEntity = { ...base };

  if (row.unique_id) next.uniqueId = row.unique_id;
  if (row.name) next.unit = String(row.name);
  // Callsign is published for about half of all rows; fall back to the name, and
  // only to the raw id if neither has ever arrived.
  if (row.callsign) next.callsign = String(row.callsign);
  else if (row.name && (!previous || previous.callsign === previous.id)) {
    next.callsign = String(row.name);
  }
  if (row.force_id) {
    // RPR ForceIdentifier values: Friendly/Opposing/Neutral/Other.
    // Match any casing and common synonyms used by different simulators.
    const fid = String(row.force_id).toLowerCase().replace(/[^a-z]/g, "");
    const isHostile =
      fid === "opposing" ||
      fid === "enemy" ||
      fid === "opfor" ||
      fid === "hostile" ||
      fid === "red";
    next.force = isHostile ? "RED" : "BLUE";
  } else if (row.symbol_id && !previous?.force) {
    // Fall back to the SIDC published in the stream when force_id is absent.
    // Position 1 of a MIL-STD-2525 letter SIDC is the affiliation character:
    //   H/S/J/K = hostile/suspect/joker/faker → RED
    //   F/A/D/M = friend/assumed friend       → BLUE
    //   N/L     = neutral                     → BLUE (treat as non-threat)
    //   P/U/G/W = pending/unknown/exercise     → BLUE (default)
    const aff = String(row.symbol_id).toUpperCase().charAt(1);
    if (aff === "H" || aff === "S" || aff === "J" || aff === "K") {
      next.force = "RED";
    } else {
      next.force = "BLUE";
    }
  }
  if (row.dis_type) next.sisoType = String(row.dis_type);
  if (typeof row.latitude === "number") next.lat = row.latitude;
  if (typeof row.longitude === "number") next.lon = row.longitude;
  if (typeof row.altitude_m === "number") next.altitudeMeters = row.altitude_m;
  if (typeof row.heading_deg === "number") next.heading = row.heading_deg;
  // speed_mps is metres per second; HlaEntity.speed is km/h.
  if (typeof row.speed_mps === "number") next.speed = row.speed_mps * 3.6;
  if (row.damage_state) next.damageState = damageState(row.damage_state);
  if (row.aggregate_state) {
    next.aggregateState = row.aggregate_state as HlaEntity["aggregateState"];
  }
  if (row.simulator) next.simulator = row.simulator as HlaEntity["simulator"];

  return next;
}

/** Whether this entity has a position worth drawing. */
export function positioned(entity: HlaEntity): boolean {
  return Number.isFinite(entity.lat) && Number.isFinite(entity.lon);
}

/**
 * Accumulate the fields that say *what a unit is*, as opposed to what it is
 * doing, into a per-entity row.
 *
 * The live map can merge rows straight onto the running entity because it only
 * ever moves forward: whatever it learns is, by definition, the latest. A
 * replay cannot. Scrubbing means frames are built in arbitrary order, and
 * folding a whole window onto one accumulator would let a value observed at
 * 14:05 appear on the map at 14:00 — showing the analyst something that had
 * not happened yet.
 *
 * Identity is the exception, and the reason this is split out. A unit's name,
 * callsign, side, DIS type and simulator do not change during a run, so
 * carrying them across frames is filling in a gap rather than leaking the
 * future — and it has to be done, because roughly half the rows omit the
 * callsign and the symbology needs the name to pick an APP-6 symbol at all.
 *
 * Dynamic state (position, heading, speed, damage) is deliberately NOT
 * accumulated here; it comes from the row being rendered and nowhere else.
 */
export function accumulateIdentity(rows: Iterable<TrackRow>, into: Map<string, TrackRow>): void {
  for (const row of rows) {
    const key = rowKey(row);
    if (!key) continue;

    const identity: TrackRow = into.get(key) ?? { entity_id: key };
    // First non-null wins. These are constant per entity, so which sighting
    // supplied them does not matter — only that they are not overwritten with
    // a null from a sparser row later.
    if (identity.unique_id == null && row.unique_id) identity.unique_id = row.unique_id;
    if (identity.name == null && row.name) identity.name = row.name;
    if (identity.callsign == null && row.callsign) identity.callsign = row.callsign;
    if (identity.force_id == null && row.force_id) identity.force_id = row.force_id;
    if (identity.symbol_id == null && row.symbol_id) identity.symbol_id = row.symbol_id;
    if (identity.dis_type == null && row.dis_type) identity.dis_type = row.dis_type;
    if (identity.simulator == null && row.simulator) identity.simulator = row.simulator;

    into.set(key, identity);
  }
}

/**
 * The entity a row describes, given what is known about that entity's identity.
 *
 * Identity first, then the row on top: the row wins wherever it carries a
 * value, so the result is "this unit, as it was at this instant".
 */
export function entityFromRow(identity: TrackRow | undefined, row: TrackRow): HlaEntity | null {
  const base = identity ? (mergeRow(undefined, identity) ?? undefined) : undefined;
  return mergeRow(base, row);
}
