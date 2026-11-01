// src/apps/scenarioPlanner/components/PhaseDetail/OrbatTab.tsx
//
// "ORBAT" tab — shows the force structure of the unit selected on the map.
//
// The tree here is the real ontology graph (NxgUnit + NxgUnitHierachyEdge)
// rooted at the placement, loaded by useUnitOrbat. Structural editing lives in
// the ORBAT Manager; this is the at-a-glance view plus the way in.

import type { CompositionNode } from "@/shared/types";
import { flattenOrbat } from "../../../../shared/orbat/loadOrbatSubtree";

export interface OrbatTabProps {
  /** Label of the unit selected on the map, if any. */
  unitLabel?: string;
  hasSelection: boolean;
  root: CompositionNode | null;
  nodeCount: number;
  truncated: boolean;
  loading: boolean;
  error: string | null;
  /**
   * True when `root` is the BASIC ORBAT derived from the unit's type rather
   * than a saved graph from the ontology.
   */
  isBasic?: boolean;
  /**
   * Set when the selected unit is one ORBATs don't apply to — ships and
   * satellites, while generation is land-only. This is information, not a
   * failure, so it renders ahead of loading/error and keeps the whole-scenario
   * links in view.
   */
  notApplicable?: string | null;
  /** Undefined when the selected unit has no ORBAT yet. */
  onOpenInOrbatManager?: () => void;
  /** Create an ORBAT for the selected unit (same action as the map menu). */
  onDefineOrbat?: () => void;
  /**
   * Open the whole-scenario ORBAT for a side. The overall Blue/Red ORBAT isn't
   * authored anywhere — it's the union of every unit ORBAT in the scenario —
   * so this is how you look at the joined picture.
   */
  onOpenScenarioOrbat?: (side: "blue" | "red") => void;
  /**
   * Re-derive the whole scenario hierarchy and write it in one action. The
   * reconciler runs automatically on placement and deletion; this is the
   * explicit repair path after a failure or an edit made elsewhere.
   */
  onRebuildHierarchy?: () => void;
  /** Result of the last rebuild or bulk generation this session. */
  rebuildStatus?: string | null;
  /** Land placements with no ORBAT yet — drives the bulk generate button. */
  missingOrbatCount?: number;
  /** True while a bulk generation is in flight. */
  generateBusy?: boolean;
  /** Generate an ORBAT for every land unit that hasn't got one, in one call. */
  onGenerateAllOrbats?: () => void;
  /** Units on the same side that could be this unit's parent. */
  parentOptions?: { unitKey: string; label: string }[];
  /** The parent in force right now — derived or overridden. */
  currentParentKey?: string | null;
  /** True when currentParentKey came from an explicit choice, not the rules. */
  parentIsOverride?: boolean;
  /** True when this unit is the top of its side and so has no parent. */
  isSideRoot?: boolean;
  /** Label for a unit key, for display. */
  parentLabelFor?: (unitKey: string) => string;
  /** Set (or clear, with null) the parent. */
  onChangeParent?: (parentUnitKey: string | null) => void;
  readOnly?: boolean;
}

function ScenarioOrbatLinks({
  onOpenScenarioOrbat,
  onRebuildHierarchy,
  rebuildStatus,
  missingOrbatCount = 0,
  generateBusy = false,
  onGenerateAllOrbats,
}: {
  onOpenScenarioOrbat: (side: "blue" | "red") => void;
  onRebuildHierarchy?: () => void;
  rebuildStatus?: string | null;
  missingOrbatCount?: number;
  generateBusy?: boolean;
  onGenerateAllOrbats?: () => void;
}) {
  return (
    <div className="sp-detail__section">
      <div className="sp-detail__section-header">
        <span className="sp-detail__section-icon" aria-hidden="true">⧉</span>
        Whole-scenario ORBAT
      </div>
      <p className="sp-orders-tab__end-state-hint">
        The overall friendly and enemy ORBATs are not authored — each side hangs
        from the most senior unit placed on it, with everything else organised
        beneath by echelon.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="sp-btn--outline sp-btn--sm"
          onClick={() => onOpenScenarioOrbat("blue")}
        >
          ↗ Blue Force
        </button>
        <button
          type="button"
          className="sp-btn--outline sp-btn--sm"
          onClick={() => onOpenScenarioOrbat("red")}
        >
          ↗ Red Force
        </button>
        {onGenerateAllOrbats && (
          <button
            type="button"
            className="sp-btn--primary sp-btn--sm"
            title="Write a basic ORBAT for every land unit that hasn't got one, and organise the force — a single ontology action."
            onClick={onGenerateAllOrbats}
            disabled={generateBusy}
          >
            {generateBusy
              ? "Generating…"
              : `✦ Generate ${missingOrbatCount} missing ORBAT${missingOrbatCount === 1 ? "" : "s"}`}
          </button>
        )}
        {onRebuildHierarchy && (
          <button
            type="button"
            className="sp-btn--outline sp-btn--sm"
            title="Re-derive the command structure from the units on the map and write it in one go."
            onClick={onRebuildHierarchy}
          >
            ⟳ Rebuild hierarchy
          </button>
        )}
      </div>
      {rebuildStatus && (
        <p className="sp-orders-tab__end-state-hint" role="status">
          {rebuildStatus}
        </p>
      )}
    </div>
  );
}

