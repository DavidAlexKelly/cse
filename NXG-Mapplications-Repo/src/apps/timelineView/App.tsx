// src/apps/timelineView/App.tsx
//
// Timeline view — a phase-by-phase Gantt-style timeline of MEL events, MIL
// incidents and injects, backed by the [NXG-P] Ontology objects.
//
// The visual model is a nested-bar timeline where:
//   • Each PHASE is a column (grid track).
//   • MEL events are bars that span one or more phase columns.
//   • Each MEL event contains child MIL incidents (indented sub-bars).
//   • Each MIL incident contains child INJECTS (little pill badges).
//   • Unassigned incidents are shown in their own row.
//   • A Tasks & Gaps summary strip sits at the bottom.
//
// Selecting a phase pops the right-side detail panel with readiness,
// description, active MEL events, MIL incidents, injects, actors, objectives
// and PMESII snapshot.

import "./timelineView.css";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { client } from "../../client";
import {
  NxgInject,
  NxgPhase,
  NxgScenario,
  NxgTask,
  NxgTrainingAudience,
  NxgTrainingObjective,
} from "@nxg-simulation-execution-testing/sdk";
import type { Osdk } from "@osdk/client";
// Share the exact phase-colour palette with the main scenarioPlanner app so
// the timeline lights up in the same colours as the phase pills there.
import { getPhaseColour } from "../scenarioPlanner/shared/phaseColours";

// ── Types ────────────────────────────────────────────────────────────────────

interface PhaseRow {
  phaseId: string;
  name: string;
  status: string;
  description: string;
  objectiveStatement: string;
  sequenceNumber: number;
  startOffset: string;
  endOffset: string;
  code: string;                 // PH1, PH2, …
  colour: string;
  displayDate: string;
  basedOnPhaseId: string | null;
}

// ── Phase graph helpers ──────────────────────────────────────────────────────

interface TreeNode { phase: PhaseRow; children: TreeNode[]; depth: number; }

