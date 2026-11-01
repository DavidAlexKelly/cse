// analysisScreen/lib/nextPhase.ts
//
// The start state of the next phase, from what ACTUALLY happened in a run —
// pure. The planner's own "Add phase" inherits the PREDICTED end state (the
// AI end-state or the deterministic resolution of the orders); after a run,
// the ground truth is better: plan phase 2 from where the force really is.
//
//   matched unit     → its last observed position in the run
//   unmatched unit   → the planner's predicted end position, else where it
//                      started — and it is reported, so nobody mistakes a
//                      prediction for an observation
//
// Everything else carries over the way the planner's inheritance does: fresh
// placement ids (ids are per phase), the ORBAT link kept (it is copied into
// the new phase's own hierarchy when the phase is created), objectives kept,
// orders cleared — orders belong to the phase they were given in.
import type { PhasePlan } from "@/shared/hla/balticShieldPlan";
import type { MapPhaseState, MapUnitPlacement } from "../../scenarioPlanner/phaseCreator/types";
import type { SampledTrack } from "./sampleMockTrack";

export interface ActualStartState {
  state: MapPhaseState;
  /** Units placed at their observed end position. */
  observed: number;
  /** Units placed from the prediction or their start, by label. */
  notObserved: { label: string; from: "predicted" | "start" }[];
}

export function actualStartState(
  source: MapPhaseState,
  plan: Pick<PhasePlan, "predictedEndState">,
  entityFor: ReadonlyMap<string, string>,
  track: SampledTrack,
  newId: () => string = () => crypto.randomUUID(),
): ActualStartState {
  const predicted = new Map(plan.predictedEndState.map((p) => [p.id, p]));
  let observed = 0;
  const notObserved: ActualStartState["notObserved"] = [];

  const units: MapUnitPlacement[] = source.units.map((u) => {
    const samples = track.get(entityFor.get(u.id) ?? "");
    const last = samples?.[samples.length - 1];
    let lat = u.lat;
    let lng = u.lng;
    if (last) {
      lat = last.lat;
      lng = last.lon;
      observed++;
    } else if (predicted.has(u.id)) {
      lat = predicted.get(u.id)!.lat;
      lng = predicted.get(u.id)!.lng;
      notObserved.push({ label: u.label, from: "predicted" });
    } else {
      notObserved.push({ label: u.label, from: "start" });
    }
    return { ...u, id: newId(), lat, lng, role: "" };
  });

  return {
    state: {
      units,
      arrows: [],
      objectives: source.objectives.map((o) => ({ ...o, id: newId() })),
    },
    observed,
    notObserved,
  };
}

/** "Phase 1 — Secure the corridor" → "Phase 2"; anything else → "<name> (next)". */
export function nextPhaseName(sourceName: string): string {
  const m = sourceName.match(/^Phase\s+(\d+)/i);
  return m ? `Phase ${Number(m[1]) + 1}` : `${sourceName} (next)`;
}
