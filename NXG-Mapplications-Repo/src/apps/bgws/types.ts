// ── bgws/types.ts ──────────────────────────────────────────────────────────
// Shapes for the BGWS screen: the scenario the builder edits and sends, the
// rows read back off the event and command-outcome streams, and the federate
// state BGWS reports.
//
// The wire shapes mirror the backend contract exactly (docs/BGWS.md and
// CONTRACT §2c/§3) and are kept apart from the editor's own state: the editor
// needs ids on objectives and tolerates half-filled fields while you type, the
// wire format has neither.

export type { HlaEntity, LatLon } from "@/shared/hla/types";

// ── Scenario ("bgws.foundry" v1) ───────────────────────────────────────────

export type Side = "blue" | "red" | "neutral";
export const SIDES: readonly Side[] = ["blue", "red", "neutral"];

export type Quality = "green" | "regular" | "veteran" | "elite";
export const QUALITIES: readonly Quality[] = ["green", "regular", "veteran", "elite"];

/** BGWS's weather presets (bgws-env WeatherPreset, snake_case). */
export type Weather = "clear" | "overcast" | "rain" | "heavy_rain" | "fog" | "snow" | "storm";
export const WEATHERS: readonly Weather[] = [
  "clear",
  "overcast",
  "rain",
  "heavy_rain",
  "fog",
  "snow",
  "storm",
];

export type Terrain = "real" | "generated";

/**
 * Who decides for a side. `rules`: BGWS's own rules, Foundry orders override.
 * `foundry`: units act only on Foundry orders and hold otherwise.
 */
export type CommandMode = "rules" | "foundry";

export interface Area {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface ScenarioUnit {
  id: string;
  label: string;
  side: Side;
  platform: string;
  count: number;
  quality: Quality;
  lat: number;
  lon: number;
  headingDeg: number;
}

export interface ScenarioObjective {
  side: Side;
  label: string;
  lat: number;
  lon: number;
  radiusM: number;
  holdMin: number;
}

/** Exactly what hla_bgws_load_scenario is given, as JSON. */
export interface BgwsFoundryScenario {
  format: "bgws.foundry";
  version: 1;
  name: string;
  seed: number;
  durationMin: number;
  startUtc: string;
  weather: Weather;
  area: Area;
  terrain: Terrain;
  command: Partial<Record<Side, CommandMode>>;
  units: ScenarioUnit[];
  objectives: ScenarioObjective[];
  breakpointPct: number;
}

/** An objective as edited: the wire shape plus a local id for list keys and drags. */
export interface DraftObjective extends ScenarioObjective {
  id: string;
}

/** The builder's working copy. `area` is null until one has been drawn. */
export interface ScenarioDraft {
  name: string;
  seed: number;
  durationMin: number;
  startUtc: string;
  weather: Weather;
  area: Area | null;
  terrain: Terrain;
  command: Record<"blue" | "red", CommandMode> & { neutral?: CommandMode };
  units: ScenarioUnit[];
  objectives: DraftObjective[];
  breakpointPct: number;
}

export type IssueLevel = "error" | "warning";

export interface ValidationIssue {
  level: IssueLevel;
  /** What it is about: "name", "area", "units", "unit", "objective", … */
  field: string;
  message: string;
  /** The unit or objective concerned, so the UI can select it. */
  ref?: string;
}

// ── Federate control ───────────────────────────────────────────────────────

export type ControlCommand = "start" | "pause" | "resume" | "stop" | "speed";

export type FederateState =
  | "idle"
  | "loading"
  | "building_terrain"
  | "ready"
  | "running"
  | "paused"
  | "finished"
  | "error";

/** One `federate.status` event's data, with where it came from. */
export interface FederateStatus {
  federate: string;
  state: FederateState | string;
  message?: string;
  scenario?: string;
  simTimeS?: number;
  speed?: number;
  units?: number;
  requestId?: string;
  /** When the event was received by the bridge (ISO), for "last heard". */
  receivedAt?: string;
}

// ── Streams ────────────────────────────────────────────────────────────────

/** A row of the HLA Events stream (events.py `to_record`). */
export interface BgwsEventRow {
  event_id: string;
  bridge_seq?: number | null;
  received_at?: string | null;
  source?: string | null;
  kind?: string | null;
  federation?: string | null;
  federate?: string | null;
  source_seq?: number | null;
  sim_time_s?: number | null;
  side?: string | null;
  entity_name?: string | null;
  entity_id?: string | null;
  entity_unique_id?: string | null;
  entity_callsign?: string | null;
  target_name?: string | null;
  target_id?: string | null;
  target_unique_id?: string | null;
  target_callsign?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude_m?: number | null;
  munition?: string | null;
  quantity?: number | null;
  result?: string | null;
  text?: string | null;
  /** JSON text. */
  data?: string | null;
}

/** A row of the Command Stream Output (commands.py `outcome`). */
export interface CommandOutcomeRow {
  command_id: string;
  correlation_id?: string | null;
  observed_at?: string | null;
  /** DEFERRED | SENT | REFUSED | FAILED | EXPIRED | DUPLICATE | ACKNOWLEDGED */
  stage: string;
  operation?: string | null;
  entity_uuid?: string | null;
  http_status?: number | null;
  task_id?: string | null;
  dialect?: string | null;
  fom_class?: string | null;
  detail?: string | null;
}

/**
 * Where a command has got to, as one word. `queued` is ours (the function
 * returned); the rest come from the outcome stream.
 */
export type OrderState =
  | "queued"
  | "deferred"
  | "sent"
  | "accepted"
  | "executing"
  | "completed"
  | "cancelled"
  | "refused"
  | "error"
  | "failed"
  | "expired";

export interface OutcomeSummary {
  commandId: string;
  state: OrderState;
  /** Every state seen, in order, for the progression chips. */
  trail: OrderState[];
  detail?: string;
  operation?: string;
  updatedAt?: string;
}

/** The app's own record of a command it issued. */
export interface IssuedCommand {
  /** The function's commandId, or a local id when the call failed. */
  id: string;
  commandId?: string;
  label: string;
  /** "order", "load", "control". */
  kind: "order" | "load" | "control";
  unitUniqueId?: string;
  issuedAt: string;
  /** Set when the function call itself failed: nothing was queued. */
  error?: string;
}

export type ScreenMode = "build" | "live";
