// src/apps/scenarioPlanner/components/PhaseGraphHome/PhaseGraphHome.tsx
//
// Full-screen graph view showing the phase branching structure.
// This is the LANDING PAGE for the scenario planner. Every leaf node
// exposes two actions: "▶ View on Map" and "▤ Timeline".

import { useMemo } from "react";
import type { Phase } from "../../shared/types";
import { getPhaseColourById, STATUS_COLORS } from "../../shared/phaseColours";
import { formatPhaseWindow } from "../../shared/timeScale";

// ── Tree helpers ──────────────────────────────────────────────────────────────

interface TreeNode { phase: Phase; children: TreeNode[]; depth: number; }

function buildForest(phases: Phase[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const p of phases) map.set(p.id, { phase: p, children: [], depth: 0 });
  const roots: TreeNode[] = [];
  for (const p of phases) {
    const n = map.get(p.id)!;
    if (!p.basedOnPhaseId || !map.has(p.basedOnPhaseId)) roots.push(n);
    else map.get(p.basedOnPhaseId)!.children.push(n);
  }
  function setD(n: TreeNode, d: number) { n.depth = d; n.children.forEach((c) => setD(c, d + 1)); }
  for (const r of roots) setD(r, 0);
  return roots;
}

/** Trace path from root to leaf. */
export function tracePath(phases: Phase[], leafId: string): Phase[] {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const path: Phase[] = [];
  let cur = byId.get(leafId);
  while (cur) { path.unshift(cur); cur = cur.basedOnPhaseId ? byId.get(cur.basedOnPhaseId) : undefined; }
  return path;
}

/** Ids of every phase that nothing else is based on — the tip of each branch. */
export function leafPhaseIds(phases: Phase[]): string[] {
  const hasChild = new Set<string>();
  for (const p of phases) if (p.basedOnPhaseId) hasChild.add(p.basedOnPhaseId);
  return phases.filter((p) => !hasChild.has(p.id)).map((p) => p.id);
}

interface LeafRank { len: number; endOffset: number; id: string; }

function leafRank(phases: Phase[], leafId: string): LeafRank {
  const path = tracePath(phases, leafId);
  const leaf = path[path.length - 1];
  return { len: path.length, endOffset: leaf?.endOffset ?? 0, id: leafId };
}

/**
 * Pick the "furthest along" leaf from a candidate list.
 *
 * Ranked by path length first (the most phases planned along one line), then by
 * the leaf's endOffset (furthest through the exercise timeline), then by id so
 * the choice is stable across reloads instead of depending on the order phases
 * happened to load in.
 */
function bestLeaf(phases: Phase[], leafIds: string[]): string | undefined {
  let best: LeafRank | undefined;
  for (const id of leafIds) {
    const cand = leafRank(phases, id);
    if (cand.len === 0) continue;
    if (
      best === undefined ||
      cand.len > best.len ||
      (cand.len === best.len && cand.endOffset > best.endOffset) ||
      (cand.len === best.len && cand.endOffset === best.endOffset && cand.id > best.id)
    ) {
      best = cand;
    }
  }
  return best?.id;
}

/** The leaf of the branch that has progressed furthest, across the whole graph. */
export function furthestLeafId(phases: Phase[]): string | undefined {
  return bestLeaf(phases, leafPhaseIds(phases));
}

/**
 * The furthest leaf on a branch that passes through `phaseId`, or undefined if
 * that phase is not in the graph. Used to honour an inbound selectedPhaseId
 * without dragging the user onto an unrelated branch.
 */
