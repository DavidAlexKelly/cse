// ============================================================
// useRichPhases
//
// Loads NxgPhase objects for a scenario and enriches each one
// with figures derived from live ontology data:
//   - MEL/MIL counts from NxgInject
//   - Open task counts from NxgTask
//   - Readiness, active actors and planning gaps, derived
//   - Calendar dates resolved from D-Day relative offsets
//
// Two things changed here versus the original implementation:
//
//  1. It queried a hard-coded scenario ("scenario_iron_forge_26")
//     and explicitly discarded the scenarioId argument, so the
//     widget showed the same phases whatever Workshop passed in.
//     It now honours the scenario it is given.
//
//  2. Readiness and gaps came from MOCK_PHASE_EXTRAS keyed by
//     phase id, so they were static and only existed for the
//     original demo phases. They are now derived from the
//     scenario's own tasks, injects and objectives.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NxgInject,
  NxgPhase,
  NxgScenario,
  NxgTask,
  NxgTrainingObjective,
} from "@custom-widget/sdk";
import type { Osdk } from "@osdk/client";
import { client } from "../client.js";
import { MOCK_RICH_PHASES } from "../shared/data/mockPhases.js";
import type { RichPhaseRecord } from "../shared/data/mockPhases.js";
import { phaseDisplayLabel } from "../shared/hooks/useNxgPhases.js";
import type { DataSource } from "../shared/hooks/dataSource.js";
import { normaliseTaskStatus } from "../shared/task/taskTaxonomy.js";
import {
  detectPhaseGaps,
  durationDaysBetween,
  phaseReadinessPct,
  resolveOffsetDate,
} from "../shared/metrics/planningMetrics.js";
import type { WorkflowTask } from "../task-manager/task-assignment/types.js";

// ── Per-phase aggregates computed from live ontology data ─────────────────

interface InjectStats {
  melCount: number;
  milCount: number;
  injectReviewCount: number;
  unassignedMil: number;
  total: number;
}

function emptyInjectStats(): InjectStats {
  return {
    melCount: 0,
    milCount: 0,
    injectReviewCount: 0,
    unassignedMil: 0,
    total: 0,
  };
}

async function fetchInjectStats(
  scenarioId: string,
): Promise<Map<string, InjectStats>> {
  const map = new Map<string, InjectStats>();

  for await (const inject of client(NxgInject)
    .where({ scenarioId: { $eq: scenarioId } })
    .asyncIter()) {
    const pid = inject.phaseId;
    if (!pid) continue;
    let entry = map.get(pid);
    if (!entry) {
      entry = emptyInjectStats();
      map.set(pid, entry);
    }
    entry.total++;
    const cat = inject.injectCategory?.toLowerCase() ?? "";
    if (cat === "mel") {
      entry.melCount++;
    } else if (cat === "mil") {
      entry.milCount++;
      // MIL without an expected response counts as unassigned
      if (!inject.expectedResponse) entry.unassignedMil++;
    }
    // An inject with neither a body nor a title needs review
    if (!inject.injectBody && !inject.injectTitle) entry.injectReviewCount++;
  }

  return map;
}

/**
 * Loads the scenario's tasks into the shared WorkflowTask shape so the
 * same readiness and gap helpers can be used here as in the task widgets.
 */
async function fetchTasksByPhase(
  scenarioId: string,
): Promise<Map<string, WorkflowTask[]>> {
  const map = new Map<string, WorkflowTask[]>();

  for await (const task of client(NxgTask)
    .where({ scenarioId: { $eq: scenarioId } })
    .asyncIter()) {
    const pid = task.phaseId;
    if (!pid) continue;
    const record = {
      id: task.taskId,
      phaseId: pid,
      title: task.taskName ?? "",
      description: task.taskDescription ?? "",
      owner: task.assignedToPersonId ?? null,
      approver: task.approvedByPersonId ?? null,
      due: task.dueOffset ?? "",
      status: normaliseTaskStatus(task.taskStatus),
    } as WorkflowTask;
    const bucket = map.get(pid);
    if (bucket) bucket.push(record);
    else map.set(pid, [record]);
  }

  return map;
}

async function fetchObjectiveCounts(
  scenarioId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for await (const objective of client(NxgTrainingObjective)
    .where({ scenarioId: { $eq: scenarioId } })
    .asyncIter()) {
    const pid = objective.phaseId;
    if (!pid) continue;
    map.set(pid, (map.get(pid) ?? 0) + 1);
  }
  return map;
}

