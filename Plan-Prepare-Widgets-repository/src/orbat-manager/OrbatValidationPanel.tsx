// ============================================================
//  ORBAT Validation Panel
//  Shows rule violations with severity filters, auto-fix buttons,
//  and dismiss support.
// ============================================================

import React, {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import type { UnitNode, StandardIdentity } from "./types.js";
import {
  validateOrbat,
  countBySeverity,
  countAutoFixable,
  getFixPriority,
  fixTouchedFields,
  type RuleViolation,
  type RuleSeverity,
} from "./orbatRules.js";
import { RelationshipBuilderPanel } from "./RelationshipBuilderPanel.js";
import { ChildGenerationPanel } from "./ChildGenerationPanel.js";
import { CseValidationTab } from "./CseValidationTab.js";

type PanelTab = "violations" | "relationships" | "childGen" | "cse";

interface Props {
  units: UnitNode[];
  affiliation: StandardIdentity;
  /** Called once per unit that needs updating after an auto-fix */
  onUpdateUnit: (unitId: string, patch: Partial<UnitNode>) => Promise<void>;
  /** Called to move a unit under a new parent */
  onReorderUnit: (
    unitId: string,
    newParentId: string | null,
    position: number
  ) => Promise<void>;
  /** Create a child unit; must return the created UnitNode (or its id) */
  onAddUnit: (
    parentId: string | null,
    input: Record<string, unknown>
  ) => Promise<unknown>;
  /**
   * Free-text name of the project/side being validated — passed straight
   * through to the CSE compute-module function as its `projectName` argument.
   */
  projectName?: string;
  /**
   * Pre-built SWORD-shaped ORBAT payload supplied by Workshop.  When present,
   * the CSE Validate tab feeds it verbatim into `cse_validate_orbat` instead
   * of building its own representation from the widget tree.  This is the
   * primary code path — Workshop calls the operation→SWORD helper function
   * and hands the result back to the widget through this parameter.
   */
  validationPayload?: string;
  /**
   * Called once with the raw response string every time the CSE Validate
   * tab finishes a run.  Forwarded up to the root widget so it can emit
   * `onValidationCompleted` to Workshop.
   */
  onValidationCompleted?: (rawResult: string) => void;
}

// ─── Colours ─────────────────────────────────────────────────────────────────

const SEV_COLOUR: Record<RuleSeverity, string> = {
  ERROR: "#ef4d4d",
  WARNING: "#d9822b",
  INFO: "#5b8bf7",
};
const SEV_BG: Record<RuleSeverity, string> = {
  ERROR: "rgba(231,106,110,0.12)",
  WARNING: "rgba(217,130,43,0.12)",
  INFO: "rgba(76,144,240,0.12)",
};
const SEV_ICON: Record<RuleSeverity, string> = {
  ERROR: "⛔",
  WARNING: "⚠",
  INFO: "ℹ",
};

// ─── ViolationRow subcomponent ───────────────────────────────────────────────

interface RowProps {
  v: RuleViolation;
  isExpanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onFix: () => void;
  fixing: boolean;
}

const ViolationRow: React.FC<RowProps> = ({
  v,
  isExpanded,
  onToggle,
  onDismiss,
  onFix,
  fixing,
}) => {
  const color = SEV_COLOUR[v.severity];
  const bg = SEV_BG[v.severity];
  const canFix = !!v.autoFix && !v.dismissed;

  return (
    <div
      className={`orv-item${v.dismissed ? " dismissed" : ""}${
        canFix ? " fixable" : ""
      }`}
      style={{ borderLeftColor: v.dismissed ? "var(--mil-border-lt)" : color }}
    >
      {/* ── Main row ── */}
      <div className="orv-item-row-wrap">
        <button className="orv-item-row" onClick={onToggle}>
          <span className="orv-item-badge" style={{ background: bg, color }}>
            {v.code}
          </span>
          <span
            className="orv-item-sev"
            style={{ color: v.dismissed ? "var(--mil-muted)" : color }}
          >
            {SEV_ICON[v.severity]}
          </span>
          <span
            className={`orv-item-msg${
              v.dismissed ? " orv-item-msg--dismissed" : ""
            }`}
          >
            {v.message}
          </span>
          <span className="orv-item-chevron">{isExpanded ? "▲" : "▼"}</span>
        </button>

        {/* Auto-fix pill — only shown when fix is available */}
        {canFix && (
          <button
            className={`orv-fix-pill${fixing ? " orv-fix-pill--running" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onFix();
            }}
            disabled={fixing}
            title={v.autoFix!.description}
          >
            {fixing ? (
              <>
                <span className="orv-fix-spinner" />
                Fixing…
              </>
            ) : (
              <>⚡ Fix</>
            )}
          </button>
        )}
      </div>

      {/* ── Expanded detail ── */}
      {isExpanded && (
        <div className="orv-item-detail">
          <p className="orv-item-detail-text">{v.detail}</p>

          {/* Auto-fix description box */}
          {v.autoFix && !v.dismissed && (
            <div className="orv-fix-box">
              <div className="orv-fix-box-title">🔧 Auto-fix available</div>
              <div className="orv-fix-box-desc">{v.autoFix.description}</div>
              <button
                className={`orv-fix-box-btn${fixing ? " running" : ""}`}
                onClick={onFix}
                disabled={fixing}
              >
                {fixing ? (
                  <>
                    <span className="orv-fix-spinner" />
                    Applying fix…
                  </>
                ) : (
                  <>⚡ {v.autoFix.label}</>
                )}
              </button>
            </div>
          )}

          {/* Manual-fix note when no autoFix */}
          {!v.autoFix && !v.dismissed && (
            <div className="orv-manual-box">
              <span className="orv-manual-box-icon">✏️</span>
              <span className="orv-manual-box-text">
                Requires manual correction in the unit editor.
              </span>
            </div>
          )}

          <div className="orv-item-detail-units">
            {v.unitNames.map((name, i) => (
              <span key={i} className="orv-item-unit-chip">
                {name}
              </span>
            ))}
          </div>
          <div className="orv-item-detail-actions">
            <button className="orv-dismiss-btn" onClick={onDismiss}>
              {v.dismissed ? "↩ Undismiss" : "✓ Dismiss (intentional)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const OrbatValidationPanel: React.FC<Props> = ({
  units,
  affiliation,
  onUpdateUnit,
  onReorderUnit,
  onAddUnit,
  projectName,
  validationPayload,
  onValidationCompleted,
}) => {
  const [activeTab, setActiveTab] = useState<PanelTab>("violations");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState<Set<string>>(new Set());
  const [filterSev, setFilterSev] = useState<RuleSeverity | "ALL">("ALL");
  const [showDismissed, setShowDismissed] = useState(false);

  const allViolations = useMemo(
    () => validateOrbat(units, affiliation, dismissed),
    [units, affiliation, dismissed]
  );

  // Keep a live ref to the current violations so applyAllFixes can re-read
  // them on each pass after onUpdateUnit resolves (state flushes into `units`,
  // which triggers a fresh useMemo — the ref catches the latest snapshot).
  const violationsRef = useRef(allViolations);
  useEffect(() => {
    violationsRef.current = allViolations;
  }, [allViolations]);

  const counts = useMemo(() => countBySeverity(allViolations), [allViolations]);
  const fixableCount = useMemo(
    () => countAutoFixable(allViolations),
    [allViolations]
  );

  const visible = useMemo(
    () =>
      allViolations.filter((v) => {
        if (!showDismissed && v.dismissed) return false;
        if (filterSev !== "ALL" && v.severity !== filterSev) return false;
        return true;
      }),
    [allViolations, filterSev, showDismissed]
  );

  const vKey = (v: RuleViolation) => `${v.code}:${v.unitIds.join(",")}`;

  const dismiss = useCallback((v: RuleViolation) => {
    const key = vKey(v);
    setDismissed((prev) => {
      const n = new Set(prev);
      if (n.has(key)) {
        n.delete(key);
      } else {
        n.add(key);
      }
      return n;
    });
  }, []);

  const toggleExpand = useCallback((v: RuleViolation) => {
    const key = vKey(v);
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) {
        n.delete(key);
      } else {
        n.add(key);
      }
      return n;
    });
  }, []);

  const applyFix = useCallback(
    async (v: RuleViolation) => {
      if (!v.autoFix) return;
      const key = vKey(v);
      setFixing((prev) => new Set(prev).add(key));
      try {
        const patches = v.autoFix.apply();
        await Promise.all(
          patches.map(({ unitId, patch }) => onUpdateUnit(unitId, patch))
        );
      } finally {
        setFixing((prev) => {
          const n = new Set(prev);
          n.delete(key);
          return n;
        });
      }
    },
    [onUpdateUnit]
  );

  const applyAllFixes = useCallback(async () => {
    // ─────────────────────────────────────────────────────────────────────
    //  Iterative Fix-All with Priority-Based Conflict Resolution
    //  --------------------------------------------------------------------
    //  Each pass:
    //    1. Read live violations from `violationsRef`.
    //    2. Group fixable violations by unitId.
    //    3. Within each unit's group, resolve conflicts:
    //         • Sort by priority (highest first).
    //         • Include a fix only if its touched-field set does NOT
    //           intersect with any already-included higher-priority fix's
    //           field set for that unit.
    //         • This lets non-conflicting fixes on the same unit merge
    //           (e.g. E-1 sets standardIdentity + G-2 sets pax → both apply),
    //           but blocks lower-priority conflicts (e.g. A-1 wants
    //           echelon=platoon, G-3-high wants echelon=battalion → A-1 wins).
    //    4. Apply chosen patches per unit in parallel.
    //    5. Yield to event loop → React flushes state → violationsRef updates.
    //    6. Compare fingerprints of the fixable set:
    //         • Empty → done.
    //         • Same as a previous pass → oscillation → stop.
    //         • Otherwise → next pass.
    //
    //  Safeguards:
    //    • MAX_PASSES hard cap.
    //    • Fingerprint history for oscillation detection.
    //    • Priority resolution keeps the *most-authoritative* fix per unit.
    // ─────────────────────────────────────────────────────────────────────

    const MAX_PASSES = 20;

    const keyOf = (v: RuleViolation) => vKey(v);
    const fingerprint = (vs: RuleViolation[]) => vs.map(keyOf).sort().join("|");

    const allTouchedKeys = new Set<string>();
    const seenFingerprints = new Set<string>();

    const RUNNING_KEY = "__fix_all_running__";
    setFixing((prev) => new Set(prev).add(RUNNING_KEY));

    try {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        const current = violationsRef.current;
        const fixable = current.filter((v) => !v.dismissed && v.autoFix);
        if (fixable.length === 0) break;

        // Oscillation guard
        const fp = fingerprint(fixable);
        if (seenFingerprints.has(fp)) {
          console.warn(
            `[Orbat Fix-All] Oscillation detected on pass ${pass + 1} — ` +
              `${fixable.length} remaining violation(s) form a fix loop. Stopping.`
          );
          break;
        }
        seenFingerprints.add(fp);

        // ─── Step 1: Group fixes by primary unitId ─────────────────────
        // A fix's primary unit is the FIRST id in unitIds — that's the unit
        // the patch actually writes to. (Some violations reference 2 units
        // for context, but the patch only mutates one.)
        const byUnit = new Map<string, RuleViolation[]>();
        for (const v of fixable) {
          const unitId = v.unitIds[0];
          if (!unitId) continue;
          const arr = byUnit.get(unitId) ?? [];
          arr.push(v);
          byUnit.set(unitId, arr);
        }

        // ─── Step 2: For each unit, resolve conflicts by priority ──────
        const chosenForPass: RuleViolation[] = [];
        const droppedForPass: Array<{
          dropped: RuleViolation;
          winner: RuleViolation;
        }> = [];
        for (const [, unitViolations] of byUnit) {
          // Sort by priority descending — highest first
          const sorted = unitViolations
            .slice()
            .sort((a, b) => getFixPriority(b) - getFixPriority(a));

          const takenFields = new Set<string>();
          for (const v of sorted) {
            const touched = fixTouchedFields(v);
            let conflict: RuleViolation | undefined;
            for (const f of touched) {
              if (takenFields.has(f)) {
                // Find whichever already-chosen violation claimed it
                conflict = chosenForPass.find(
                  (c) =>
                    c.unitIds[0] === v.unitIds[0] && fixTouchedFields(c).has(f)
                );
                break;
              }
            }
            if (conflict) {
              droppedForPass.push({ dropped: v, winner: conflict });
            } else {
              chosenForPass.push(v);
              for (const f of touched) takenFields.add(f);
            }
          }
        }

        if (droppedForPass.length > 0) {
          console.debug(
            `[Orbat Fix-All] Pass ${pass + 1}: dropped ${
              droppedForPass.length
            } lower-priority fix(es) due to conflict:\n` +
              droppedForPass
                .map(
                  ({ dropped, winner }) =>
                    `  • ${dropped.code} ("${dropped.message.slice(
                      0,
                      60
                    )}") yielded to ${winner.code}`
                )
                .join("\n")
          );
        }

        // ─── Step 3: Merge patches per unit and dispatch ───────────────
        const merged = new Map<string, Partial<UnitNode>>();
        for (const v of chosenForPass) {
          allTouchedKeys.add(keyOf(v));
          const patches = v.autoFix!.apply();
          for (const { unitId, patch } of patches) {
            const existing = merged.get(unitId) ?? {};
            merged.set(unitId, {
              ...existing,
              ...patch,
              symbol: patch.symbol
                ? { ...(existing.symbol ?? {}), ...patch.symbol }
                : existing.symbol,
            });
          }
        }

        // If everything was dropped due to conflicts, and nothing new is
        // available, the remaining violations aren't fixable this pass —
        // bail rather than spinning forever.
        if (merged.size === 0) {
          console.warn(
            `[Orbat Fix-All] Pass ${pass + 1}: all ${fixable.length} fixable ` +
              `violation(s) blocked by conflicts. Stopping.`
          );
          break;
        }

        setFixing((prev) => {
          const n = new Set(prev);
          allTouchedKeys.forEach((k) => n.add(k));
          return n;
        });

        await Promise.all(
          Array.from(merged.entries()).map(([unitId, patch]) =>
            onUpdateUnit(unitId, patch)
          )
        );

        // Yield so React can commit → re-memo → refresh violationsRef
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      setFixing((prev) => {
        const n = new Set(prev);
        n.delete(RUNNING_KEY);
        allTouchedKeys.forEach((k) => n.delete(k));
        return n;
      });
    }
  }, [onUpdateUnit]);

  const totalActive = counts.errors + counts.warnings + counts.info;
  const anyFixing = fixing.size > 0;

  return (
    <div className="orv-panel">
      {/* ── Tab bar ── */}
      <div className="orv-tab-bar">
        <button
          className={`orv-tab${activeTab === "violations" ? " active" : ""}`}
          onClick={() => setActiveTab("violations")}
        >
          <span>⚠</span>
          Violations
          {counts.errors + counts.warnings > 0 && (
            <span className="orv-tab-badge orv-tab-badge--error">
              {counts.errors + counts.warnings}
            </span>
          )}
        </button>
        <button
          className={`orv-tab${activeTab === "relationships" ? " active" : ""}`}
          onClick={() => setActiveTab("relationships")}
        >
          <span>⎇</span>
          Auto-Relationships
        </button>
        <button
          className={`orv-tab${activeTab === "childGen" ? " active" : ""}`}
          onClick={() => setActiveTab("childGen")}
        >
          <span>⊕</span>
          Generate Children
          {units.length > 0 &&
            (() => {
              const allFlat: UnitNode[] = [];
              const walk = (u: UnitNode) => {
                allFlat.push(u);
                u.children.forEach(walk);
              };
              units.forEach(walk);
              const bareCount = allFlat.filter(
                (u) =>
                  u.children.length === 0 &&
                  [
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
                  ].includes(u.echelon)
              ).length;
              return bareCount > 0 ? (
                <span className="orv-tab-badge orv-tab-badge--info">
                  {bareCount}
                </span>
              ) : null;
            })()}
        </button>
        <button
          className={`orv-tab${activeTab === "cse" ? " active" : ""}`}
          onClick={() => setActiveTab("cse")}
          title="Run the CSE compute-module validation against the current tree"
        >
          <span>◉</span>
          CSE Validate
        </button>
      </div>

      {/* ══ VIOLATIONS TAB ══ */}
      {activeTab === "violations" && (
        <>
          {/* ── Header ── */}
          <div className="orv-header">
            <span className="orv-header-title">Structure Validation</span>
            <div className="orv-summary-chips">
              <span className="orv-chip orv-chip--error">
                {counts.errors} E
              </span>
              <span className="orv-chip orv-chip--warn">
                {counts.warnings} W
              </span>
              <span className="orv-chip orv-chip--info">{counts.info} I</span>
            </div>
            {fixableCount > 0 && (
              <button
                className={`orv-fix-all-btn${anyFixing ? " running" : ""}`}
                onClick={applyAllFixes}
                disabled={anyFixing}
                title="Apply all available auto-fixes at once"
              >
                {anyFixing ? (
                  <>
                    <span className="orv-fix-spinner" />
                    Fixing all…
                  </>
                ) : (
                  <>⚡ Fix all ({fixableCount})</>
                )}
              </button>
            )}
          </div>

          {/* ── Filter bar ── */}
          <div className="orv-filter-bar">
            {(["ALL", "ERROR", "WARNING", "INFO"] as const).map((sev) => (
              <button
                key={sev}
                className={`orv-filter-btn${
                  filterSev === sev ? " active" : ""
                }`}
                style={
                  filterSev === sev && sev !== "ALL"
                    ? {
                        borderColor: SEV_COLOUR[sev as RuleSeverity],
                        color: SEV_COLOUR[sev as RuleSeverity],
                      }
                    : {}
                }
                onClick={() => setFilterSev(sev)}
              >
                {sev === "ALL"
                  ? `All (${totalActive})`
                  : `${SEV_ICON[sev as RuleSeverity]} ${
                      sev === "ERROR"
                        ? "Errors"
                        : sev === "WARNING"
                        ? "Warnings"
                        : "Info"
                    }`}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            {fixableCount > 0 && (
              <span className="orv-fixable-hint">
                ⚡ {fixableCount} auto-fixable
              </span>
            )}
            <button
              className="orv-filter-btn"
              onClick={() => setShowDismissed((d) => !d)}
              style={{ fontSize: 10 }}
            >
              {showDismissed
                ? "Hide dismissed"
                : `Show dismissed (${dismissed.size})`}
            </button>
          </div>

          {/* ── Empty state ── */}
          {visible.length === 0 && (
            <div className="orv-empty">
              {totalActive === 0 ? (
                <>
                  <span style={{ fontSize: 28 }}>✓</span>
                  <span>No violations — structure is valid</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 22 }}>🔍</span>
                  <span>No visible violations for this filter</span>
                </>
              )}
            </div>
          )}

          {/* ── Violation list ── */}
          <div className="orv-list">
            {visible.map((v) => {
              const key = vKey(v);
              return (
                <ViolationRow
                  key={key}
                  v={v}
                  isExpanded={expanded.has(key)}
                  onToggle={() => toggleExpand(v)}
                  onDismiss={() => dismiss(v)}
                  onFix={() => void applyFix(v)}
                  fixing={fixing.has(key)}
                />
              );
            })}
          </div>
        </>
      )}

      {/* ══ RELATIONSHIPS TAB ══ */}
      {activeTab === "relationships" && (
        <RelationshipBuilderPanel units={units} onReorderUnit={onReorderUnit} />
      )}

      {/* ══ CHILD GENERATION TAB ══ */}
      {activeTab === "childGen" && (
        <ChildGenerationPanel
          units={units}
          affiliation={affiliation}
          onAddUnit={onAddUnit}
        />
      )}

      {/* ══ CSE VALIDATION TAB ══ */}
      {activeTab === "cse" && (
        <CseValidationTab
          units={units}
          projectName={projectName ?? ""}
          validationPayload={validationPayload}
          onValidationCompleted={onValidationCompleted}
        />
      )}
    </div>
  );
};