export function furthestLeafThrough(phases: Phase[], phaseId: string): string | undefined {
  return bestLeaf(
    phases,
    leafPhaseIds(phases).filter((leafId) =>
      tracePath(phases, leafId).some((p) => p.id === phaseId),
    ),
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

const NODE_W = 240;
const NODE_H = 100;
const COL_GAP = 80;
const ROW_GAP = 24;
const PAD = 40;

interface Pos { node: TreeNode; x: number; y: number; }

function layout(forest: TreeNode[]): Pos[] {
  const out: Pos[] = [];
  const colY: Record<number, number> = {};
  function place(n: TreeNode) {
    const col = n.depth;
    const x = PAD + col * (NODE_W + COL_GAP);
    const y = colY[col] ?? PAD;
    colY[col] = y + NODE_H + ROW_GAP;
    out.push({ node: n, x, y });
    for (const c of n.children) place(c);
  }
  for (const r of forest) place(r);
  return out;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  phases: Phase[];
  exerciseName?: string;
  /** Currently selected phase ID (highlighted in graph). */
  selectedPhaseId?: string | null;
  /** Called when user clicks any node to select it. */
  onSelectPhase?: (phaseId: string) => void;
  /** Called when user clicks "▶ View on Map" on a leaf. */
  onViewOnMap: (leafId: string) => void;
  /** Called when user clicks "▤ Timeline" on a leaf. */
  onViewTimeline: (leafId: string) => void;
  /** Called when user clicks "+ Add Phase". */
  onAddPhase?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PhaseGraphHome({
  phases,
  exerciseName,
  selectedPhaseId,
  onSelectPhase,
  onViewOnMap,
  onViewTimeline,
  onAddPhase,
}: Props) {
  const forest = useMemo(() => buildForest(phases), [phases]);
  const positioned = useMemo(() => layout(forest), [forest]);
  const posById = useMemo(() => {
    const m = new Map<string, Pos>();
    for (const p of positioned) m.set(p.node.phase.id, p);
    return m;
  }, [positioned]);

  const svgW = positioned.reduce((mx, p) => Math.max(mx, p.x + NODE_W + PAD), 600);
  const svgH = positioned.reduce((mx, p) => Math.max(mx, p.y + NODE_H + PAD + 16), 260);

  const edges = useMemo(() => {
    const res: { x1: number; y1: number; x2: number; y2: number; colour: string }[] = [];
    for (const pn of positioned) {
      const pid = pn.node.phase.basedOnPhaseId;
      if (pid) {
        const parent = posById.get(pid);
        if (parent) {
          res.push({
            x1: parent.x + NODE_W, y1: parent.y + NODE_H / 2,
            x2: pn.x, y2: pn.y + NODE_H / 2,
            colour: getPhaseColourById(pn.node.phase.id, phases),
          });
        }
      }
    }
    return res;
  }, [positioned, posById, phases]);

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      background: "var(--bg-app, #0d1117)", minWidth: 0, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#e0e4ec", letterSpacing: "0.04em" }}>
            ⑂ Phase Branches
          </span>
          {exerciseName && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              // {exerciseName}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Select a branch endpoint to view its map or timeline
          </span>
          {onAddPhase && (
            <button
              type="button"
              onClick={onAddPhase}
              style={{
                fontSize: 11, fontWeight: 600, color: "#4A90D9", cursor: "pointer",
                background: "rgba(74,144,217,0.1)", border: "1px solid rgba(74,144,217,0.3)",
                borderRadius: 5, padding: "4px 12px",
              }}
            >
              + Add Phase
            </button>
          )}
        </div>
      </div>

      {/* Graph canvas */}
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <div style={{ position: "relative", width: svgW, height: svgH, minHeight: "100%" }}>
          {/* SVG edges */}
          <svg width={svgW} height={svgH} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
            {edges.map((e, i) => {
              const mx = (e.x1 + e.x2) / 2;
              return (
                <path key={i}
                  d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`}
                  fill="none" stroke={e.colour} strokeWidth={2} strokeOpacity={0.35}
                />
              );
            })}
          </svg>

          {/* Nodes */}
          {positioned.map(({ node, x, y }) => {
            const phase = node.phase;
            const colour = getPhaseColourById(phase.id, phases);
            const leaf = node.children.length === 0;
            const statusCol = STATUS_COLORS[phase.status] ?? "#6a7292";
            const isSelected = phase.id === selectedPhaseId;

            return (
              <div key={phase.id}
              onClick={() => onSelectPhase?.(phase.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectPhase?.(phase.id); } }}
              style={{
                position: "absolute", left: x, top: y, width: NODE_W, height: NODE_H,
                background: isSelected ? `${colour}15` : "rgba(30,36,50,0.92)",
                border: isSelected ? `2px solid ${colour}` : `1px solid ${colour}33`,
                borderRadius: 10, padding: "10px 14px", display: "flex", flexDirection: "column",
                justifyContent: "space-between", overflow: "hidden", boxSizing: "border-box",
                transition: "border-color 0.2s, box-shadow 0.2s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = colour + "88"; e.currentTarget.style.boxShadow = `0 0 12px ${colour}22`; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = colour + "33"; e.currentTarget.style.boxShadow = "none"; }}
              >
                {/* Top colour bar */}
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: colour, borderRadius: "10px 10px 0 0" }} />

                {/* Info */}
                <div style={{ paddingTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: statusCol }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#e0e4ec", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: NODE_W - 80 }}>
                      {phase.name}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                    {/* Offsets are D+n or H+n depending on the scenario
                        (NxgPhase stores them as strings) — formatPhaseWindow
                        renders whichever scale this phase uses. */}
                    {formatPhaseWindow(phase)}
                    {phase.objective && (
                      <span style={{ marginLeft: 8, fontFamily: "inherit", fontStyle: "italic", maxWidth: 160, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
                        {phase.objective}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                {leaf ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => onViewOnMap(phase.id)}
                      style={{
                        flex: 1, fontSize: 10, fontWeight: 700, cursor: "pointer",
                        color: colour, background: colour + "18", border: `1px solid ${colour}44`,
                        borderRadius: 5, padding: "4px 0", letterSpacing: "0.03em",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = colour + "30"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = colour + "18"; }}
                    >
                      ▶ View on Map
                    </button>
                    <button type="button" onClick={() => onViewTimeline(phase.id)}
                      style={{
                        flex: 1, fontSize: 10, fontWeight: 700, cursor: "pointer",
                        color: "#8b95a8", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 5, padding: "4px 0", letterSpacing: "0.03em",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                    >
                      ▤ Timeline
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>
                    {node.children.length} branch{node.children.length !== 1 ? "es" : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
