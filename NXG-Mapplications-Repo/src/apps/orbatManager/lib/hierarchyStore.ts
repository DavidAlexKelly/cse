/**
 * hierarchyStore.ts — session store for all named Hierarchies.
 *
 * A Hierarchy is a complete operational structure:
 *   - A canonical CompositionNode tree (stable node ids)
 *   - Zero or more PhaseSlots (position + relationship overlays per phase)
 *   - A kind: "operation" | "force" | "phase"
 *
 * This replaces the separate phaseGroupStore for phase groups AND the
 * per-hierarchy editing logic that was spread across App state.
 *
 * Persistence: sessionStorage — per-session only.  Will become Foundry
 * objects in a future iteration.
 *
 * Migration note:
 *   phaseGroupStore.OperationPhaseGroup is a strict subset of Hierarchy
 *   (kind="phase").  Both stores are kept in parallel during the transition;
 *   phaseGroupStore will be removed once all call-sites are migrated.
 */

import type { CompositionNode } from "@/shared/types";
import type { NodePosition } from "./localStore";
import { positionsObjectToMap } from "./phaseOrbatIngest";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HierarchyKind = "operation" | "force" | "phase";

/**
 * A single phase (position overlay) within a Hierarchy.
 * Same shape as PhaseSlot in phaseGroupStore for compatibility.
 */
export interface HierarchyPhaseSlot {
  id: string;
  phaseName: string;
  phaseIndex: number;
  positionsById: Record<string, NodePosition>;
  relationshipsByEdgeId: Record<string, string>;
  /**
   * Back-reference for future Foundry-object linking.
   * For ontology-sourced phases this is "start:<mapStateId>" or "end:<mapStateId>".
   * For manual/user-pasted phases this is null.
   */
  sourceRef?: string | null;
  /**
   * When this slot was auto-ingested from an NxgPhaseMapState object, the
   * mapStateId of that object is stored here so the UI can badge it and link
   * back to the source.  Null for manual / pasted phases.
   */
  ontologyMapStateId?: string | null;
  /**
   * If the JSON from the NxgPhaseMapState failed to parse / validate, the
   * human-readable error message is stored here.  The phase slot still exists
   * so the hierarchy row appears in the selector (with an error indicator).
   * The `positionsById` will be empty when this is set.
   */
  parseError?: string | null;
}

/**
 * A named operational structure — the thing that appears on the map and is
 * viewed/edited in the Hierarchy tab.
 *
 * Forces and operation roots have exactly one phase (index 0) whose
 * positionsById is empty until the user places units on the map.
 * Phase-ORBAT imports have N phases, each with pre-populated positions.
 */
export interface Hierarchy {
  id: string;
  name: string;
  description: string;
  kind: HierarchyKind;
  /**
   * The operation this hierarchy belongs to (Workshop operationKey).
   * Used to group hierarchies in the selector and filter phase switcher.
   */
  operationKey: string;
  /** The canonical unit tree — node ids are stable across all phases. */
  canonicalRoot: CompositionNode;
  /**
   * Ordered phase overlays.  At minimum one entry (index 0) always exists.
   * For operation roots and forces this is a single empty placeholder slot.
   */
  phases: HierarchyPhaseSlot[];
  createdAt: string;
  updatedAt: string;
}

// ─── Session storage ──────────────────────────────────────────────────────────

const STORAGE_KEY = "orbat_hierarchies_v1";

export function loadHierarchies(): Hierarchy[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Hierarchy[];
  } catch { /* ignore */ }
  return [];
}