/**
 * "Reports to" — where this unit sits in the wider force.
 *
 * The derived answer is a default, not a ruling: echelon ranking has no way to
 * know that a coastal defence battery does not belong to an EW battalion just
 * because that battalion happens to be the nearest thing above it. One select
 * fixes it, and the choice survives a rebuild.
 */
function ParentPicker({
  parentOptions,
  currentParentKey,
  parentIsOverride,
  isSideRoot,
  parentLabelFor,
  onChangeParent,
}: {
  parentOptions: { unitKey: string; label: string }[];
  currentParentKey?: string | null;
  parentIsOverride?: boolean;
  isSideRoot?: boolean;
  parentLabelFor?: (unitKey: string) => string;
  onChangeParent: (parentUnitKey: string | null) => void;
}) {
  const label = (key: string) => parentLabelFor?.(key) ?? key;
  return (
    <div className="sp-detail__section">
      <div className="sp-detail__section-header">
        <span className="sp-detail__section-icon" aria-hidden="true">⤴</span>
        Reports to
      </div>

      {isSideRoot ? (
        <p className="sp-orders-tab__end-state-hint">
          This is the most senior unit on its side, so the rest of the force
          hangs beneath it. Give another unit a higher echelon and it takes over
          automatically.
        </p>
      ) : (
        <p className="sp-orders-tab__end-state-hint">
          {currentParentKey ? (
            <>
              Currently under <strong>{label(currentParentKey)}</strong>
              {parentIsOverride ? " — set by hand." : " — worked out from echelon."}
            </>
          ) : (
            "No parent yet."
          )}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          className="sp-input sp-input--sm"
          aria-label="Parent unit"
          value={parentIsOverride && currentParentKey ? currentParentKey : ""}
          onChange={(e) => onChangeParent(e.target.value === "" ? null : e.target.value)}
          disabled={parentOptions.length === 0}
        >
          <option value="">Automatic (by echelon)</option>
          {parentOptions.map((option) => (
            <option key={option.unitKey} value={option.unitKey}>
              {option.label}
            </option>
          ))}
        </select>
        {parentIsOverride && (
          <button
            type="button"
            className="sp-btn--outline sp-btn--sm"
            onClick={() => onChangeParent(null)}
          >
            Reset to automatic
          </button>
        )}
      </div>
    </div>
  );
}

function EchelonBadge({ echelon }: { echelon: string }) {
  if (!echelon) return null;
  return (
    <span
      style={{
        fontSize: 9,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "#8b95a8",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 3,
        padding: "1px 4px",
        flexShrink: 0,
      }}
    >
      {echelon}
    </span>
  );
}

export function OrbatTab({
  unitLabel,
  hasSelection,
  root,
  nodeCount,
  truncated,
  loading,
  error,
  isBasic = false,
  notApplicable,
  onOpenInOrbatManager,
  onDefineOrbat,
  onOpenScenarioOrbat,
  onRebuildHierarchy,
  rebuildStatus,
  missingOrbatCount = 0,
  generateBusy = false,
  onGenerateAllOrbats,
  parentOptions,
  currentParentKey,
  parentIsOverride,
  isSideRoot,
  parentLabelFor,
  onChangeParent,
  readOnly,
}: OrbatTabProps) {
  // ── Nothing selected ──────────────────────────────────────────────────────
  if (!hasSelection) {
    return (
      <div>
        <div className="sp-detail__empty">
          <span className="sp-detail__empty-icon" aria-hidden="true">🌳</span>
          <p className="sp-detail__empty-text">
            Select a unit on the map to see its ORBAT.
          </p>
        </div>
        {onOpenScenarioOrbat && (
          <ScenarioOrbatLinks
            onOpenScenarioOrbat={onOpenScenarioOrbat}
            onRebuildHierarchy={readOnly ? undefined : onRebuildHierarchy}
            rebuildStatus={rebuildStatus}
            missingOrbatCount={missingOrbatCount}
            generateBusy={generateBusy}
            onGenerateAllOrbats={readOnly ? undefined : onGenerateAllOrbats}
          />
        )}
      </div>
    );
  }

  // ── Selected unit is out of scope (ship, submarine, satellite) ────────────
  if (notApplicable) {
    return (
      <div>
        <div className="sp-detail__empty">
          <span className="sp-detail__empty-icon" aria-hidden="true">⚓</span>
          <p className="sp-detail__empty-text">{notApplicable}</p>
        </div>
        {onOpenScenarioOrbat && (
          <ScenarioOrbatLinks
            onOpenScenarioOrbat={onOpenScenarioOrbat}
            onRebuildHierarchy={readOnly ? undefined : onRebuildHierarchy}
            rebuildStatus={rebuildStatus}
            missingOrbatCount={missingOrbatCount}
            generateBusy={generateBusy}
            onGenerateAllOrbats={readOnly ? undefined : onGenerateAllOrbats}
          />
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="sp-detail__empty">
        <span className="sp-detail__empty-icon" aria-hidden="true">⏳</span>
        <p className="sp-detail__empty-text">Loading ORBAT…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sp-detail__section">
        <div className="sp-orders-tab__error" role="alert">⚠ {error}</div>
        {!readOnly && onDefineOrbat && (
          <button type="button" className="sp-btn--outline sp-btn--sm" onClick={onDefineOrbat}>
            Rebuild ORBAT
          </button>
        )}
      </div>
    );
  }

  const rows = root ? flattenOrbat(root) : [];

  return (
    <div>
      <div className="sp-detail__section">
        <div className="sp-detail__section-header">
          <span className="sp-detail__section-icon" aria-hidden="true">
            {isBasic ? "⚠️" : "🌳"}
          </span>
          {isBasic ? "Basic ORBAT" : "ORBAT"} ({nodeCount} unit{nodeCount !== 1 ? "s" : ""})
        </div>

        {isBasic && (
          <>
            <p className="sp-orders-tab__end-state-hint">
              <strong>{unitLabel}</strong> is using the <strong>basic ORBAT</strong>{" "}
              generated from its unit type, two levels deep — the yellow triangle on
              the map marks it. It is a working default and has not been saved to the
              ontology, so it won’t appear in the ORBAT Manager until you define and
              save a specific ORBAT.
            </p>
            {!readOnly && onDefineOrbat && (
              <button
                type="button"
                className="sp-btn--primary sp-btn--sm"
                onClick={onDefineOrbat}
                style={{ marginBottom: 8 }}
              >
                ✦ Define specific ORBAT…
              </button>
            )}
          </>
        )}

        {truncated && (
          <p className="sp-orders-tab__end-state-hint">
            Large ORBAT — only the first levels are shown here. Open it in the
            ORBAT Manager to see everything.
          </p>
        )}

        <div className="sp-orders-tab__list">
          {rows.map(({ node, depth }) => (
            <div
              key={node.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 6px",
                paddingLeft: 6 + depth * 16,
                borderLeft: depth > 0 ? "1px solid rgba(255,255,255,0.06)" : undefined,
                background: depth === 0 ? "rgba(255,255,255,0.04)" : undefined,
                borderRadius: 3,
              }}
            >
              <span
                aria-hidden="true"
                style={{ color: "var(--text-muted)", fontSize: 10, flexShrink: 0 }}
              >
                {depth === 0 ? "▣" : "└"}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: depth === 0 ? 700 : 400,
                  color: depth === 0 ? "#e0e4ec" : "#c8cdd8",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={node.unitIdentifier}
              >
                {node.unitIdentifier}
              </span>
              <span style={{ marginLeft: "auto" }}>
                <EchelonBadge echelon={node.echelon} />
              </span>
            </div>
          ))}
        </div>
      </div>

      {!readOnly && onChangeParent && root && (
        <ParentPicker
          parentOptions={parentOptions ?? []}
          currentParentKey={currentParentKey}
          parentIsOverride={parentIsOverride}
          isSideRoot={isSideRoot}
          parentLabelFor={parentLabelFor}
          onChangeParent={onChangeParent}
        />
      )}

      {onOpenInOrbatManager && (
        <div className="sp-detail__section">
          <p className="sp-orders-tab__end-state-hint">
            Structural changes — adding, removing or re-parenting subordinates —
            are made in the ORBAT Manager. It opens on this unit.
          </p>
          <button
            type="button"
            className="sp-btn--outline sp-btn--sm"
            onClick={onOpenInOrbatManager}
          >
            ↗ Open in ORBAT Manager
          </button>
        </div>
      )}

      {onOpenScenarioOrbat && (
        <ScenarioOrbatLinks
            onOpenScenarioOrbat={onOpenScenarioOrbat}
            onRebuildHierarchy={readOnly ? undefined : onRebuildHierarchy}
            rebuildStatus={rebuildStatus}
            missingOrbatCount={missingOrbatCount}
            generateBusy={generateBusy}
            onGenerateAllOrbats={readOnly ? undefined : onGenerateAllOrbats}
          />
      )}
    </div>
  );
}
