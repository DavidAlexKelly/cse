// src/shared/orbat/phaseOrbat.ts
//
// Per-phase ORBAT reads and writes — the OSDK half.
//
// Each phase owns NxgUnitHierarchy `hier-{scenarioId}--{phaseId}` (phaseKey
// set) holding its own copies of its units, keyed `{phaseId}--{uuid}`, each
// with its own position. See phaseKeys.ts for why; phasePayload.ts builds every
// write; this module resolves the hierarchy, loads the phase forest and sends
// the writes.
//
// Every structural write is ONE call to [NXG-O] Reconcile Scenario Orbat, so a
// placement, a generated ORBAT, a re-parent or a whole save lands completely
// or not at all. Moves are position-only updateNxgUnit batches; removals are
// deleteNxgUnit batches with cascading edge deletes.
import {
  NxgUnit,
  NxgUnitHierachyEdge,
  NxgUnitHierarchy,
  createNxgUnitHierarchy,
  deleteNxgUnit,
  nxgOReconcileScenarioOrbat,
  updateNxgUnit,
} from "@nxg-simulation-execution-testing/sdk";
import { client } from "@/client";
import type { CompositionNode } from "@/shared/types";
import type { PlacedUnit } from "../../apps/scenarioPlanner/map/types";
import { loadSwordFormations } from "../lib/foundry";
import { fetchUnits, loadOrbatSubtree } from "./loadOrbatSubtree";
import { type Side, ontologyDate, sideForSidc } from "./model";
import {
  type ForestIndex,
  type ForestNode,
  type PositionMap,
  descendantsOf,
  effectivePosition,
  indexForest,
} from "./orbatLevels";
import {
  isNativeToPhase,
  partitionPhasePlacements,
  phaseHierarchyKey,
  phaseHierarchyName,
  phaseUnitKeyPrefix,
} from "./phaseKeys";
import {
  type PhaseHierarchyRef,
  type PhaseReconcilePayload,
  type TreeSaveInput,
  type TreeSaveParts,
  changeParentPayload,
  cloneSubtreePayloadParts,
  generateBeneathPayload,
  phasePlacementParentage,
  pinSubtrees,
  placeUnitPayload,
  treeSavePayload,
  treeViewOf,
} from "./phasePayload";
import { adoptees, chooseParent, landingLevel } from "./placeIntoOrbat";
import { describeActionError, operationKeyForScenario } from "./scenarioOrbat";
import {
  AUTO_ORBAT_MAX_UNITS,
  autoOrbatCapFor,
  buildOrbatSkeletonWithReport,
  echelonForPlacedUnit,
} from "./skeleton";
import { expandAutomat } from "./swordComposition";
import type { SwordFormationIndex } from "./swordFormations";

export { AUTO_ORBAT_MAX_UNITS, autoOrbatCapFor };

/** Which phase a write is for. */
export interface PhaseTarget {
  scenarioId: string;
  scenarioName: string;
  phaseId: string;
  /** Human-readable — becomes part of the hierarchy name. Never the id. */
  phaseName: string;
}

// ─── Hierarchy ───────────────────────────────────────────────────────────────

export function phaseRef(target: PhaseTarget): PhaseHierarchyRef {
  return {
    operationKey: operationKeyForScenario(target.scenarioId),
    hierarchyKey: phaseHierarchyKey(target.scenarioId, target.phaseId),
    hierarchyName: phaseHierarchyName(target.scenarioName, target.phaseName),
    phaseKey: target.phaseId,
  };
}

const _resolved = new Map<string, Promise<PhaseHierarchyRef>>();

/**
 * Get or create the phase's NxgUnitHierarchy, with phaseKey set.
 *
 * Created up front (rather than left to the first reconcile) because the
 * reconcile function only learned to stamp phaseKey alongside this change; a
 * hierarchy without phaseKey is invisible to the Translator's phase export and
 * to CSE validation. Both paths now set it, so either order works.
 */
