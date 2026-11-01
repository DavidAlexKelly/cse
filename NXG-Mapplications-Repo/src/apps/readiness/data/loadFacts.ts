// apps/readiness/data/loadFacts.ts — read-only loads for the readiness checks.
// Nothing here writes: the screen must be safe to open in the middle of an
// exercise.
import { NxgPhase } from "@nxg-simulation-execution-testing/sdk";
import { client } from "@/client";
import { BALTIC_SHIELD_PLAN } from "@/shared/hla/balticShieldPlan";
import { phaseHierarchyKey } from "@/shared/orbat/phaseKeys";
import { loadPhaseForest } from "@/shared/orbat/phaseOrbat";
import { loadPhaseStartState } from "../../analysisScreen/data/phasePlanSource";
import { listRuns } from "../../analysisScreen/data/tracks";
import { type PhaseFacts, type RunFacts, mapFacts } from "../lib/dataChecks";

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function loadPhaseFacts(
  scenarioId: string,
  phase: { id: string; name: string },
  objectives: { phaseId?: string | null }[],
): Promise<PhaseFacts> {
  const [state, forest] = await Promise.all([
    loadPhaseStartState(phase.id).catch(() => null),
    loadPhaseForest(phaseHierarchyKey(scenarioId, phase.id), phase.id).then(
      (f) => ({ ok: true as const, nodes: f.nodes }),
      (err) => ({ ok: false as const, error: describe(err) }),
    ),
  ]);
  return {
    phaseId: phase.id,
    phaseName: phase.name,
    ...mapFacts(state),
    orbat: forest.ok
      ? {
          blue: forest.nodes.filter((n) => n.side === "blue").length,
          red: forest.nodes.filter((n) => n.side === "red").length,
        }
      : null,
    orbatError: forest.ok ? undefined : forest.error,
    phaseObjectives: objectives.filter((o) => o.phaseId === phase.id).length,
    scenarioObjectives: objectives.filter((o) => !o.phaseId).length,
  };
}

export async function loadRunFacts(signal?: AbortSignal): Promise<RunFacts> {
  try {
    const runs = await listRuns(signal);
    const latest = runs.reduce<number | null>(
      (m, r) => (m === null || r.endS > m ? r.endS : m),
      null,
    );
    return { runs: runs.length, latestEndS: latest };
  } catch (err) {
    return { runs: 0, latestEndS: null, error: describe(err) };
  }
}

/** Demo mode's phase (Baltic Shield Phase 1) and its saved map. */
export async function loadDemoModeFacts(): Promise<{ phase: boolean; mapState: boolean }> {
  const id = BALTIC_SHIELD_PLAN.phaseId;
  const [phase, state] = await Promise.all([
    client(NxgPhase)
      .fetchOne(id)
      .then(() => true)
      .catch(() => false),
    loadPhaseStartState(id).catch(() => null),
  ]);
  return { phase, mapState: state !== null };
}
