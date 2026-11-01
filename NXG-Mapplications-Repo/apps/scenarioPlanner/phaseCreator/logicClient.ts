// src/apps/scenarioPlanner/phaseCreator/logicClient.ts
//
// Client for calling AIP Logic functions that power phase creation (v3).
//
// Two-function model:
//   1. nxgGenerateOrders — generates tactical orders for every unit from free text
//   2. nxgGeneratePhaseMap (reworked) — resolves orders into end-state positions
//
// Includes robust JSON parsing, retry with exponential backoff, and
// context size guardrails.

import { client } from "@/client";
import {
  nxgGenerateOrders,
  nxgGeneratePhaseDraft,
  nxgGeneratePhaseMap,
} from "@nxg-simulation-execution-testing/sdk";
import type {
  GenerateOrdersOutput,
  GenerateEndStateOutput,
  UnitOrder,
  EndStateUnit,
  EndStateEngagement,
  MapObjectiveOutput,
  MapUnitPlacement,
  MapObjectivePlacement,
} from "./types";

// ─── Configuration ──────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1500;
const MAX_CONTEXT_CHARS = 30_000;

// ─── Resolved-position verification ─────────────────────────────────────────

/**
 * Tolerance when comparing returned coordinates against the resolver's output.
 * The resolver rounds to 6 decimal places, so a faithful copy matches exactly;
 * anything beyond this is the model having altered the geometry.
 */
const COORD_TOLERANCE_DEG = 1e-6;

/**
 * Check that the model copied the deterministic resolver's coordinates instead
 * of inventing its own.
 *
 * The whole point of resolvedPositionsJson is that the resolver owns geometry
 * and the LLM only narrates. That guarantee was previously unverified: nothing
 * compared what came back against what was sent, so a drifting model would have
 * shown up only as units sitting in the wrong place on the map.
 *
 * Warns rather than throws. A coordinate disagreement is a quality signal, not
 * a reason to discard an otherwise usable end state mid-demo.
 */
function assertResolvedPositionsHonoured(
  resolvedPositionsJson: string | undefined,
  result: { units: { unitId: string; lat: number; lng: number }[] },
): void {
  if (!resolvedPositionsJson) return;

  let parsed: { units?: { unitId?: string; lat?: number; lng?: number }[] };
  try {
    parsed = JSON.parse(resolvedPositionsJson);
  } catch {
    console.warn("[logicClient] resolvedPositionsJson is not valid JSON — skipping coordinate check");
    return;
  }

  const expected = new Map<string, { lat: number; lng: number }>();
  for (const u of parsed.units ?? []) {
    if (u.unitId && typeof u.lat === "number" && typeof u.lng === "number") {
      expected.set(u.unitId, { lat: u.lat, lng: u.lng });
    }
  }
  if (expected.size === 0) return;

  const drifted: string[] = [];
  const returned = new Set<string>();

  for (const unit of result.units) {
    returned.add(unit.unitId);
    const want = expected.get(unit.unitId);
    if (!want) continue;
    const dLat = Math.abs(unit.lat - want.lat);
    const dLng = Math.abs(unit.lng - want.lng);
    if (dLat > COORD_TOLERANCE_DEG || dLng > COORD_TOLERANCE_DEG) {
      drifted.push(`${unit.unitId} (dLat ${dLat.toFixed(6)}, dLng ${dLng.toFixed(6)})`);
    }
  }

  const missing = [...expected.keys()].filter((id) => !returned.has(id));

  if (drifted.length > 0) {
    console.warn(
      `[logicClient] end state: ${drifted.length} unit(s) came back with coordinates that differ ` +
        `from the deterministic resolver — the model may have invented positions: ${drifted.join(", ")}`,
    );
  }
  if (missing.length > 0) {
    console.warn(
      `[logicClient] end state: ${missing.length} unit(s) present in RESOLVED_POSITIONS are missing ` +
        `from the model output: ${missing.join(", ")}`,
    );
  }
  if (drifted.length === 0 && missing.length === 0) {
    console.log(
      `[logicClient] end state: all ${expected.size} resolved unit position(s) preserved exactly`,
    );
  }
}

// ─── JSON extraction ────────────────────────────────────────────────────────

