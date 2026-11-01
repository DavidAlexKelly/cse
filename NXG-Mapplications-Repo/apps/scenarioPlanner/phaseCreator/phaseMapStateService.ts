// src/apps/scenarioPlanner/phaseCreator/phaseMapStateService.ts
//
// Service layer for persisting phase ORBAT data to the
// [NXG-O] Template Orbat Graph ontology object type.
//
// ─── Side-splitting behaviour ────────────────────────────────────────────────
//
// Units are classified as blue (friendly) or red (OPFOR).  The pipeline
// ALWAYS runs for BOTH sides that have ≥ 1 unit — sequentially so that one
// side's failure can be surfaced clearly without aborting the other.
//
//   "{operationName} - {phaseName} - Blue ORBAT Template"   ← friendly units
//   "{operationName} - {phaseName} - Red ORBAT Template"    ← OPFOR units
//   "{operationName} - {phaseName} - ORBAT Template"        ← single-side fallback
//
// ─── Robustness guarantees ───────────────────────────────────────────────────
//
// 1. LLM retry (up to LLM_MAX_ATTEMPTS):
//      Each LLM call is retried on empty / non-JSON / structurally-invalid
//      output.  The cache is bypassed on retry so the model gets another shot.
//      A retry warning is surfaced in the console so operators can track flaky
//      responses without enabling debug logging.
//
// 2. Post-write verification:
//      After createNxgOtemplateOrbatGraph succeeds we immediately re-query
//      the object by name.  If it is not found within VERIFY_POLL_ATTEMPTS
//      attempts (with a short delay between each) we throw a clear error so
//      the UI shows "Write succeeded but object not visible — check ontology"
//      rather than silently reporting success when the record is missing.
//
// 3. Independent side failures:
//      Both sides are always attempted.  A failure on one side populates
//      `bySide[side].error` and is included in the UI feedback without
//      aborting the other side.  Only if BOTH sides fail does the overall
//      call throw.
//
// 4. Strict output validation:
//      The LLM result must parse to a JSON object with a non-empty `units`
//      array.  If not, the pipeline retries the LLM call.  After all retries
//      are exhausted the raw map-state fallback is stored so the ORBAT Manager
//      shows a parse-error badge rather than a completely empty hierarchy.
//
// ─── Pipeline (per side) ─────────────────────────────────────────────────────
//   1. Validate inputs (phaseId, non-empty units).
//   2. Filter map state to this side.
//   3. Serialise + extract units section.
//   4. Call llmPhaseToOrbat with retry (up to LLM_MAX_ATTEMPTS).
//   5. Parse + validate LLM output; retry on failure.
//   6. Build templateJson (orbat payload + parentNodeName override).
//   7. createNxgOtemplateOrbatGraph action.
//   8. Post-write verification poll (read back by name).
//   9. Register primary key in the in-memory registry.
//
// Debounce:
//   Callers should debounce calls to `syncPhaseMapState` — 1500 ms suggested.

import { client } from "@/client";
import {
  createNxgOtemplateOrbatGraph,
  editNxgOtemplateOrbatGraph,
  NxgOTemplateOrbatGraph,
  llmPhaseToOrbat,
} from "@nxg-simulation-execution-testing/sdk";
import type { MapPhaseState, MapUnitPlacement } from "./types";

// ── Side classification ───────────────────────────────────────────────────────

export type Side = "blue" | "red";
/**
 * Determine a unit's side.
 *
 * Priority:
 *   1. Explicit `force` field on the placed unit ("blue" | "red")
 *   2. SIDC affiliation char at position 1: F/A → blue, H/S → red
 *   3. Default: blue
 */
export function unitSide(unit: MapUnitPlacement): Side {
  if (unit.force === "red")  return "red";
  if (unit.force === "blue") return "blue";
  const affChar = (unit.sidc?.[1] ?? "F").toUpperCase();
  if (affChar === "H" || affChar === "S") return "red";
  return "blue";
}
/**
 * Return the subset of the map state that belongs to a single side.
 *
 * Rules:
 *   - `units` are filtered by side.
 *   - `arrows` are kept when their `assignedUnitId` refers to a kept unit
 *     (or when there's no assignedUnitId — treat as generic).
 *   - `objectives` are kept as-is (they are position markers, not force-owned).
 */
export function filterMapStateBySide(state: MapPhaseState, side: Side): MapPhaseState {
  const keptUnits = state.units.filter((u) => unitSide(u) === side);
  const keptUnitIds = new Set(keptUnits.map((u) => u.id));

  const keptArrows = state.arrows.filter((a) => {
    if (!a.assignedUnitId) return true;
    return keptUnitIds.has(a.assignedUnitId);
  });

  return {
    units: keptUnits,
    arrows: keptArrows,
    objectives: [...state.objectives],
  };
}
/**
 * Return the set of sides present in the map state.
 * A side is "present" if it has ≥ 1 unit.
 */
export function sidesPresent(state: MapPhaseState): Side[] {
  const seen = new Set<Side>();
  for (const u of state.units) seen.add(unitSide(u));
  return (["blue", "red"] as const).filter((s) => seen.has(s));
}

// ── Robustness / performance constants ────────────────────────────────────────
//
// These defaults are tuned so a "happy path" publish (both sides, LLM works
// first try, ontology visible immediately) costs approximately:
//   max(blue LLM latency, red LLM latency) + one create action + one read-back
// — because the two sides now run in parallel and verification is optional.
//
// Retries and verification polls remain available for flaky conditions but
// are opt-in per call via PublishOptions (see createPhaseMapState).

/** Maximum number of LLM call attempts per side before falling back to raw-map storage. */
const LLM_MAX_ATTEMPTS = 2;

/** Milliseconds to wait between LLM retry attempts. Reduced from 1500 — the LLM is stateless. */
const LLM_RETRY_DELAY_MS = 500;

/** How many times to poll after a create action to confirm the object is readable. */
const VERIFY_POLL_ATTEMPTS = 3;

/** Milliseconds between verification poll attempts. */
const VERIFY_POLL_DELAY_MS = 500;

/** Publish-time toggles for skipping the more expensive robustness steps. */
export interface PublishOptions {
  /**
   * When true, blue and red sides run in parallel (default: true).
   * Set false only if you need strictly serial console output for debugging.
   */
  parallelSides?: boolean;
  /**
   * When true (default: true), the create path polls the ontology after the
   * create action to obtain the real primary key. Without this poll the
   * update / delete paths cannot resolve the record by primary key on the
   * SAME session — they must fall back to a name lookup, which works but is
   * slower and less reliable if the operator later renames the record.
   *
   * The poll adds at most `VERIFY_POLL_ATTEMPTS × VERIFY_POLL_DELAY_MS` ms
   * per side (currently 1.5 s worst case, usually 0 ms because the first
   * poll succeeds).
   *
   * Set false only if you're happy with the update path always doing a
   * name-based lookup on subsequent publishes.
   */
  verifyWrite?: boolean;
  /**
   * Override the default LLM attempt count. Use 1 to disable retries entirely
   * (fastest path — the caller handles fallback themselves).
   */
  maxLlmAttempts?: number;
}

