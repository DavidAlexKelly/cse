// ── analysisScreen/hooks/useMockRunPlayback.ts ───────────────────────────────
// Replays a synthetic OP-BALTIC-SHIELD-2026 run for mock-demo mode.
//
// Implements the same RunPlayback contract as useRunPlayback, so index.tsx can
// select between them and the Timeline, SidePanel and map keep working with no
// changes: scrub, play, pause and speed all behave as they do for a real run.
//
// The run is a completed, fixed window — the whole point is after-action
// review, so nothing extends while you watch. Positions come from
// shared/hla/balticShield, the same laydown the live map's mock federation
// advances, so the replay and the live view show one operation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ADVANCE_DURATION_S, BALTIC_SHIELD_ENTITIES, laydownAt } from "@/shared/hla/balticShield";
import { balticShieldRunEvents } from "@/shared/hla/balticShieldEvents";
import { BALTIC_SHIELD_PLAN } from "@/shared/hla/balticShieldPlan";
import type { RunEvent } from "@/shared/hla/runEvents";
import { assessPlanCompliance } from "../lib/compliance";
import { generateDebrief } from "../lib/debriefNarrative";
import { computeRunStatistics, type Roster } from "../lib/runStatistics";
import { sampleMockTrack } from "../lib/sampleMockTrack";
import type { KeyEvent, RunSummary } from "../types";
import type { RunPlayback } from "./useRunPlayback";

/** Playhead update rate. Fine enough to look continuous, cheap enough to ignore. */
const TICK_MS = 250;

/** Identifier the mock run is listed under. */
export const MOCK_RUN_ID = "mock-baltic-shield-phase-1";

/**
 * The synthetic run, anchored so it reads as "just finished".
 *
 * Built once per mount rather than per render: a run whose bounds move on every
 * render would make the timeline jitter and defeat seeking.
 */
export function createMockRun(now = Date.now()): RunSummary {
  const endS = Math.floor(now / 1000);
  const startS = endS - ADVANCE_DURATION_S;
  return {
    id: MOCK_RUN_ID,
    startS,
    endS,
    activeMinutes: Math.round(ADVANCE_DURATION_S / 60),
  };
}

/**
 * How a run event reads as a timeline marker.
 *
 * KeyEvent has no vocabulary for electronic warfare or for a command being
 * issued, and does not need one — on a 26px scrub bar what matters is roughly
 * what sort of moment this is. EW reads as a detection because that is what it
 * is from the affected side's point of view, and a command reads as a scenario
 * beat.
 */
function markerKind(kind: RunEvent["kind"]): KeyEvent["kind"] {
  switch (kind) {
    case "ew":
      return "detection";
    case "command":
      return "phase";
    default:
      return kind;
  }
}

/**
 * Notable moments in the mock run.
 *
 * Derived from the scenario's event log (shared/hla/balticShieldEvents) rather
 * than kept as a second list, so the markers on the timeline and the events in
 * the debrief cannot say different things about the same run.
 */
export function mockKeyEvents(run: RunSummary): KeyEvent[] {
  return mockRunEvents(run).map(
    (event): KeyEvent => ({
      id: event.id,
      ts: event.ts,
      kind: markerKind(event.kind),
      label: event.label,
    }),
  );
}

/** The scenario's event log, placed on a run's clock. */
export function mockRunEvents(run: RunSummary): RunEvent[] {
  return balticShieldRunEvents(run.startS, Math.max(1, run.endS - run.startS));
}

/** Who is on which side, for the movement and contact statistics. */
const MOCK_ROSTER: Roster = new Map(
  BALTIC_SHIELD_ENTITIES.map((entity) => [
    entity.id,
    { label: entity.unit || entity.callsign, force: entity.force },
  ]),
);

/**
 * Synthetic playback over a mock run.
 *
 * Everything is generated on demand, so there is no buffering, no chunk
 * loading and no error surface — the corresponding RunPlayback fields are
 * reported as permanently settled rather than faked as pending.
 */
export function useMockRunPlayback(run: RunSummary | null, stepSeconds: number): RunPlayback {
  const [currentTs, setCurrentTs] = useState(run?.startS ?? 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const lastTickRef = useRef<number>(Date.now());

  // Re-anchor whenever the run changes, including on first arrival.
  useEffect(() => {
    setCurrentTs(run?.startS ?? 0);
    setPlaying(false);
  }, [run?.id, run?.startS]);

  useEffect(() => {
    if (!run || !playing) return;

    lastTickRef.current = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const deltaS = ((now - lastTickRef.current) / 1000) * speed;
      lastTickRef.current = now;

      setCurrentTs((ts) => {
        const next = ts + deltaS;
        if (next >= run.endS) {
          // Stop cleanly at the end rather than looping — this is an
          // after-action review, and a silent restart reads as a glitch.
          setPlaying(false);
          return run.endS;
        }
        return next;
      });
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [run, playing, speed]);

  const seek = useCallback(
    (ts: number) => {
      if (!run) return;
      setCurrentTs(Math.min(Math.max(ts, run.startS), run.endS));
    },
    [run],
  );

  const entities = useMemo(() => {
    if (!run) return [];
    const span = Math.max(1, run.endS - run.startS);
    return laydownAt((currentTs - run.startS) / span);
  }, [run, currentTs]);

  // Snap the reported frame to the resolution the UI is asking for, so the
  // frame clock ticks in step with a real run's bucketed frames.
  const frameTs = useMemo(() => {
    if (!run) return null;
    const step = Math.max(1, stepSeconds);
    return run.startS + Math.floor((currentTs - run.startS) / step) * step;
  }, [run, currentTs, stepSeconds]);

  const loadedRanges = useMemo(
    () => (run ? [{ startS: run.startS, endS: run.endS }] : []),
    [run],
  );

  const keyEvents = useMemo(() => (run ? mockKeyEvents(run) : []), [run]);

  // ── Plan vs execution ────────────────────────────────────────────────────
  // Computed once per run, not per frame: the whole advance is sampled and
  // every order measured against it, which is a few thousand points of work and
  // would be absurd to repeat at the playback clock's 15 Hz. It only depends on
  // the run's length, which does not change while you watch.
  //
  // The track is sampled once here and used for both: measuring the orders, and
  // the movement and contact statistics behind the debrief.
  const { compliance, debrief } = useMemo(() => {
    if (!run) return { compliance: undefined, debrief: undefined };

    const runDurationSec = Math.max(1, run.endS - run.startS);
    const track = sampleMockTrack(runDurationSec);
    const events = mockRunEvents(run);
    const assessed = assessPlanCompliance(BALTIC_SHIELD_PLAN, track, runDurationSec);
    const statistics = computeRunStatistics({
      track,
      roster: MOCK_ROSTER,
      runDurationSec,
      events,
      compliance: assessed,
    });

    return {
      compliance: assessed,
      debrief: {
        events,
        statistics,
        narrative: generateDebrief({
          phaseName: BALTIC_SHIELD_PLAN.phaseName,
          objectiveStatement: BALTIC_SHIELD_PLAN.objectiveStatement,
          statistics,
          events,
          compliance: assessed,
        }),
      },
    };
  }, [run]);

  return {
    currentTs,
    playing,
    speed,
    buffering: false,
    entities,
    frameTs,
    chunkSeconds: Math.max(1, stepSeconds) * 90,
    loadedRanges,
    loadingRanges: [],
    error: null,
    permissionDenied: false,
    keyEvents,
    plan: run ? BALTIC_SHIELD_PLAN : undefined,
    compliance,
    debrief,
    setPlaying,
    setSpeed,
    seek,
  };
}

export default useMockRunPlayback;
