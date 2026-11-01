// src/apps/scenarioPlanner/shared/docSidc.ts
//
// Resolves a doctrinal task name (e.g. "Occupy", "Screen", "Seize") to its
// real APP-6D / MIL-STD-2525 SIDC via the library's doctrinal task catalog.
//
// This is DISTINCT from tacticSidc:
//   - tacticSidc  = the RENDERER lookup key (e.g. "SVGOCCUPY") — tells the
//                   overlay which parametric graphic generator to invoke.
//                   Not a real SIDC; purely an internal implementation key.
//   - docSidc     = the REAL doctrinal SIDC (e.g. "GFTPO---------G") — the
//                   standards-compliant identity of the tactical task itself,
//                   independent of how it happens to be drawn on this map.
//
// Not every registered graphic maps to exactly one doctrinal task (pure
// control-measure graphics, visual variants of the same concept, etc.), so
// this can legitimately return undefined — that's expected, not a bug.
import { lookupTaskForOrder } from "@acc/app6d/core";

/**
 * Real doctrinal APP-6D SIDC for a task name, or undefined if this task has
 * no single canonical doctrinal code in the catalog.
 */
export function resolveDocSidc(taskName: string | undefined): string | undefined {
  if (!taskName) return undefined;
  return lookupTaskForOrder(taskName)?.sidc;
}
