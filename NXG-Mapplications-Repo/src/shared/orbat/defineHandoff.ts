// src/shared/orbat/defineHandoff.ts
//
// Handoff between the Scenario Planner and the ORBAT screen for "Define ORBAT".
//
// Flow:
//   planner  → requestOrbatDefinition({ …placement… })  → navigate /orbat?define=1
//   orbat    → readOrbatDefinitionRequest()             → seeds a DRAFT tree
//              …planner edits it / regenerates by prompt…
//              → Confirm  → commitOrbatForPlacement()   → publishOrbatDefinitionResult()
//              → navigate back to the planner
//   planner  → takeOrbatDefinitionResult()              → links the placement
//
// Nothing is written to the ontology until Confirm. Cancelling clears the
// request and leaves the placement without an ORBAT (red "!" stays).
//
// sessionStorage rather than URL params: the payload carries the unit's label,
// SIDC and position, which don't belong in a query string, and it survives the
// SPA navigation between the two apps in the same tab.

import type { Side } from "./scenarioOrbat";

const REQUEST_KEY = "nxg.orbat.defineRequest";
const RESULT_KEY = "nxg.orbat.defineResult";

export interface OrbatDefineRequest {
  /** Placed-unit id on the planner map — the thing being linked. */
  unitId: string;
  unitLabel: string;
  sidc: string;
  templateId?: string;
  lat: number;
  lng: number;
  side: Side;
  scenarioId: string;
  scenarioName: string;
  /**
   * Phase the placement belongs to. When set, the ORBAT is written into that
   * phase's own hierarchy (shared/orbat/phaseOrbat.commitDefinedOrbatToPhase).
   */
  phaseId?: string;
  /** The phase's display name — names the phase hierarchy if this creates it. */
  phaseName?: string;
  /** Route to return to after confirm/cancel. */
  returnTo: string;
}

export interface OrbatDefineResult {
  unitId: string;
  rootUnitKey: string;
  hierarchyKey: string;
  unitsCreated: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[orbatHandoff] could not write ${key}:`, err);
  }
}

// ── Request (planner → ORBAT screen) ────────────────────────────────────────

export function requestOrbatDefinition(request: OrbatDefineRequest): void {
  write(REQUEST_KEY, request);
}

export function readOrbatDefinitionRequest(): OrbatDefineRequest | null {
  return read<OrbatDefineRequest>(REQUEST_KEY);
}

export function clearOrbatDefinitionRequest(): void {
  try {
    sessionStorage.removeItem(REQUEST_KEY);
  } catch {
    /* ignore */
  }
}

// ── Result (ORBAT screen → planner) ─────────────────────────────────────────

export function publishOrbatDefinitionResult(result: OrbatDefineResult): void {
  write(RESULT_KEY, result);
}

/** Read and consume the result — it is only ever applied once. */
export function takeOrbatDefinitionResult(): OrbatDefineResult | null {
  const result = read<OrbatDefineResult>(RESULT_KEY);
  try {
    sessionStorage.removeItem(RESULT_KEY);
  } catch {
    /* ignore */
  }
  return result;
}
