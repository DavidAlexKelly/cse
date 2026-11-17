// ── bgws/hooks/useBgwsMock.ts ──────────────────────────────────────────────
// Mock mode's backend: a BgwsMockEngine ticking in the browser, exposed as the
// same three feeds the live screen reads (tracks, events, outcome rows) and the
// same BgwsApi the live screen calls. Idles completely when disabled.

import { useEffect, useMemo, useRef, useState } from "react";
import type { BgwsEventRow, CommandOutcomeRow, HlaEntity } from "../types";
import type { BgwsApi } from "../api/bgwsClient";
import { controlParams, loadScenarioParams } from "../lib/control";
import { BgwsMockEngine, mockUuid } from "../lib/mockEngine";

const TICK_MS = 500;

export interface BgwsMock {
  entities: HlaEntity[];
  events: BgwsEventRow[];
  outcomes: CommandOutcomeRow[];
  api: BgwsApi;
}

let commandSeq = 0;
function newCommandId(): string {
  commandSeq += 1;
  return mockUuid(`command-${commandSeq}-${Date.now()}`);
}

export function useBgwsMock(enabled: boolean): BgwsMock {
  const engineRef = useRef<BgwsMockEngine | null>(null);
  const [snapshot, setSnapshot] = useState<Omit<BgwsMock, "api">>({ entities: [], events: [], outcomes: [] });

  useEffect(() => {
    if (!enabled) {
      engineRef.current = null;
      setSnapshot({ entities: [], events: [], outcomes: [] });
      return;
    }
    const engine = new BgwsMockEngine();
    engineRef.current = engine;
    const tick = () => {
      engine.tick();
      // New arrays each tick so React sees the change; the engine mutates its own.
      setSnapshot({ entities: engine.entities(), events: [...engine.events], outcomes: [...engine.outcomes] });
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearInterval(id);
      engineRef.current = null;
    };
  }, [enabled]);

  const api = useMemo<BgwsApi>(
    () => ({
      async loadScenario(json, federate, speed) {
        const engine = engineRef.current;
        if (!engine) return { ok: false, error: "mock not running" };
        // Same parameter building as the real call, so mock mode exercises it.
        const params = loadScenarioParams(json, federate, speed);
        return engine.load(String(params.scenario_json), newCommandId(), params.federate as string | undefined, params.speed as number | undefined);
      },
      async control(command, federate, speed) {
        const engine = engineRef.current;
        if (!engine) return { ok: false, error: "mock not running" };
        const built = controlParams(command, federate, speed);
        if (!built.ok) return { ok: false, error: built.error };
        return engine.control(command, newCommandId(), built.params.federate as string | undefined, built.params.speed as number | undefined);
      },
      async order(call) {
        const engine = engineRef.current;
        if (!engine) return { ok: false, error: "mock not running" };
        return engine.order(call, newCommandId());
      },
    }),
    [],
  );

  return { ...snapshot, api };
}