/** Apply defaults to a PublishOptions bag. */
function resolveOptions(o: PublishOptions | undefined): Required<PublishOptions> {
  return {
    parallelSides:  o?.parallelSides  !== false,
    // Verification defaults ON so the UI shows a real record ID that
    // downstream apps (ORBAT Manager) can operate on immediately.
    verifyWrite:    o?.verifyWrite    !== false,
    maxLlmAttempts: o?.maxLlmAttempts ?? LLM_MAX_ATTEMPTS,
  };
}

// ── In-memory registry: `${phaseId}:${side}` → template primaryKey ───────────
// Populated when create succeeds; cleared on page reload (safe — create is idempotent in effect).
// The old key format (`phaseId` alone) is also read as a fallback for any
// records created before the split behaviour was added.

function registryKey(phaseId: string, side: Side): string {
  return `${phaseId}:${side}`;
}

const _registry = new Map<string, string>();

export function getMapStateId(phaseId: string, side: Side = "blue"): string | undefined {
  return _registry.get(registryKey(phaseId, side)) ?? _registry.get(phaseId);
}

export function registerMapStateId(phaseId: string, templateKey: string, side: Side = "blue"): void {
  _registry.set(registryKey(phaseId, side), templateKey);
}

// ── Error helpers ─────────────────────────────────────────────────────────────
/**
 * Wrap a low-level error with a step-specific prefix and preserve the
 * original message so devtools show the full chain.
 *
 * Common OSDK error shapes:
 *   - Error with { errorCode, errorName, parameters } shape (validation)
 *   - "Failed to fetch NNN" style HTTP errors (network / ontology 400/403/500)
 *   - Plain Error instances thrown by client code
 */
function wrapError(step: string, err: unknown): Error {
  if (err instanceof Error) {
    // Try to extract OSDK-specific fields for better diagnostics
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyErr = err as any;
    const extras: string[] = [];
    if (anyErr.errorCode)  extras.push(`code=${anyErr.errorCode}`);
    if (anyErr.errorName)  extras.push(`name=${anyErr.errorName}`);
    if (anyErr.errorInstanceId) extras.push(`instanceId=${anyErr.errorInstanceId}`);
    if (anyErr.parameters && typeof anyErr.parameters === "object") {
  try {
        extras.push(`params=${JSON.stringify(anyErr.parameters).slice(0, 200)}`);
      } catch { /* ignore stringify errors */ }
    }
    const suffix = extras.length ? ` [${extras.join(", ")}]` : "";
    const wrapped = new Error(`${step}: ${err.message}${suffix}`);
    (wrapped as Error & { cause?: unknown }).cause = err;
    return wrapped;
  }
  return new Error(`${step}: ${String(err)}`);
}

// ── Serialisation helpers ─────────────────────────────────────────────────────
/**
 * Serialise a MapPhaseState to the compact JSON string stored in the ontology.
 * Strips React-internal fields and rounds coordinates to 6 d.p. to keep the
 * payload small (< 32 KB for typical exercise phases).
 */
export function serialiseMapState(state: MapPhaseState): string {
  const compact = {
    units: state.units.map((u) => ({
      id: u.id,
      label: u.label,
      sidc: u.sidc,
      lat: Math.round(u.lat * 1e6) / 1e6,
      lng: Math.round(u.lng * 1e6) / 1e6,
      ...(u.force ? { force: u.force } : {}),
      ...(u.templateId ? { templateId: u.templateId } : {}),
      // ORBAT linkage — must survive the round-trip through the ontology,
      // otherwise a reload would orphan every unit from its ORBAT graph.
      ...(u.orbatRootUnitKey ? { orbatRootUnitKey: u.orbatRootUnitKey } : {}),
      ...(u.orbatHierarchyKey ? { orbatHierarchyKey: u.orbatHierarchyKey } : {}),
      ...(u.orbatIsBasic ? { orbatIsBasic: true } : {}),
    })),
    arrows: state.arrows.map((a) => ({
      id: a.id,
      fromLat: Math.round(a.fromLat * 1e6) / 1e6,
      fromLng: Math.round(a.fromLng * 1e6) / 1e6,
      toLat: Math.round(a.toLat * 1e6) / 1e6,
      toLng: Math.round(a.toLng * 1e6) / 1e6,
      ...(a.lineStyle ? { lineStyle: a.lineStyle } : {}),
      ...(a.endpointStyle ? { endpointStyle: a.endpointStyle } : {}),
      ...(a.tacticLabel ? { tacticLabel: a.tacticLabel } : {}),
      ...(a.tacticSidc ? { tacticSidc: a.tacticSidc } : {}),
      ...(a.assignedUnitId ? { assignedUnitId: a.assignedUnitId } : {}),
      ...(a.targetObjectiveId ? { targetObjectiveId: a.targetObjectiveId } : {}),
    })),
    objectives: state.objectives.map((o) => ({
      id: o.id,
      name: o.name,
      lat: Math.round(o.lat * 1e6) / 1e6,
      lng: Math.round(o.lng * 1e6) / 1e6,
    })),
  };
  return JSON.stringify(compact);
}

/**
 * Extract just the `units` array from a serialised map state JSON string and
 * return it as a JSON string of the form:
 *
 *   {"units":[…]}
 *
 * This is the portion passed to `llmPhaseToOrbat` as the `description`
 * parameter — it gives the model the raw placed-unit data (id, label, SIDC,
 * lat/lng, force) rather than a free-text description.
 *
 * If parsing fails the full map state string is returned unchanged so the
 * function always returns something usable.
 */
export function extractUnitsSection(mapStateJson: string): string {
  try {
    const parsed = JSON.parse(mapStateJson) as { units?: unknown };
    if (Array.isArray(parsed.units)) {
      return JSON.stringify({ units: parsed.units });
    }
    } catch { /* fall through */ }
  // Fallback: return the full json — the LLM will still get useful data
  return mapStateJson;
}

// ── Location patching ─────────────────────────────────────────────────────────
//
// After the LLM returns its ORBAT tree we apply two passes:
//
// Pass 1 — identity reconciliation (existing code, unchanged):
//   • Units whose id matches a planner-placed unit → use the real lat/lng.
//   • LLM-invented units → clear location (ORBAT Manager auto-spread handles them).
//
// Pass 2 — geo sanity check (new):
//   • For every LLM-invented unit that still carries a location after pass 1
//     (i.e. the LLM gave it coords but the planner never placed it), verify
//     that the location is within MAX_CHILD_RADIUS_KM of the unit's resolved
//     "anchor" — the nearest ancestor whose location is known and trusted.
//   • If the coords are outside that radius, clamp them to the closest point
//     on the circle boundary (bearing from anchor → child, at exactly the
//     radius distance).
//
// Why an ancestor anchor rather than the immediate parent?
//   The LLM tree can be 3+ levels deep. A parent might itself be LLM-invented
//   with no location yet (it was stripped in pass 1). Walking up to find the
//   nearest known position gives a stable, meaningful reference.
//
// The check is skipped for planner-placed units (they already have ground truth).

