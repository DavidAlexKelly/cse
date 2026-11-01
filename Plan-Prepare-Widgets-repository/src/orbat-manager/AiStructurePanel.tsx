// ============================================================
//  AI Structure Generator Panel
// ============================================================

import React, { useState, useCallback, useMemo } from "react";
import { generateOrbat } from "@custom-widget/sdk";
import { client } from "../client.js";
import {
  COMMAND_REL_LABELS,
  COMMAND_REL_COLOUR,
  ECHELON_INDEX,
  type StandardIdentity,
  type UnitNode,
  type UnitIconType,
  type CommandRelationshipType,
} from "./types.js";
import {
  parseAiResponse,
  treeToAddOps,
  countAiUnits,
  totalAiPax,
  aiTreePreview,
  type OrbatAiResponse,
  type AiUnit,
  type AiSuggestedRelationship,
} from "./orbatAiSchema.js";
import { computeAutoRelationships } from "./autoRelationship.js";
import { NatoSymbol } from "./NatoSymbol.js";

// ─── Echelon colour ───────────────────────────────────────────────────────────

const ECHELON_COLOURS: Record<number, string> = {
  12: "#ef4d4d",
  11: "#ef4d4d",
  10: "#ef4d4d",
  9: "#e05252",
  8: "#d06020",
  7: "#c07820",
  6: "#f0a83c",
  5: "#f0a83c",
  4: "#40a060",
  3: "#2888b8",
  2: "#1a7a8a",
  1: "#1a6078",
  0: "#4a4a6a",
};
function echelonColour(echelon: AiUnit["echelon"]) {
  return ECHELON_COLOURS[ECHELON_INDEX[echelon]] ?? "#4a4a6a";
}

// ─── Relationship chip (non-organic only — organic is the visual default) ────
const RelChip: React.FC<{
  rel: CommandRelationshipType;
  compact?: boolean;
}> = ({ rel, compact }) => {
  const colour = COMMAND_REL_COLOUR[rel];
  return (
    <span
      title={COMMAND_REL_LABELS[rel]}
      style={{
        fontSize: compact ? 9 : 10,
        fontWeight: 700,
        color: colour.badge,
        background: colour.bg,
        border: `1px solid ${colour.badge}55`,
        borderRadius: 3,
        padding: compact ? "1px 4px" : "2px 5px",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        lineHeight: 1,
      }}
    >
      {rel}
    </span>
  );
};

// ─── Build a minimal flat UnitNode for the relationship engine ────────────────
// Crucially: children: [] — the engine needs a FLAT pool, not a nested tree.
// The tree hierarchy is already expressed by the BFS addUnit parent IDs.
// The engine scores all possible parent/child pairings from scratch.

function makeStubNode(
  id: string,
  aiUnit: AiUnit,
  aff: StandardIdentity
): UnitNode {
  return {
    id,
    name: aiUnit.name,
    echelon: aiUnit.echelon,
    personnelCount: aiUnit.personnelCount,
    notes: aiUnit.notes ?? "",
    symbol: {
      standardIdentity: aff,
      echelon: aiUnit.echelon,
      icon: aiUnit.icon as UnitIconType,
    },
    capabilities: {},
    customProperties: [],
    state: { status: "active", lastUpdated: new Date().toISOString() },
    weapons: [],
    assets: [],
    equipment: [],
    children: [], // flat — required by the engine
  };
}

// ─── Quick outline ────────────────────────────────────────────────────────────

