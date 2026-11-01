/**
 * phaseOrbatIngest.ts
 *
 * Ingestion pipeline for the "LLM_PhaseToORBAT" JSON payload.
 *
 * Payload shape (from the AIP Logic function):
 *   {
 *     "description": string,
 *     "units": PhaseUnit[]
 *   }
 *
 * Each PhaseUnit has:
 *   name, echelon, icon, personnelCount, notes?, canonicalAssetId?,
 *   location?: { lat, lon },
 *   children: PhaseUnit[]
 *
 * Key behaviours implemented here:
 *
 * 1. AFFILIATION DETECTION — the LLM payload has no explicit affiliation
 *    field.  We infer it from (in priority order):
 *      a) Name prefix "OPFOR" / "ENEMY" / "HOSTILE" / "RED" (case-insensitive)
 *      b) `notes` field containing "opfor", "hostile", or "enemy"
 *      c) `canonicalAssetId` country code (NATO STAN-4159 DIS coding:
 *         country 222 = Russia → Hostile; all others → Friend)
 *      d) Parent affiliation is inherited by children (OPFOR subtrees
 *         stay Hostile all the way down even without name hints)
 *
 * 2. ICON → SIDC MAPPING — the LLM uses camelCase icon names; `makeSidc`
 *    already handles most but "mechanisedInfantry" maps to UCIZ-- (correct).
 *    Extra icons added to ICON_FUNC6 in sidc.ts if still missing.
 *
 * 3. POSITION SEMANTICS — each unit carries an ABSOLUTE lat/lon.  We store
 *    the ROOT at its absolute position; each child stores the DELTA from its
 *    parent's absolute position.  Children whose LLM-assigned location is
 *    identical to (or within ~11 m of) their parent are de-duplicated: if ALL
 *    siblings in a group are coincident they are fanned into an immediate ring
 *    at ingest time; if only SOME are coincident those are left without an
 *    entry so HierarchyMap's lazy auto-spread handles them on drill-in.
 *
 * 4. MULTIPLE TOP-LEVEL UNITS — when the payload has >1 top-level unit
 *    (common: BG HQ + OPFOR elements) they are wrapped in a synthetic
 *    headquarters node at their centroid.  The centroid is computed over
 *    ALL top-level units regardless of affiliation.
 *
 * 5. WRAPPED JSON — the templateJson stored on NxgOTemplateOrbatGraph may
 *    itself be a JSON string (double-encoded) or a plain object.  The parser
 *    handles both forms transparently.
 */

import { v4 as uuidv4 } from "uuid";
import type { CompositionNode } from "../../../types";
import { makeSidc, ECHELON_TO_SIDC_CHAR } from "./sidc";
import type { NodePosition, LatLng } from "./localStore";

// ─── Payload types ───────────────────────────────────────────────────────────

export interface PhaseLocation {
  lat: number;
  lon: number;
}

export interface PhaseUnit {
  name: string;
  echelon: string;
  icon: string;
  personnelCount: number;
  notes?: string;
  canonicalAssetId?: string | null;
  location?: PhaseLocation | null;
  unitKey?: string | null;
  relationshipToParent?: string | null;
  children: PhaseUnit[];
}

export interface PhaseOrbatPayload {
  description: string;
  units: PhaseUnit[];
  operationKey?: string | null;
  phaseIndex?: number | null;
  phaseName?: string | null;
}

export interface PhaseIngestResult {
  description: string;
  root: CompositionNode;
  positions: Map<string, NodePosition>;
  originalCoords: Map<string, LatLng>;
}

// ─── Sentinel tag ────────────────────────────────────────────────────────────

export const PHASE_TEMPLATE_TAG = "phase-orbat";

// ─── Echelon normalisation ───────────────────────────────────────────────────

const KNOWN_ECHELONS = new Set(Object.keys(ECHELON_TO_SIDC_CHAR));

function normaliseEchelon(raw: string | undefined): string {
  if (!raw) return "Battalion";
  if (KNOWN_ECHELONS.has(raw)) return raw;
  const titled = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  if (KNOWN_ECHELONS.has(titled)) return titled;
  const lower = raw.toLowerCase();
  if (KNOWN_ECHELONS.has(lower)) return lower;
  return titled;
}

