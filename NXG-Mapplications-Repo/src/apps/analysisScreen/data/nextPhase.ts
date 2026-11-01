// analysisScreen/data/nextPhase.ts
//
// Create the next phase from a run's ACTUAL end state — the OSDK half.
// lib/nextPhase.ts decides where everything starts; this writes it, in the
// order that never leaves a half-built phase pointing at another phase's
// units:
//
//   1. NxgPhase, based on the phase the run executed (createPhaseInOntology,
//      the planner's own write path)
//   2. the force: every placement's ORBAT copied into the new phase's own
//      hierarchy, each subtree re-laid around where its unit actually ended
//      (savePhaseOrbat — the same call the planner's Add phase makes)
//   3. NxgPhaseMapState, once, with the copied ORBAT links already on it
import { createNxgPPhaseMapState } from "@nxg-simulation-execution-testing/sdk";
import { client } from "@/client";
import { indexForest } from "@/shared/orbat/orbatLevels";
import { savePhaseOrbat } from "@/shared/orbat/phaseOrbat";
import { createPhaseInOntology } from "../../scenarioPlanner/lib/phaseActions";
import type { MapPhaseState } from "../../scenarioPlanner/phaseCreator/types";
import type { Phase } from "../../scenarioPlanner/shared/types";

export interface NextPhaseRequest {
  scenarioId: string;
  scenarioName: string;
  source: Phase;
  name: string;
  /** Sequence number for the new phase (after every existing one). */
  sequenceNumber: number;
  startState: MapPhaseState;
  onProgress?: (step: string) => void;
}

export interface NextPhaseResult {
  phaseId: string;
  phaseName: string;
  orbatUnits: number;
  withoutOrbat: string[];
}

export async function createNextPhaseFromRun(request: NextPhaseRequest): Promise<NextPhaseResult> {
  const { source } = request;
  const span = Math.max(1, source.endOffset - source.startOffset);

  request.onProgress?.("Creating the phase…");
  const phaseId = await createPhaseInOntology({
    scenarioId: request.scenarioId,
    name: request.name,
    status: "DRAFT",
    objective: `Continue from the observed end of "${source.name}".`,
    startOffset: source.endOffset,
    endOffset: source.endOffset + span,
    offsetUnit: source.offsetUnit,
    sequenceNumber: request.sequenceNumber,
    basedOnPhaseId: source.id,
  });

  request.onProgress?.("Carrying the force structure across…");
  const units = request.startState.units.map((u) => ({ ...u, templateId: u.templateId ?? "" }));
  let linked = new Map<string, string>();
  let hierarchyKey = "";
  let orbatUnits = 0;
  let withoutOrbat: string[] = [];
  if (units.some((u) => u.orbatRootUnitKey)) {
    const saved = await savePhaseOrbat(
      {
        scenarioId: request.scenarioId,
        scenarioName: request.scenarioName,
        phaseId,
        phaseName: request.name,
      },
      indexForest([]),
      units,
    );
    linked = new Map(saved.linked.map((l) => [l.placementId, l.rootUnitKey]));
    hierarchyKey = saved.hierarchyKey;
    orbatUnits = saved.clonedUnits;
    withoutOrbat = saved.withoutOrbat;
  }

  request.onProgress?.("Saving the start state…");
  const startState: MapPhaseState = {
    ...request.startState,
    units: request.startState.units.map((u) =>
      linked.has(u.id)
        ? {
            ...u,
            orbatRootUnitKey: linked.get(u.id),
            orbatHierarchyKey: hierarchyKey,
            orbatParentUnitKey: undefined,
          }
        : u,
    ),
  };
  await client(createNxgPPhaseMapState).applyAction({
    phaseId,
    startStateMapJson: JSON.stringify(startState),
  });

  return { phaseId, phaseName: request.name, orbatUnits, withoutOrbat };
}
