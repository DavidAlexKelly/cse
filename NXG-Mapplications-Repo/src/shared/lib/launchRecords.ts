// shared/lib/launchRecords.ts
//
// What was launched, where and how it went — one record per launch.
//
// The record of truth is the NxgCseLaunch object type in the ontology
// (docs/ORBAT_PIPELINE_PLAN.md, 4.3), written by Execute as each launch step
// completes, and read by Analysis (which run executed which phase) and
// Readiness (the last launch of each phase).
//
// Every record is also kept in this browser's localStorage. That keeps the
// screens working before the object type exists, and is the only store for
// demo launches, which must not land in the real record. Writes go through
// create/modify actions called by name (shared/lib/platformObjects), so
// nothing waits on an SDK release.
//
// This module is pure: the network half is in launchStore.ts.

export type LaunchStatus = "running" | "launched" | "failed";

export interface LaunchRecord {
  /** Primary key. Older device-only records have none and get one on read. */
  launchId?: string;
  scenarioId: string;
  phaseId: string;
  phaseName: string;
  operationKey?: string;
  project?: string;
  composition?: string;
  status?: LaunchStatus;
  /** The launch step that failed, when status is "failed". */
  failedStep?: string;
  error?: string;
  /** Units in the phase ORBAT at launch. */
  unitCount?: number;
  /** Short hash of the exported ORBAT XML — which version of the force went in. */
  orbatDigest?: string;
  /** Epoch seconds. */
  startedAtS?: number;
  publishedAtS?: number;
  simStartedAtS?: number;
  endedAtS?: number;
  /**
   * Epoch seconds when the launch completed (simulation start requested).
   * For a failed or running launch, when it started.
   */
  launchedAtS: number;
  demo: boolean;
}

export const LAUNCH_OBJECT_TYPE = "NxgCseLaunch";
export const LAUNCH_ACTIONS = {
  create: "createNxgCseLaunch",
  modify: "modifyNxgCseLaunch",
} as const;
export const LAUNCH_OBJECT_PARAM = "nxgCseLaunch";

/** Every property the app writes — the object type must have all of them. */
export const LAUNCH_PROPERTIES = [
  "launchId",
  "scenarioId",
  "phaseId",
  "phaseName",
  "operationKey",
  "project",
  "composition",
  "status",
  "failedStep",
  "error",
  "unitCount",
  "orbatDigest",
  "demo",
  "startedAt",
  "publishedAt",
  "simStartedAt",
  "endedAt",
  "launchedAt",
] as const;

const KEY = "nxg.execute.launches";
const KEEP = 50;

function iso(s: number | undefined): string | null {
  return s == null || !Number.isFinite(s) ? null : new Date(s * 1000).toISOString();
}

function epoch(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** A stable id for a record written before records had ids. */
export function launchIdOf(r: LaunchRecord): string {
  return r.launchId ?? `legacy-${r.scenarioId}-${r.phaseId}-${r.launchedAtS}`;
}

/** The ontology properties for a record. */
export function launchProperties(
  r: LaunchRecord,
): Record<string, string | number | boolean | null> {
  return {
    launchId: launchIdOf(r),
    scenarioId: r.scenarioId,
    phaseId: r.phaseId,
    phaseName: r.phaseName,
    operationKey: r.operationKey ?? null,
    project: r.project ?? null,
    composition: r.composition ?? null,
    status: r.status ?? "launched",
    failedStep: r.failedStep ?? null,
    error: r.error ? r.error.slice(0, 4000) : null,
    unitCount: r.unitCount ?? null,
    orbatDigest: r.orbatDigest ?? null,
    demo: r.demo,
    startedAt: iso(r.startedAtS),
    publishedAt: iso(r.publishedAtS),
    simStartedAt: iso(r.simStartedAtS),
    endedAt: iso(r.endedAtS),
    launchedAt: iso(r.launchedAtS),
  };
}

/** A record from an NxgCseLaunch object's properties; null if it isn't one. */
export function launchFromObject(o: Record<string, unknown>): LaunchRecord | null {
  const launchId = str(o.launchId);
  const scenarioId = str(o.scenarioId);
  const phaseId = str(o.phaseId);
  const launchedAtS = epoch(o.launchedAt) ?? epoch(o.startedAt);
  if (!launchId || !scenarioId || !phaseId || launchedAtS == null) return null;
  const status = str(o.status);
  return {
    launchId,
    scenarioId,
    phaseId,
    phaseName: str(o.phaseName) ?? phaseId,
    operationKey: str(o.operationKey),
    project: str(o.project),
    composition: str(o.composition),
    status: status === "running" || status === "failed" ? status : "launched",
    failedStep: str(o.failedStep),
    error: str(o.error),
    unitCount: typeof o.unitCount === "number" ? o.unitCount : undefined,
    orbatDigest: str(o.orbatDigest),
    startedAtS: epoch(o.startedAt),
    publishedAtS: epoch(o.publishedAt),
    simStartedAtS: epoch(o.simStartedAt),
    endedAtS: epoch(o.endedAt),
    launchedAtS,
    demo: o.demo === true,
  };
}

/** Device and ontology records together, newest first; the ontology wins per id. */
export function mergeLaunches(
  local: readonly LaunchRecord[],
  remote: readonly LaunchRecord[],
): LaunchRecord[] {
  const byId = new Map<string, LaunchRecord>();
  for (const r of local) byId.set(launchIdOf(r), r);
  for (const r of remote) byId.set(launchIdOf(r), r);
  return [...byId.values()].sort((a, b) => b.launchedAtS - a.launchedAtS);
}

export function readLaunchRecords(): LaunchRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LaunchRecord[]) : [];
  } catch {
    return [];
  }
}

/** Insert or replace (by launch id) on this device. */
export function recordLaunch(record: LaunchRecord): void {
  try {
    const id = launchIdOf(record);
    const rest = readLaunchRecords().filter((r) => launchIdOf(r) !== id);
    window.localStorage.setItem(KEY, JSON.stringify([record, ...rest].slice(0, KEEP)));
  } catch {
    /* storage unavailable — the ontology copy (if any) still stands */
  }
}

/** Launches are recorded when the launch completes; the run's first tracks follow shortly after. */
const BEFORE_RUN_S = 15 * 60;
const AFTER_START_S = 5 * 60;

/**
 * The launch that started this run: the latest successful, non-demo launch in
 * the window from a quarter of an hour before the run's first track to five
 * minutes after it.
 */
export function launchForRun(
  run: { startS: number; endS: number },
  records: readonly LaunchRecord[],
): LaunchRecord | null {
  const candidates = records.filter(
    (r) =>
      !r.demo &&
      (r.status ?? "launched") === "launched" &&
      r.launchedAtS >= run.startS - BEFORE_RUN_S &&
      r.launchedAtS <= run.startS + AFTER_START_S,
  );
  candidates.sort((a, b) => b.launchedAtS - a.launchedAtS);
  return candidates[0] ?? null;
}

/** The most recent launch of each phase. */
export function latestLaunchByPhase(records: readonly LaunchRecord[]): Map<string, LaunchRecord> {
  const out = new Map<string, LaunchRecord>();
  for (const r of [...records].sort((a, b) => b.launchedAtS - a.launchedAtS)) {
    if (!out.has(r.phaseId)) out.set(r.phaseId, r);
  }
  return out;
}

/** Short, stable digest of a string (FNV-1a, 64-bit as two 32-bit halves) — not cryptographic. */
export function digestOf(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
