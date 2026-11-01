// analysisScreen/hooks/useLivePhaseAnalysis.ts
//
// Plan vs execution for a REAL run: the phase's plan from the ontology, the
// run's whole track at a coarse cadence, planned units matched to simulated
// entities, and the compliance and debrief computed from those.
//
// Playback stays as it is — windowed, a few chunks resident. This is a
// separate, one-off read per (run, phase), done in the background; the map
// is usable while it runs, and the plan overlay and compliance panel appear
// when it lands.
//
// The read and the scoring are separate: the analyst's match corrections
// (lib/matchOverrides) re-score the run in memory, without reading it again.
import { useEffect, useMemo, useRef, useState } from "react";
import type { PhasePlan } from "@/shared/hla/balticShieldPlan";
import type { Phase } from "../../scenarioPlanner/shared/types";
import { loadPhasePlan } from "../data/phasePlanSource";
import { loadRunTrackFrames } from "../data/runTrack";
import { type RunCompliance, assessPlanCompliance } from "../lib/compliance";
import { type RunDebrief, generateDebrief } from "../lib/debriefNarrative";
import { type EntityCandidate, type MatchResult, matchPlannedUnits } from "../lib/entityMatch";
import { type MatchOverrides, resolveOverrides } from "../lib/matchOverrides";
import { withEntityIds } from "../lib/phasePlan";
import { computeRunStatistics } from "../lib/runStatistics";
import type { SampledTrack } from "../lib/sampleMockTrack";
import { candidatesFromFrames, rosterFromFrames, trackFromFrames } from "../lib/trackSample";
import type { Frame, RunSummary } from "../types";

export interface LivePhaseAnalysis {
  status: "idle" | "loading" | "ready" | "no-plan" | "error";
  plan?: PhasePlan;
  compliance?: RunCompliance;
  debrief?: RunDebrief;
  match?: MatchResult;
  /** Every entity in the run, at its first position — what a correction can pick from. */
  candidates?: EntityCandidate[];
  /** Planned ids whose correction names nobody in this run. */
  staleOverrides?: string[];
  /** The run's sampled track — where each entity ended up, for planning the next phase. */
  track?: SampledTrack;
  /** Planned units in the plan, for the "x of y matched" line. */
  plannedCount: number;
  error?: string;
}

const IDLE: LivePhaseAnalysis = { status: "idle", plannedCount: 0 };
const NO_OVERRIDES: MatchOverrides = {};

type Loaded =
  | { status: "idle" | "loading" | "no-plan" }
  | { status: "error"; error: string }
  | { status: "ready"; basePlan: PhasePlan; frames: Frame[]; run: RunSummary };

/** Score a loaded run against its plan, with the analyst's corrections. */
function score(
  basePlan: PhasePlan,
  frames: Frame[],
  run: RunSummary,
  overrides: MatchOverrides,
): LivePhaseAnalysis {
  const candidates = candidatesFromFrames(frames);
  const resolved = resolveOverrides(overrides, basePlan.units, candidates);
  const match = matchPlannedUnits(basePlan.units, candidates, resolved);
  const plan = withEntityIds(basePlan, match.entityFor);
  const runDurationSec = Math.max(1, run.endS - run.startS);
  const track = trackFromFrames(frames, run.startS);
  const compliance = assessPlanCompliance(plan, track, runDurationSec);
  // A real run has no event log yet: the tracks feed publishes no
  // engagements or losses. The statistics and narrative say so rather
  // than inventing any.
  const statistics = computeRunStatistics({
    track,
    roster: rosterFromFrames(frames),
    runDurationSec,
    events: [],
    compliance,
  });
  return {
    status: "ready",
    plan,
    compliance,
    match,
    candidates,
    staleOverrides: resolved.stale,
    track,
    plannedCount: plan.units.length,
    debrief: {
      events: [],
      statistics,
      narrative: generateDebrief({
        phaseName: plan.phaseName,
        objectiveStatement: plan.objectiveStatement,
        statistics,
        events: [],
        compliance,
      }),
    },
  };
}

export function useLivePhaseAnalysis(
  run: RunSummary | null,
  scenarioId: string | null,
  phase: Phase | null,
  overrides: MatchOverrides = NO_OVERRIDES,
): LivePhaseAnalysis {
  const [loaded, setLoaded] = useState<Loaded>({ status: "idle" });
  // The phase object is re-created whenever the scenario reloads; only its id
  // should restart a load that reads a whole run.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const phaseId = phase?.id ?? null;

  useEffect(() => {
    const phase = phaseRef.current;
    if (!run || !scenarioId || !phase) {
      setLoaded({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setLoaded({ status: "loading" });

    (async () => {
      const basePlan = await loadPhasePlan(scenarioId, phase);
      if (controller.signal.aborted) return;
      if (!basePlan) {
        setLoaded({ status: "no-plan" });
        return;
      }
      const frames = await loadRunTrackFrames(run, controller.signal);
      if (controller.signal.aborted) return;
      setLoaded({ status: "ready", basePlan, frames, run });
    })().catch((err) => {
      if (controller.signal.aborted || (err as Error)?.name === "AbortError") return;
      setLoaded({ status: "error", error: String((err as Error)?.message ?? err) });
    });

    return () => controller.abort();
  }, [run, scenarioId, phaseId]);

  return useMemo<LivePhaseAnalysis>(() => {
    switch (loaded.status) {
      case "ready":
        return score(loaded.basePlan, loaded.frames, loaded.run, overrides);
      case "error":
        return { status: "error", plannedCount: 0, error: loaded.error };
      case "idle":
        return IDLE;
      default:
        return { status: loaded.status, plannedCount: 0 };
    }
  }, [loaded, overrides]);
}
