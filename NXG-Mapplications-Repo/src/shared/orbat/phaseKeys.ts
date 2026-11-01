// src/shared/orbat/phaseKeys.ts
//
// Key formats for per-phase ORBATs — pure, no OSDK.
//
// ─── Why per phase ───────────────────────────────────────────────────────────
//
// CSE reads a unit's position straight off its NxgUnit. A unit is somewhere
// different in every phase, so one scenario-wide set of units can only ever
// describe one phase correctly. Each phase therefore owns its own hierarchy
// and its own COPIES of the units in it:
//
//   NxgUnitHierarchy  hier-{scenarioId}--{phaseId}    phaseKey = phaseId
//     └── NxgUnit     {phaseId}--{uuid}               own lat / lng
//
// That is exactly the shape the Translator's phase functions read
// (nxgTranslateOrbatToXmlFromPhase / nxgPreflightOrbatFromPhase select
// hierarchies by operationKey + phaseKey), and what the CSE validation action
// records its verdict against.
//
// The unit-key prefix is what makes a phase's units findable even when they
// have no edge yet (a lone unit placed with nothing above or below it), and
// what tells a placement whose ORBAT lives in THIS phase from one inherited
// from another phase or from the legacy scenario-wide hierarchy.
import type { PlacedUnit } from "../../apps/scenarioPlanner/map/types";
import { isOrbatEligible } from "./eligibility";

/** Separator between the phase id and the rest of a phase-scoped key. */
export const PHASE_KEY_SEPARATOR = "--";

/** The NxgUnitHierarchy holding one phase's ORBAT. */
export function phaseHierarchyKey(scenarioId: string, phaseId: string): string {
  return `hier-${scenarioId}${PHASE_KEY_SEPARATOR}${phaseId}`;
}

/** Display name for that hierarchy. */
/**
 * The scenario and phase a phase hierarchy key names, or null for any other
 * hierarchy (scenario-wide, legacy per-side, operation templates).
 * Inverse of phaseHierarchyKey. Scenario ids never contain the separator;
 * phase ids may, so the split is at the FIRST separator.
 */
export function parsePhaseHierarchyKey(
  key: string | null | undefined,
): { scenarioId: string; phaseId: string } | null {
  if (!key || !key.startsWith("hier-")) return null;
  const rest = key.slice("hier-".length);
  const at = rest.indexOf(PHASE_KEY_SEPARATOR);
  if (at <= 0 || at + PHASE_KEY_SEPARATOR.length >= rest.length) return null;
  return { scenarioId: rest.slice(0, at), phaseId: rest.slice(at + PHASE_KEY_SEPARATOR.length) };
}

export function phaseHierarchyName(scenarioName: string, phaseName: string): string {
  return `${scenarioName} — ${phaseName} ORBAT`;
}

/** Key prefix shared by every unit native to a phase. */
export function phaseUnitKeyPrefix(phaseId: string): string {
  return `${phaseId}${PHASE_KEY_SEPARATOR}`;
}

/** A fresh NxgUnit key for a phase. `uuid` is injectable for tests. */
export function newPhaseUnitKey(
  phaseId: string,
  uuid: () => string = () => crypto.randomUUID(),
): string {
  return `${phaseUnitKeyPrefix(phaseId)}${uuid()}`;
}

/** True when the unit was written for this phase (not shared or inherited). */
export function isNativeToPhase(unitKey: string | undefined | null, phaseId: string): boolean {
  return !!unitKey && unitKey.startsWith(phaseUnitKeyPrefix(phaseId));
}

/**
 * The phase a unit key belongs to, or null for a key that predates per-phase
 * ORBATs (scenario-wide units are plain UUIDs or hand-authored keys).
 */
export function phaseOfUnitKey(unitKey: string): string | null {
  const at = unitKey.indexOf(PHASE_KEY_SEPARATOR);
  return at > 0 ? unitKey.slice(0, at) : null;
}

export interface PhasePlacementPartition<T> {
  /** ORBAT already lives in this phase. */
  native: T[];
  /** ORBAT lives in another phase or the legacy scenario hierarchy — clone it in. */
  foreign: T[];
  /** Eligible for an ORBAT but has none. */
  missing: T[];
}

/**
 * Sort a phase's placements by where their ORBAT lives.
 *
 * Ineligible placements (ships, satellites) appear in no bucket: ORBATs are
 * land-only for now (see eligibility.ts).
 */
export function partitionPhasePlacements<
  T extends Pick<PlacedUnit, "sidc" | "templateId" | "orbatRootUnitKey">,
>(placements: T[], phaseId: string): PhasePlacementPartition<T> {
  const out: PhasePlacementPartition<T> = { native: [], foreign: [], missing: [] };
  for (const placement of placements) {
    if (!isOrbatEligible(placement)) continue;
    const key = placement.orbatRootUnitKey;
    if (!key) out.missing.push(placement);
    else if (isNativeToPhase(key, phaseId)) out.native.push(placement);
    else out.foreign.push(placement);
  }
  return out;
}
