// ── bgws/index.tsx ─────────────────────────────────────────────────────────
// BGWS: build a wargame's initial state, send it to the BGWS federate, run it,
// watch it and give its units orders — from Foundry, inside Workshop.
//
// BGWS is a constructive simulation that joins the HLA federation as a
// standing federate and waits for a scenario. Foundry never talks to it
// directly. Everything goes out as Commander functions that write rows to the
// command stream (hla_bgws_load_scenario, hla_bgws_control, the hla_* orders),
// and everything comes back on streams: units on HLA Entity Tracks, BGWS's
// state and event log on HLA Events, each command's fate on the Command
// Stream Output. See docs/BGWS.md.
//
// Two halves, one draft:
//   Build — the scenario builder (BuilderView). The control bar's "Load
//           scenario" sends the draft as "bgws.foundry" v1 JSON.
//   Live  — the federation as BGWS plays it (LiveView): events, map, unit
//           panel and orders.
// The control bar sits over both, because loading and starting belong to
// neither half alone.
//
// Mock mode replaces the three streams and every function with an in-browser
// BGWS (hooks/useBgwsMock), so the whole screen works with nothing behind it.

import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkshopContext } from "@osdk/workshop-iframe-custom-widget";
import { useMockDemo } from "@/shared/hooks/useMockDemo";
import type { EntityTrackStream } from "@/apps/hlamap/hooks/useEntityTrackStream";
import { BGWS_CONFIG } from "./bgwsConfig";
import { BGWS_EVENTS_STREAM_RID, COMMAND_OUTPUT_STREAM_RID } from "./config";
import { realBgwsApi } from "./api/bgwsClient";
import { useBgwsEvents } from "./hooks/useBgwsEvents";
import LiveTrackFeed from "./hooks/LiveTrackFeed";
import { useBgwsMock } from "./hooks/useBgwsMock";
import { useCommandOutcomes } from "./hooks/useCommandOutcomes";
import type { TailState } from "./hooks/useStreamTail";
import type {
  BgwsFoundryScenario,
  ControlCommand,
  HlaEntity,
  IssuedCommand,
  ScenarioDraft,
  ScreenMode,
} from "./types";
import { buildScenario, defaultDraft, hasErrors, importScenario, scenarioJson, validateScenario } from "./lib/scenario";
import { browserStorage, loadWorkingDraft, saveWorkingDraft } from "./lib/drafts";
import { isBgwsEntity, latestStatuses, statusesForRequest, uniqueIdsInEvents } from "./lib/events";
import { groupByCommand, summarise } from "./lib/outcomes";
import { planOrder, type BgwsOrder } from "./lib/orders";
import type { FunctionResult } from "./lib/control";
import TopBar from "./components/TopBar";
import ControlBar, { type ControlEntry } from "./components/ControlBar";
import BuilderView from "./components/BuilderView";
import LiveView from "./components/LiveView";
import type { OrderEntry } from "./components/UnitPanel";
import { UI } from "./components/styles";