type AnyUnit = Record<string, unknown>;

/** Maximum km an LLM-invented child may be from its nearest known ancestor. */
const MAX_CHILD_RADIUS_KM = 15;

// ── Geo helpers ───────────────────────────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_KM = 6371;

/**
 * Haversine distance in km between two lat/lon points.
 */
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Initial bearing (degrees, 0=N clockwise) from point A to point B.
 */
function bearingDeg(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;
  const Δλ = (lon2 - lon1) * DEG_TO_RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
}

/**
 * Destination point given a start, bearing (degrees) and distance (km).
 * Uses the spherical-earth direct formula (sufficient for ≤ 50 km).
 */
function destinationPoint(
  lat: number, lon: number,
  bearingDegrees: number, distanceKm: number,
): { lat: number; lon: number } {
  const φ1 = lat * DEG_TO_RAD;
  const λ1 = lon * DEG_TO_RAD;
  const θ  = bearingDegrees * DEG_TO_RAD;
  const δ  = distanceKm / EARTH_RADIUS_KM;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
    Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
  );

  // Normalise longitude into (-180, 180] before rounding to 6 dp.
  //
  // Previous version had the wrong operator precedence:
  //   Math.round(((λ2° + 540) % 360) - 180 * 1e6) / 1e6
  // parses as:
  //   Math.round( ((λ2° + 540) % 360) - 180_000_000 ) / 1e6
  // because `* 1e6` binds tighter than the surrounding subtraction, so the
  // clamp always emitted ~-180 000 000 for the longitude. The parentheses
  // below multiply the whole normalised expression by 1e6 as intended.
  const lonNormalised = (((λ2 * RAD_TO_DEG) + 540) % 360) - 180;
  return {
    lat: Math.round(φ2 * RAD_TO_DEG * 1e6) / 1e6,
    lon: Math.round(lonNormalised * 1e6) / 1e6,
  };
}

/**
 * Clamp a position to within `radiusKm` of an anchor.
 * Returns the position unchanged when it is already inside the radius.
 * Returns the point on the circle boundary in the same direction when outside.
 */
function clampToRadius(
  anchorLat: number, anchorLon: number,
  targetLat: number, targetLon: number,
  radiusKm: number,
): { lat: number; lon: number } {
  const dist = haversineKm(anchorLat, anchorLon, targetLat, targetLon);
  if (dist <= radiusKm) return { lat: targetLat, lon: targetLon };
  // Snap to the circle boundary in the bearing direction of the original point.
  const bearing = bearingDeg(anchorLat, anchorLon, targetLat, targetLon);
  return destinationPoint(anchorLat, anchorLon, bearing, radiusKm);
}

// ── Position map ──────────────────────────────────────────────────────────────

/**
 * Build a lookup of real Scenario Planner positions keyed by unit id.
 * These are the coordinates the human planner assigned on the map.
 */
function buildPlacedPositionMap(
  units: MapUnitPlacement[],
): Map<string, { lat: number; lon: number }> {
  const map = new Map<string, { lat: number; lon: number }>();
  for (const u of units) {
    if (u.lat !== 0 || u.lng !== 0) {
      map.set(u.id, { lat: u.lat, lon: u.lng });
    }
  }
  return map;
}

// ── Pass 1: identity reconciliation ──────────────────────────────────────────

/**
 * Walk the LLM ORBAT unit tree and:
 *   - Replace `location` with the planner's real position for matched units.
 *   - Remove `location` for LLM-invented units so auto-spread handles them.
 *
 * Returns the set of unit ids that were matched to planner positions (used
 * by pass 2 to determine which nodes are "trusted anchors").
 *
 * Mutates `unit` in-place.
 */
function reconcileUnitIdentities(
  unit: AnyUnit,
  placedPositions: Map<string, { lat: number; lon: number }>,
  placedIds: Set<string>,       // populated by this function
): void {
  const id = typeof unit.unitKey === "string" ? unit.unitKey
           : typeof unit.id      === "string" ? unit.id
           : null;

  const placed = id ? placedPositions.get(id) : undefined;

  if (placed) {
    unit.location = {
      lat: Math.round(placed.lat * 1e6) / 1e6,
      lon: Math.round(placed.lon * 1e6) / 1e6,
    };
    if (id) placedIds.add(id);
  } else {
    // LLM-invented — keep whatever coords the LLM gave for now; pass 2 will
    // clamp them if they are outside the allowed radius.
    // Do NOT strip them here — we need them for the sanity-check walk below.
  }

  if (Array.isArray(unit.children)) {
    for (const child of unit.children as AnyUnit[]) {
      reconcileUnitIdentities(child, placedPositions, placedIds);
    }
  }
}

// ── Pass 2: geo sanity check ──────────────────────────────────────────────────

/**
 * Walk the tree depth-first, carrying the nearest known ancestor position
 * (`anchorLoc`) downward.  For each LLM-invented unit:
 *   - If it has no location: leave it absent (auto-spread will handle it).
 *   - If it has a location and an anchor exists: clamp to MAX_CHILD_RADIUS_KM.
 *   - If it has a location but no anchor yet: keep as-is (the LLM gave
 *     coords for a root-level invented unit; we have nothing to clamp against).
 *
 * Planner-placed units (in `placedIds`) are trusted anchors and are never
 * moved; they update `anchorLoc` for their subtree.
 */
