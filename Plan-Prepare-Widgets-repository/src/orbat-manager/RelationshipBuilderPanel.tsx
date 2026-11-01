// ============================================================
//  Relationship Builder Panel
//  Select a subset of flat/unstructured units, preview the
//  auto-computed hierarchy, then apply the re-parenting.
// ============================================================

import React, { useMemo, useState, useCallback } from "react";
import type { UnitNode } from "./types.js";
import { ECHELON_INDEX, ECHELON_LABELS } from "./types.js";
import { flattenTree } from "./treeUtils.js";
import { computeAutoRelationships, type RelationshipProposal, type ScoredCandidate } from "./autoRelationship.js";

interface Props {
  units: UnitNode[];
  onReorderUnit: (unitId: string, newParentId: string | null, position: number) => Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function echelonColour(echelon: UnitNode["echelon"]): string {
  const idx = ECHELON_INDEX[echelon];
  const colours = [
    "#98a1c0","#7dd3fc","#67e8f9","#6ee7b7","#86efac",
    "#fbbf24","#fb923c","#f87171","#c084fc","#e879f9",
    "#a78bfa","#60a5fa","#34d399",
  ];
  return colours[idx % colours.length];
}

function skipBadge(skipLevels: number) {
  if (skipLevels === 0) return <span className="orp-badge orp-badge--ok">✓ Adjacent</span>;
  if (skipLevels === 1) return <span className="orp-badge orp-badge--warn">⚠ One-skip (A-2)</span>;
  return <span className="orp-badge orp-badge--error">⚠ Two-skip (A-3)</span>;
}

function buildPreviewTree(proposals: RelationshipProposal[]): string {
  const children = new Map<string | null, UnitNode[]>();
  for (const p of proposals) {
    const parentId = p.parent?.id ?? null;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId)!.push(p.child);
  }
  for (const [, kids] of children) {
    kids.sort((a, b) => ECHELON_INDEX[b.echelon] - ECHELON_INDEX[a.echelon]);
  }
  const lines: string[] = [];
  function render(unit: UnitNode, prefix: string, isLast: boolean) {
    lines.push(`${prefix}${isLast ? "└─ " : "├─ "}${unit.name} [${unit.echelon}]`);
    const kids = children.get(unit.id) ?? [];
    kids.forEach((k, i) => render(k, prefix + (isLast ? "   " : "│  "), i === kids.length - 1));
  }
  const roots = (children.get(null) ?? []).sort(
    (a, b) => ECHELON_INDEX[b.echelon] - ECHELON_INDEX[a.echelon],
  );
  roots.forEach((r, i) => render(r, "", i === roots.length - 1));
  return lines.join("\n") || "(nothing to preview)";
}

// ─── Sub-component: Scored candidate list ────────────────────────────────────

