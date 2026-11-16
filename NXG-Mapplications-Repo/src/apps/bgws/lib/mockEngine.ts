// ── bgws/lib/mockEngine.ts ─────────────────────────────────────────────────
// A pretend BGWS federate and Foundry backend, entirely in the browser.
//
// Mock mode (?mock=1, or Workshop's mock-demo) has to exercise every path of
// the screen with nothing behind it: loading a scenario, the federate's state
// changing, units appearing and moving, orders being acknowledged, events
// arriving. So this produces the same three things the real backend does, in
// the same shapes:
//
//   * HlaEntity tracks         (as useEntityTrackStream would)
//   * BgwsEventRow events      (as the HLA Events stream would, including
//                               federate.status with the request's id)
//   * CommandOutcomeRow rows   (as the Command Stream Output would: SENT, then
//                               ACKNOWLEDGED rows with ETR task statuses)
//
// and the screen reads them through the same pure functions as live data. It
// is a sketch of BGWS, not a model of it: units move in straight lines, shoot
// with a fixed chance, and "rules" means "head for your side's objective".
//
// Pure TypeScript with an injected clock, so it can be stepped in tests.

import { platformById } from "../data/platforms";
import type {
  BgwsEventRow,
  BgwsFoundryScenario,
  CommandOutcomeRow,
  ControlCommand,
  FederateState,
  HlaEntity,
  LatLon,
  ScenarioObjective,
  Side,
} from "../types";
import type { DamageState } from "@/shared/hla/types";
import type { FunctionResult } from "./control";
import { bearingDeg, metresBetween, stepTowards } from "./geo";
import type { OrderCall } from "./orders";

export const MOCK_FEDERATE = "BGWS-1-1";

/** Wall-clock delays standing in for the stream → streamer → bridge → HLA hops. */
const HOP_MS = { sent: 400, smc: 900, accepted: 1000, executing: 1500, loading: 1200, terrain: 2500, ready: 4500 };
const HEARTBEAT_MS = 30_000;

/** Ground speeds by domain, m/s of sim time. */
const SPEED_MPS: Record<string, number> = { land: 7, air: 120, surface: 9, subsurface: 5 };
const DETECT_M = 4000;
const ENGAGE_M = 2500;
const ENGAGE_EVERY_S = 20;
const IMPACT_RADIUS_M = 300;

interface Task {
  commandId: string;
  kind: "move" | "patrol" | "engage" | "fireMission";
  points?: LatLon[];
  target?: string;
  untilS?: number;
}

interface MockUnit {
  entity: HlaEntity;
  side: Side;
  domain: string;
  task: Task | null;
  lastShotS: number;
  firedUpon: boolean;
  seen: Set<string>;
}

interface Pending {
  due: number;
  run: () => void;
}