function sanitiseChildLocations(
  unit: AnyUnit,
  placedIds: Set<string>,
  anchorLoc: { lat: number; lon: number } | null,
  radiusKm: number,
): void {
  const id = typeof unit.unitKey === "string" ? unit.unitKey
           : typeof unit.id      === "string" ? unit.id
           : null;

  const isPlaced = !!(id && placedIds.has(id));
  const loc = unit.location as { lat?: number; lon?: number } | null | undefined;
  const hasLoc = !!loc && typeof loc.lat === "number" && typeof loc.lon === "number";

  if (isPlaced) {
    // Trusted anchor — update the anchor for this subtree, leave location alone.
    if (hasLoc) {
      anchorLoc = { lat: loc!.lat as number, lon: loc!.lon as number };
    }
  } else if (hasLoc && anchorLoc) {
    // LLM-invented unit with coords and a known ancestor position.
    const clamped = clampToRadius(
      anchorLoc.lat, anchorLoc.lon,
      loc!.lat as number, loc!.lon as number,
      radiusKm,
    );
    const wasClamped =
      clamped.lat !== (loc!.lat as number) || clamped.lon !== (loc!.lon as number);
    if (wasClamped) {
      const dist = haversineKm(anchorLoc.lat, anchorLoc.lon, loc!.lat as number, loc!.lon as number);
      console.warn(
        `[patchOrbatLocations] Clamped "${String(unit.name ?? id ?? "?")}": ` +
        `${dist.toFixed(1)} km from anchor → snapped to ${radiusKm} km boundary`,
      );
      unit.location = clamped;
      // The clamped position becomes the anchor for this node's children.
      anchorLoc = clamped;
    } else {
      // Within radius — use as the new anchor for children.
      anchorLoc = { lat: loc!.lat as number, lon: loc!.lon as number };
    }
  } else if (hasLoc && !anchorLoc) {
    // Root-level LLM-invented unit with no anchor — accept as-is and use as anchor.
    anchorLoc = { lat: loc!.lat as number, lon: loc!.lon as number };
  }
  // If !hasLoc: no location to check or update; pass anchor down unchanged.

  if (Array.isArray(unit.children)) {
    for (const child of unit.children as AnyUnit[]) {
      sanitiseChildLocations(child, placedIds, anchorLoc, radiusKm);
    }
  }
}

// ── Combined patch entry point ────────────────────────────────────────────────

/**
 * Patch all locations in a parsed ORBAT object:
 *
 *   1. Replace planner-unit locations with ground-truth coords.
 *   2. Clamp LLM-invented unit coords to within MAX_CHILD_RADIUS_KM of
 *      their nearest known ancestor.
 *
 * Returns the same object (mutated) for chaining convenience.
 */
function patchOrbatLocations(
  parsedOrbat: { description?: string; units: unknown[] },
  placedPositions: Map<string, { lat: number; lon: number }>,
  radiusKm: number = MAX_CHILD_RADIUS_KM,
): { description?: string; units: unknown[] } {
  const placedIds = new Set<string>();

  // Pass 1: replace planner positions / keep LLM locations temporarily.
  for (const unit of parsedOrbat.units as AnyUnit[]) {
    reconcileUnitIdentities(unit, placedPositions, placedIds);
  }

  // Pass 2: clamp out-of-radius LLM locations.
  for (const unit of parsedOrbat.units as AnyUnit[]) {
    sanitiseChildLocations(unit, placedIds, null, radiusKm);
  }

  // Pass 3: strip any remaining LLM-invented units that have NO planner
  // anchor anywhere in the tree (i.e. a purely LLM-invented top-level unit
  // with no corresponding placed unit) only if their location is still
  // present but was never clamped (meaning pass 2 accepted it as a root
  // anchor or the radius was not breached). We do NOT strip these — the
  // LLM gave them coords deliberately and they passed the sanity check.
  // Instead, strip units that still have LLM coords AND no anchor was
  // ever established (placedIds is empty → no planner units at all →
  // this is a purely LLM-generated ORBAT and the coords are fine as-is).

  return parsedOrbat;
}

// ── LLM: units section → ORBAT JSON ──────────────────────────────────────────

/**
 * In-memory cache + single-flight dedupe for `llmPhaseToOrbat` calls.
 *
 * Two very common patterns benefit from this:
 *   1. A user hits "Publish" twice in quick succession (double-click, or a
 *      debounce fires late) — the second call returns instantly from cache.
 *   2. `updatePhaseMapState` runs the same LLM call as an earlier
 *      `createPhaseMapState` when the map hasn't changed. Cache hit avoids
 *      a 3–10 s round-trip and burns no Foundry quota.
 *
 * The cache key is `hash(unitsJson) + "|" + (nationalityHint ?? "")`; we use
 * a stable non-cryptographic FNV-1a hash so entries are ~16 chars.
 *
 * TTL is intentionally short (2 min) because the LLM is non-deterministic
 * and users may explicitly want a fresh regeneration. `pending` maps hold
 * in-flight promises so concurrent callers with the SAME input share ONE
 * network round-trip.
 */
const _LLM_CACHE = new Map<string, { at: number; result: string }>();
const _LLM_PENDING = new Map<string, Promise<string>>();
const LLM_CACHE_TTL_MS = 2 * 60 * 1000;

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // Multiply by FNV prime, keeping to 32-bit range.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function llmCacheKey(unitsJson: string, nationalityHint?: string): string {
  return `${fnv1a(unitsJson)}|${(nationalityHint ?? "").trim().toLowerCase()}`;
}

/**
 * Call `llmPhaseToOrbat` with the **units section** of the serialised map
 * state as the `description` parameter.
 *
 * The units section is a JSON string of the form:
 *   {"units":[{"id":"…","label":"…","sidc":"…","lat":…,"lng":…,"force":"…"},…]}
 *
 * Returns the raw ORBAT JSON string from the LLM.
 * Throws a specific error on failure (never returns null — callers decide
 * whether to treat it as fatal).
 *
 * Uses an in-memory cache + single-flight dedupe (see `_LLM_CACHE`).
 */
export async function callLlmPhaseToOrbat(
  unitsJson: string,
  nationalityHint?: string,
): Promise<string> {
  const key = llmCacheKey(unitsJson, nationalityHint);

  // ── 1. Cache hit (fresh) ────────────────────────────────────────────────
  const cached = _LLM_CACHE.get(key);
  if (cached && Date.now() - cached.at < LLM_CACHE_TTL_MS) {
    console.log(
      `[phaseMapStateService] llmPhaseToOrbat ✓ cache hit (${cached.result.length} chars, age ${Math.round((Date.now() - cached.at) / 1000)}s)`,
    );
    return cached.result;
  }

  // ── 2. Single-flight — another caller is already fetching this exact key
  const inflight = _LLM_PENDING.get(key);
  if (inflight) {
    console.log(`[phaseMapStateService] llmPhaseToOrbat ⏳ joining in-flight call`);
    return inflight;
  }

  // ── 3. Fresh call — record the promise so concurrent callers dedupe
  const promise = (async () => {
    try {
      const raw = await (
        client(llmPhaseToOrbat as unknown as Parameters<typeof client>[0]) as unknown as {
          executeFunction: (args: {
            description: string;
            nationalityHint?: string;
          }) => Promise<string>;
        }
      ).executeFunction({
        description: unitsJson,
        ...(nationalityHint ? { nationalityHint: nationalityHint.trim() } : {}),
      });

      if (typeof raw !== "string") {
        throw new Error(
          `LLM_PhaseToORBAT returned unexpected type '${typeof raw}' — expected string.`,
        );
      }
      if (!raw.trim()) {
        throw new Error("LLM_PhaseToORBAT returned an empty string.");
      }

      _LLM_CACHE.set(key, { at: Date.now(), result: raw });
      console.log(
        `[phaseMapStateService] llmPhaseToOrbat ✓ — ${raw.length} chars (cached under ${key})`,
      );
      return raw;
    } catch (err) {
      console.error("[phaseMapStateService] llmPhaseToOrbat failed:", err);
      throw wrapError("LLM call failed", err);
    } finally {
      _LLM_PENDING.delete(key);
    }
  })();

  _LLM_PENDING.set(key, promise);
  return promise;
}

