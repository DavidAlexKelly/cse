/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import React, { useState, useCallback, useRef } from "react";
import "../shared/styling/index.css";
import "./dataVisualiser.css";

// ── Types ────────────────────────────────────────────────────────────────────

interface Node {
  id: string;
  label: string;
  objectType: string;
  x: number;
  y: number;
  color: string;
  count: number;
}

interface Edge {
  from: string;
  to: string;
  label: string;
  style: "solid" | "dashed";
}

// ── Colour palette per object type ───────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  Exercise: "#4c7ef3",
  Person: "#8b5cf6",
  WorkflowTask: "#f59e0b",
  Scenario: "#10b981",
  OPFORDefinition: "#ef4444",
  TrainingAudience: "#06b6d4",
  TrainingObjective: "#84cc16",
  PMESIIDomain: "#f97316",
  Inject: "#e11d48",
  Composition: "#6366f1",
  TerrainFeature: "#a16207",
  Unit: "#0ea5e9",
  OrbatNode: "#7c3aed",
  Comment: "#6a7292",
};

// ── Raw data summaries (counts + key ids) ────────────────────────────────────

const OBJECT_TYPES = [
  { type: "Exercise",         count: 1,  file: "exercises.json" },
  { type: "Person",           count: 5,  file: "persons.json" },
  { type: "WorkflowTask",     count: 8,  file: "workflowTask.json" },
  { type: "Scenario",         count: 1,  file: "scenarios.json" },
  { type: "OPFORDefinition",  count: 2,  file: "opfor.json" },
  { type: "TrainingAudience", count: 5,  file: "trainingAudiences.json" },
  { type: "TrainingObjective",count: 8,  file: "trainingObjectives.json" },
  { type: "PMESIIDomain",     count: 8,  file: "pmesii.json" },
  { type: "Inject",           count: 8,  file: "injects.json" },
  { type: "Composition",      count: 1,  file: "compositions.json" },
  { type: "TerrainFeature",   count: 3,  file: "terrainFeatures.json" },
  { type: "Unit",             count: 12, file: "units.json" },
  { type: "OrbatNode",        count: 6,  file: "orbatNodes.json" },
  { type: "Comment",          count: 3,  file: "comments.json" },
];

// All relationships derived from __links and structural fields
const RELATIONSHIPS: Array<{ from: string; to: string; label: string; style: "solid" | "dashed" }> = [
  { from: "Exercise",         to: "Person",            label: "hasTeamMember (5)",        style: "solid" },
  { from: "Exercise",         to: "WorkflowTask",      label: "hasWorkflowTask (8)",       style: "solid" },
  { from: "WorkflowTask",     to: "Person",            label: "assignedTo / approvedBy",  style: "solid" },
  { from: "WorkflowTask",     to: "Scenario",          label: "definesContent",            style: "solid" },
  { from: "WorkflowTask",     to: "TrainingAudience",  label: "definesContent",            style: "solid" },
  { from: "WorkflowTask",     to: "TrainingObjective", label: "definesContent",            style: "solid" },
  { from: "WorkflowTask",     to: "Composition",       label: "definesContent",            style: "solid" },
  { from: "WorkflowTask",     to: "PMESIIDomain",      label: "definesContent",            style: "solid" },
  { from: "WorkflowTask",     to: "TerrainFeature",    label: "definesContent",            style: "solid" },
  { from: "WorkflowTask",     to: "Inject",            label: "definesContent",            style: "solid" },
  { from: "WorkflowTask",     to: "OrbatNode",         label: "definesContent",            style: "solid" },
  { from: "WorkflowTask",     to: "Comment",           label: "hasComment",                style: "dashed" },
  { from: "Scenario",         to: "OPFORDefinition",   label: "hasOPFOR (2)",              style: "solid" },
  { from: "OPFORDefinition",  to: "Unit",              label: "instantiatedAs",            style: "dashed" },
  { from: "Inject",           to: "TerrainFeature",    label: "referencesTerrainFeature",  style: "dashed" },
  { from: "Inject",           to: "TrainingObjective", label: "trainingObjectiveLinks",     style: "dashed" },
  { from: "OrbatNode",        to: "OrbatNode",         label: "parentNodeId (tree)",       style: "solid" },
  { from: "OrbatNode",        to: "Unit",              label: "instantiatedFrom",          style: "solid" },
  { from: "Comment",          to: "Person",            label: "authoredBy",                style: "dashed" },
];

