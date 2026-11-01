import { type PreflightReport, asObject } from "@/shared/orbat/preflight";

// apps/execute/lib/executePlan.ts
//
// The Execute screen's decisions — pure, no network, no React.
//
//   readiness  ORBAT present  →  preflight clean  →  CSE accepts it
//   launch     export XML → CSE project → load ORBAT → publish → start
//
// Preflight and CSE answer in different shapes (the Translator returns a JSON
// report; CSE-Prep functions return {"success", "data" | "error"} JSON
// strings), and both have changed shape before. Everything here parses
// defensively and turns "could not tell" into an explicit state rather than a
// green tick.

export type CheckState = "pending" | "running" | "ok" | "warn" | "fail" | "skipped";

export type { PreflightIssue, PreflightReport } from "@/shared/orbat/preflight";
export { parsePreflight } from "@/shared/orbat/preflight";

export function preflightState(report: PreflightReport | null): CheckState {
  if (!report) return "fail";
  if (report.errors > 0) return "fail";
  return report.warnings > 0 ? "warn" : "ok";
}

export interface CseResult {
  ok: boolean;
  data: unknown;
  error: string | null;
}

/** Parse a CSE-Prep function's {"success", "data" | "error"} answer. */
export function parseCseResult(raw: unknown): CseResult {
  const o = asObject(raw);
  if (!o) return { ok: false, data: null, error: "CSE returned an answer that could not be read." };
  if (o.success === false) {
    const code = typeof o.code === "string" && o.code !== "UNKNOWN" ? ` (${o.code})` : "";
    return {
      ok: false,
      data: o.data ?? null,
      error: `${String(o.error ?? "CSE refused the request")}${code}`,
    };
  }
  return { ok: true, data: o.data ?? o, error: null };
}

/**
 * Validation errors inside a successful ValidateOrbat answer — CSE answers
 * "success" for the CALL and lists what is wrong with the ORBAT in data.errors.
 */
export function cseValidationErrors(result: CseResult): string[] {
  const data = asObject(result.data);
  const errors = data?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => {
    const o = asObject(e);
    if (!o) return String(e);
    const where = o.path ?? o.location ?? o.element;
    const msg = o.message ?? o.description ?? o.text ?? JSON.stringify(o);
    return where ? `${String(where)}: ${String(msg)}` : String(msg);
  });
}

/** Every string under a name-like key, anywhere in a decoded protobuf. */
export function extractNames(
  data: unknown,
  keys = ["name", "Name", "compositionName", "projectName"],
): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || v == null) return;
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof v !== "object") return;
    for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
      if (keys.includes(k) && typeof value === "string" && value.trim()) out.add(value.trim());
      else walk(value, depth + 1);
    }
  };
  walk(asObject(data) ?? data, 0);
  return [...out].sort((a, b) => a.localeCompare(b));
}

// ─── Stored CSE verdict ──────────────────────────────────────────────────────

export interface StoredCseVerdict {
  status: "PASSED" | "FAILED" | "ERROR" | string;
  detail: string;
  /** Epoch seconds, when known. */
  atS: number | null;
}

/**
 * The verdict nxgCseValidatePhaseOrbat stored on the phase hierarchy
 * (cse_validation_status / _detail / validated_at). The property API names
 * are camel-cased by the ontology; both spellings are read. Null when the
 * hierarchy has never been checked.
 */
export function storedCseVerdict(
  o: Record<string, unknown> | null | undefined,
): StoredCseVerdict | null {
  if (!o) return null;
  const pick = (...keys: string[]) => keys.map((k) => o[k]).find((v) => v != null && v !== "");
  const status = pick("cseValidationStatus", "cse_validation_status");
  if (typeof status !== "string") return null;
  const detail = pick("cseValidationDetail", "cse_validation_detail");
  const at = pick("cseValidatedAt", "cse_validated_at");
  const t = typeof at === "string" ? Date.parse(at) : typeof at === "number" ? at : NaN;
  return {
    status,
    detail: typeof detail === "string" ? detail : "",
    atS: Number.isFinite(t) ? Math.floor((t > 1e12 ? t : t * 1000) / 1000) : null,
  };
}

/** How a stored verdict shows before a fresh check: advisory, so a failure warns. */
export function storedVerdictState(v: StoredCseVerdict | null): CheckState {
  if (!v) return "pending";
  return v.status === "PASSED" ? "ok" : "warn";
}

// ─── Compositions ────────────────────────────────────────────────────────────

/** A CSE composition: its name, and its composition document when CSE sent it. */
export interface CompositionInfo {
  name: string;
  /** The composition XML (files[].content), or null if CSE did not return it. */
  xml: string | null;
}

function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}

/**
 * The composition document among a composition's files: the one named
 * composition.xml, else the first whose content is a <Composition> document.
 */
