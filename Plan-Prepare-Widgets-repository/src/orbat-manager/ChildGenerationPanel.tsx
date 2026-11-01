// ============================================================
//  Child Generation Panel
//  For every bare unit (any echelon with a doctrine entry,
//  no children) in the group, proposes and applies an
//  auto-generated sub-tree all the way to the lowest level.
// ============================================================

import React, { useMemo, useState, useCallback } from "react";
import type { UnitNode, EchelonLevel } from "./types.js";
import { ECHELON_INDEX, ECHELON_LABELS, ECHELON_ORDER } from "./types.js";
import { flattenTree } from "./treeUtils.js";
import {
  computeChildGenerationProposals,
  flattenGenerationOps,
  type GenerationProposal,
  type GeneratedUnit,
  type DonorScoreBreakdown,
} from "./autoChildGeneration.js";

// ── Doctrine echelons (those that have a DOCTRINE entry) ──────────────────────
// Mirrors the keys in autoChildGeneration DOCTRINE table
const DOCTRINE_ECHELONS = new Set<EchelonLevel>([
  "theatre",
  "armyGroup",
  "army",
  "corps",
  "division",
  "brigade",
  "regiment",
  "battalion",
  "company",
  "platoon",
  "section",
  "squad",
]);

interface Props {
  units: UnitNode[];
  affiliation: UnitNode["symbol"]["standardIdentity"];
  onAddUnit: (
    parentId: string | null,
    input: Record<string, unknown>
  ) => Promise<unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function echelonColour(echelon: EchelonLevel): string {
  const idx = ECHELON_INDEX[echelon];
  const colours = [
    "#98a1c0",
    "#7dd3fc",
    "#67e8f9",
    "#6ee7b7",
    "#86efac",
    "#fbbf24",
    "#fb923c",
    "#f87171",
    "#c084fc",
    "#e879f9",
    "#a78bfa",
    "#60a5fa",
    "#34d399",
  ];
  return colours[idx % colours.length];
}

function countGenerated(children: GeneratedUnit[]): number {
  let n = 0;
  const walk = (c: GeneratedUnit) => {
    n++;
    c.children.forEach(walk);
  };
  children.forEach(walk);
  return n;
}

function renderTree(children: GeneratedUnit[], prefix = ""): string {
  const lines: string[] = [];
  children.forEach((c, i) => {
    const isLast = i === children.length - 1;
    lines.push(`${prefix}${isLast ? "└─ " : "├─ "}${c.name} [${c.echelon}]`);
    if (c.children.length > 0) {
      lines.push(renderTree(c.children, prefix + (isLast ? "   " : "│  ")));
    }
  });
  return lines.join("\n");
}

/** Walk the DOCTRINE chain to find the deepest echelon generated */
function getLeafEchelon(echelon: EchelonLevel): EchelonLevel {
  const DOCTRINE_CHILD: Partial<Record<EchelonLevel, EchelonLevel>> = {
    theatre: "army",
    armyGroup: "corps",
    army: "corps",
    corps: "division",
    division: "brigade",
    brigade: "battalion",
    regiment: "battalion",
    battalion: "company",
    company: "platoon",
    platoon: "section",
    section: "squad",
    squad: "team",
  };
  let cur = echelon;
  for (;;) {
    const child = DOCTRINE_CHILD[cur];
    if (!child) return cur;
    cur = child;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const DonorDetail: React.FC<{ donors: DonorScoreBreakdown[] }> = ({
  donors,
}) => {
  const [open, setOpen] = useState(false);
  if (donors.length === 0) return null;
  return (
    <div className="cgp-expand-wrap">
      <button className="orp-expand-btn" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Donor scoring
        <span className="orp-cand-count">
          {donors.length} candidate{donors.length !== 1 ? "s" : ""}
        </span>
      </button>
      {open && (
        <div className="orp-candidate-panel">
          <div className="orp-cand-section">
            <div className="orp-cand-section-title">
              Ranked donor candidates
            </div>
            {donors.map((d, i) => (
              <div
                key={i}
                className={`orp-cand-row${
                  i === 0 ? " orp-cand-row--winner" : ""
                }`}
              >
                <div className="orp-cand-row-header">
                  <span className="orp-cand-rank">#{i + 1}</span>
                  <span className="orp-cand-name">{d.donor.name}</span>
                  <span
                    className="orp-cand-echelon"
                    style={{ color: echelonColour(d.donor.echelon) }}
                  >
                    {d.donor.echelon}
                  </span>
                  <span
                    className={`orp-cand-score${
                      i === 0 ? " orp-cand-score--winner" : ""
                    }`}
                  >
                    {d.score} pts
                  </span>
                  {i === 0 && (
                    <span className="orp-cand-winner-badge">✓ selected</span>
                  )}
                </div>
                <div className="orp-cand-breakdown">
                  {d.breakdown.map((line, j) => (
                    <span
                      key={j}
                      className={`orp-cand-line${
                        line.startsWith("+") ? " pos" : ""
                      }`}
                    >
                      {line}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const TreePreview: React.FC<{ nodes: GeneratedUnit[] }> = ({ nodes }) => {
  const [open, setOpen] = useState(false);
  const tree = useMemo(() => renderTree(nodes), [nodes]);
  const total = countGenerated(nodes);
  return (
    <div className="cgp-expand-wrap">
      <button className="orp-expand-btn" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Preview tree ({total} unit{total !== 1 ? "s" : ""})
      </button>
      {open && <pre className="orp-tree-preview cgp-tree">{tree}</pre>}
    </div>
  );
};

// ─── Proposal card ────────────────────────────────────────────────────────────

interface CardProps {
  proposal: GenerationProposal;
  selected: boolean;
  onToggle: () => void;
  applying: boolean;
  applied: boolean;
  onApply: () => void;
}

const ProposalCard: React.FC<CardProps> = ({
  proposal,
  selected,
  onToggle,
  applying,
  applied,
  onApply,
}) => {
  const {
    targetUnit: unit,
    source,
    donor,
    donorScore,
    scoredDonors,
    children,
    treeScore,
    reason,
  } = proposal;
  const count = countGenerated(children);
  const colour = echelonColour(unit.echelon);
  const leaf = getLeafEchelon(unit.echelon);

  return (
    <div
      className={`cgp-card${selected ? " cgp-card--selected" : ""}${
        applied ? " cgp-card--applied" : ""
      }`}
    >
      {/* ── Header ── */}
      <div className="cgp-card-header">
        <button
          className="cgp-select-btn"
          onClick={onToggle}
          title="Toggle selection"
        >
          <span
            className={`cgp-select-dot${selected ? " cgp-select-dot--on" : ""}`}
          />
        </button>
        <span className="orp-unit-dot" style={{ background: colour }} />
        <strong className="cgp-unit-name">{unit.name}</strong>
        <span className="orp-proposal-echelon-tag">
          {ECHELON_LABELS[unit.echelon]}
        </span>

        {source === "clone" ? (
          <span className="cgp-badge cgp-badge--clone">⎘ Clone</span>
        ) : (
          <span className="cgp-badge cgp-badge--synth">⚙ Synthetic</span>
        )}

        {source === "clone" && (
          <span className="orp-score-chip" title="Donor match score">
            {donorScore} pts
          </span>
        )}
        <span
          className="orp-score-chip"
          style={{ opacity: 0.7 }}
          title="Tree quality score"
        >
          tree {treeScore}
        </span>

        {/* Depth indicator */}
        <span className="cgp-depth-chip" title={`Generated down to ${leaf}`}>
          → {leaf}
        </span>
      </div>

      {/* ── Clone origin / synthetic note ── */}
      {source === "clone" && donor && (
        <div className="cgp-donor-row">
          <span className="cgp-donor-label">Copying from</span>
          <span
            className="orp-unit-dot"
            style={{ background: echelonColour(donor.echelon), marginLeft: 4 }}
          />
          <strong>{donor.name}</strong>
          <span className="orp-proposal-echelon-tag">{donor.echelon}</span>
          <span className="cgp-count-chip">{count} units</span>
        </div>
      )}
      {source === "synthetic" && (
        <div className="cgp-donor-row cgp-donor-row--synth">
          <span className="cgp-donor-label">
            Doctrine generation — no peer found
          </span>
          <span className="cgp-count-chip">{count} units</span>
        </div>
      )}

      <div className="cgp-reason">{reason}</div>

      {/* ── Expanders ── */}
      {children.length > 0 && <TreePreview nodes={children} />}
      {scoredDonors.length > 0 && <DonorDetail donors={scoredDonors} />}

      {/* ── Apply ── */}
      {children.length > 0 ? (
        <div className="cgp-card-apply">
          {applied && <span className="orp-applied-badge">✓ Applied</span>}
          <button
            className={`orp-apply-btn cgp-apply-btn${
              applying ? " running" : ""
            }${applied ? " applied" : ""}`}
            onClick={onApply}
            disabled={applying || applied}
          >
            {applying ? (
              <>
                <span className="orv-fix-spinner" />
                Generating…
              </>
            ) : applied ? (
              `↺ Applied (${count} units)`
            ) : (
              `+ Generate ${count} unit${count !== 1 ? "s" : ""}`
            )}
          </button>
        </div>
      ) : (
        <div className="orp-hint" style={{ fontSize: 11, padding: "4px 0 0" }}>
          ⚠ No doctrine entry for this echelon.
        </div>
      )}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const ChildGenerationPanel: React.FC<Props> = ({
  units,
  affiliation,
  onAddUnit,
}) => {
  const allFlat = useMemo(() => flattenTree(units), [units]);

  // ── Minimum echelon filter (default: show all echelons with a doctrine entry)
  const defaultMinEchelon: EchelonLevel = "team";
  const [minEchelon, setMinEchelon] = useState<EchelonLevel>(defaultMinEchelon);

  // All bare units that have a doctrine entry (so generation is possible)
  const allBare = useMemo(
    () =>
      allFlat.filter(
        (u) => u.children.length === 0 && DOCTRINE_ECHELONS.has(u.echelon)
      ),
    [allFlat]
  );

  // Apply the minimum echelon filter
  const bareFormations = useMemo(
    () =>
      allBare.filter(
        (u) => ECHELON_INDEX[u.echelon] >= ECHELON_INDEX[minEchelon]
      ),
    [allBare, minEchelon]
  );

  const proposals = useMemo(
    () =>
      computeChildGenerationProposals(
        bareFormations,
        units,
        affiliation ?? "unknown"
      ),
    [bareFormations, units, affiliation]
  );

  // IDs key used to reset selection when proposals meaningfully change
  const proposalKey = proposals.map((p) => p.targetUnit.id).join(",");

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(proposals.map((p) => p.targetUnit.id))
  );
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [bulkApplying, setBulkApplying] = useState(false);

  // Sync selection on proposal changes
  const prevKeyRef = React.useRef(proposalKey);
  if (prevKeyRef.current !== proposalKey) {
    prevKeyRef.current = proposalKey;
    setSelected(new Set(proposals.map((p) => p.targetUnit.id)));
    setApplied(new Set());
  }

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const applyOne = useCallback(
    async (proposal: GenerationProposal) => {
      const targetId = proposal.targetUnit.id;
      setApplying((prev) => new Set(prev).add(targetId));
      try {
        const idMap = new Map<string, string>();
        idMap.set(targetId, targetId);

        const ops = flattenGenerationOps(targetId, proposal.children);
        for (const op of ops) {
          const realParentId = idMap.get(op.parentId) ?? op.parentId;
          const result = (await onAddUnit(realParentId, op.input)) as
            | Record<string, unknown>
            | string
            | null;
          const realId: string | undefined =
            typeof result === "string"
              ? result
              : (result?.id as string | undefined);
          if (realId) idMap.set(op.generated.id, realId);
        }

        setApplied((prev) => new Set(prev).add(targetId));
      } finally {
        setApplying((prev) => {
          const n = new Set(prev);
          n.delete(targetId);
          return n;
        });
      }
    },
    [onAddUnit]
  );

  const applyAll = useCallback(async () => {
    const toApply = proposals.filter(
      (p) =>
        selected.has(p.targetUnit.id) &&
        !applied.has(p.targetUnit.id) &&
        p.children.length > 0
    );
    if (toApply.length === 0) return;
    setBulkApplying(true);
    for (const p of toApply) await applyOne(p);
    setBulkApplying(false);
  }, [proposals, selected, applied, applyOne]);

  const activeSelected = proposals.filter(
    (p) =>
      selected.has(p.targetUnit.id) &&
      !applied.has(p.targetUnit.id) &&
      p.children.length > 0
  );
  const totalUnits = activeSelected.reduce(
    (s, p) => s + countGenerated(p.children),
    0
  );

  // ── Available echelon filter options (only echelons that actually have bare units)
  const availableEchelons = useMemo(() => {
    const inAllBare = new Set(allBare.map((u) => u.echelon));
    return ECHELON_ORDER.filter(
      (e) => DOCTRINE_ECHELONS.has(e) && inAllBare.has(e)
    );
  }, [allBare]);

  // ── Empty state when nothing to generate ──────────────────────────────────
  if (allBare.length === 0) {
    return (
      <div className="cgp-panel">
        <div className="cgp-header">
          <span className="cgp-header-icon">⊕</span>
          <span className="cgp-header-title">Auto Child Generation</span>
        </div>
        <div className="orp-empty">
          <span style={{ fontSize: 24 }}>✓</span>
          <span>
            All units with doctrine entries already have children — nothing to
            generate.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="cgp-panel">
      {/* ── Header ── */}
      <div className="cgp-header">
        <span className="cgp-header-icon">⊕</span>
        <span className="cgp-header-title">Auto Child Generation</span>
      </div>

      <div className="orp-intro">
        Bare units are populated all the way down to the lowest doctrine-defined
        echelon (squad / team). The engine first clones the highest-scoring peer
        — extending shallower clones synthetically — then falls back to doctrine
        generation if no peer exists.
      </div>

      {/* ── Echelon filter ── */}
      {availableEchelons.length > 1 && (
        <div className="cgp-filter-bar">
          <span className="cgp-filter-label">Show from echelon:</span>
          {availableEchelons.map((e) => (
            <button
              key={e}
              className={`cgp-filter-btn${minEchelon === e ? " active" : ""}`}
              style={
                minEchelon === e
                  ? { borderColor: echelonColour(e), color: echelonColour(e) }
                  : {}
              }
              onClick={() => setMinEchelon(e)}
              title={ECHELON_LABELS[e]}
            >
              {e}
            </button>
          ))}
          <button
            className={`cgp-filter-btn${
              minEchelon === defaultMinEchelon ? " active" : ""
            }`}
            onClick={() => setMinEchelon(defaultMinEchelon)}
          >
            All
          </button>
        </div>
      )}

      {/* ── Bulk bar ── */}
      <div className="cgp-bulk-bar">
        <button
          className="orp-sel-btn"
          onClick={() =>
            setSelected(new Set(proposals.map((p) => p.targetUnit.id)))
          }
        >
          Select all ({proposals.length})
        </button>
        <button className="orp-sel-btn" onClick={() => setSelected(new Set())}>
          Clear
        </button>
        <div style={{ flex: 1 }} />
        {activeSelected.length > 0 && (
          <button
            className={`orp-apply-btn${bulkApplying ? " running" : ""}`}
            onClick={applyAll}
            disabled={bulkApplying}
          >
            {bulkApplying ? (
              <>
                <span className="orv-fix-spinner" />
                Generating…
              </>
            ) : (
              `⊕ Generate ${totalUnits} unit${
                totalUnits !== 1 ? "s" : ""
              } across ${activeSelected.length} formation${
                activeSelected.length !== 1 ? "s" : ""
              }`
            )}
          </button>
        )}
      </div>

      {/* ── Cards ── */}
      {bareFormations.length === 0 ? (
        <div className="orp-hint" style={{ textAlign: "center" }}>
          No bare units at or above <strong>{minEchelon}</strong> echelon.
        </div>
      ) : (
        <div className="cgp-cards">
          {proposals.map((p) => (
            <ProposalCard
              key={p.targetUnit.id}
              proposal={p}
              selected={selected.has(p.targetUnit.id)}
              onToggle={() => toggleSelect(p.targetUnit.id)}
              applying={applying.has(p.targetUnit.id)}
              applied={applied.has(p.targetUnit.id)}
              onApply={() => void applyOne(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