// ── Layout: place nodes in a radial-ish arrangement ─────────────────────────

function buildNodes(): Node[] {
  const cx = 600, cy = 400, r1 = 140, r2 = 290;

  // Exercise at centre
  const centre = [{ type: "Exercise", cx, cy }];

  // Inner ring: things Exercise links to directly
  const inner = ["Person", "WorkflowTask"];
  // Outer ring: everything else
  const outer = OBJECT_TYPES
    .map(o => o.type)
    .filter(t => t !== "Exercise" && !inner.includes(t));

  const positions: Record<string, { x: number; y: number }> = {};
  centre.forEach(c => { positions[c.type] = { x: c.cx, y: c.cy }; });

  inner.forEach((t, i) => {
    const angle = (i / inner.length) * 2 * Math.PI - Math.PI / 2;
    positions[t] = { x: cx + r1 * Math.cos(angle), y: cy + r1 * Math.sin(angle) };
  });

  outer.forEach((t, i) => {
    const angle = (i / outer.length) * 2 * Math.PI - Math.PI / 2;
    positions[t] = { x: cx + r2 * Math.cos(angle), y: cy + r2 * Math.sin(angle) };
  });

  return OBJECT_TYPES.map(({ type, count}) => ({
    id: type,
    label: type,
    objectType: type,
    x: positions[type]?.x ?? 0,
    y: positions[type]?.y ?? 0,
    color: TYPE_COLORS[type] ?? "#888",
    count,
  }));
}

// ── Detail panel content per type ────────────────────────────────────────────