export function resolvePhaseHierarchy(target: PhaseTarget): Promise<PhaseHierarchyRef> {
  const ref = phaseRef(target);
  const cached = _resolved.get(ref.hierarchyKey);
  if (cached) return cached;

  const promise = (async () => {
    const existing = await client(NxgUnitHierarchy)
      .fetchOne(ref.hierarchyKey)
      .catch(() => undefined);
    if (existing !== undefined) return ref;
    try {
      await client(createNxgUnitHierarchy).applyAction({
        primaryKey: ref.hierarchyKey,
        name: ref.hierarchyName,
        operationKey: ref.operationKey,
        validFrom: ontologyDate(),
        phaseKey: ref.phaseKey,
      });
      console.log(`[phaseOrbat] created ${ref.hierarchyKey} (phase ${ref.phaseKey})`);
    } catch (err) {
      throw new Error(
        `Could not create the ORBAT for this phase (operation ${ref.operationKey}): ` +
          describeActionError(err),
      );
    }
    return ref;
  })();

  _resolved.set(ref.hierarchyKey, promise);
  promise.catch(() => _resolved.delete(ref.hierarchyKey));
  return promise;
}

/** True when the phase already has a hierarchy (without creating one). */
export async function phaseHierarchyExists(target: PhaseTarget): Promise<boolean> {
  const key = phaseHierarchyKey(target.scenarioId, target.phaseId);
  if (_resolved.has(key)) return true;
  const existing = await client(NxgUnitHierarchy)
    .fetchOne(key)
    .catch(() => undefined);
  return existing !== undefined;
}

