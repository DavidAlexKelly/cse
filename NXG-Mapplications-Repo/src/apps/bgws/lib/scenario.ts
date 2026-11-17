// ── bgws/lib/scenario.ts ───────────────────────────────────────────────────
// The scenario builder's model: a draft you edit, the "bgws.foundry" v1 JSON
// it turns into, the checks it must pass before it is worth sending, and
// import of a file someone exported earlier.
//
// Pure on purpose. A scenario is the one thing in this screen that crosses a
// slow, lossy path — function → command stream → streamer → bridge → HLA →
// BGWS — and the first anyone hears of a malformed one is a `federate.status`
// error a minute later, or nothing. Everything that can be caught here is, and
// all of it is tested (scenario.test.ts).

import { isCommandPost, platformById } from "../data/platforms";
import type {
  Area,
  BgwsFoundryScenario,
  CommandMode,
  DraftObjective,
  ScenarioDraft,
  ScenarioObjective,
  ScenarioUnit,
  Side,
  ValidationIssue,
} from "../types";
import { QUALITIES, SIDES, WEATHERS } from "../types";
import { areaSizeKm, inArea, round6 } from "./geo";

export const SCENARIO_FORMAT = "bgws.foundry";
export const SCENARIO_VERSION = 1;
/** BGWS's native format, accepted by hla_bgws_load_scenario as-is. */
export const NATIVE_FORMAT = "bgws.scenario";

/** Limits the builder enforces. Generous: they catch typos, not tactics. */
export const LIMITS = {
  maxDurationMin: 7 * 24 * 60,
  maxCount: 99,
  /** Real terrain is built from OSM and elevation for the whole box; past this it takes very long. */
  warnAreaKm: 120,
  maxAreaKm: 400,
  /**
   * A scenario travels as one record on the command stream. CONTRACT §2e
   * expects 5–50 KB; past this the record is large enough to be worth a look.
   */
  warnJsonBytes: 200_000,
} as const;

/** A fresh draft: nothing placed, sensible defaults, starting on the next hour. */
export function defaultDraft(now: Date = new Date()): ScenarioDraft {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() + 1);
  return {
    name: "New BGWS scenario",
    seed: 1,
    durationMin: 90,
    startUtc: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
    weather: "clear",
    area: null,
    terrain: "real",
    command: { blue: "rules", red: "rules" },
    units: [],
    objectives: [],
    breakpointPct: 60,
  };
}

/** The next free id with a prefix: b-1, b-2, … ("b" blue, "r" red, "n" neutral, "o" objective). */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) {
    const id = `${prefix}-${n}`;
    if (!used.has(id)) return id;
  }
}

export function sidePrefix(side: Side): string {
  return side === "blue" ? "b" : side === "red" ? "r" : "n";
}

/** "Blue 3 Main battle tank troop" — the label a freshly placed unit gets. */
export function defaultUnitLabel(side: Side, ordinal: number, platformId: string): string {
  const name = platformById(platformId)?.name ?? platformId;
  return `${side[0].toUpperCase()}${side.slice(1)} ${ordinal} ${name}`;
}

function unitsOnSide(draft: ScenarioDraft, side: Side): ScenarioUnit[] {
  return draft.units.filter((u) => u.side === side);
}

/** A new unit at a point, given an id and default label that do not clash. */
export function newUnit(
  draft: ScenarioDraft,
  side: Side,
  platform: string,
  at: { lat: number; lon: number },
  extra: Partial<Pick<ScenarioUnit, "count" | "quality" | "label" | "headingDeg">> = {},
): ScenarioUnit {
  const id = nextId(sidePrefix(side), draft.units.map((u) => u.id));
  return {
    id,
    label: extra.label?.trim() || defaultUnitLabel(side, unitsOnSide(draft, side).length + 1, platform),
    side,
    platform,
    count: extra.count ?? 1,
    quality: extra.quality ?? "regular",
    lat: at.lat,
    lon: at.lon,
    headingDeg: extra.headingDeg ?? 0,
  };
}

export function newObjective(draft: ScenarioDraft, side: Side, at: { lat: number; lon: number }): DraftObjective {
  const id = nextId("o", draft.objectives.map((o) => o.id));
  return {
    id,
    side,
    label: `OBJ ${draft.objectives.length + 1}`,
    lat: at.lat,
    lon: at.lon,
    radiusM: 600,
    holdMin: 10,
  };
}