export function saveHierarchies(hierarchies: Hierarchy[]): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(hierarchies)); } catch { /* quota */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string { return crypto.randomUUID(); }
function now(): string { return new Date().toISOString(); }

/** Convert a phase slot's positionsById into a runtime NodePositionMap. */
export function slotToPositionMap(slot: HierarchyPhaseSlot): Map<string, NodePosition> {
  return positionsObjectToMap(slot.positionsById);
}

// ─── Factory functions ────────────────────────────────────────────────────────

/**
 * Create a Hierarchy from a CompositionNode tree with a single empty phase.
 * Used for operation roots and user-built forces.
 */
export function createHierarchyFromRoot(opts: {
  name: string;
  description?: string;
  kind: HierarchyKind;
  operationKey: string;
  root: CompositionNode;
}): Hierarchy {
  const slot: HierarchyPhaseSlot = {
    id: uid(),
    phaseName: "Phase 1",
    phaseIndex: 0,
    positionsById: {},
    relationshipsByEdgeId: {},
  };
  return {
    id: uid(),
    name: opts.name,
    description: opts.description ?? "",
    kind: opts.kind,
    operationKey: opts.operationKey,
    canonicalRoot: opts.root,
    phases: [slot],
    createdAt: now(),
    updatedAt: now(),
  };
}

/**
 * Create a Hierarchy from a phase ORBAT ingest result.
 * The first import for an operation creates the hierarchy; subsequent imports
 * add phase slots via `addPhaseSlotToHierarchy`.
 */
export function createPhaseHierarchy(opts: {
  name: string;
  description: string;
  operationKey: string;
  canonicalRoot: CompositionNode;
  firstSlot: Omit<HierarchyPhaseSlot, "id" | "phaseIndex">;
}): Hierarchy {
  const slot: HierarchyPhaseSlot = { ...opts.firstSlot, id: uid(), phaseIndex: 0 };
  return {
    id: uid(),
    name: opts.name,
    description: opts.description,
    kind: "phase",
    operationKey: opts.operationKey,
    canonicalRoot: opts.canonicalRoot,
    phases: [slot],
    createdAt: now(),
    updatedAt: now(),
  };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Add a new phase slot to an existing hierarchy. */
export function addPhaseSlotToHierarchy(
  h: Hierarchy,
  newSlot: Omit<HierarchyPhaseSlot, "id" | "phaseIndex">,
  explicitIndex?: number,
): Hierarchy {
  const phaseIndex = explicitIndex ?? h.phases.length;
  const slot: HierarchyPhaseSlot = { ...newSlot, id: uid(), phaseIndex };
  return {
    ...h,
    phases: [...h.phases, slot].sort((a, b) => a.phaseIndex - b.phaseIndex),
    updatedAt: now(),
  };
}

/** Update the canonical root (e.g. after the user edits the hierarchy). */
export function updateHierarchyRoot(
  h: Hierarchy,
  newRoot: CompositionNode,
): Hierarchy {
  return { ...h, canonicalRoot: newRoot, updatedAt: now() };
}

/** Rename a phase slot within a hierarchy. */
export function renamePhaseSlot(
  h: Hierarchy,
  slotId: string,
  newName: string,
): Hierarchy {
  return {
    ...h,
    phases: h.phases.map((p) => p.id === slotId ? { ...p, phaseName: newName } : p),
    updatedAt: now(),
  };
}

/** Remove a phase slot; re-indexes remaining. */
export function removePhaseSlot(
  h: Hierarchy,
  slotId: string,
): Hierarchy {
  const remaining = h.phases
    .filter((p) => p.id !== slotId)
    .map((p, i) => ({ ...p, phaseIndex: i }));
  return { ...h, phases: remaining, updatedAt: now() };
}

/** Swap a slot's positionsById and sourceRef (user re-assigns a template). */
export function reassignSlotPositions(
  h: Hierarchy,
  slotId: string,
  positionsById: Record<string, NodePosition>,
  sourceRef?: string | null,
): Hierarchy {
  return {
    ...h,
    phases: h.phases.map((p) =>
      p.id !== slotId ? p : { ...p, positionsById, sourceRef: sourceRef ?? p.sourceRef },
    ),
    updatedAt: now(),
  };
}

/** Get the sorted phases for a hierarchy. */
export function sortedPhases(h: Hierarchy): HierarchyPhaseSlot[] {
  return [...h.phases].sort((a, b) => a.phaseIndex - b.phaseIndex);
}

