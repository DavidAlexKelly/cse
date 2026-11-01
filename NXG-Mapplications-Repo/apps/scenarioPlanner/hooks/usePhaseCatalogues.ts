// src/apps/scenarioPlanner/hooks/usePhaseCatalogues.ts
//
// Loads the ontology-backed catalogues used by the right-hand PhaseDetail
// panel tabs: TASKS, AUDIENCE, PMESII, OBJECTIVES and MEL/MIL.
//
// When a `scenarioId` is provided the hook filters every catalogue to that
// scenario only (using the scenarioId FK on each object type).  When
// scenarioId is undefined it loads all rows — the old behaviour used during
// dev / offline / when no scenario is wired from Workshop.
//
// The tabs (see PhaseDetail.tsx) already filter these full catalogues down
// to what is linked to the currently-selected phase — either by the id
// arrays on the Phase itself (`taskIds`, `audienceIds`, `pmesiiDomainIds`,
// `objectiveIds`, `injectIds`) or by the FK `phaseId` on the objects
// (used as a fallback by OBJECTIVES and MEL/MIL when the id array is empty).

import { useEffect, useState } from "react";
import { client } from "../../../client";
import {
  NxgInject,
  NxgPmesiiDomain,
  NxgTask,
  NxgTrainingAudience,
  NxgTrainingObjective,
} from "@nxg-simulation-execution-testing/sdk";
import type {
  NxgInject as NxgInjectLocal,
  NxgPmesiiDomain as NxgPmesiiDomainLocal,
  NxgTask as NxgTaskLocal,
  NxgTrainingAudience as NxgTrainingAudienceLocal,
  NxgTrainingObjective as NxgTrainingObjectiveLocal,
} from "../shared/types";

export interface PhaseCatalogues {
  tasks: NxgTaskLocal[];
  audiences: NxgTrainingAudienceLocal[];
  pmesiiDomains: NxgPmesiiDomainLocal[];
  objectives: NxgTrainingObjectiveLocal[];
  injects: NxgInjectLocal[];
  loading: boolean;
  error: string | null;
}

// Normalise the pipe-delimited directorates column (e.g. "J1|J2|J3") into
// an array. Some rows may already be arrays if the underlying dataset type
// changes; be defensive.
function normaliseDirectorates(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string" && raw.length > 0) return raw.split("|");
  return [];
}

export function usePhaseCatalogues(
  /** When provided, all catalogue queries are filtered to this scenarioId. */
  scenarioId?: string,
): PhaseCatalogues {
  const [state, setState] = useState<PhaseCatalogues>({
    tasks: [],
    audiences: [],
    pmesiiDomains: [],
    objectives: [],
    injects: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    // Set loading immediately when scenarioId changes so the UI shows a
    // fresh loading state rather than stale data from the previous scenario.
    setState((prev) => ({ ...prev, loading: true, error: null }));

    async function load() {
      try {
        // Build typed query builders filtered by scenarioId when available.
        const taskQuery      = scenarioId ? client(NxgTask).where({ scenarioId })            : client(NxgTask);
        const audQuery       = scenarioId ? client(NxgTrainingAudience).where({ scenarioId }) : client(NxgTrainingAudience);
        const pmesiiQuery    = scenarioId ? client(NxgPmesiiDomain).where({ scenarioId })     : client(NxgPmesiiDomain);
        const objQuery       = scenarioId ? client(NxgTrainingObjective).where({ scenarioId }): client(NxgTrainingObjective);
        const injectQuery    = scenarioId ? client(NxgInject).where({ scenarioId })           : client(NxgInject);

        const [taskPage, audPage, pmesiiPage, objPage, injectPage] =
          await Promise.all([
            taskQuery.fetchPage({ $pageSize: 500 }),
            audQuery.fetchPage({ $pageSize: 200 }),
            pmesiiQuery.fetchPage({ $pageSize: 200 }),
            objQuery.fetchPage({ $pageSize: 500 }),
            injectQuery.fetchPage({ $pageSize: 500 }),
          ]);

        if (cancelled) return;

        const tasks: NxgTaskLocal[] = taskPage.data.map((t) => ({
          taskId: t.taskId ?? "",
          taskName: t.taskName ?? "",
          taskDescription: t.taskDescription ?? "",
          taskStatus:
            ((t.taskStatus ?? "pending") as NxgTaskLocal["taskStatus"]),
          taskSection: t.taskSection ?? "Uncategorised",
          dueOffset: t.dueOffset ?? "",
          aiAssisted: t.aiAssisted ?? false,
          assignedTo: t.assignedToPersonId ?? undefined,
          scenarioId: t.scenarioId ?? undefined,
          // NxgTask carries a phaseId FK. It was previously dropped here, which
          // silently disabled the TASKS tab's phaseId fallback for phases loaded
          // from the ontology (which never populate phase.taskIds).
          phaseId: t.phaseId ?? undefined,
        }));

        const audiences: NxgTrainingAudienceLocal[] = audPage.data.map((a) => ({
          audienceId: a.audienceId ?? "",
          audienceName: a.audienceName ?? "",
          audienceDescription: a.audienceDescription ?? "",
          audienceType:
            ((a.audienceType ?? "secondary") as NxgTrainingAudienceLocal["audienceType"]),
          participantCount:
            typeof a.participantCount === "number"
              ? a.participantCount
              : a.participantCount != null
                ? Number(a.participantCount)
                : 0,
          directorates: normaliseDirectorates(a.directorates),
          scenarioId: a.scenarioId ?? undefined,
        }));

        const pmesiiDomains: NxgPmesiiDomainLocal[] = pmesiiPage.data.map((d) => ({
          domainId: d.domainId ?? "",
          domainKey: d.domainKey ?? "",
          domainValue: d.domainValue ?? "",
          domainStatus:
            ((d.domainStatus ?? "empty") as NxgPmesiiDomainLocal["domainStatus"]),
          aiGenerated: d.aiGenerated ?? false,
          scenarioId: d.scenarioId ?? undefined,
        }));

        const objectives: NxgTrainingObjectiveLocal[] = objPage.data.map((o) => ({
          objectiveId: o.objectiveId ?? "",
          ref: o.ref ?? "",
          objective: o.objective ?? "",
          functionalArea: o.functionalArea ?? "",
          priority:
            ((o.priority ?? "Medium") as NxgTrainingObjectiveLocal["priority"]),
          scenarioId: o.scenarioId ?? undefined,
          phaseId: o.phaseId ?? undefined,
        }));

        const injects: NxgInjectLocal[] = injectPage.data.map((i) => ({
          injectId: i.injectId ?? "",
          injectTitle: i.injectTitle ?? "",
          injectBody: i.injectBody ?? "",
          expectedResponse: i.expectedResponse ?? "",
          injectCategory: i.injectCategory ?? "",
          dayOffset: i.dayOffset ?? "",
          referencesTerrainFeatureId: i.referencesTerrainFeatureId ?? undefined,
          scenarioId: i.scenarioId ?? undefined,
          phaseId: i.phaseId ?? undefined,
        }));

        setState({
          tasks,
          audiences,
          pmesiiDomains,
          objectives,
          injects,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        console.warn("[usePhaseCatalogues] Failed to load catalogues:", err);
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [scenarioId]);

  return state;
}