/** The sides a scenario's `command` block names: blue and red always, neutral when it has units. */
export function commandFor(draft: ScenarioDraft): Partial<Record<Side, CommandMode>> {
  const command: Partial<Record<Side, CommandMode>> = { blue: draft.command.blue, red: draft.command.red };
  if (draft.units.some((u) => u.side === "neutral")) command.neutral = draft.command.neutral ?? "rules";
  return command;
}

/**
 * The "bgws.foundry" v1 document for a draft, in the contract's key order.
 *
 * Returns null without an area: BGWS needs one to build terrain, and there is
 * no sensible default for "somewhere". Validation reports it as an error, so
 * this only happens when a caller skips validation.
 */
export function buildScenario(draft: ScenarioDraft): BgwsFoundryScenario | null {
  if (!draft.area) return null;
  const area: Area = {
    south: round6(draft.area.south),
    west: round6(draft.area.west),
    north: round6(draft.area.north),
    east: round6(draft.area.east),
  };
  return {
    format: SCENARIO_FORMAT,
    version: SCENARIO_VERSION,
    name: draft.name.trim(),
    seed: Math.trunc(draft.seed),
    durationMin: Math.trunc(draft.durationMin),
    startUtc: draft.startUtc,
    weather: draft.weather,
    area,
    terrain: draft.terrain,
    command: commandFor(draft),
    units: draft.units.map((u) => ({
      id: u.id,
      label: u.label.trim() || u.id,
      side: u.side,
      platform: u.platform,
      count: Math.trunc(u.count),
      quality: u.quality,
      lat: round6(u.lat),
      lon: round6(u.lon),
      headingDeg: Math.round(((u.headingDeg % 360) + 360) % 360),
    })),
    objectives: draft.objectives.map(
      (o): ScenarioObjective => ({
        side: o.side,
        label: o.label.trim() || o.id,
        lat: round6(o.lat),
        lon: round6(o.lon),
        radiusM: Math.round(o.radiusM),
        holdMin: o.holdMin,
      }),
    ),
    breakpointPct: Math.round(draft.breakpointPct),
  };
}

/** The JSON text hla_bgws_load_scenario takes as `scenario_json`. */
export function scenarioJson(draft: ScenarioDraft, pretty = false): string | null {
  const scenario = buildScenario(draft);
  return scenario ? JSON.stringify(scenario, null, pretty ? 2 : undefined) : null;
}