/** mulberry32: small, seedable, good enough to make the mock repeatable. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A UUID-shaped, stable id for a name (not a real v5 UUID; it only has to look and behave like one). */
export function mockUuid(name: string): string {
  let hex = "";
  let h = 0x811c9dc5;
  for (let round = 0; hex.length < 32; round += 1) {
    for (const ch of `${round}:${name}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    hex += h.toString(16).padStart(8, "0");
  }
  hex = hex.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function degrade(state: DamageState): DamageState {
  if (state === "NoDamage") return "SlightDamage";
  if (state === "SlightDamage") return "ModerateDamage";
  return "Destroyed";
}

export class BgwsMockEngine {
  readonly federate = MOCK_FEDERATE;
  state: FederateState = "idle";
  speed = 1;
  simTimeS = 0;
  scenario: BgwsFoundryScenario | null = null;
  scenarioName = "";
  events: BgwsEventRow[] = [];
  outcomes: CommandOutcomeRow[] = [];

  private units = new Map<string, MockUnit>();
  private pending: Pending[] = [];
  private seq = 0;
  private lastTick: number;
  private lastHeartbeat: number;
  private rand: () => number;
  private fireMissions: { at: LatLon; side: Side; impactS: number; commandId: string; shooter: string }[] = [];

  constructor(private now: () => number = () => Date.now(), seed = 1) {
    this.lastTick = now();
    this.lastHeartbeat = now();
    this.rand = prng(seed);
    this.status("Waiting for a scenario.");
  }

  // ── Output ───────────────────────────────────────────────────────────────

  entities(): HlaEntity[] {
    return [...this.units.values()].map((u) => u.entity);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private emit(kind: string, fields: Partial<BgwsEventRow> = {}, data: Record<string, unknown> = {}): void {
    this.seq += 1;
    this.events.push({
      event_id: `mock-${this.seq}`,
      bridge_seq: this.seq,
      received_at: this.iso(),
      source: "bgws",
      kind,
      federation: "MOCK-FEDERATION",
      federate: this.federate,
      source_seq: this.seq,
      sim_time_s: this.simTimeS,
      data: JSON.stringify(data),
      ...fields,
    });
    if (this.events.length > 3000) this.events.splice(0, this.events.length - 3000);
  }

  private status(message: string, requestId?: string): void {
    this.emit(
      "federate.status",
      { text: `${this.state}: ${message}` },
      {
        requestId,
        state: this.state,
        message,
        scenario: this.scenarioName,
        simTimeS: Math.round(this.simTimeS),
        speed: this.speed,
        units: this.units.size,
      },
    );
  }

  private outcome(commandId: string, operation: string, stage: string, extra: Partial<CommandOutcomeRow> = {}): void {
    this.outcomes.push({ command_id: commandId, correlation_id: commandId, observed_at: this.iso(), stage, operation, ...extra });
    if (this.outcomes.length > 3000) this.outcomes.splice(0, this.outcomes.length - 3000);
  }

  private ack(commandId: string, operation: string, uuid: string, status: string): void {
    this.outcome(commandId, operation, "ACKNOWLEDGED", { entity_uuid: uuid, task_id: commandId, detail: `${this.iso()} - task status: ${status}` });
  }

  private later(delayMs: number, run: () => void): void {
    this.pending.push({ due: this.now() + delayMs, run });
  }

  private addressed(federate: string | undefined): boolean {
    return !federate || federate === this.federate;
  }

  // ── Functions ────────────────────────────────────────────────────────────

  /** hla_bgws_load_scenario. */
  load(scenarioJson: string, commandId: string, federate?: string, speed?: number): FunctionResult {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(scenarioJson);
    } catch {
      return { ok: false, error: "scenario_json is not valid JSON" };
    }
    if (parsed.format !== "bgws.foundry" && parsed.format !== "bgws.scenario") {
      return { ok: false, error: 'scenario_json format must be "bgws.foundry" or "bgws.scenario"' };
    }
    this.later(HOP_MS.sent, () => this.outcome(commandId, "BGWS_LOAD_SCENARIO", "SENT", { http_status: 200, detail: "sent" }));
    if (!this.addressed(federate)) return { ok: true, commandId };

    this.later(HOP_MS.loading, () => {
      if (this.state === "running" || this.state === "paused") {
        this.status("Stop the running scenario before loading another.", commandId);
        return;
      }
      this.units.clear();
      this.fireMissions = [];
      this.simTimeS = 0;
      this.scenario = parsed.format === "bgws.foundry" ? (parsed as unknown as BgwsFoundryScenario) : null;
      this.scenarioName = String(parsed.name ?? "");
      if (speed) this.speed = speed;
      this.state = "loading";
      this.status("Reading the scenario.", commandId);
      if (this.scenario?.terrain === "real") {
        this.later(HOP_MS.terrain - HOP_MS.loading, () => {
          this.state = "building_terrain";
          this.status("Building real terrain for the area (mock: instant).", commandId);
        });
      }
      this.later(HOP_MS.ready - HOP_MS.loading, () => {
        this.spawn();
        this.state = "ready";
        this.status(
          this.scenario ? `Ready: ${this.units.size} units placed.` : "Ready (native scenario: the mock does not simulate its units).",
          commandId,
        );
      });
    });
    return { ok: true, commandId };
  }

  /** hla_bgws_control. */
  control(command: ControlCommand, commandId: string, federate?: string, speed?: number): FunctionResult {
    this.later(HOP_MS.sent, () => this.outcome(commandId, "BGWS_CONTROL", "SENT", { http_status: 200, detail: "sent" }));
    if (!this.addressed(federate)) return { ok: true, commandId };
    this.later(HOP_MS.smc, () => {
      const from = this.state;
      const refuse = (why: string) => this.status(why, commandId);
      switch (command) {
        case "start":
          if (from !== "ready" && from !== "paused") return refuse(`Cannot start from ${from}.`);
          this.state = "running";
          return this.status("Running.", commandId);
        case "pause":
          if (from !== "running") return refuse(`Cannot pause from ${from}.`);
          this.state = "paused";
          return this.status("Paused.", commandId);
        case "resume":
          if (from !== "paused") return refuse(`Cannot resume from ${from}.`);
          this.state = "running";
          return this.status("Running.", commandId);
        case "stop":
          if (from === "idle") return refuse("Nothing to stop.");
          this.state = "finished";
          return this.status("Stopped by Foundry.", commandId);
        case "speed":
          if (speed) this.speed = speed;
          return this.status(`Speed ${this.speed}×.`, commandId);
      }
    });
    return { ok: true, commandId };
  }

  /** Any hla_* order, given as the call the dispatcher would make. */
  order(call: OrderCall, commandId: string): FunctionResult {
    const uuid = call.args[0];
    const operation = {
      moveToLocation: "MOVE",
      patrol: "PATROL",
      magicMove: "MAGIC_MOVE",
      stopEntity: "STOP_AT_SIDE_OF_ROAD",
      cancelTasks: "CANCEL_TASKS",
      setRoe: "ROE",
      fireAtEntity: "FIRE_AT_ENTITY",
      fireAtLocation: "FIRE_AT_LOCATION",
    }[call.method];

    this.later(HOP_MS.sent, () => {
      const unit = this.units.get(uuid);
      if (!unit) {
        this.outcome(commandId, operation, "REFUSED", { entity_uuid: uuid, http_status: 404, detail: `{"error":"entity ${uuid} not found"}` });
        return;
      }
      this.outcome(commandId, operation, "SENT", { entity_uuid: uuid, http_status: 200, task_id: commandId, dialect: "NETN_V4", fom_class: operation });
      this.later(HOP_MS.smc - HOP_MS.sent, () => {
        this.outcome(commandId, operation, "ACKNOWLEDGED", { entity_uuid: uuid, task_id: commandId, detail: `${this.iso()} - SMC_Response: accepted` });
      });
      this.later(HOP_MS.accepted - HOP_MS.sent, () => this.ack(commandId, operation, uuid, "Accepted"));
      this.later(HOP_MS.executing - HOP_MS.sent, () => this.apply(unit, call, commandId, operation));
    });
    return { ok: true, commandId };
  }

  private supersede(unit: MockUnit, operation: string): void {
    if (unit.task) this.ack(unit.task.commandId, operation, unit.entity.uniqueId ?? "", "Cancelled");
    unit.task = null;
  }

  private apply(unit: MockUnit, call: OrderCall, commandId: string, operation: string): void {
    const uuid = unit.entity.uniqueId ?? "";
    if (unit.entity.damageState === "Destroyed") {
      this.ack(commandId, operation, uuid, "Error");
      return;
    }
    this.ack(commandId, operation, uuid, "Executing");
    const done = () => this.ack(commandId, operation, uuid, "Completed");
    switch (call.method) {
      case "moveToLocation":
        this.supersede(unit, operation);
        unit.task = { commandId, kind: "move", points: [{ lat: call.args[1], lon: call.args[2] }] };
        this.emit("task.accepted", this.party(unit), { order: "move" });
        return;
      case "patrol":
        this.supersede(unit, operation);
        unit.task = { commandId, kind: "patrol", points: [...call.args[1]] };
        return;
      case "magicMove":
        this.supersede(unit, operation);
        unit.entity = { ...unit.entity, lat: call.args[1], lon: call.args[2], heading: call.args[3], speed: 0 };
        return done();
      case "stopEntity":
      case "cancelTasks":
        this.supersede(unit, operation);
        unit.entity = { ...unit.entity, speed: 0 };
        return done();
      case "setRoe":
        unit.entity = { ...unit.entity, roe: call.args[1] };
        return done();
      case "fireAtEntity":
        this.supersede(unit, operation);
        unit.task = { commandId, kind: "engage", target: call.args[1], untilS: this.simTimeS + call.args[2] };
        return;
      case "fireAtLocation":
        this.fireMissions.push({
          at: { lat: call.args[1], lon: call.args[2] },
          side: unit.side,
          impactS: this.simTimeS + 20,
          commandId,
          shooter: uuid,
        });
        this.emit("fires.mission", { ...this.party(unit), latitude: call.args[1], longitude: call.args[2], text: `${unit.entity.callsign} requests a fire mission` });
        return;
    }
  }

  // ── Simulation ───────────────────────────────────────────────────────────

  private spawn(): void {
    if (!this.scenario) return;
    this.scenario.units.forEach((u, i) => {
      const name = `${this.federate}-${i + 1}`;
      const uuid = mockUuid(name);
      const platform = platformById(u.platform);
      this.units.set(uuid, {
        side: u.side,
        domain: platform?.domain ?? "land",
        task: null,
        lastShotS: -ENGAGE_EVERY_S * this.rand(),
        firedUpon: false,
        seen: new Set(),
        entity: {
          id: `ObjectInstanceHandle<${1000 + i}>`,
          uniqueId: uuid,
          callsign: u.label,
          unit: name,
          force: u.side === "red" ? "RED" : "BLUE",
          sisoType: "1.1.0.0.0.0.0",
          natureApp6: platform?.nature,
          lat: u.lat,
          lon: u.lon,
          altitudeMeters: platform?.domain === "air" ? 1500 : 0,
          heading: u.headingDeg,
          speed: 0,
          damageState: "NoDamage",
          aggregateState: "aggregated",
          roe: "return_fire",
          simulator: "unknown",
        },
      });
    });
  }

  private party(unit: MockUnit, prefix: "entity" | "target" = "entity"): Partial<BgwsEventRow> {
    const e = unit.entity;
    return prefix === "entity"
      ? { side: unit.side, entity_name: e.unit, entity_unique_id: e.uniqueId, entity_callsign: e.callsign, latitude: e.lat, longitude: e.lon }
      : { target_name: e.unit, target_unique_id: e.uniqueId, target_callsign: e.callsign };
  }

  private hit(shooter: MockUnit, target: MockUnit, p: number): void {
    target.firedUpon = true;
    shooter.lastShotS = this.simTimeS;
    if (this.rand() > p) {
      this.emit("fire.miss", { ...this.party(shooter), ...this.party(target, "target"), text: `${shooter.entity.callsign} fires at ${target.entity.callsign} and misses` });
      return;
    }
    const damage = degrade(target.entity.damageState);
    target.entity = { ...target.entity, damageState: damage, speed: damage === "Destroyed" ? 0 : target.entity.speed };
    this.emit(
      "fire.hit",
      { ...this.party(shooter), ...this.party(target, "target"), result: damage, text: `${shooter.entity.callsign} hits ${target.entity.callsign} (${damage})` },
      { p },
    );
    if (damage === "Destroyed") {
      this.emit("unit.destroyed", { ...this.party(target), text: `${target.entity.callsign} destroyed` });
      if (target.task) this.ack(target.task.commandId, "TASK", target.entity.uniqueId ?? "", "Error");
      target.task = null;
    }
  }

  private objectiveFor(unit: MockUnit): ScenarioObjective | null {
    const own = this.scenario?.objectives.filter((o) => o.side === unit.side) ?? [];
    let best: ScenarioObjective | null = null;
    let bestD = Infinity;
    for (const o of own) {
      const d = metresBetween(unit.entity, o);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best && bestD > best.radiusM * 0.5 ? best : null;
  }

  private moveUnit(unit: MockUnit, to: LatLon, dtS: number, factor = 1): boolean {
    const metres = SPEED_MPS[unit.domain] * factor * dtS;
    const from = { lat: unit.entity.lat, lon: unit.entity.lon };
    const next = stepTowards(from, to, metres);
    const arrived = next.lat === to.lat && next.lon === to.lon;
    unit.entity = {
      ...unit.entity,
      lat: next.lat,
      lon: next.lon,
      heading: metresBetween(from, to) > 1 ? Math.round(bearingDeg(from, to)) : unit.entity.heading,
      speed: arrived ? 0 : (metres / Math.max(dtS, 1e-6)) * 3.6,
    };
    return arrived;
  }

  /** Advance to the injected clock's now. Call it on a timer. */
  tick(): void {
    const now = this.now();
    const dtWall = Math.max(0, now - this.lastTick) / 1000;
    this.lastTick = now;

    // Due deliveries, in order (a delivery can schedule another).
    for (let guard = 0; guard < 100; guard += 1) {
      const due = this.pending.filter((p) => p.due <= now).sort((a, b) => a.due - b.due);
      if (due.length === 0) break;
      this.pending = this.pending.filter((p) => !due.includes(p));
      due.forEach((p) => p.run());
    }

    if (now - this.lastHeartbeat >= HEARTBEAT_MS) {
      this.lastHeartbeat = now;
      this.status("Heartbeat.");
    }

    if (this.state !== "running") {
      for (const unit of this.units.values()) if (unit.entity.speed !== 0) unit.entity = { ...unit.entity, speed: 0 };
      return;
    }

    const dtS = dtWall * this.speed;
    this.simTimeS += dtS;
    const commandMode = this.scenario?.command ?? {};
    const alive = [...this.units.values()].filter((u) => u.entity.damageState !== "Destroyed");

    for (const unit of alive) {
      const task = unit.task;
      if (task?.kind === "move" || task?.kind === "patrol") {
        const target = task.points?.[0];
        if (target && this.moveUnit(unit, target, dtS)) {
          task.points = task.points!.slice(1);
          if (task.points.length === 0) {
            this.ack(task.commandId, task.kind === "move" ? "MOVE" : "PATROL", unit.entity.uniqueId ?? "", "Completed");
            this.emit("task.completed", this.party(unit), { order: task.kind });
            unit.task = null;
          }
        }
      } else if (!task && commandMode[unit.side] !== "foundry") {
        // "Rules": make for the side's nearest objective at a walk.
        const objective = this.objectiveFor(unit);
        if (objective) this.moveUnit(unit, objective, dtS, 0.5);
        else if (unit.entity.speed !== 0) unit.entity = { ...unit.entity, speed: 0 };
      } else if (unit.entity.speed !== 0 && task?.kind !== "engage") {
        unit.entity = { ...unit.entity, speed: 0 };
      }
    }

    // Detection and fire.
    for (const unit of alive) {
      if (unit.entity.damageState === "Destroyed") continue;
      for (const other of alive) {
        if (other.side === unit.side || other.entity.damageState === "Destroyed") continue;
        const d = metresBetween(unit.entity, other.entity);
        const otherId = other.entity.uniqueId ?? "";
        if (d <= DETECT_M && !unit.seen.has(otherId)) {
          unit.seen.add(otherId);
          this.emit("sense.detect", { ...this.party(unit), ...this.party(other, "target"), text: `${unit.entity.callsign} detects ${other.entity.callsign} at ${Math.round(d)} m` });
        }
      }
      if (this.simTimeS - unit.lastShotS < ENGAGE_EVERY_S) continue;

      const task = unit.task;
      if (task?.kind === "engage") {
        const target = this.units.get(task.target ?? "");
        if (!target || target.entity.damageState === "Destroyed" || this.simTimeS > (task.untilS ?? 0)) {
          this.ack(task.commandId, "FIRE_AT_ENTITY", unit.entity.uniqueId ?? "", "Completed");
          unit.task = null;
        } else if (metresBetween(unit.entity, target.entity) <= ENGAGE_M * 1.5) {
          this.hit(unit, target, 0.5);
        }
        continue;
      }

      const roe = unit.entity.roe;
      if (roe === "hold_fire" || (roe === "return_fire" && !unit.firedUpon && commandMode[unit.side] === "foundry")) continue;
      const target = alive.find(
        (o) => o.side !== unit.side && o.side !== "neutral" && unit.side !== "neutral" &&
          o.entity.damageState !== "Destroyed" && metresBetween(unit.entity, o.entity) <= ENGAGE_M,
      );
      if (target) this.hit(unit, target, 0.25);
    }

    // Fire missions land.
    for (const mission of this.fireMissions.filter((m) => m.impactS <= this.simTimeS)) {
      this.emit("munition.impact", { side: mission.side, latitude: mission.at.lat, longitude: mission.at.lon, text: "Fire mission impacts" });
      for (const victim of alive) {
        if (victim.side !== mission.side && metresBetween(victim.entity, mission.at) <= IMPACT_RADIUS_M) {
          const shooter = this.units.get(mission.shooter);
          if (shooter) this.hit(shooter, victim, 0.6);
        }
      }
      this.ack(mission.commandId, "FIRE_AT_LOCATION", mission.shooter, "Completed");
    }
    this.fireMissions = this.fireMissions.filter((m) => m.impactS > this.simTimeS);

    if (this.scenario && this.simTimeS >= this.scenario.durationMin * 60) {
      this.state = "finished";
      this.emit("sim.over", { text: "Time limit reached" });
      this.status("Time limit reached.");
    }
  }
}
