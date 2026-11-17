// ── bgws/lib/events.ts ─────────────────────────────────────────────────────
// Reading the HLA Events stream for the BGWS screen, and deciding which live
// tracks are BGWS's.
//
// The events stream carries two things this screen cares about:
//
//   * `federate.status` — BGWS's own state (idle, loading, building_terrain,
//     ready, running, paused, finished, error) with its sim time and speed,
//     sent on every change, on every control (echoing its requestId, which is
//     the command_id of the hla_bgws_* call), and every 30 s as a heartbeat.
//   * everything else BGWS logs — detections, hits, kills, orders, fire
//     missions, morale, … — plus RPR WeaponFire/MunitionDetonation from any
//     simulator (source "rpr").
//
// Kinds are dotted ("fire.hit", "unit.destroyed", "task.accepted"); the part
// before the dot is the family the filter offers.

import type { BgwsEventRow, FederateStatus, HlaEntity, LatLon } from "../types";

export const STATUS_KIND = "federate.status";

/** BGWS names every entity it publishes `BGWS-<site>-<application>-<n>`. */
export const BGWS_NAME_PREFIX = "BGWS-";

export function parseEventData(row: Pick<BgwsEventRow, "data">): Record<string, unknown> | null {
  if (!row.data) return null;
  try {
    const value = JSON.parse(row.data);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The federate status a `federate.status` event carries, or null for any other event. */
export function federateStatusOf(row: BgwsEventRow): FederateStatus | null {
  if (row.kind !== STATUS_KIND) return null;
  const data = parseEventData(row) ?? {};
  const federate = row.federate || str(data.federate) || "";
  return {
    federate,
    state: str(data.state) ?? "unknown",
    message: str(data.message),
    scenario: str(data.scenario),
    simTimeS: num(data.simTimeS) ?? num(row.sim_time_s),
    speed: num(data.speed),
    units: num(data.units),
    requestId: str(data.requestId),
    receivedAt: row.received_at ?? undefined,
  };
}

/** Stream order: the bridge's sequence where present, else receive time. */
export function compareEvents(a: BgwsEventRow, b: BgwsEventRow): number {
  if (typeof a.bridge_seq === "number" && typeof b.bridge_seq === "number" && a.bridge_seq !== b.bridge_seq) {
    return a.bridge_seq - b.bridge_seq;
  }
  return String(a.received_at ?? "").localeCompare(String(b.received_at ?? ""));
}

/** The latest status per federate, newest first by name. */
export function latestStatuses(rows: Iterable<BgwsEventRow>): FederateStatus[] {
  const latest = new Map<string, { row: BgwsEventRow; status: FederateStatus }>();
  for (const row of rows) {
    const status = federateStatusOf(row);
    if (!status) continue;
    const held = latest.get(status.federate);
    if (!held || compareEvents(held.row, row) <= 0) latest.set(status.federate, { row, status });
  }
  return [...latest.values()].map((v) => v.status).sort((a, b) => a.federate.localeCompare(b.federate));
}

/** Every status BGWS sent in answer to one request (our command_id), oldest first. */
export function statusesForRequest(rows: Iterable<BgwsEventRow>, requestId: string): FederateStatus[] {
  const out: { row: BgwsEventRow; status: FederateStatus }[] = [];
  for (const row of rows) {
    const status = federateStatusOf(row);
    if (status && status.requestId === requestId) out.push({ row, status });
  }
  return out.sort((a, b) => compareEvents(a.row, b.row)).map((v) => v.status);
}

/** "fire.hit" → "fire"; a kind with no dot is its own family. */
export function eventFamily(kind: string | null | undefined): string {
  const k = String(kind ?? "").trim();
  if (!k) return "other";
  const dot = k.indexOf(".");
  return dot > 0 ? k.slice(0, dot) : k;
}

export function eventPosition(row: BgwsEventRow): LatLon | null {
  return typeof row.latitude === "number" && typeof row.longitude === "number" &&
    Number.isFinite(row.latitude) && Number.isFinite(row.longitude)
    ? { lat: row.latitude, lon: row.longitude }
    : null;
}

export interface EventFilter {
  /** Families to show; empty means all. */
  families: string[];
  /** "all" or a side word as BGWS sends it (blue/red/neutral). */
  side: string;
  /** Only events naming this unit (as actor or target). */
  unitUniqueId?: string | null;
  /** Free text, matched against kind, text and the parties' names. */
  text?: string;
  /** federate.status is heartbeat-noisy; hidden unless asked for. */
  includeStatus?: boolean;
  /** Only events from this federate (empty = any). */
  federate?: string;
}

export const DEFAULT_EVENT_FILTER: EventFilter = { families: [], side: "all", includeStatus: false };

/** Whether an event names a unit, as actor or target. */
export function eventInvolves(row: BgwsEventRow, uniqueId: string): boolean {
  const id = uniqueId.toLowerCase();
  return (row.entity_unique_id ?? "").toLowerCase() === id || (row.target_unique_id ?? "").toLowerCase() === id;
}

export function filterEvents(rows: readonly BgwsEventRow[], filter: EventFilter): BgwsEventRow[] {
  const text = filter.text?.trim().toLowerCase() ?? "";
  return rows.filter((row) => {
    if (row.kind === STATUS_KIND && !filter.includeStatus) return false;
    if (filter.families.length > 0 && !filter.families.includes(eventFamily(row.kind))) return false;
    if (filter.side !== "all" && String(row.side ?? "").toLowerCase() !== filter.side) return false;
    if (filter.federate && row.federate && row.federate !== filter.federate) return false;
    if (filter.unitUniqueId && !eventInvolves(row, filter.unitUniqueId)) return false;
    if (text) {
      const hay = [row.kind, row.text, row.entity_callsign, row.entity_name, row.target_callsign, row.target_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

/** The families present, most frequent first — the filter's chips. */
export function familiesIn(rows: readonly BgwsEventRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.kind === STATUS_KIND) continue;
    const f = eventFamily(row.kind);
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f);
}

/**
 * Merge newly read rows into what is held: dedupe on event_id (a stream read
 * can overlap the previous one), keep stream order, keep the newest `cap`.
 */
export function mergeEvents(held: readonly BgwsEventRow[], incoming: readonly BgwsEventRow[], cap = 2000): BgwsEventRow[] {
  if (incoming.length === 0) return held as BgwsEventRow[];
  const ids = new Set(held.map((r) => r.event_id));
  const fresh = incoming.filter((r) => r.event_id && !ids.has(r.event_id) && (ids.add(r.event_id), true));
  if (fresh.length === 0) return held as BgwsEventRow[];
  const all = [...held, ...fresh].sort(compareEvents);
  return all.length > cap ? all.slice(all.length - cap) : all;
}

/**
 * Whether a live track is a BGWS unit.
 *
 * The bridge's simulator guess keys on the text before the first underscore,
 * which BGWS names do not have, so `simulator` reads "unknown" for them; the
 * reliable mark is the instance-name prefix. A federate (e.g. "BGWS-1-1")
 * narrows to that federate's own entities, whose names it prefixes. Uniqueids
 * that BGWS events have named count too, for a BGWS build that names its
 * entities differently.
 */
export function isBgwsEntity(
  entity: Pick<HlaEntity, "unit" | "simulator" | "uniqueId">,
  federate = "",
  knownUniqueIds?: ReadonlySet<string>,
): boolean {
  const name = entity.unit ?? "";
  if (federate) return name.startsWith(`${federate}-`);
  if (name.startsWith(BGWS_NAME_PREFIX)) return true;
  if (String(entity.simulator).toLowerCase() === "bgws") return true;
  return !!entity.uniqueId && !!knownUniqueIds?.has(entity.uniqueId.toLowerCase());
}

/** Unique ids BGWS events have named — a second way to recognise its entities. */
export function uniqueIdsInEvents(rows: Iterable<BgwsEventRow>): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.source && row.source !== "bgws") continue;
    if (row.entity_unique_id) ids.add(row.entity_unique_id.toLowerCase());
    if (row.target_unique_id) ids.add(row.target_unique_id.toLowerCase());
  }
  return ids;
}

/**
 * The federate's sim time now, from its last status.
 *
 * BGWS reports sim time on state changes and a 30 s heartbeat, so the last
 * status is up to 30 s old. While running, the clock has moved on by the wall
 * time since at the reported speed; otherwise it has not moved at all.
 */
export function estimateSimTime(status: FederateStatus, nowMs: number): number | undefined {
  if (status.simTimeS === undefined) return undefined;
  if (status.state !== "running" || !status.receivedAt) return status.simTimeS;
  const at = Date.parse(status.receivedAt);
  if (!Number.isFinite(at)) return status.simTimeS;
  return status.simTimeS + (Math.max(0, nowMs - at) / 1000) * (status.speed ?? 1);
}

/** "01:02:03" for a sim time in seconds; "—" when unknown. */
export function formatSimTime(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}
