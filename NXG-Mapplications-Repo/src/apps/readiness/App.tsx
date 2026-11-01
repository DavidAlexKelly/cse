// apps/readiness/App.tsx — Demo readiness: is everything the demo path needs
// actually there, in THIS Foundry, for THIS scenario?
//
// Two halves, both read-only:
//   Resources  every object type, action and function the screens use,
//              probed through the Ontology metadata API — including the
//              parameters and properties the app sends or reads
//   Data       per phase: a saved map, orders, a phase ORBAT on both sides,
//              training objectives; recorded runs; demo mode's own data
//
// Plus an opt-in live check of the CSE connection (it only lists
// compositions). "Copy report" gives the whole result as text.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkshopContext } from "@osdk/workshop-iframe-custom-widget";
import { AppSwitcher } from "@/components/AppSwitcher";
import { useAppNavigate } from "@/shared/hooks/useAppNavigate";
import { probeResource } from "@/shared/lib/platformMetadata";
import { liveRunner } from "../execute/lib/runner";
import { usePhaseCatalogues } from "../scenarioPlanner/hooks/usePhaseCatalogues";
import { useScenario } from "../scenarioPlanner/hooks/useScenario";
import { DEFAULT_SCENARIO_ID } from "../scenarioPlanner/shared/phaseColours";
import { loadDemoModeFacts, loadPhaseFacts, loadRunFacts } from "./data/loadFacts";
import {
  type PhaseFacts,
  type RunFacts,
  bestPhase,
  demoModeCheck,
  phaseVerdict,
  runCheck,
} from "./lib/dataChecks";
import { headline, readinessReport } from "./lib/report";
import {
  type CheckResult,
  type CheckState,
  type ProbeFinding,
  REQUIREMENTS,
  STAGES,
  evaluateResource,
  unreachableSummary,
} from "./lib/requirements";
import "./readiness.css";

const READINESS_CONFIG = [
  {
    fieldId: "scenario",
    field: {
      type: "single" as const,
      label: "Scenario (NxgScenario object set)",
      helperText: "The exercise to check. Leave unset to check Operation BALTIC SHIELD.",
      fieldValue: {
        type: "inputOutput" as const,
        variableType: { type: "temporaryObjectSetRid" as const },
      },
    },
  },
];

const ICON: Record<CheckState, string> = { pending: "◌", ok: "✓", warn: "!", fail: "✕" };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function Row({ result }: { result: CheckResult }) {
  return (
    <li className={`rd__row rd__row--${result.state}`}>
      <span className="rd__icon" aria-label={result.state}>
        {ICON[result.state]}
      </span>
      <div className="rd__row-body">
        <div className="rd__row-label">{result.label}</div>
        <div className="rd__row-msg">{result.message}</div>
        {result.fix && result.state !== "ok" && <div className="rd__row-fix">{result.fix}</div>}
        {result.fix && result.state === "ok" && <div className="rd__row-hint">{result.fix}</div>}
      </div>
    </li>
  );
}