async function fetchDDay(scenarioId: string): Promise<string | null> {
  try {
    const scenario = await client(NxgScenario).fetchOne(scenarioId);
    return scenario.dDay ?? null;
  } catch {
    // A missing scenario is not fatal — offsets just stay unresolved.
    return null;
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Renders a phase boundary for display.
 *
 * These fields have held two different things over time: real ISO dates
 * on older scenarios, and D-Day relative offsets ("D+0") on newer ones.
 * Handle both — resolve offsets against the scenario's D-Day where one
 * is set, otherwise show the raw value rather than a broken date.
 */
function displayBoundary(raw: string, dDay: string | null): string {
  if (!raw) return "—";
  const resolved = resolveOffsetDate(dDay, raw);
  if (resolved) return formatDate(resolved);
  const iso = new Date(`${raw}T00:00:00Z`);
  if (!Number.isNaN(iso.getTime())) return formatDate(iso);
  return raw;
}

function calcDurationDays(
  startRaw: string,
  endRaw: string,
  dDay: string | null,
): number {
  const byOffset = durationDaysBetween(startRaw, endRaw);
  if (byOffset != null) return byOffset;

  const start = resolveOffsetDate(dDay, startRaw) ?? new Date(`${startRaw}T00:00:00Z`);
  const end = resolveOffsetDate(dDay, endRaw) ?? new Date(`${endRaw}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end < start) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function normaliseStatus(raw: string): RichPhaseRecord["phaseStatus"] {
  switch (raw?.toLowerCase()) {
    case "approved":
      return "approved";
    case "validated":
      return "validated";
    case "needs-review":
    case "needs_review":
      return "needs-review";
    case "draft":
      return "draft";
    case "active":
      return "active";
    default:
      return "planning";
  }
}

interface EnrichmentInputs {
  injectStats: Map<string, InjectStats>;
  tasksByPhase: Map<string, WorkflowTask[]>;
  objectiveCounts: Map<string, number>;
  dDay: string | null;
}

function osdkToRich(
  obj: Osdk.Instance<NxgPhase>,
  { injectStats, tasksByPhase, objectiveCounts, dDay }: EnrichmentInputs,
): RichPhaseRecord {
  const id = obj.phaseId;
  const seq = Number(obj.sequenceNumber ?? 0);

  const inj = injectStats.get(id) ?? emptyInjectStats();
  const tasks = tasksByPhase.get(id) ?? [];
  const objectiveCount = objectiveCounts.get(id) ?? 0;

  const openTasks = tasks.filter((t) => t.status !== "approved").length;

  // Distinct people named as owner or approver on this phase's tasks.
  const actors = new Set<string>();
  for (const task of tasks) {
    if (task.owner) actors.add(task.owner);
    if (task.approver) actors.add(task.approver);
  }

  const startRaw = obj.startOffset ?? "";
  const endRaw = obj.endOffset ?? "";

  return {
    phaseId: id,
    phaseName: phaseDisplayLabel(seq),
    phaseTitle: obj.phaseName ?? id,
    phaseDescription: obj.phaseDescription ?? "",
    objectiveStatement: obj.objectiveStatement ?? "",
    startOffset: startRaw,
    endOffset: endRaw,
    phaseStatus: normaliseStatus(obj.phaseStatus ?? "planning"),
    sequenceNumber: seq,
    scenarioId: obj.scenarioId ?? "",
    startDate: displayBoundary(startRaw, dDay),
    endDate: displayBoundary(endRaw, dDay),
    durationDays: calcDurationDays(startRaw, endRaw, dDay),
    melCount: inj.melCount,
    milCount: inj.milCount,
    injectReviewCount: inj.injectReviewCount,
    unassignedMil: inj.unassignedMil,
    openTasks,
    readinessPct: phaseReadinessPct(tasks),
    activeActors: actors.size,
    // No ontology source for this yet — ORBAT units are not linked to
    // phases. Left at zero rather than showing an invented figure.
    orbatEntities: 0,
    gaps: detectPhaseGaps({
      phaseId: id,
      tasks,
      injectCount: inj.total,
      objectiveCount,
    }),
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────

export interface UseRichPhasesResult {
  phases: RichPhaseRecord[];
  phaseObjects: Map<string, Osdk.Instance<NxgPhase>>;
  loading: boolean;
  error: string | null;
  /** Whether `phases` came from the ontology or from local seed data. */
  source: DataSource;
  refresh: () => void;
}

export function useRichPhases(
  scenarioId: string | null | undefined,
): UseRichPhasesResult {
  // Starts empty: seed phases are only shown once a real fetch has come
  // back with nothing, so mock data cannot flash before the first load.
  const [phases, setPhases] = useState<RichPhaseRecord[]>([]);
  const [phaseObjects, setPhaseObjects] = useState<
    Map<string, Osdk.Instance<NxgPhase>>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>("unbound");
  const hasLoaded = useRef(false);

  const load = useCallback(async () => {
    // No scenario bound — show nothing rather than quietly loading a
    // default exercise. The widget renders an explicit empty state.
    if (scenarioId == null) {
      setPhases([]);
      setPhaseObjects(new Map());
      setSource("unbound");
      setLoading(false);
      setError(null);
      return;
    }
    const resolvedId = scenarioId;
    setLoading(true);
    setError(null);
    try {
      const [injectStats, tasksByPhase, objectiveCounts, dDay] =
        await Promise.all([
          fetchInjectStats(resolvedId),
          fetchTasksByPhase(resolvedId),
          fetchObjectiveCounts(resolvedId),
          fetchDDay(resolvedId),
        ]);

      const enrichment: EnrichmentInputs = {
        injectStats,
        tasksByPhase,
        objectiveCounts,
        dDay,
      };

      const results: RichPhaseRecord[] = [];
      const objMap = new Map<string, Osdk.Instance<NxgPhase>>();

      for await (const obj of client(NxgPhase)
        .where({ scenarioId: { $eq: resolvedId } })
        .asyncIter()) {
        results.push(osdkToRich(obj, enrichment));
        objMap.set(obj.phaseId, obj);
      }

      results.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

      if (results.length > 0) {
        setPhases(results);
        setPhaseObjects(objMap);
        setSource("ontology");
      } else if (!hasLoaded.current) {
        setPhases(MOCK_RICH_PHASES);
        setPhaseObjects(new Map());
        setSource("seed");
      }

      hasLoaded.current = true;
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [scenarioId]);

  useEffect(() => {
    hasLoaded.current = false;
    void load();
  }, [load]);

  return { phases, phaseObjects, loading, error, source, refresh: load };
}