/**
 * Manually invalidate the LLM cache. Call this when the user explicitly
 * requests a regeneration ("re-publish") to bypass a fresh cache entry.
 */
export function invalidateLlmCache(): void {
  _LLM_CACHE.clear();
}

// ── LLM with retry ────────────────────────────────────────────────────────────

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse and validate a raw LLM ORBAT string.
 *
 * Returns the parsed object when it contains a non-empty `units` array.
 * Returns null on any failure so callers can retry cleanly.
 */
function parseOrbatJson(raw: string): { description?: string; units: unknown[] } | null {
  const attempts = [
    () => JSON.parse(raw),
    () => {
      const inner = JSON.parse(raw);
      return typeof inner === "string" ? JSON.parse(inner) : inner;
    },
    () => {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      const parsed = JSON.parse(cleaned);
      return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    },
  ];

  for (const attempt of attempts) {
    try {
      const obj = attempt();
      if (
        obj &&
        typeof obj === "object" &&
        !Array.isArray(obj) &&
        Array.isArray((obj as Record<string, unknown>).units) &&
        ((obj as Record<string, unknown>).units as unknown[]).length > 0
      ) {
        return obj as { description?: string; units: unknown[] };
      }
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Call the LLM with automatic retry.
 *
 * - Bypasses the cache on retry attempts so the model gets a fresh shot.
 * - Retries when the LLM call throws OR when the returned JSON fails validation.
 * - Returns `null` after all attempts are exhausted (never throws from this function).
 */
async function callLlmWithRetry(
  unitsJson: string,
  nationalityHint: string | undefined,
  sideLabel: string,
  maxAttempts: number = LLM_MAX_ATTEMPTS,
): Promise<{ orbatJson: string; parsedOrbat: { description?: string; units: unknown[] } } | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const isRetry = attempt > 1;
    if (isRetry) {
      // Invalidate the cache so the model actually re-runs.
      _LLM_CACHE.delete(llmCacheKey(unitsJson, nationalityHint));
      console.warn(`[phaseMapStateService] [${sideLabel}] LLM retry ${attempt}/${maxAttempts}`);
      await sleep(LLM_RETRY_DELAY_MS);
    }

    let rawResult: string;
    try {
      rawResult = await callLlmPhaseToOrbat(unitsJson, nationalityHint);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[phaseMapStateService] [${sideLabel}] LLM attempt ${attempt} failed: ${msg}`);
      if (attempt === maxAttempts) return null;
      continue;
    }

    const parsed = parseOrbatJson(rawResult);
    if (parsed) return { orbatJson: rawResult, parsedOrbat: parsed };

    console.warn(`[phaseMapStateService] [${sideLabel}] LLM attempt ${attempt} returned invalid JSON.`);
  }

  console.error(`[phaseMapStateService] [${sideLabel}] All ${maxAttempts} LLM attempts failed — using rawMapJson fallback.`);
  return null;
}

// ── Post-write verification ───────────────────────────────────────────────────

/**
 * Poll until the newly-created template is visible in the ontology.
 *
 * The Foundry write path can have a short propagation delay between the
 * action returning 200 and the record being queryable. We poll up to
 * VERIFY_POLL_ATTEMPTS times before giving up.
 *
 * Returns the primary key on success; throws a descriptive error if the
 * object is still not visible after all retries.
 */
async function verifyAndReadBack(
  templateName: string,
  sideLabel: string,
  phaseId: string,
): Promise<string> {
  for (let poll = 1; poll <= VERIFY_POLL_ATTEMPTS; poll++) {
    if (poll > 1) await sleep(VERIFY_POLL_DELAY_MS);
    try {
      const results = await client(NxgOTemplateOrbatGraph)
        .where({ name: { $eq: templateName } })
        .fetchPage({ $pageSize: 1 });     // 1 is enough — we only need the most-recent

      if (results.data.length > 0) return results.data[0]!.$primaryKey;
    } catch (err) {
      console.warn(`[phaseMapStateService] [${sideLabel}] Poll ${poll} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(
    `Template "${templateName}" was created but not yet visible in the ontology after ${VERIFY_POLL_ATTEMPTS} polls — try refreshing (phase ${phaseId}).`,
  );
}

// ── Name builder ──────────────────────────────────────────────────────────────

/**
 * Build the canonical template name.
 *
 * With side (both blue and red present):
 *   "{operationName} - {phaseName} - {Side} ORBAT Template"
 *
 * Without side (only one side present):
 *   "{operationName} - {phaseName} - ORBAT Template"
 *
 * Falls back gracefully when either component is empty.
 */
function buildTemplateName(
  operationName: string,
  phaseName: string,
  side?: Side | null,
): string {
  const op = operationName.trim();
  const ph = phaseName.trim();
  const sideLabel = side ? (side === "blue" ? "Blue" : "Red") : "";
  const sideSegment = sideLabel ? `${sideLabel} ` : "";

  if (op && ph) return `${op} - ${ph} - ${sideSegment}ORBAT Template`;
  if (op)       return `${op} - ${sideSegment}ORBAT Template`;
  if (ph)       return `${ph} - ${sideSegment}ORBAT Template`;
  return `${sideSegment}ORBAT Template`.trim();
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Return today as "YYYY-MM-DD".
 *
 * Although the SDK types the `createdAt` action param as `datetime`, the
 * actual ontology property is declared as `date` in the platform.  Passing
 * a full ISO datetime (`2026-07-24T12:00:00.000Z`) produces a 400 error;
 * passing "YYYY-MM-DD" is accepted.  We follow the ORBAT Manager's
 * approach and use a plain date string.
 */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Input validation ──────────────────────────────────────────────────────────

function validateParams(params: { phaseId: string; startState: MapPhaseState }): void {
  if (!params.phaseId || !params.phaseId.trim()) {
    throw new Error("phaseId is required.");
  }
  if (!params.startState || !Array.isArray(params.startState.units)) {
    throw new Error("startState is missing or malformed (no units array).");
  }
  if (params.startState.units.length === 0) {
    throw new Error("No units on the map — place at least one unit before publishing.");
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface CreatePhaseMapStateParams {
  phaseId: string;
  /** Phase name — used as the middle component of the template name. */
  phaseName: string;
  /** Operation / exercise name — used as the first component of the template name. */
  operationName: string;
  /**
   * Human description for logging/metadata only — no longer sent to the LLM.
   * The units section of the serialised map state is sent to the LLM instead.
   */
  phaseDescription: string;
  /** The current planning map state. */
  startState: MapPhaseState;
  /** Optional nationality hint forwarded to llmPhaseToOrbat. */
  nationalityHint?: string;
  /**
   * Optional override for the top-level (parent) node name in the generated ORBAT tree.
   * When set this replaces the default synthetic HQ name that the ingest pipeline
   * would otherwise derive from the phase description.
   */
  parentNodeName?: string;
}

export interface CreatePhaseMapStateResult {
  /** Backwards-compat: primary key of the *first* (blue) template created. */
  mapStateId: string;
  /** Backwards-compat: ORBAT JSON of the first template (may be null if LLM output was invalid). */
  orbatJson: string | null;
  /** Full breakdown by side — populated when both sides are present. */
  bySide: Partial<Record<Side, { mapStateId: string; orbatJson: string | null; templateName: string }>>;
}

export interface SyncPhaseMapStateParams {
  phaseId: string;
  phaseName: string;
  operationName: string;
  phaseDescription: string;
  startState: MapPhaseState;
  nationalityHint?: string;
  /** Optional override for the top-level parent node name in the generated ORBAT tree. */
  parentNodeName?: string;
}

// ── Per-side create implementation ────────────────────────────────────────────
//
// This is the low-level worker that handles a SINGLE side.  It:
//   1. Serialises the (already-filtered-by-side) map state
//   2. Extracts units section
//   3. Calls the LLM
//   4. Validates output
//   5. Creates the ontology record with the correctly-scoped name
//   6. Reads back the primary key
//
// It is called once per side by `createPhaseMapState` (see below).

interface CreateForSideResult {
  mapStateId: string;
  orbatJson: string | null;
  templateName: string;
}

async function createForSide(
  params: CreatePhaseMapStateParams,
  sideState: MapPhaseState,
  side: Side | null,
  options: PublishOptions = {},
): Promise<CreateForSideResult> {
  const opts = resolveOptions(options);
  const sideLabel = side ?? "solo";
  const maxAttempts = opts.maxLlmAttempts;

  // Step 1: input sanity (caller already validated `params.startState`)
  if (sideState.units.length === 0) throw new Error(`No units for ${sideLabel} side.`);

  // Step 2+3: serialise + extract units in one pass.
  // We don't need extractUnitsSection to re-parse — sideState is already the
  // minimum-viable input for the LLM, so serialise directly to a { units: […] }
  // shape and skip the round-trip.
  const rawMapJson = serialiseMapState(sideState);
  const unitsJson  = JSON.stringify({ units: JSON.parse(rawMapJson).units });

  if (unitsJson.length > 65_000) {
    console.warn(`[phaseMapStateService] [${sideLabel}] Units payload large (${unitsJson.length} chars).`);
  }

  // Step 4: LLM (red never gets nationalityHint — it describes the friendly force).
  const nationalityHint = side === "red" ? undefined : params.nationalityHint;
  const t0 = Date.now();
  const llmResult = await callLlmWithRetry(unitsJson, nationalityHint, sideLabel, maxAttempts);
  console.log(`[phaseMapStateService] [${sideLabel}] LLM done in ${Date.now() - t0}ms`);

  // Step 4b: reconcile locations.
  // Units the planner placed on the map → use their real coordinates.
  // Units invented by the LLM             → strip location so the ORBAT Manager
  //                                          auto-spreads them around their parent.
  if (llmResult) {
    const placedPositions = buildPlacedPositionMap(sideState.units);
    patchOrbatLocations(llmResult.parsedOrbat, placedPositions);
    // Re-serialise so orbatJson is consistent with the patched object.
    llmResult.orbatJson = JSON.stringify(llmResult.parsedOrbat);
  }

  // Step 5: build template payload
  const templatePayload: Record<string, unknown> = llmResult
    ? { ...llmResult.parsedOrbat, ...(params.parentNodeName ? { parentNodeName: params.parentNodeName } : {}) }
    : { rawMapJson };
  const templateJson = JSON.stringify(templatePayload);

  // Step 6: create ontology object
  const templateName = buildTemplateName(params.operationName, params.phaseName, side);
  const sideTag = side ? `,side:${side}` : "";

  try {
    await client(createNxgOtemplateOrbatGraph).applyAction({
      name:         templateName,
      echelon:      "Phase",
      description:  params.phaseDescription.slice(0, 500),
      tags:         `phase-orbat,phase:${params.phaseId}${sideTag}`,
      templateJson,
      createdAt:    todayDateString(),
    });
  } catch (err) {
    throw wrapError(`Failed to create "${templateName}"`, err);
  }

  // Step 7: primary key resolution
  //   verifyWrite === true  → poll ontology (adds ≤1.5 s, usually 0)
  //   verifyWrite === false → skip poll, use synthetic key (name-based upserts still work)
  let primaryKey: string;
  if (opts.verifyWrite) {
    try {
      primaryKey = await verifyAndReadBack(templateName, sideLabel, params.phaseId);
    } catch (verifyErr) {
      // Register the synthetic key so a subsequent re-publish can still find
      // the record via the name-lookup fallback in updatePhaseMapState.
      registerMapStateId(params.phaseId, `phase-tpl-${params.phaseId}-${sideLabel}`, side ?? "blue");
      throw verifyErr;
    }
  } else {
    primaryKey = `phase-tpl-${params.phaseId}-${sideLabel}`;
  }

  registerMapStateId(params.phaseId, primaryKey, side ?? "blue");

  console.log(
    `[phaseMapStateService] [${sideLabel}] ✓ "${templateName}" (${primaryKey})`,
    llmResult ? `ORBAT ${llmResult.orbatJson.length} chars` : "rawMapJson fallback",
  );

  return { mapStateId: primaryKey, orbatJson: llmResult?.orbatJson ?? null, templateName };
}

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * Create one or two [NXG-O] Template Orbat Graph records for the given phase.
 *
 * - Both sides present → creates TWO records (Blue + Red), calling the LLM twice.
 * - Only one side     → creates ONE record with the plain " - ORBAT Template" name.
 *
 * The returned `bySide` map has one entry per side actually created.  For
 * backwards compatibility `mapStateId` and `orbatJson` at the top level
 * are the first entry (blue if both, otherwise the single side).
 *
 * Throws specific errors at each stage so the UI can show helpful messages.
 */
export async function createPhaseMapState(
  params: CreatePhaseMapStateParams,
  options: PublishOptions = {},
): Promise<CreatePhaseMapStateResult> {
  validateParams(params);

  const sides = sidesPresent(params.startState);
  if (sides.length === 0) throw new Error("No units on the map — nothing to publish.");

  const opts = resolveOptions(options);
  const parallel = opts.parallelSides;
  const bySide: CreatePhaseMapStateResult["bySide"] = {};
  const errors: Error[] = [];

  // Single-side path — no wrapping needed.
  if (sides.length === 1) {
    const singleSide = sides[0];
    const filtered   = filterMapStateBySide(params.startState, singleSide);
    try {
      bySide[singleSide] = await createForSide(params, filtered, null, options);
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  } else {
    // Two sides. Run in parallel by default — the LLM is the dominant cost
    // and the two calls are fully independent. Sequential mode remains
    // available for debugging via options.parallelSides = false.
    const jobs = (["blue", "red"] as const)
      .map((side) => {
        const filtered = filterMapStateBySide(params.startState, side);
        return filtered.units.length > 0 ? { side, filtered } : null;
      })
      .filter((j): j is { side: Side; filtered: MapPhaseState } => j !== null);

    const t0 = Date.now();
    console.log(`[phaseMapStateService] ${parallel ? "Parallel" : "Sequential"} publish for ${jobs.length} sides…`);

    if (parallel) {
      const settled = await Promise.allSettled(
        jobs.map(({ side, filtered }) => createForSide(params, filtered, side, options)),
      );
      settled.forEach((res, i) => {
        const { side } = jobs[i];
        if (res.status === "fulfilled") bySide[side] = res.value;
        else errors.push(res.reason instanceof Error ? res.reason : new Error(String(res.reason)));
      });
    } else {
      for (const { side, filtered } of jobs) {
        try { bySide[side] = await createForSide(params, filtered, side, options); }
        catch (err) { errors.push(err instanceof Error ? err : new Error(String(err))); }
      }
    }

    console.log(`[phaseMapStateService] All sides done in ${Date.now() - t0}ms (${Object.keys(bySide).length}/${jobs.length} ok)`);
  }

  if (Object.keys(bySide).length === 0) {
    const composite = new Error(
      errors.length === 1 ? errors[0].message
        : `All sides failed:\n  • ${errors.map((e) => e.message).join("\n  • ")}`,
    );
    (composite as Error & { cause?: unknown }).cause = (errors[0] as Error & { cause?: unknown })?.cause ?? errors[0];
    throw composite;
  }
  if (errors.length > 0) {
    console.warn(`[phaseMapStateService] Partial success — ${errors.length} side(s) failed:`, errors.map((e) => e.message));
  }

  const first = bySide.blue ?? bySide.red!;
  return { mapStateId: first.mapStateId, orbatJson: first.orbatJson, bySide };
}

// ── Update ────────────────────────────────────────────────────────────────────
//
// The update path re-runs the full split-publish pipeline for the given
// phase.  It attempts to locate each side's existing template by primary
// key first, then by canonical name; if neither is found for a side it
// falls through to a create.
//
// This is intentionally simple — the create path does all the heavy lifting
// and we do NOT try to be clever about detecting deltas per side.

export interface UpdatePhaseMapStateParams {
  phaseId: string;
  phaseName: string;
  operationName: string;
  /** Primary key of the existing (blue) template. Kept for API compatibility; used as a fallback lookup. */
  mapStateId: string;
  /** Description used for the LLM — e.g. "phaseName: objective". */
  phaseDescription: string;
  /** The updated planning map state. */
  startState: MapPhaseState;
  nationalityHint?: string;
  /** Optional override for the top-level parent node name in the generated ORBAT tree. */
  parentNodeName?: string;
}

/**
 * Update existing NxgOTemplateOrbatGraph object(s) when the phase map changes.
 * Falls back to create per-side if an object cannot be located.
 * Errors bubble up with step-specific messages.
 *
 * Flow (per side):
 *   1. Serialise the new MapPhaseState (filtered to this side).
 *   2. Extract the units section and pass it to llmPhaseToOrbat to regenerate
 *      the ORBAT JSON from the updated map.
 *   3. Fetch the object reference needed for editNxgOtemplateOrbatGraph.
 *   4. Apply the update action (or fall back to create if not found).
 */
export async function updatePhaseMapState(
  params: UpdatePhaseMapStateParams,
  options: PublishOptions = {},
): Promise<void> {
  validateParams(params);

  const sides = sidesPresent(params.startState);
  if (sides.length === 0) throw new Error("No units on the map — nothing to update.");

  const opts = resolveOptions(options);
  const useSideQualifier = sides.length > 1;
  const maxAttempts = opts.maxLlmAttempts;
  const errors: Error[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type OrbatGraphObj = any;

  const updateOneSide = async (side: Side): Promise<void> => {
    const filtered = filterMapStateBySide(params.startState, side);
    if (filtered.units.length === 0) return;

    const desiredName = buildTemplateName(params.operationName, params.phaseName, useSideQualifier ? side : null);

    try {
      // Serialise + build LLM input in one pass (see createForSide).
      const rawMapJson = serialiseMapState(filtered);
      const unitsJson  = JSON.stringify({ units: JSON.parse(rawMapJson).units });

      const nationalityHint = side === "red" ? undefined : params.nationalityHint;
      const llmResult = await callLlmWithRetry(unitsJson, nationalityHint, side, maxAttempts);

      // Reconcile locations: planner-placed units → real coords; LLM-invented → stripped.
      if (llmResult) {
        const placedPositions = buildPlacedPositionMap(filtered.units);
        patchOrbatLocations(llmResult.parsedOrbat, placedPositions);
        llmResult.orbatJson = JSON.stringify(llmResult.parsedOrbat);
      }

      const templatePayload = llmResult
        ? { ...llmResult.parsedOrbat, ...(params.parentNodeName ? { parentNodeName: params.parentNodeName } : {}) }
        : { rawMapJson };
      const templateJson = JSON.stringify(templatePayload);
      const sideTag = useSideQualifier ? `,side:${side}` : "";

      // Locate the existing record. Skip the primary-key lookup when the
      // registered key is a synthetic "phase-tpl-…" placeholder (from the
      // fast-path create) — it will never match a real primary key.
      let obj: OrbatGraphObj | null = null;
      const registeredKey = getMapStateId(params.phaseId, side);
      const isSyntheticKey = registeredKey?.startsWith("phase-tpl-");

      if (registeredKey && !isSyntheticKey) {
        try {
          const page = await client(NxgOTemplateOrbatGraph)
            .where({ primaryKey_: { $eq: registeredKey } })
            .fetchPage({ $pageSize: 1 });
          obj = page.data[0] ?? null;
        } catch { /* fall through to name lookup */ }
      }

      if (!obj) {
        try {
          const page = await client(NxgOTemplateOrbatGraph)
            .where({ name: { $eq: desiredName } })
            .fetchPage({ $pageSize: 1 });
          obj = page.data[0] ?? null;
        } catch { /* fall through to create */ }
      }

      if (!obj) {
        console.warn(`[phaseMapStateService] [${side}] No existing record — creating instead.`);
        await createForSide(
          {
            phaseId:          params.phaseId,
            phaseName:        params.phaseName,
            operationName:    params.operationName,
            phaseDescription: params.phaseDescription,
            startState:       params.startState,
            nationalityHint:  params.nationalityHint,
            parentNodeName:   params.parentNodeName,
          },
          filtered,
          useSideQualifier ? side : null,
          options,
        );
        return;
      }

      await client(editNxgOtemplateOrbatGraph).applyAction({
        NxgOTemplateOrbatGraph: obj,
        name:         desiredName,
        echelon:      "Phase",
        description:  params.phaseDescription.slice(0, 500),
        tags:         `phase-orbat,phase:${params.phaseId}${sideTag}`,
        templateJson,
        createdAt:    todayDateString(),
      });
      // Cache the real primary key so subsequent upserts skip the lookup dance.
      registerMapStateId(params.phaseId, obj.$primaryKey ?? desiredName, side);
      console.log(`[phaseMapStateService] [${side}] ✓ Updated "${desiredName}"`);
    } catch (err) {
      errors.push(wrapError(`Failed to update ${side} side "${desiredName}"`, err));
    }
  };

  // Parallel by default — same rationale as createPhaseMapState.
  if (opts.parallelSides) {
    await Promise.allSettled(sides.map((side) => updateOneSide(side)));
  } else {
    for (const side of sides) await updateOneSide(side);
  }

  if (errors.length > 0 && errors.length === sides.length) {
    const composite = new Error(
      `Update failed for all sides:\n  • ${errors.map((e) => e.message).join("\n  • ")}`,
    );
    (composite as Error & { cause?: unknown }).cause = (errors[0] as Error & { cause?: unknown }).cause ?? errors[0];
    throw composite;
  }
}

// ─── Ontology-backed existence check ─────────────────────────────────────────

/**
 * Query the ontology for any NxgOTemplateOrbatGraph records tagged with this
 * phaseId and seed the in-memory registry from what's found.
 *
 * This is the bridge between page reloads: the registry is in-memory only, so
 * after a reload `getMapStateId()` returns undefined even though records exist.
 * Calling this before the create/update decision ensures we always route to the
 * update path for phases that have been published before.
 *
 * The tag format written by `createForSide` is:
 *   "phase-orbat,phase:{phaseId}"           (single-side)
 *   "phase-orbat,phase:{phaseId},side:blue" (blue side of two-side publish)
 *   "phase-orbat,phase:{phaseId},side:red"  (red side of two-side publish)
 *
 * We query by the `phase:{phaseId}` substring.  If anything is found, register
 * all discovered primary keys so the update path can resolve them by ID.
 *
 * Returns true when at least one existing record was found (→ update path),
 * false when none exist (→ create path).
 */
async function probeAndSeedRegistry(phaseId: string): Promise<boolean> {
  try {
    // The OSDK `tags` property contains a comma-separated string; we match
    // on the phase-id segment so we catch both single-side and two-side records.
    const page = await client(NxgOTemplateOrbatGraph)
      .where({ tags: { $containsAllTermsInOrder: `phase:${phaseId}` } })
      .fetchPage({ $pageSize: 10 });

    if (page.data.length === 0) return false;

    for (const obj of page.data) {
      const pk   = obj.$primaryKey as string;
      const tags = (obj.tags as string | null | undefined) ?? "";

      // Determine which side this record belongs to.
      if (tags.includes("side:blue")) {
        registerMapStateId(phaseId, pk, "blue");
      } else if (tags.includes("side:red")) {
        registerMapStateId(phaseId, pk, "red");
      } else {
        // Single-side (no side qualifier) — register under blue as the canonical key.
        registerMapStateId(phaseId, pk, "blue");
      }
      console.log(`[phaseMapStateService] probeAndSeedRegistry: found "${obj.name}" (${pk}) for phase ${phaseId}`);
    }
    return true;
  } catch (err) {
    // Non-fatal — if the query fails we fall through to create, which is safe.
    console.warn(`[phaseMapStateService] probeAndSeedRegistry failed for ${phaseId}:`, err);
    return false;
  }
}

// ─── Upsert (create-or-update) ───────────────────────────────────────────────

/**
 * Create-or-update the [NXG-O] Template Orbat Graph record(s) for a phase.
 *
 * The behaviour is side-aware and survives page reloads:
 *
 *   1. Check the in-memory registry first (fast, no network call).
 *   2. If the registry is empty for this phase, query the ontology to discover
 *      any previously-created records and seed the registry from what's found.
 *   3. If existing records are found → update path (`updatePhaseMapState`).
 *   4. If none are found → create path (`createPhaseMapState`).
 *
 * The ontology probe (step 2) adds one short network round-trip on the first
 * publish after a page reload.  Subsequent publishes in the same session skip
 * the probe because the registry is already populated.
 *
 * Returns the primary key of the first created/updated record (blue if both,
 * otherwise the sole side).
 */
export async function syncPhaseMapState(
  params: SyncPhaseMapStateParams,
  options: PublishOptions = {},
): Promise<string> {
  // ── Step 1: fast registry check (in-memory, zero latency) ────────────────
  const hasBlue   = _registry.has(registryKey(params.phaseId, "blue"));
  const hasRed    = _registry.has(registryKey(params.phaseId, "red"));
  const hasLegacy = _registry.has(params.phaseId);

  const registryHit = hasBlue || hasRed || hasLegacy;

  // ── Step 2: ontology probe when registry is empty ─────────────────────────
  // This handles the "first publish after a page reload" case where the in-memory
  // registry is blank even though records already exist in the ontology.
  const foundInOntology = registryHit ? false : await probeAndSeedRegistry(params.phaseId);

  if (registryHit || foundInOntology) {
    // ── Update path ──────────────────────────────────────────────────────────
    await updatePhaseMapState({
      mapStateId: getMapStateId(params.phaseId, "blue") ?? getMapStateId(params.phaseId, "red") ?? "",
      ...params,
    }, options);
    return getMapStateId(params.phaseId, "blue") ?? getMapStateId(params.phaseId, "red") ?? "";
  }

  // ── Create path ───────────────────────────────────────────────────────────
  const result = await createPhaseMapState(params, options);
  return result.mapStateId;
}

/**
 * Probe the ontology for existing template records for a phase and return
 * whether any were found.  Seeds the in-memory registry as a side-effect so
 * the caller can use `getMapStateId` immediately after.
 *
 * Exported so the Composition tab UI can query this on mount to show the
 * correct "previously published" / "update" affordance without waiting until
 * the user clicks Publish.
 */
export async function checkPhaseHasExistingOrbat(phaseId: string): Promise<boolean> {
  if (_registry.has(registryKey(phaseId, "blue")) ||
      _registry.has(registryKey(phaseId, "red")) ||
      _registry.has(phaseId)) {
    return true;
  }
  return probeAndSeedRegistry(phaseId);
}
