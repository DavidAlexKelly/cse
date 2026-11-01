// apps/execute/App.tsx — Execute: readiness → launch → live map, for one phase.
//
// The act of the demo between "the force is built" and "watch it fight":
//
//   1. Phase ORBAT     units per side in hier-{scenario}--{phase}
//   2. Preflight       nxgPreflightOrbatFromPhase — will it actually spawn?
//   3. CSE validation  CSE's own server-side schema (advised, not required)
//   4. Launch          export → CSE project → load → publish → start
//   5. Live map        /hlamap, in the same demo mode
//
// Demo mode (Workshop "mock-demo", or ?mock=1 standalone) simulates every CSE
// and federation call and says so on screen. The phase ORBAT is still read
// from the ontology when it can be, so the numbers in the demo are real.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkshopContext } from "@osdk/workshop-iframe-custom-widget";
import { NxgPhase } from "@nxg-simulation-execution-testing/sdk";
import { AppSwitcher } from "@/components/AppSwitcher";
import { useMockDemo } from "@/shared/hooks/useMockDemo";
import {
  type WorkshopObjectSetValue,
  useWorkshopObjectKey,
} from "@/shared/hooks/useWorkshopObjectKey";
import { phaseHierarchyKey } from "@/shared/orbat/phaseKeys";
import { loadPhaseForest } from "@/shared/orbat/phaseOrbat";
import { operationKeyForScenario } from "@/shared/orbat/scenarioOrbat";
import { useScenario } from "../scenarioPlanner/hooks/useScenario";
import { DEFAULT_SCENARIO_ID } from "../scenarioPlanner/shared/phaseColours";
import "./execute.css";
import { EXECUTE_CONFIG } from "./executeConfig";
import {
  type CheckState,
  LAUNCH_STEPS,
  type LaunchStepId,
  type OrbatCounts,
  type PreflightReport,
  assessReadiness,
  defaultProjectName,
  orbatState,
  preflightState,
} from "./lib/executePlan";
import { type CseCheck, type ExecuteTarget, demoRunner, liveRunner } from "./lib/runner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadedBool(field: any): boolean | null {
  return field?.fieldValue?.status === "LOADED"
    ? ((field.fieldValue.value as boolean) ?? null)
    : null;
}