// ─── Affiliation detection ───────────────────────────────────────────────────

/**
 * Hostile NATO STAN-4159 DIS country codes that the LLM uses in
 * canonicalAssetId (format "1.1.<countryCode>.<kind>.<…>").
 * 222 = Russia/Soviet; 408 = North Korea; 364 = Iran; 156 = China.
 * Add others as scenarios expand.
 */
const HOSTILE_COUNTRY_CODES = new Set([222, 408, 364, 156]);

/**
 * Infer the affiliation ("Friend" | "Hostile") for a single PhaseUnit.
 *
 * @param unit       The unit to classify.
 * @param parentAff  The parent's already-resolved affiliation (inherited).
 */
function inferAffiliation(unit: PhaseUnit, parentAff?: string): string {
  // 1. Parent inheritance — once a subtree is identified as Hostile,
  //    all children are Hostile regardless of their own name/notes.
  if (parentAff === "Hostile") return "Hostile";

  const nameLower  = (unit.name  ?? "").toLowerCase();
  const notesLower = (unit.notes ?? "").toLowerCase();

  // 2. Name-based heuristics (highest specificity)
  const hostileNamePatterns = ["opfor", "enemy", "hostile", "red force", "redfor", " red "];
  if (hostileNamePatterns.some((p) => nameLower.startsWith(p) || nameLower.includes(` ${p}`) || nameLower.includes(`${p} `))) {
    return "Hostile";
  }

  // 3. Notes field
  if (notesLower.includes("opfor") || notesLower.includes("hostile") || notesLower.includes("enemy")) {
    return "Hostile";
  }

  // 4. canonicalAssetId country code (format "1.1.<countryCode>.<…>")
  if (unit.canonicalAssetId) {
    const parts = unit.canonicalAssetId.split(".");
    const countryCode = parts.length >= 3 ? parseInt(parts[2] ?? "0", 10) : 0;
    if (HOSTILE_COUNTRY_CODES.has(countryCode)) return "Hostile";
  }

  return "Friend";
}

// ─── Parse & validate ────────────────────────────────────────────────────────

/**
 * Parse a raw JSON string into a PhaseOrbatPayload.
 *
 * Handles several real-world encoding forms produced by the pipeline:
 *
 *   1. Plain JSON:          {"description":"…","units":[…]}
 *   2. Markdown-fenced:     ```json\n{"description":…}\n```
 *   3. Double-encoded:      "{\"description\":…}"  (string containing JSON)
 *   4. Wrapped object:      {"description":"…","units":null,"rawMapJson":"…"}
 *      — when the LLM returned nothing; parsed outer object contains
 *        no usable units.
 *   5. Inner ORBAT string:  {"orbat":"{\"description\":…}"}
 *      — some template shapes wrap the ORBAT JSON inside another key.
 *
 * The function walks these cases in order and throws a clear error only
 * when none of them yield a valid payload with at least one unit.
 */
