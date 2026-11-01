// shared/lib/launchStore.ts
//
// Reading and writing launch records: the ontology (NxgCseLaunch) when it is
// there, this device always. See launchRecords.ts for the record itself.
import { useCallback, useEffect, useState } from "react";
import {
  OntologyResourceMissing,
  applyActionByName,
  searchObjectsByName,
} from "@/shared/lib/platformObjects";
import {
  LAUNCH_ACTIONS,
  LAUNCH_OBJECT_PARAM,
  LAUNCH_OBJECT_TYPE,
  type LaunchRecord,
  launchFromObject,
  launchIdOf,
  launchProperties,
  mergeLaunches,
  readLaunchRecords,
  recordLaunch,
} from "./launchRecords";

export type LaunchStorage = "loading" | "foundry" | "device";

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Ids known to exist in the ontology this session — decides create vs modify. */
const created = new Set<string>();
/** One write queue per launch, so a modify never overtakes its create. */
const queues = new Map<string, Promise<unknown>>();

export interface SaveOutcome {
  storage: "foundry" | "device";
  /** Why it is device-only, when it is. */
  note: string | null;
}

/**
 * Save a launch record: on this device at once, and in the ontology (queued
 * per launch) unless it is a demo launch. Never throws — a launch must not
 * fail because its record could not be written.
 */
export function saveLaunch(record: LaunchRecord): Promise<SaveOutcome> {
  recordLaunch(record);
  if (record.demo) {
    return Promise.resolve({
      storage: "device",
      note: "Demo launch — recorded on this device only.",
    });
  }
  const id = launchIdOf(record);
  const props = launchProperties(record);
  const prior = queues.get(id) ?? Promise.resolve();
  const next = prior.then(async (): Promise<SaveOutcome> => {
    try {
      if (created.has(id)) {
        const { launchId: _pk, ...rest } = props;
        void _pk;
        await applyActionByName(LAUNCH_ACTIONS.modify, { [LAUNCH_OBJECT_PARAM]: id, ...rest });
      } else {
        await applyActionByName(LAUNCH_ACTIONS.create, props);
        created.add(id);
      }
      return { storage: "foundry", note: null };
    } catch (err) {
      return {
        storage: "device",
        note:
          err instanceof OntologyResourceMissing
            ? `${LAUNCH_OBJECT_TYPE} is not set up in the ontology yet — the launch is recorded on this device only.`
            : `Could not record the launch in Foundry (${describe(err)}) — it is recorded on this device.`,
      };
    }
  });
  queues.set(id, next);
  return next;
}

/** Launch records for a scenario: the ontology's, merged over this device's. */
export async function loadLaunches(
  scenarioId: string,
  persist: boolean,
): Promise<{ launches: LaunchRecord[]; storage: "foundry" | "device"; note: string | null }> {
  const local = readLaunchRecords().filter((r) => r.scenarioId === scenarioId);
  if (!persist) return { launches: mergeLaunches(local, []), storage: "device", note: null };
  try {
    const objects = await searchObjectsByName(LAUNCH_OBJECT_TYPE, { scenarioId }, 500);
    const remote = objects.map((o) => launchFromObject(o)).filter((r): r is LaunchRecord => !!r);
    for (const r of remote) created.add(launchIdOf(r));
    return { launches: mergeLaunches(local, remote), storage: "foundry", note: null };
  } catch (err) {
    return {
      launches: mergeLaunches(local, []),
      storage: "device",
      note:
        err instanceof OntologyResourceMissing
          ? `${LAUNCH_OBJECT_TYPE} is not set up in the ontology yet — only launches made on this device are known.`
          : `Could not read launch records from Foundry (${describe(err)}).`,
    };
  }
}

export function useLaunchRecords(
  scenarioId: string | null,
  persist: boolean,
): {
  launches: LaunchRecord[];
  storage: LaunchStorage;
  note: string | null;
  reload: () => void;
} {
  const [state, setState] = useState<{
    launches: LaunchRecord[];
    storage: LaunchStorage;
    note: string | null;
  }>({ launches: [], storage: "loading", note: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!scenarioId) {
      setState({ launches: [], storage: "device", note: null });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, storage: "loading" }));
    void loadLaunches(scenarioId, persist).then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, [scenarioId, persist, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