async function applyReconcile(payload: PhaseReconcilePayload): Promise<void> {
  try {
    await client(nxgOReconcileScenarioOrbat).applyAction({
      scenario_json: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(describeActionError(err));
  }
}

// ─── Loading the phase forest ────────────────────────────────────────────────

export interface PhaseForest {
  nodes: ForestNode[];
  /** True when the node limit cut the load short. */
  truncated: boolean;
}

/** Same guard as loadOrbatSubtree: a full division plus its opponent. */
const MAX_PHASE_NODES = 6000;

/**
 * Every unit in the phase's tree, with its parent and stored position.
 *
 * Units are found two ways and merged: through the hierarchy's edges, and by
 * the phase key prefix. The prefix catches a lone unit — placed with nothing
 * above or below it, so it has no edge to be found by.
 */
export async function loadPhaseForest(hierarchyKey: string, phaseId: string): Promise<PhaseForest> {
  const parentOf = new Map<string, string>();
  const keys = new Set<string>();

  let cursor: string | undefined;
  do {
    const page = await client(NxgUnitHierachyEdge)
      .where({ hierarchyKey: { $eq: hierarchyKey } })
      .fetchPage({ $pageSize: 1000, $nextPageToken: cursor });
    for (const e of page.data) {
      if (!e.parentUnitKey || !e.childUnitKey) continue;
      parentOf.set(e.childUnitKey, e.parentUnitKey);
      keys.add(e.parentUnitKey);
      keys.add(e.childUnitKey);
    }
    cursor = page.nextPageToken;
  } while (cursor && keys.size < MAX_PHASE_NODES);

  const loaded = new Map<string, NxgUnit.OsdkInstance>();
  try {
    let unitCursor: string | undefined;
    do {
      const page = await client(NxgUnit)
        .where({ primaryKey_: { $startsWith: phaseUnitKeyPrefix(phaseId) } })
        .fetchPage({ $pageSize: 1000, $nextPageToken: unitCursor });
      for (const u of page.data) loaded.set(u.primaryKey_, u);
      unitCursor = page.nextPageToken;
    } while (unitCursor && loaded.size < MAX_PHASE_NODES);
  } catch (err) {
    // Not every backend supports prefix filters on the primary key. Edges
    // still find every unit that is connected to something.
    console.warn("[phaseOrbat] prefix lookup unavailable; using edges only:", err);
  }

  const missing = [...keys].filter((k) => !loaded.has(k));
  for (const [k, u] of await fetchUnits(missing)) loaded.set(k, u);

  const nodes: ForestNode[] = [];
  for (const [key, u] of loaded) {
    if (nodes.length >= MAX_PHASE_NODES) break;
    nodes.push({
      key,
      parentKey: parentOf.get(key) ?? null,
      label: u.unitIdentifier ?? key,
      echelon: u.echelon ?? "",
      sidc: u.sidc ?? "",
      side: sideForSidc(u.sidc ?? undefined),
      entityType: u.entityType ?? "organisation",
      lat: u.latitude ?? null,
      lng: u.longitude ?? null,
    });
  }
  return { nodes, truncated: loaded.size > nodes.length || keys.size >= MAX_PHASE_NODES };
}

// ─── Generation helpers ──────────────────────────────────────────────────────

let _swordIndex: Promise<SwordFormationIndex | undefined> | undefined;

/** SWORD catalogue, loaded once. Absent → structural ORBATs, reported by the asset gate. */
function swordIndex(): Promise<SwordFormationIndex | undefined> {
  _swordIndex ??= loadSwordFormations().catch((err) => {
    console.warn("[phaseOrbat] SWORD catalogue unavailable; generating structural ORBATs:", err);
    _swordIndex = undefined;
    return undefined;
  });
  return _swordIndex;
}

/** What a generated tree is rooted on. */
export interface UnitSpec {
  label: string;
  sidc: string;
  templateId?: string;
}

async function generateTree(
  spec: UnitSpec,
  lat: number,
  lng: number,
  generate: boolean,
  depth: number = Number.POSITIVE_INFINITY,
): Promise<{ tree: CompositionNode; cap: number; truncated: boolean }> {
  const placed: PlacedUnit = {
    id: "spec",
    templateId: spec.templateId ?? "",
    label: spec.label,
    sidc: spec.sidc,
    lat,
    lng,
  };
  const cap = autoOrbatCapFor(echelonForPlacedUnit(placed));
  const formations = generate ? await swordIndex() : undefined;
  const report = buildOrbatSkeletonWithReport(placed, {
    depth: generate ? depth : 0,
    maxNodes: cap,
    swordFormations: formations,
    expandAutomat: formations ? (node) => expandAutomat(node, formations) : undefined,
  });
  return { tree: report.root, cap, truncated: report.truncated };
}

export interface PhaseWriteResult {
  hierarchyKey: string;
  rootUnitKey: string;
  unitCount: number;
  /** True when the echelon cap stopped generation early. */
  truncated: boolean;
  cap: number;
}

// ─── Place a unit ────────────────────────────────────────────────────────────

export interface PlaceUnitRequest {
  spec: UnitSpec;
  lat: number;
  lng: number;
  /** Build its ORBAT beneath it, to the echelon cap. */
  generateBeneath: boolean;
  /** Levels to generate; default all the way down (capped by echelon). */
  depth?: number;
}

/**
 * Place a unit into the phase command tree: the unit (+ its generated ORBAT
 * when asked), its parent edge and its adoption edges, in ONE reconcile.
 * Parent and adoptees come from what is already in the phase (`index`).
 */
export async function placeUnitInPhase(
  target: PhaseTarget,
  index: ForestIndex,
  request: PlaceUnitRequest,
): Promise<PhaseWriteResult & { parentKey: string | null; adopted: string[]; level: number }> {
  const ref = await resolvePhaseHierarchy(target);
  const placed = { templateId: request.spec.templateId ?? "", sidc: request.spec.sidc };
  const echelon = echelonForPlacedUnit(placed);
  const candidate = {
    echelon,
    side: sideForSidc(request.spec.sidc),
    lat: request.lat,
    lng: request.lng,
  };
  const parentKey = chooseParent(index, candidate);
  const adopted = adoptees(index, candidate);
  const level = landingLevel(index, parentKey);

  const { tree, cap, truncated } = await generateTree(
    request.spec,
    request.lat,
    request.lng,
    request.generateBeneath,
    request.depth,
  );
  const built = placeUnitPayload(ref, {
    tree,
    lat: request.lat,
    lng: request.lng,
    phaseId: target.phaseId,
    parentKey,
    adopteeKeys: adopted,
    landingDepth: level,
    maxUnits: cap,
  });
  await applyReconcile(built.payload);
  return {
    hierarchyKey: ref.hierarchyKey,
    rootUnitKey: built.rootUnitKey,
    unitCount: built.unitCount,
    truncated: truncated || built.truncated,
    cap,
    parentKey,
    adopted,
    level,
  };
}

/**
 * Auto-generate a full ORBAT for a placed unit that has none in this phase,
 * slotting its root into the phase tree like a Place unit does.
 */
export async function autoGeneratePhaseOrbat(
  target: PhaseTarget,
  index: ForestIndex,
  placement: Pick<PlacedUnit, "label" | "sidc" | "templateId" | "lat" | "lng">,
): Promise<PhaseWriteResult> {
  return placeUnitInPhase(target, index, {
    spec: { label: placement.label, sidc: placement.sidc, templateId: placement.templateId },
    lat: placement.lat,
    lng: placement.lng,
    generateBeneath: true,
  });
}

// ─── Generate beneath / change parent / remove ───────────────────────────────

/**
 * Expand an ORBAT under an existing tree unit. The unit's key and row are
 * reused untouched. Refuses when the unit already has subordinates: merging a
 * generated tree into a hand-built one is a judgement the planner should make.
 */
export async function generateBeneathNode(
  target: PhaseTarget,
  index: ForestIndex,
  key: string,
): Promise<PhaseWriteResult> {
  const node = index.nodes.get(key);
  if (!node) throw new Error("That unit is no longer in this phase's ORBAT.");
  if ((index.childrenOf.get(key)?.length ?? 0) > 0) {
    throw new Error(`"${node.label}" already has subordinates.`);
  }
  if (!isNativeToPhase(key, target.phaseId)) {
    throw new Error(`"${node.label}" belongs to another phase — save this phase's ORBAT first.`);
  }
  const ref = await resolvePhaseHierarchy(target);
  const pos = effectivePosition(index, key) ?? { lat: 0, lng: 0 };
  const { tree, cap, truncated } = await generateTree(
    { label: node.label, sidc: node.sidc },
    pos.lat,
    pos.lng,
    true,
  );
  const built = generateBeneathPayload(ref, {
    existingKey: key,
    tree,
    lat: pos.lat,
    lng: pos.lng,
    phaseId: target.phaseId,
    depth: index.depthOf.get(key) ?? 0,
    maxUnits: cap,
  });
  await applyReconcile(built.payload);
  return {
    hierarchyKey: ref.hierarchyKey,
    rootUnitKey: key,
    unitCount: built.unitCount,
    truncated: truncated || built.truncated,
    cap,
  };
}

/** Re-parent a unit (and so its subtree). null makes it a root. */
export async function changeParentInPhase(
  target: PhaseTarget,
  index: ForestIndex,
  key: string,
  parentOverrideKey: string | null,
): Promise<void> {
  const ref = await resolvePhaseHierarchy(target);
  await applyReconcile(changeParentPayload(ref, key, parentOverrideKey, index));
}

/**
 * Remove a unit and everything under it from the phase. Only phase-native
 * units are ever deleted — an inherited unit belongs to another phase.
 */
export async function removeSubtreeInPhase(
  target: PhaseTarget,
  index: ForestIndex,
  key: string,
): Promise<number> {
  const keys = [key, ...descendantsOf(index, key)].filter((k) =>
    isNativeToPhase(k, target.phaseId),
  );
  // Leaves first, so no edge ever points at a unit that is already gone.
  keys.reverse();
  for (let i = 0; i < keys.length; i += 500) {
    await client(deleteNxgUnit).batchApplyAction(
      keys
        .slice(i, i + 500)
        .map((primaryKey) => ({ primaryKey, cascadeSymbol: true, cascadeEdges: true })),
    );
  }
  return keys.length;
}

// ─── Save an edited tree (ORBAT Manager) ─────────────────────────────────────

/**
 * Write an edited ORBAT tree into a phase's hierarchy (creating the hierarchy
 * if needed): one reconcile for every unit, edge and re-parent, then delete
 * the removed units native to this phase. Existing units keep their stored
 * positions. See treeSavePayload.
 */
export async function saveTreeToPhase(
  target: PhaseTarget,
  input: TreeSaveInput,
): Promise<TreeSaveParts> {
  const ref = await resolvePhaseHierarchy(target);
  const parts = treeSavePayload(ref, input);
  await applyReconcile(parts.payload);
  const keys = [...parts.deletableKeys].reverse();
  for (let i = 0; i < keys.length; i += 500) {
    await client(deleteNxgUnit).batchApplyAction(
      keys
        .slice(i, i + 500)
        .map((primaryKey) => ({ primaryKey, cascadeSymbol: true, cascadeEdges: true })),
    );
  }
  return parts;
}

// ─── Moves ───────────────────────────────────────────────────────────────────

/** Persist dragged positions — primaryKey + lat/lng only, 500 per batch. */
export async function moveOrbatUnits(moves: PositionMap): Promise<void> {
  const rows = [...moves].map(([primaryKey, p]) => ({
    primaryKey,
    latitude: p.lat,
    longitude: p.lng,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await client(updateNxgUnit).batchApplyAction(rows.slice(i, i + 500));
  }
}

// ─── Save the phase ORBAT ────────────────────────────────────────────────────

export interface SavePhaseOrbatResult {
  hierarchyKey: string;
  /** Placements now pointing at a phase-native root — link these on the map. */
  linked: { placementId: string; rootUnitKey: string }[];
  /** Units copied in from other phases / the legacy hierarchy. */
  clonedUnits: number;
  /** Native units moved so their tree sits under the placement again. */
  movedUnits: number;
  /** Placements with no ORBAT at all, by label. Reported, not generated. */
  withoutOrbat: string[];
}

/**
 * Make the phase ORBAT complete and CSE-ready.
 *
 *   1. Placements whose ORBAT lives elsewhere are CLONED in: fresh phase keys,
 *      re-laid around the placement's current position.
 *   2. Native ORBATs whose root has drifted from its placement are moved back
 *      under it, whole subtree by the same offset.
 *   3. Parentage among the placed roots is reconciled — keeping any parent the
 *      tree already has, deriving the rest.
 *
 * Steps 1 and 3 are one reconcile call. Placements with no ORBAT are listed,
 * not generated: generating is a planner decision (right-click → Auto-generate).
 */
export async function savePhaseOrbat(
  target: PhaseTarget,
  index: ForestIndex,
  placements: PlacedUnit[],
): Promise<SavePhaseOrbatResult> {
  const ref = await resolvePhaseHierarchy(target);
  const { native, foreign, missing } = partitionPhasePlacements(placements, target.phaseId);

  // 1. Clone foreign ORBATs — outermost first. A placement whose source
  //    unit sits inside another placement's tree is NOT cloned again: it is
  //    linked to its copy within that tree, then pinned to its own position.
  const units: PhaseReconcilePayload["units"] = [];
  const edges: PhaseReconcilePayload["unitHierarchyEdges"] = [];
  const linked: SavePhaseOrbatResult["linked"] = [];
  const roots: { placement: PlacedUnit; rootUnitKey: string }[] = [];

  const sources = new Map<string, CompositionNode>();
  for (const placement of foreign) {
    const key = placement.orbatRootUnitKey!;
    if (sources.has(key)) continue;
    const source = placement.orbatHierarchyKey
      ? await loadOrbatSubtree(placement.orbatHierarchyKey, key)
      : null;
    if (source) sources.set(key, source.root);
  }
  const containedBy = new Map<string, string>();
  for (const [outerKey, tree] of sources) {
    const walk = (node: CompositionNode) => {
      for (const child of node.children) {
        if (sources.has(child.id) && child.id !== outerKey) containedBy.set(child.id, outerKey);
        walk(child);
      }
    };
    walk(tree);
  }

  const copyOf = new Map<string, string>();
  const pins = new Map<string, { lat: number; lng: number }>();
  for (const placement of foreign) {
    const sourceKey = placement.orbatRootUnitKey!;
    if (!sources.has(sourceKey) || containedBy.has(sourceKey) || copyOf.has(sourceKey)) continue;
    const parts = cloneSubtreePayloadParts(sources.get(sourceKey)!, placement, target.phaseId);
    units.push(...parts.units);
    edges.push(...parts.edges);
    for (const [from, to] of parts.idMap) copyOf.set(from, to);
  }
  for (const placement of foreign) {
    const newRoot = copyOf.get(placement.orbatRootUnitKey!);
    if (!newRoot) {
      missing.push(placement);
      continue;
    }
    pins.set(newRoot, { lat: placement.lat, lng: placement.lng });
    linked.push({ placementId: placement.id, rootUnitKey: newRoot });
    roots.push({ placement, rootUnitKey: newRoot });
  }
  pinSubtrees(units, edges, pins);
  // Copies inside another copy already have their parent edge — the copy of
  // the edge they had in the source. Parentage must not second-guess that.
  const copiedEdgeChildren = new Set(edges.map((e) => e.childUnitKey));

  // 2. Re-lay native ORBATs under their placement. Outer trees first, so a
  //    nested placement's own position is applied last and sticks.
  const moves: PositionMap = new Map();
  const nativeByDepth = [...native].sort(
    (a, b) =>
      (index.depthOf.get(a.orbatRootUnitKey!) ?? 0) - (index.depthOf.get(b.orbatRootUnitKey!) ?? 0),
  );
  for (const placement of nativeByDepth) {
    const key = placement.orbatRootUnitKey!;
    roots.push({ placement, rootUnitKey: key });
    if (!index.nodes.has(key)) continue;
    const at = moves.get(key) ?? effectivePosition(index, key);
    if (!at) continue;
    const driftM = Math.hypot(
      (at.lat - placement.lat) * 111_000,
      (at.lng - placement.lng) * 64_000,
    );
    if (driftM < 1) continue;
    const dLat = placement.lat - at.lat;
    const dLng = placement.lng - at.lng;
    for (const k of [key, ...descendantsOf(index, key)]) {
      const current = moves.get(k) ?? effectivePosition(index, k);
      const node = index.nodes.get(k);
      if (!current || !node || node.lat == null || node.lng == null) {
        if (k === key) moves.set(k, { lat: placement.lat, lng: placement.lng });
        continue;
      }
      moves.set(k, { lat: current.lat + dLat, lng: current.lng + dLng });
    }
  }

  // 3. One reconcile: clones + parentage among every placed root.
  if (roots.length > 0 || units.length > 0) {
    const existing = treeViewOf(index);
    const copiedParent = new Map(edges.map((e) => [e.childUnitKey, e.parentUnitKey]));
    // A copied unit's parent is the copy of its source parent.
    const parentOf = (key: string) =>
      copiedEdgeChildren.has(key) ? copiedParent.get(key)! : existing.parentOf(key);
    await applyReconcile(
      phasePlacementParentage(
        ref,
        roots,
        {
          parentOf,
          isBelow: (maybeDescendant, ancestor) => {
            const seen = new Set<string>();
            for (let k = parentOf(maybeDescendant); k && !seen.has(k); k = parentOf(k)) {
              if (k === ancestor) return true;
              seen.add(k);
            }
            return false;
          },
        },
        { units, edges },
      ),
    );
  }
  if (moves.size > 0) await moveOrbatUnits(moves);

  return {
    hierarchyKey: ref.hierarchyKey,
    linked,
    clonedUnits: units.length,
    movedUnits: moves.size,
    withoutOrbat: missing.map((p) => p.label),
  };
}
// ─── ORBAT Manager: Define flow ──────────────────────────────────────────────

/**
 * Write a hand-built ORBAT from the ORBAT Manager into one phase: phase-native
 * keys, children ringed around the placed position, root slotted into the
 * phase tree like a placed unit.
 */
export async function commitDefinedOrbatToPhase(
  target: PhaseTarget,
  root: CompositionNode,
  at: { lat: number; lng: number },
  side: Side,
): Promise<PhaseWriteResult> {
  const ref = await resolvePhaseHierarchy(target);
  const forest = await loadPhaseForest(ref.hierarchyKey, target.phaseId);
  const index = indexForest(forest.nodes);
  const candidate = { echelon: root.echelon, side, lat: at.lat, lng: at.lng };
  const parentKey = chooseParent(index, candidate);
  const built = placeUnitPayload(ref, {
    tree: root,
    lat: at.lat,
    lng: at.lng,
    phaseId: target.phaseId,
    parentKey,
    adopteeKeys: adoptees(index, candidate),
    landingDepth: landingLevel(index, parentKey),
  });
  await applyReconcile(built.payload);
  return {
    hierarchyKey: ref.hierarchyKey,
    rootUnitKey: built.rootUnitKey,
    unitCount: built.unitCount,
    truncated: false,
    cap: Number.POSITIVE_INFINITY,
  };
}

// ─── Debounced parentage reconcile ───────────────────────────────────────────

export interface PhaseReconcileRequest {
  target: PhaseTarget;
  index: ForestIndex;
  placements: PlacedUnit[];
}

/**
 * Parentage-only reconcile after map edits, debounced. Only touches phases
 * that already own an ORBAT, and only placements whose ORBAT is native to the
 * phase — inherited ones are brought in by an explicit Save.
 */
export function createDebouncedPhaseReconciler(delayMs = 1500): {
  schedule: (request: PhaseReconcileRequest) => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: PhaseReconcileRequest | undefined;
  const lastApplied = new Map<string, string>();

  const run = async () => {
    const request = pending;
    pending = undefined;
    if (!request) return;
    const { target, index, placements } = request;
    const { native } = partitionPhasePlacements(placements, target.phaseId);
    if (native.length === 0) return;
    try {
      if (!(await phaseHierarchyExists(target))) return;
      const ref = phaseRef(target);
      const payload = phasePlacementParentage(
        ref,
        native.map((placement) => ({ placement, rootUnitKey: placement.orbatRootUnitKey! })),
        treeViewOf(index),
      );
      if (payload.managedChildUnitKeys.length === 0) return;
      const json = JSON.stringify({
        ...payload,
        unitHierarchy: { ...payload.unitHierarchy, validFrom: "" },
      });
      if (lastApplied.get(ref.hierarchyKey) === json) return;
      await applyReconcile(payload);
      lastApplied.set(ref.hierarchyKey, json);
    } catch (err) {
      console.warn(`[phaseOrbat] reconcile for ${target.phaseId} failed:`, err);
    }
  };

  return {
    schedule: (request) => {
      pending = request;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), delayMs);
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}