const ICON: Record<CheckState, string> = {
  pending: "○",
  running: "◌",
  ok: "✓",
  warn: "!",
  fail: "✕",
  skipped: "–",
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function ExecuteApp() {
  const navigate = useNavigate();
  const workshop = useWorkshopContext(EXECUTE_CONFIG);
  const contextLoaded = workshop.status === "LOADED";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = contextLoaded ? (workshop.value as any) : null;
  const { mockDemo, standalone, setMockDemo } = useMockDemo({
    value: loadedBool(ctx?.mockDemo),
    contextLoaded,
  });

  // ── Scenario and phase ────────────────────────────────────────────────────
  const scenarioRaw =
    ctx?.scenario?.fieldValue?.status === "LOADED" ? ctx.scenario.fieldValue.value : undefined;
  const { scenarioMeta, ontologyPhases, loading: scenarioLoading } = useScenario(scenarioRaw);
  const scenarioId = scenarioMeta?.scenarioId ?? DEFAULT_SCENARIO_ID;
  const scenarioName = scenarioMeta?.scenarioName ?? "Operation BALTIC SHIELD";
  const phases = useMemo(() => ontologyPhases ?? [], [ontologyPhases]);

  const phaseRaw: WorkshopObjectSetValue =
    ctx?.selectedPhase?.fieldValue?.status === "LOADED"
      ? (ctx.selectedPhase.fieldValue.value as WorkshopObjectSetValue)
      : undefined;
  const inboundPhaseId = useWorkshopObjectKey(phaseRaw, NxgPhase).primaryKey ?? null;
  const [pickedPhaseId, setPickedPhaseId] = useState<string | null>(null);
  const phaseId =
    pickedPhaseId ??
    (inboundPhaseId && phases.some((p) => p.id === inboundPhaseId) ? inboundPhaseId : null) ??
    phases[0]?.id ??
    null;
  const phase = phases.find((p) => p.id === phaseId) ?? null;

  // ── CSE settings ──────────────────────────────────────────────────────────
  const [projectName, setProjectName] = useState(() => defaultProjectName(scenarioId));
  useEffect(() => setProjectName(defaultProjectName(scenarioId)), [scenarioId]);
  const [composition, setComposition] = useState("");
  const [compositions, setCompositions] = useState<string[] | null>(null);
  const [compositionsError, setCompositionsError] = useState<string | null>(null);

  // ── Checks ────────────────────────────────────────────────────────────────
  const [counts, setCounts] = useState<OrbatCounts | null>(null);
  const [orbatNote, setOrbatNote] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [preflightRun, setPreflightRun] = useState<CheckState>("pending");
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [cseCheck, setCseCheck] = useState<CseCheck | null>(null);
  const [cseRun, setCseRun] = useState<CheckState>("pending");
  const [cseError, setCseError] = useState<string | null>(null);

  const unitCountRef = useRef(0);
  unitCountRef.current = counts ? counts.blue + counts.red : 0;
  const runner = useMemo(
    () => (mockDemo ? demoRunner(() => unitCountRef.current) : liveRunner()),
    [mockDemo],
  );

  const target = useMemo<ExecuteTarget | null>(
    () =>
      phaseId
        ? { operationKey: operationKeyForScenario(scenarioId), phaseId, projectName, composition }
        : null,
    [scenarioId, phaseId, projectName, composition],
  );

  // Reset per phase / mode.
  useEffect(() => {
    setPreflight(null);
    setPreflightRun("pending");
    setPreflightError(null);
    setCseCheck(null);
    setCseRun("pending");
    setCseError(null);
    setLaunch({});
    setLaunchLog([]);
    setLaunched(false);
  }, [phaseId, mockDemo]);

  // 1. Phase ORBAT.
  useEffect(() => {
    if (!phaseId) return;
    let live = true;
    setCounts(null);
    setOrbatNote(null);
    loadPhaseForest(phaseHierarchyKey(scenarioId, phaseId), phaseId)
      .then(({ nodes }) => {
        if (!live) return;
        setCounts({
          blue: nodes.filter((n) => n.side === "blue").length,
          red: nodes.filter((n) => n.side === "red").length,
        });
      })
      .catch((err) => {
        if (!live) return;
        setCounts({ blue: 0, red: 0 });
        setOrbatNote(`Could not read the phase ORBAT: ${errorText(err)}`);
      });
    return () => {
      live = false;
    };
  }, [scenarioId, phaseId]);

  const runPreflight = useCallback(async () => {
    if (!target) return;
    setPreflightRun("running");
    setPreflightError(null);
    try {
      setPreflight(await runner.preflight(target));
      setPreflightRun("ok");
    } catch (err) {
      setPreflight(null);
      setPreflightRun("fail");
      setPreflightError(errorText(err));
    }
  }, [runner, target]);

  // Preflight runs by itself once the ORBAT is known to exist.
  const autoPreflightFor = useRef<string | null>(null);
  useEffect(() => {
    if (!phaseId || !counts || counts.blue + counts.red === 0) return;
    const key = `${phaseId}|${mockDemo}`;
    if (autoPreflightFor.current === key) return;
    autoPreflightFor.current = key;
    void runPreflight();
  }, [phaseId, counts, mockDemo, runPreflight]);

  const loadCompositions = useCallback(async () => {
    setCompositionsError(null);
    try {
      const names = await runner.compositions();
      setCompositions(names);
      setComposition((current) => current || names[0] || "");
    } catch (err) {
      setCompositions([]);
      setCompositionsError(errorText(err));
    }
  }, [runner]);
  useEffect(() => {
    void loadCompositions();
  }, [loadCompositions]);

  const runCse = useCallback(async () => {
    if (!target) return;
    setCseRun("running");
    setCseError(null);
    try {
      const check = await runner.validateWithCse(target);
      setCseCheck(check);
      setCseRun(check.passed ? "ok" : "fail");
    } catch (err) {
      setCseCheck(null);
      setCseRun("fail");
      setCseError(errorText(err));
    }
  }, [runner, target]);

  // Readiness.
  const oState = phaseId ? (counts && orbatNote ? "fail" : orbatState(counts)) : "pending";
  const pState: CheckState =
    preflightRun === "running"
      ? "running"
      : preflightRun === "fail"
        ? "fail"
        : preflight
          ? preflightState(preflight)
          : "pending";
  const readiness = assessReadiness(oState, pState, cseRun);

  // ── Launch ────────────────────────────────────────────────────────────────
  const [launch, setLaunch] = useState<Partial<Record<LaunchStepId, CheckState>>>({});
  const [launchLog, setLaunchLog] = useState<{ text: string; error?: boolean }[]>([]);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);

  const runLaunch = useCallback(async () => {
    if (!target || launching) return;
    setLaunching(true);
    setLaunched(false);
    setLaunch({});
    setLaunchLog([]);
    for (const step of LAUNCH_STEPS) {
      setLaunch((s) => ({ ...s, [step.id]: "running" }));
      try {
        const line = await runner.launchStep(step.id, target);
        setLaunch((s) => ({ ...s, [step.id]: "ok" }));
        setLaunchLog((log) => [...log, { text: line }]);
      } catch (err) {
        setLaunch((s) => ({ ...s, [step.id]: "fail" }));
        setLaunchLog((log) => [
          ...log,
          { text: `${step.label} failed — ${errorText(err)}`, error: true },
        ]);
        setLaunching(false);
        return;
      }
    }
    setLaunching(false);
    setLaunched(true);
    ctx?.onLaunched?.executeEvent?.(undefined);
  }, [target, launching, runner, ctx]);

  const openLiveMap = () => navigate(mockDemo ? "/hlamap?mock=1" : "/hlamap");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="ex">
      <header className="ex__header">
        <div>
          <div className="ex__eyebrow">EXECUTE</div>
          <div className="ex__title">{scenarioName}</div>
        </div>
        <label className="ex__phase">
          <span>Phase</span>
          <select
            value={phaseId ?? ""}
            onChange={(e) => setPickedPhaseId(e.target.value || null)}
            disabled={phases.length === 0 || launching}
          >
            {phases.length === 0 && (
              <option value="">{scenarioLoading ? "Loading…" : "No phases"}</option>
            )}
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <span className="ex__spacer" />
        {standalone ? (
          <label className="ex__demo-toggle">
            <input
              type="checkbox"
              checked={mockDemo}
              onChange={(e) => setMockDemo(e.target.checked)}
            />
            Demo mode
          </label>
        ) : (
          mockDemo && <span className="ex__demo-badge">DEMO MODE</span>
        )}
        <AppSwitcher />
      </header>

      {mockDemo && (
        <div className="ex__banner" role="status">
          Demo mode — CSE and federation calls are simulated. The phase ORBAT shown is read from the
          ontology where available.
        </div>
      )}

      <main className="ex__body">
        <section className="ex__card">
          <h2 className="ex__card-title">Readiness{phase ? ` — ${phase.name}` : ""}</h2>

          <Check
            state={oState}
            title="Phase ORBAT"
            detail={
              !counts
                ? "Reading the phase ORBAT…"
                : (orbatNote ??
                  (counts.blue + counts.red === 0
                    ? "No units in this phase's ORBAT yet."
                    : `${counts.blue} Blue · ${counts.red} Red units` +
                      (counts.red === 0 || counts.blue === 0
                        ? " — only one side has forces."
                        : "")))
            }
            action={
              <button
                type="button"
                className="mil-btn mil-btn--sm mil-btn--ghost"
                onClick={() => navigate("/scenario-plan")}
              >
                Open planner
              </button>
            }
          />

          <Check
            state={pState}
            title="Preflight"
            detail={
              preflightError ??
              preflight?.summary ??
              (pState === "running" ? "Checking every unit will actually spawn…" : "Not run yet.")
            }
            action={
              <button
                type="button"
                className="mil-btn mil-btn--sm mil-btn--default"
                onClick={() => void runPreflight()}
                disabled={!target || pState === "running" || oState === "fail"}
              >
                Run preflight
              </button>
            }
          >
            {preflight && preflight.issues.length > 0 && (
              <ul className="ex__issues">
                {preflight.issues.slice(0, 6).map((issue, i) => (
                  <li key={i} className={issue.severity === "ERROR" ? "ex__issue--error" : ""}>
                    <code>{issue.code}</code> {issue.message}
                  </li>
                ))}
                {preflight.issues.length > 6 && <li>…and {preflight.issues.length - 6} more.</li>}
              </ul>
            )}
          </Check>

          <Check
            state={cseRun}
            title="CSE validation"
            detail={
              cseError ??
              cseCheck?.note ??
              (cseRun === "running"
                ? "Exporting the ORBAT and asking CSE…"
                : "Advised before launch.")
            }
            action={
              <button
                type="button"
                className="mil-btn mil-btn--sm mil-btn--default"
                onClick={() => void runCse()}
                disabled={!target || !composition || cseRun === "running" || oState === "fail"}
                title={composition ? undefined : "Choose a composition below"}
              >
                Validate with CSE
              </button>
            }
          >
            {cseCheck && cseCheck.errors.length > 0 && (
              <ul className="ex__issues">
                {cseCheck.errors.slice(0, 6).map((e, i) => (
                  <li key={i} className="ex__issue--error">
                    {e}
                  </li>
                ))}
              </ul>
            )}
          </Check>

          <div className="ex__settings">
            <label>
              <span>CSE project</span>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={launching}
              />
            </label>
            <label>
              <span>Composition</span>
              {compositions && compositions.length > 0 ? (
                <select
                  value={composition}
                  onChange={(e) => setComposition(e.target.value)}
                  disabled={launching}
                >
                  {compositions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={composition}
                  placeholder={compositions === null ? "Loading…" : "Composition name"}
                  onChange={(e) => setComposition(e.target.value)}
                  disabled={launching}
                />
              )}
            </label>
            {compositionsError && (
              <div className="ex__hint">Could not list compositions: {compositionsError}</div>
            )}
          </div>
        </section>

        <section className="ex__card">
          <h2 className="ex__card-title">Launch</h2>
          <ol className="ex__steps">
            {LAUNCH_STEPS.map((step) => {
              const state = launch[step.id] ?? "pending";
              return (
                <li key={step.id} className={`ex__step ex__step--${state}`}>
                  <span className="ex__step-icon" aria-hidden="true">
                    {ICON[state]}
                  </span>
                  <span>
                    <span className="ex__step-label">{step.label}</span>
                    <span className="ex__step-detail">{step.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className={`ex__reason ${readiness.canLaunch ? "" : "ex__reason--blocked"}`}>
            {readiness.reason}
          </div>

          <div className="ex__actions">
            <button
              type="button"
              className="mil-btn mil-btn--md mil-btn--primary"
              onClick={() => void runLaunch()}
              disabled={!readiness.canLaunch || launching || !composition}
              title={!composition ? "Choose a composition" : readiness.reason}
            >
              {launching ? "Launching…" : launched ? "Launch again" : "▶ Launch"}
            </button>
            <button
              type="button"
              className={`mil-btn mil-btn--md ${launched ? "mil-btn--primary" : "mil-btn--default"}`}
              onClick={openLiveMap}
            >
              Open live map →
            </button>
          </div>

          {launchLog.length > 0 && (
            <ul className="ex__log" aria-live="polite">
              {launchLog.map((entry, i) => (
                <li key={i} className={entry.error ? "ex__log--error" : ""}>
                  {entry.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function Check(props: {
  state: CheckState;
  title: string;
  detail: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={`ex__check ex__check--${props.state}`}>
      <span className="ex__check-icon" aria-label={props.state}>
        {ICON[props.state]}
      </span>
      <div className="ex__check-body">
        <div className="ex__check-title">{props.title}</div>
        <div className="ex__check-detail">{props.detail}</div>
        {props.children}
      </div>
      {props.action && <div className="ex__check-action">{props.action}</div>}
    </div>
  );
}