const DETAIL: Record<string, { file: string; fields: string[]; notes: string }> = {
  Exercise: {
    file: "exercises.json",
    fields: ["exerciseId", "name", "type", "classification", "phase", "status", "overallProgressPct", "createdDate"],
    notes: "Root object. Links to all team members (Person) and all workflow tasks (WorkflowTask).",
  },
  Person: {
    file: "persons.json",
    fields: ["personId", "name", "rank", "role", "initials", "nation"],
    notes: "5 people: Hartmann, Anderssen, Kowalski, Roos, Westergaard. Referenced by WorkflowTask (assignedTo / approvedBy) and Comment (authoredBy).",
  },
  WorkflowTask: {
    file: "workflowTask.json",
    fields: ["taskId", "name", "description", "section", "dueOffset", "status", "aiAssisted"],
    notes: "8 tasks in 3 sections: Planning & Design, Scenario & Environment, Execution Planning. Each defines content in other object types.",
  },
  Scenario: {
    file: "scenarios.json",
    fields: ["scenarioId", "title", "strategicContext", "tags", "aiGenerated", "sourceDocuments", "lastEdited"],
    notes: "1 scenario (Sorvian Peninsula Crisis). Links to 2 OPFOR definitions.",
  },
  OPFORDefinition: {
    file: "opfor.json",
    fields: ["opforId", "title", "tier", "readiness", "body", "tags"],
    notes: "2 entries: 'Dorvian 3rd CAA' (near-peer, linked to a Unit) and 'Asymmetric threat cells' (sub-state, no Unit link).",
  },
  TrainingAudience: {
    file: "trainingAudiences.json",
    fields: ["audienceId", "name", "audienceType", "participantCount", "description", "directorates", "participatingNations"],
    notes: "1 primary (MN Div HQ, 420 pax) + 4 secondary audiences (J2, J3, J4, J6). Total ~620 participants.",
  },
  TrainingObjective: {
    file: "trainingObjectives.json",
    fields: ["objectiveId", "ref", "objective", "functionalArea", "priority"],
    notes: "8 objectives (TO-01 → TO-08) covering C2, fires, logistics, cyber, CIMIC, intel, STRATCOM. Referenced by Injects.",
  },
  PMESIIDomain: {
    file: "pmesii.json",
    fields: ["domainId", "key", "value", "status", "aiGenerated"],
    notes: "8 PMESII-PT domains. 5 complete (AI-generated), 1 in-review, 2 empty (Physical Env, Time).",
  },
  Inject: {
    file: "injects.json",
    fields: ["injectId", "title", "dayOffset", "category", "body", "expectedResponse", "trainingObjectiveLinks"],
    notes: "8 injects across D+0 → D+12. Categories: INTEL, CYBER, CIMIC, METOC, POLMIL, LOG, INFO OPS. 3 reference terrain features.",
  },
  Composition: {
    file: "compositions.json",
    fields: ["compositionId", "federationProtocol", "topologyType", "simulationNodes[]", "c2Systems[]", "supportSystems[]"],
    notes: "1 composition (HLA star topology). 4 sim nodes (TLS-GO, Ascot7, VBS4, MASA SWORD). 4 C2 systems. 2 support systems.",
  },
  TerrainFeature: {
    file: "terrainFeatures.json",
    fields: ["featureId", "name", "featureType", "description", "latlng", "tacticalSignificance"],
    notes: "3 features: PORT SOVA (High), RIDGELINE AMBER (High), BRIDGE CLUSTER DELTA (Critical). All have lat/lng coordinates.",
  },
  Unit: {
    file: "units.json",
    fields: ["unitId", "name", "echelon", "type", "nation", "side"],
    notes: "12 units: 1 Corps, 2 Divisions, 5 Brigades, 3 Battalions (all BLUFOR) + 1 OPFOR corps. 5 nations: DEU, POL, GBR, NOR, NLD.",
  },
  OrbatNode: {
    file: "orbatNodes.json",
    fields: ["nodeId", "parentNodeId", "treeLevel", "strength", "readiness", "equipmentStatus", "latlng"],
    notes: "6 nodes forming a 3-level tree: I Corps → 1 Arm Div / 2 Mech Div → 3 Brigades. Each instantiatedFrom a Unit. Only I Corps and 1 Arm Div have strength data.",
  },
  Comment: {
    file: "comments.json",
    fields: ["commentId", "body", "timestamp"],
    notes: "3 comments: 2 on task_scenario (Anderssen + Kowalski), 1 on task_pmesii (Anderssen). All authored-by links to Person.",
  },
};

// ── SVG Arrow marker ─────────────────────────────────────────────────────────

function ArrowMarker({ id, color }: { id: string; color: string }) {
  return (
    <marker
      id={id}
      markerWidth="8"
      markerHeight="8"
      refX="6"
      refY="3"
      orient="auto"
    >
      <path d="M0,0 L0,6 L8,3 z" fill={color} />
    </marker>
  );
}

// ── Edge component ────────────────────────────────────────────────────────────