export function compositionXmlOf(files: unknown): string | null {
  const list = asList(files)
    .map((f) => asObject(f))
    .filter((f): f is Record<string, unknown> => !!f)
    .map((f) => ({
      path: String(f.path ?? ""),
      content: typeof f.content === "string" ? f.content : "",
    }))
    .filter((f) => f.content.trim().length > 0);
  const named = list.find((f) => /(^|\/)composition\.xml$/i.test(f.path));
  if (named) return named.content;
  return list.find((f) => /<\s*([\w-]+:)?Composition[\s>]/.test(f.content))?.content ?? null;
}

/**
 * nxgCseGetCompositions' data → compositions. CSE-Prep decodes responses
 * heuristically, so a single composition may arrive as an object rather than
 * a one-element list, and files likewise; both are accepted. Falls back to
 * name-only entries when the shape is not recognised.
 */
export function extractCompositions(data: unknown): CompositionInfo[] {
  const root = asObject(data) ?? data;
  const container =
    root && typeof root === "object" && !Array.isArray(root)
      ? (root as Record<string, unknown>).compositions
      : root;
  const byName = new Map<string, CompositionInfo>();
  for (const item of asList(container)) {
    const o = asObject(item);
    const name = o && typeof o.name === "string" ? o.name.trim() : "";
    if (!o || !name) continue;
    const xml = compositionXmlOf(o.files);
    const prior = byName.get(name);
    byName.set(name, { name, xml: prior?.xml ?? xml });
  }
  if (byName.size === 0) {
    return extractNames(data).map((name) => ({ name, xml: null }));
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Readiness ───────────────────────────────────────────────────────────────

export interface OrbatCounts {
  blue: number;
  red: number;
}

export interface Readiness {
  orbat: CheckState;
  preflight: CheckState;
  cse: CheckState;
  /** Launch is allowed: an ORBAT exists and preflight found no errors. */
  canLaunch: boolean;
  /** One line for the launch button's tooltip / the banner. */
  reason: string;
}

export function orbatState(counts: OrbatCounts | null): CheckState {
  if (!counts) return "pending";
  if (counts.blue + counts.red === 0) return "fail";
  return counts.blue > 0 && counts.red > 0 ? "ok" : "warn";
}

/**
 * CSE validation is advised, not required: CSE can be unreachable from the
 * planning network while the federation is fine, and a launch then fails
 * loudly anyway. Preflight is required — a schema-valid ORBAT can still spawn
 * nothing, and that is the failure that looks like success.
 */
export function assessReadiness(
  orbat: CheckState,
  preflight: CheckState,
  cse: CheckState,
): Readiness {
  let reason = "Ready to launch.";
  let canLaunch = true;
  if (orbat === "pending" || orbat === "running") {
    canLaunch = false;
    reason = "Loading the phase ORBAT…";
  } else if (orbat === "fail") {
    canLaunch = false;
    reason = "This phase has no ORBAT yet — build and save it in the Scenario Planner.";
  } else if (preflight !== "ok" && preflight !== "warn") {
    canLaunch = false;
    reason =
      preflight === "fail"
        ? "Preflight found errors that would stop the ORBAT spawning — fix them first."
        : "Run preflight first.";
  } else if (cse === "fail") {
    reason = "CSE rejected the ORBAT last time it was checked — launching will most likely fail.";
  } else if (cse !== "ok") {
    reason = "Ready to launch. Validating with CSE first is recommended.";
  }
  return { orbat, preflight, cse, canLaunch, reason };
}

// ─── Launch ──────────────────────────────────────────────────────────────────

export type LaunchStepId = "export" | "project" | "load" | "publish" | "start";

export interface LaunchStep {
  id: LaunchStepId;
  label: string;
  detail: string;
}

export const LAUNCH_STEPS: readonly LaunchStep[] = [
  { id: "export", label: "Export ORBAT", detail: "Translate the phase ORBAT to CSE ORBAT XML" },
  {
    id: "project",
    label: "Prepare CSE project",
    detail: "Create the project with its composition if needed",
  },
  { id: "load", label: "Load ORBAT", detail: "Add the ORBAT to the CSE project" },
  {
    id: "publish",
    label: "Publish",
    detail: "Deploy the project — simulators and federation come up",
  },
  { id: "start", label: "Start simulation", detail: "Start simulation time in the federation" },
];

/** CSE project name for a scenario — stable, readable, CSE-safe. */
export function defaultProjectName(scenarioId: string): string {
  const slug = scenarioId
    .replace(/^scenario_/, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  return `CSP-${slug || "EXERCISE"}`;
}

/** True when a CSE error just says the thing already exists. */
export function isAlreadyExists(error: string | null): boolean {
  return !!error && /already exist|ALREADY_EXISTS|duplicate/i.test(error);
}
