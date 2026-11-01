/**
 * phaseGroupStore.ts
 *
 * Runtime store for "Operation Phase Groups" — the data model that ties
 * multiple imported phase payloads together into a single operation timeline.
 *
 * Core idea
 * ─────────
 * The first phase imported for an operation establishes the CANONICAL unit
 * tree (CompositionNode root + node ids).  Every subsequent phase for the
 * same operation is stored as a POSITION OVERLAY — the same node ids, a
 * different `positionsById` map.  Switching phases on the map only swaps
 * `mapPositions`; the mounted unit tree never changes.
 *
 * Relationship types (e.g. OPCON → TACON across phases) are stored per-phase
 * in `relationshipsByEdgeId` (keyed by child node id).  The structure view
 * will use this later; for now the field is populated from the payload but
 * not yet visualised.
 *
 * Manual linking
 * ─────────────
 * The upstream payload may arrive WITHOUT an `operationKey`, or the user may
 * import a phase from a different source (paste-in).  In those cases the App
 * presents a "Link phase" dialog so the user can manually assign the import
 * to an existing group, or create a new group from it.
 *
 * Persistence
 * ──────────
 * Groups are stored in sessionStorage under `orbat_phase_groups_v1`.
 * They are NOT written to Foundry — they are session-scoped scratch state
 * that lives alongside the template ontology store.
 *
 * Future
 * ──────
 * When the upstream app switches from JSON payloads to Foundry objects, the
 * `PhaseSlot.sourceRef` field will carry the object RID/key so the group can
 * be re-hydrated from the ontology on reload rather than from sessionStorage.
 */

import type { CompositionNode } from "@/shared/types";
import type { NodePosition } from "./localStore";
import { positionsObjectToMap } from "./phaseOrbatIngest";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A single phase within an operation — positions and (later) relationships
 * for the canonical unit tree.
 */
export interface PhaseSlot {
  /** Stable runtime id — uuid assigned on creation. */
  id: string;
  /** Human-readable label, e.g. "Phase 1 — Advance to Contact". */
  phaseName: string;
  /** Sort order within the group (0-based). */
  phaseIndex: number;
  /**
   * Per-node positions for this phase.
   * Keys are CompositionNode ids from the GROUP's canonical tree.
   * Plain object so it survives JSON.stringify / sessionStorage.
   */
  positionsById: Record<string, NodePosition>;
  /**
   * Per-edge relationship type overrides for this phase.
   * Keyed by CHILD CompositionNode id (each node has one parent in a tree,
   * so the child id uniquely identifies the edge).
   * Populated when the payload carries `relationshipToParent` on units.
   * STUB — not yet consumed by the structure view.
   */
  relationshipsByEdgeId: Record<string, string>;
  /**
   * Optional back-reference to the Foundry object / template that sourced
   * this phase.  Will be a Foundry object RID once the upstream switches from
   * JSON to objects; for now it stores the HierarchyTemplate.id from the
   * ontology write so we can cross-reference.
   */
  sourceRef?: string | null;
}

/**
 * One operation's complete multi-phase timeline.
 *
 * `canonicalRoot` is the unit tree shared by ALL phases — same ids, same
 * hierarchy.  Only positions and relationship types differ per phase.
 */
export interface OperationPhaseGroup {
  /** Stable runtime id — uuid assigned on creation. */
  id: string;
  /**
   * The Workshop operationKey this group belongs to, OR a user-assigned name
   * when the group was created from a paste-in without an op key.
   */
  operationKey: string;
  /** The shared unit tree.  Node ids are the same keys used in PhaseSlot.positionsById. */
  canonicalRoot: CompositionNode;
  /** Ordered list of phases.  Sorted by phaseIndex before display. */
  phases: PhaseSlot[];
  /** ISO timestamp — used to order groups in the UI. */
  createdAt: string;
}

// ─── Session storage ──────────────────────────────────────────────────────────

const STORAGE_KEY = "orbat_phase_groups_v1";

export function loadPhaseGroups(): OperationPhaseGroup[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as OperationPhaseGroup[];
  } catch { /* ignore */ }
  return [];
}

export function savePhaseGroups(groups: OperationPhaseGroup[]): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(groups)); } catch { /* quota */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string { return crypto.randomUUID(); }
function now(): string { return new Date().toISOString(); }

/**
 * Return a runtime NodePositionMap (Map<id, NodePosition>) for a given phase
 * slot — ready to hand directly to `setMapPositions`.
 */
export function phaseSlotToPositionMap(slot: PhaseSlot): Map<string, NodePosition> {
  return positionsObjectToMap(slot.positionsById);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a brand-new group from a Phase 1 import.
 * The incoming CompositionNode tree becomes the canonical root for the group.
 */
export function createPhaseGroup(
  operationKey: string,
  canonicalRoot: CompositionNode,
  firstPhase: Omit<PhaseSlot, "id" | "phaseIndex">,
): OperationPhaseGroup {
  const slot: PhaseSlot = { ...firstPhase, id: uid(), phaseIndex: 0 };
  return {
    id: uid(),
    operationKey,
    canonicalRoot,
    phases: [slot],
    createdAt: now(),
  };
}

/**
 * Add a new phase slot to an existing group.
 * `positionsById` keys must already be remapped to the group's canonical ids
 * before calling this (see `matchIncomingToBaseline` in phaseOrbatIngest.ts).
 */
export function addPhaseToGroup(
  group: OperationPhaseGroup,
  newPhase: Omit<PhaseSlot, "id" | "phaseIndex">,
  explicitIndex?: number,
): OperationPhaseGroup {
  const phaseIndex = explicitIndex ?? group.phases.length;
  const slot: PhaseSlot = { ...newPhase, id: uid(), phaseIndex };
  return {
    ...group,
    phases: [...group.phases, slot].sort((a, b) => a.phaseIndex - b.phaseIndex),
  };
}

/**
 * Rename a phase slot within a group.
 */
export function renamePhase(
  group: OperationPhaseGroup,
  phaseId: string,
  newName: string,
): OperationPhaseGroup {
  return {
    ...group,
    phases: group.phases.map((p) =>
      p.id === phaseId ? { ...p, phaseName: newName } : p,
    ),
  };
}

/**
 * Remove a phase slot from a group.  Re-indexes remaining slots.
 */
export function removePhase(
  group: OperationPhaseGroup,
  phaseId: string,
): OperationPhaseGroup {
  const remaining = group.phases
    .filter((p) => p.id !== phaseId)
    .map((p, i) => ({ ...p, phaseIndex: i }));
  return { ...group, phases: remaining };
}

/**
 * Reorder phases by dragging — accepts the new ordered array of phase ids.
 * Re-assigns phaseIndex to match the new order.
 */
export function reorderPhases(
  group: OperationPhaseGroup,
  orderedIds: string[],
): OperationPhaseGroup {
  const byId = new Map(group.phases.map((p) => [p.id, p]));
  const reordered = orderedIds
    .map((id, i) => {
      const p = byId.get(id);
      return p ? { ...p, phaseIndex: i } : null;
    })
    .filter((p): p is PhaseSlot => p !== null);
  return { ...group, phases: reordered };
}