export function parsePhaseOrbatPayload(raw: string): PhaseOrbatPayload {
  // ── Strip markdown fences ─────────────────────────────────────────────────
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  if (!stripped) throw new Error("Payload is empty.");

  // ── Attempt to parse as JSON ──────────────────────────────────────────────
  let outer: unknown;
  try {
    outer = JSON.parse(stripped);
  } catch (e) {
    throw new Error(`Payload is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Unwrap a double-encoded string ────────────────────────────────────────
  // If the outer value is itself a string, try to parse it again.
  if (typeof outer === "string") {
    try {
      outer = JSON.parse(outer);
    } catch {
      throw new Error("Payload is a string but not valid JSON when re-parsed.");
    }
  }

  if (!outer || typeof outer !== "object" || Array.isArray(outer)) {
    throw new Error("Payload is not a JSON object.");
  }

  const obj = outer as Record<string, unknown>;

  // ── Case 1: direct PhaseOrbatPayload ─────────────────────────────────────
  if (Array.isArray(obj.units) && obj.units.length > 0) {
    return {
      description:  typeof obj.description === "string" ? obj.description : "",
      units:        obj.units as PhaseUnit[],
      operationKey: typeof obj.operationKey === "string" ? obj.operationKey : null,
      phaseIndex:   typeof obj.phaseIndex   === "number" ? obj.phaseIndex   : null,
      phaseName:    typeof obj.phaseName    === "string" ? obj.phaseName    : null,
    };
  }

  // ── Case 2: look for a nested ORBAT JSON string under common keys ─────────
  const candidateKeys = ["orbat", "orbatJson", "templateJson", "startStateMapJson", "payload"];
  for (const key of candidateKeys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) {
      try {
        return parsePhaseOrbatPayload(val); // recurse once
      } catch { /* try next key */ }
    }
    // Also handle the case where the value is already a parsed object
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = val as Record<string, unknown>;
      if (Array.isArray(nested.units) && nested.units.length > 0) {
        return {
          description:  typeof nested.description === "string" ? nested.description : "",
          units:        nested.units as PhaseUnit[],
          operationKey: typeof nested.operationKey === "string" ? nested.operationKey : null,
          phaseIndex:   typeof nested.phaseIndex   === "number" ? nested.phaseIndex   : null,
          phaseName:    typeof nested.phaseName    === "string" ? nested.phaseName    : null,
        };
      }
    }
  }

  // ── Case 3: rawMapJson wrapper (when LLM returned nothing) ────────────────
  // The Scenario Planner stores { rawMapJson: "<serialised map state>" }
  // when llmPhaseToOrbat returns null.  This is the placed-unit JSON, not
  // an ORBAT payload — surface a clear error so the UI shows a parse-error badge.
  if (typeof obj.rawMapJson === "string") {
    throw new Error(
      "LLM_PhaseToORBAT returned no output for this phase — the stored data is the " +
      "raw map state (placed unit positions), not an ORBAT hierarchy. " +
      "Re-publish the composition from the Scenario Planner to regenerate the ORBAT.",
    );
  }

  // ── Fallback: no usable units found ───────────────────────────────────────
  if (Array.isArray(obj.units) && obj.units.length === 0) {
    throw new Error("Payload contains no units (empty units array).");
  }
  throw new Error(
    "Payload is missing the required `units` array or it is empty. " +
    `Found keys: ${Object.keys(obj).join(", ")}`,
  );
}

// ─── PhaseUnit → CompositionNode ─────────────────────────────────────────────

/**
 * Recursively convert a PhaseUnit tree to a CompositionNode tree.
 *
 * Affiliation is inferred at each node level; once a node is Hostile,
 * all its descendants inherit Hostile so entire OPFOR subtrees are rendered
 * correctly without needing to re-examine every node name.
 */
function toCompositionNode(
  unit: PhaseUnit,
  parentAffiliation: string,
  register: (newId: string, unit: PhaseUnit) => void,
): CompositionNode {
  const id = uuidv4();
  register(id, unit);

  const affiliation = inferAffiliation(unit, parentAffiliation);
  const echelon = normaliseEchelon(unit.echelon);
  const icon = unit.icon || "infantry";

  return {
    id,
    unitIdentifier: unit.name ?? "",
    echelon,
    sidc: makeSidc(icon, echelon, affiliation, "organisation"),
    entityType: "organisation",
    militaryService: "Army",
    // Ingested phase units are organisations — structure, not entities — so
    // they carry no simulator model. See assetEligibility.effectiveTargets.
    simulatorIdentifierCode: null,
    affiliation,
    allegiance: affiliation === "Hostile" ? "" : "GBR",
    owningSimulator: "vbs4",
    canonicalAssetKey: unit.canonicalAssetId ?? null,
    unitTypeKey: null,
    equipmentTypeKey: null,
    quantity: 1,
    children: (unit.children ?? []).map((c) =>
      toCompositionNode(c, affiliation, register),
    ),
  };
}

// ─── Position map construction ───────────────────────────────────────────────

/**
 * Threshold below which a child offset is treated as "identical to parent".
 * ~11 m at mid-latitudes (1e-4° ≈ ~11 m).  The LLM regularly emits the
 * parent's coordinates verbatim for every child it has no specific location
 * for, so anything closer than this is treated as a coincident duplicate.
 */
const COINCIDENT_THRESHOLD_DEG = 1e-4;

/**
 * Angle sequence for spreading coincident siblings around their parent.
 * Starts at north (−π/2) then fans clockwise so the first child goes up,
 * the second goes right, etc. — keeps the visual result tidy.
 */
const SPREAD_ANGLES = [
  -Math.PI / 2,         // N
   0,                   // E
   Math.PI / 2,         // S
   Math.PI,             // W
  -Math.PI / 4,         // NE
   3 * Math.PI / 4,     // SW
   Math.PI / 4,         // SE
  -3 * Math.PI / 4,     // NW
];

/**
 * Radii used when spreading coincident children around their parent.
 * Indexed by depth in the hierarchy (root children = depth 0).
 * Values are in degrees; ~0.0006° ≈ 67 m, giving a compact but readable ring.
 */
const SPREAD_RADIUS_BY_DEPTH = [0.0006, 0.0004, 0.00025, 0.00015, 0.0001];

/**
 * Walk the CompositionNode tree and its parallel PhaseUnit tree, emitting
 * a NodePosition for every unit that carried a `location`.
 *
 * Root → absolute lat/lng stored as `offsetFromParent`.
 * Children with a distinct location → delta from their parent's absolute position.
 * Children without a location, OR with the SAME location as their parent
 *   → no entry emitted; auto-spread fires on drill-in (or explicit expand-all).
 *
 * "Identical coordinates" handling
 * ─────────────────────────────────
 * The LLM frequently assigns the parent's lat/lon to every child it has no
 * specific position for.  Storing a zero offset means the child is permanently
 * stacked on top of its parent and the auto-spread logic in HierarchyMap never
 * fires (it only spreads nodes that have NO entry in the positions map).
 *
 * Fix: when ALL children within a parent share the same location as each other
 * (within COINCIDENT_THRESHOLD_DEG), we spread them in a ring around the
 * parent immediately at ingest time, giving each child a real distinct offset.
 * When only SOME children are coincident with the parent but others have
 * genuine distinct locations, the coincident ones are stripped (no entry) so
 * the auto-spread can handle them proportionally once the user drills in.
 */
function buildPositionsFromPhase(
  node: CompositionNode,
  unit: PhaseUnit,
  parentLoc: PhaseLocation | null,
  out: Map<string, NodePosition>,
  originals: Map<string, LatLng>,
  depth = 0,
): void {
  const loc = unit.location ?? null;

  if (loc) {
    originals.set(node.id, { lat: loc.lat, lng: loc.lon });
    if (parentLoc === null) {
      // Root node — always store absolute position directly.
      out.set(node.id, { offsetFromParent: { lat: loc.lat, lng: loc.lon } });
    } else {
      const dLat = loc.lat - parentLoc.lat;
      const dLng = loc.lon - parentLoc.lon;
      const isCoinc = Math.abs(dLat) < COINCIDENT_THRESHOLD_DEG
                   && Math.abs(dLng) < COINCIDENT_THRESHOLD_DEG;

      if (!isCoinc) {
        // Distinct location — store the delta offset.
        out.set(node.id, { offsetFromParent: { lat: dLat, lng: dLng } });
      }
      // Coincident with parent → omit entry so auto-spread can handle it.
    }
  }

  const effectiveParentLoc = loc ?? parentLoc;
  const childCount = Math.min(node.children.length, unit.children?.length ?? 0);
  if (childCount === 0) return;

  // ── Gather child locations ────────────────────────────────────────────────
  // We need to know BEFORE recursing whether all children are coincident
  // with the effective parent, so we can spread them into a ring.
  const childLocs: (PhaseLocation | null)[] = [];
  for (let i = 0; i < childCount; i++) {
    childLocs.push(unit.children[i]?.location ?? null);
  }

  // Detect all-coincident group: every child that HAS a location shares it
  // (within threshold) with the effective parent location.
  const childrenWithLoc = childLocs.filter((l): l is PhaseLocation => l !== null);
  const allCoinc =
    effectiveParentLoc !== null &&
    childrenWithLoc.length > 0 &&
    childrenWithLoc.every(
      (l) =>
        Math.abs(l.lat - effectiveParentLoc.lat) < COINCIDENT_THRESHOLD_DEG &&
        Math.abs(l.lon - effectiveParentLoc.lon) < COINCIDENT_THRESHOLD_DEG,
    );

  if (allCoinc && effectiveParentLoc !== null) {
    // All children share the parent's location → spread them in a ring NOW
    // so they have real distinct positions from the start.
    const radius = SPREAD_RADIUS_BY_DEPTH[Math.min(depth, SPREAD_RADIUS_BY_DEPTH.length - 1)];
    let angleIdx = 0;
    for (let i = 0; i < childCount; i++) {
      const childNode = node.children[i];
      const childUnit = unit.children[i];
      const cLoc = childLocs[i];
      if (cLoc) {
        originals.set(childNode.id, { lat: cLoc.lat, lng: cLoc.lon });
        // Assign a ring offset instead of the coincident delta
        const angle = SPREAD_ANGLES[angleIdx % SPREAD_ANGLES.length];
        angleIdx++;
        out.set(childNode.id, {
          offsetFromParent: {
            lat: radius * Math.sin(angle),
            lng: radius * Math.cos(angle),
          },
        });
        // Recurse, but pass the ORIGINAL (coincident) location as parentLoc
        // so grandchildren compute their deltas from the LLM-given position.
        buildPositionsFromPhase(childNode, childUnit, cLoc, out, originals, depth + 1);
      } else {
        // Child has no location at all — just recurse with inherited parent loc
        buildPositionsFromPhase(childNode, childUnit, effectiveParentLoc, out, originals, depth + 1);
      }
    }
  } else {
    // Normal case: recurse straightforwardly; coincident individual children
    // are handled inside the recursive call by the isCoinc guard above.
    for (let i = 0; i < childCount; i++) {
      buildPositionsFromPhase(
        node.children[i],
        unit.children[i],
        effectiveParentLoc,
        out,
        originals,
        depth + 1,
      );
    }
  }
}

// ─── Top-level ingest ────────────────────────────────────────────────────────

/**
 * Convert a parsed PhaseOrbatPayload into a CompositionNode tree + position map.
 *
 * Single top-level unit → becomes the root directly.
 * Multiple top-level units → wrapped in a synthetic HQ at their centroid.
 *
 * The `defaultAffiliation` option controls what Friend units inherit; OPFOR
 * units are always detected independently regardless of this setting.
 */
export function ingestPhaseOrbat(
  payload: PhaseOrbatPayload,
  opts: { affiliation?: string; syntheticRootName?: string } = {},
): PhaseIngestResult {
  const defaultAffiliation = opts.affiliation ?? "Friend";
  const positions = new Map<string, NodePosition>();
  const originalCoords = new Map<string, LatLng>();
  const nodeToUnit = new Map<string, PhaseUnit>();
  const register = (id: string, u: PhaseUnit) => nodeToUnit.set(id, u);

  // Build top-level nodes with affiliation inference
  const topNodes = payload.units.map((u) =>
    toCompositionNode(u, defaultAffiliation, register),
  );

  let root: CompositionNode;
  let rootUnit: PhaseUnit;

  if (topNodes.length === 1) {
    root     = opts.syntheticRootName
      ? { ...topNodes[0], unitIdentifier: opts.syntheticRootName }
      : topNodes[0];
    rootUnit = payload.units[0];
  } else {
    // Centroid of all top-level unit locations (ignore units without location)
    const locs = payload.units
      .map((u) => u.location)
      .filter((l): l is PhaseLocation => !!l);

    const centroid: PhaseLocation = locs.length
      ? {
          lat: locs.reduce((s, l) => s + l.lat, 0) / locs.length,
          lon: locs.reduce((s, l) => s + l.lon, 0) / locs.length,
        }
      : { lat: 0, lon: 0 };

    // Choose an appropriate echelon for the wrapper — one level above the
    // highest-echelon top-level unit (heuristic: Brigade covers BN+ forces)
    const rootEchelon = "Brigade";

    // ── Synthetic wrapper affiliation ────────────────────────────────────
    // Previously the wrapper root was hard-coded to `defaultAffiliation`
    // ("Friend"), which meant a purely OPFOR ORBAT (all top-level units
    // Hostile) would still get a Friend HQ pinned on top of the tree —
    // wrong colour, wrong SIDC, and breaks the side split in the tree view.
    //
    // Instead we derive the wrapper's affiliation from its children:
    //   - all children Hostile   → wrapper is Hostile
    //   - all children Friend/other → wrapper is defaultAffiliation
    //   - mixed → we still need one wrapper; pick defaultAffiliation and
    //     let the tree view split its children into Allied/Hostile groups.
    const affCounts = topNodes.reduce<Record<string, number>>((acc, n) => {
      const a = n.affiliation || defaultAffiliation;
      acc[a] = (acc[a] ?? 0) + 1;
      return acc;
    }, {});
    const allHostile = topNodes.length > 0
      && (affCounts.Hostile ?? 0) === topNodes.length;
    const wrapperAffiliation = allHostile ? "Hostile" : defaultAffiliation;

    root = {
      id: uuidv4(),
      unitIdentifier: opts.syntheticRootName || payload.description.slice(0, 60).replace(/\.$/, "") || "Phase ORBAT",
      echelon: rootEchelon,
      sidc: makeSidc("headquarters", rootEchelon, wrapperAffiliation, "organisation"),
      entityType: "organisation",
      militaryService: "Army",
      affiliation: wrapperAffiliation,
      allegiance: wrapperAffiliation === "Hostile" ? "" : "GBR",
      owningSimulator: "vbs4",
      canonicalAssetKey: null,
      simulatorIdentifierCode: null,
      unitTypeKey: null,
      equipmentTypeKey: null,
      quantity: 1,
      children: topNodes,
    };
    rootUnit = {
      name: root.unitIdentifier,
      echelon: rootEchelon,
      icon: "headquarters",
      personnelCount: 0,
      location: locs.length ? centroid : null,
      children: payload.units,
    };
    register(root.id, rootUnit);
  }

  buildPositionsFromPhase(root, rootUnit, null, positions, originalCoords);

  return {
    description: payload.description,
    root,
    positions,
    originalCoords,
  };
}

// ─── Template round-trip helpers ─────────────────────────────────────────────

export interface PhaseTemplateExtras {
  origin: typeof PHASE_TEMPLATE_TAG;
  positionsById: Record<string, NodePosition>;
  originalCoordsById?: Record<string, LatLng>;
  operationKey?: string | null;
  phaseIndex?: number | null;
  phaseName?: string | null;
  relationshipsByEdgeId?: Record<string, string>;
}

export function positionsMapToObject(
  positions: Map<string, NodePosition>,
): Record<string, NodePosition> {
  const out: Record<string, NodePosition> = {};
  positions.forEach((v, k) => { out[k] = v; });
  return out;
}

export function positionsObjectToMap(
  obj: Record<string, NodePosition> | undefined | null,
): Map<string, NodePosition> {
  const out = new Map<string, NodePosition>();
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v && v.offsetFromParent && typeof v.offsetFromParent.lat === "number" && typeof v.offsetFromParent.lng === "number") {
      out.set(k, { offsetFromParent: { lat: v.offsetFromParent.lat, lng: v.offsetFromParent.lng } });
    }
  }
  return out;
}

// ─── Cross-phase unit re-identification ──────────────────────────────────────

export interface UnitMatch {
  baselineId: string;
  incomingId: string;
}

export interface MatchResult {
  matches: UnitMatch[];
  unmatchedIncoming: string[];
  unmatchedBaseline: string[];
}

/**
 * Match every node in `incoming` to its best-fit counterpart in `baseline`
 * so cross-phase ingests can reuse canonical ids (see `applyIdRemap`).
 *
 * Previous implementation ran `Array.findIndex` in an inner loop for each
 * incoming child, giving O(n²) behaviour per parent — noticeable on the
 * ~200-unit division ORBATs the LLM sometimes emits. This version builds
 * two small lookup maps up front (identifier-only, identifier+echelon) and
 * consults them per child, plus a running "first free index" pointer for
 * the leftover positional match, bringing each level down to O(n).
 */
export function matchIncomingToBaseline(
  incoming: CompositionNode,
  baseline: CompositionNode,
): MatchResult {
  const matches: UnitMatch[] = [];
  const unmatchedIncoming: string[] = [];
  const unmatchedBaseline: string[] = [];

  function matchNode(inc: CompositionNode, base: CompositionNode): void {
    matches.push({ incomingId: inc.id, baselineId: base.id });

    const baseChildren = base.children;
    const incChildren  = inc.children;
    if (incChildren.length === 0 && baseChildren.length === 0) return;

    const usedBaseIdx = new Set<number>();

    // ── Preindex baseline children ────────────────────────────────────────
    // Two lookups, keyed by unitIdentifier alone AND by identifier|echelon.
    // Each map holds a queue of indices so we can pop the first still-unused
    // match on demand (preserves original left-to-right tie-breaking).
    const byId = new Map<string, number[]>();
    const byIdEch = new Map<string, number[]>();
    for (let i = 0; i < baseChildren.length; i++) {
      const b = baseChildren[i];
      if (b.unitIdentifier) {
        const arr = byId.get(b.unitIdentifier);
        if (arr) arr.push(i); else byId.set(b.unitIdentifier, [i]);
        const combined = `${b.unitIdentifier}||${b.echelon}`;
        const arr2 = byIdEch.get(combined);
        if (arr2) arr2.push(i); else byIdEch.set(combined, [i]);
      }
    }

    // Helper — pop the first still-unused index from a queue for a key.
    const popFree = (map: Map<string, number[]>, key: string): number => {
      const queue = map.get(key);
      if (!queue) return -1;
      while (queue.length > 0) {
        const idx = queue.shift()!;
        if (!usedBaseIdx.has(idx)) return idx;
      }
      return -1;
    };

    // Running pointer for the positional (any-unused) fallback so we
    // don't rescan the array every miss.
    let nextFreeIdx = 0;
    const advanceFree = (): number => {
      while (nextFreeIdx < baseChildren.length && usedBaseIdx.has(nextFreeIdx)) {
        nextFreeIdx++;
      }
      return nextFreeIdx < baseChildren.length ? nextFreeIdx : -1;
    };

    // ── Match each incoming child in priority order ───────────────────────
    for (const incChild of incChildren) {
      let bestIdx = -1;

      // 1) Exact identifier + echelon (highest specificity)
      if (incChild.unitIdentifier) {
        bestIdx = popFree(byIdEch, `${incChild.unitIdentifier}||${incChild.echelon}`);
      }
      // 2) Identifier only
      if (bestIdx < 0 && incChild.unitIdentifier) {
        bestIdx = popFree(byId, incChild.unitIdentifier);
      }
      // 3) Positional — first still-unused baseline slot
      if (bestIdx < 0) {
        bestIdx = advanceFree();
      }

      if (bestIdx >= 0) {
        usedBaseIdx.add(bestIdx);
        matchNode(incChild, baseChildren[bestIdx]);
      } else {
        unmatchedIncoming.push(incChild.id);
      }
    }

    // Everything left in baseline is unmatched.
    for (let i = 0; i < baseChildren.length; i++) {
      if (!usedBaseIdx.has(i)) unmatchedBaseline.push(baseChildren[i].id);
    }
  }

  matchNode(incoming, baseline);
  return { matches, unmatchedIncoming, unmatchedBaseline };
}

export function applyIdRemap(
  tree: CompositionNode,
  matches: UnitMatch[],
): { tree: CompositionNode; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  for (const m of matches) idMap.set(m.incomingId, m.baselineId);
  function walk(n: CompositionNode): CompositionNode {
    const newId = idMap.get(n.id) ?? n.id;
    return { ...n, id: newId, children: n.children.map(walk) };
  }
  return { tree: walk(tree), idMap };
}

export function remapPositions(
  positions: Map<string, NodePosition>,
  idMap: Map<string, string>,
): Map<string, NodePosition> {
  const out = new Map<string, NodePosition>();
  positions.forEach((v, k) => { out.set(idMap.get(k) ?? k, v); });
  return out;
}

export function extractRelationships(
  node: CompositionNode,
  units: PhaseUnit[],
  idMap: Map<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};

  function walk(n: CompositionNode, parentUnits: PhaseUnit[]): void {
    for (let i = 0; i < n.children.length; i++) {
      const child     = n.children[i];
      const unitEntry = parentUnits[i] as PhaseUnit | undefined;
      const rel       = unitEntry?.relationshipToParent;
      if (rel) {
        const canonicalId = idMap.get(child.id) ?? child.id;
        out[canonicalId] = rel;
      }
      walk(child, unitEntry?.children ?? []);
    }
  }

  walk(node, units);
  return out;
}
