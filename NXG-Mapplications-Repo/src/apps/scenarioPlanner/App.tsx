import "./scenarioPlanner.layout.css";
import "./scenarioPlanner.components.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppNavigate } from "@/shared/hooks/useAppNavigate";
import { useWorkshopContext } from "@osdk/workshop-iframe-custom-widget";
import { PhaseTimeline } from "./components/PhaseTimeline/PhaseTimeline";
import {
  PhaseGraphHome,
  tracePath,
  furthestLeafId,
  furthestLeafThrough,
} from "./components/PhaseGraphHome/PhaseGraphHome";
import { PhaseDetail } from "./components/PhaseDetail/PhaseDetail";
import { MapWrapper, type MapWrapperHandle } from "./components/MapWrapper/MapWrapper";
import { usePhases } from "./hooks/usePhases";
import { usePhaseMapState } from "./hooks/usePhaseMapState";
import { useScenario } from "./hooks/useScenario";
import {
  useWorkshopObjectKey,
  type WorkshopObjectSetValue,
} from "../../shared/hooks/useWorkshopObjectKey";
// Right-hand tab data (TASKS / AUDIENCE / PMESII / OBJECTIVES / MEL-MIL).
// The hook loads all rows from the Plan-and-Prepare ontology catalogues
// once on mount; PhaseDetail filters them per-phase using either the
// id arrays on the phase (taskIds/audienceIds/pmesiiDomainIds/
// objectiveIds/injectIds) or the phaseId FK on each object.
import { usePhaseCatalogues } from "./hooks/usePhaseCatalogues";
import { DEFAULT_EXERCISE, DEFAULT_SCENARIO_ID, MOCK_EXERCISE } from "./shared/phaseColours";
import {
  describeActionError,
  resolveScenarioOrbat,
  sideForSidc,
} from "../../shared/orbat/scenarioOrbat";
import {
  requestOrbatDefinition,
  takeOrbatDefinitionResult,
} from "../../shared/orbat/defineHandoff";
import { useUnitOrbat } from "./hooks/useUnitOrbat";
import {
  buildOrbatSkeleton,
  countNodes,
  echelonForPlacedUnit,
} from "../../shared/orbat/skeleton";
import {
  isOrbatEligible,
  orbatIneligibleReason,
} from "../../shared/orbat/eligibility";
import { sideRootKeys } from "../../shared/orbat/reconcile";
import { echelonRank } from "../../shared/orbat/hierarchy";
import {
  type PositionMap,
  ancestorsOf,
  descendantsOf,
  dominantEchelonAt,
  effectivePosition,
  frontierAt,
  indexForest,
  translateSubtree,
} from "../../shared/orbat/orbatLevels";
import {
  isNativeToPhase,
  partitionPhasePlacements,
  phaseHierarchyKey,
} from "../../shared/orbat/phaseKeys";
import {
  type PhaseTarget,
  autoGeneratePhaseOrbat,
  changeParentInPhase,
  createDebouncedPhaseReconciler,
  generateBeneathNode,
  loadPhaseForest,
  moveOrbatUnits,
  placeUnitInPhase,
  removeSubtreeInPhase,
  savePhaseOrbat,
} from "../../shared/orbat/phaseOrbat";
import { parentCandidates } from "../../shared/orbat/placeIntoOrbat";
import { autoLevelForZoom } from "../../shared/orbat/ringLayout";
import { usePhaseOrbat } from "./hooks/usePhaseOrbat";
import type { OrbatLevelFeature } from "./map/orbatLevelLayer";
import {
  OrbatLevelControl,
  type OrbatLevelMode,
} from "./components/OrbatLevelControl/OrbatLevelControl";
import {
  PlaceUnitDialog,
  type PlaceUnitChoice,
} from "./components/PlaceUnitDialog/PlaceUnitDialog";
import { OrbatNodeMenu } from "./components/OrbatNodeMenu/OrbatNodeMenu";
import type { PlacedUnit as PlacedUnitType } from "./map/types";
import { resolveDocSidc } from "./shared/docSidc";
// Composition-tab / phase-sync services (DJ-Slate perf pass): parallel
// per-side LLM calls, in-memory TTL cache with single-flight dedupe.
// Consumed by `scheduleMapSync` (debounced writes on every map edit)
// and by the <PhaseDetail onPublishToOrbat> wiring further down.
import {
  syncPhaseMapState,
  type SyncPhaseMapStateParams,
} from "./phaseCreator/phaseMapStateService";
import type { ExerciseMeta, Phase } from "./shared/types";

import { client } from "../../client";
import { NxgInject, NxgPhase, NxgPmesiiDomain, NxgTask, NxgTrainingAudience, NxgTrainingObjective } from "@nxg-simulation-execution-testing/sdk";
import { SCENARIO_CONFIG } from "./scenarioConfig";
import { AddPhaseDialog, type AddPhaseResult } from "./components/AddPhaseDialog/AddPhaseDialog";
import { generateOrders, generateEndState } from "./phaseCreator/logicClient";
import type {
  UnitOrder,
  GenerateEndStateOutput,
  MapUnitPlacement,
  MapArrowPlacement,
  MapPhaseState,
} from "./phaseCreator/types";
import { DEFAULT_TIME_SCALE, formatPhaseWindow, phaseDurationHours } from "./shared/timeScale";
import { resolveToEndState } from "./phaseCreator/resolveOrders";
// Terrain-aware validation of AI-generated orders — see lib/orderReachability.
import { terrainForScenario } from "../../shared/routing/terrainDatasets";
import { useTerrainRaster } from "../../shared/routing/useTerrainRaster";
import { foundryFileClient } from "../../shared/routing/foundryFileClient";
import {
  buildReachabilityContext,
  checkStateOnLand,
  constrainOrdersToTerrain,
  summariseAdjustments,
  type OrderAdjustment,
} from "./lib/orderReachability";
import { resolveTacticSidc } from "@acc/app6d/core";
import { APP_CATALOG } from "./shared/appCatalog";

// createAndFetchTempObjectSetRid lives in the internal export of @osdk/client >= 2.0
// It accepts a client + an ObjectSet and returns a Promise<string> (the temp RID).
import { createAndFetchTempObjectSetRid } from "@osdk/client/internal";

/**
 * When true, the planner opens straight into the map for the branch that has
 * progressed furthest, rather than landing on the branch graph. The user can
 * still press "← BRANCHES" to go back and pick a different branch.
 *
 * Set to false to restore the previous graph-first landing behaviour.
 */
const AUTO_OPEN_FURTHEST_BRANCH = true;

// ── Phase-scoped catalogue resolution ─────────────────────────────────────────
//
// Resolves which catalogue rows belong to a phase, in this order:
//   1. Explicit id array on the Phase (Workshop / mock data).
//   2. The phaseId FK on the object (NxgTask / NxgTrainingObjective / NxgInject).
//   3. The whole (already scenario-filtered) catalogue — correct for
//      NxgTrainingAudience / NxgPmesiiDomain, which are scenario-scoped in the
//      ontology and carry no phaseId at all.
//
// This replaces the old `fetchLinkedObjectsForPhase` helper, which re-queried
// the ontology and returned nothing whenever the id arrays were empty — i.e.
// always, for phases loaded from NxgPhase. The catalogues are already in memory
// via usePhaseCatalogues, so no extra round-trip is needed.
function resolvePhaseScoped<T>(
  phaseId: string,
  ids: string[] | undefined,
  all: T[],
  idOf: (item: T) => string,
  phaseIdOf?: (item: T) => string | undefined,
): T[] {
  if (ids && ids.length > 0) return all.filter((item) => ids.includes(idOf(item)));
  if (phaseIdOf) {
    const byFk = all.filter((item) => phaseIdOf(item) === phaseId);
    if (byFk.length > 0) return byFk;
  }
  return all;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// loadedString used to read the six scalar Workshop inputs this widget no
// longer takes (phases, exercise name, current phase, nations, D-Day, phase
// id) — all of them now come from the scenario. Only the boolean reader is
// still needed; bring it back if a genuinely non-derivable string input ever
// appears.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadedBool(field: any): boolean | null {
  return field?.fieldValue?.status === "LOADED"
    ? (field.fieldValue.value as boolean) ?? null
    : null;
}

/**
 * Build a temporary object-set RID for a single NxgPhase by its phaseId,
 * then push it to the Workshop output variable.
 * Falls back silently if the OSDK call fails (e.g. dev / offline mode).
 */
/**
 * Build a temporary object-set RID for a single NxgTask by its taskId,
 * push it to the Workshop output variable, then fire the onTaskSelected event.
 */
async function pushTaskObjectSet(
  taskId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskField: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventField: any,
): Promise<void> {
  try {
    const taskObjectSet = client(NxgTask).where({ taskId });
    const taskRid = await createAndFetchTempObjectSetRid(client, taskObjectSet);
    taskField?.setLoadedValue?.(taskRid);
    eventField?.executeEvent?.(undefined);
  } catch (err) {
    console.warn("[ScenarioPlanWidget] Could not create temp task object-set RID:", err);
    taskField?.setFailedWithError?.("Failed to resolve task object set");
  }
}

/**
 * Build a temporary object-set RID for a single NxgTrainingAudience by its
 * audienceId, push it to the Workshop output variable, then fire the
 * onAudienceSelected event. Mirrors {@link pushTaskObjectSet}.
 */
async function pushAudienceObjectSet(
  audienceId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  audienceField: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventField: any,
): Promise<void> {
  try {
    const audienceObjectSet = client(NxgTrainingAudience).where({ audienceId });
    const audienceRid = await createAndFetchTempObjectSetRid(client, audienceObjectSet);
    audienceField?.setLoadedValue?.(audienceRid);
    eventField?.executeEvent?.(undefined);
  } catch (err) {
    console.warn(
      "[ScenarioPlanWidget] Could not create temp training audience object-set RID:",
      err,
    );
    audienceField?.setFailedWithError?.("Failed to resolve training audience object set");
  }
}

/**
 * Build a temporary object-set RID for a single NxgPmesiiDomain by its
 * domainId, push it to the Workshop output variable, then fire the
 * onPmesiiSelected event. Mirrors {@link pushTaskObjectSet} — the parent app
 * uses the RID to open the full PMESII widget on that domain.
 */
async function pushPmesiiObjectSet(
  domainId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  domainField: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventField: any,
): Promise<void> {
  try {
    const domainObjectSet = client(NxgPmesiiDomain).where({ domainId });
    const domainRid = await createAndFetchTempObjectSetRid(client, domainObjectSet);
    domainField?.setLoadedValue?.(domainRid);
    eventField?.executeEvent?.(undefined);
  } catch (err) {
    console.warn(
      "[ScenarioPlanWidget] Could not create temp PMESII domain object-set RID:",
      err,
    );
    domainField?.setFailedWithError?.("Failed to resolve PMESII domain object set");
  }
}

/**
 * Build a temporary object-set RID for a single NxgTrainingObjective by its
 * objectiveId, push it to the Workshop output variable, then fire the
 * onObjectiveSelected event. Mirrors {@link pushTaskObjectSet} — the parent
 * app uses the RID to open the full Task Management widget on that objective.
 */
async function pushObjectiveObjectSet(
  objectiveId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  objectiveField: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventField: any,
): Promise<void> {
  try {
    const objectiveObjectSet = client(NxgTrainingObjective).where({ objectiveId });
    const objectiveRid = await createAndFetchTempObjectSetRid(client, objectiveObjectSet);
    objectiveField?.setLoadedValue?.(objectiveRid);
    eventField?.executeEvent?.(undefined);
  } catch (err) {
    console.warn(
      "[ScenarioPlanWidget] Could not create temp training objective object-set RID:",
      err,
    );
    objectiveField?.setFailedWithError?.("Failed to resolve training objective object set");
  }
}

/**
 * Build a temporary object-set RID for a single NxgInject by its injectId,
 * push it to the Workshop output variable, then fire the onInjectSelected
 * event. Mirrors {@link pushTaskObjectSet} — the parent app uses the RID to
 * open the full MEL/MIL / Task Management widget on that inject.
 */
async function pushInjectObjectSet(
  injectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  injectField: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventField: any,
): Promise<void> {
  try {
    const injectObjectSet = client(NxgInject).where({ injectId });
    const injectRid = await createAndFetchTempObjectSetRid(client, injectObjectSet);
    injectField?.setLoadedValue?.(injectRid);
    eventField?.executeEvent?.(undefined);
  } catch (err) {
    console.warn(
      "[ScenarioPlanWidget] Could not create temp MEL/MIL inject object-set RID:",
      err,
    );
    injectField?.setFailedWithError?.("Failed to resolve MEL/MIL inject object set");
  }
}

/**
 * Push the selected phase to the Workshop output variable.
 *
 * Only the phase. The widget used to also push a selectedPhaseTasks object set
 * alongside it, but NxgPhase links to its tasks, so Workshop can traverse
 * phase → tasks itself — publishing it separately was a second copy of the
 * same fact that could go stale against the first.
 */
