// ============================================================
// useNxgTrainingAudiences
//
// Loads NxgTrainingAudience objects from the ontology, filtered
// by scenarioId, together with the NxgParticipatingNation rows
// that hang off each audience.
//
// Participating nations used to have no ontology home and were
// mock-only. They are now a first-class object type, so the
// nations table reflects real data.
//
// directorates is stored pipe-delimited in Foundry and is split
// into an array here.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { NxgParticipatingNation, NxgTrainingAudience } from "@custom-widget/sdk";
import type { Osdk } from "@osdk/client";
import { client } from "../../client.js";
import { TRAINING_AUDIENCES } from "../data/index.js";
import type {
  ParticipatingNation,
  TrainingAudienceRecord,
} from "../data/index.js";
import { splitDirectorates } from "./useNxgAudienceMutations.js";
import type { DataSource } from "./dataSource.js";

export type { TrainingAudienceRecord };

/** A participating nation plus its ontology primary key, needed for edits. */
export interface ParticipatingNationRecord extends ParticipatingNation {
  participatingNationId: string;
}

function osdkToNation(
  obj: Osdk.Instance<NxgParticipatingNation>,
): ParticipatingNationRecord {
  return {
    participatingNationId: obj.participatingNationId,
    nation: obj.nationCode ?? "",
    role: obj.nationRole ?? "",
    participantCount: Number(obj.participantCount ?? 0),
    directorates: splitDirectorates(obj.directorates),
  };
}

function osdkToRecord(
  obj: Osdk.Instance<NxgTrainingAudience>,
  participatingNations: ParticipatingNationRecord[],
): TrainingAudienceRecord {
  return {
    audienceId: obj.audienceId,
    name: obj.audienceName ?? "",
    audienceType:
      obj.audienceType === "primary" || obj.audienceType === "secondary"
        ? obj.audienceType
        : "secondary",
    participantCount: Number(obj.participantCount ?? 0),
    description: obj.audienceDescription ?? "",
    directorates: splitDirectorates(obj.directorates),
    participatingNations,
  };
}

export interface UseNxgTrainingAudiencesResult {
  audiences: TrainingAudienceRecord[];
  loading: boolean;
  error: string | null;
  /** Whether `audiences` came from the ontology or from local seed data. */
  source: DataSource;
  refresh: () => void;
}

export function useNxgTrainingAudiences(
  scenarioId: string | null | undefined,
): UseNxgTrainingAudiencesResult {
  const [audiences, setAudiences] = useState<TrainingAudienceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>("unbound");

  const load = useCallback(async () => {
    // No scenario bound — show nothing rather than quietly loading a
    // default exercise. The widget renders an explicit empty state.
    if (scenarioId == null) {
      setAudiences([]);
      setSource("unbound");
      setLoading(false);
      setError(null);
      return;
    }
    const resolvedId = scenarioId;

    setLoading(true);
    setError(null);
    try {
      // Nations are denormalised with a scenarioId, so one query
      // covers every audience in the scenario.
      const nationsByAudience = new Map<string, ParticipatingNationRecord[]>();
      for await (const obj of client(NxgParticipatingNation)
        .where({ scenarioId: { $eq: resolvedId } })
        .asyncIter()) {
        const key = obj.audienceId ?? "";
        const record = osdkToNation(obj);
        const bucket = nationsByAudience.get(key);
        if (bucket) bucket.push(record);
        else nationsByAudience.set(key, [record]);
      }

      const results: TrainingAudienceRecord[] = [];
      for await (const obj of client(NxgTrainingAudience)
        .where({ scenarioId: { $eq: resolvedId } })
        .asyncIter()) {
        const nations = (nationsByAudience.get(obj.audienceId) ?? [])
          .slice()
          .sort((a, b) => a.nation.localeCompare(b.nation));
        results.push(osdkToRecord(obj, nations));
      }

      if (results.length > 0) {
        // Primary first, then secondary
        results.sort((a, b) => {
          if (a.audienceType === b.audienceType) return 0;
          return a.audienceType === "primary" ? -1 : 1;
        });
        setAudiences(results);
        setSource("ontology");
      } else {
        setAudiences(TRAINING_AUDIENCES);
        setSource("seed");
      }
    } catch (e) {
      setError(String(e));
      setAudiences(TRAINING_AUDIENCES);
      setSource("seed");
    } finally {
      setLoading(false);
    }
  }, [scenarioId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { audiences, loading, error, source, refresh: load };
}