const CandidateDetail: React.FC<{
  candidates: ScoredCandidate[];
  eliminations: RelationshipProposal["eliminations"];
}> = ({ candidates, eliminations }) => {
  const [open, setOpen] = useState(false);
  if (candidates.length === 0 && eliminations.length === 0) return null;

  return (
    <div className="orp-candidate-detail">
      <button className="orp-expand-btn" onClick={() => setOpen(o => !o)}>
        {open ? "▾" : "▸"} Scoring detail
        {candidates.length > 0 && (
          <span className="orp-cand-count">
            {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
            {eliminations.length > 0 ? `, ${eliminations.length} eliminated` : ""}
          </span>
        )}
      </button>

      {open && (
        <div className="orp-candidate-panel">
          {/* Surviving candidates ranked by score */}
          {candidates.length > 0 && (
            <div className="orp-cand-section">
              <div className="orp-cand-section-title">Ranked candidates</div>
              {candidates.map((c, i) => (
                <div key={i} className={`orp-cand-row${c.isBest ? " orp-cand-row--winner" : ""}`}>
                  <div className="orp-cand-row-header">
                    <span className="orp-cand-rank">#{i + 1}</span>
                    <span className="orp-cand-name">{c.parent.name}</span>
                    <span className="orp-cand-echelon" style={{ color: echelonColour(c.parent.echelon) }}>
                      {c.parent.echelon}
                    </span>
                    <span className={`orp-cand-score${c.isBest ? " orp-cand-score--winner" : ""}`}>
                      {c.score} pts
                    </span>
                    {c.isBest && <span className="orp-cand-winner-badge">✓ selected</span>}
                  </div>
                  <div className="orp-cand-breakdown">
                    {c.breakdown.map((line, j) => (
                      <span key={j} className={`orp-cand-line${line.startsWith("+") ? " pos" : line.startsWith("−") || line.startsWith("-") ? " neg" : ""}`}>
                        {line}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Eliminated candidates */}
          {eliminations.length > 0 && (
            <div className="orp-cand-section orp-cand-section--elim">
              <div className="orp-cand-section-title">Eliminated by hard rules</div>
              {eliminations.map((e, i) => (
                <div key={i} className="orp-cand-row orp-cand-row--elim">
                  <div className="orp-cand-row-header">
                    <span className="orp-elim-rule">{e.rule}</span>
                    <span className="orp-cand-name">{e.candidateName}</span>
                  </div>
                  <div className="orp-elim-reason">{e.reason}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const RelationshipBuilderPanel: React.FC<Props> = ({ units, onReorderUnit }) => {
  const allFlat = useMemo(() => flattenTree(units), [units]);

  const [selected,  setSelected]  = useState<Set<string>>(new Set());
  const [applying,  setApplying]  = useState(false);
  const [applied,   setApplied]   = useState(false);
  const [showTree,  setShowTree]  = useState(false);

  const displayList = useMemo(
    () => [...allFlat].sort(
      (a, b) => ECHELON_INDEX[b.echelon] - ECHELON_INDEX[a.echelon] || a.name.localeCompare(b.name),
    ),
    [allFlat],
  );

  const selectedUnits = useMemo(
    () => allFlat.filter(u => selected.has(u.id)),
    [allFlat, selected],
  );

  const proposals = useMemo(
    () => computeAutoRelationships(selectedUnits, units),
    [selectedUnits, units],
  );

  const activeProposals = useMemo(
    () => proposals.filter(p => p.parent !== null),
    [proposals],
  );

  const previewTree = useMemo(
    () => showTree ? buildPreviewTree(proposals) : "",
    [proposals, showTree],
  );

  const toggleUnit = useCallback((id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) { n.delete(id); } else { n.add(id); }
      return n;
    });
    setApplied(false);
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(allFlat.map(u => u.id)));
    setApplied(false);
  }, [allFlat]);

  const clearAll = useCallback(() => {
    setSelected(new Set());
    setApplied(false);
  }, []);

  const applyRelationships = useCallback(async () => {
    if (activeProposals.length === 0) return;
    setApplying(true);
    try {
      for (const p of activeProposals) {
        await onReorderUnit(p.child.id, p.parent!.id, 0);
      }
      setApplied(true);
    } finally {
      setApplying(false);
    }
  }, [activeProposals, onReorderUnit]);

  const noSelection = selected.size === 0;
  const tooFew      = selected.size === 1;
  const noProposals = activeProposals.length === 0 && !noSelection && !tooFew;

  return (
    <div className="orp-panel">
      {/* ── Header ── */}
      <div className="orp-header">
        <span className="orp-header-icon">⎇</span>
        <span className="orp-header-title">Auto-Relationship Builder</span>
      </div>

      <div className="orp-intro">
        Select the units you want to structure automatically. The engine
        eliminates candidates that break hard rules, then ranks surviving
        options by points — highest score wins. Expand the scoring detail
        on any proposal to see the full ranked list and eliminations.
      </div>

      {/* ── Unit selection ── */}
      <div className="orp-section-label">
        <span>Select units</span>
        <div className="orp-sel-actions">
          <button className="orp-sel-btn" onClick={selectAll}>Select all ({allFlat.length})</button>
          <button className="orp-sel-btn" onClick={clearAll}>Clear</button>
        </div>
      </div>

      <div className="orp-unit-list">
        {displayList.map(unit => {
          const isSel = selected.has(unit.id);
          const colour = echelonColour(unit.echelon);
          return (
            <button
              key={unit.id}
              className={`orp-unit-row${isSel ? " selected" : ""}`}
              onClick={() => toggleUnit(unit.id)}
            >
              <span className="orp-unit-dot" style={{ background: colour }} />
              <span className="orp-unit-name">{unit.name}</span>
              <span className="orp-unit-echelon" style={{ color: colour }}>
                {ECHELON_LABELS[unit.echelon]}
              </span>
              <span className="orp-unit-pax">{unit.personnelCount > 0 ? `${unit.personnelCount} pax` : ""}</span>
              <span className={`orp-unit-check${isSel ? " checked" : ""}`}>{isSel ? "✓" : ""}</span>
            </button>
          );
        })}
      </div>

      {/* ── Proposals ── */}
      {!noSelection && !tooFew && (
        <div className="orp-preview-section">
          <div className="orp-section-label">
            <span>
              Proposed structure&nbsp;
              <span className="orp-count-chip">
                {activeProposals.length} re-parent{activeProposals.length !== 1 ? "s" : ""}
              </span>
            </span>
            <button className="orp-sel-btn" onClick={() => setShowTree(t => !t)}>
              {showTree ? "Hide tree" : "Show tree"}
            </button>
          </div>

          {showTree && <pre className="orp-tree-preview">{previewTree}</pre>}

          <div className="orp-proposals">
            {proposals.map((p, i) => (
              <div key={i} className={`orp-proposal${p.parent ? "" : " orp-proposal--root"}`}>
                <div className="orp-proposal-arrow">
                  {p.parent
                    ? <span className="orp-arrow-icon">↳</span>
                    : <span className="orp-root-icon">⊙</span>}
                </div>
                <div className="orp-proposal-body">
                  {/* Child unit */}
                  <div className="orp-proposal-child">
                    <span className="orp-proposal-echelon-dot" style={{ background: echelonColour(p.child.echelon) }} />
                    <strong>{p.child.name}</strong>
                    <span className="orp-proposal-echelon-tag">{p.child.echelon}</span>
                    {/* Unit priority score chip */}
                    {p.score > 0 && (
                      <span className="orp-score-chip" title="Points score of winning candidate">
                        {p.score} pts
                      </span>
                    )}
                  </div>

                  {/* Parent */}
                  {p.parent && (
                    <div className="orp-proposal-parent-row">
                      under
                      <span className="orp-proposal-echelon-dot" style={{ background: echelonColour(p.parent.echelon), marginLeft: 6 }} />
                      <strong>{p.parent.name}</strong>
                      <span className="orp-proposal-echelon-tag">{p.parent.echelon}</span>
                    </div>
                  )}

                  {/* Skip badge + summary reason */}
                  <div className="orp-proposal-reason">
                    {skipBadge(p.skipLevels)}
                    <span className="orp-reason-text">{p.reason}</span>
                  </div>

                  {/* Expandable scoring detail */}
                  <CandidateDetail
                    candidates={p.candidates}
                    eliminations={p.eliminations}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty states ── */}
      {noSelection && (
        <div className="orp-hint">
          <span style={{ fontSize: 20 }}>☝</span>
          Select two or more units above to preview automatic placement.
        </div>
      )}
      {tooFew && (
        <div className="orp-hint">
          <span style={{ fontSize: 18 }}>⚠</span>
          Select at least two units to compute relationships.
        </div>
      )}
      {noProposals && (
        <div className="orp-hint">
          <span style={{ fontSize: 18 }}>✓</span>
          All selected units are already at the same echelon — no re-parenting needed.
        </div>
      )}

      {/* ── Apply ── */}
      {activeProposals.length > 0 && (
        <div className="orp-apply-bar">
          {applied && <span className="orp-applied-badge">✓ Applied successfully</span>}
          <button
            className={`orp-apply-btn${applying ? " running" : ""}${applied ? " applied" : ""}`}
            onClick={applyRelationships}
            disabled={applying}
          >
            {applying ? (
              <><span className="orv-fix-spinner" />Applying…</>
            ) : applied ? (
              <>↺ Re-apply ({activeProposals.length} moves)</>
            ) : (
              <>⎇ Apply {activeProposals.length} relationship{activeProposals.length !== 1 ? "s" : ""}</>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
