// src/shared/orbat/preflight.ts
//
// The Translator's preflight report (nxgPreflightOrbatFromPhase and its
// composition-aware twin), parsed defensively. Shared by Execute, which gates
// the launch on it, and ORBAT Manager, which shows it while the force is edited
// — the same check on the same export, so the two screens cannot disagree.

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

export function asObject(raw: unknown): Record<string, unknown> | null {
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
