// ── hlamap/hooks/useMockSimulation.ts ────────────────────────────────────────
// Fakes an entire HLA federation for mock-demo mode, including tasking.
//
// Returns the EntityTrackStream shape useEntityTrackStream returns, plus a
// `bridge` implementing the same surface as the real bridgeClient. index.tsx
// selects between the two, so every command path — the command panel, the map
// pick modes, the scenario controls — works unchanged against the mock.
//
// The laydown and its movement come from shared/hla/balticShield, the same
// source the analysis screen replays, so the two apps cannot disagree.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ADVANCE_DURATION_S,
  BALTIC_SHIELD_FEDERATION_NAME,
  laydownAt,
} from "@/shared/hla/balticShield";
import type { AggregateState, DamageState, HlaEntity, LatLon, Roe } from "../types";
import type { EntityTrackStream } from "./useEntityTrackStream";

/** The real publisher writes at 1 Hz; matching it keeps the feel honest. */
const TICK_MS = 1000;

/** Nominal speed for a tasked move, km/h. Fast enough to be watchable. */
const TASKED_SPEED_KMH = 90;

const METRES_PER_DEG = 111_320;

interface SimpleResult {
  ok: boolean;
  error?: string;
}

const OK: SimpleResult = { ok: true };
const fail = (error: string): SimpleResult => ({ ok: false, error });

/**
 * The bridge surface index.tsx uses. Mirrors bridgeClient so the two are
 * interchangeable; anything the app does not call is deliberately absent.
 */
export interface MockBridge {
  moveToLocation(address: string, lat: number, lon: number, moveType: string): Promise<SimpleResult>;
  magicMove(address: string, lat: number, lon: number, heading: number, altitudeMeters?: number): Promise<SimpleResult>;
  patrol(address: string, waypoints: LatLon[], patrolType: string): Promise<SimpleResult>;
  fireAtLocation(address: string, lat: number, lon: number, duration: number): Promise<SimpleResult>;
  fireAtEntity(shooter: string, target: string): Promise<SimpleResult>;
  setRoe(address: string, roe: Roe): Promise<SimpleResult>;
  cancelTasks(address: string): Promise<SimpleResult>;
  injectSupplies(address: string, resourceType: string): Promise<SimpleResult>;
  aggregate(address: string, federate?: string): Promise<SimpleResult>;
  disaggregate(address: string, federate?: string): Promise<SimpleResult>;
  createObstacle(taskee: string, obstacleType: string, lat: number, lon: number): Promise<SimpleResult>;
  disruptComms(taskee: string, lat: number, lon: number, radiusKm: number, enabled: boolean): Promise<SimpleResult>;
  startScenario(): Promise<SimpleResult>;
  pauseScenario(): Promise<SimpleResult>;
  stopScenario(): Promise<SimpleResult>;
}

export interface MockSimulation extends EntityTrackStream {
  bridge: MockBridge;
}

/**
 * What a command has imposed on one entity.
 *
 * A tasked unit stops following its scripted axis — the script and an operator
 * order fighting over the same position would look like a bug — so `tasked`
 * pins the entity to the values here.
 */
interface Override {
  tasked?: boolean;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  startedMs?: number;
  durationMs?: number;
  /** Waypoints remaining after the current leg, for patrol. */
  queue?: LatLon[];
  loop?: boolean;
  roe?: Roe;
  aggregateState?: AggregateState;
  damageState?: DamageState;
}

function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = bLat - aLat;
  const dLon = (bLon - aLon) * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) * METRES_PER_DEG;
}

function bearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = bLat - aLat;
  const dLon = (bLon - aLon) * Math.cos((aLat * Math.PI) / 180);
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
}

/** One damage step worse. Destroyed is terminal. */
function degrade(state: DamageState): DamageState {
  if (state === "NoDamage") return "SlightDamage";
  if (state === "SlightDamage") return "ModerateDamage";
  return "Destroyed";
}

/**
 * A realtime fake federation that can be tasked.
 *
 * Idles completely when disabled, so it costs nothing on the live path. Time is
 * taken from the wall clock rather than accumulated per tick, so a backgrounded
 * tab resumes at the right position instead of lagging.
 */
