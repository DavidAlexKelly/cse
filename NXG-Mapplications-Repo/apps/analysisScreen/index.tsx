// ── analysisScreen/index.tsx ───────────────────────────────────────────────
// After-action analysis of the HLA entity-tracks feed.
//
// The same map as hlamap — shared/hla/EntityMap, so the same APP-6 symbols,
// the same zoom-based echelon roll-up and the same hover naming — pointed at
// history instead of at now. hlamap tails the stream and lets you task what
// you see; this screen picks up a finished run, loads the opening window of
// it, and lets an analyst scrub, play and pause anywhere across its full
// duration. Windows outside the resident buffer are fetched on demand when the
// playhead lands on them, so a 16-hour run is navigable without ever pulling
// 20 million rows into the browser.

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HlaEntity, LatLon } from "@/shared/hla/types";
import AnalysisMap, {
  DEFAULT_PLAN_LAYERS,
  type PlanLayerToggles,
} from "./components/AnalysisMap";
import CompliancePanel from "./components/CompliancePanel";
import DebriefView from "./components/DebriefView";
import SidePanel from "./components/SidePanel";
import Timeline from "./components/Timeline";
import TopBar, { type AnalysisView } from "./components/TopBar";
import { UI } from "./components/ui";
import { listRuns } from "./data/tracks";
import { SqlError } from "./data/sqlClient";
import { planKeyEvents } from "./lib/planEvents";
import { useRunPlayback } from "./hooks/useRunPlayback";
import { createMockRun, useMockRunPlayback } from "./hooks/useMockRunPlayback";
import { useWorkshopContext } from "@osdk/workshop-iframe-custom-widget";
import { useMockDemo } from "@/shared/hooks/useMockDemo";
import { ANALYSIS_CONFIG } from "./analysisConfig";
import type { RunSummary } from "./types";

