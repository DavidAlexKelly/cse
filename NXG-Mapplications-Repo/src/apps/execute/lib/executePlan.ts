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

export interface PreflightIssue {
  severity: "ERROR" | "WARNING" | string;
  code: string;
  message: string;
}

export interface PreflightReport {
  summary: string;
  errors: number;
  warnings: number;
  issues: PreflightIssue[];
}

function asObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

/** Parse nxgPreflightOrbatFromPhase's report. Null if it isn't one. */
export function parsePreflight(raw: unknown): PreflightReport | null {
  const o = asObject(raw);
  if (!o) return null;
  const issues = Array.isArray(o.issues)
    ? o.issues
        .map((i) => asObject(i))
        .filter((i): i is Record<string, unknown> => !!i)
        .map((i) => ({
          severity: String(i.severity ?? "WARNING"),
          code: String(i.code ?? ""),
          message: String(i.message ?? ""),
        }))
    : [];
  const errors =
    typeof o.errors === "number" ? o.errors : issues.filter((i) => i.severity === "ERROR").length;
  const warnings =
    typeof o.warnings === "number"
      ? o.warnings
      : issues.filter((i) => i.severity !== "ERROR").length;
  return {
    summary:
      typeof o.summary === "string" ? o.summary : `${errors} error(s), ${warnings} warning(s)`,
    errors,
    warnings,
    issues,
  };
}

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
