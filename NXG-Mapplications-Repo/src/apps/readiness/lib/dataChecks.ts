// apps/readiness/lib/dataChecks.ts
//
// Is the scenario's DATA ready for the demo path, phase by phase? The
// resources can all exist and the demo still stall on a phase with no ORBAT,
// no orders or no training objectives — each of which empties a later screen.
import type { MapPhaseState } from "../../scenarioPlanner/phaseCreator/types";
import type { CheckResult, CheckState } from "./requirements";

export interface PhaseFacts {
  phaseId: string;
  phaseName: string;
  /** Units on the saved start map; null when the phase has no map state. */
  mapUnits: number | null;
  /** Map units linked to an ORBAT unit. */
  linkedUnits: number;
  /** Orders (arrows) on the start map. */
  orders: number;
  /** Units in the phase ORBAT per side; null when it could not be read. */
  orbat: { blue: number; red: number } | null;
  orbatError?: string;
  /** Objectives tied to this phase, and scenario-wide ones. */
  phaseObjectives: number;
  scenarioObjectives: number;
}

/** The map half of a phase's facts. Orders are arrows assigned to a unit on the map. */
export function mapFacts(
  state: MapPhaseState | null,
): Pick<PhaseFacts, "mapUnits" | "linkedUnits" | "orders"> {
  if (!state) return { mapUnits: null, linkedUnits: 0, orders: 0 };
  const ids = new Set(state.units.map((u) => u.id));
  return {
    mapUnits: state.units.length,
    linkedUnits: state.units.filter((u) => Boolean(u.orbatRootUnitKey)).length,
    orders: state.arrows.filter((a) => a.assignedUnitId && ids.has(a.assignedUnitId)).length,
  };
}

export interface PhaseVerdict {
  state: CheckState;
  /** One line per finding, worst first. */
  findings: string[];
}

const RANK: Record<CheckState, number> = { fail: 3, warn: 2, pending: 1, ok: 0 };

function worst(states: CheckState[]): CheckState {
  return states.reduce<CheckState>((w, s) => (RANK[s] > RANK[w] ? s : w), "ok");
}

/** What would go wrong if this phase were the one demonstrated. */
export function phaseVerdict(f: PhaseFacts): PhaseVerdict {
  const found: { state: CheckState; text: string }[] = [];

  if (f.mapUnits === null) {
    found.push({
      state: "fail",
      text: "No saved map: nothing was planned, so Analyse has nothing to measure.",
    });
  } else if (f.mapUnits === 0) {
    found.push({ state: "fail", text: "The map has no units on it." });
  } else {
    if (f.orders === 0)
      found.push({
        state: "warn",
        text: "No orders: Analyse measures orders, so the compliance panel will be empty.",
      });
    const unlinked = f.mapUnits - f.linkedUnits;
    if (unlinked > 0)
      found.push({
        state: "warn",
        text: `${unlinked} of ${f.mapUnits} map units have no ORBAT behind them — they will not be in the simulation.`,
      });
  }

  if (f.orbat === null) {
    found.push({
      state: "warn",
      text: `The phase ORBAT could not be read${f.orbatError ? ` (${f.orbatError})` : ""}.`,
    });
  } else {
    const total = f.orbat.blue + f.orbat.red;
    if (total === 0)
      found.push({
        state: "fail",
        text: "No phase ORBAT: Execute has nothing to launch. Use Save phase ORBAT in the Scenario Planner.",
      });
    else if (f.orbat.blue === 0 || f.orbat.red === 0)
      found.push({
        state: "warn",
        text: `Only ${f.orbat.blue === 0 ? "red" : "blue"} forces in the ORBAT — nothing to fight.`,
      });
  }

  if (f.phaseObjectives === 0 && f.scenarioObjectives === 0)
    found.push({
      state: "warn",
      text: "No training objectives: the debrief cannot be organised around them.",
    });
  else if (f.phaseObjectives === 0)
    found.push({
      state: "ok",
      text: `No objectives tied to this phase; the debrief uses the ${f.scenarioObjectives} scenario-wide one${f.scenarioObjectives === 1 ? "" : "s"}.`,
    });

  found.sort((a, b) => RANK[b.state] - RANK[a.state]);
  const state = worst(found.map((x) => x.state));
  return {
    state,
    findings: found.length > 0 ? found.map((x) => x.text) : ["Ready for the whole demo path."],
  };
}

/** The phase that would make the best demo: the readiest, then the most built. */
export function bestPhase(facts: readonly PhaseFacts[]): PhaseFacts | null {
  const score = (f: PhaseFacts) =>
    -RANK[phaseVerdict(f).state] * 1e6 +
    (f.orbat ? f.orbat.blue + f.orbat.red : 0) +
    f.orders * 10 +
    (f.phaseObjectives + f.scenarioObjectives) * 5;
  return [...facts].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export interface RunFacts {
  runs: number;
  /** End of the most recent run, epoch seconds. */
  latestEndS: number | null;
  error?: string;
}

export function runCheck(r: RunFacts | null, now = Date.now()): CheckResult {
  const base = {
    id: "d-runs",
    stage: "analyse" as const,
    label: "Recorded runs (HLA track dataset)",
  };
  if (!r) return { ...base, state: "pending", message: "Checking…", fix: "" };
  if (r.error)
    return {
      ...base,
      state: "warn",
      message: `The track dataset could not be read (${r.error}).`,
      fix: "Check the app can read the HLA entity-tracks dataset. Demo mode does not need it.",
    };
  if (r.runs === 0)
    return {
      ...base,
      state: "warn",
      message: "No runs recorded yet. Analyse can only show the demo run.",
      fix: "Launch a phase from Execute once before the demo, or present Analyse in demo mode.",
    };
  const ageDays = r.latestEndS ? Math.floor((now / 1000 - r.latestEndS) / 86400) : null;
  return {
    ...base,
    state: "ok",
    message:
      `${r.runs} run${r.runs === 1 ? "" : "s"} recorded` +
      (ageDays === null
        ? "."
        : `, the latest ${ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`}.`),
    fix: "",
  };
}

/** Demo mode replays Baltic Shield Phase 1; Plan next phase from actuals writes beside it. */
export function demoModeCheck(found: { phase: boolean; mapState: boolean } | null): CheckResult {
  const base = {
    id: "d-demo",
    stage: "analyse" as const,
    label: "Demo mode data (Baltic Shield Phase 1)",
  };
  if (!found) return { ...base, state: "pending", message: "Checking…", fix: "" };
  if (found.phase && found.mapState)
    return {
      ...base,
      state: "ok",
      message: "obs_phase_01 and its map are in the ontology.",
      fix: "",
    };
  return {
    ...base,
    state: "warn",
    message: found.phase
      ? "obs_phase_01 has no saved map, so demo mode cannot plan the next phase from actuals."
      : "obs_phase_01 is not in the ontology, so demo mode cannot plan the next phase from actuals.",
    fix: "Only matters if you present in demo mode. Restore the Baltic Shield scenario, or demonstrate on a live run.",
  };
}