function buildPhaseForest(phases: PhaseRow[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  for (const p of phases) nodeMap.set(p.phaseId, { phase: p, children: [], depth: 0 });
  const roots: TreeNode[] = [];
  for (const p of phases) {
    const n = nodeMap.get(p.phaseId)!;
    if (!p.basedOnPhaseId || !nodeMap.has(p.basedOnPhaseId)) { roots.push(n); }
    else { nodeMap.get(p.basedOnPhaseId)!.children.push(n); }
  }
  (function setD(n: TreeNode, d: number) { n.depth = d; n.children.forEach((c) => setD(c, d + 1)); })(
    { phase: {} as PhaseRow, children: roots, depth: -1 }, -1,
  );
  return roots;
}

function tracePathToLeaf(phases: PhaseRow[], leafId: string): PhaseRow[] {
  const byId = new Map(phases.map((p) => [p.phaseId, p]));
  const path: PhaseRow[] = [];
  let cur = byId.get(leafId);
  while (cur) { path.unshift(cur); cur = cur.basedOnPhaseId ? byId.get(cur.basedOnPhaseId) : undefined; }
  return path;
}

interface InjectRow {
  injectId: string;
  title: string;
  body: string;
  expectedResponse: string;
  category: string;
  dayOffset: string;
  phaseId: string | null;
}

interface AudienceRow {
  audienceId: string;
  name: string;
  type: string;
}

interface ObjectiveRow {
  objectiveId: string;
  ref: string;
  objective: string;
  functionalArea: string;
  priority: string;
  phaseId: string | null;
}

interface TaskRow {
  taskId: string;
  name: string;
  status: string;
  section: string;
  phaseId: string | null;
}

// A MEL event synthesized from the ontology data. MEL events span multiple
// phases and act as parents for MIL incidents and injects. We create one MEL
// event per phase for phases that have any inject content, then merge some
// adjacent MEL events together to produce the multi-column spans that make
// the layout look like the mockup.
interface MelEvent {
  id: string;
  title: string;
  ref: string;                  // "MEL1", "MEL2"…
  startPhaseIdx: number;
  endPhaseIdx: number;          // inclusive
  children: MilIncident[];      // MIL incidents nested inside this MEL
  colour: string;
  primaryPhaseId: string;       // the phase this MEL primarily anchors to
}

interface MilIncident {
  id: string;
  title: string;
  ref: string;                  // "MIL1.1"
  phaseIdx: number;
  spanEndPhaseIdx: number;      // most MILs are 1 phase wide, some span 2
  colour: string;
  injects: InjectPill[];        // injects nested underneath this MIL
  phaseId: string;
}

interface InjectPill {
  id: string;
  title: string;
  ref: string;                  // "5.1"
  phaseIdx: number;             // which phase column this pill sits in
  phaseId: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

// Categorise injects: this heuristic decides which injects act as MIL
// incidents (higher-priority, tactical) vs which act as bare injects (lower-
// level events used to seed MIL narratives). Everything is derived from
// injectCategory.
const MIL_CATEGORIES = new Set([
  "CYBER",
  "LOG",
  "CIMIC",
  "INFO OPS",
  "INTEL",
  "POLMIL",
  "METOC",
]);

function makeDisplayDate(index: number): string {
  const base = new Date("2026-03-10T00:00:00Z");
  base.setUTCDate(base.getUTCDate() + index * 2);
  const day = String(base.getUTCDate()).padStart(2, "0");
  const month = base.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const year = base.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

// ── Data loader ──────────────────────────────────────────────────────────────

async function loadAll(): Promise<{
  scenario: Osdk.Instance<NxgScenario> | null;
  phases: PhaseRow[];
  injects: InjectRow[];
  audiences: AudienceRow[];
  objectives: ObjectiveRow[];
  tasks: TaskRow[];
}> {
  const [scenarioPage, phasePage, injectPage, audPage, objPage, taskPage] =
    await Promise.all([
      client(NxgScenario).fetchPage({ $pageSize: 5 }),
      client(NxgPhase).fetchPage({ $pageSize: 100 }),
      client(NxgInject).fetchPage({ $pageSize: 200 }),
      client(NxgTrainingAudience).fetchPage({ $pageSize: 100 }),
      client(NxgTrainingObjective).fetchPage({ $pageSize: 200 }),
      client(NxgTask).fetchPage({ $pageSize: 200 }),
    ]);

  const sortedPhases = [...phasePage.data].sort((a, b) => {
    const sa = a.sequenceNumber != null ? Number(a.sequenceNumber) : 999;
    const sb = b.sequenceNumber != null ? Number(b.sequenceNumber) : 999;
    if (sa !== sb) return sa - sb;
    return (a.phaseId ?? "").localeCompare(b.phaseId ?? "");
  });

  const phases: PhaseRow[] = sortedPhases.map((p, i) => {
    const seq = p.sequenceNumber != null ? Number(p.sequenceNumber) : i + 1;
    return {
      phaseId: p.phaseId ?? `phase_${i}`,
      name: p.phaseName ?? `Phase ${seq}`,
      status: (p.phaseStatus ?? "DRAFT").toString(),
      description: p.phaseDescription ?? "",
      objectiveStatement: p.objectiveStatement ?? "",
      sequenceNumber: seq,
      startOffset: p.startOffset ?? "",
      endOffset: p.endOffset ?? "",
      code: `PH${seq}`,
      // Share the palette with the main scenarioPlanner app so a phase looks
      // identical in both places.
      colour: getPhaseColour(i),
      displayDate: makeDisplayDate(i),
      basedOnPhaseId: (p as any).basedOnPhaseId ?? null,
    };
  });

  const injects: InjectRow[] = injectPage.data.map((r) => ({
    injectId: r.injectId ?? "",
    title: r.injectTitle ?? "Untitled inject",
    body: r.injectBody ?? "",
    expectedResponse: r.expectedResponse ?? "",
    category: (r.injectCategory ?? "").toString(),
    dayOffset: r.dayOffset ?? "",
    phaseId: r.phaseId ?? null,
  }));

  const audiences: AudienceRow[] = audPage.data.map((a) => ({
    audienceId: a.audienceId ?? "",
    name: a.audienceName ?? "Audience",
    type: (a.audienceType ?? "secondary").toString(),
  }));

  const objectives: ObjectiveRow[] = objPage.data.map((o) => ({
    objectiveId: o.objectiveId ?? "",
    ref: o.ref ?? "",
    objective: o.objective ?? "",
    functionalArea: o.functionalArea ?? "",
    priority: (o.priority ?? "Medium").toString(),
    phaseId: o.phaseId ?? null,
  }));

  const tasks: TaskRow[] = taskPage.data.map((t) => ({
    taskId: t.taskId ?? "",
    name: t.taskName ?? "Task",
    status: (t.taskStatus ?? "pending").toString(),
    section: t.taskSection ?? "",
    phaseId: t.phaseId ?? null,
  }));

  return {
    scenario: scenarioPage.data[0] ?? null,
    phases,
    injects,
    audiences,
    objectives,
    tasks,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColour(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("approv") || s.includes("complete")) return "#2fbf71";
  if (s.includes("review") || s.includes("progress")) return "#e8a838";
  return "#6a7292";
}

function computeReadiness(phase: PhaseRow, milCount: number, injCount: number): number {
  const base = 55 + Math.min(30, (milCount + injCount) * 4);
  const seed = (phase.sequenceNumber % 5) * 3;
  return Math.min(99, base + seed);
}

// Build the nested MEL → MIL → INJECT structure that drives the timeline.
// Strategy:
//   • Every phase that has ≥1 assigned inject seeds a MEL event centred on it.
//   • The MEL's span (start/end phase idx) is extended by 1 to the right when
//     enough injects live in the next phase — this produces the multi-column
//     spans shown in the mockup.
//   • Injects for each phase are then split into two lists: the first ~half
//     become MIL incidents (each with 1-3 nested inject pills), the rest are
//     bare inject pills sitting inside the parent MIL.
function buildMelStructure(phases: PhaseRow[], injects: InjectRow[]): {
  melEvents: MelEvent[];
  incidentsByPhase: Record<string, MilIncident[]>;
  injectsByPhase: Record<string, InjectPill[]>;
} {
  const injectsByPhaseArr: Record<string, InjectRow[]> = {};
  for (const p of phases) injectsByPhaseArr[p.phaseId] = [];
  for (const inj of injects) {
    if (inj.phaseId && injectsByPhaseArr[inj.phaseId]) {
      injectsByPhaseArr[inj.phaseId].push(inj);
    }
  }

  // For each phase, split its injects into "MIL parents" and "raw injects".
  const incidentsByPhase: Record<string, MilIncident[]> = {};
  const injectsByPhase: Record<string, InjectPill[]> = {};
  const melEvents: MelEvent[] = [];
  let melCounter = 0;

  phases.forEach((phase, phaseIdx) => {
    const list = injectsByPhaseArr[phase.phaseId];
    incidentsByPhase[phase.phaseId] = [];
    injectsByPhase[phase.phaseId] = [];
    if (!list || list.length === 0) return;

    // Highest priority injects (MIL categories) become MIL incidents;
    // everything else becomes bare inject pills that sit inside a MIL bar.
    const milish = list.filter((i) => MIL_CATEGORIES.has(i.category.toUpperCase().trim()));
    const others = list.filter((i) => !MIL_CATEGORIES.has(i.category.toUpperCase().trim()));

    // Cap MIL count to keep the row height reasonable
    const milParents = (milish.length > 0 ? milish : list).slice(0, 3);
    const remainder = (milish.length > 0 ? [...milish.slice(3), ...others] : list.slice(3));

    // Distribute inject pills across MIL parents round-robin
    milParents.forEach((mil, i) => {
      const pills: InjectPill[] = [];
      remainder
        .filter((_, k) => k % milParents.length === i)
        .slice(0, 3)
        .forEach((inj, j) => {
          pills.push({
            id: inj.injectId,
            title: inj.title,
            ref: `${phaseIdx + 1}.${j + 1}`,
            phaseIdx,
            phaseId: phase.phaseId,
          });
        });

      incidentsByPhase[phase.phaseId].push({
        id: mil.injectId,
        title: mil.title,
        // Numbering matches the mockup: MIL1.1, MIL1.2, MIL1.3
        ref: `MIL${phaseIdx + 1}.${i + 1}`,
        phaseIdx,
        spanEndPhaseIdx: phaseIdx, // most MILs sit in a single phase
        // Inherit the phase colour so MIL bars visually belong to their phase
        colour: phase.colour,
        injects: pills,
        phaseId: phase.phaseId,
      });
    });

    // Any unassigned inject pills that didn't land inside a MIL are still shown
    // as free-floating pills anchored to this phase (rare — most fill up).
    if (remainder.length > milParents.length * 3) {
      remainder.slice(milParents.length * 3, milParents.length * 3 + 2).forEach((inj, j) => {
        injectsByPhase[phase.phaseId].push({
          id: inj.injectId,
          title: inj.title,
          ref: `INJ${phaseIdx + 1}.${j + 1}`,
          phaseIdx,
          phaseId: phase.phaseId,
        });
      });
    }
  });

  // ── Now build MEL events. Rule of thumb (matches the mockup structure):
  // MEL1 spans phases 1-2 (rising tension + hybrid disruption)
  // MEL2 sits in phase 1 alone (info environment contested)
  // MEL3 spans phases 2-3
  // MEL4 spans phases 3-4
  // MEL5 sits in phase 3 alone
  // MEL6 spans phases 4-5
  // MEL7 sits in phase 5
  // MEL8 spans phases 1-6 (long horizontal bar for changing guidance)
  // MEL9 spans phases 4-5
  // MEL10 spans phases 5-6
  //
  // We generate a similar set of overlapping spans procedurally, keying the
  // spans off the number of phases so the visual rhythm holds for any dataset.

  const numPhases = phases.length;

  // helper to allocate a MEL event
  const allocMel = (
    startIdx: number,
    endIdx: number,
    title: string,
  ) => {
    melCounter += 1;
    const start = Math.max(0, Math.min(startIdx, numPhases - 1));
    const end = Math.max(start, Math.min(endIdx, numPhases - 1));
    const primary = phases[start];
    const children: MilIncident[] = [];
    for (let i = start; i <= end; i++) {
      children.push(...(incidentsByPhase[phases[i].phaseId] ?? []));
    }
    melEvents.push({
      id: `mel-${melCounter}`,
      title,
      ref: `MEL${melCounter}`,
      startPhaseIdx: start,
      endPhaseIdx: end,
      children,
      // Use the anchor phase's colour so the MEL bar picks up its phase
      // family. When the bar spans multiple phases, CSS below paints an
      // actual gradient from the start phase colour to the end phase colour.
      colour: primary.colour,
      primaryPhaseId: primary.phaseId,
    });
  };

  // Only synthesise MEL events for phases that have inject content, and pick
  // the title from the phase's first inject or description when possible.
  // Different pattern based on phase count so it scales.
  if (numPhases >= 2) {
    const firstWithData = phases.findIndex((p) => (injectsByPhaseArr[p.phaseId] ?? []).length > 0);
    const anchor = Math.max(1, firstWithData);
    const seedTitle = (idx: number, fallback: string): string => {
      const first = injectsByPhaseArr[phases[idx]?.phaseId ?? ""]?.[0];
      return first?.title ?? fallback;
    };

    // A long-running "guidance/reporting" MEL that spans everything from
    // anchor to end — this produces the wide bar at the bottom of the mockup.
    allocMel(
      anchor,
      numPhases - 1,
      seedTitle(anchor, "Redland political & military pressure increases"),
    );

    // A mid-span MEL that covers 1-2 phases in the middle
    if (numPhases >= 3) {
      allocMel(
        anchor,
        anchor,
        seedTitle(anchor, "Information environment becomes contested"),
      );
    }
    if (numPhases >= 4) {
      allocMel(
        anchor + 1,
        Math.min(anchor + 2, numPhases - 1),
        seedTitle(anchor + 1, "Cyber & communications disruption affects coordination"),
      );
    }
    if (numPhases >= 5) {
      allocMel(
        anchor + 2,
        Math.min(anchor + 3, numPhases - 1),
        seedTitle(anchor + 2, "Host nation support & movement capacity stress"),
      );
      allocMel(
        anchor + 2,
        Math.min(anchor + 3, numPhases - 1),
        seedTitle(anchor + 2, "Multinational logistics friction"),
      );
    }
    if (numPhases >= 6) {
      allocMel(
        anchor + 3,
        Math.min(anchor + 4, numPhases - 1),
        seedTitle(anchor + 3, "Civilian situation deteriorates in selected areas"),
      );
      allocMel(
        anchor + 4,
        Math.min(anchor + 5, numPhases - 1),
        seedTitle(anchor + 4, "Redland special ops threat"),
      );
    }
    if (numPhases >= 7) {
      allocMel(
        anchor + 5,
        Math.min(anchor + 6, numPhases - 1),
        seedTitle(anchor + 5, "Higher command changes guidance & reporting requirements"),
      );
      allocMel(
        anchor + 5,
        Math.min(anchor + 6, numPhases - 1),
        seedTitle(anchor + 5, "Sustainment & medical support pressure increases"),
      );
      allocMel(
        anchor + 6,
        Math.min(anchor + 6, numPhases - 1),
        seedTitle(anchor + 6, "Transition to stabilisation & lessons capture"),
      );
    }
  } else if (numPhases === 1) {
    allocMel(0, 0, "Scenario events");
  }

  return { melEvents, incidentsByPhase, injectsByPhase };
}

// ── Small UI atoms ───────────────────────────────────────────────────────────

function ChevronDown() {
  return <span className="tlv-chevron" aria-hidden="true">▾</span>;
}

function ChevronRight() {
  return <span className="tlv-chevron" aria-hidden="true">▸</span>;
}

function RefBadge({
  label,
  tone,
  colour,
}: {
  label: string;
  tone: "mel" | "mil" | "inj" | "actor" | "obj" | "inject";
  /**
   * Optional accent colour used to tint the badge — when provided we render
   * with a translucent background of this colour + a solid text colour, so
   * the badge inherits the phase palette (rather than the fixed tone colour).
   */
  colour?: string;
}) {
  if (colour) {
    return (
      <span
        className={`tlv-refbadge tlv-refbadge--${tone} tlv-refbadge--tinted`}
        style={{
          background: colour,
          color: "#fff",
          boxShadow: `0 0 0 1px ${colour}`,
        }}
      >
        {label}
      </span>
    );
  }
  return <span className={`tlv-refbadge tlv-refbadge--${tone}`}>{label}</span>;
}

// ── Main component ──────────────────────────────────────────────────────────

// ── Phase graph overview ──────────────────────────────────────────────────────
// Shows all phases as a left-to-right tree. Leaf nodes have "View Timeline".

const GRAPH_NODE_W = 220;
const GRAPH_NODE_H = 80;
const GRAPH_COL_GAP = 70;
const GRAPH_ROW_GAP = 20;
const GRAPH_PAD = 32;

interface GraphPos { node: TreeNode; x: number; y: number; }

function layoutGraph(forest: TreeNode[]): GraphPos[] {
  const out: GraphPos[] = [];
  const colY: Record<number, number> = {};
  function place(n: TreeNode) {
    const col = n.depth;
    const x = GRAPH_PAD + col * (GRAPH_NODE_W + GRAPH_COL_GAP);
    const y = colY[col] ?? GRAPH_PAD;
    colY[col] = y + GRAPH_NODE_H + GRAPH_ROW_GAP;
    out.push({ node: n, x, y });
    for (const c of n.children) place(c);
  }
  for (const r of forest) place(r);
  return out;
}

function PhaseGraphOverview({
  phases,
  onViewTimeline,
}: {
  phases: PhaseRow[];
  onViewTimeline: (leafId: string) => void;
}) {
  const forest = useMemo(() => buildPhaseForest(phases), [phases]);
  const positioned = useMemo(() => layoutGraph(forest), [forest]);
  const posById = useMemo(() => {
    const m = new Map<string, GraphPos>();
    for (const p of positioned) m.set(p.node.phase.phaseId, p);
    return m;
  }, [positioned]);

  const svgW = positioned.reduce((mx, p) => Math.max(mx, p.x + GRAPH_NODE_W + GRAPH_PAD), 500);
  const svgH = positioned.reduce((mx, p) => Math.max(mx, p.y + GRAPH_NODE_H + GRAPH_PAD + 16), 200);

  const edges = useMemo(() => {
    const res: { x1: number; y1: number; x2: number; y2: number; colour: string }[] = [];
    for (const pn of positioned) {
      const parentId = pn.node.phase.basedOnPhaseId;
      if (parentId) {
        const parent = posById.get(parentId);
        if (parent) {
          res.push({
            x1: parent.x + GRAPH_NODE_W, y1: parent.y + GRAPH_NODE_H / 2,
            x2: pn.x, y2: pn.y + GRAPH_NODE_H / 2,
            colour: pn.node.phase.colour,
          });
        }
      }
    }
    return res;
  }, [positioned, posById]);

  return (
    <div style={{ flex: 1, overflow: "auto", position: "relative", padding: 16 }}>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#e0e4ec", letterSpacing: "0.05em" }}>
          PHASE BRANCHES
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Select a leaf phase to view its timeline
        </span>
      </div>

      <div style={{ position: "relative", width: svgW, height: svgH }}>
        <svg width={svgW} height={svgH} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
          {edges.map((e, i) => {
            const mx = (e.x1 + e.x2) / 2;
            return (
              <path key={i} d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`}
                fill="none" stroke={e.colour} strokeWidth={2} strokeOpacity={0.4} />
            );
          })}
        </svg>

        {positioned.map(({ node, x, y }) => {
          const p = node.phase;
          const leaf = node.children.length === 0;
          return (
            <div key={p.phaseId} style={{
              position: "absolute", left: x, top: y, width: GRAPH_NODE_W, height: GRAPH_NODE_H,
              background: "rgba(30,36,50,0.9)", border: `1px solid ${p.colour}44`,
              borderRadius: 10, padding: "8px 14px", display: "flex", flexDirection: "column",
              justifyContent: "space-between", overflow: "hidden", boxSizing: "border-box",
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget.style.borderColor = p.colour); }}
            onMouseLeave={(e) => { (e.currentTarget.style.borderColor = p.colour + "44"); }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: p.colour, borderRadius: "10px 10px 0 0" }} />
              <div style={{ paddingTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: statusColour(p.status) }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: p.colour, letterSpacing: "0.08em", fontFamily: "var(--font-mono, monospace)" }}>{p.code}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e4ec", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: GRAPH_NODE_W - 80 }}>
                    {p.name.replace(/^Phase\s+\d+[A-Z]?\s*[—–-]\s*/i, "")}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                  {p.startOffset || "H+0"} → {p.endOffset || "H+?"} · {p.displayDate}
                </div>
              </div>

              {leaf ? (
                <button
                  type="button"
                  onClick={() => onViewTimeline(p.phaseId)}
                  style={{
                    alignSelf: "flex-start", fontSize: 10, fontWeight: 700, cursor: "pointer",
                    color: p.colour, background: p.colour + "18", border: `1px solid ${p.colour}55`,
                    borderRadius: 5, padding: "3px 10px", letterSpacing: "0.04em",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget.style.background = p.colour + "30"); }}
                  onMouseLeave={(e) => { (e.currentTarget.style.background = p.colour + "18"); }}
                >
                  ▶ View Timeline
                </button>
              ) : (
                <div style={{ fontSize: 9, color: "var(--text-muted)", fontStyle: "italic" }}>
                  {node.children.length} branch{node.children.length !== 1 ? "es" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main app ─────────────────────────────────────────────────────────────────

export default function TimelineViewApp() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Osdk.Instance<NxgScenario> | null>(null);
  const [phases, setPhases] = useState<PhaseRow[]>([]);
  const [injects, setInjects] = useState<InjectRow[]>([]);
  const [audiences, setAudiences] = useState<AudienceRow[]>([]);
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  // MEL/MIL expansion state — collapsed MEL events hide their MIL/inject
  // children in the timeline; collapsed MILs hide their inject pills.
  const [expandedMel, setExpandedMel] = useState<Record<string, boolean>>({});
  const [expandedMil, setExpandedMil] = useState<Record<string, boolean>>({});
  // When null → show graph overview. When set → show Gantt for this branch path.
  const [viewingBranchLeaf, setViewingBranchLeaf] = useState<string | null>(null);

  // ── Load once ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAll()
      .then((res) => {
        if (cancelled) return;
        setScenario(res.scenario);
        setPhases(res.phases);
        setInjects(res.injects);
        setAudiences(res.audiences);
        setObjectives(res.objectives);
        setTasks(res.tasks);
        // Auto-select the second phase (PH1 in mockup) and pre-expand the
        // first two MEL events so the initial view isn't empty.
        const initial = res.phases[1]?.phaseId ?? res.phases[0]?.phaseId ?? null;
        setSelectedPhaseId(initial);
        setExpandedMel({ "mel-1": true, "mel-2": true, "mel-3": true, "mel-4": true, "mel-5": true, "mel-6": true, "mel-7": true, "mel-8": true, "mel-9": true, "mel-10": true });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Derive the nested MEL/MIL/INJ structure (used for detail panel lookups)
  const { melEvents: _melEvents, incidentsByPhase, injectsByPhase } = useMemo(
    () => buildMelStructure(phases, injects),
    [phases, injects],
  );

  const _unassignedIncidents = useMemo(
    () => injects.filter((i) => !i.phaseId || !phases.some((p) => p.phaseId === i.phaseId)),
    [injects, phases],
  );
  void _melEvents; void _unassignedIncidents; // used via gantt* filtered variants

  const selectedPhase = useMemo(
    () => phases.find((p) => p.phaseId === selectedPhaseId) ?? phases[0] ?? null,
    [phases, selectedPhaseId],
  );

  const selectedIncidents = selectedPhase
    ? incidentsByPhase[selectedPhase.phaseId] ?? []
    : [];
  const selectedInjectPills = selectedPhase
    ? injectsByPhase[selectedPhase.phaseId] ?? []
    : [];
  const selectedPhaseInjects = useMemo(
    () => injects.filter((i) => i.phaseId === selectedPhase?.phaseId),
    [injects, selectedPhase?.phaseId],
  );
  const selectedPhaseObjectives = useMemo(
    () => objectives.filter((o) => o.phaseId === selectedPhase?.phaseId),
    [objectives, selectedPhase?.phaseId],
  );

  const readiness = selectedPhase
    ? computeReadiness(
        selectedPhase,
        selectedIncidents.length,
        selectedInjectPills.length,
      )
    : 0;

  // Tasks & gaps — mirror mockup's "No gaps / 1 gaps / 1 task / 2 tasks / …"
  // by counting real tasks per phase; force the first phase to "No gaps" when
  // it has none, otherwise alternate task/gap tint.
  // Original gapsRow is superseded by ganttGapsRow (branch-filtered)
  // Kept as _gapsRow for reference
  const _gapsRow = useMemo(() => {
    return phases.map((p, i) => {
      const taskCount = tasks.filter((t) => t.phaseId === p.phaseId).length;
      const isTaskCol = i % 2 === 1;
      const empty = taskCount === 0;
      return {
        phaseId: p.phaseId,
        label: empty
          ? "No gaps"
          : isTaskCol
            ? `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`
            : `${taskCount} ${taskCount === 1 ? "gap" : "gaps"}`,
        variant: empty ? ("empty" as const) : isTaskCol ? ("task" as const) : ("gap" as const),
      };
    });
  }, [phases, tasks]);
  void _gapsRow;

  // ── Branch-filtered phases for Gantt ──────────────────────────────────────
  const branchPath = useMemo(
    () => (viewingBranchLeaf ? tracePathToLeaf(phases, viewingBranchLeaf) : []),
    [viewingBranchLeaf, phases],
  );
  const ganttPhases = viewingBranchLeaf ? branchPath : phases;

  // Re-derive MEL/MIL structure for the filtered phase set
  const ganttMel = useMemo(
    () => buildMelStructure(ganttPhases, injects),
    [ganttPhases, injects],
  );
  const ganttUnassigned = useMemo(
    () => injects.filter((i) => !i.phaseId || !ganttPhases.some((p) => p.phaseId === i.phaseId)),
    [injects, ganttPhases],
  );
  const ganttGapsRow = useMemo(() => {
    return ganttPhases.map((p, i) => {
      const taskCount = tasks.filter((t) => t.phaseId === p.phaseId).length;
      const isTaskCol = i % 2 === 1;
      const empty = taskCount === 0;
      return {
        phaseId: p.phaseId,
        label: empty ? "No gaps" : isTaskCol ? `${taskCount} ${taskCount === 1 ? "task" : "tasks"}` : `${taskCount} ${taskCount === 1 ? "gap" : "gaps"}`,
        variant: empty ? ("empty" as const) : isTaskCol ? ("task" as const) : ("gap" as const),
      };
    });
  }, [ganttPhases, tasks]);

  const toggleMel = (id: string) =>
    setExpandedMel((prev) => ({ ...prev, [id]: !prev[id] }));
  const toggleMil = (id: string) =>
    setExpandedMil((prev) => ({ ...prev, [id]: !prev[id] }));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="tlv-root">
      {/* ── Top bar ────────────────────────────────────────────────── */}
      <header className="tlv-topbar">
        <div className="tlv-topbar__left">
          <span className="tlv-topbar__icon" aria-hidden="true">▤</span>
          <span className="tlv-topbar__title">Timeline</span>
          {scenario?.scenarioName && (
            <span className="tlv-topbar__sub">// {scenario.scenarioName}</span>
          )}
        </div>
        <div className="tlv-topbar__right">
          <button className="tlv-btn tlv-btn--ghost" type="button">+ Incident</button>
          <button className="tlv-btn tlv-btn--ghost" type="button">+ Event</button>
          <button className="tlv-btn tlv-btn--outline" type="button">
            <span className="tlv-btn__icon">▦</span> Strategic overview
          </button>
          <button className="tlv-btn tlv-btn--outline" type="button">
            <span className="tlv-btn__icon">▶</span> Execution
          </button>
        </div>
      </header>

      {loading && <div className="tlv-loader">Loading scenario timeline…</div>}
      {error && !loading && (
        <div className="tlv-error">Failed to load timeline data: {error}</div>
      )}

      {!loading && !error && phases.length > 0 && !viewingBranchLeaf && (
        <div className="tlv-body" style={{ justifyContent: "center" }}>
          <PhaseGraphOverview
            phases={phases}
            onViewTimeline={(leafId) => {
              setViewingBranchLeaf(leafId);
              setSelectedPhaseId(leafId);
            }}
          />
        </div>
      )}

      {!loading && !error && viewingBranchLeaf && ganttPhases.length > 0 && (
        <div className="tlv-body">
          {/* ── Left: gantt-style timeline (branch-filtered) ─────── */}
          <div className="tlv-timeline-wrap">
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px 0 12px" }}>
              <button
                type="button"
                className="tlv-btn tlv-btn--outline"
                onClick={() => setViewingBranchLeaf(null)}
                style={{ fontSize: 11, padding: "4px 10px" }}
              >
                ← All branches
              </button>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Viewing: {branchPath.map((p) => p.code).join(" → ")}
              </span>
            </div>
            <TimelineGantt
              phases={ganttPhases}
              melEvents={ganttMel.melEvents}
              incidentsByPhase={ganttMel.incidentsByPhase}
              injectsByPhase={ganttMel.injectsByPhase}
              expandedMel={expandedMel}
              expandedMil={expandedMil}
              onToggleMel={toggleMel}
              onToggleMil={toggleMil}
              selectedPhaseId={selectedPhaseId}
              onSelectPhase={setSelectedPhaseId}
              unassignedIncidents={ganttUnassigned}
              gapsRow={ganttGapsRow}
            />
          </div>

          {/* ── Right: phase detail panel ─────────────────────────── */}
          {selectedPhase && (
            <PhaseDetailPanel
              phase={selectedPhase}
              readiness={readiness}
              incidents={selectedIncidents}
              phaseInjects={selectedPhaseInjects}
              phaseObjectives={selectedPhaseObjectives}
              audiences={audiences}
            />
          )}
        </div>
      )}

      {!loading && !error && phases.length === 0 && (
        <div className="tlv-loader">No phases found in this ontology.</div>
      )}

      {/* Floating "TIMELINE" button (bottom-right) — returns to planner */}
      <button
        className="tlv-timeline-btn tlv-timeline-btn--active"
        onClick={() => navigate("/scenario-plan")}
        type="button"
        title="Back to scenario planner"
      >
        <span className="tlv-timeline-btn__icon">▤</span>
        TIMELINE
      </button>
    </div>
  );
}

// ── Timeline Gantt component ─────────────────────────────────────────────────

interface TimelineGanttProps {
  phases: PhaseRow[];
  melEvents: MelEvent[];
  incidentsByPhase: Record<string, MilIncident[]>;
  injectsByPhase: Record<string, InjectPill[]>;
  expandedMel: Record<string, boolean>;
  expandedMil: Record<string, boolean>;
  onToggleMel: (id: string) => void;
  onToggleMil: (id: string) => void;
  selectedPhaseId: string | null;
  onSelectPhase: (id: string) => void;
  unassignedIncidents: InjectRow[];
  gapsRow: { phaseId: string; label: string; variant: "task" | "gap" | "empty" }[];
}

function TimelineGantt({
  phases,
  melEvents,
  injectsByPhase,
  expandedMel,
  expandedMil,
  onToggleMel,
  onToggleMil,
  selectedPhaseId,
  onSelectPhase,
  unassignedIncidents,
  gapsRow,
}: TimelineGanttProps) {
  // The whole timeline lives inside a CSS grid whose columns are:
  //   [label 110px] [phase-1] [phase-2] … [phase-N]
  // where every phase column takes an equal fraction of remaining space.
  const gridTemplate = `110px repeat(${phases.length}, minmax(140px, 1fr))`;

  return (
    <div className="tlv-gantt" style={{ gridTemplateColumns: gridTemplate }}>
      {/* PHASES header row */}
      <div className="tlv-gantt__row-label">PHASES</div>
      {phases.map((p) => {
        const isSelected = p.phaseId === selectedPhaseId;
        const isDimmed = selectedPhaseId != null && !isSelected;
        return (
          <button
            key={p.phaseId}
            type="button"
            className={`tlv-gantt__phase-cell${isSelected ? " tlv-gantt__phase-cell--selected" : ""}${isDimmed ? " tlv-gantt__phase-cell--dimmed" : ""}`}
            style={{
              // Subtle gradient background per phase so each column visually
              // ties to its colour family in the MEL/MIL bars below.
              background: isSelected
                ? `linear-gradient(180deg, ${p.colour}33 0%, ${p.colour}12 60%, #14181f 100%)`
                : `linear-gradient(180deg, ${p.colour}18 0%, #14181f 100%)`,
              borderColor: isSelected ? p.colour : p.colour + "44",
            }}
            onClick={() => onSelectPhase(p.phaseId)}
          >
            <div className="tlv-gantt__phase-head">
              <span
                className="tlv-gantt__phase-code"
                style={{ color: p.colour }}
              >
                {p.code}
              </span>
              <span className="tlv-gantt__phase-sep">·</span>
              <span className="tlv-gantt__phase-name">{p.name.replace(/^Phase\s+\d+\s*[—-]\s*/, "")}</span>
            </div>
            <div className="tlv-gantt__phase-date">{p.displayDate}</div>
            <div className="tlv-gantt__phase-underline" style={{ background: p.colour }} />
          </button>
        );
      })}

      {/* MEL → MIL area label (spans all data rows to the right using a
          single wide left-column div, then MEL rows live below) */}
      <div className="tlv-gantt__section-label">MEL → MIL</div>
      {/* Spacer cells so the section label doesn't push the header off */}
      <div className="tlv-gantt__section-spacer" style={{ gridColumn: `span ${phases.length}` }} />

      {/* MEL rows */}
      {melEvents.map((mel) => {
        const isOpen = expandedMel[mel.id] ?? true;
        const span = mel.endPhaseIdx - mel.startPhaseIdx + 1;
        const totalMils = mel.children.length;
        // Build a horizontal gradient across the MEL span using each phase's
        // colour. This gives the bar a smooth colour transition matching the
        // phases below it.
        const spannedColours = phases
          .slice(mel.startPhaseIdx, mel.endPhaseIdx + 1)
          .map((p) => p.colour);
        const gradient =
          spannedColours.length === 1
            ? spannedColours[0]
            : `linear-gradient(90deg, ${spannedColours.join(", ")})`;

        // Highlight rules:
        //   • A MEL is "related" to the selected phase when its span covers it
        //   • Related MEL bars stay full-opacity; unrelated ones dim out
        const relatedToSelection =
          selectedPhaseId != null &&
          phases.findIndex((p) => p.phaseId === selectedPhaseId) >= mel.startPhaseIdx &&
          phases.findIndex((p) => p.phaseId === selectedPhaseId) <= mel.endPhaseIdx;
        const isDimmed = selectedPhaseId != null && !relatedToSelection;

        return (
          <FragmentRow key={mel.id}>
            <div className="tlv-gantt__row-gap" />
            {/* MEL bar sitting across its columns */}
            <div
              className="tlv-gantt__mel-bar-row"
              style={{
                gridColumn: `${2 + mel.startPhaseIdx} / span ${span}`,
              }}
            >
              <button
                className={`tlv-mel-bar${isOpen ? " tlv-mel-bar--open" : ""}${
                  relatedToSelection ? " tlv-mel-bar--related" : ""
                }${isDimmed ? " tlv-mel-bar--dimmed" : ""}`}
                type="button"
                onClick={() => onToggleMel(mel.id)}
                title={mel.title}
                style={{
                  // Very light gradient background + coloured left border
                  background: `linear-gradient(90deg, ${spannedColours
                    .map((c) => c + "26")
                    .join(", ")})`,
                  borderColor: spannedColours[0] + "77",
                  // Solid coloured strip on the left = the "phase family" tag
                  borderLeft: `4px solid transparent`,
                  borderImage: `${gradient} 1`,
                }}
              >
                {isOpen ? <ChevronDown /> : <ChevronRight />}
                <RefBadge label={mel.ref} tone="mel" colour={mel.colour} />
                <span className="tlv-mel-bar__title">{mel.title}</span>
                <span
                  className="tlv-mel-bar__count"
                  style={{ background: mel.colour, color: "#fff" }}
                >
                  {totalMils} <span className="tlv-mel-bar__count-lbl">MIL</span>
                </span>
              </button>
            </div>
            {/* Empty grid cells to occupy the columns after the MEL bar's span,
                so the row doesn't reflow oddly */}
            {Array.from({ length: phases.length - (mel.startPhaseIdx + span) }).map((_, i) => (
              <div key={`mel-tail-${i}`} className="tlv-gantt__row-gap" />
            ))}

            {/* MIL rows nested inside this MEL, only when open */}
            {isOpen &&
              mel.children.map((mil) => {
                const isMilOpen = expandedMil[mil.id] ?? true;
                const milSpan = mil.spanEndPhaseIdx - mil.phaseIdx + 1;
                const milIsRelated =
                  selectedPhaseId != null && mil.phaseId === selectedPhaseId;
                const milIsDimmed =
                  selectedPhaseId != null && !milIsRelated && !relatedToSelection;

                return (
                  <FragmentRow key={mil.id}>
                    <div className="tlv-gantt__row-gap" />
                    <div
                      className="tlv-gantt__mil-bar-row"
                      style={{
                        gridColumn: `${2 + mil.phaseIdx} / span ${milSpan}`,
                      }}
                    >
                      <button
                        className={`tlv-mil-bar${
                          milIsRelated ? " tlv-mil-bar--related" : ""
                        }${milIsDimmed ? " tlv-mil-bar--dimmed" : ""}`}
                        type="button"
                        onClick={() => onToggleMil(mil.id)}
                        title={mil.title}
                        style={{
                          background: mil.colour + "22",
                          borderColor: mil.colour + "55",
                          borderLeft: `3px solid ${mil.colour}`,
                        }}
                      >
                        {isMilOpen ? <ChevronDown /> : <ChevronRight />}
                        <RefBadge label={mil.ref} tone="mil" colour={mil.colour} />
                        <span className="tlv-mil-bar__title">{mil.title}</span>
                      </button>
                    </div>
                    {Array.from({ length: phases.length - (mil.phaseIdx + milSpan) }).map(
                      (_, i) => (
                        <div key={`mil-tail-${i}`} className="tlv-gantt__row-gap" />
                      ),
                    )}

                    {/* INJ pills row */}
                    {isMilOpen &&
                      mil.injects.map((pill) => {
                        const pillIsRelated =
                          selectedPhaseId != null && pill.phaseId === selectedPhaseId;
                        const pillIsDimmed =
                          selectedPhaseId != null &&
                          !pillIsRelated &&
                          !relatedToSelection;
                        return (
                          <FragmentRow key={pill.id}>
                            <div className="tlv-gantt__row-gap" />
                            <div
                              className="tlv-gantt__inj-row"
                              style={{ gridColumn: `${2 + pill.phaseIdx} / span 1` }}
                            >
                              <button
                                className={`tlv-inj-pill${
                                  pillIsRelated ? " tlv-inj-pill--related" : ""
                                }${pillIsDimmed ? " tlv-inj-pill--dimmed" : ""}`}
                                type="button"
                                title={pill.title}
                                style={{
                                  background: mil.colour + "18",
                                  borderColor: mil.colour + "55",
                                }}
                              >
                                <RefBadge
                                  label={pill.ref}
                                  tone="inj"
                                  colour={mil.colour}
                                />
                                <span className="tlv-inj-pill__title">{pill.title}</span>
                                <span className="tlv-inj-pill__link" aria-hidden="true">🔗</span>
                              </button>
                            </div>
                            {Array.from({ length: phases.length - pill.phaseIdx - 1 }).map(
                              (_, i) => (
                                <div key={`inj-tail-${i}`} className="tlv-gantt__row-gap" />
                              ),
                            )}
                          </FragmentRow>
                        );
                      })}
                  </FragmentRow>
                );
              })}
          </FragmentRow>
        );
      })}

      {/* Floating inject pills that aren't inside a MIL */}
      {phases.some((p) => (injectsByPhase[p.phaseId] ?? []).length > 0) && (
        <>
          <div className="tlv-gantt__row-gap" />
          {phases.map((p) => (
            <div key={`floating-inj-${p.phaseId}`} className="tlv-gantt__floating-inj">
              {(injectsByPhase[p.phaseId] ?? []).map((pill) => (
                <button key={pill.id} className="tlv-inj-pill" type="button" title={pill.title}>
                  <RefBadge label={pill.ref} tone="inj" />
                  <span className="tlv-inj-pill__title">{pill.title}</span>
                </button>
              ))}
            </div>
          ))}
        </>
      )}

      {/* UNASSIGNED INCIDENTS row */}
      <div className="tlv-gantt__row-label tlv-gantt__row-label--unassigned">
        UNASSIGNED
        <br />
        INCIDENTS
      </div>
      {unassignedIncidents.length === 0 ? (
        <div className="tlv-gantt__row-gap" style={{ gridColumn: `span ${phases.length}` }}>
          <div className="tlv-gantt__row-empty">All incidents assigned to a phase</div>
        </div>
      ) : (
        <div
          className="tlv-unassigned-strip"
          style={{ gridColumn: `2 / span ${phases.length}` }}
        >
          {unassignedIncidents.slice(0, 5).map((u) => (
            <button
              key={u.injectId}
              type="button"
              className="tlv-unassigned-chip"
              title={u.body || u.title}
            >
              ⚠ <RefBadge label="MIL?" tone="mil" /> {u.title}
            </button>
          ))}
        </div>
      )}

      {/* TASKS & GAPS row */}
      <div className="tlv-gantt__row-label">TASKS &amp; GAPS</div>
      {gapsRow.map((g) => (
        <div
          key={g.phaseId}
          className={`tlv-gap-cell tlv-gap-cell--${g.variant}`}
        >
          {g.label}
        </div>
      ))}
    </div>
  );
}

// Utility: React.Fragment doesn't accept a key when used inline in a list, so
// we wrap with a keyed <>…</> using this helper for readability. The children
// are placed straight into the outer CSS grid.
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ── Phase detail panel ──────────────────────────────────────────────────────

interface PhaseDetailPanelProps {
  phase: PhaseRow;
  readiness: number;
  incidents: MilIncident[];
  phaseInjects: InjectRow[];
  phaseObjectives: ObjectiveRow[];
  audiences: AudienceRow[];
}

function PhaseDetailPanel({
  phase,
  readiness,
  incidents,
  phaseInjects,
  phaseObjectives,
  audiences,
}: PhaseDetailPanelProps) {
  const status = phase.status;
  const statCol = statusColour(status);

  // Split injects into MEL-flavoured & remaining for the two sub-sections
  const melEvents = phaseInjects.slice(0, 3);

  return (
    <aside className="tlv-detail">
      <div className="tlv-detail__header">
        <span className="tlv-detail__phase-label" style={{ color: phase.colour }}>
          PHASE {phase.code}
        </span>
        <span
          className="tlv-pill tlv-pill--status"
          style={{
            color: statCol,
            borderColor: statCol + "55",
            background: statCol + "12",
          }}
        >
          ● {status}
        </span>
      </div>
      <div className="tlv-detail__title">{phase.name.replace(/^Phase\s+\d+\s*[—-]\s*/, "")}</div>

      <div className="tlv-detail__readiness">
        <div className="tlv-detail__readiness-top">
          <span>Readiness</span>
          <span>{readiness}%</span>
        </div>
        <div className="tlv-detail__readiness-bar">
          <div
            className="tlv-detail__readiness-fill"
            style={{ width: `${readiness}%`, background: phase.colour }}
          />
        </div>
      </div>

      <p className="tlv-detail__desc">
        {phase.description ||
          phase.objectiveStatement ||
          "Introduce strategic pressure, information uncertainty and early coordination needs."}
      </p>

      <button className="tlv-btn tlv-btn--wide" type="button">
        Open full phase details
      </button>

      <DetailSection title="ACTIVE MEL EVENTS" count={melEvents.length} icon="▤">
        {melEvents.map((m, i) => (
          <DetailRow
            key={m.injectId}
            refCode={`MEL${phase.sequenceNumber}.${i + 1}`}
            tone="mel"
            label={m.title}
          />
        ))}
        {melEvents.length === 0 && <div className="tlv-detail__empty">No MEL events</div>}
      </DetailSection>

      <DetailSection title="MIL INCIDENTS" count={incidents.length} icon="⚠">
        {incidents.map((m) => (
          <DetailRow key={m.id} refCode={m.ref} tone="mil" label={m.title} />
        ))}
        {incidents.length === 0 && <div className="tlv-detail__empty">No MIL incidents</div>}
      </DetailSection>

      <DetailSection title="INJECTS" count={phaseInjects.length} icon="⚡">
        {phaseInjects.slice(0, 4).map((i, k) => (
          <DetailRow
            key={i.injectId}
            refCode={`INJ${k + 1}`}
            tone="inj"
            label={i.title}
          />
        ))}
        {phaseInjects.length === 0 && <div className="tlv-detail__empty">No injects</div>}
      </DetailSection>

      <DetailSection title="AFFECTED ACTORS" count={audiences.length} icon="👥">
        {audiences.slice(0, 4).map((a) => (
          <DetailRow key={a.audienceId} refCode="⌂" tone="actor" label={a.name} />
        ))}
      </DetailSection>

      <DetailSection
        title="OBJECTIVES"
        count={phaseObjectives.length}
        icon="◎"
      >
        {phaseObjectives.slice(0, 5).map((o, i) => (
          <DetailRow
            key={o.objectiveId}
            refCode={o.ref || `OBJ${i + 1}`}
            tone="obj"
            label={o.objective || o.functionalArea}
          />
        ))}
        {phaseObjectives.length === 0 && (
          <div className="tlv-detail__empty">No objectives</div>
        )}
      </DetailSection>

    </aside>
  );
}

function DetailSection({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count?: number;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="tlv-detail__section">
      <div className="tlv-detail__section-title">
        {icon && <span className="tlv-detail__section-icon">{icon}</span>}
        {title}
        {count != null && count > 0 && (
          <span className="tlv-detail__section-count">{count}</span>
        )}
      </div>
      <div className="tlv-detail__section-body">{children}</div>
    </div>
  );
}

function DetailRow({
  refCode,
  tone,
  label,
}: {
  refCode: string;
  tone: "mel" | "mil" | "inj" | "actor" | "obj";
  label: string;
}) {
  return (
    <div className={`tlv-detail-row tlv-detail-row--${tone}`}>
      <RefBadge label={refCode} tone={tone} />
      <span className="tlv-detail-row__label">{label}</span>
    </div>
  );
}
