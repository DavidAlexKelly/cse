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
import { useEffect, useRef, useState } from "react";
import type { PhasePlan } from "@/shared/hla/balticShieldPlan";
import type { Phase } from "../../scenarioPlanner/shared/types";
import { loadPhasePlan } from "../data/phasePlanSource";
import { loadRunTrackFrames } from "../data/runTrack";
import { type RunCompliance, assessPlanCompliance } from "../lib/compliance";
import { type RunDebrief, generateDebrief } from "../lib/debriefNarrative";
import { type MatchResult, matchPlannedUnits } from "../lib/entityMatch";
import { withEntityIds } from "../lib/phasePlan";
import { computeRunStatistics } from "../lib/runStatistics";
import { candidatesFromFrames, rosterFromFrames, trackFromFrames } from "../lib/trackSample";
import type { RunSummary } from "../types";

export interface LivePhaseAnalysis {
  status: "idle" | "loading" | "ready" | "no-plan" | "error";
  plan?: PhasePlan;
  compliance?: RunCompliance;
  debrief?: RunDebrief;
  match?: MatchResult;
  /** Planned units in the plan, for the "x of y matched" line. */
  plannedCount: number;
  error?: string;
}

const IDLE: LivePhaseAnalysis = { status: "idle", plannedCount: 0 };

export function useLivePhaseAnalysis(
  run: RunSummary | null,
  scenarioId: string | null,
  phase: Phase | null,
): LivePhaseAnalysis {
  const [state, setState] = useState<LivePhaseAnalysis>(IDLE);
  // The phase object is re-created whenever the scenario reloads; only its id
  // should restart a load that reads a whole run.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const phaseId = phase?.id ?? null;

  useEffect(() => {
    const phase = phaseRef.current;
    if (!run || !scenarioId || !phase) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", plannedCount: 0 });

    (async () => {
      const basePlan = await loadPhasePlan(scenarioId, phase);
      if (controller.signal.aborted) return;
      if (!basePlan) {
        setState({ status: "no-plan", plannedCount: 0 });
        return;
      }
      const frames = await loadRunTrackFrames(run, controller.signal);
      if (controller.signal.aborted) return;

      const match = matchPlannedUnits(basePlan.units, candidatesFromFrames(frames));
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
      setState({
        status: "ready",
        plan,
        compliance,
        match,
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
      });
    })().catch((err) => {
      if (controller.signal.aborted || (err as Error)?.name === "AbortError") return;
      setState({ status: "error", plannedCount: 0, error: String((err as Error)?.message ?? err) });
    });

    return () => controller.abort();
  }, [run, scenarioId, phaseId]);

  return state;
}