const QuickOutline: React.FC<{ units: AiUnit[] }> = ({ units }) => {
  const rows: Array<{ unit: AiUnit; depth: number }> = [];
  units.forEach((root) => {
    rows.push({ unit: root, depth: 0 });
    root.children.forEach((child) => rows.push({ unit: child, depth: 1 }));
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "10px 12px",
        background: "rgba(192,132,252,0.05)",
        border: "1px solid rgba(192,132,252,0.2)",
        borderRadius: 4,
      }}
    >
      {rows.map((row, i) => {
        const rel = row.unit.relationshipType;
        const showRel = row.depth > 0 && rel && rel !== "ORGANIC";
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              paddingLeft: row.depth * 18,
              opacity: row.depth === 1 ? 0.85 : 1,
            }}
          >
            <NatoSymbol
              standardIdentity="friend"
              echelon={row.unit.echelon}
              icon={row.unit.icon as UnitIconType}
              size={row.depth === 0 ? 22 : 18}
              style={{ flexShrink: 0 }}
            />
            <span
              style={{
                fontSize: row.depth === 0 ? 13 : 11,
                fontWeight: row.depth === 0 ? 700 : 500,
                color: "var(--mil-text-1)",
                flex: 1,
              }}
            >
              {row.unit.name}
            </span>
            {showRel && <RelChip rel={rel!} compact />}
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: echelonColour(row.unit.echelon),
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {row.unit.echelon}
            </span>
            {row.unit.personnelCount > 0 && (
              <span style={{ fontSize: 10, color: "var(--mil-text-3)" }}>
                {row.unit.personnelCount} pax
              </span>
            )}
            {row.depth === 0 && row.unit.children.length > 0 && (
              <span
                style={{
                  fontSize: 9,
                  color: "var(--mil-text-3)",
                  fontStyle: "italic",
                }}
              >
                +{row.unit.children.length} sub-units
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ─── Full tree rows ───────────────────────────────────────────────────────────

const AiTreeRow: React.FC<{ unit: AiUnit; depth: number }> = ({
  unit,
  depth,
}) => {
  const rel = unit.relationshipType;
  const showRel = depth > 0 && rel && rel !== "ORGANIC";
  return (
    <>
      <div className="ais-tree-row" style={{ paddingLeft: depth * 16 }}>
        <NatoSymbol
          standardIdentity="friend"
          echelon={unit.echelon}
          icon={unit.icon as UnitIconType}
          size={22}
          style={{ flexShrink: 0 }}
        />
        <span className="ais-tree-name">{unit.name}</span>
        {showRel && <RelChip rel={rel!} compact />}
        <span
          className="ais-tree-echelon"
          style={{ color: echelonColour(unit.echelon) }}
        >
          {unit.echelon}
        </span>
        {unit.canonicalAssetId && (
          <span
            title={`Canonical asset: ${unit.canonicalAssetId}`}
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "var(--mil-text-3)",
              fontFamily: "var(--mil-mono, monospace)",
              background: "var(--mil-bg-2)",
              padding: "1px 4px",
              borderRadius: 3,
              maxWidth: 90,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {unit.canonicalAssetId}
          </span>
        )}
        {unit.personnelCount > 0 && (
          <span className="ais-tree-pax">{unit.personnelCount} pax</span>
        )}
      </div>
      {unit.children.map((c, i) => (
        <AiTreeRow key={i} unit={c} depth={depth + 1} />
      ))}
    </>
  );
};

// ─── Suggested relationships panel ────────────────────────────────────────────

const SuggestedRelationships: React.FC<{
  relationships: AiSuggestedRelationship[];
}> = ({ relationships }) => {
  if (relationships.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--mil-text-3)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ color: "#4ade80" }}>⤳</span>
        Suggested cross-tree relationships ({relationships.length})
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: "8px 10px",
          background: "rgba(74,222,128,0.04)",
          border: "1px solid rgba(74,222,128,0.18)",
          borderRadius: 4,
        }}
      >
        {relationships.map((r, i) => {
          const colour = COMMAND_REL_COLOUR[r.relationshipType];
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                padding: "6px 8px",
                background: "var(--mil-bg-2)",
                borderLeft: `2px solid ${colour.badge}`,
                borderRadius: 3,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--mil-text-1)",
                  }}
                >
                  {r.fromDesignation}
                </span>
                <span style={{ color: colour.badge, fontSize: 11 }}>→</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--mil-text-1)",
                  }}
                >
                  {r.toDesignation}
                </span>
                <RelChip rel={r.relationshipType} compact />
              </div>
              {r.description && (
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--mil-text-3)",
                    lineHeight: 1.4,
                  }}
                >
                  {r.description}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div
        style={{
          fontSize: 9,
          color: "var(--mil-text-3)",
          fontStyle: "italic",
          lineHeight: 1.4,
        }}
      >
        These annotations describe support / attachment relationships across the
        ORBAT. They are not applied to the tree automatically — each unit keeps
        the organic parent from the hierarchy above. Use the Relationships panel
        to formalise them after the build.
      </div>
    </div>
  );
};