/** Positions retained behind the selected unit, in frames. */
const TRAIL_LENGTH = 240;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Run boundaries only change when a new federation execution happens;
      // there is no value in refetching them on every window focus.
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Banner({ tone, children }: { tone: "error" | "warn"; children: React.ReactNode }) {
  const color = tone === "error" ? UI.red : UI.amber;
  return (
    <div
      style={{
        background: `${color}18`,
        borderBottom: `1px solid ${color}66`,
        color,
        fontFamily: UI.fontMono,
        fontSize: 11,
        padding: "8px 14px",
        lineHeight: 1.5,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadedString(field: any): string | null {
  return field?.fieldValue?.status === "LOADED"
    ? (field.fieldValue.value as string) ?? null
    : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadedBool(field: any): boolean | null {
  return field?.fieldValue?.status === "LOADED"
    ? (field.fieldValue.value as boolean) ?? null
    : null;
}

const AnalysisScreen: FC = () => {
  // mock-demo (Workshop, bidirectional): replays a synthetic
  // OP-BALTIC-SHIELD-2026 run when no simulation has ever been executed. Wire
  // this to the same Workshop boolean as the HLA Map widget so both switch
  // together and the replay matches the live view.
  //
  // Outside Workshop there is no variable to wire, so useMockDemo hands the
  // setting to the app and TopBar renders a toggle for it — otherwise the mock
  // demo is unreachable in `npm run dev` and in preview, which is where it is
  // most often wanted. Embedded, Workshop still wins and no toggle appears.
  const workshopCtxAsync = useWorkshopContext(ANALYSIS_CONFIG);
  const workshopContextLoaded = workshopCtxAsync.status === "LOADED";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = workshopContextLoaded ? (workshopCtxAsync.value as any) : null;
  const {
    mockDemo,
    standalone: ownsMockDemo,
    setMockDemo,
  } = useMockDemo({
    value: loadedBool(ctx?.mockDemo),
    contextLoaded: workshopContextLoaded,
  });

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [stepSeconds, setStepSeconds] = useState(2);

  // ── Plan overlay state ───────────────────────────────────────────────────
  // Collapsed by default: the map is the point of this screen, and a table
  // should not take a third of it before anyone asks.
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [planExpanded, setPlanExpanded] = useState(false);
  const [planLayers, setPlanLayers] = useState<PlanLayerToggles>(DEFAULT_PLAN_LAYERS);

  // Map first: the replay is what this screen is, and the debrief is where you
  // go once you want the run summarised rather than watched.
  const [view, setView] = useState<AnalysisView>("map");

  const runsQuery = useQuery({
    queryKey: ["analysisScreen", "runs"],
    queryFn: ({ signal }) => listRuns(signal),
    // No point querying the tracks dataset when the run is synthetic — and it
    // keeps the demo clean if that dataset is empty or ungranted.
    enabled: !mockDemo,
  });

  // Anchored once per mount: a run whose bounds moved every render would make
  // the timeline jitter and break seeking.
  const mockRun = useMemo(() => createMockRun(), []);

  const runs = useMemo(
    () => (mockDemo ? [mockRun] : runsQuery.data ?? []),
    [mockDemo, mockRun, runsQuery.data],
  );

  // Switching source replaces the run list outright: a run id detected in the
  // tracks dataset means nothing to the mock, and the mock's id means nothing
  // to the dataset. Without this the toggle would leave a stale id selected and
  // the screen would sit on "NO RUN SELECTED" until the user picked again.
  useEffect(() => {
    setSelectedRunId(null);
  }, [mockDemo]);

  // Default to the most recent run as soon as run detection lands — unless
  // Workshop has asked for a specific one, which wins while it resolves to a
  // run we actually have.
  const inboundRunId = loadedString(ctx?.run) ?? "";
  useEffect(() => {
    if (selectedRunId != null || runs.length === 0) return;
    const wanted = runs.some((r) => r.id === inboundRunId) ? inboundRunId : runs[0].id;
    setSelectedRunId(wanted);
  }, [runs, selectedRunId, inboundRunId]);

  // ── Outputs: run and selected entity ──────────────────────────────────────
  // `run` is bidirectional, so writing it back here is what lets a debrief page
  // follow the screen rather than having to be driven separately.
  useEffect(() => {
    if (!ctx) return;
    ctx.run?.setLoadedValue?.(selectedRunId ?? "");
  }, [ctx, selectedRunId]);

  useEffect(() => {
    if (!ctx) return;
    ctx.selectedEntity?.setLoadedValue?.(selectedEntityId ?? "");
    if (selectedEntityId) ctx.onEntitySelected?.executeEvent?.(undefined);
  }, [ctx, selectedEntityId]);

  const selectedRun: RunSummary | null = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  // Both are called unconditionally because hooks must be, but each is handed
  // null when it is not the active source, so the inactive one does no work —
  // in particular the live playback issues no SQL while mocking.
  const livePlayback = useRunPlayback(mockDemo ? null : selectedRun, stepSeconds);
  const mockPlayback = useMockRunPlayback(mockDemo ? selectedRun : null, stepSeconds);
  const playback = mockDemo ? mockPlayback : livePlayback;

  // Clear the selection when the run changes — HLA handles are only unique
  // within a single federation execution, so the same id in another run is a
  // different unit. The order selection goes with it: a different run may be a
  // different plan entirely.
  useEffect(() => {
    setSelectedEntityId(null);
    setSelectedOrderId(null);
  }, [selectedRunId]);

  // ── Plan vs execution ────────────────────────────────────────────────────
  // Keyed on the playback supplying a compliance result rather than on the
  // mock-demo flag. Only mock runs can produce one today, but when a real run
  // can — a plan resolved from the ontology, a track sampled by SQL — nothing
  // here needs to change.
  const compliance = playback.compliance;
  const selectedOrder = useMemo(
    () => compliance?.orders.find((order) => order.orderId === selectedOrderId) ?? null,
    [compliance, selectedOrderId],
  );

  // Selecting an order selects the unit it was given to, so the side panel, the
  // map symbol and the trail all follow the row the analyst clicked.
  const handleSelectOrder = useCallback(
    (orderId: string | null) => {
      setSelectedOrderId(orderId);
      if (orderId == null) return;
      const order = compliance?.orders.find((candidate) => candidate.orderId === orderId);
      if (order?.entityId) setSelectedEntityId(order.entityId);
    },
    [compliance],
  );

  const debrief = playback.debrief;

  // A run with no event log has nothing to put on a second tab, and an empty
  // tab is worse than no tab. Fall back to the map if one disappears from under
  // the current view — switching runs can take the debrief away.
  const debriefAvailable = debrief != null;
  useEffect(() => {
    if (!debriefAvailable) setView("map");
  }, [debriefAvailable]);

  // "Show me on the map" from the debrief: seek there and switch views, so the
  // playhead is already on the moment when the map appears.
  const handleJumpToMoment = useCallback(
    (ts: number) => {
      playback.seek(ts);
      setView("map");
    },
    [playback],
  );

  // Markers for the selected order only — see lib/planEvents for why not all of
  // them at once.
  const timelineEvents = useMemo(() => {
    const scripted = playback.keyEvents ?? [];
    if (!selectedRun || !selectedOrder) return scripted;
    return [...scripted, ...planKeyEvents(selectedOrder, selectedRun.startS)];
  }, [playback.keyEvents, selectedOrder, selectedRun]);

  const handleEntityClick = useCallback((entity: HlaEntity) => {
    setSelectedEntityId((current) => (current === entity.id ? null : entity.id));
  }, []);

  // Destroyed units are dimmed rather than removed: in a replay, where a unit
  // died is part of what you are looking for. The feed does not populate
  // damage_state today, so this is currently inert.
  const isFaded = useCallback(
    (entity: HlaEntity) => entity.damageState === "Destroyed",
    []
  );

  // ── Breadcrumb trail for the selected unit ───────────────────────────────
  // Accumulated from frames as they are displayed rather than queried, so it
  // reflects exactly the samples that have been played through.
  const trailRef = useRef<{ id: string | null; points: LatLon[] }>({ id: null, points: [] });
  const [trail, setTrail] = useState<LatLon[]>([]);

  const currentFrameTs = playback.frameTs;
  const lastTrailTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (selectedEntityId == null) {
      trailRef.current = { id: null, points: [] };
      lastTrailTsRef.current = null;
      setTrail([]);
      return;
    }

    if (trailRef.current.id !== selectedEntityId) {
      trailRef.current = { id: selectedEntityId, points: [] };
      lastTrailTsRef.current = null;
    }

    const entity = playback.entities.find((e) => e.id === selectedEntityId);
    if (!entity || currentFrameTs == null) return;
    if (lastTrailTsRef.current === currentFrameTs) return;

    lastTrailTsRef.current = currentFrameTs;
    const points = [...trailRef.current.points, { lat: entity.lat, lon: entity.lon }].slice(
      -TRAIL_LENGTH
    );
    trailRef.current = { id: selectedEntityId, points };
    setTrail(points);
  }, [selectedEntityId, playback.entities, currentFrameTs]);

  const runsError = runsQuery.error;
  const permissionProblem =
    playback.permissionDenied || (runsError instanceof SqlError && runsError.permissionDenied);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: UI.bg0,
        color: UI.text,
        overflow: "hidden",
      }}
    >
      <TopBar
        runs={runs}
        selectedRun={selectedRun}
        loadingRuns={runsQuery.isLoading}
        onSelectRun={setSelectedRunId}
        onRefresh={() => void runsQuery.refetch()}
        mockDemo={mockDemo}
        onToggleMockDemo={ownsMockDemo ? setMockDemo : undefined}
        view={debriefAvailable ? view : undefined}
        onViewChange={debriefAvailable ? setView : undefined}
      />

      {permissionProblem && (
        <Banner tone="error">
          Foundry refused the SQL request. This screen queries the tracks dataset through the SQL
          Queries API, which needs the <strong>api:sql-queries-execute</strong> and{" "}
          <strong>api:sql-queries-read</strong> scopes enabled on this application in Developer
          Console, plus the tracks dataset added there as a permitted resource.
        </Banner>
      )}

      {!permissionProblem && runsError != null && (
        <Banner tone="error">Could not detect runs: {String((runsError as Error).message)}</Banner>
      )}

      {!permissionProblem && playback.error != null && (
        <Banner tone="warn">Could not load this window: {playback.error}</Banner>
      )}

      {view === "map" && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <AnalysisMap
            entities={playback.entities}
            selectedId={selectedEntityId}
            onEntityClick={handleEntityClick}
            isFaded={isFaded}
            trail={trail}
            // Playback interpolates positions at 15 Hz between frames. Keying
            // the roll-up on the frame instead means units fold and unfold once
            // per frame rather than flapping on every intermediate position.
            planKey={playback.frameTs ?? 0}
            // Re-frame the camera when the analyst switches run: a different
            // execution can be somewhere else entirely.
            fitKey={selectedRun?.id}
            plan={playback.plan}
            compliance={compliance}
            selectedOrderId={selectedOrderId}
            onSelectOrder={handleSelectOrder}
            layers={planLayers}
            onLayersChange={setPlanLayers}
          />
          <SidePanel
            entities={playback.entities}
            selectedId={selectedEntityId}
            onSelect={setSelectedEntityId}
          />
        </div>
      )}

      {view === "debrief" && debrief && selectedRun && (
        <DebriefView
          debrief={debrief.narrative}
          statistics={debrief.statistics}
          events={debrief.events}
          runDurationSec={Math.max(1, selectedRun.endS - selectedRun.startS)}
          onJumpToMoment={handleJumpToMoment}
        />
      )}

      {view === "map" && selectedRun && compliance && (
        <CompliancePanel
          compliance={compliance}
          runStartS={selectedRun.startS}
          selectedOrderId={selectedOrderId}
          onSelectOrder={handleSelectOrder}
          onSeek={playback.seek}
          expanded={planExpanded}
          onToggleExpanded={() => setPlanExpanded((open) => !open)}
        />
      )}

      {view === "map" &&
        (selectedRun ? (
          <Timeline
            run={selectedRun}
            keyEvents={timelineEvents}
            currentTs={playback.currentTs}
            playing={playback.playing}
            speed={playback.speed}
            buffering={playback.buffering}
            stepSeconds={stepSeconds}
            chunkSeconds={playback.chunkSeconds}
            loadedRanges={playback.loadedRanges}
            loadingRanges={playback.loadingRanges}
            entityCount={playback.entities.length}
            onTogglePlay={() => playback.setPlaying(!playback.playing)}
            onSeek={playback.seek}
            onSpeedChange={playback.setSpeed}
            onStepChange={setStepSeconds}
          />
        ) : (
          <div
            style={{
              background: UI.bg1,
              borderTop: `1px solid ${UI.border}`,
              padding: "18px 14px",
              fontFamily: UI.fontMono,
              fontSize: 11,
              color: UI.textDim,
              letterSpacing: 1,
              flexShrink: 0,
            }}
          >
            {runsQuery.isLoading
              ? "DETECTING RUNS — scanning the tracks feed for blocks of positional activity…"
              : "NO RUN SELECTED"}
          </div>
        ))}
    </div>
  );
};

const AnalysisScreenApp: FC = () => (
  <QueryClientProvider client={queryClient}>
    <AnalysisScreen />
  </QueryClientProvider>
);

export default AnalysisScreenApp;