async function pushPhaseObjectSet(
  phaseId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  phaseField: any,
): Promise<void> {
  try {
    const phaseObjectSet = client(NxgPhase).where({ phaseId });
    const phaseRid = await createAndFetchTempObjectSetRid(client, phaseObjectSet);
    phaseField?.setLoadedValue?.(phaseRid);
  } catch (err) {
    // Not fatal — widget still works without Workshop wiring
    console.warn("[ScenarioPlanWidget] Could not create temp object-set RID:", err);
    phaseField?.setFailedWithError?.("Failed to resolve phase object set");
  }
}

/** A phase map-state unit as the ORBAT code sees a placement. */
function toPlacedUnit(u: MapUnitPlacement): PlacedUnitType {
  return {
    id: u.id,
    templateId: u.templateId ?? "",
    label: u.label,
    sidc: u.sidc,
    lat: u.lat,
    lng: u.lng,
    orbatRootUnitKey: u.orbatRootUnitKey,
    orbatHierarchyKey: u.orbatHierarchyKey,
    orbatIsBasic: u.orbatIsBasic,
    orbatParentUnitKey: u.orbatParentUnitKey,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScenarioPlanWidget() {
  const navigate = useAppNavigate();
  const workshopCtxAsync = useWorkshopContext(SCENARIO_CONFIG);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = workshopCtxAsync.status === "LOADED" ? (workshopCtxAsync.value as any) : null;

  // Ref into the MapWrapper for imperative actions (e.g. cloning a phase's
  // ORBAT items into a newly-created phase).
  const mapWrapperRef = useRef<MapWrapperHandle | null>(null);

  // ── Debounced Template Orbat Graph sync ──────────────────────────────────
  // After any map change (unit placed/moved/deleted, arrow drawn, etc.) we
  // debounce a sync to the [NXG-O] Template Orbat Graph ontology object so the
  // ontology always reflects the current planning picture.
  // Timer is per-phase so rapid edits to one phase don't flush another.
  const mapSyncTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function scheduleMapSync(phaseId: string, phaseName: string, phaseDesc: string, opName: string) {
    const existing = mapSyncTimers.current.get(phaseId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      mapSyncTimers.current.delete(phaseId);
      const state = mapWrapperRef.current?.readPhaseMapState(phaseId);
      if (!state) return;
      try {
        await syncPhaseMapState({ phaseId, phaseName, operationName: opName, phaseDescription: phaseDesc, startState: state });
        console.log(`[ScenarioPlanWidget] ✓ Synced map state for phase ${phaseId}`);
      } catch (err) {
        console.warn(`[ScenarioPlanWidget] Map state sync failed for phase ${phaseId}:`, err);
      }
    }, 1500);
    mapSyncTimers.current.set(phaseId, timer);
  }

  // ── Read inputs from Workshop ─────────────────────────────────────────────
  //
  // Just the two: the scenario (below) and how the widget is being used.
  // Phases, exercise name, current phase, nations and the D-Day label all come
  // from the scenario now — see scenarioConfig.ts for why.
  const readOnly = loadedBool(ctx?.readOnly) ?? false;

  // ── Scenario object set input ─────────────────────────────────────────────
  // Workshop delivers an objectSet variable as ObjectSetLocators (a list of
  // primary keys). We extract the value directly from the raw context field
  // value — the Workshop context types this as ObjectSetLocators when the
  // variable type is "objectSet".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scenarioLocatorRaw = ctx?.scenario?.fieldValue?.status === "LOADED"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (ctx.scenario.fieldValue.value as any)
    : undefined;

  // useScenario fetches the NxgScenario + its linked NxgPhases when a valid
  // primary key is present in the locator. Returns null when unset/loading.
  const { scenarioMeta, ontologyPhases, reload: reloadScenario } = useScenario(scenarioLocatorRaw);

  // ── Inbound phase selection ───────────────────────────────────────────────
  // selectedPhase is bidirectional: Workshop writes it to deep-link the widget
  // onto a phase, and the widget writes it back on every selection. Reading the
  // single phase out of it replaces the separate selectedPhaseId string input,
  // which said the same thing in a weaker type. The field is declared as a
  // temporaryObjectSetRid, so Workshop sends a RID string — the old reader
  // only understood primary-key locators and dropped every RID it was given.
  const selectedPhaseRaw: WorkshopObjectSetValue =
    ctx?.selectedPhase?.fieldValue?.status === "LOADED"
      ? (ctx.selectedPhase.fieldValue.value as WorkshopObjectSetValue)
      : undefined;
  const selectedPhaseIdParam: string | undefined =
    useWorkshopObjectKey(selectedPhaseRaw, NxgPhase).primaryKey ?? undefined;

  // ── Phases ────────────────────────────────────────────────────────────────
  // Phases come from the scenario, full stop. ontologyPhases holds the NxgPhase
  // objects linked to it, serialised into the JSON shape usePhases understands;
  // MOCK_PHASES remain the fallback when no scenario resolves.
  //
  // There used to be a phasesJson Workshop override in front of this, which
  // meant a module could hand the widget a set of phases that had nothing to do
  // with the scenario it was showing. Phases are ontology objects — anything
  // wanting to change them should write NxgPhase, which usePhases already does.
  const resolvedPhasesParam = useMemo(() => {
    if (ontologyPhases && ontologyPhases.length > 0) {
      return JSON.stringify(ontologyPhases);
    }
    return undefined;
  }, [ontologyPhases]);

  // ── Phase state ───────────────────────────────────────────────────────────
  const { usingMockPhases, phases, branchesBySource, getBranchSiblings, selectedPhaseId, selectedPhase, selectPhase, createPhase, forkPhase, updatePhase, deletePhase, mutationError, clearMutationError } =
    usePhases({
      phasesParam: resolvedPhasesParam,
      selectedPhaseIdParam,
      // Phase mutations are persisted to [NXG-P] Phase. Without a scenario id
      // they cannot be — usePhases refuses the write and says why.
      scenarioId: scenarioMeta?.scenarioId,
      // Converge on server state after every successful write.
      onPersisted: reloadScenario,
      onPhaseSelected: () => {
        // The selectedPhase object set is pushed by the effect below, which
        // owns that variable in both directions. Here we only fire the event.
        ctx?.onPhaseSelected?.executeEvent?.(undefined);
      },
      // Phase writes go to NxgPhase (usePhases persists them) and the widget
      // then reloads from the ontology, so there is nothing to mirror into a
      // Workshop JSON variable. Downstream readers should query NxgPhase.
    });

  const selectedPhaseIndex = selectedPhaseId
    ? phases.findIndex((p) => p.id === selectedPhaseId)
    : -1;

  // ── Exercise metadata ─────────────────────────────────────────────────────
  // Precedence: live NxgScenario → Workshop string inputs → fallback defaults.
  // The fallback set now matches the data actually in use: MOCK_EXERCISE
  // (IRON FORGE 26) when the mock phases are showing, DEFAULT_EXERCISE
  // (NEXGEN 2026 — DEFAULT_SCENARIO_ID) otherwise. Previously it always said
  // IRON FORGE 26 / Poland even though useScenario loaded the NEXGEN scenario.
  const fallbackExercise = usingMockPhases ? MOCK_EXERCISE : DEFAULT_EXERCISE;
  const exercise: ExerciseMeta = {
    exerciseName:      scenarioMeta?.scenarioName  || fallbackExercise.exerciseName,
    currentPhaseLabel: scenarioMeta?.currentPhase  || fallbackExercise.currentPhaseLabel,
    dDayOffset:        scenarioMeta?.dDayOffset    || fallbackExercise.dDayOffset,
    nations:           scenarioMeta?.nations?.length ? scenarioMeta.nations : fallbackExercise.nations,
  };

  // ── Graph home vs map view ──────────────────────────────────────────────
  // null → show graph home (landing page). string → show map for that branch.
  const [viewingBranchLeaf, setViewingBranchLeaf] = useState<string | null>(null);

  // The linear path from root to the selected leaf — used for the bottom
  // timeline bar and phase filtering in map view.
  const branchPath = useMemo(
    () => (viewingBranchLeaf ? tracePath(phases, viewingBranchLeaf) : []),
    [viewingBranchLeaf, phases],
  );

  // ── Open straight into the map on first load ──────────────────────────────
  // The landing page used to be the branch graph, so the map — the thing people
  // actually want to see — was always one click away. On the first load where
  // phases are available we now jump directly to the map for the branch that
  // has progressed furthest (see furthestLeafId: longest path, then furthest
  // endOffset, then id for stability).
  //
  // This runs at most once, guarded by the ref. Pressing "← BRANCHES" returns to
  // the graph and stays there, so the user is never snapped forward again and
  // can pick a different branch freely.
  //
  // Set AUTO_OPEN_FURTHEST_BRANCH (module scope, above) to false to restore the
  // old graph-first landing behaviour.
  const didAutoOpenMapRef = useRef(false);

  useEffect(() => {
    if (!AUTO_OPEN_FURTHEST_BRANCH) return;
    if (didAutoOpenMapRef.current) return;
    if (phases.length === 0) return;

    // An inbound selectedPhaseId (passed by Workshop) wins: open the furthest
    // branch that actually runs through that phase and keep that phase selected,
    // rather than dragging the user onto an unrelated branch.
    const inboundPhaseId =
      selectedPhaseIdParam && phases.some((p) => p.id === selectedPhaseIdParam)
        ? selectedPhaseIdParam
        : undefined;

    const leafId = inboundPhaseId
      ? furthestLeafThrough(phases, inboundPhaseId) ?? furthestLeafId(phases)
      : furthestLeafId(phases);

    if (!leafId) return;

    didAutoOpenMapRef.current = true;
    setViewingBranchLeaf(leafId);
    selectPhase(inboundPhaseId ?? leafId);
  }, [phases, selectedPhaseIdParam, selectPhase]);

  // The effective phase shown on the map is always the selected phase.
  const effectivePhaseId = selectedPhaseId;
  const effectivePhaseIndex = selectedPhaseIndex;

  // Duration of the selected phase in simulated hours. Drives the map's
  // End State resolution and the terrain reachability time budget.
  const selectedPhaseDurationHours = useMemo(() => {
    if (!selectedPhase) return DEFAULT_TIME_SCALE.hoursPerDayOffset * 2;
    // Honours the phase's offset unit — NEXGEN phases are H+n (hours),
    // IRON FORGE phases are D+n (days).
    const hours = phaseDurationHours(selectedPhase);
    // A zero-length phase would make every order infeasible and collapse the
    // isochrone to a point — fall back to a single day.
    return hours > 0 ? hours : DEFAULT_TIME_SCALE.hoursPerDayOffset;
  }, [selectedPhase]);

  // Handle fork — create a branch alternative from an existing phase and
  // seed the new branch's map state from the source phase.
  // handleForkPhase needs handlePhaseMapEdited, which is declared further down
  // this component. Rather than reorder several hundred lines, it calls through
  // a ref that is assigned as soon as that callback exists.
  const handlePhaseMapEditedRef = useRef<
    ((phaseId: string, state: MapPhaseState) => void) | null
  >(null);

  const handleForkPhase = useCallback(
    async (sourcePhaseId: string) => {
      const source = phases.find((p) => p.id === sourcePhaseId);
      if (!source) return;
      // Awaited: forkPhase writes the branch to the ontology and returns it
      // with the ontology-assigned phaseId. Everything below keys off that id
      // (map state, selection, branch leaf), so using a locally-minted id here
      // would write map state against a phase that does not exist — which is
      // what used to happen, and why forked branches vanished on reload.
      let branchPhase: Phase;
      try {
        branchPhase = await forkPhase(sourcePhaseId, {
          name: `${source.name} — Branch`,
          objective: source.objective,
          startOffset: source.startOffset,
          endOffset: source.endOffset,
          status: "DRAFT",
        });
      } catch {
        // usePhases has already surfaced the reason through mutationError.
        return;
      }

      // Seed map state from the source phase. Units/arrows/objectives get FRESH
      // ids so the branch doesn't share ids with the phase it forked from — the
      // map keys its markers by unit id, and duplicate ids across phases make a
      // marker report the wrong phase on click.
      const sourceState = mapWrapperRef.current?.readPhaseMapState(sourcePhaseId);
      if (sourceState) {
        const unitIdMap = new Map<string, string>();
        for (const u of sourceState.units) unitIdMap.set(u.id, crypto.randomUUID());
        const objectiveIdMap = new Map<string, string>();
        for (const o of sourceState.objectives) objectiveIdMap.set(o.id, crypto.randomUUID());

        const seededState = {
          units: sourceState.units.map((u) => ({ ...u, id: unitIdMap.get(u.id)! })),
          objectives: sourceState.objectives.map((o) => ({
            ...o,
            id: objectiveIdMap.get(o.id)!,
          })),
          // Re-point the order arrows at the re-ided units / objectives so the
          // branch's orders stay wired up.
          arrows: sourceState.arrows.map((a) => ({
            ...a,
            id: crypto.randomUUID(),
            assignedUnitId: a.assignedUnitId
              ? unitIdMap.get(a.assignedUnitId) ?? a.assignedUnitId
              : undefined,
            targetObjectiveId: a.targetObjectiveId
              ? objectiveIdMap.get(a.targetObjectiveId) ?? a.targetObjectiveId
              : undefined,
          })),
        };

        const sourceIdx = phases.findIndex((p) => p.id === sourcePhaseId);
        // Mark as applied BEFORE applyPhaseMapState so the usePhaseMapState
        // effect (which re-runs once phaseIds changes) doesn't immediately
        // overwrite the seeded units with an empty fallback state.
        appliedPhasesRef.current.add(branchPhase.id);
        mapWrapperRef.current?.applyPhaseMapState(
          branchPhase.id,
          seededState,
          sourceIdx >= 0 ? sourceIdx : 0,
        );
        // Persist the seeded lay-down. Previously the branch's map state only
        // ever existed in memory, so even once the phase itself was saved the
        // branch would come back empty.
        handlePhaseMapEditedRef.current?.(branchPhase.id, seededState);
      }

      // Auto-select the new branch
      selectPhase(branchPhase.id);

      // If we're in map view, the new branch is now the leaf being viewed —
      // otherwise the bottom timeline (which walks ancestors of
      // viewingBranchLeaf) would keep showing the old branch and omit it.
      setViewingBranchLeaf((current) => (current ? branchPhase.id : current));
    },
    [forkPhase, phases, selectPhase],
  );

  // ── Terrain data ──────────────────────────────────────────────────────────
  // Same singleton the map uses. Needed here to (a) keep demo placements on
  // solid ground when a phase's map state is loaded and (b) route AI-generated
  // orders on the terrain grid before they are applied.
  // Terrain follows the scenario: BALTIC SHIELD is fought around Kaliningrad,
  // NEXGEN on the Narva corridor, and routing on the wrong one is confident
  // nonsense rather than an error (see shared/routing/terrainDatasets.ts).
  const terrain = useMemo(
    () => terrainForScenario(scenarioMeta?.scenarioId ?? DEFAULT_SCENARIO_ID),
    [scenarioMeta?.scenarioId],
  );
  const { raster: terrainRaster } = useTerrainRaster(foundryFileClient, terrain.rasterRid);

  // ── Phase map state from Ontology ─────────────────────────────────────────
  const phaseIds = useMemo(() => phases.map((p) => p.id), [phases]);
  const { phaseMapData, saveStartState, saveEndState } = usePhaseMapState(phaseIds);

  // ── Right-hand tab catalogues from Ontology ───────────────────────────────
  // Loads NxgTask, NxgTrainingAudience, NxgPmesiiDomain, NxgTrainingObjective
  // and NxgInject — scoped to the active scenario when one is wired in, or
  // unfiltered as a dev/offline fallback.
  const {
    tasks: allTasksFromOntology,
    audiences: allAudiencesFromOntology,
    pmesiiDomains: allPmesiiFromOntology,
    objectives: allObjectivesFromOntology,
    injects: allInjectsFromOntology,
  } = usePhaseCatalogues(scenarioMeta?.scenarioId);

  // Whenever Ontology data loads for a phase, push it onto the map.
  // We only do this once per phase (tracked via a ref) so manual edits
  // made after initial load are not overwritten by a re-render.
  const appliedPhasesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const [phaseId, data] of Object.entries(phaseMapData)) {
      if (appliedPhasesRef.current.has(phaseId)) continue;
      if (!data.startState) continue;
      const phaseIndex = phases.findIndex((p) => p.id === phaseId);

      // ── Placement sanity check (report only) ────────────────────────────
      // Positions are never moved behind the planner's back — the demo
      // lay-down in shared/scenarioData.ts is authored on real Narva-corridor
      // ground, so anything landing on water is a data bug worth seeing.
      const startState = data.startState;
      const offLand = checkStateOnLand(terrainRaster, startState);
      if (offLand.length > 0) {
        console.warn(
          `[ScenarioPlanWidget] ${offLand.length} placement(s) for ${phaseId} are on impassable terrain (${data.source} data):`,
          offLand.map((m) => `${m.kind} "${m.label}"`).join(", "),
        );
      }

      mapWrapperRef.current?.applyPhaseMapState(phaseId, startState, phaseIndex >= 0 ? phaseIndex : 0);
      appliedPhasesRef.current.add(phaseId);

      // Derive UnitOrder objects from map arrows so they display in the Orders tab.
      // Only populate if no AI-generated orders exist for this phase yet.
      const arrows = startState.arrows;
      if (arrows && arrows.length > 0) {
        setPhaseOrders((prev) => {
          if (prev[phaseId] && prev[phaseId].length > 0) return prev;
          const derived: UnitOrder[] = arrows
            .filter((a) => a.assignedUnitId)
            .map((arrow) => ({
              unitId: arrow.assignedUnitId!,
              taskName: arrow.tacticLabel ?? "move",
              toLat: arrow.toLat,
              toLng: arrow.toLng,
              rationale: `Loaded from map — ${arrow.tacticLabel ?? "movement"} order.`,
              targetObjectiveId: arrow.targetObjectiveId ?? "",
            }));
          if (derived.length === 0) return prev;
          return { ...prev, [phaseId]: derived };
        });
      }
    }
  }, [phaseMapData, phases, terrainRaster]);

  // ── Phase ORBAT ───────────────────────────────────────────────────────────
  // Each phase owns its ORBAT: hier-{scenario}--{phase}, with its own copies of
  // its units, each positioned for that phase (CSE spawns from NxgUnit
  // lat/lng). See shared/orbat/phaseKeys.ts and docs/PHASE_ORBAT_PLAN.md. The
  // phase ORBAT is the source of truth for what the level view draws.

  const scenarioIdForOrbat = scenarioMeta?.scenarioId ?? DEFAULT_SCENARIO_ID;
  const phaseTarget: PhaseTarget | null = useMemo(
    () =>
      selectedPhase
        ? {
            scenarioId: scenarioIdForOrbat,
            scenarioName: exercise.exerciseName,
            phaseId: selectedPhase.id,
            phaseName: selectedPhase.name,
          }
        : null,
    [scenarioIdForOrbat, exercise.exerciseName, selectedPhase],
  );
  const phaseHierKey = phaseTarget
    ? phaseHierarchyKey(phaseTarget.scenarioId, phaseTarget.phaseId)
    : null;
  const phaseOrbat = usePhaseOrbat(
    viewingBranchLeaf ? phaseHierKey : null,
    phaseTarget?.phaseId ?? null,
  );
  const orbatIndex = phaseOrbat.index;
  const hasPhaseOrbat = !!orbatIndex && orbatIndex.nodes.size > 0;
  const { reload: reloadPhaseOrbat, applyMoves, revertMoves } = phaseOrbat;

  // Refs for callbacks fired from the map, which must see the latest values.
  const orbatIndexRef = useRef(orbatIndex);
  orbatIndexRef.current = orbatIndex;
  const phaseTargetRef = useRef(phaseTarget);
  phaseTargetRef.current = phaseTarget;

  /** One status line for every phase ORBAT action — also shown in the ORBAT tab. */
  const [orbatStatus, setOrbatStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const reportOrbat = useCallback((text: string, error = false) => {
    setOrbatStatus({ text, error });
  }, []);
  useEffect(() => {
    if (!orbatStatus) return;
    const t = setTimeout(() => setOrbatStatus(null), orbatStatus.error ? 15000 : 8000);
    return () => clearTimeout(t);
  }, [orbatStatus]);
  const reconcileStatus = orbatStatus?.text ?? null;

  /** The selected phase's placements, from the map. */
  const phasePlacements = useCallback((): PlacedUnitType[] => {
    if (!selectedPhaseId) return [];
    return (mapWrapperRef.current?.readPhaseMapState(selectedPhaseId)?.units ?? []).map(
      toPlacedUnit,
    );
  }, [selectedPhaseId]);

  /** Every placement in the scenario — only the legacy scenario-wide links still use this. */
  const collectScenarioPlacements = useCallback((): PlacedUnitType[] => {
    const handle = mapWrapperRef.current;
    if (!handle) return [];
    return phaseIds.flatMap((phaseId) =>
      (handle.readPhaseMapState(phaseId)?.units ?? []).map(toPlacedUnit),
    );
  }, [phaseIds]);

  // ── Level view ────────────────────────────────────────────────────────────
  const [levelMode, setLevelMode] = useState<OrbatLevelMode>({ kind: "auto" });
  const [mapView, setMapView] = useState({ zoom: 8, lat: 54.7 });
  const handleViewChange = useCallback((zoom: number, lat: number) => {
    setMapView((prev) => (prev.zoom === zoom && prev.lat === lat ? prev : { zoom, lat }));
  }, []);
  const autoLevel = orbatIndex
    ? autoLevelForZoom(mapView.zoom, mapView.lat, Math.max(0, orbatIndex.maxDepth))
    : 0;
  const activeLevel =
    !hasPhaseOrbat || levelMode.kind === "units"
      ? null
      : levelMode.kind === "auto"
        ? autoLevel
        : Math.min(levelMode.level, orbatIndex!.maxDepth);
  const [selectedOrbatKey, setSelectedOrbatKey] = useState<string | null>(null);
  /** Bumped to make the layer redraw from the index (e.g. after a refused drag). */
  const [layerVersion, setLayerVersion] = useState(0);

  const orbatLevelNodes = useMemo((): OrbatLevelFeature[] | null => {
    void layerVersion;
    if (activeLevel === null || !orbatIndex) return null;
    const out: OrbatLevelFeature[] = [];
    for (const node of frontierAt(orbatIndex, activeLevel)) {
      const pos = effectivePosition(orbatIndex, node.key);
      if (!pos) continue;
      out.push({
        key: node.key,
        label: node.label,
        sidc: node.sidc,
        lat: pos.lat,
        lng: pos.lng,
        selected: node.key === selectedOrbatKey,
      });
    }
    return out;
  }, [activeLevel, orbatIndex, selectedOrbatKey, layerVersion]);

  // While the level view is on, the tree is what is drawn: a placement whose
  // unit is in the tree (and drawable) is hidden, so nothing appears twice.
  const hiddenOrbatKeys = useMemo(() => {
    if (!orbatLevelNodes || !orbatIndex) return undefined;
    const keys = new Set<string>();
    for (const key of orbatIndex.nodes.keys()) {
      if (effectivePosition(orbatIndex, key)) keys.add(key);
    }
    return keys;
  }, [orbatLevelNodes, orbatIndex]);

  const levelInfos = useMemo(
    () =>
      orbatIndex && hasPhaseOrbat
        ? orbatIndex.levels.map((_, level) => ({
            level,
            count: frontierAt(orbatIndex, level).length,
            echelon: dominantEchelonAt(orbatIndex, level),
          }))
        : [],
    [orbatIndex, hasPhaseOrbat],
  );

  // ── Parentage reconcile after map edits (phase-scoped, debounced) ────────
  const phaseReconcilerRef = useRef(createDebouncedPhaseReconciler());
  useEffect(() => {
    const reconciler = phaseReconcilerRef.current;
    return () => reconciler.cancel();
  }, []);

  const schedulePhaseReconcile = useCallback(
    (phaseId: string, state: MapPhaseState) => {
      if (readOnly) return;
      const target = phaseTargetRef.current;
      const index = orbatIndexRef.current;
      if (!target || target.phaseId !== phaseId || !index) return;
      phaseReconcilerRef.current.schedule({
        target,
        index,
        placements: state.units.map(toPlacedUnit),
      });
    },
    [readOnly],
  );

  // ── Persist map edits back to [NXG-P] Phase Map State ─────────────────────
  // MapWrapper debounces this callback, so one write lands per burst of edits.
  // Without it everything a planner drew was lost on reload — the hook exposed
  // saveStartState but nothing ever called it.
  const handlePhaseMapEdited = useCallback(
    (phaseId: string, state: MapPhaseState) => {
      // This state is now the ontology truth, so the load effect above must
      // not re-apply an older snapshot over the top of it.
      appliedPhasesRef.current.add(phaseId);
      void saveStartState(phaseId, state).catch((err) => {
        console.warn(
          `[ScenarioPlanWidget] Failed to persist start state for ${phaseId}:`,
          err,
        );
      });
      // Placement, deletion and inheritance in one place. The reconciler only
      // touches units native to the phase that are currently roots, debounces,
      // and skips an unchanged payload.
      schedulePhaseReconcile(phaseId, state);
    },
    [saveStartState, schedulePhaseReconcile],
  );
  handlePhaseMapEditedRef.current = handlePhaseMapEdited;

  /** Persist a phase's map state on the next tick, once a setState has landed. */
  const persistPhaseSoon = useCallback(
    (phaseId: string) => {
      setTimeout(() => {
        const snapshot = mapWrapperRef.current?.readPhaseMapState(phaseId);
        if (snapshot) handlePhaseMapEdited(phaseId, snapshot);
      }, 0);
    },
    [handlePhaseMapEdited],
  );

  // ── Define ORBAT for a placed unit ────────────────────────────────────────
  // NOTHING is written to the ontology here. "Define ORBAT" hands the
  // placement to the ORBAT screen, which seeds a DRAFT from the unit's type;
  // the graph is created only when the planner confirms it there, and this app
  // then links the placement (clearing the red "!").
  const [orbatBusyUnitId, setOrbatBusyUnitId] = useState<string | null>(null);
  /** Last ORBAT creation failure, shown in the ORBAT tab. */
  const [orbatError, setOrbatError] = useState<string | null>(null);
  /** Unit currently selected on the map — drives the ORBAT tab. */
  const [selectedMapUnit, setSelectedMapUnit] = useState<PlacedUnitType | null>(null);
  const selectedUnitOrbat = useUnitOrbat(
    selectedMapUnit?.orbatHierarchyKey,
    selectedMapUnit?.orbatRootUnitKey,
  );

  // Placing a unit no longer writes a basic ORBAT behind the planner's back:
  // a phase ORBAT is built deliberately — Place unit (with or without
  // "Generate ORBAT beneath"), right-click → Auto-generate ORBAT, or Generate
  // missing ORBATs. Until then the panel previews the basic one.
  const basicOrbat = useMemo(() => {
    if (!selectedMapUnit || selectedMapUnit.orbatRootUnitKey) return null;
    if (!isOrbatEligible(selectedMapUnit)) return null;
    const root = buildOrbatSkeleton(selectedMapUnit, { depth: 2 });
    return { root, nodeCount: countNodes(root) };
  }, [selectedMapUnit]);

  /** Why the selected unit has no ORBAT at all, when that's by design. */
  const selectedUnitOrbatNotApplicable = useMemo(
    () => (selectedMapUnit ? orbatIneligibleReason(selectedMapUnit) : null),
    [selectedMapUnit],
  );

  // ── Place unit (into the phase tree) ──────────────────────────────────────
  const [placeDialog, setPlaceDialog] = useState<{ lat: number; lng: number } | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const lastPlacedSideRef = useRef<"friend" | "hostile">("friend");

  const openPlaceDialog = useCallback((lat: number, lng: number) => {
    setPlaceError(null);
    setPlaceDialog({ lat, lng });
  }, []);

  const handlePlaceOrbatUnit = useCallback(
    async (choice: PlaceUnitChoice) => {
      const target = phaseTargetRef.current;
      if (!placeDialog || !target) return;
      setPlaceBusy(true);
      setPlaceError(null);
      try {
        const index = orbatIndexRef.current ?? indexForest([]);
        const result = await placeUnitInPhase(target, index, {
          spec: { label: choice.label, sidc: choice.sidc, templateId: choice.templateId },
          lat: placeDialog.lat,
          lng: placeDialog.lng,
          generateBeneath: choice.generateBeneath,
        });
        lastPlacedSideRef.current = choice.sidc[1] === "H" ? "hostile" : "friend";
        // A linked placement, so orders and end state work on it like any unit.
        mapWrapperRef.current?.placeOrbatUnit(target.phaseId, {
          label: choice.label,
          sidc: choice.sidc,
          templateId: choice.templateId,
          lat: placeDialog.lat,
          lng: placeDialog.lng,
          orbatRootUnitKey: result.rootUnitKey,
          orbatHierarchyKey: result.hierarchyKey,
        });
        await reloadPhaseOrbat();
        setLevelMode({ kind: "level", level: result.level });
        setSelectedOrbatKey(result.rootUnitKey);
        setPlaceDialog(null);
        const parentLabel = result.parentKey
          ? index.nodes.get(result.parentKey)?.label ?? "its superior"
          : null;
        reportOrbat(
          `Placed "${choice.label}" ${parentLabel ? `under "${parentLabel}"` : "as a top-level unit"}` +
            (result.adopted.length > 0
              ? `, taking command of ${result.adopted.length} unit${result.adopted.length === 1 ? "" : "s"}`
              : "") +
            (choice.generateBeneath
              ? ` — ${result.unitCount} units` +
                (result.truncated ? ` (stopped at the ${result.cap}-unit cap for its echelon)` : "")
              : "") +
            ".",
        );
      } catch (err) {
        setPlaceError(err instanceof Error ? err.message : describeActionError(err));
      } finally {
        setPlaceBusy(false);
      }
    },
    [placeDialog, reloadPhaseOrbat, reportOrbat],
  );

  // ── Moves ─────────────────────────────────────────────────────────────────
  /** Persist moves of native units; on failure, undo them everywhere. */
  const commitOrbatMoves = useCallback(
    async (moves: PositionMap, previous: PositionMap, what: string) => {
      applyMoves(moves);
      mapWrapperRef.current?.moveOrbatLinkedUnits(moves);
      try {
        await moveOrbatUnits(moves);
      } catch (err) {
        revertMoves(moves.keys());
        mapWrapperRef.current?.moveOrbatLinkedUnits(previous);
        reportOrbat(
          `Could not move ${what} — it has been put back. ${err instanceof Error ? err.message : describeActionError(err)}`,
          true,
        );
      }
    },
    [applyMoves, revertMoves, reportOrbat],
  );

  /** Level view: a dragged unit takes its whole subtree with it. */
  const handleOrbatNodeMoved = useCallback(
    (key: string, lat: number, lng: number) => {
      const index = orbatIndexRef.current;
      const target = phaseTargetRef.current;
      if (!index || !target) return;
      if (!isNativeToPhase(key, target.phaseId)) {
        setLayerVersion((v) => v + 1);
        reportOrbat(
          "That unit's ORBAT belongs to another phase. Save this phase's ORBAT first, then move it.",
          true,
        );
        return;
      }
      const moves = translateSubtree(index, key, { lat, lng });
      const previous: PositionMap = new Map();
      for (const k of moves.keys()) {
        const p = effectivePosition(index, k);
        if (p) previous.set(k, p);
      }
      void commitOrbatMoves(moves, previous, `"${index.nodes.get(key)?.label ?? "unit"}"`);
    },
    [commitOrbatMoves, reportOrbat],
  );

  /** Units view: dragging a placed unit with a native ORBAT moves its tree too. */
  const handlePlacementMoved = useCallback(
    (unit: PlacedUnitType, lat: number, lng: number) => {
      const index = orbatIndexRef.current;
      const target = phaseTargetRef.current;
      const key = unit.orbatRootUnitKey;
      if (!index || !target || !key || !index.nodes.has(key)) return;
      if (!isNativeToPhase(key, target.phaseId)) return;
      const moves = translateSubtree(index, key, { lat, lng });
      const previous: PositionMap = new Map();
      for (const k of moves.keys()) {
        const p = effectivePosition(index, k);
        if (p) previous.set(k, p);
      }
      applyMoves(moves);
      moveOrbatUnits(moves).catch((err) => {
        revertMoves(moves.keys());
        reportOrbat(
          `Could not move "${unit.label}"'s ORBAT. ${err instanceof Error ? err.message : describeActionError(err)}`,
          true,
        );
      });
    },
    [applyMoves, revertMoves, reportOrbat],
  );

  // ── Orders follow the chain of command ────────────────────────────────────
  const orderGuard = useCallback(
    (unit: PlacedUnitType): string | null => {
      const index = orbatIndexRef.current;
      const key = unit.orbatRootUnitKey;
      if (!index || !key || !index.nodes.has(key) || !selectedPhaseId) return null;
      const state = mapWrapperRef.current?.readPhaseMapState(selectedPhaseId);
      if (!state) return null;
      const keyOfPlacement = new Map(state.units.map((u) => [u.id, u.orbatRootUnitKey]));
      const ordered = new Set<string>();
      for (const arrow of state.arrows) {
        if (!arrow.assignedUnitId) continue;
        const k = keyOfPlacement.get(arrow.assignedUnitId);
        if (k && k !== key) ordered.add(k);
      }
      const superior = ancestorsOf(index, key).find((k) => ordered.has(k));
      if (superior) {
        return `"${unit.label}" inherits the order on "${index.nodes.get(superior)?.label ?? superior}".`;
      }
      const subordinates = descendantsOf(index, key).filter((k) => ordered.has(k));
      if (subordinates.length > 0) {
        return (
          `${subordinates.length} of "${unit.label}"'s subordinate${subordinates.length === 1 ? " has an order" : "s have orders"}` +
          " — remove theirs first."
        );
      }
      return null;
    },
    [selectedPhaseId],
  );

  // ── Level-view right-click menu ───────────────────────────────────────────
  const [nodeMenu, setNodeMenu] = useState<{ key: string; client: { x: number; y: number } } | null>(
    null,
  );
  const [nodeBusy, setNodeBusy] = useState(false);

  const runOrbatAction = useCallback(
    async (failurePrefix: string, action: () => Promise<string>) => {
      setNodeBusy(true);
      try {
        const message = await action();
        await reloadPhaseOrbat();
        reportOrbat(message);
      } catch (err) {
        reportOrbat(
          `${failurePrefix} ${err instanceof Error ? err.message : describeActionError(err)}`,
          true,
        );
      } finally {
        setNodeBusy(false);
      }
    },
    [reloadPhaseOrbat, reportOrbat],
  );

  const capNote = (r: { truncated: boolean; cap: number }) =>
    r.truncated ? ` (stopped at the ${r.cap}-unit cap for its echelon)` : "";

  /** Re-parent in the phase tree, and keep the placement's override in step. */
  const changeOrbatParent = useCallback(
    (key: string, parentKey: string | null) => {
      const target = phaseTargetRef.current;
      const index = orbatIndexRef.current;
      if (!target || !index) return;
      const label = index.nodes.get(key)?.label ?? "Unit";
      void runOrbatAction("Could not change the parent.", async () => {
        if (!isNativeToPhase(key, target.phaseId)) {
          throw new Error("That unit belongs to another phase — save this phase's ORBAT first.");
        }
        await changeParentInPhase(target, index, key, parentKey);
        // A planner override on the placement would otherwise be re-applied
        // by the reconciler over the choice just made.
        const placement = phasePlacements().find((u) => u.orbatRootUnitKey === key);
        if (placement) {
          mapWrapperRef.current?.setUnitParent(placement.id, parentKey);
          persistPhaseSoon(target.phaseId);
        }
        return parentKey
          ? `"${label}" now reports to "${index.nodes.get(parentKey)?.label ?? parentKey}".`
          : `"${label}" is now a top-level unit.`;
      });
    },
    [runOrbatAction, phasePlacements, persistPhaseSoon],
  );

  // ── Auto-generate (placed unit) and Generate missing (whole phase) ────────
  const handleAutoGenerateOrbat = useCallback(
    (unit: PlacedUnitType) => {
      const target = phaseTargetRef.current;
      if (!target) return;
      setOrbatBusyUnitId(unit.id);
      reportOrbat(`Generating an ORBAT for "${unit.label}"…`);
      void runOrbatAction(`Could not generate an ORBAT for "${unit.label}".`, async () => {
        try {
          const index = orbatIndexRef.current ?? indexForest([]);
          const key = unit.orbatRootUnitKey;
          if (key && isNativeToPhase(key, target.phaseId) && index.nodes.has(key)) {
            if ((index.childrenOf.get(key)?.length ?? 0) > 0) {
              throw new Error("It already has an ORBAT in this phase.");
            }
            const r = await generateBeneathNode(target, index, key);
            return `Generated ${r.unitCount} units beneath "${unit.label}"${capNote(r)}.`;
          }
          const r = await autoGeneratePhaseOrbat(target, index, unit);
          mapWrapperRef.current?.setUnitOrbat(unit.id, {
            orbatRootUnitKey: r.rootUnitKey,
            orbatHierarchyKey: r.hierarchyKey,
            orbatIsBasic: false,
          });
          setSelectedMapUnit((prev) =>
            prev && prev.id === unit.id
              ? { ...prev, orbatRootUnitKey: r.rootUnitKey, orbatHierarchyKey: r.hierarchyKey, orbatIsBasic: false }
              : prev,
          );
          persistPhaseSoon(target.phaseId);
          return `Generated an ORBAT for "${unit.label}" — ${r.unitCount} units${capNote(r)}.`;
        } finally {
          setOrbatBusyUnitId(null);
        }
      });
    },
    [runOrbatAction, persistPhaseSoon, reportOrbat],
  );

  const [generateBusy, setGenerateBusy] = useState(false);

  const missingOrbatCount = useMemo(
    () =>
      selectedPhaseId
        ? partitionPhasePlacements(phasePlacements(), selectedPhaseId).missing.length
        : 0,
    // phasePlacements reads a ref, which isn't reactive; these are the
    // observable proxies for "the map changed".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phasePlacements, phaseMapData, selectedMapUnit, orbatStatus, selectedPhaseId],
  );

  /**
   * Basic (two-level) ORBAT for every land placement in this phase without
   * one. Senior units first, so each lands under the right parent and adopts
   * whatever is already near it.
   */
  const handleGenerateAllOrbats = useCallback(async () => {
    const target = phaseTargetRef.current;
    if (generateBusy || !target || !phaseHierKey) return;
    const { missing } = partitionPhasePlacements(phasePlacements(), target.phaseId);
    if (missing.length === 0) {
      reportOrbat("Every land unit in this phase already has an ORBAT.");
      return;
    }
    missing.sort(
      (a, b) => echelonRank(echelonForPlacedUnit(b)) - echelonRank(echelonForPlacedUnit(a)),
    );
    setGenerateBusy(true);
    let done = 0;
    let units = 0;
    try {
      let index = orbatIndexRef.current ?? indexForest([]);
      for (const placement of missing) {
        reportOrbat(`Generating ORBATs… ${done + 1} of ${missing.length}`);
        const r = await placeUnitInPhase(target, index, {
          spec: { label: placement.label, sidc: placement.sidc, templateId: placement.templateId },
          lat: placement.lat,
          lng: placement.lng,
          generateBeneath: true,
          depth: 2,
        });
        mapWrapperRef.current?.setUnitOrbat(placement.id, {
          orbatRootUnitKey: r.rootUnitKey,
          orbatHierarchyKey: r.hierarchyKey,
          orbatIsBasic: true,
        });
        done++;
        units += r.unitCount;
        // The next placement is parented against the tree as it now stands.
        index = indexForest((await loadPhaseForest(r.hierarchyKey, target.phaseId)).nodes);
      }
      reportOrbat(`Generated ${done} ORBAT${done === 1 ? "" : "s"} — ${units} units in this phase.`);
    } catch (err) {
      reportOrbat(
        `Generated ${done} of ${missing.length} ORBATs, then failed: ${err instanceof Error ? err.message : describeActionError(err)}`,
        true,
      );
    } finally {
      persistPhaseSoon(target.phaseId);
      await reloadPhaseOrbat();
      setGenerateBusy(false);
    }
  }, [generateBusy, phaseHierKey, phasePlacements, persistPhaseSoon, reloadPhaseOrbat, reportOrbat]);

  /**
   * "Save phase ORBAT" — make it complete and CSE-ready: clone inherited
   * ORBATs in, re-lay native ones under their placements, reconcile parentage.
   * The repair path after a failure or an edit made elsewhere, too.
   */
  const handleSavePhaseOrbat = useCallback(async () => {
    const target = phaseTargetRef.current;
    if (!target) return;
    reportOrbat("Saving the phase ORBAT…");
    try {
      const result = await savePhaseOrbat(
        target,
        orbatIndexRef.current ?? indexForest([]),
        phasePlacements(),
      );
      for (const link of result.linked) {
        mapWrapperRef.current?.setUnitOrbat(link.placementId, {
          orbatRootUnitKey: link.rootUnitKey,
          orbatHierarchyKey: result.hierarchyKey,
        });
      }
      if (result.linked.length > 0) persistPhaseSoon(target.phaseId);
      await reloadPhaseOrbat();
      reportOrbat(
        "Phase ORBAT saved" +
          (result.clonedUnits > 0 ? ` — ${result.clonedUnits} units copied in from earlier phases` : "") +
          (result.movedUnits > 0 ? `, ${result.movedUnits} re-laid under their placements` : "") +
          "." +
          (result.withoutOrbat.length > 0
            ? ` No ORBAT yet: ${result.withoutOrbat.join(", ")}.`
            : ""),
      );
    } catch (err) {
      reportOrbat(
        `Could not save the phase ORBAT. ${err instanceof Error ? err.message : describeActionError(err)}`,
        true,
      );
    }
  }, [phasePlacements, persistPhaseSoon, reloadPhaseOrbat, reportOrbat]);

  /**
   * A new phase based on another inherits its placements; bring their ORBATs
   * with them — copied into the new phase and re-laid around where each unit
   * ended the previous one.
   */
  const carryOrbatIntoPhase = useCallback(
    (phase: Phase) => {
      setTimeout(() => {
        const units = mapWrapperRef.current?.readPhaseMapState(phase.id)?.units ?? [];
        const placements = units.map(toPlacedUnit);
        if (!placements.some((p) => p.orbatRootUnitKey)) return;
        const target: PhaseTarget = {
          scenarioId: scenarioIdForOrbat,
          scenarioName: exercise.exerciseName,
          phaseId: phase.id,
          phaseName: phase.name,
        };
        reportOrbat(`Carrying the ORBAT into "${phase.name}"…`);
        savePhaseOrbat(target, indexForest([]), placements)
          .then(async (result) => {
            for (const link of result.linked) {
              mapWrapperRef.current?.setUnitOrbat(link.placementId, {
                orbatRootUnitKey: link.rootUnitKey,
                orbatHierarchyKey: result.hierarchyKey,
              });
            }
            persistPhaseSoon(phase.id);
            if (phaseTargetRef.current?.phaseId === phase.id) await reloadPhaseOrbat();
            reportOrbat(
              `ORBAT carried into "${phase.name}" — ${result.clonedUnits} units, positioned where the previous phase ended.`,
            );
          })
          .catch((err) =>
            reportOrbat(
              `The new phase has its units but not their ORBATs yet — use Save phase ORBAT. ${err instanceof Error ? err.message : describeActionError(err)}`,
              true,
            ),
          );
      }, 0);
    },
    [scenarioIdForOrbat, exercise.exerciseName, persistPhaseSoon, reloadPhaseOrbat, reportOrbat],
  );

  // ── Parent of the selected placement (ORBAT tab) ──────────────────────────
  const selectedTreeKey =
    selectedMapUnit?.orbatRootUnitKey && orbatIndex?.nodes.has(selectedMapUnit.orbatRootUnitKey)
      ? selectedMapUnit.orbatRootUnitKey
      : null;

  const parentOptions = useMemo(() => {
    if (!selectedTreeKey || !orbatIndex) return [];
    const subtree = new Set([selectedTreeKey, ...descendantsOf(orbatIndex, selectedTreeKey)]);
    return parentCandidates(orbatIndex, selectedTreeKey, subtree).map((key) => ({
      unitKey: key,
      label: orbatIndex.nodes.get(key)?.label ?? key,
    }));
  }, [selectedTreeKey, orbatIndex]);

  const handleChangeParent = useCallback(
    (parentUnitKey: string | null) => {
      if (!selectedMapUnit) return;
      if (selectedTreeKey) {
        changeOrbatParent(selectedTreeKey, parentUnitKey);
      } else {
        // No phase ORBAT yet: keep the choice on the placement; it is applied
        // when the ORBAT is generated or saved.
        mapWrapperRef.current?.setUnitParent(selectedMapUnit.id, parentUnitKey);
        if (selectedPhaseId) persistPhaseSoon(selectedPhaseId);
      }
      setSelectedMapUnit((prev) =>
        prev && prev.id === selectedMapUnit.id
          ? { ...prev, orbatParentUnitKey: parentUnitKey ?? undefined }
          : prev,
      );
    },
    [selectedMapUnit, selectedTreeKey, selectedPhaseId, changeOrbatParent, persistPhaseSoon],
  );

  const handleDefineOrbat = useCallback(
    (unit: PlacedUnitType) => {
      // Land only for now: nothing to define for ships or satellites. The map
      // menu hides the item, so this only guards a stale UI.
      const ineligible = orbatIneligibleReason(unit);
      if (ineligible) {
        setOrbatError(ineligible);
        return;
      }

      // Already has one → open it for editing.
      if (unit.orbatRootUnitKey && unit.orbatHierarchyKey) {
        navigate(
          `/orbat?hierarchy=${encodeURIComponent(unit.orbatHierarchyKey)}` +
            `&root=${encodeURIComponent(unit.orbatRootUnitKey)}`,
        );
        return;
      }

      setOrbatError(null);
      requestOrbatDefinition({
        unitId: unit.id,
        unitLabel: unit.label,
        sidc: unit.sidc,
        templateId: unit.templateId,
        lat: unit.lat,
        lng: unit.lng,
        side: sideForSidc(unit.sidc),
        scenarioId: scenarioMeta?.scenarioId ?? DEFAULT_SCENARIO_ID,
        scenarioName: exercise.exerciseName,
        phaseId: selectedPhaseId ?? undefined,
        phaseName: selectedPhase?.name,
        returnTo: "/scenario-plan",
      });
      navigate("/orbat?define=1");
    },
    [navigate, scenarioMeta?.scenarioId, exercise.exerciseName, selectedPhaseId, selectedPhase?.name],
  );

  // ── Link a confirmed ORBAT on the way back from the ORBAT screen ─────────
  // The ORBAT screen writes the graph and leaves the keys in the handoff; we
  // consume them once, attach them to the placement and persist.
  const orbatResultAppliedRef = useRef(false);
  useEffect(() => {
    if (orbatResultAppliedRef.current) return;
    const handle = mapWrapperRef.current;
    if (!handle || !selectedPhaseId) return;

    const result = takeOrbatDefinitionResult();
    if (!result) return;
    orbatResultAppliedRef.current = true;

    handle.setUnitOrbat(result.unitId, {
      orbatRootUnitKey: result.rootUnitKey,
      orbatHierarchyKey: result.hierarchyKey,
    });
    setSelectedMapUnit((prev) =>
      prev && prev.id === result.unitId
        ? {
            ...prev,
            orbatRootUnitKey: result.rootUnitKey,
            orbatHierarchyKey: result.hierarchyKey,
          }
        : prev,
    );

    // Persist on the next tick so the snapshot includes the link we just set.
    setTimeout(() => {
      const snapshot = mapWrapperRef.current?.readPhaseMapState(selectedPhaseId);
      const linked = snapshot?.units.some(
        (u) => u.id === result.unitId && u.orbatRootUnitKey === result.rootUnitKey,
      );
      if (snapshot && linked) handlePhaseMapEdited(selectedPhaseId, snapshot);
    }, 0);

    console.log(
      `[ScenarioPlanWidget] linked ORBAT ${result.rootUnitKey} ` +
        `(${result.unitsCreated} units) to placement ${result.unitId}`,
    );
    // The Define flow wrote into this phase's hierarchy — show it.
    void reloadPhaseOrbat();
  }, [phaseMapData, selectedPhaseId, handlePhaseMapEdited, reloadPhaseOrbat]);

  // ── Output: push the NxgPhase object set when the selection changes ───────
  // Use a ref so we can cancel an in-flight async call if the phase changes
  // again before the previous one resolves.
  const pushAbortRef = useRef<boolean>(false);

  useEffect(() => {
    if (!ctx) return;

    if (!selectedPhase) {
      ctx.selectedPhase?.setLoading?.();
      return;
    }

    // Mark loading while we create the temp RID
    ctx.selectedPhase?.setLoading?.();

    pushAbortRef.current = false;
    const phaseId = selectedPhase.id;

    pushPhaseObjectSet(phaseId, ctx.selectedPhase);

    return () => {
      // If the phase changes before the async call resolves, we ignore the
      // result (the next effect will overwrite it anyway).
      pushAbortRef.current = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhase?.id, !!ctx]);

  // ── Add Phase Dialog ────────────────────────────────────────────────────────
  const [addPhaseDialogOpen, setAddPhaseDialogOpen] = useState(false);

  // ── Per-phase order generation state ──────────────────────────────────────
  const [phaseOrders, setPhaseOrders] = useState<Record<string, UnitOrder[]>>({});
  const [phaseOrdersSummary, setPhaseOrdersSummary] = useState<Record<string, string>>({});
  /** Terrain corrections applied to the last generated orders, per phase. */
  const [phaseOrderAdjustments, setPhaseOrderAdjustments] =
    useState<Record<string, OrderAdjustment[]>>({});
  const [phaseEndStates, setPhaseEndStates] = useState<Record<string, GenerateEndStateOutput>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastOrderError, setLastOrderError] = useState<string | null>(null);

  // Helper: get the start-state units for a phase from the map
  const getStartStateUnits = useCallback((phaseId: string): MapUnitPlacement[] => {
    const mapState = mapWrapperRef.current?.readPhaseMapState(phaseId);
    return mapState?.units ?? [];
  }, []);
  // Helper: build phase context string
  const buildPhaseContextString = useCallback((phase: Phase): string => {
    const lines = [
      `Exercise: ${exercise.exerciseName}`,
      `Phase: ${phase.name}`,
      `Objective: ${phase.objective}`,
      `Time Window: ${formatPhaseWindow(phase)} (${phaseDurationHours(phase)}h)`,
      `Dependencies: ${phase.dependencies.join(", ") || "none"}`,
    ];
    return lines.join("\n");
  }, [exercise]);

  // Handler: Generate Orders from free text
  const handleGenerateOrders = useCallback(async (userIntent: string) => {
    if (!selectedPhase || isGenerating) return;
    setIsGenerating(true);
    setLastOrderError(null);
    try {
      const units = getStartStateUnits(selectedPhase.id);
      const mapState = mapWrapperRef.current?.readPhaseMapState(selectedPhase.id);
      const durationHours = selectedPhaseDurationHours;
      const timeScale = `This phase covers ${durationHours} simulated hours (${formatPhaseWindow(selectedPhase)}).`;

      const result = await generateOrders({
        userIntent,
        units,
        phaseContext: buildPhaseContextString(selectedPhase),
        timeScaleContext: timeScale,
        objectives: mapState?.objectives,
        // Tell the model up front how far each unit can actually get over this
        // terrain in this phase (prevention).
        reachabilityContext: buildReachabilityContext(units, durationHours, terrainRaster),
      });

      // ── Terrain enforcement ─────────────────────────────────────────────
      // Route every proposed destination on the same terrain grid the manual
      // order flow uses. Destinations in water are snapped ashore, destinations
      // with no route become hold-in-place, and destinations too far for the
      // phase are pulled back along the route to where the unit actually gets
      // to. Orders can no longer point somewhere the unit cannot reach.
      const constrained = await constrainOrdersToTerrain(
        terrainRaster,
        units,
        result.orders,
        result.newObjectives,
        durationHours,
      );
      if (constrained.adjustments.length > 0) {
        console.log(
          `[App] Terrain check adjusted ${constrained.adjustments.length}/${result.orders.length} orders`,
          constrained.adjustments,
        );
      }
      const orders = constrained.orders;
      const adjustmentSummary = summariseAdjustments(constrained.adjustments);

      setPhaseOrders((prev) => ({ ...prev, [selectedPhase.id]: orders }));
      setPhaseOrdersSummary((prev) => ({
        ...prev,
        [selectedPhase.id]: adjustmentSummary
          ? `${result.summary}\n\n${adjustmentSummary}`
          : result.summary,
      }));
      setPhaseOrderAdjustments((prev) => ({
        ...prev,
        [selectedPhase.id]: constrained.adjustments,
      }));

      // Apply orders as arrows on the map so the user can see the movement plan
      const currentMapState = mapWrapperRef.current?.readPhaseMapState(selectedPhase.id);
      if (currentMapState) {
        // All order arrows: from=unit current position, to=destination.
        // Unit is always at the START of the arrow. The tactical graphic
        // renders along the arrow showing the nature of the task.
        const orderArrows: MapArrowPlacement[] = orders
          // Drop orders whose unit isn't on this phase's map.
          .filter((order) => units.some((u) => u.id === order.unitId))
          .map((order) => {
            const unit = units.find((u) => u.id === order.unitId);
            // Terrain-following route computed during the reachability check —
            // lets the arrow be drawn along the actual path rather than as a
            // straight line through lakes and forests.
            const route = constrained.routes[order.unitId];
            return {
              id: `order-${order.unitId}`,
              fromLat: unit?.lat ?? 0,
              fromLng: unit?.lng ?? 0,
              toLat: order.toLat,
              toLng: order.toLng,
              colour: (unit?.force ?? "blue") === "red" ? "#E74C3C" : "#4A90D9",
              lineStyle: "solid" as const,
              tacticLabel: order.taskName,
              tacticSidc: resolveTacticSidc(APP_CATALOG, order.taskName),
              milxScale: 0.05,
              docSidc: resolveDocSidc(order.taskName),
              assignedUnitId: order.unitId,
              targetObjectiveId: order.targetObjectiveId || undefined,
              ...(route
                ? {
                    routeWaypoints: route.waypoints,
                    routeDistanceKm: route.distanceKm,
                    routeDurationSec: route.durationSec,
                    isTerrainRouted: true,
                  }
                : {}),
            };
          });

        // Merge new objectives from LLM with existing ones (positions already
        // nudged onto passable ground by the terrain check).
        const newObjs = constrained.newObjectives.map((o) => ({
          id: o.id, name: o.name, lat: o.lat, lng: o.lng, colour: o.colour,
        }));
        const allObjectives = [
          ...currentMapState.objectives,
          ...newObjs.filter((n) => !currentMapState.objectives.some((e) => e.id === n.id)),
        ];

        const phaseIdx = phases.findIndex((p) => p.id === selectedPhase.id);
        const nextState = {
          units: currentMapState.units,
          arrows: orderArrows,
          objectives: allObjectives,
        };
        mapWrapperRef.current?.applyPhaseMapState(
          selectedPhase.id,
          nextState,
          phaseIdx >= 0 ? phaseIdx : phases.length - 1,
        );
        // applyPhaseMapState deliberately suppresses the map's own edit
        // notification (it's an app-driven push), so persist explicitly —
        // otherwise generated orders would only reach the ontology if the
        // planner happened to touch the map afterwards.
        handlePhaseMapEdited(selectedPhase.id, nextState);
      }
    } catch (err) {
      setLastOrderError((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  }, [selectedPhase, isGenerating, phases, getStartStateUnits, buildPhaseContextString, handlePhaseMapEdited, terrainRaster]);

  // Handler: Generate End State from orders + context
  const handleGenerateEndState = useCallback(async () => {
    if (!selectedPhase || isGenerating) return;

    // Use explicit orders if available; otherwise derive from map arrows
    let orders = phaseOrders[selectedPhase.id] ?? [];
    const mapState = mapWrapperRef.current?.readPhaseMapState(selectedPhase.id);

    if (orders.length === 0 && mapState?.arrows && mapState.arrows.length > 0) {
      orders = mapState.arrows
        .filter((a) => a.assignedUnitId)
        .map((arrow) => ({
          unitId: arrow.assignedUnitId!,
          taskName: arrow.tacticLabel ?? "move",
          toLat: arrow.toLat,
          toLng: arrow.toLng,
          rationale: `Derived from map arrow — ${arrow.tacticLabel ?? "movement"} order.`,
          targetObjectiveId: arrow.targetObjectiveId ?? "",
        }));
      // Store derived orders so they appear in the Orders tab
      if (orders.length > 0) {
        setPhaseOrders((prev) => ({ ...prev, [selectedPhase.id]: orders }));
      }
    }

    // Even with no orders, we can still resolve the end state deterministically
    // using unit positions on the map (units stay in place with no orders).
    setIsGenerating(true);
    setLastOrderError(null);
    try {
      const units = getStartStateUnits(selectedPhase.id);
      const durationHours = selectedPhaseDurationHours;
      const timeScale = `This phase covers ${durationHours} simulated hours (${formatPhaseWindow(selectedPhase)}).`;

      // Build MEL/MIL, PMESII and training-objective context from the
      // in-memory catalogues (no extra ontology round-trip, and it works for
      // ontology-loaded phases that carry no id arrays — see resolvePhaseScoped).
      const linkedInjects = resolvePhaseScoped(
        selectedPhase.id, selectedPhase.injectIds, allInjectsFromOntology,
        (i) => i.injectId, (i) => i.phaseId,
      );
      const linkedPmesii = resolvePhaseScoped(
        selectedPhase.id, selectedPhase.pmesiiDomainIds, allPmesiiFromOntology,
        (d) => d.domainId,
      );
      const linkedObjectives = resolvePhaseScoped(
        selectedPhase.id, selectedPhase.objectiveIds, allObjectivesFromOntology,
        (o) => o.objectiveId, (o) => o.phaseId,
      );

      const melMilContext = linkedInjects.length > 0
        ? linkedInjects.map((i) => `- ${i.dayOffset} | ${i.injectTitle} [${i.injectCategory}]: ${i.injectBody.slice(0, 120)}`).join("\n")
        : "No MEL/MIL injects defined.";
      const pmesiiContext = linkedPmesii.length > 0
        ? linkedPmesii.map((d) => `- ${d.domainKey}: ${d.domainValue} [${d.domainStatus}]`).join("\n")
        : "No PMESII factors defined.";
      const trainingObjContext = linkedObjectives.length > 0
        ? linkedObjectives.map((o) => `- [${o.ref}] ${o.objective} (${o.functionalArea}, ${o.priority})`).join("\n")
        : "No training objectives defined.";

      // ── Deterministic pre-resolution ────────────────────────────────────
      // resolveOrders/resolveToEndState already computes authoritative
      // positions from movement rates, terrain-free distance and engagement
      // outcomes. Pass them to the LLM as facts (generateEndState supports
      // `resolvedPositionsJson`) so the model narrates rather than re-deriving
      // movement physics — which it previously did, unassisted.
      let resolvedPositionsJson: string | undefined;
      try {
        const resolveInput = mapState ?? { units, arrows: [], objectives: [] };
        const resolved = resolveToEndState(resolveInput, durationHours, DEFAULT_TIME_SCALE);
        resolvedPositionsJson = JSON.stringify({
          units: resolved.units.map((u) => ({
            unitId: u.id,
            label: u.label,
            lat: Math.round(u.lat * 1e6) / 1e6,
            lng: Math.round(u.lng * 1e6) / 1e6,
          })),
          resolutions: resolved.resolutions.map((r) => ({
            unitId: r.assignedUnitId,
            task: r.task?.name,
            feasibility: r.feasibility,
            distanceKm: r.distanceKm != null ? Math.round(r.distanceKm * 10) / 10 : undefined,
            etaHours: r.etaHours != null && Number.isFinite(r.etaHours)
              ? Math.round(r.etaHours * 10) / 10
              : undefined,
            engagementOutcome: r.engagement?.outcome,
            attritionPct: r.engagement?.estimatedAttritionPct,
          })),
        });
      } catch (err) {
        console.warn("[App] Deterministic pre-resolution failed — LLM will resolve positions:", err);
      }

      const result = await generateEndState({
        units,
        orders,
        resolvedPositionsJson,
        objectives: mapState?.objectives ?? [],
        phaseContext: buildPhaseContextString(selectedPhase),
        timeScaleContext: timeScale,
        durationHours,
        melMilContext,
        pmesiiContext,
        trainingObjectivesContext: trainingObjContext,
        ordersSummary: phaseOrdersSummary[selectedPhase.id] ?? "",
      });

      setPhaseEndStates((prev) => ({ ...prev, [selectedPhase.id]: result }));

      // Persist the end state so it survives a reload and can seed the next
      // phase's start state (usePhaseMapState.saveEndState was previously dead).
      void saveEndState(selectedPhase.id, {
        units: result.units.map((u) => {
          // Carry the ORBAT link into the persisted end state — otherwise a
          // phase seeded from it would come back with units that have lost
          // their force structure.
          const src = units.find((s) => s.id === u.unitId);
          return {
            id: u.unitId,
            label: u.label,
            sidc: u.sidc,
            lat: u.lat,
            lng: u.lng,
            force: u.force,
            orbatRootUnitKey: src?.orbatRootUnitKey,
            orbatHierarchyKey: src?.orbatHierarchyKey,
          };
        }),
        arrows: [],
        objectives: result.objectives.map((o) => ({
          id: o.id,
          name: o.name,
          lat: o.lat,
          lng: o.lng,
          colour: o.colour,
        })),
      }).catch((err) => {
        console.warn("[App] Failed to persist end state:", err);
      });

      // End state is NOT written to the map — the map continues to show
      // the start state with order arrows (the planning view). The end state
      // is stored in phaseEndStates and:
      //   1. Displayed in the ORDERS tab (engagements, outcomes, summary)
      //   2. Used as the start state when creating a new phase based on this one
      console.log(`[App] End state stored for ${selectedPhase.id}: ${result.units.length} units, ${result.engagements.length} engagements`);
    } catch (err) {
      setLastOrderError((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  }, [
    selectedPhase,
    isGenerating,
    phaseOrders,
    phaseOrdersSummary,
    getStartStateUnits,
    buildPhaseContextString,
    allInjectsFromOntology,
    allPmesiiFromOntology,
    allObjectivesFromOntology,
    saveEndState,
  ]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  // Guard against selecting a phase that isn't in the current list. The map
  // reports the phase of the unit that was clicked, and a unit can carry a
  // phaseId that has since disappeared (e.g. the mock phase list being
  // replaced by ontology phases while its units are still on the map).
  // Selecting it used to leave selectedPhase = null, which silently closed the
  // detail panel and filtered every unit off the map.
  const handleSelectPhase = useCallback(
    (id: string) => {
      if (!phases.some((p) => p.id === id)) {
        console.warn(
          `[ScenarioPlanWidget] Ignoring selection of unknown phase "${id}" — it is not in the current phase list.`,
        );
        return;
      }
      selectPhase(id);
    },
    [phases, selectPhase],
  );
  const handleCloseDetail = useCallback(() => selectPhase(null), [selectPhase]);

  // Open the Add Phase dialog
  const handleAddPhase = useCallback(() => {
    if (readOnly) return;
    setAddPhaseDialogOpen(true);
  }, [readOnly]);

  // Handle dialog submission — create the phase with inherited start state
  const handleAddPhaseSubmit = useCallback(async (result: AddPhaseResult) => {
    setAddPhaseDialogOpen(false);

    const sourcePhase = phases.find((p) => p.id === result.basedOnPhaseId);
    const sourceEndOffset = sourcePhase?.endOffset ?? 0;
    // Express the requested duration in the SAME unit the source phase uses,
    // so an hour-scaled scenario (NEXGEN: H+n) doesn't get a day-scaled child.
    const offsetUnit = sourcePhase?.offsetUnit ?? "day";
    const durationInOffsetUnits =
      offsetUnit === "hour"
        ? Math.max(1, Math.round(result.durationHours))
        : Math.max(1, Math.ceil(result.durationHours / DEFAULT_TIME_SCALE.hoursPerDayOffset));

    const newPhase: Phase = {
      // Placeholder — createNxgPPhase assigns the real phaseId, and createPhase
      // returns the phase carrying it. Never use this id for anything.
      id: "pending",
      name: result.name,
      status: "DRAFT",
      objective: "Define objective...",
      startOffset: sourceEndOffset,
      endOffset: sourceEndOffset + durationInOffsetUnits,
      offsetUnit,
      unitIds: sourcePhase ? [...sourcePhase.unitIds] : [],
      passCriteria: [],
      failCriteria: [],
      tasks: [],
      dependencies: sourcePhase ? [sourcePhase.id] : [],
      // The phase graph (PhaseGraphHome / tracePath / branchesBySource) is
      // built purely from basedOnPhaseId. Without this the new phase rendered
      // as a detached ROOT node instead of a child of the phase it was based
      // on — and never appeared on the branch path in map view.
      basedOnPhaseId: sourcePhase ? sourcePhase.id : undefined,
    };
    // Awaited: createPhase writes the phase to the ontology and returns it with
    // the ontology-assigned phaseId. Everything below keys off that id — the
    // map state is stored on NxgPhaseMapState.phaseId — so using the local
    // placeholder id would create map-state rows referencing a phase that does
    // not exist.
    let persistedPhase: Phase;
    try {
      persistedPhase = await createPhase(newPhase);
    } catch {
      // usePhases has already surfaced the reason through mutationError.
      return;
    }

    // Inherit the END state of the base phase as the START state of the new phase.
    // Priority:
    //   1. LLM-generated end state (from "Generate End State" button)
    //   2. Deterministic end state (resolved from orders/arrows on the map)
    //   3. Fallback: ontology-loaded start state for the source phase
    //   4. Fallback: ontology-loaded end state for the source phase
    // Units start the new phase where they ENDED the previous one.
    if (sourcePhase) {
      const newPhaseIndex = phases.length;
      const llmEndState = phaseEndStates[sourcePhase.id];
      let applied = false;

      // Option 1: Use the LLM-generated end state positions
      if (llmEndState && llmEndState.units.length > 0) {
        console.log(`[AddPhase] Inheriting ${llmEndState.units.length} units from LLM end state of "${sourcePhase.name}"`);
        // The end state only carries positions, so pull the ORBAT link from
        // the source phase's placement: a unit is the same force phase to
        // phase and keeps the same ORBAT.
        const sourceUnits =
          mapWrapperRef.current?.readPhaseMapState(sourcePhase.id)?.units ?? [];
        const orbatFor = (unitId: string) => {
          const src = sourceUnits.find((u) => u.id === unitId);
          return {
            orbatRootUnitKey: src?.orbatRootUnitKey,
            orbatHierarchyKey: src?.orbatHierarchyKey,
          };
        };

        const inheritedMapState = {
          // Fresh ids per phase — see the note in the deterministic branch below.
          units: llmEndState.units.map((u) => ({
            id: crypto.randomUUID(),
            label: u.label,
            sidc: u.sidc,
            lat: u.lat,
            lng: u.lng,
            force: u.force,
            role: "",
            ...orbatFor(u.unitId),
          })),
          arrows: [] as MapArrowPlacement[],
          objectives: [],
        };
        // Guard against the usePhaseMapState effect overwriting these units
        // when it re-runs after the new phaseId is added to phaseIds.
        appliedPhasesRef.current.add(persistedPhase.id);
        mapWrapperRef.current?.applyPhaseMapState(persistedPhase.id, inheritedMapState, newPhaseIndex);
        // Persist the inherited start state so it survives a reload.
        handlePhaseMapEdited(persistedPhase.id, inheritedMapState);
        applied = true;
      }

      // Option 2: Deterministically resolve the source phase's map state.
      // First try to read live state from MapWrapper (most up-to-date, includes
      // any unsaved manual edits). If MapWrapper hasn't received the units yet
      // (e.g. Ontology load is still in flight), fall back to the hook's data
      // so we always have something to resolve against.
      if (!applied) {
        let sourceMapState = mapWrapperRef.current?.readPhaseMapState(sourcePhase.id);

        if (!sourceMapState || sourceMapState.units.length === 0) {
          // MapWrapper doesn't have the units yet — use the hook's data instead.
          // Prefer the persisted end state; fall back to the start state.
          const ontologyData = phaseMapData[sourcePhase.id];
          const hookState = ontologyData?.endState ?? ontologyData?.startState;
          if (hookState && hookState.units.length > 0) {
            console.log(`[AddPhase] MapWrapper empty for "${sourcePhase.name}" — using hook data (${hookState.units.length} units)`);
            sourceMapState = hookState;
          }
        }

        if (sourceMapState && sourceMapState.units.length > 0) {
          console.log(`[AddPhase] Resolving ${sourceMapState.units.length} units deterministically from "${sourcePhase.name}" map state`);
          const sourceDurationHours = phaseDurationHours(sourcePhase);
          const endState = resolveToEndState(
            sourceMapState,
            sourceDurationHours,
            DEFAULT_TIME_SCALE,
          );
          const inheritedMapState = {
            // Give the inherited units FRESH ids. Reusing the source phase's
            // ids put two units with the same id on the map (one per phase),
            // and the map keys its markers by unit id — so the marker created
            // for the source phase was reused for the new phase and kept
            // reporting the OLD phase on click, closing the detail panel and
            // filtering the map to the wrong phase.
            units: endState.units.map((u) => ({ ...u, id: crypto.randomUUID(), role: "" })),
            arrows: [] as MapArrowPlacement[],
            objectives: [],
          };
          // Mark the new phase as already applied BEFORE calling applyPhaseMapState.
          // This prevents the usePhaseMapState effect from overwriting these units
          // when it re-runs after phaseIds changes (which happens because createPhase
          // added the new phase to the list). Without this guard the effect fires,
          // finds no NxgPhaseMapState row for the new phase, and replaces our units
          // with an empty fallback state.
          appliedPhasesRef.current.add(persistedPhase.id);
          mapWrapperRef.current?.applyPhaseMapState(persistedPhase.id, inheritedMapState, newPhaseIndex);
          // Persist the inherited start state so it survives a reload.
          handlePhaseMapEdited(persistedPhase.id, inheritedMapState);
          applied = true;
        } else {
          console.warn(`[AddPhase] No units found for "${sourcePhase.name}" in MapWrapper or hook data — new phase will start empty.`);
        }
      }

      if (!applied) {
        console.error(`[AddPhase] Could not inherit any units from "${sourcePhase.name}" (${sourcePhase.id}). New phase will start empty.`);
      } else if (!readOnly) {
        // Each phase holds its own copy of the force: copy the ORBATs in,
        // positioned where the units ended the phase this one is based on.
        carryOrbatIntoPhase(persistedPhase);
      }
    }

    selectPhase(persistedPhase.id);

    // The bottom PhaseTimeline and the top-left breadcrumb both render
    // tracePath(phases, viewingBranchLeaf), which walks ANCESTORS of the leaf
    // the user opened the map on. A newly-created phase is a DESCENDANT of that
    // leaf, so without advancing the pointer it never appeared in the bar even
    // though the graph and the detail panel showed it. The new phase is now the
    // leaf of the branch being viewed.
    // Only do this in map view — on the graph home we stay on the graph.
    setViewingBranchLeaf((current) => (current ? persistedPhase.id : current));
  }, [phases, createPhase, selectPhase, phaseEndStates, phaseMapData, handlePhaseMapEdited, carryOrbatIntoPhase, readOnly]);

  const handleDeletePhase = useCallback(
    (phaseId: string) => {
      if (readOnly) return;

      // Compute the next selected phase BEFORE removing so we can jump to a
      // neighbouring phase (or clear the selection if we just deleted the
      // only remaining phase).
      const idx = phases.findIndex((p) => p.id === phaseId);
      const nextSelected: string | null =
        idx === -1
          ? selectedPhaseId
          : phases[idx + 1]?.id ?? phases[idx - 1]?.id ?? null;

      // Remove any map items owned by this phase.
      mapWrapperRef.current?.deletePhaseItems(phaseId);

      // Remove the phase from state (also strips it from other phases'
      // dependency lists).
      deletePhase(phaseId);

      // Adjust selection so the detail panel doesn't get stuck on a
      // now-nonexistent phase.
      if (selectedPhaseId === phaseId) {
        selectPhase(nextSelected);
      }

      // Keep the viewed branch leaf valid — otherwise tracePath returns an
      // empty path and the bottom timeline silently falls back to showing
      // every phase in the scenario.
      setViewingBranchLeaf((current) =>
        current === phaseId ? nextSelected : current,
      );
    },
    [phases, selectedPhaseId, deletePhase, selectPhase, readOnly],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="sp-widget">
      {/* ── Graph home (landing page) — graph + detail sidebar ─────────── */}
      {!viewingBranchLeaf && (
        <div className="sp-body">
          <PhaseGraphHome
            phases={phases}
            exerciseName={exercise.exerciseName}
            selectedPhaseId={selectedPhaseId}
            onSelectPhase={selectPhase}
            onViewOnMap={(leafId) => {
              setViewingBranchLeaf(leafId);
              selectPhase(leafId);
            }}
            onViewTimeline={(_leafId) => {
              navigate("/timeline");
            }}
            onAddPhase={readOnly ? undefined : handleAddPhase}
          />

          <PhaseDetail
            phase={selectedPhase}
            phaseIndex={selectedPhaseIndex}
            allPhases={phases}
            branchesBySource={branchesBySource}
            branchSiblings={selectedPhase ? getBranchSiblings(selectedPhase.id) : []}
            onSelectBranch={selectPhase}
            onForkPhase={selectedPhaseId ? () => handleForkPhase(selectedPhaseId) : undefined}
            onClose={handleCloseDetail}
            readOnly={readOnly}
            onRename={(phaseId, newName) => {
              const target = phases.find((p) => p.id === phaseId);
              if (!target) return;
              updatePhase({ ...target, name: newName });
            }}
            onPhaseUpdate={readOnly ? undefined : updatePhase}
            onPhaseDelete={readOnly ? undefined : handleDeletePhase}
            tasks={allTasksFromOntology}
            audiences={allAudiencesFromOntology}
            pmesiiDomains={allPmesiiFromOntology}
            objectives={allObjectivesFromOntology}
            injects={allInjectsFromOntology}
          />
        </div>
      )}

      {/* ── Map view — always rendered so refs/effects work, hidden when graph is showing */}
      <div className="sp-body" style={!viewingBranchLeaf ? { display: "none" } : undefined}>
        <MapWrapper
          ref={mapWrapperRef}
          selectedPhaseIndex={effectivePhaseIndex}
          selectedPhaseId={effectivePhaseId}
          onSelectPhase={handleSelectPhase}
          onOpenTimeline={() => navigate("/timeline")}
          readOnly={readOnly}
          // Real phase duration — the End State toggle and the reachability
          // time budget used to be hardcoded to MapWrapper's 48h default
          // regardless of how long the phase actually was.
          phaseDurationHours={selectedPhaseDurationHours}
          // Persist map edits back to the ontology (debounced inside MapWrapper).
          onPhaseMapEdited={readOnly ? undefined : handlePhaseMapEdited}
          terrain={terrain}
          onDefineOrbat={readOnly ? undefined : handleDefineOrbat}
          onSelectedUnitChange={setSelectedMapUnit}
          previewMap={null}
          onPreviewMapEdit={undefined}
          toolbarStart={
            <>
              <button
                type="button"
                className="mil-btn mil-btn--sm mil-btn--default"
                onClick={() => setViewingBranchLeaf(null)}
                aria-label="Back to phase graph"
              >
                ← Branches
              </button>
              <span className="sp-map-toolbar__crumb" title={branchPath.map((p) => p.name).join(" → ")}>
                {branchPath.map((p) => p.name.replace(/^Phase\s+\d+[A-Z]?\s*[—–-]\s*/i, "")).join(" → ")}
              </span>
            </>
          }
          toolbarEnd={
            hasPhaseOrbat ? (
              <OrbatLevelControl
                mode={levelMode}
                autoLevel={autoLevel}
                levels={levelInfos}
                onChange={setLevelMode}
                loading={phaseOrbat.loading}
              />
            ) : undefined
          }
          orbatLevelNodes={orbatLevelNodes}
          orbatLevelDraggable={!readOnly}
          hiddenOrbatKeys={hiddenOrbatKeys}
          onOrbatNodeSelect={setSelectedOrbatKey}
          onOrbatNodeContext={
            readOnly
              ? undefined
              : (key, client) => {
                  setSelectedOrbatKey(key);
                  setNodeMenu({ key, client });
                }
          }
          onOrbatNodeMoved={readOnly ? undefined : handleOrbatNodeMoved}
          onViewChange={handleViewChange}
          treeNodeInfo={(key) => {
            const node = orbatIndex?.nodes.get(key);
            const pos = orbatIndex ? effectivePosition(orbatIndex, key) : null;
            if (!node || !pos || !phaseHierKey) return null;
            return { label: node.label, sidc: node.sidc, lat: pos.lat, lng: pos.lng, hierarchyKey: phaseHierKey };
          }}
          onPlaceOrbatUnitRequest={readOnly ? undefined : openPlaceDialog}
          onAutoGenerateOrbat={readOnly ? undefined : handleAutoGenerateOrbat}
          onPlacementMoved={readOnly ? undefined : handlePlacementMoved}
          orderGuard={orderGuard}
        />

        {orbatStatus && viewingBranchLeaf && (
          <div
            className={`sp-orbat-status ${orbatStatus.error ? "sp-orbat-status--error" : ""}`}
            role={orbatStatus.error ? "alert" : "status"}
          >
            {orbatStatus.text}
          </div>
        )}

        <PhaseDetail
          phase={selectedPhase}
          phaseIndex={selectedPhaseIndex}
          allPhases={phases}
          branchesBySource={branchesBySource}
          branchSiblings={selectedPhase ? getBranchSiblings(selectedPhase.id) : []}
          onSelectBranch={selectPhase}
          onForkPhase={selectedPhaseId ? () => handleForkPhase(selectedPhaseId) : undefined}
          onClose={handleCloseDetail}
          readOnly={readOnly}
          onReadMapState={
            selectedPhase
              ? () =>
                  mapWrapperRef.current?.readPhaseMapState(selectedPhase.id) ??
                  null
              : undefined
          }
          onMapStateChanged={
            selectedPhase && !readOnly
              ? () => {
                  const p = selectedPhase;
                  scheduleMapSync(p.id, p.name, `${p.name}: ${p.objective}`, exercise.exerciseName);
                }
              : undefined
          }
          onPublishToOrbat={
            selectedPhase && !readOnly
              ? async (params: SyncPhaseMapStateParams) => {
                  // Full pipeline — always upsert (create on first publish,
                  // edit/update on every subsequent publish for this phase):
                  //   1. serialiseMapState(startState)        → full map JSON
                  //   2. extractUnitsSection(rawMapJson)      → {"units":[…]}
                  //   3. callLlmPhaseToOrbat(unitsJson)       → hierarchical ORBAT JSON
                  //   4a. First publish → createNxgOtemplateOrbatGraph
                  //   4b. Re-publish   → editNxgOtemplateOrbatGraph (same record)
                  const result = await syncPhaseMapState({
                    phaseId:          params.phaseId,
                    phaseName:        selectedPhase.name,
                    operationName:    exercise.exerciseName,
                    phaseDescription: `${selectedPhase.name}: ${selectedPhase.objective}`,
                    startState:       params.startState,
                    nationalityHint:  params.nationalityHint,
                    parentNodeName:   params.parentNodeName,
                  });
                  // syncPhaseMapState returns a string (the primary key) on both
                  // create and update paths, but the PhaseDetail callback expects
                  // the full CreatePhaseMapStateResult shape.  Reconstruct it.
                  return {
                    mapStateId: result,
                    orbatJson:  null,    // update path does not return orbatJson; UI still shows ✓
                    bySide:     undefined,
                  };
                }
              : undefined
          }
          onRename={(phaseId, newName) => {
            const target = phases.find((p) => p.id === phaseId);
            if (!target) return;
            updatePhase({ ...target, name: newName });
          }}
          onTaskSelected={(taskId) =>
            pushTaskObjectSet(taskId, ctx?.selectedTask, ctx?.onTaskSelected)
          }
          onAudienceSelected={(audienceId) =>
            pushAudienceObjectSet(
              audienceId,
              ctx?.selectedAudience,
              ctx?.onAudienceSelected,
            )
          }
          onPmesiiSelected={(domainId) =>
            pushPmesiiObjectSet(
              domainId,
              ctx?.selectedPmesiiDomain,
              ctx?.onPmesiiSelected,
            )
          }
          onObjectiveSelected={(objectiveId) =>
            pushObjectiveObjectSet(
              objectiveId,
              ctx?.selectedObjective,
              ctx?.onObjectiveSelected,
            )
          }
          onInjectSelected={(injectId) =>
            pushInjectObjectSet(
              injectId,
              ctx?.selectedInject,
              ctx?.onInjectSelected,
            )
          }
          onPhaseUpdate={readOnly ? undefined : updatePhase}
          onPhaseDelete={readOnly ? undefined : handleDeletePhase}
          // ── Ontology-backed tab catalogues ──────────────────────────
          // PhaseDetail internally filters each catalogue by the current
          // phase (via phase.<x>Ids arrays, falling back to phaseId FKs
          // on the objects themselves). Passing the full lists here means
          // the tabs work whether or not the Workshop layer has hydrated
          // the id arrays on the phase.
          tasks={allTasksFromOntology}
          audiences={allAudiencesFromOntology}
          pmesiiDomains={allPmesiiFromOntology}
          objectives={allObjectivesFromOntology}
          injects={allInjectsFromOntology}
          orbatTabProps={{
            unitLabel: selectedMapUnit?.label,
            hasSelection: !!selectedMapUnit,
            root: selectedUnitOrbat.root ?? basicOrbat?.root ?? null,
            nodeCount: selectedUnitOrbat.root
              ? selectedUnitOrbat.nodeCount
              : basicOrbat?.nodeCount ?? 0,
            isBasic: !!selectedMapUnit?.orbatIsBasic || (!selectedUnitOrbat.root && !!basicOrbat),
            truncated: selectedUnitOrbat.truncated,
            loading: selectedUnitOrbat.loading || orbatBusyUnitId === selectedMapUnit?.id,
            error: orbatError ?? selectedUnitOrbat.error,
            notApplicable: selectedUnitOrbatNotApplicable,
            onDefineOrbat:
              selectedMapUnit && !selectedUnitOrbatNotApplicable
                ? () => handleDefineOrbat(selectedMapUnit)
                : undefined,
            onOpenInOrbatManager:
              selectedMapUnit?.orbatHierarchyKey && selectedMapUnit?.orbatRootUnitKey
                ? () =>
                    navigate(
                      `/orbat?hierarchy=${encodeURIComponent(selectedMapUnit.orbatHierarchyKey!)}` +
                        `&root=${encodeURIComponent(selectedMapUnit.orbatRootUnitKey!)}`,
                    )
                : undefined,
            // The overall friendly/enemy ORBAT isn't authored — it is the
            // scenario's one hierarchy, entered at the side's root. That root
            // is derived by the same rules the reconciler uses, so the link
            // always lands on whatever is actually at the top of the side.
            onOpenScenarioOrbat: async (side) => {
              // This phase's ORBAT, entered at the side's most senior root.
              if (orbatIndex && hasPhaseOrbat && phaseHierKey) {
                const root = orbatIndex.roots
                  .map((k) => orbatIndex.nodes.get(k)!)
                  .filter((n) => n.side === side)
                  .sort((a, b) => echelonRank(b.echelon as never) - echelonRank(a.echelon as never))[0];
                navigate(
                  `/orbat?hierarchy=${encodeURIComponent(phaseHierKey)}` +
                    (root ? `&root=${encodeURIComponent(root.key)}` : ""),
                );
                return;
              }
              try {
                const target = await resolveScenarioOrbat(
                  scenarioMeta?.scenarioId ?? DEFAULT_SCENARIO_ID,
                  exercise.exerciseName,
                  side,
                );
                const root =
                  sideRootKeys(collectScenarioPlacements())[side] ?? target.parentUnitKey;
                navigate(
                  `/orbat?hierarchy=${encodeURIComponent(target.hierarchyKey)}` +
                    (root ? `&root=${encodeURIComponent(root)}` : ""),
                );
              } catch (err) {
                setOrbatError(
                  `Could not open the ${side === "red" ? "enemy" : "friendly"} ORBAT. ` +
                    describeActionError(err),
                );
              }
            },
            rebuildStatus: reconcileStatus,
            onRebuildHierarchy: readOnly || !selectedPhase ? undefined : handleSavePhaseOrbat,
            missingOrbatCount,
            generateBusy,
            onGenerateAllOrbats:
              readOnly || missingOrbatCount === 0 ? undefined : handleGenerateAllOrbats,
            parentOptions,
            currentParentKey: selectedTreeKey
              ? orbatIndex?.nodes.get(selectedTreeKey)?.parentKey ?? null
              : selectedMapUnit?.orbatParentUnitKey ?? null,
            parentIsOverride: !!selectedMapUnit?.orbatParentUnitKey,
            isSideRoot: !!selectedTreeKey && !!orbatIndex?.roots.includes(selectedTreeKey),
            parentLabelFor: (unitKey: string) =>
              orbatIndex?.nodes.get(unitKey)?.label ?? unitKey,
            onChangeParent: readOnly ? undefined : handleChangeParent,
          }}
          ordersTabProps={selectedPhase ? {
            startStateUnits: getStartStateUnits(selectedPhase.id),
            orders: phaseOrders[selectedPhase.id] ?? [],
            endState: phaseEndStates[selectedPhase.id] ?? null,
            isGenerating,
            lastError: lastOrderError,
            ordersSummary: phaseOrdersSummary[selectedPhase.id] ?? "",
            adjustments: phaseOrderAdjustments[selectedPhase.id] ?? [],
            onGenerateOrders: handleGenerateOrders,
            onGenerateEndState: handleGenerateEndState,
          } : undefined}
        />
      </div>

      {placeDialog && (
        <PlaceUnitDialog
          at={placeDialog}
          busy={placeBusy}
          error={placeError}
          defaultSide={lastPlacedSideRef.current}
          onPlace={handlePlaceOrbatUnit}
          onClose={() => !placeBusy && setPlaceDialog(null)}
        />
      )}

      {nodeMenu && orbatIndex?.nodes.has(nodeMenu.key) && phaseTarget && (() => {
        const node = orbatIndex.nodes.get(nodeMenu.key)!;
        const below = descendantsOf(orbatIndex, node.key);
        const native = isNativeToPhase(node.key, phaseTarget.phaseId);
        const subtree = new Set([node.key, ...below]);
        return (
          <OrbatNodeMenu
            client={nodeMenu.client}
            label={node.label}
            echelon={node.echelon}
            busy={nodeBusy}
            generateBlockedReason={
              (orbatIndex.childrenOf.get(node.key)?.length ?? 0) > 0
                ? "It already has subordinates"
                : !native
                  ? "Inherited from another phase — save this phase's ORBAT first"
                  : null
            }
            parentOptions={parentCandidates(orbatIndex, node.key, subtree).map((key) => ({
              key,
              label: orbatIndex.nodes.get(key)?.label ?? key,
              echelon: orbatIndex.nodes.get(key)?.echelon ?? "",
            }))}
            currentParentKey={node.parentKey}
            removeCount={native ? [node.key, ...below].filter((k) => isNativeToPhase(k, phaseTarget.phaseId)).length : 0}
            onGenerateBeneath={() =>
              void runOrbatAction(`Could not generate beneath "${node.label}".`, async () => {
                const r = await generateBeneathNode(phaseTarget, orbatIndex, node.key);
                return `Generated ${r.unitCount} units beneath "${node.label}"${capNote(r)}.`;
              })
            }
            onChangeParent={(parentKey) => changeOrbatParent(node.key, parentKey)}
            onOpenInOrbatManager={
              phaseHierKey
                ? () =>
                    navigate(
                      `/orbat?hierarchy=${encodeURIComponent(phaseHierKey)}&root=${encodeURIComponent(node.key)}`,
                    )
                : undefined
            }
            onRemove={() =>
              void runOrbatAction(`Could not remove "${node.label}".`, async () => {
                const removed = await removeSubtreeInPhase(phaseTarget, orbatIndex, node.key);
                mapWrapperRef.current?.removeOrbatLinkedUnits(subtree);
                persistPhaseSoon(phaseTarget.phaseId);
                if (selectedOrbatKey && subtree.has(selectedOrbatKey)) setSelectedOrbatKey(null);
                return `Removed "${node.label}"${removed > 1 ? ` and ${removed - 1} units below it` : ""} from this phase.`;
              })
            }
            onClose={() => setNodeMenu(null)}
          />
        );
      })()}

      {viewingBranchLeaf && (
        <PhaseTimeline
          phases={branchPath.length > 0 ? branchPath : phases}
          selectedPhaseId={selectedPhaseId}
          branchesBySource={branchesBySource}
          onSelectPhase={handleSelectPhase}
          onAddPhase={handleAddPhase}
          readOnly={readOnly}
        />
      )}

      {/* Add Phase dialog (available in both graph and map views) */}
      <AddPhaseDialog
        isOpen={addPhaseDialogOpen}
        phases={phases}
        branchesBySource={branchesBySource}
        defaultBasedOnPhaseId={selectedPhaseId ?? undefined}
        onSubmit={handleAddPhaseSubmit}
        onClose={() => setAddPhaseDialogOpen(false)}
      />

      {/* Phase persistence failures. Previously a phase that could not be
          saved simply vanished on the next reload with nothing shown at the
          time, which is how the missing-branch bug went unnoticed. */}
      {mutationError && (
        <div role="alert" style={phaseErrorBanner}>
          <span style={{ flex: 1 }}>{mutationError}</span>
          <button
            type="button"
            onClick={clearMutationError}
            aria-label="Dismiss"
            style={phaseErrorDismiss}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

const phaseErrorBanner: React.CSSProperties = {
  position: "fixed",
  bottom: 16,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  gap: 12,
  maxWidth: 640,
  padding: "10px 14px",
  background: "#3b1418",
  border: "1px solid #a3262c",
  borderRadius: 6,
  color: "#ffd7d9",
  font: "13px/1.4 'Inter', 'Segoe UI', sans-serif",
  boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
};

const phaseErrorDismiss: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#ffd7d9",
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
};