function extractJson(raw: string): string {
  const s = raw.trim();
  const start = s.indexOf("{");
  if (start === -1) return s;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { if (inString) escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return s.slice(start);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function secureRandomHex(n = 4): string {
  const b = new Uint8Array(n);
  window.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function asString(v: unknown, fb = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fb;
}
function asNumber(v: unknown, fb = 0): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") { const n = parseFloat(v); if (!isNaN(n)) return n; }
  return fb;
}
function asArray<T>(v: unknown, m: (i: unknown) => T): T[] {
  return Array.isArray(v) ? v.map(m) : [];
}
function asStringArray(v: unknown): string[] { return asArray(v, (i) => asString(i)); }
function asEnum<T extends string>(v: unknown, a: T[], fb: T): T {
  const s = asString(v).toLowerCase();
  return a.find((x) => x.toLowerCase() === s) ?? fb;
}

function truncateContext(value: string, label: string, max = MAX_CONTEXT_CHARS): string {
  if (value.length <= max) return value;
  console.warn(`[logicClient] Truncating ${label} from ${value.length} to ${max} chars`);
  return value.slice(0, max) + `\n\n[TRUNCATED — original was ${value.length} chars]`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Escape control characters (newlines, tabs, etc.) that are invalid inside
 * JSON string values. The LLM often produces literal newlines in narrative
 * text. After the OSDK double-decode, these become raw control chars that
 * break JSON.parse.
 */
function escapeControlCharsForJson(s: string): string {
  return s.replace(/[\x00-\x1f]/g, (ch) => {
    switch (ch) {
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\t': return '\\t';
      default: return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
    }
  });
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes("invalid json") || m.includes("unexpected") || m.includes("syntax")
    || m.includes("parse") || m.includes("truncated") || m.includes("suspiciously short")
    || m.includes("will retry");
}

// ─── Truncated JSON repair ───────────────────────────────────────────────────

/**
 * Attempt to repair truncated JSON by closing unclosed brackets/braces.
 * LLMs frequently produce valid JSON that's cut off mid-output (e.g. the
 * model hits its output token limit). This function:
 *   1. Strips any trailing incomplete string value
 *   2. Strips any trailing incomplete key-value pair
 *   3. Closes all unclosed `[` and `{` in reverse order
 */
function repairTruncatedJson(raw: string): string {
  let s = raw.trim();
  const start = s.indexOf("{");
  if (start === -1) return s;
  s = s.slice(start);

  // Strip trailing incomplete string (cut off mid-value)
  // Look for the last complete key-value pair
  // Remove trailing partial content after the last comma or complete value
  s = s.replace(/,\s*"[^"]*"?\s*:\s*"[^"]*$/, ""); // incomplete "key": "val...
  s = s.replace(/,\s*"[^"]*"?\s*:\s*[0-9.]*$/, ""); // incomplete "key": 123...
  s = s.replace(/,\s*"[^"]*"?\s*:?\s*$/, "");        // incomplete "key":
  s = s.replace(/,\s*\{[^}]*$/, "");                  // incomplete trailing object in array
  s = s.replace(/,\s*$/, "");                          // trailing comma

  // Count unclosed brackets
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { if (inString) escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  // If we're still inside a string, close it
  if (inString) s += '"';

  // Close all unclosed brackets/braces
  while (stack.length > 0) s += stack.pop();

  return s;
}

// ─── JSON parsing ───────────────────────────────────────────────────────────

function tryParseJson(raw: unknown, name: string): unknown {
  if (typeof raw === "object" && raw !== null) return raw;
  if (typeof raw !== "string") { console.error(`[logicClient] ${name}: unexpected type ${typeof raw}`); return {}; }
  const str = raw as string;
  console.log(`[logicClient] ${name}: raw len=${str.length}, first 200:`, str.slice(0, 200));
  console.log(`[logicClient] ${name}: FULL RAW:`, str);
  console.log(`[logicClient] ${name}: last 20 chars:`, JSON.stringify(str.slice(-20)));
  console.log(`[logicClient] ${name}: first char code: ${str.charCodeAt(0)}, last char code: ${str.charCodeAt(str.length - 1)}`);
  if (str.length < 20) {
    throw new Error(`Logic function "${name}" returned suspiciously short response (${str.length} chars). The LLM likely truncated. Will retry.`);
  }
  // Strategy 1: Direct parse
  try { const p = JSON.parse(str); if (typeof p === "object" && p !== null) return p; if (typeof p === "string") return tryParseJson(p, name + " (inner)"); } catch { /* noop */ }
  // Strategy 2: Escape control chars (literal newlines from LLM paragraph breaks) then parse
  try { const escaped = escapeControlCharsForJson(str); const p = JSON.parse(escaped); if (typeof p === "object" && p !== null) { console.log(`[logicClient] ${name}: parsed after escaping control chars`); return p; } if (typeof p === "string") return tryParseJson(p, name + " (inner-esc)"); } catch { /* noop */ }
  // Strategy 3: Brace-depth extraction
  try { return JSON.parse(escapeControlCharsForJson(extractJson(str))); } catch { /* noop */ }
  // Strategy 4: Regex
  const m = str.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(escapeControlCharsForJson(m[0])); } catch { /* noop */ } }
  // Strategy 5: Unescape backslash-quotes then parse
  try { const unesc = str.replace(/\\"/g, '"').replace(/\\\\/g, '\\'); return JSON.parse(escapeControlCharsForJson(extractJson(unesc))); } catch { /* noop */ }
  // Strategy 5: Repair truncated JSON (LLM hit output token limit)
  try {
    const repaired = repairTruncatedJson(str);
    const parsed = JSON.parse(repaired);
    if (typeof parsed === "object" && parsed !== null) {
      console.warn(`[logicClient] ${name}: repaired truncated JSON (${str.length} → ${repaired.length} chars). Some data may be incomplete.`);
      return parsed;
    }
  } catch { /* noop */ }
  throw new Error(`Logic function "${name}" returned invalid JSON (${str.length} chars). Last 100: "${str.slice(-100)}". Will retry.`);
}

// ─── OSDK executor with retry ───────────────────────────────────────────────

/**
 * Execute a single OSDK function call (no retry). Routes to the correct
 * typed SDK import so TypeScript is satisfied.
 */
async function executeQueryOnce(
  apiName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: unknown;
  if (apiName === "nxgGeneratePhaseDraft") {
    raw = await client(nxgGeneratePhaseDraft).executeFunction(params as any);
  } else if (apiName === "nxgGeneratePhaseMap") {
    raw = await client(nxgGeneratePhaseMap).executeFunction(params as any);
  } else if (apiName === "nxgGenerateOrders") {
    raw = await client(nxgGenerateOrders).executeFunction(params as any);
  } else {
    throw new Error(`Unknown logic function: "${apiName}"`);
  }
  console.log(`[logicClient] ${apiName}: OSDK result type: ${typeof raw}`);
  return tryParseJson(raw, apiName);
}

/**
 * Execute an LLM query with automatic retry and exponential backoff.
 */
async function executeQuery(
  apiName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const parsed = await executeQueryOnce(apiName, params);
      if (attempt > 1) console.log(`[logicClient] ${apiName}: succeeded on attempt ${attempt}/${MAX_RETRIES}`);
      return parsed;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (!isRetryable(lastErr) || attempt === MAX_RETRIES) {
        console.error(`[logicClient] ${apiName}: failed attempt ${attempt}/${MAX_RETRIES}:`, lastErr.message);
        break;
      }
      const d = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[logicClient] ${apiName}: attempt ${attempt}/${MAX_RETRIES} failed (${lastErr.message}). Retrying in ${d}ms…`);
      await delay(d);
    }
  }
  throw lastErr ?? new Error(`${apiName} failed after ${MAX_RETRIES} attempts.`);
}

// ─── Sanitizers ─────────────────────────────────────────────────────────────

function sanitizeOrdersOutput(raw: unknown): GenerateOrdersOutput {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    orders: asArray(obj.orders, (item): UnitOrder => {
      const o = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
      return {
        unitId: asString(o.unitId, ""),
        taskName: asString(o.taskName, "Hold"),
        toLat: asNumber(o.toLat, 0),
        toLng: asNumber(o.toLng, 0),
        targetObjectiveId: asString(o.targetObjectiveId, ""),
        rationale: asString(o.rationale, ""),
      };
    }),
    newObjectives: asArray(obj.newObjectives, (item): MapObjectiveOutput => {
      const o = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
      return {
        id: asString(o.id, `obj-${secureRandomHex(4)}`),
        name: asString(o.name, "Unnamed Objective"),
        lat: asNumber(o.lat, 0),
        lng: asNumber(o.lng, 0),
        colour: asString(o.colour ?? o.color, "#4A90D9"),
      };
    }),
    summary: asString(obj.summary, ""),
  };
}



function sanitizeEndStateOutput(raw: unknown): GenerateEndStateOutput {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    units: asArray(obj.units, (item): EndStateUnit => {
      const u = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
      return {
        unitId: asString(u.unitId, `unit-${secureRandomHex(4)}`),
        label: asString(u.label, "Unknown Unit"),
        sidc: asString(u.sidc, "SFGPUCI-------"),
        force: asEnum(u.force, ["blue", "red"], "blue"),
        lat: asNumber(u.lat, 0),
        lng: asNumber(u.lng, 0),
        status: asEnum(u.status, ["operational", "degraded", "combat-ineffective", "destroyed"], "operational"),
        resolution: asString(u.resolution, ""),
      };
    }),
    objectives: asArray(obj.objectives, (item): MapObjectiveOutput => {
      const o = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
      return {
        id: asString(o.id, `obj-${secureRandomHex(4)}`),
        name: asString(o.name, "Unnamed Objective"),
        lat: asNumber(o.lat, 0),
        lng: asNumber(o.lng, 0),
        colour: asString(o.colour ?? o.color, "#4A90D9"),
      };
    }),
    engagements: asArray(obj.engagements, (item): EndStateEngagement => {
      const e = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
      const loc = (typeof e.location === "object" && e.location !== null ? e.location : {}) as Record<string, unknown>;
      return {
        location: { lat: asNumber(loc.lat, 0), lng: asNumber(loc.lng, 0) },
        blueUnits: asStringArray(e.blueUnits),
        redUnits: asStringArray(e.redUnits),
        outcome: asEnum(e.outcome, ["blue-favoured", "even", "red-favoured"], "even"),
        description: asString(e.description, ""),
      };
    }),
    summary: asString(obj.summary, ""),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface GenerateOrdersParams {
  /** Free-text intent from the user (e.g. "Attack OBJ ALPHA from the south"). */
  userIntent: string;
  /** Units in the phase's start state. */
  units: MapUnitPlacement[];
  /** Exercise/phase context string. */
  phaseContext: string;
  /** How much simulated time the phase covers. */
  timeScaleContext: string;
  /** Task catalog definitions. */
  taskCatalogContext?: string;
  /** Objectives already on the map. */
  objectives?: MapObjectivePlacement[];
  /**
   * Terrain reachability rules + per-unit movement budgets
   * (see lib/orderReachability.buildReachabilityContext).
   *
   * Appended to `phaseContext` rather than sent as its own OSDK parameter:
   * nxgGenerateOrders' published signature has no such input, and passing an
   * unknown parameter fails at execution time. Orders are validated against
   * the terrain grid after the call regardless — this just improves the
   * model's first guess.
   */
  reachabilityContext?: string;
}

/**
 * Generate Orders — takes free-text user intent + unit positions → produces
 * an order for every unit (taskName, destination, rationale).
 */
export async function generateOrders(
  params: GenerateOrdersParams,
): Promise<GenerateOrdersOutput> {
  const unitsJson = JSON.stringify(
    params.units.map((u) => ({
      unitId: u.id,
      label: u.label,
      sidc: u.sidc,
      force: u.force ?? "blue",
      lat: u.lat,
      lng: u.lng,
    })),
  );

  const objectivesJson = params.objectives
    ? JSON.stringify(params.objectives.map((o) => ({ id: o.id, name: o.name, lat: o.lat, lng: o.lng })))
    : "[]";

  const phaseContext = params.reachabilityContext
    ? `${params.phaseContext}\n\n${params.reachabilityContext}`
    : params.phaseContext;

  const raw = await executeQuery("nxgGenerateOrders", {
    userIntent: params.userIntent,
    unitsJson: truncateContext(unitsJson, "unitsJson"),
    phaseContext: truncateContext(phaseContext, "phaseContext"),
    timeScaleContext: params.timeScaleContext,
    taskCatalogContext: truncateContext(params.taskCatalogContext ?? "", "taskCatalogContext"),
    objectivesJson: truncateContext(objectivesJson, "objectivesJson"),
  });

  const result = sanitizeOrdersOutput(raw);
  if (result.orders.length === 0) console.warn("[logicClient] LLM returned no orders");
  return result;
}

export interface GenerateEndStateParams {
  /** Units in the phase's start state. */
  units: MapUnitPlacement[];
  /** Orders assigned to units (from generateOrders). */
  orders: UnitOrder[];
  /** Pre-resolved deterministic positions from resolveOrders engine.
   * When provided, these positions are passed as authoritative facts
   * to the LLM — the LLM no longer resolves movement physics. */
  resolvedPositionsJson?: string;
  /** Objectives on the map. */
  objectives: MapObjectivePlacement[];
  /** Exercise/phase context string. */
  phaseContext: string;
  /** How much simulated time the phase covers. */
  timeScaleContext: string;
  /** Phase duration in hours. */
  durationHours: number;
  /** Serialised MEL/MIL injects. */
  melMilContext?: string;
  /** Serialised PMESII factors. */
  pmesiiContext?: string;
  /** Serialised training objectives. */
  trainingObjectivesContext?: string;
  /** Orders summary from the generateOrders call. */
  ordersSummary?: string;
}

/**
 * Generate End State — the LLM does all the work but the AIP Logic function
 * internally chains two LLM blocks:
 *   Block 1: Resolve unit positions (small JSON array)
 *   Block 2: Generate narrative, engagements, summary (uses Block 1's output)
 *
 * This splitting ensures neither block exceeds the model's output token limit.
 * The client just sends everything and gets back the complete end state.
 */
export async function generateEndState(
  params: GenerateEndStateParams,
): Promise<GenerateEndStateOutput> {
  // Build the "units with orders" JSON
  const unitsWithOrders = params.units.map((u) => {
    const order = params.orders.find((o) => o.unitId === u.id);
    return {
      unitId: u.id,
      label: u.label,
      sidc: u.sidc,
      force: u.force ?? "blue",
      lat: u.lat,
      lng: u.lng,
      ...(order ? { order: { taskName: order.taskName, toLat: order.toLat, toLng: order.toLng, targetObjectiveId: order.targetObjectiveId, rationale: order.rationale } } : {}),
    };
  });

  const objectivesJson = JSON.stringify(
    params.objectives.map((o) => ({ id: o.id, name: o.name, lat: o.lat, lng: o.lng, colour: o.colour })),
  );

  // Embed resolved positions into ordersSummary so we don't need a new
  // OSDK parameter (avoids "Cannot read properties of undefined" when
  // the SDK metadata hasn't been regenerated to include the new input).
  // Resolved positions are sent as their own parameter.
  //
  // nxgGeneratePhaseMap v6.0.0 declares resolvedPositionsJson as an input, and
  // the Logic's system prompt treats that block as authoritative ("Copy each
  // unit's lat, lng EXACTLY from RESOLVED_POSITIONS"). Earlier SDKs targeted
  // v5.3.0, which declared no such input, so the coordinates had to be smuggled
  // in by prepending them to ordersSummary under a duplicate header — which left
  // the authoritative block empty and invited the model to invent positions.
  // That workaround is gone; ordersSummary now carries only the orders narrative.
  //
  // Deliberately NOT passed through truncateContext: this is authoritative JSON
  // geometry from the deterministic resolver, and truncating it would silently
  // produce invalid JSON. Its size is bounded by the unit count.

  const raw = await executeQuery("nxgGeneratePhaseMap", {
    unitsWithOrdersJson: truncateContext(JSON.stringify(unitsWithOrders), "unitsWithOrdersJson"),
    objectivesJson: truncateContext(objectivesJson, "objectivesJson"),
    timeScaleContext: params.timeScaleContext,
    phaseContext: truncateContext(params.phaseContext, "phaseContext"),
    melMilContext: truncateContext(params.melMilContext ?? "No MEL/MIL injects defined.", "melMilContext"),
    pmesiiContext: truncateContext(params.pmesiiContext ?? "No PMESII factors defined.", "pmesiiContext"),
    trainingObjectivesContext: truncateContext(params.trainingObjectivesContext ?? "No training objectives defined.", "trainingObjectivesContext"),
    ordersSummary: truncateContext(params.ordersSummary ?? "", "ordersSummary"),
    ...(params.resolvedPositionsJson
      ? { resolvedPositionsJson: params.resolvedPositionsJson }
      : {}),
  });

  const result = sanitizeEndStateOutput(raw);
  if (result.units.length === 0) console.warn("[logicClient] LLM returned no end-state units");
  assertResolvedPositionsHonoured(params.resolvedPositionsJson, result);
  return result;
}

// ─── Re-exports for backward compatibility ──────────────────────────────────

export type {
  GenerateOrdersOutput,
  GenerateEndStateOutput,
  UnitOrder,
  EndStateUnit,
  EndStateEngagement,
  MapObjectiveOutput,
};