function isIsoUtc(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Everything wrong with a draft. Errors block "Load scenario"; warnings are
 * shown but let it through.
 */
export function validateScenario(draft: ScenarioDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (field: string, message: string, ref?: string) =>
    issues.push({ level: "error", field, message, ref });
  const warn = (field: string, message: string, ref?: string) =>
    issues.push({ level: "warning", field, message, ref });

  // ── Header ────────────────────────────────────────────────────────────────
  if (!draft.name.trim()) error("name", "Give the scenario a name.");
  if (!Number.isInteger(draft.seed)) error("seed", "Seed must be a whole number.");
  if (!Number.isInteger(draft.durationMin) || draft.durationMin <= 0) {
    error("durationMin", "Duration must be a whole number of minutes above zero.");
  } else if (draft.durationMin > LIMITS.maxDurationMin) {
    error("durationMin", `Duration is capped at ${LIMITS.maxDurationMin} minutes (7 days).`);
  }
  if (!isIsoUtc(draft.startUtc)) error("startUtc", "Start time must be an ISO UTC time, e.g. 2026-06-01T08:00:00Z.");
  if (!WEATHERS.includes(draft.weather)) error("weather", `Unknown weather "${draft.weather}".`);
  if (!finite(draft.breakpointPct) || draft.breakpointPct < 1 || draft.breakpointPct > 100) {
    error("breakpointPct", "Breakpoint must be between 1 and 100 %.");
  }

  // ── Area ──────────────────────────────────────────────────────────────────
  const area = draft.area;
  if (!area) {
    error("area", "Draw the area of operations on the map.");
  } else {
    const valid =
      finite(area.south) && finite(area.north) && finite(area.west) && finite(area.east) &&
      area.south >= -85 && area.north <= 85 && area.west >= -180 && area.east <= 180 &&
      area.south < area.north && area.west < area.east;
    if (!valid) {
      error("area", "The area is not a valid box (south < north, west < east, within ±85° latitude).");
    } else {
      const { widthKm, heightKm } = areaSizeKm(area);
      const longest = Math.max(widthKm, heightKm);
      if (Math.min(widthKm, heightKm) < 0.5) error("area", "The area is under 500 m across — drag a larger box.");
      if (longest > LIMITS.maxAreaKm) {
        error("area", `The area is ${Math.round(longest)} km across; BGWS areas are limited to ${LIMITS.maxAreaKm} km.`);
      } else if (draft.terrain === "real" && longest > LIMITS.warnAreaKm) {
        warn("area", `Real terrain for a ${Math.round(longest)} km area takes a long time to build.`);
      }
    }
  }

  // ── Units ─────────────────────────────────────────────────────────────────
  for (const side of ["blue", "red"] as const) {
    if (!draft.units.some((u) => u.side === side)) error("units", `Place at least one ${side} unit.`);
  }
  const seen = new Set<string>();
  for (const u of draft.units) {
    const name = u.label.trim() || u.id;
    if (!u.id.trim()) error("unit", "A unit has no id.", u.id);
    else if (seen.has(u.id)) error("unit", `Duplicate unit id "${u.id}".`, u.id);
    seen.add(u.id);
    if (!SIDES.includes(u.side)) error("unit", `${name}: unknown side "${u.side}".`, u.id);
    if (!platformById(u.platform)) {
      // Not an error: the catalogue here may lag BGWS's. BGWS is the judge.
      warn("unit", `${name}: platform "${u.platform}" is not in this app's catalogue.`, u.id);
    }
    if (!Number.isInteger(u.count) || u.count < 1 || u.count > LIMITS.maxCount) {
      error("unit", `${name}: count must be 1–${LIMITS.maxCount}.`, u.id);
    }
    if (!QUALITIES.includes(u.quality)) error("unit", `${name}: unknown quality "${u.quality}".`, u.id);
    if (!finite(u.lat) || !finite(u.lon)) error("unit", `${name}: has no position.`, u.id);
    else if (area && !inArea(area, u)) error("unit", `${name} is outside the area.`, u.id);
    if (!finite(u.headingDeg)) error("unit", `${name}: heading must be a number.`, u.id);
    if (!u.label.trim()) warn("unit", `Unit ${u.id} has no label; its id will be used.`, u.id);
  }
  for (const side of SIDES) {
    const posts = draft.units.filter((u) => u.side === side && isCommandPost(u.platform));
    if (posts.length > 1) {
      warn("units", `${side} has ${posts.length} command posts; BGWS makes one of them the side's HQ.`, posts[1].id);
    }
  }

  // ── Objectives ────────────────────────────────────────────────────────────
  for (const o of draft.objectives) {
    const name = o.label.trim() || o.id;
    if (!SIDES.includes(o.side)) error("objective", `${name}: unknown side "${o.side}".`, o.id);
    if (!finite(o.radiusM) || o.radiusM <= 0) error("objective", `${name}: radius must be above zero.`, o.id);
    if (!finite(o.holdMin) || o.holdMin < 0) error("objective", `${name}: hold time cannot be negative.`, o.id);
    if (area && finite(o.lat) && finite(o.lon) && !inArea(area, o)) {
      error("objective", `${name} is outside the area.`, o.id);
    }
  }
  if (draft.units.length > 0 && draft.objectives.length === 0) {
    warn("objectives", "No objectives: BGWS will play to the breakpoint or the time limit.");
  }

  // ── Command ───────────────────────────────────────────────────────────────
  for (const side of ["blue", "red"] as const) {
    if (draft.command[side] === "foundry") {
      warn("command", `${side} is commanded from Foundry: its units hold until ordered.`);
    }
  }

  // ── Size ──────────────────────────────────────────────────────────────────
  const json = scenarioJson(draft);
  if (json && json.length > LIMITS.warnJsonBytes) {
    warn("size", `The scenario is ${Math.round(json.length / 1000)} KB; it is sent as one stream record.`);
  }

  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

// ── Import ─────────────────────────────────────────────────────────────────

export type ImportResult =
  | { kind: "draft"; draft: ScenarioDraft }
  /** A native BGWS scenario: not editable here, but loadable unchanged. */
  | { kind: "native"; name: string; json: string }
  | { kind: "error"; message: string };

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** A draft from a "bgws.foundry" v1 object. Tolerant: what is missing gets the default. */
export function draftFromScenario(raw: Record<string, unknown>, now: Date = new Date()): ScenarioDraft {
  const base = defaultDraft(now);
  const area = raw.area as Partial<Area> | undefined;
  const command = (raw.command ?? {}) as Partial<Record<Side, CommandMode>>;
  const mode = (value: unknown): CommandMode => (value === "foundry" ? "foundry" : "rules");

  const units: ScenarioUnit[] = [];
  for (const entry of Array.isArray(raw.units) ? raw.units : []) {
    const u = entry as Partial<ScenarioUnit>;
    const side: Side = SIDES.includes(u.side as Side) ? (u.side as Side) : "blue";
    const id = u.id && !units.some((x) => x.id === u.id) ? String(u.id) : nextId(sidePrefix(side), units.map((x) => x.id));
    units.push({
      id,
      label: asString(u.label, id),
      side,
      platform: asString(u.platform, "generic/mbt"),
      count: asNumber(u.count, 1),
      quality: QUALITIES.includes(u.quality as never) ? (u.quality as ScenarioUnit["quality"]) : "regular",
      lat: asNumber(u.lat, Number.NaN),
      lon: asNumber(u.lon, Number.NaN),
      headingDeg: asNumber(u.headingDeg, 0),
    });
  }

  const objectives: DraftObjective[] = [];
  for (const entry of Array.isArray(raw.objectives) ? raw.objectives : []) {
    const o = entry as Partial<ScenarioObjective>;
    objectives.push({
      id: nextId("o", objectives.map((x) => x.id)),
      side: SIDES.includes(o.side as Side) ? (o.side as Side) : "blue",
      label: asString(o.label, ""),
      lat: asNumber(o.lat, Number.NaN),
      lon: asNumber(o.lon, Number.NaN),
      radiusM: asNumber(o.radiusM, 600),
      holdMin: asNumber(o.holdMin, 0),
    });
  }

  return {
    name: asString(raw.name, base.name),
    seed: asNumber(raw.seed, base.seed),
    durationMin: asNumber(raw.durationMin, base.durationMin),
    startUtc: asString(raw.startUtc, base.startUtc),
    weather: WEATHERS.includes(raw.weather as never) ? (raw.weather as ScenarioDraft["weather"]) : base.weather,
    area:
      area && [area.south, area.west, area.north, area.east].every((v) => typeof v === "number")
        ? { south: area.south!, west: area.west!, north: area.north!, east: area.east! }
        : null,
    terrain: raw.terrain === "generated" ? "generated" : "real",
    command: {
      blue: mode(command.blue),
      red: mode(command.red),
      ...(command.neutral ? { neutral: mode(command.neutral) } : {}),
    },
    units,
    objectives,
    breakpointPct: asNumber(raw.breakpointPct, base.breakpointPct),
  };
}

/** Parse an imported file: a builder export, a native BGWS scenario, or neither. */
export function importScenario(text: string, now: Date = new Date()): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { kind: "error", message: `Not JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "error", message: "Expected a JSON object." };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.format === SCENARIO_FORMAT) {
    if (obj.version !== SCENARIO_VERSION) {
      return { kind: "error", message: `Unsupported ${SCENARIO_FORMAT} version ${String(obj.version)}; expected ${SCENARIO_VERSION}.` };
    }
    return { kind: "draft", draft: draftFromScenario(obj, now) };
  }
  if (obj.format === NATIVE_FORMAT) {
    return { kind: "native", name: asString(obj.name, "BGWS scenario"), json: JSON.stringify(obj) };
  }
  return {
    kind: "error",
    message: `Unknown format "${String(obj.format ?? "")}"; expected "${SCENARIO_FORMAT}" or "${NATIVE_FORMAT}".`,
  };
}