// ─── Toggle ───────────────────────────────────────────────────────────────────

const Toggle: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, sublabel, disabled }) => (
  <label
    style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      cursor: disabled ? "default" : "pointer",
      padding: "8px 10px",
      background: checked ? "rgba(64,160,96,0.07)" : "var(--mil-bg-2)",
      border: `1px solid ${
        checked ? "rgba(64,160,96,0.35)" : "var(--mil-border-lt)"
      }`,
      borderRadius: 4,
      transition: "all 0.12s",
      opacity: disabled ? 0.55 : 1,
    }}
  >
    {/* Real checkbox — visually hidden but drives accessibility & label clicks. */}
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    />
    {/* Visual checkbox — purely presentational, clicks handled by the <label>. */}
    <span
      aria-hidden="true"
      style={{
        width: 16,
        height: 16,
        marginTop: 1,
        flexShrink: 0,
        border: `2px solid ${checked ? "#4ade80" : "var(--mil-border-lt)"}`,
        borderRadius: 3,
        background: checked ? "#4ade80" : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.1s",
      }}
    >
      {checked && (
        <span
          style={{
            fontSize: 10,
            color: "#fff",
            lineHeight: 1,
            fontWeight: 900,
          }}
        >
          ✓
        </span>
      )}
    </span>
    <span style={{ flex: 1 }}>
      <span
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--mil-text-1)",
        }}
      >
        {label}
      </span>
      {sublabel && (
        <span
          style={{
            display: "block",
            fontSize: 10,
            color: "var(--mil-text-3)",
            marginTop: 2,
            lineHeight: 1.45,
          }}
        >
          {sublabel}
        </span>
      )}
    </span>
  </label>
);

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  affiliation: StandardIdentity;
  onAddUnit: (
    parentId: string | null,
    input: Record<string, unknown>
  ) => Promise<unknown>;
  onReorderUnit: (
    unitId: string,
    newParentId: string | null,
    position: number
  ) => Promise<void>;
  /**
   * Optional — used by Phase 2 to apply the AI's suggested cross-tree
   * relationships by patching commandRelationshipType on each affected unit.
   * If not provided, the "apply suggested relationships" toggle is disabled.
   */
  onUpdateUnit?: (
    unitId: string,
    input: Record<string, unknown>
  ) => Promise<void>;
  onClose?: () => void;
}

type Stage =
  | "idle"
  | "loading"
  | "preview"
  | "confirmed"
  | "building"
  | "wiring"
  | "done";

