import React, { useMemo, useState } from "react";
import {
  OPERATIONS,
  PHASE_COLORS,
  PHASE_LABELS,
  PHASE_ORDER,
  STATUS_COLORS,
  STATUS_LABEL,
  type OperationOverlay,
  type PpeaRole,
  type PpeaTask,
} from "./ppeaData.js";
import {
  computeBlueprint,
  getDirectDownstream,
  getTaskContent,
  getTaskStatus,
  getUpstream,
} from "./ppeaLogic.js";

// ── Geometry constants ─────────────────────────────────────────────────────

const NW = 148;
const NH = 62;
const HGAP = 44;
const VGAP = 32;
const PAD = 48;

interface NodePos {
  x: number;
  y: number;
}

interface Props {
  tasks: PpeaTask[];
  roles: PpeaRole[];
  overlay: OperationOverlay;
  activeOperationId: string;
  onOpenTask: (taskId: string) => void;
  onContentChange: (taskId: string, content: string) => void;
}
function edgePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): string {
  const dx = tx - sx;
  const dy = ty - sy;
  if (Math.abs(dx) < 10) {
    return `M${sx},${sy + NH / 2} L${tx},${ty - NH / 2}`;
  }
  if (Math.abs(dy) < 10 && Math.abs(dx) > NW) {
    return `M${sx + NW / 2},${sy} L${tx - NW / 2},${ty}`;
  }
  const x1 = sx + (dx > 0 ? NW / 2 : -NW / 2);
  const y1 = sy;
  const x2 = tx - (dx > 0 ? NW / 2 : -NW / 2);
  const y2 = ty;
  return `M${x1},${y1} C${x1 + dx * 0.45},${y1} ${x2 - dx * 0.45},${y2} ${x2},${y2}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export const Blueprint: React.FC<Props> = ({
  tasks,
  roles,
  overlay,
  activeOperationId,
  onOpenTask,
  onContentChange,
}) => {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // Recompute layout whenever tasks or their deps change.
  const nodes = useMemo(() => computeBlueprint(tasks), [tasks]);
  const { pos, totalW, totalH } = useMemo(() => {
    const maxCol = Math.max(0, ...nodes.map((n) => n.col ?? 0));
    const maxRow = Math.max(0, ...nodes.map((n) => n.row ?? 0));
    const p: Record<string, NodePos> = {};
    nodes.forEach((n) => {
      p[n.id] = {
        x: PAD + (n.col ?? 0) * (NW + HGAP) + NW / 2,
        y: PAD + 50 + (n.row ?? 0) * (NH + VGAP) + NH / 2,
      };
    });
    const w = PAD + (maxCol + 1) * (NW + HGAP) - HGAP + PAD;
    const h = PAD + 50 + (maxRow + 1) * (NH + VGAP) - VGAP + PAD;
    return { pos: p, totalW: w, totalH: h };
  }, [nodes]);

  // ── Phase column ranges (for backdrop rectangles) ───────────────────────
  const phaseColRanges = useMemo(() => {
    const out: Partial<Record<string, { min: number; max: number }>> = {};
    PHASE_ORDER.forEach((ph) => {
      const cols = nodes
        .filter((n) => n.phase === ph)
        .map((n) => n.col ?? 0);
      if (cols.length === 0) return;
      out[ph] = { min: Math.min(...cols), max: Math.max(...cols) };
    });
    return out;
  }, [nodes]);

  const taskById = useMemo(() => {
    const m = new Map<string, PpeaTask>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  const roleById = (id: string): PpeaRole | undefined =>
    roles.find((r) => r.id === id);

  const openDrawer = (id: string) => {
    setActiveNodeId(id);
    setDraft(getTaskContent(overlay, id));
  };

  const closeDrawer = () => {
    setActiveNodeId(null);
  };

  const saveDraft = () => {
    if (!activeNodeId) return;
    onContentChange(activeNodeId, draft);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  // Stub AI: spins for ~1.2s then leaves textarea unchanged
  const generateAi = () => {
    if (!activeNodeId) return;
    setAiBusy(true);
    window.setTimeout(() => setAiBusy(false), 1200);
  };

  const activeTask = activeNodeId ? taskById.get(activeNodeId) ?? null : null;
  const activeNode = activeNodeId
    ? nodes.find((n) => n.id === activeNodeId) ?? null
    : null;
  const activePhaseColor = activeNode ? PHASE_COLORS[activeNode.phase] : null;

  const upstreamFilledIds = useMemo(() => {
    if (!activeNodeId) return [] as string[];
    return getUpstream(tasks, activeNodeId)
      .filter((t) => getTaskContent(overlay, t.id).trim())
      .map((t) => t.id);
  }, [tasks, overlay, activeNodeId]);

  const downstream = useMemo(() => {
    if (!activeNodeId) return [] as PpeaTask[];
    return getDirectDownstream(tasks, activeNodeId);
  }, [tasks, activeNodeId]);

  const activeOperation = OPERATIONS.find(
    (o) => o.id === activeOperationId,
  );

  // ── SVG construction ────────────────────────────────────────────────────

  return (
    <div className="ppea-blueprint">
      {/* Status legend — fixed overlay pinned to the top-right of the
          blueprint panel.  Sits above the scrolling SVG canvas so it
          never collides with the Assess phase column or any node. */}
      <div className="ppea-bp-legend" aria-label="Task state legend">
        <div className="ppea-bp-legend__title">TASK STATE</div>
        {(
          [
            { label: "Approved",         status: "approved" as const },
            { label: "Ready for review", status: "ready_for_review" as const },
            { label: "In progress",      status: "in_progress" as const },
            { label: "Not started",      status: "not_started" as const },
          ]
        ).map((it) => (
          <div key={it.status} className="ppea-bp-legend__row">
            <span
              className="ppea-bp-legend__dot"
              style={{
                background: STATUS_COLORS[it.status],
                opacity: it.status === "not_started" ? 0.55 : 1,
              }}
            />
            <span className="ppea-bp-legend__label">{it.label}</span>
          </div>
        ))}
      </div>
      <div className="ppea-bp-canvas">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={totalW}
          height={totalH}
          style={{ display: "block" }}
        >
          <defs>
            {PHASE_ORDER.map((ph) => (
              <marker
                key={`arr-${ph}`}
                id={`arr-${ph}`}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="3"
                orient="auto"
              >
                <path
                  d="M0,0 L0,6 L8,3 z"
                  fill={PHASE_COLORS[ph].border}
                  opacity="0.75"
                />
              </marker>
            ))}
            <marker
              id="arr-cross"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" fill="#5A8AB8" opacity="0.65" />
            </marker>
          </defs>

          {/* Phase background rectangles */}
          {PHASE_ORDER.map((ph) => {
            const range = phaseColRanges[ph];
            if (!range) return null;
            const { min, max } = range;
            const x1 = PAD + min * (NW + HGAP) - HGAP / 2;
            const x2 = PAD + max * (NW + HGAP) + NW + HGAP / 2;
            const pc = PHASE_COLORS[ph];
            return (
              <g key={`phase-${ph}`}>
                <rect
                  x={x1}
                  y={8}
                  width={x2 - x1}
                  height={totalH - 16}
                  rx={6}
                  fill={pc.labelBg}
                  stroke={pc.border}
                  strokeWidth={1}
                  strokeOpacity={0.4}
                />
                <rect
                  x={x1 + 10}
                  y={16}
                  width={90}
                  height={22}
                  rx={3}
                  fill={pc.labelBg}
                />
                <text
                  x={x1 + 55}
                  y={31}
                  textAnchor="middle"
                  fontFamily="'Inter', 'Segoe UI', sans-serif"
                  fontSize={11}
                  fontWeight={700}
                  letterSpacing="0.06em"
                  fill={pc.label}
                >
                  {PHASE_LABELS[ph].toUpperCase()}
                </text>
              </g>
            );
          })}

          {/* Edges */}
          {nodes.flatMap((n) =>
            n.deps
              .filter((srcId) => pos[srcId])
              .map((srcId) => {
                const src = nodes.find((m) => m.id === srcId)!;
                const crossPhase = src.phase !== n.phase;
                const s = pos[srcId];
                const t = pos[n.id];
                const stroke = crossPhase
                  ? "#5A8AB8"
                  : PHASE_COLORS[src.phase].border;
                const marker = crossPhase
                  ? "arr-cross"
                  : `arr-${src.phase}`;
                const d = edgePath(s.x, s.y, t.x, t.y);
                return (
                  <path
                    key={`${srcId}->${n.id}`}
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={crossPhase ? 1.2 : 1.5}
                    strokeDasharray={crossPhase ? "5,3" : undefined}
                    strokeOpacity={crossPhase ? 0.55 : 0.75}
                    markerEnd={`url(#${marker})`}
                  />
                );
              }),
          )}

          {/* Nodes */}
          {nodes.map((n) => {
            const pc = PHASE_COLORS[n.phase];
            const cx = pos[n.id].x;
            const cy = pos[n.id].y;
            const x = cx - NW / 2;
            const y = cy - NH / 2;
            const status = getTaskStatus(overlay, n.id);
            const statusColor = STATUS_COLORS[status];
            const isActive = n.id === activeNodeId;

            const lines = n.label.split("\n");
            const lineH = 15;
            const totalTextH = lines.length * lineH;
            const startY = cy - totalTextH / 2 + lineH * 0.7;

            const task = taskById.get(n.id);
            const owners = task?.owner ?? [];
            const chipW = 36;
            const chipH = 13;
            const chipGap = 4;
            const totalChipW =
              owners.length * (chipW + chipGap) - chipGap;
            let chipX = cx - totalChipW / 2;

            // Border colour: status if not not_started, otherwise phase.
            const borderColor =
              status === "not_started" ? pc.border : statusColor;
            const borderWidth = isActive ? 2.5 : status === "not_started" ? 1.5 : 2;

            return (
              <g
                key={n.id}
                className="ppea-bp-node"
                style={{ cursor: "pointer" }}
                onClick={() => openDrawer(n.id)}
              >
                <rect
                  className="ppea-bp-node-rect"
                  x={x}
                  y={y}
                  width={NW}
                  height={NH}
                  rx={5}
                  fill={pc.bg}
                  stroke={isActive ? "#5B9FE8" : borderColor}
                  strokeWidth={borderWidth}
                />
                {/* Phase accent stripe (left edge) */}
                <rect
                  x={x}
                  y={y}
                  width={4}
                  height={NH}
                  rx={2}
                  fill={pc.border}
                  opacity={0.85}
                />
                {/* Status accent stripe (top edge) — subtle but always visible */}
                <rect
                  x={x + 6}
                  y={y}
                  width={NW - 12}
                  height={3}
                  rx={1.5}
                  fill={statusColor}
                  opacity={status === "not_started" ? 0.35 : 0.95}
                />

                {lines.map((line, li) => (
                  <text
                    key={li}
                    x={cx + 2}
                    y={startY + li * lineH}
                    textAnchor="middle"
                    fontFamily="'Inter', 'Segoe UI', sans-serif"
                    fontSize={11.5}
                    fontWeight={500}
                    fill={pc.text}
                    pointerEvents="none"
                  >
                    {line}
                  </text>
                ))}

                {/* Status badge (top-right corner) — shows a check or label */}
                {status === "approved" && (
                  <g pointerEvents="none">
                    <circle
                      cx={x + NW - 10}
                      cy={y + 10}
                      r={6}
                      fill={statusColor}
                    />
                    <path
                      d={`M${x + NW - 13},${y + 10} l2,2 l4,-4`}
                      stroke="#fff"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </g>
                )}
                {status === "ready_for_review" && (
                  <g pointerEvents="none">
                    <rect
                      x={x + NW - 32}
                      y={y + 4}
                      width={26}
                      height={11}
                      rx={2}
                      fill={`${statusColor}D9`}
                    />
                    <text
                      x={x + NW - 19}
                      y={y + 12}
                      textAnchor="middle"
                      fontFamily="'Inter', 'Segoe UI', sans-serif"
                      fontSize={7.5}
                      fontWeight={700}
                      letterSpacing="0.08em"
                      fill="#fff"
                    >
                      REVIEW
                    </text>
                  </g>
                )}
                {status === "in_progress" && (
                  <g pointerEvents="none">
                    <rect
                      x={x + NW - 32}
                      y={y + 4}
                      width={26}
                      height={11}
                      rx={2}
                      fill={`${statusColor}D9`}
                    />
                    <text
                      x={x + NW - 19}
                      y={y + 12}
                      textAnchor="middle"
                      fontFamily="'Inter', 'Segoe UI', sans-serif"
                      fontSize={7.5}
                      fontWeight={700}
                      letterSpacing="0.08em"
                      fill="#fff"
                    >
                      WIP
                    </text>
                  </g>
                )}
                {status === "not_started" && (
                  <g pointerEvents="none">
                    <rect
                      x={x + NW - 38}
                      y={y + 4}
                      width={32}
                      height={11}
                      rx={2}
                      fill="rgba(106, 114, 146,0.22)"
                      stroke="rgba(138,147,170,0.35)"
                      strokeWidth={0.75}
                    />
                    <text
                      x={x + NW - 22}
                      y={y + 12}
                      textAnchor="middle"
                      fontFamily="'Inter', 'Segoe UI', sans-serif"
                      fontSize={7.5}
                      fontWeight={700}
                      letterSpacing="0.08em"
                      fill="#98a1c0"
                    >
                      TO DO
                    </text>
                  </g>
                )}

                {owners.map((oid) => {
                  const abbr = roleById(oid)?.abbr ?? oid;
                  const short = abbr.length > 6 ? abbr.slice(0, 6) : abbr;
                  const thisX = chipX;
                  chipX += chipW + chipGap;
                  return (
                    <g key={oid} pointerEvents="none">
                      <rect
                        x={thisX}
                        y={y + NH - 16}
                        width={chipW}
                        height={chipH}
                        rx={2}
                        fill={pc.border}
                        opacity={0.55}
                      />
                      <text
                        x={thisX + chipW / 2}
                        y={y + NH - 6}
                        textAnchor="middle"
                        fontFamily="'Inter', 'Segoe UI', sans-serif"
                        fontSize={9}
                        fontWeight={700}
                        fill={pc.text}
                      >
                        {short}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <div className={`ppea-bp-drawer ${activeNodeId ? "open" : ""}`}>
        {activeNodeId && activeTask && activeNode && activePhaseColor && (
          <div className="ppea-bp-drawer__inner">
            <div className="ppea-bp-drawer__head">
              <div style={{ flex: 1 }}>
                <div
                  className="ppea-bp-drawer__phase"
                  style={{ color: activePhaseColor.label }}
                >
                  {PHASE_LABELS[activeNode.phase].toUpperCase()} ·{" "}
                  {STATUS_LABEL[getTaskStatus(overlay, activeNodeId)]}
                </div>
                <div className="ppea-bp-drawer__title">{activeTask.name}</div>
                {activeOperation && (
                  <div className="ppea-bp-drawer__op">
                    {activeOperation.shortName}
                  </div>
                )}
              </div>
              <button
                className="ppea-bp-drawer__close"
                onClick={closeDrawer}
                aria-label="Close"
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="ppea-bp-drawer__body">
              <p className="ppea-bp-drawer__desc">{activeTask.desc}</p>

              {upstreamFilledIds.length > 0 && (
                <div>
                  <div className="ppea-bp-context-label">
                    Upstream context available
                  </div>
                  <div className="ppea-bp-context-pills">
                    {upstreamFilledIds.map((id) => {
                      const t = taskById.get(id)!;
                      return (
                        <button
                          key={id}
                          type="button"
                          className="ppea-bp-context-pill has-content"
                          onClick={() => openDrawer(id)}
                          title={t.name}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="ppea-bp-field-label">
                  Your content for this task
                </div>
                <textarea
                  className={`ppea-bp-textarea ${getTaskContent(overlay, activeNodeId) ? "ai-filled" : ""}`}
                  placeholder="Enter operation-specific content here…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </div>

              <div className="ppea-bp-action-row">
                <button
                  type="button"
                  className="ppea-bp-ai-btn"
                  onClick={generateAi}
                  disabled={aiBusy}
                >
                  {aiBusy ? (
                    <>
                      <span className="ppea-bp-spinner" /> Generating…
                    </>
                  ) : (
                    <>
                      <span className="ppea-bp-ai-btn__icon">✦</span>
                      {getTaskContent(overlay, activeNodeId)
                        ? "Regenerate with AI"
                        : "Generate with AI"}
                    </>
                  )}
                </button>
                <div className="ppea-bp-save-row">
                  <button
                    type="button"
                    className="ppea-bp-save-btn"
                    onClick={saveDraft}
                  >
                    Save
                  </button>
                  <span
                    className={`ppea-bp-saved-msg ${savedFlash ? "show" : ""}`}
                  >
                    Saved ✓
                  </span>
                  <button
                    type="button"
                    className="ppea-btn ppea-btn--ghost"
                    onClick={() => onOpenTask(activeNodeId)}
                  >
                    Open task…
                  </button>
                </div>
              </div>

              {downstream.length > 0 && (
                <div className="ppea-bp-downstream">
                  <div className="ppea-bp-downstream__label">
                    This feeds into
                  </div>
                  <div className="ppea-bp-downstream__items">
                    {downstream.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="ppea-bp-downstream__item"
                        onClick={() => openDrawer(t.id)}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