export function useMockSimulation(enabled: boolean): MockSimulation {
  const [entities, setEntities] = useState<HlaEntity[]>([]);
  const [simTime, setSimTime] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const overridesRef = useRef<Map<string, Override>>(new Map());

  const overrideFor = useCallback((address: string): Override => {
    const existing = overridesRef.current.get(address);
    if (existing) return existing;
    const created: Override = {};
    overridesRef.current.set(address, created);
    return created;
  }, []);

  /** Begin a move for an already-known current position. */
  const startMove = useCallback(
    (address: string, to: LatLon, current: HlaEntity | undefined): boolean => {
      if (!current) return false;
      const override = overrideFor(address);
      const metres = metresBetween(current.lat, current.lon, to.lat, to.lon);
      override.tasked = true;
      override.fromLat = current.lat;
      override.fromLon = current.lon;
      override.toLat = to.lat;
      override.toLon = to.lon;
      override.startedMs = Date.now();
      // Guard the zero-distance case: a duration of 0 would divide by zero on
      // the next tick and put the unit at NaN.
      override.durationMs = Math.max(500, (metres / ((TASKED_SPEED_KMH * 1000) / 3600)) * 1000);
      return true;
    },
    [overrideFor],
  );

  useEffect(() => {
    if (!enabled) {
      startedAtRef.current = null;
      overridesRef.current.clear();
      setEntities([]);
      setSimTime(0);
      return;
    }

    startedAtRef.current = Date.now();

    const tick = () => {
      const now = Date.now();
      const elapsedS = (now - (startedAtRef.current ?? now)) / 1000;
      const scripted = laydownAt(elapsedS / ADVANCE_DURATION_S);

      const next = scripted.map((entity) => {
        const override = overridesRef.current.get(entity.uniqueId ?? entity.id);
        if (!override) return entity;

        let merged: HlaEntity = { ...entity };
        if (override.roe) merged = { ...merged, roe: override.roe };
        if (override.aggregateState) merged = { ...merged, aggregateState: override.aggregateState };
        if (override.damageState) merged = { ...merged, damageState: override.damageState };

        // A destroyed unit stops moving, whatever it was told to do.
        if (merged.damageState === "Destroyed") {
          if (override.tasked && override.toLat !== undefined && override.toLon !== undefined) {
            merged = { ...merged, lat: override.toLat, lon: override.toLon };
          }
          return { ...merged, speed: 0 };
        }

        if (!override.tasked || override.toLat === undefined || override.toLon === undefined) {
          return merged;
        }

        const fromLat = override.fromLat ?? merged.lat;
        const fromLon = override.fromLon ?? merged.lon;
        const progress = Math.min(
          1,
          (now - (override.startedMs ?? now)) / (override.durationMs ?? 1),
        );

        const lat = fromLat + (override.toLat - fromLat) * progress;
        const lon = fromLon + (override.toLon - fromLon) * progress;

        if (progress >= 1) {
          // Arrived. Take the next patrol leg if there is one, otherwise hold.
          const queue = override.queue;
          if (queue && queue.length > 0) {
            const [nextLeg, ...rest] = queue;
            override.fromLat = override.toLat;
            override.fromLon = override.toLon;
            override.toLat = nextLeg.lat;
            override.toLon = nextLeg.lon;
            override.startedMs = now;
            const metres = metresBetween(fromLat, fromLon, nextLeg.lat, nextLeg.lon);
            override.durationMs = Math.max(500, (metres / ((TASKED_SPEED_KMH * 1000) / 3600)) * 1000);
            override.queue = override.loop ? [...rest, { lat: fromLat, lon: fromLon }] : rest;
          } else {
            override.startedMs = now;
            override.durationMs = 1;
          }
          return { ...merged, lat, lon, speed: 0 };
        }

        return {
          ...merged,
          lat,
          lon,
          heading: Math.round(bearing(fromLat, fromLon, override.toLat, override.toLon)),
          speed: TASKED_SPEED_KMH,
        };
      });

      setEntities(next);
      setSimTime(Math.round(elapsedS));
    };

    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);

  // Commands read the latest entity list without re-creating the bridge on
  // every tick, which would re-run any effect depending on it.
  const entitiesRef = useRef<HlaEntity[]>([]);
  entitiesRef.current = entities;

  const bridge = useMemo<MockBridge>(() => {
    const find = (address: string) =>
      entitiesRef.current.find((e) => (e.uniqueId ?? e.id) === address);

    return {
      async moveToLocation(address, lat, lon) {
        return startMove(address, { lat, lon }, find(address))
          ? OK
          : fail(`no mock entity addressed by ${address}`);
      },
      async magicMove(address, lat, lon, heading) {
        const current = find(address);
        if (!current) return fail(`no mock entity addressed by ${address}`);
        const override = overrideFor(address);
        // "Magic" is a teleport: no traversal, so the move completes instantly.
        override.tasked = true;
        override.fromLat = lat;
        override.fromLon = lon;
        override.toLat = lat;
        override.toLon = lon;
        override.startedMs = Date.now();
        override.durationMs = 1;
        void heading;
        return OK;
      },
      async patrol(address, waypoints, patrolType) {
        const current = find(address);
        if (!current || waypoints.length === 0) {
          return fail(`no mock entity addressed by ${address}`);
        }
        const [first, ...rest] = waypoints;
        if (!startMove(address, first, current)) {
          return fail(`no mock entity addressed by ${address}`);
        }
        const override = overrideFor(address);
        override.queue = rest;
        override.loop = patrolType === "loop" || patrolType === "pingpong";
        return OK;
      },
      async fireAtLocation() {
        // Nothing at the point to damage; accepted so the log reads normally.
        return OK;
      },
      async fireAtEntity(shooter, target) {
        const victim = find(target);
        if (!victim) return fail(`no mock entity addressed by ${target}`);
        const override = overrideFor(target);
        override.damageState = degrade(override.damageState ?? victim.damageState);
        void shooter;
        return OK;
      },
      async setRoe(address, roe) {
        if (!find(address)) return fail(`no mock entity addressed by ${address}`);
        overrideFor(address).roe = roe;
        return OK;
      },
      async cancelTasks(address) {
        const current = find(address);
        if (!current) return fail(`no mock entity addressed by ${address}`);
        const override = overrideFor(address);
        // Hold exactly where it is: pin the destination to the current point
        // so the scripted axis does not reclaim the unit.
        override.tasked = true;
        override.queue = [];
        override.loop = false;
        override.fromLat = current.lat;
        override.fromLon = current.lon;
        override.toLat = current.lat;
        override.toLon = current.lon;
        override.startedMs = Date.now();
        override.durationMs = 1;
        return OK;
      },
      async injectSupplies(address) {
        return find(address) ? OK : fail(`no mock entity addressed by ${address}`);
      },
      async aggregate(address) {
        if (!find(address)) return fail(`no mock entity addressed by ${address}`);
        overrideFor(address).aggregateState = "aggregated";
        return OK;
      },
      async disaggregate(address) {
        if (!find(address)) return fail(`no mock entity addressed by ${address}`);
        overrideFor(address).aggregateState = "disaggregated";
        return OK;
      },
      async createObstacle() {
        // Obstacles and comms zones are already local state in the app shell,
        // so the mock only has to accept the command.
        return OK;
      },
      async disruptComms() {
        return OK;
      },
      async startScenario() {
        return OK;
      },
      async pauseScenario() {
        return OK;
      },
      async stopScenario() {
        return OK;
      },
    };
  }, [overrideFor, startMove]);

  const status = useMemo(
    () =>
      enabled
        ? {
            connected: true,
            federationName: BALTIC_SHIELD_FEDERATION_NAME,
            simTime,
            entityCount: entities.length,
          }
        : null,
    [enabled, simTime, entities.length],
  );

  return {
    entities,
    status,
    connState: enabled ? "online" : "loading",
    error: null,
    bridge,
  };
}

export default useMockSimulation;