export default function ReadinessApp() {
  const navigate = useAppNavigate();
  const workshop = useWorkshopContext(READINESS_CONFIG);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = workshop.status === "LOADED" ? (workshop.value as any) : null;
  const scenarioRaw =
    ctx?.scenario?.fieldValue?.status === "LOADED" ? ctx.scenario.fieldValue.value : undefined;
  const { scenarioMeta, ontologyPhases, loading: scenarioLoading } = useScenario(scenarioRaw);
  const scenarioId = scenarioMeta?.scenarioId ?? DEFAULT_SCENARIO_ID;
  const scenarioName = scenarioMeta?.scenarioName ?? "Operation BALTIC SHIELD";
  const phases = useMemo(() => ontologyPhases ?? [], [ontologyPhases]);
  const catalogues = usePhaseCatalogues(scenarioId);

  const [round, setRound] = useState(0);
  const [probes, setProbes] = useState<Record<string, ProbeFinding>>({});
  const [phaseFacts, setPhaseFacts] = useState<PhaseFacts[] | null>(null);
  const [runs, setRuns] = useState<RunFacts | null>(null);
  const [demoData, setDemoData] = useState<{ phase: boolean; mapState: boolean } | null>(null);
  const [cse, setCse] = useState<CheckResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [checkedAt, setCheckedAt] = useState(() => new Date());

  // ── Resources ───────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    setProbes({});
    setCheckedAt(new Date());
    // A few at a time: forty metadata calls at once is rude to the stack.
    const queue = [...REQUIREMENTS];
    const worker = async () => {
      for (let req = queue.shift(); req && live; req = queue.shift()) {
        const current = req;
        const found = await probeResource(current.kind, current.names).catch(
          (err): ProbeFinding => ({
            apiName: current.names[0],
            status: "error",
            inSdk: false,
            fields: [],
            detail: errorText(err),
          }),
        );
        if (live) setProbes((p) => ({ ...p, [current.id]: found }));
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
    return () => {
      live = false;
    };
  }, [round]);

  // ── Runs and demo-mode data ─────────────────────────────────────────────
  useEffect(() => {
    const abort = new AbortController();
    setRuns(null);
    setDemoData(null);
    void loadRunFacts(abort.signal).then((r) => !abort.signal.aborted && setRuns(r));
    void loadDemoModeFacts().then((d) => !abort.signal.aborted && setDemoData(d));
    return () => abort.abort();
  }, [round]);

  // ── Phases ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (scenarioLoading || catalogues.loading) return;
    let live = true;
    setPhaseFacts(null);
    void Promise.all(
      phases.map((p) =>
        loadPhaseFacts(scenarioId, { id: p.id, name: p.name }, catalogues.objectives),
      ),
    ).then((facts) => live && setPhaseFacts(facts));
    return () => {
      live = false;
    };
  }, [round, scenarioId, phases, scenarioLoading, catalogues.loading, catalogues.objectives]);

  // ── CSE (opt-in: it reaches out to the simulation stack) ───────────────
  const checkCse = useCallback(async () => {
    const base = {
      id: "d-cse",
      stage: "execute" as const,
      label: "CSE connection (lists compositions)",
    };
    setCse({ ...base, state: "pending", message: "Asking CSE…", fix: "" });
    try {
      const names = await liveRunner().compositions();
      setCse({
        ...base,
        state: names.length > 0 ? "ok" : "warn",
        message:
          names.length > 0
            ? `CSE answered with ${names.length} composition${names.length === 1 ? "" : "s"}: ${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}.`
            : "CSE answered, but has no compositions.",
        fix: names.length > 0 ? "" : "Create the demo composition in CSE before the rehearsal.",
      });
    } catch (err) {
      setCse({
        ...base,
        state: "fail",
        message: `CSE did not answer: ${errorText(err)}`,
        fix: "Check the CSE server and the Foundry source it is reached through, or present Execute in demo mode.",
      });
    }
  }, []);

  // ── Results ─────────────────────────────────────────────────────────────
  const results = useMemo<CheckResult[]>(() => {
    // One row, not thirty, when the metadata API itself could not be reached.
    const unreachable = unreachableSummary(REQUIREMENTS.map((r) => probes[r.id] ?? null));
    const out = unreachable
      ? [unreachable]
      : REQUIREMENTS.map((r) => evaluateResource(r, probes[r.id] ?? null));
    if (cse) out.push(cse);
    out.push(runCheck(runs), demoModeCheck(demoData));
    return out;
  }, [probes, cse, runs, demoData]);

  const phaseResults = useMemo<CheckResult[]>(() => {
    if (!phaseFacts) return [];
    if (phaseFacts.length === 0)
      return [
        {
          id: "d-phases",
          stage: "plan",
          label: "Phases",
          state: "fail",
          message: "The scenario has no phases.",
          fix: "Generate or add phases in the Scenario Planner.",
        },
      ];
    const best = bestPhase(phaseFacts);
    const v = best ? phaseVerdict(best) : null;
    return [
      {
        id: "d-best-phase",
        stage: "plan",
        label: "A phase ready to demonstrate",
        state: v?.state ?? "fail",
        message: best ? `Best candidate: ${best.phaseName}. ${v?.findings[0] ?? ""}` : "None.",
        fix: v?.state === "ok" ? "" : "See the phase table for what each phase is missing.",
      },
    ];
  }, [phaseFacts]);

  const all = useMemo(() => [...phaseResults, ...results], [phaseResults, results]);
  const head: { state: CheckState; text: string } = phaseFacts
    ? headline(all)
    : { state: "pending", text: "Checking… reading the scenario's phases." };
  const best = phaseFacts ? bestPhase(phaseFacts) : null;

  const copyReport = useCallback(() => {
    const text = readinessReport({
      scenarioName,
      generatedAt: checkedAt,
      results: all,
      phases: phaseFacts ?? [],
    });
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => window.prompt("Copy the report:", text),
    );
  }, [scenarioName, checkedAt, all, phaseFacts]);

  return (
    <div className="rd">
      <header className="rd__header">
        <div>
          <div className="rd__eyebrow">DEMO READINESS</div>
          <div className="rd__title">{scenarioName}</div>
        </div>
        <div className="rd__spacer" />
        <button
          type="button"
          className="mil-btn mil-btn--sm mil-btn--ghost"
          onClick={() => setRound((r) => r + 1)}
        >
          Re-check
        </button>
        <button type="button" className="mil-btn mil-btn--sm mil-btn--default" onClick={copyReport}>
          {copied ? "Copied" : "Copy report"}
        </button>
        <AppSwitcher />
      </header>

      <div className={`rd__banner rd__banner--${head.state}`}>
        <span className="rd__icon">{ICON[head.state]}</span>
        {head.text}
        <span className="rd__banner-note">Read-only — nothing here changes the ontology.</span>
      </div>

      <div className="rd__body">
        <section className="rd__col">
          {STAGES.map((stage) => {
            const rows = all.filter((r) => r.stage === stage.id);
            // A stage with nothing to say (e.g. when one "unreachable" row
            // stands in for every resource) is noise; Execute keeps its card
            // for the CSE check.
            if (rows.length === 0 && stage.id !== "execute") return null;
            return (
              <div key={stage.id} className="rd__card">
                <div className="rd__card-title">
                  {stage.title} <span className="rd__card-sub">{stage.screen}</span>
                </div>
                <ul className="rd__rows">
                  {rows.map((r) => (
                    <Row key={r.id} result={r} />
                  ))}
                </ul>
                {stage.id === "execute" && !cse && (
                  <button
                    type="button"
                    className="mil-btn mil-btn--sm mil-btn--default rd__cse"
                    onClick={() => void checkCse()}
                    title="Calls nxgCseGetCompositions — read-only, but it does reach the CSE server"
                  >
                    Check CSE connection
                  </button>
                )}
              </div>
            );
          })}
        </section>

        <section className="rd__col">
          <div className="rd__card">
            <div className="rd__card-title">
              Phases <span className="rd__card-sub">what each would show if demonstrated</span>
            </div>
            {!phaseFacts ? (
              <div className="rd__muted">Reading each phase's map, ORBAT and objectives…</div>
            ) : phaseFacts.length === 0 ? (
              <div className="rd__muted">No phases.</div>
            ) : (
              <table className="rd__table">
                <thead>
                  <tr>
                    <th />
                    <th>Phase</th>
                    <th title="Units on the saved start map">Map</th>
                    <th title="Orders assigned to units">Orders</th>
                    <th title="Units in the phase ORBAT">ORBAT B / R</th>
                    <th title="Training objectives tied to the phase (scenario-wide in brackets)">
                      TOs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {phaseFacts.map((p) => {
                    const v = phaseVerdict(p);
                    return (
                      <tr key={p.phaseId} className={`rd__phase rd__phase--${v.state}`}>
                        <td className="rd__icon">{ICON[v.state]}</td>
                        <td>
                          <div className="rd__phase-name">
                            {p.phaseName}
                            {best?.phaseId === p.phaseId && (
                              <span className="rd__pill">BEST FOR DEMO</span>
                            )}
                          </div>
                          <ul className="rd__findings">
                            {v.findings.map((f) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                        </td>
                        <td>{p.mapUnits ?? "—"}</td>
                        <td>{p.orders}</td>
                        <td>{p.orbat ? `${p.orbat.blue} / ${p.orbat.red}` : "?"}</td>
                        <td>{p.phaseObjectives || `(${p.scenarioObjectives})`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="rd__actions">
              <button
                type="button"
                className="mil-btn mil-btn--sm mil-btn--ghost"
                onClick={() => navigate("/scenario-plan")}
              >
                Open planner
              </button>
              <button
                type="button"
                className="mil-btn mil-btn--sm mil-btn--ghost"
                onClick={() => navigate("/execute")}
              >
                Open Execute
              </button>
            </div>
          </div>
          <div className="rd__card rd__muted">
            Probes use the Ontology metadata API with this app's own token, so &ldquo;not
            found&rdquo; can also mean the resource exists but was never added to the Developer
            Console application. Setup steps: <code>docs/DEMO_RUNBOOK.md</code>.
          </div>
        </section>
      </div>
    </div>
  );
}