function EdgeLine({
  edge,
  nodes,
  highlighted,
  faded,
  onHover,
  onLeave,
}: {
  edge: Edge;
  nodes: Node[];
  highlighted: boolean;
  faded: boolean;
  onHover: () => void;
  onLeave: () => void;
}) {
  const from = nodes.find(n => n.id === edge.from);
  const to = nodes.find(n => n.id === edge.to);
  if (!from || !to) return null;

  // Self-loop (OrbatNode -> OrbatNode)
  const isSelf = edge.from === edge.to;

  const color = highlighted ? "#e6eaf8" : faded ? "#1a1f36" : "#454c68";
  const strokeW = highlighted ? 2 : 1;

  const markerId = `arrow-${edge.from}-${edge.to}-${edge.label.replace(/\W/g, "")}`;

  if (isSelf) {
    const rx = 28, ry = 18;
    return (
      <g opacity={faded ? 0.15 : 1}>
        <defs><ArrowMarker id={markerId} color={color} /></defs>
        <ellipse
          cx={from.x + 32}
          cy={from.y - 20}
          rx={rx}
          ry={ry}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeDasharray={edge.style === "dashed" ? "4 3" : undefined}
          markerEnd={`url(#${markerId})`}
          onMouseEnter={onHover}
          onMouseLeave={onLeave}
          style={{ cursor: "default" }}
        />
        {highlighted && (
          <text x={from.x + 62} y={from.y - 36} fontSize={9} fill="#98a1c0" textAnchor="middle">
            {edge.label}
          </text>
        )}
      </g>
    );
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = dx / len, ny = dy / len;
  const nodeR = 32;

  const x1 = from.x + nx * nodeR;
  const y1 = from.y + ny * nodeR;
  const x2 = to.x - nx * (nodeR + 4);
  const y2 = to.y - ny * (nodeR + 4);

  // Slight curve
  const mx = (x1 + x2) / 2 - ny * 20;
  const my = (y1 + y2) / 2 + nx * 20;

  const midX = 0.25 * x1 + 0.5 * mx + 0.25 * x2;
  const midY = 0.25 * y1 + 0.5 * my + 0.25 * y2;

  return (
    <g opacity={faded ? 0.1 : 1}>
      <defs><ArrowMarker id={markerId} color={color} /></defs>
      <path
        d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        strokeDasharray={edge.style === "dashed" ? "5 3" : undefined}
        markerEnd={`url(#${markerId})`}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
        style={{ cursor: "default" }}
      />
      {highlighted && (
        <text x={midX} y={midY - 5} fontSize={9} fill="#98a1c0" textAnchor="middle"
          style={{ pointerEvents: "none" }}>
          {edge.label}
        </text>
      )}
    </g>
  );
}

// ── Node component ────────────────────────────────────────────────────────────

function NodeCircle({
  node,
  selected,
  highlighted,
  faded,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  node: Node;
  selected: boolean;
  highlighted: boolean;
  faded: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const r = 32;
  const opacity = faded ? 0.2 : 1;

  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ cursor: "pointer" }}
      opacity={opacity}
    >
      {/* Glow ring when selected */}
      {selected && (
        <circle r={r + 6} fill="none" stroke={node.color} strokeWidth={2} opacity={0.4} />
      )}
      {/* Highlight ring on hover */}
      {highlighted && !selected && (
        <circle r={r + 4} fill="none" stroke={node.color} strokeWidth={1.5} opacity={0.3} />
      )}
      {/* Main circle */}
      <circle
        r={r}
        fill={selected || highlighted ? node.color : "#171c30"}
        stroke={node.color}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      {/* Count badge */}
      <circle cx={r - 6} cy={-(r - 6)} r={10} fill="#0b0e18" stroke={node.color} strokeWidth={1} />
      <text x={r - 6} y={-(r - 6)} textAnchor="middle" dominantBaseline="central"
        fontSize={9} fontWeight="700" fill={node.color}>
        {node.count}
      </text>
      {/* Label inside */}
      {(() => {
        // Wrap long labels
        const words = node.label.replace(/([A-Z])/g, " $1").trim().split(" ");
        if (words.length <= 2) {
          return (
            <text textAnchor="middle" dominantBaseline="central"
              fontSize={9} fontWeight="600"
              fill={selected || highlighted ? "#0b0e18" : "#e6eaf8"}>
              {words.join("\n")}
            </text>
          );
        }
        const mid = Math.ceil(words.length / 2);
        return (
          <>
            <text y={-6} textAnchor="middle" fontSize={8.5} fontWeight="600"
              fill={selected || highlighted ? "#0b0e18" : "#e6eaf8"}>
              {words.slice(0, mid).join(" ")}
            </text>
            <text y={6} textAnchor="middle" fontSize={8.5} fontWeight="600"
              fill={selected || highlighted ? "#0b0e18" : "#e6eaf8"}>
              {words.slice(mid).join(" ")}
            </text>
          </>
        );
      })()}
    </g>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ type, onClose }: { type: string; onClose: () => void }) {
  const detail = DETAIL[type];
  const meta = OBJECT_TYPES.find(o => o.type === type);
  if (!detail || !meta) return null;

  const color = TYPE_COLORS[type] ?? "#888";

  const incoming = RELATIONSHIPS.filter(r => r.to === type);
  const outgoing = RELATIONSHIPS.filter(r => r.from === type && r.to !== type);

  return (
    <div className="dv-detail">
      <div className="dv-detail__header" style={{ borderColor: color }}>
        <span className="dv-detail__dot" style={{ background: color }} />
        <span className="dv-detail__title">{type}</span>
        <span className="dv-detail__file">{detail.file}</span>
        <button className="dv-detail__close" onClick={onClose}>✕</button>
      </div>

      <div className="dv-detail__body">
        <div className="dv-detail__row">
          <span className="dv-detail__label">Objects</span>
          <span className="dv-detail__value" style={{ color }}>{meta.count}</span>
        </div>

        <div className="dv-detail__section">Notes</div>
        <p className="dv-detail__notes">{detail.notes}</p>

        <div className="dv-detail__section">Fields</div>
        <div className="dv-detail__fields">
          {detail.fields.map(f => (
            <span key={f} className="dv-detail__field">{f}</span>
          ))}
        </div>

        {outgoing.length > 0 && (
          <>
            <div className="dv-detail__section">Outgoing links</div>
            {outgoing.map((r, i) => (
              <div key={i} className="dv-detail__link dv-detail__link--out">
                <span className="dv-detail__link-arrow">→</span>
                <span className="dv-detail__link-type" style={{ color: TYPE_COLORS[r.to] ?? "#888" }}>
                  {r.to}
                </span>
                <span className="dv-detail__link-label">{r.label}</span>
                {r.style === "dashed" && <span className="dv-detail__link-badge">optional</span>}
              </div>
            ))}
          </>
        )}

        {incoming.length > 0 && (
          <>
            <div className="dv-detail__section">Incoming links</div>
            {incoming.map((r, i) => (
              <div key={i} className="dv-detail__link dv-detail__link--in">
                <span className="dv-detail__link-arrow">←</span>
                <span className="dv-detail__link-type" style={{ color: TYPE_COLORS[r.from] ?? "#888" }}>
                  {r.from}
                </span>
                <span className="dv-detail__link-label">{r.label}</span>
                {r.style === "dashed" && <span className="dv-detail__link-badge">optional</span>}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="dv-legend">
      <div className="dv-legend__title">Legend</div>
      <div className="dv-legend__row">
        <svg width="30" height="10"><line x1="0" y1="5" x2="30" y2="5" stroke="#454c68" strokeWidth="1.5" /></svg>
        <span>Required link</span>
      </div>
      <div className="dv-legend__row">
        <svg width="30" height="10"><line x1="0" y1="5" x2="30" y2="5" stroke="#454c68" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
        <span>Optional / derived link</span>
      </div>
      <div className="dv-legend__row">
        <svg width="14" height="14">
          <circle cx="7" cy="7" r="6" fill="#171c30" stroke="#888" strokeWidth="1.5" />
        </svg>
        <span>Object type node</span>
      </div>
      <div className="dv-legend__row">
        <svg width="14" height="14">
          <circle cx="7" cy="7" r="6" fill="#4c7ef3" stroke="#4c7ef3" strokeWidth="1.5" />
        </svg>
        <span>Selected / hovered</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const NODES = buildNodes();
const VIEWBOX = "0 0 1200 800";

export function DataVisualiser() {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);

  // Pan + zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const active = selected ?? hovered;

  // Which nodes are connected to the active one?
  const connectedIds = active
    ? new Set(
        RELATIONSHIPS.flatMap(r =>
          r.from === active ? [r.to] : r.to === active ? [r.from] : [],
        ),
      )
    : null;

  const handleNodeClick = useCallback((id: string) => {
    setSelected(prev => (prev === id ? null : id));
  }, []);

  // Pan handlers
  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Only pan if clicking the background
    if ((e.target as Element).closest(".dv-node-group")) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPan(p => ({ x: p.x + dx / zoom, y: p.y + dy / zoom }));
  };
  const onMouseUp = () => { dragging.current = false; };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    setZoom(z => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001)));
  };

  const resetView = () => { setPan({ x: 0, y: 0 }); setZoom(1); };

  return (
    <div className="dv-root">
      {/* Header */}
      <div className="dv-header">
        <div className="dv-header__title">
          <span className="dv-header__icon">⬡</span>
          Data Model Visualiser
        </div>
        <div className="dv-header__subtitle">
          {OBJECT_TYPES.length} object types · {RELATIONSHIPS.length} relationship types ·
          src/shared/data/
        </div>
        <button className="dv-header__reset" onClick={resetView}>Reset view</button>
      </div>

      <div className="dv-body">
        {/* Graph */}
        <div className="dv-canvas-wrap">
          <svg
            ref={svgRef}
            className="dv-canvas"
            viewBox={VIEWBOX}
            preserveAspectRatio="xMidYMid meet"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
          >
            <g transform={`scale(${zoom}) translate(${pan.x},${pan.y})`}>
              {/* Edges */}
              {RELATIONSHIPS.map((edge, i) => {
                const fromActive = active === edge.from || active === edge.to;
                const edgeHighlighted = hoveredEdge === i || (active != null && fromActive);
                const edgeFaded = active != null && !fromActive && hoveredEdge !== i;
                return (
                  <EdgeLine
                    key={i}
                    edge={edge}
                    nodes={NODES}
                    highlighted={edgeHighlighted}
                    faded={edgeFaded}
                    onHover={() => setHoveredEdge(i)}
                    onLeave={() => setHoveredEdge(null)}
                  />
                );
              })}

              {/* Nodes */}
              {NODES.map(node => {
                const isSelected = selected === node.id;
                const isHovered = hovered === node.id;
                const isConnected = connectedIds?.has(node.id) ?? false;
                const isFaded = active != null && !isSelected && !isHovered && !isConnected && node.id !== active;

                return (
                  <g key={node.id} className="dv-node-group">
                    <NodeCircle
                      node={node}
                      selected={isSelected}
                      highlighted={isHovered || (active != null && isConnected)}
                      faded={isFaded}
                      onClick={() => handleNodeClick(node.id)}
                      onMouseEnter={() => setHovered(node.id)}
                      onMouseLeave={() => setHovered(null)}
                    />
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Zoom controls */}
          <div className="dv-zoom">
            <button onClick={() => setZoom(z => Math.min(3, z + 0.15))}>+</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.max(0.3, z - 0.15))}>−</button>
          </div>
        </div>

        {/* Side panel */}
        <div className="dv-sidebar">
          {selected
            ? <DetailPanel type={selected} onClose={() => setSelected(null)} />
            : (
              <div className="dv-sidebar__hint">
                <div className="dv-sidebar__hint-icon">◎</div>
                <div>Click a node to explore its fields, links, and source file.</div>
                <div className="dv-sidebar__hint-sub">Scroll or drag the canvas to pan/zoom.</div>
              </div>
            )
          }
          <Legend />

          {/* Object type list */}
          <div className="dv-type-list">
            <div className="dv-type-list__title">Object Types</div>
            {OBJECT_TYPES.map(({ type, count, file }) => (
              <div
                key={type}
                className={`dv-type-list__row${selected === type ? " dv-type-list__row--active" : ""}`}
                onClick={() => handleNodeClick(type)}
              >
                <span className="dv-type-list__dot" style={{ background: TYPE_COLORS[type] }} />
                <span className="dv-type-list__name">{type}</span>
                <span className="dv-type-list__count">{count}</span>
                <span className="dv-type-list__file">{file}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