/* eslint-disable @typescript-eslint/no-explicit-any */
function loaded<T>(field: any): T | null {
  return field?.fieldValue?.status === "LOADED" ? ((field.fieldValue.value as T) ?? null) : null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

let localSeq = 0;
function localId(): string {
  localSeq += 1;
  return `local-${Date.now()}-${localSeq}`;
}

const BgwsApp: FC = () => {
  // ── Workshop ──────────────────────────────────────────────────────────────
  const workshop = useWorkshopContext(BGWS_CONFIG);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = workshop.status === "LOADED" ? (workshop.value as any) : null;
  const { mockDemo, standalone, setMockDemo } = useMockDemo({
    value: loaded<boolean>(ctx?.mockDemo),
    contextLoaded: workshop.status === "LOADED",
  });
  // Standalone, Workshop's fields are only their defaults; ignore them.
  const wsMode = standalone ? null : loaded<string>(ctx?.mode);
  const wsFederate = standalone ? null : loaded<string>(ctx?.federate);
  const wsEventRid = standalone ? null : loaded<string>(ctx?.eventStreamRid);
  const wsScenario = standalone ? null : loaded<string>(ctx?.scenarioJson);

  // ── Mode and federate ─────────────────────────────────────────────────────
  const [mode, setMode] = useState<ScreenMode>("build");
  useEffect(() => {
    if (wsMode === "build" || wsMode === "live") setMode(wsMode);
  }, [wsMode]);

  const [federate, setFederate] = useState("");
  useEffect(() => {
    if (wsFederate !== null) setFederate(wsFederate);
  }, [wsFederate]);
  const changeFederate = (value: string) => {
    setFederate(value);
    ctx?.federate?.setLoadedValue?.(value);
  };

  // ── The draft ─────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<ScenarioDraft>(() => loadWorkingDraft(browserStorage()) ?? defaultDraft());
  const [native, setNative] = useState<{ name: string; json: string } | null>(null);
  const [fitToken, setFitToken] = useState(1);
  const replaceDraft = useCallback((next: ScenarioDraft) => {
    setDraft(next);
    setNative(null);
    setFitToken((t) => t + 1);
  }, []);

  // Autosave the working copy, debounced: a drag fires one change, typing many.
  useEffect(() => {
    const timer = window.setTimeout(() => saveWorkingDraft(browserStorage(), draft), 500);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const importText = useCallback(
    (text: string): string | null => {
      const result = importScenario(text);
      if (result.kind === "error") return result.message;
      if (result.kind === "native") {
        setNative({ name: result.name, json: result.json });
        return null;
      }
      replaceDraft(result.draft);
      return null;
    },
    [replaceDraft],
  );

  // Workshop's scenario input: open it when it changes to something we did not write.
  const wroteScenarioRef = useRef<string | null>(null);
  useEffect(() => {
    if (!wsScenario || wsScenario === wroteScenarioRef.current) return;
    const error = importText(wsScenario);
    if (error) console.warn("[bgws] Workshop scenarioJson could not be opened:", error);
  }, [wsScenario, importText]);

  const issues = useMemo(() => validateScenario(draft), [draft]);

  // ── Data sources ──────────────────────────────────────────────────────────
  // All hooks run every render (React's rule); the inactive ones idle. The
  // track stream is read by <LiveTrackFeed>, mounted only when live, because
  // hlamap's hook cannot be switched off.
  const [tracks, setTracks] = useState<EntityTrackStream>({ entities: [], status: null, connState: "loading", error: null });
  const mock = useBgwsMock(mockDemo);
  const eventRid = wsEventRid?.trim() || BGWS_EVENTS_STREAM_RID;
  const liveEvents = useBgwsEvents(eventRid, !mockDemo);
  const liveOutcomes = useCommandOutcomes(COMMAND_OUTPUT_STREAM_RID, !mockDemo);

  const entities = mockDemo ? mock.entities : tracks.entities;
  const events = mockDemo ? mock.events : liveEvents.events;
  const outcomeRows = mockDemo ? mock.outcomes : liveOutcomes.rows;
  const eventsState: TailState = mockDemo ? "online" : liveEvents.tail.state;
  const outcomesState: TailState = mockDemo ? "online" : liveOutcomes.tail.state;
  const api = mockDemo ? mock.api : realBgwsApi;

  // ── Federate state ────────────────────────────────────────────────────────
  const allStatuses = useMemo(() => latestStatuses(events), [events]);
  const statuses = federate ? allStatuses.filter((s) => s.federate === federate) : allStatuses;
  const federates = allStatuses.map((s) => s.federate).filter(Boolean);

  // ── Which tracks are BGWS's ───────────────────────────────────────────────
  const knownIds = useMemo(() => uniqueIdsInEvents(events), [events]);
  const isBgws = useCallback((e: HlaEntity) => isBgwsEntity(e, federate, knownIds), [federate, knownIds]);

  // ── Selection, published to Workshop ──────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => entities.find((e) => e.id === selectedId) ?? null, [entities, selectedId]);
  useEffect(() => {
    if (!ctx) return;
    ctx.selectedUnitUuid?.setLoadedValue?.(selected?.uniqueId ?? "");
    ctx.selectedUnitCallsign?.setLoadedValue?.(selected?.callsign ?? "");
    if (selected) ctx.onUnitSelected?.executeEvent?.(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.uniqueId, selected?.callsign, !!ctx]);

  // ── Commands issued from here, and how they went ──────────────────────────
  const [issued, setIssued] = useState<IssuedCommand[]>([]);
  const [lastLoaded, setLastLoaded] = useState<BgwsFoundryScenario | null>(null);
  const outcomesById = useMemo(() => groupByCommand(outcomeRows), [outcomeRows]);
  const summaryOf = useCallback(
    (c: IssuedCommand) => (c.commandId ? summarise(c.commandId, outcomesById.get(c.commandId) ?? []) : null),
    [outcomesById],
  );

  const record = (command: IssuedCommand) => setIssued((prev) => [command, ...prev].slice(0, 200));
  const settle = (id: string, result: FunctionResult) =>
    setIssued((prev) =>
      prev.map((c) => (c.id === id ? { ...c, commandId: result.commandId, error: result.ok ? undefined : result.error ?? "failed" } : c)),
    );

  /** Record a command, make the call, and fill in its id or error when it returns. */
  const issue = async (
    kind: IssuedCommand["kind"],
    label: string,
    call: () => Promise<FunctionResult>,
    unitUniqueId?: string,
  ): Promise<FunctionResult> => {
    const id = localId();
    record({ id, kind, label, unitUniqueId, issuedAt: new Date().toISOString() });
    const result = await call();
    // A queued call with no id still worked; show it as queued rather than "calling…".
    settle(id, result.ok && !result.commandId ? { ...result, commandId: id } : result);
    return result;
  };

  const loadBlockedReason = native
    ? null
    : hasErrors(issues)
      ? `Fix the scenario first: ${issues.find((i) => i.level === "error")?.message}`
      : null;

  const onLoad = async (speed?: number) => {
    const json = native?.json ?? scenarioJson(draft);
    if (!json) return;
    const name = native?.name ?? draft.name;
    const result = await issue("load", `Load “${name}”${federate ? ` → ${federate}` : ""}`, () =>
      api.loadScenario(json, federate, speed),
    );
    if (result.ok) {
      setLastLoaded(native ? null : buildScenario(draft));
      wroteScenarioRef.current = json;
      ctx?.scenarioJson?.setLoadedValue?.(json);
      ctx?.onScenarioLoaded?.executeEvent?.(undefined);
    }
  };

  const onControl = (command: ControlCommand, speed?: number) =>
    void issue("control", `${command}${command === "speed" ? ` ${speed}×` : ""}${federate ? ` → ${federate}` : ""}`, () =>
      api.control(command, federate, speed),
    );

  const onOrder = (order: BgwsOrder) => {
    if (!selected) return;
    const plan = planOrder(
      { uniqueId: selected.uniqueId, callsign: selected.callsign, altitudeMeters: selected.altitudeMeters },
      order,
    );
    if (!plan.ok) {
      record({ id: localId(), kind: "order", label: `${order.kind} ${selected.callsign}`, unitUniqueId: selected.uniqueId, issuedAt: new Date().toISOString(), error: plan.error });
      return;
    }
    void issue("order", plan.label, () => api.order(plan.call), selected.uniqueId);
  };

  // ── Views of the command list ─────────────────────────────────────────────
  const orders: OrderEntry[] = issued.filter((c) => c.kind === "order").map((c) => ({ command: c, summary: summaryOf(c) }));
  const lastControlCommand = issued.find((c) => c.kind !== "order") ?? null;
  const lastControl: ControlEntry | null = lastControlCommand
    ? {
        command: lastControlCommand,
        summary: summaryOf(lastControlCommand),
        reply: lastControlCommand.commandId ? statusesForRequest(events, lastControlCommand.commandId).slice(-1)[0] ?? null : null,
      }
    : null;

  // The live map shows the loaded scenario's area and objectives; before a load, the draft's.
  const context = lastLoaded ?? buildScenario(draft);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: UI.bg0,
        color: UI.text,
        fontFamily: UI.fontSans,
        overflow: "hidden",
      }}
    >
      {!mockDemo && <LiveTrackFeed onChange={setTracks} />}
      <TopBar
        mode={mode}
        onMode={setMode}
        title={native?.name ?? (draft.name || "BGWS")}
        mockDemo={mockDemo}
        onToggleMockDemo={standalone ? setMockDemo : undefined}
        tracks={{
          online: mockDemo || (tracks.connState === "online" && !!tracks.status?.connected),
          count: entities.length,
          bgws: entities.filter(isBgws).length,
        }}
        events={eventsState}
        outcomes={outcomesState}
      />
      <ControlBar
        federate={federate}
        onFederate={changeFederate}
        federates={federates}
        statuses={statuses}
        eventsConfigured={eventsState !== "unconfigured"}
        loadBlockedReason={loadBlockedReason}
        onLoad={(speed) => void onLoad(speed)}
        onControl={onControl}
        last={lastControl}
      />
      {mode === "build" ? (
        <BuilderView
          draft={draft}
          onChange={(update) => setDraft(update)}
          onReplace={replaceDraft}
          issues={issues}
          native={native}
          onImportFile={importText}
          onDiscardNative={() => setNative(null)}
          fitToken={fitToken}
        />
      ) : (
        <LiveView
          entities={entities}
          isBgws={isBgws}
          selected={selected}
          onSelect={setSelectedId}
          events={events}
          eventsState={eventsState}
          eventsError={mockDemo ? null : liveEvents.tail.error}
          federate={federate}
          onOrder={onOrder}
          orders={orders}
          area={context?.area ?? null}
          objectives={context?.objectives ?? []}
          tracksError={mockDemo ? null : tracks.error}
        />
      )}
    </div>
  );
};

export default BgwsApp;