export const AiStructurePanel: React.FC<Props> = ({
  affiliation,
  onAddUnit,
  onReorderUnit,
  onUpdateUnit,
  onClose,
}) => {
  const [prompt, setPrompt] = useState("");
  const [nationalityHint, setNationalityHint] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrbatAiResponse | null>(null);
  const [rawOutput, setRawOutput] = useState<string>("");
  const [showRaw, setShowRaw] = useState(false);
  const [showAscii, setShowAscii] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [buildTotal, setBuildTotal] = useState(0);
  const [wireProgress, setWireProgress] = useState(0);
  const [wireTotal, setWireTotal] = useState(0);

  // Toggle A — apply the AI's suggested cross-tree relationships (new schema).
  // These are the LLM's own SUPPORTCON / ATTACHED / OPCON annotations across
  // the organic tree.  Default ON when suggestions exist, because the whole
  // point of the new schema is to preserve them.
  const [applySuggestedRels, setApplySuggestedRels] = useState(true);

  // Toggle B — run the local scoring engine as a fallback / cleanup pass.
  // Default OFF now: the AI already picks a parent for every unit AND assigns
  // a relationship type, so we don't want a second engine second-guessing it
  // unless the user opts in.
  const [autoRelationships, setAutoRelationships] = useState(false);

  const asciiPreview = result ? aiTreePreview(result.units) : "";
  const totalUnits = result ? countAiUnits(result.units) : 0;
  const totalPax = result ? totalAiPax(result.units) : 0;

  const suggestedRelCount = result?.suggestedRelationships.length ?? 0;
  const canApplySuggested = !!onUpdateUnit && suggestedRelCount > 0;

  // Preview: how many additional relationship moves the engine would propose.
  // Uses TEMP ids (not real IDs) — just for the count shown in the button label.
  // Wrapped in try/catch so a scoring error never crashes the toggle.
  const relProposalCount = useMemo(() => {
    if (!result || !autoRelationships) return 0;
    try {
      const ops = treeToAddOps(result.units, affiliation);
      const nodes = ops.map((op) =>
        makeStubNode(op.tempId, op.unit, affiliation)
      );
      const proposals = computeAutoRelationships(nodes, nodes, affiliation);
      return proposals.filter((p) => p.parent !== null).length;
    } catch {
      return 0;
    }
  }, [result, autoRelationships, affiliation]);

  // ── Generate ───────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || stage === "loading") return;
    setStage("loading");
    setError(null);
    setResult(null);

    try {
      const raw = await client(generateOrbat).executeFunction({
        userDescription: prompt.trim(),
        ...(nationalityHint.trim()
          ? { nationalityHint: nationalityHint.trim() }
          : {}),
      });
      setRawOutput(raw);
      const parsed = parseAiResponse(raw);
      setResult(parsed);
      setStage("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("idle");
    }
  }, [prompt, nationalityHint, stage]);

  const handleConfirm = useCallback(() => setStage("confirmed"), []);

  const handleDiscard = useCallback(() => {
    setResult(null);
    setRawOutput("");
    setShowRaw(false);
    setShowAscii(false);
    // stay on "idle" — don't close or navigate away
    setStage("idle");
  }, []);

  // ── Build ──────────────────────────────────────────────────────────────────
  const handleBuild = useCallback(async () => {
    if (!result || stage === "building" || stage === "wiring") return;
    setStage("building");

    const ops = treeToAddOps(result.units, affiliation);
    setBuildTotal(ops.length);
    setBuildProgress(0);
    setWireTotal(0);
    setWireProgress(0);

    // tempId → real widget-store ID returned by addUnit resolver
    const idMap = new Map<string, string>();
    // real ID → AiUnit (needed to build stub nodes for the relationship engine)
    const realIdToAiUnit = new Map<string, AiUnit>();
    // designation (lowercased/trimmed) → real ID  — used for suggested-rel matching
    const designationToRealId = new Map<string, string>();

    // How many units failed to link back their real id.  Nonzero here means
    // Phase 1 silently disconnected the tree — every subsequent child was
    // inserted at root instead of under its parent.  Surface this as an error
    // instead of silently producing a flat list.
    let orphanedCount = 0;

    try {
      // ── Phase 1: create all units in BFS order ────────────────────────────
      //  addUnit input already carries the AI's per-node relationshipType
      //  (see treeToAddOps in orbatAiSchema.ts), so the organic tree is
      //  built with the correct NATO relationship on every child node.
      for (const op of ops) {
        const realParentId = op.parentTempId
          ? idMap.get(op.parentTempId) ?? null
          : null;

        // Guardrail: if this op has a parentTempId but we couldn't resolve it
        // to a real id, the host's onAddUnit isn't returning ids — bail out
        // with a clear error rather than producing a flat orphan tree.
        if (op.parentTempId && !realParentId) {
          orphanedCount++;
        }

        const created = (await onAddUnit(realParentId, op.input)) as
          | Record<string, unknown>
          | string
          | null;

        // The addUnit resolver returns the full UnitNode object; extract id.
        // Accept both { id: "…" } (canonical) and a bare string id.
        const realId: string | undefined =
          typeof created === "string"
            ? created
            : typeof (created as Record<string, unknown> | null)?.id ===
              "string"
            ? ((created as Record<string, unknown>).id as string)
            : undefined;

        if (realId) {
          idMap.set(op.tempId, realId);
          realIdToAiUnit.set(realId, op.unit);
          // Index by designation for later suggested-rel lookup.  If two
          // units share a designation (rare), the last one wins — but the
          // AI usually distinguishes them (e.g. "1st Plt (A)" vs "1st Plt (B)").
          const key = op.unit.name.trim().toLowerCase();
          if (key) designationToRealId.set(key, realId);
        }

        setBuildProgress((p) => p + 1);
      }

      // If more than a couple of nodes couldn't resolve a parent, the host's
      // onAddUnit almost certainly isn't returning ids.  Fail loudly so the
      // user knows why the resulting tree is flat.
      if (orphanedCount > 1) {
        throw new Error(
          `Built ${ops.length} units, but ${orphanedCount} could not be attached to ` +
            `their AI-specified parent (the host's addUnit resolver did not return an id). ` +
            `The tree may appear flat.  See the browser console for details.`
        );
      }

      // ── Phase 2a: apply the AI's suggested cross-tree relationships ───────
      //  For each suggested link, patch commandRelationshipType on the "from"
      //  unit.  These are additive annotations — we do NOT re-parent, because
      //  the organic tree from Phase 1 is the primary structure and the
      //  suggested relationships describe support that flows across it.
      //
      //  Matching strategy:  designation only.  The LLM emits the same string
      //  in `nodes[].designation` and in `suggestedRelationships[].fromDesignation`,
      //  so a case-insensitive match hits reliably even when the same
      //  canonicalAssetId is reused across multiple units (which the current
      //  schema allows).
      //
      //  Conflict rule: if a unit has both an organic parent-child relationship
      //  (from Phase 1) AND a suggested cross-tree relationship, the suggested
      //  one takes precedence — because it's the more specific statement about
      //  that unit's role.  This mirrors NATO doctrine where a unit's task-org
      //  relationship is what commanders care about, not its garrison home.
      if (applySuggestedRels && canApplySuggested && onUpdateUnit) {
        const patches: Array<{
          realId: string;
          rel: CommandRelationshipType;
          label: string;
        }> = [];
        for (const sr of result.suggestedRelationships) {
          const key = sr.fromDesignation.trim().toLowerCase();
          const realId = designationToRealId.get(key);
          if (!realId) continue; // "from" unit wasn't built (shouldn't happen)
          patches.push({
            realId,
            rel: sr.relationshipType,
            label: `${sr.fromDesignation} → ${sr.toDesignation}`,
          });
        }

        if (patches.length > 0) {
          setStage("wiring");
          setWireTotal(patches.length);
          setWireProgress(0);
          for (const patch of patches) {
            await onUpdateUnit(patch.realId, {
              commandRelationshipType: patch.rel,
            });
            setWireProgress((p) => p + 1);
          }
        }
      }

      // ── Phase 2b: local scoring-engine fallback (opt-in) ──────────────────
      //  Only runs when the user explicitly enables it — the AI already picks
      //  both parent and relationship type for every unit, so this is a
      //  cleanup pass that treats the AI structure as "candidate" material
      //  and lets the engine re-parent where it disagrees.  Not the default.
      if (autoRelationships && realIdToAiUnit.size > 1) {
        const stubNodes: UnitNode[] = [];
        for (const [realId, aiUnit] of realIdToAiUnit) {
          stubNodes.push(makeStubNode(realId, aiUnit, affiliation));
        }

        const proposals = computeAutoRelationships(
          stubNodes,
          stubNodes,
          affiliation
        );
        const moves = proposals.filter((p) => p.parent !== null);

        if (moves.length > 0) {
          setStage("wiring");
          setWireTotal((t) => t + moves.length);
          for (const proposal of moves) {
            await onReorderUnit(proposal.child.id, proposal.parent!.id, 0);
            setWireProgress((p) => p + 1);
          }
        }
      }

      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("confirmed");
    }
  }, [
    result,
    stage,
    affiliation,
    onAddUnit,
    onReorderUnit,
    onUpdateUnit,
    applySuggestedRels,
    canApplySuggested,
    autoRelationships,
  ]);
  const isLoading = stage === "loading";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="ais-panel">
      {/* Header */}
      <div className="ais-header">
        <span className="ais-header-icon">✦</span>
        <span className="ais-header-title">AI Structure Generator</span>
        {onClose && (
          <button className="ais-close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        )}
      </div>

      {/* Intro */}
      <div className="ais-intro">
        Describe the military structure you want in plain English. The AI will
        generate a doctrine-accurate ORBAT grounded in the project&apos;s
        Canonical Asset catalogue — you&apos;ll see a quick outline to review
        before anything is built.
      </div>

      {/* Prompt — always visible so user can re-generate from any stage */}
      {(stage === "idle" || stage === "loading") && (
        <div className="ais-input-group">
          <textarea
            className="ais-textarea"
            placeholder={
              "Examples:\n" +
              '• "British infantry battalion with 3 rifle companies"\n' +
              '• "US armoured brigade with 2 tank battalions and a mech infantry battalion"\n' +
              '• "French foreign legion company, section level detail"'
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            disabled={isLoading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                void handleGenerate();
            }}
          />

          <input
            className="ais-textarea"
            style={{
              minHeight: "unset",
              resize: "none",
              padding: "6px 10px",
              fontSize: 11,
            }}
            placeholder="Nationality hint (optional) — e.g. British, US, French…"
            value={nationalityHint}
            onChange={(e) => setNationalityHint(e.target.value)}
            disabled={isLoading}
          />

          <div className="ais-input-actions">
            <span className="ais-hint">Ctrl+Enter to generate</span>
            <button
              className={`ais-generate-btn${isLoading ? " loading" : ""}`}
              onClick={() => void handleGenerate()}
              disabled={isLoading || !prompt.trim()}
            >
              {isLoading ? (
                <>
                  <span className="ais-spinner" />
                  Generating…
                </>
              ) : (
                <>
                  <span>✦</span> Generate Structure
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="ais-error">
          <strong>Error:</strong> {error}
          <button
            onClick={() => setError(null)}
            style={{
              marginLeft: 8,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              fontSize: 11,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── STAGE: preview ── */}
      {stage === "preview" && result && (
        <div className="ais-result">
          <div className="ais-result-summary">
            <span className="ais-result-desc">{result.description}</span>
            <div className="ais-result-chips">
              <span className="ais-chip ais-chip--units">
                {totalUnits} units
              </span>
              <span className="ais-chip ais-chip--pax">
                {totalPax.toLocaleString()} pax
              </span>
            </div>
          </div>

          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--mil-text-3)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ color: "#c084fc" }}>◈</span> Quick outline — does
            this look right?
          </div>

          <QuickOutline units={result.units} />

          {result.suggestedRelationships.length > 0 && (
            <div
              style={{
                fontSize: 10,
                color: "var(--mil-text-3)",
                fontStyle: "italic",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ color: "#4ade80" }}>⤳</span>
              Plus {result.suggestedRelationships.length} suggested
              support/attachment relationship
              {result.suggestedRelationships.length === 1 ? "" : "s"} across the
              tree.
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="ais-build-btn"
              style={{ flex: 1 }}
              onClick={handleConfirm}
            >
              ✓ Looks good — show full detail
            </button>
            <button
              className="ais-generate-btn"
              style={{ flex: "none" }}
              onClick={handleDiscard}
            >
              ✕ Discard & retry
            </button>
          </div>
        </div>
      )}

      {/* ── STAGE: confirmed / building / wiring / done ── */}
      {(stage === "confirmed" ||
        stage === "building" ||
        stage === "wiring" ||
        stage === "done") &&
        result && (
          <div className="ais-result">
            {/* Summary */}
            <div className="ais-result-summary">
              <span className="ais-result-desc">{result.description}</span>
              <div className="ais-result-chips">
                <span className="ais-chip ais-chip--units">
                  {totalUnits} units
                </span>
                <span className="ais-chip ais-chip--pax">
                  {totalPax.toLocaleString()} pax
                </span>
              </div>
            </div>

            {/* Tree header */}
            <div className="ais-tree-header">
              <span className="ais-tree-label">Full structure</span>
              <button
                className="orp-expand-btn"
                onClick={() => setShowAscii((a) => !a)}
              >
                {showAscii ? "▾ Hide ASCII" : "▸ ASCII tree"}
              </button>
              <button
                className="orp-expand-btn"
                onClick={() => setShowRaw((r) => !r)}
              >
                {showRaw ? "▾ Hide raw" : "▸ Raw JSON"}
              </button>
            </div>

            <div className="ais-tree">
              {result.units.map((u, i) => (
                <AiTreeRow key={i} unit={u} depth={0} />
              ))}
            </div>

            {showAscii && (
              <pre className="orp-tree-preview ais-ascii">{asciiPreview}</pre>
            )}
            {showRaw && (
              <pre className="orp-tree-preview ais-raw">{rawOutput}</pre>
            )}

            {/* Suggested cross-tree relationships (new schema) */}
            <SuggestedRelationships
              relationships={result.suggestedRelationships}
            />

            {/* Build options — only before build starts */}
            {stage === "confirmed" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--mil-text-3)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>⚙</span> Build options
                </div>
                <Toggle
                  checked={applySuggestedRels && canApplySuggested}
                  onChange={setApplySuggestedRels}
                  disabled={!canApplySuggested}
                  label="Apply AI's cross-tree relationships"
                  sublabel={
                    !onUpdateUnit
                      ? "Unavailable — the host didn't provide a unit update handler."
                      : suggestedRelCount === 0
                      ? "The AI didn't suggest any cross-tree support/attachment relationships for this structure."
                      : applySuggestedRels
                      ? `Will stamp ${suggestedRelCount} SUPPORTCON / ATTACHED / OPCON annotation${
                          suggestedRelCount !== 1 ? "s" : ""
                        } onto the "from" unit of each pair — the organic parent-child hierarchy is preserved.`
                      : "Skip the AI's own cross-tree relationship annotations."
                  }
                />
                <Toggle
                  checked={autoRelationships}
                  onChange={setAutoRelationships}
                  label="Run local scoring engine as a cleanup pass"
                  sublabel={
                    autoRelationships && relProposalCount > 0
                      ? `Second-guesses the AI: proposes ${relProposalCount} additional re-parent move${
                          relProposalCount !== 1 ? "s" : ""
                        } using the same scoring engine as the Validate tab.`
                      : "Off by default — the AI now picks both parent and relationship type for every unit. Enable this to run the local engine over the result as a second-opinion pass."
                  }
                />
              </div>
            )}

            {/* Progress bars */}
            {stage === "building" && (
              <div className="ais-progress">
                <div
                  className="ais-progress-bar"
                  style={{
                    width: `${
                      buildTotal > 0 ? (buildProgress / buildTotal) * 100 : 0
                    }%`,
                  }}
                />
                <span className="ais-progress-label">
                  Building units… {buildProgress} / {buildTotal}
                </span>
              </div>
            )}
            {stage === "wiring" && (
              <div className="ais-progress">
                <div
                  className="ais-progress-bar"
                  style={{
                    width: `${
                      wireTotal > 0 ? (wireProgress / wireTotal) * 100 : 0
                    }%`,
                    background: "rgba(26,168,96,0.35)",
                  }}
                />
                <span
                  className="ais-progress-label"
                  style={{ color: "#4ade80" }}
                >
                  ⎇ Wiring relationships… {wireProgress} / {wireTotal}
                </span>
              </div>
            )}

            {/* Build button */}
            {stage === "confirmed" && (
              <div className="ais-build-bar">
                <button
                  className="ais-build-btn"
                  style={{ flex: 1 }}
                  onClick={() => void handleBuild()}
                >
                  ⊕ Build {totalUnits} unit{totalUnits !== 1 ? "s" : ""}
                  {applySuggestedRels && canApplySuggested
                    ? ` + wire ${suggestedRelCount} relationship${
                        suggestedRelCount !== 1 ? "s" : ""
                      }`
                    : autoRelationships && relProposalCount > 0
                    ? ` + wire ${relProposalCount} relationship${
                        relProposalCount !== 1 ? "s" : ""
                      }`
                    : ""}
                </button>
                <button
                  className="ais-generate-btn"
                  style={{ flex: "none" }}
                  onClick={handleDiscard}
                >
                  ✕ Discard
                </button>
              </div>
            )}

            {/* Done */}
            {stage === "done" && (
              <div className="ais-done-bar">
                <span className="orp-applied-badge">
                  ✓ {totalUnits} units built
                  {wireTotal > 0 ? ` · ${wireTotal} relationships wired` : ""}
                </span>
                <button
                  className="ais-generate-btn"
                  onClick={() => {
                    setResult(null);
                    setPrompt("");
                    setNationalityHint("");
                    setRawOutput("");
                    setShowRaw(false);
                    setShowAscii(false);
                    setWireTotal(0);
                    setWireProgress(0);
                    setStage("idle");
                  }}
                >
                  Generate another
                </button>
              </div>
            )}
          </div>
        )}
    </div>
  );
};
