/**
 * AiTemplateGenerator.tsx
 *
 * An AI-powered panel that generates a CompositionNode hierarchy from a
 * plain-English prompt and saves it directly as a HierarchyTemplate.
 *
 * Integration points:
 *  - calls generateOrbat (Foundry function) via the existing OSDK client
 *  - parses the JSON response into CompositionNode trees using existing sidc helpers
 *  - saves the result via createHierarchyTemplateFn so it appears in the
 *    Templates tab immediately after reloadTemplates() is called
 *
 * No new dependencies — uses only what is already in the project.
 */

import React, { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { client } from "@/client";
import { generateOrbatV2 } from "@nxg-simulation-execution-testing/sdk";
import { createHierarchyTemplateFn } from "../lib/foundry";
import { makeSidc, ECHELON_TO_SIDC_CHAR } from "../lib/sidc";
import type { CompositionNode } from "../../../types";
import {
  extendBareUnitsWithDoctrine,
  scoreAndReparent,
  countExtensionAdditions,
  countReparentMoves,
} from "../lib/aiTemplatePostProcess";

// ─── Types mirroring the generateOrbat JSON response schema ──────────────────

interface AiUnit {
  name: string;
  echelon: string;
  icon: string;
  personnelCount: number;
  notes?: string;
  canonicalAssetId?: string | null;
  children: AiUnit[];
}

interface AiResponse {
  description: string;
  units: AiUnit[];
}

// ─── Echelon normalisation ────────────────────────────────────────────────────
// The AI may return echelon strings in various cases — normalise to Title Case
// so they match the existing ECHELON_TO_SIDC_CHAR lookup table.

const KNOWN_ECHELONS = new Set(Object.keys(ECHELON_TO_SIDC_CHAR));

function normaliseEchelon(raw: string): string {
  if (!raw) return "Battalion";
  // Try exact match first
  if (KNOWN_ECHELONS.has(raw)) return raw;
  // Try title case
  const titled = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  if (KNOWN_ECHELONS.has(titled)) return titled;
  // Try lowercase
  const lower = raw.toLowerCase();
  if (KNOWN_ECHELONS.has(lower)) return lower;
  // Fallback: return title-cased
  return titled;
}

// ─── AI unit → CompositionNode ────────────────────────────────────────────────

function aiUnitToCompositionNode(
  unit: AiUnit,
  affiliation = "Friend",
): CompositionNode {
  const echelon = normaliseEchelon(unit.echelon);
  const icon = unit.icon ?? "infantry";
  return {
    id: uuidv4(),
    unitIdentifier: unit.name ?? "",
    echelon,
    sidc: makeSidc(icon, echelon, affiliation, "organisation"),
    entityType: "organisation",
    militaryService: "Army",
    // The LLM does not choose simulator models, and its canonicalAssetId is
    // unvalidated — generated units are organisations, which need no asset.
    // Any entity unit derived from one has to be linked by hand afterwards;
    // validateComposition surfaces those before the ORBAT can be written.
    simulatorIdentifierCode: null,
    affiliation,
    allegiance: "GBR",
    owningSimulator: "vbs4",
    canonicalAssetKey: unit.canonicalAssetId ?? null,
    unitTypeKey: null,
    equipmentTypeKey: null,
    quantity: 1,
    children: (unit.children ?? []).map((c) =>
      aiUnitToCompositionNode(c, affiliation),
    ),
  };
}

// ─── Parse raw AI JSON response ───────────────────────────────────────────────

function parseAiResponse(raw: string): AiResponse {
  // Strip markdown fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: AiResponse;
  try {
    parsed = JSON.parse(cleaned) as AiResponse;
  } catch {
    // The raw string is not valid JSON — likely an error message from the function
    throw new Error(`The AI function returned an error: ${cleaned.slice(0, 300)}`);
  }

  // The generateOrbat function sometimes wraps errors in the description field
  // with an empty units array — detect and surface this cleanly.
  if (!parsed.units || !Array.isArray(parsed.units)) {
    throw new Error(parsed.description ?? "Response missing 'units' array");
  }
  if (parsed.units.length === 0) {
    const desc = parsed.description ?? "";
    // If description looks like an error message, surface it directly
    if (
      desc.toLowerCase().includes("failed") ||
      desc.toLowerCase().includes("error") ||
      desc.toLowerCase().includes("forbidden") ||
      desc.toLowerCase().includes("403") ||
      desc.toLowerCase().includes("proxy")
    ) {
      throw new Error(desc);
    }
    throw new Error("The AI returned an empty structure. Try a more specific description.");
  }

  return parsed;
}

// ─── Count nodes ──────────────────────────────────────────────────────────────

function countAiUnits(units: AiUnit[]): number {
  let n = 0;
  const walk = (u: AiUnit) => { n++; u.children.forEach(walk); };
  units.forEach(walk);
  return n;
}

function countNodes(node: CompositionNode): number {
  return 1 + node.children.reduce((s, c) => s + countNodes(c), 0);
}

// ─── Mini tree preview ────────────────────────────────────────────────────────

function TreePreviewRow({ unit, depth }: { unit: AiUnit; depth: number }) {
  return (
    <>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        paddingLeft: 8 + depth * 16,
        padding: `3px 8px 3px ${8 + depth * 16}px`,
      }}>
        <span style={{ fontSize: 9, color: "var(--border-default)", userSelect: "none" }}>
          {depth > 0 ? "└ " : ""}
        </span>
        <span style={{ fontSize: 11, color: depth === 0 ? "#e0e0e0" : "#90a4ae", fontWeight: depth === 0 ? 600 : 400, flex: 1 }}>
          {unit.name || "(unnamed)"}
        </span>
        <span style={{ fontSize: 9, color: "#4fc3f7", flexShrink: 0 }}>
          {normaliseEchelon(unit.echelon)}
        </span>
        {unit.personnelCount > 0 && (
          <span style={{ fontSize: 9, color: "#607d8b", flexShrink: 0 }}>
            {unit.personnelCount} pax
          </span>
        )}
        {(unit.children?.length ?? 0) > 0 && depth === 0 && (
          <span style={{ fontSize: 9, color: "#607d8b", flexShrink: 0 }}>
            +{unit.children.length} sub
          </span>
        )}
      </div>
      {unit.children?.map((c, i) => (
        <TreePreviewRow key={i} unit={c} depth={depth + 1} />
      ))}
    </>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** Called after a template is saved so the parent can reload the list */
  onTemplateSaved: () => Promise<void>;
  /** Optional — called if the panel should be closeable */
  onClose?: () => void;
  /** Existing template names — used to warn on duplicate names */
  existingNames?: Set<string>;
}

// ─── Stage machine ────────────────────────────────────────────────────────────

type Stage = "idle" | "generating" | "preview" | "saving" | "done" | "error";

// ─── Main component ───────────────────────────────────────────────────────────

export function AiTemplateGenerator({ onTemplateSaved, onClose, existingNames = new Set() }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [prompt, setPrompt] = useState("");
  const [nationalityHint, setNationalityHint] = useState("");
  const [affiliation, setAffiliation] = useState("Friend");

  // Deterministic post-processing toggles (see lib/aiTemplatePostProcess.ts).
  // Extension is ON by default — it only fills gaps the LLM left behind, so
  // it is virtually never wrong.  Re-parenting is OFF by default because it
  // second-guesses the LLM's explicit parent choices.
  const [extendDoctrine, setExtendDoctrine] = useState(true);
  const [autoReparent, setAutoReparent] = useState(false);

  // Generated result — always the RAW LLM tree, so toggling the post-process
  // options can recompute the preview without a fresh network call.
  const [aiResponse, setAiResponse] = useState<AiResponse | null>(null);
  const [rawOutput, setRawOutput] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  // Template metadata (editable before saving)
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");

  const [error, setError] = useState<string | null>(null);

  // ─── Deterministic post-processing pipeline ─────────────────────────────
  //
  //  RAW (from LLM) → (optional) doctrine extension → (optional) re-parent
  //  This useMemo recomputes whenever the toggles change so the preview tree,
  //  the totals, and the eventual save all use the SAME processed structure.
  //  Both post-processing functions are pure and non-mutating.
  //
  const processedUnits = React.useMemo(() => {
    if (!aiResponse) return [];
    let out = aiResponse.units;
    if (extendDoctrine) out = extendBareUnitsWithDoctrine(out);
    if (autoReparent)   out = scoreAndReparent(out).tree;
    return out;
  }, [aiResponse, extendDoctrine, autoReparent]);

  // Counters used for the toggle sublabels — computed against the RAW tree so
  // they always reflect "how much would this toggle add/move relative to raw".
  const extensionCount = React.useMemo(
    () => (aiResponse ? countExtensionAdditions(aiResponse.units) : 0),
    [aiResponse],
  );
  const reparentCount = React.useMemo(() => {
    if (!aiResponse) return 0;
    // If extension is on, score after extension (because the fuller tree is
    // what will actually be saved) — otherwise score the raw tree directly.
    const base = extendDoctrine
      ? extendBareUnitsWithDoctrine(aiResponse.units)
      : aiResponse.units;
    return countReparentMoves(base);
  }, [aiResponse, extendDoctrine]);

  const totalUnits = aiResponse ? countAiUnits(processedUnits) : 0;
  const isDuplicateName = templateName.trim() !== "" && existingNames.has(templateName.trim());

  // ── Generate ────────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || stage === "generating") return;
    setStage("generating");
    setError(null);
    setAiResponse(null);
    setRawOutput("");

    try {
      const raw = await (client(generateOrbatV2 as any) as any).executeFunction({
        userDescription: prompt.trim(),
        ...(nationalityHint.trim() ? { nationalityHint: nationalityHint.trim() } : {}),
      }) as string;

      setRawOutput(raw);
      // parseAiResponse throws a user-friendly error if the response is an
      // error wrapper (403, empty units, etc.) — catch it below.
      const parsed = parseAiResponse(raw);
      setAiResponse(parsed);

      // Pre-fill template name from the AI description
      const autoName = parsed.description
        ? parsed.description.slice(0, 60).replace(/\.$/, "")
        : prompt.trim().slice(0, 60);
      setTemplateName(autoName);
      setTemplateDesc(parsed.description ?? "");

      setStage("preview");
    } catch (e) {
      // Stay on "idle" (not "error") so the form remains fully editable and
      // the user can adjust the prompt and try again immediately.
      setError(e instanceof Error ? e.message : String(e));
      setStage("idle");
    }
  }, [prompt, nationalityHint, stage]);

  // ── Save as template ────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!aiResponse || !templateName.trim() || stage === "saving") return;
    setStage("saving");
    setError(null);

    try {
      // Build root CompositionNode — if AI returns multiple top-level units,
      // wrap them under a synthetic HQ node so there is always a single root.
      // Uses `processedUnits` (LLM output + optional doctrine extension +
      // optional deterministic re-parent) rather than the raw aiResponse, so
      // the saved template reflects the toggle state visible in the preview.
      let root: CompositionNode;
      const nodes = processedUnits.map((u) => aiUnitToCompositionNode(u, affiliation));

      if (nodes.length === 1) {
        root = nodes[0];
      } else {
        // Synthetic wrapper: pick the highest echelon from the top-level units
        const topEchelons = processedUnits.map((u) => normaliseEchelon(u.echelon));
        const rootEchelon = topEchelons[0] ?? "Brigade";
        root = {
          id: uuidv4(),
          unitIdentifier: templateName.trim(),
          echelon: rootEchelon,
          sidc: makeSidc("headquarters", rootEchelon, affiliation, "organisation"),
          entityType: "organisation",
          militaryService: "Army",
          affiliation,
          allegiance: "GBR",
          owningSimulator: "vbs4",
          canonicalAssetKey: null,
          simulatorIdentifierCode: null,
          unitTypeKey: null,
          equipmentTypeKey: null,
          quantity: 1,
          children: nodes,
        };
      }

      const echelon = root.echelon ?? "";
      const templateJson = JSON.stringify({
        name: templateName.trim(),
        description: templateDesc.trim(),
        tags: ["ai-generated"],
        echelon,
        createdAt: new Date().toISOString(),
        root,
      });

      await createHierarchyTemplateFn({
        name: templateName.trim(),
        echelon,
        description: templateDesc.trim(),
        tags: "ai-generated",
        templateJson,
      });

      await onTemplateSaved();
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("preview"); // roll back so user can retry
    }
  }, [processedUnits, aiResponse, templateName, templateDesc, affiliation, stage, onTemplateSaved]);

  // ── Reset ───────────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setStage("idle");
    setAiResponse(null);
    setRawOutput("");
    setShowRaw(false);
    setError(null);
    setPrompt("");
    setNationalityHint("");
    setTemplateName("");
    setTemplateDesc("");
    // Deliberately do NOT reset the post-processing toggles — user preference
    // should persist across successive generations in the same session.
  }, []);

  // ─── Styles ──────────────────────────────────────────────────────────────────

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    padding: "6px 10px", fontSize: 12,
    background: "#0f1e2d", border: "1px solid #1e3a4a", borderRadius: 4,
    color: "#e0e0e0", outline: "none", fontFamily: "inherit",
  };
  const sel: React.CSSProperties = { ...inp, cursor: "pointer" };
  const label10: React.CSSProperties = {
    fontSize: 10, color: "#607d8b", textTransform: "uppercase",
    letterSpacing: "0.06em", display: "block", marginBottom: 3,
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 14,
      padding: "16px 20px",
      background: "rgba(79,195,247,0.03)",
      border: "1px solid rgba(79,195,247,0.15)",
      borderRadius: 6,
      marginBottom: 8,
    }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, color: "#4fc3f7" }}>✦</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e0e0e0", flex: 1 }}>
          AI Template Generator
        </span>
        {onClose && (
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#607d8b", fontSize: 16, lineHeight: 1, padding: "0 2px",
          }}>✕</button>
        )}
      </div>

      <div style={{ fontSize: 11, color: "#607d8b", lineHeight: 1.5 }}>
        Describe a military structure in plain English. The AI will generate a
        doctrine-aware hierarchy which you can review and save directly as a
        reusable template.
      </div>

      {/* ── Input form — always visible when idle/error/generating ── */}
      {(stage === "idle" || stage === "generating" || stage === "error") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Prompt */}
          <div>
            <label style={label10}>Describe the structure *</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                'e.g. "British infantry battalion with 3 rifle companies"\n' +
                '"US armoured brigade combat team"\n' +
                '"French Foreign Legion company, section level detail"'
              }
              rows={3}
              disabled={stage === "generating"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void handleGenerate();
              }}
              style={{ ...inp, resize: "vertical", minHeight: 72 }}
            />
          </div>

          {/* Nationality + Affiliation row */}
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 2 }}>
              <label style={label10}>Nationality hint (optional)</label>
              <input
                value={nationalityHint}
                onChange={(e) => setNationalityHint(e.target.value)}
                placeholder="e.g. British, US, French…"
                disabled={stage === "generating"}
                style={inp}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label10}>Affiliation</label>
              <select
                value={affiliation}
                onChange={(e) => setAffiliation(e.target.value)}
                disabled={stage === "generating"}
                style={sel}
              >
                {["Friend", "Hostile", "Neutral", "Unknown"].map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Advanced options toggle */}
          {/* Advanced options removed — the V2 function (generateOrbatV2) uses
              createLanguageModelClient internally and does not accept a model
              alias override.  Deterministic post-processing lives in the preview
              stage now, so there is nothing to configure here. */}

          {/* Error */}
          {error && (
            <div style={{
              fontSize: 11, color: "#ef9a9a", padding: "10px 12px",
              background: "rgba(176,58,46,0.12)", border: "1px solid rgba(176,58,46,0.3)",
              borderRadius: 4, display: "flex", flexDirection: "column", gap: 6,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <span style={{ flexShrink: 0 }}>⚠</span>
                <span style={{ lineHeight: 1.5 }}>{error}</span>
              </div>
              {(error.toLowerCase().includes("403") || error.toLowerCase().includes("forbidden") || error.toLowerCase().includes("proxy")) && (
                <div style={{ fontSize: 10, color: "#b07070", lineHeight: 1.5, borderTop: "1px solid rgba(176,58,46,0.3)", paddingTop: 6 }}>
                  The AI language model returned a 403 Forbidden response. This usually means
                  the <strong>generateOrbat</strong> Foundry function does not have permission to call
                  the LLM proxy, or the model alias is not available in this environment.
                  Contact your Foundry admin to check the function's LLM proxy configuration.
                </div>
              )}
              <button
                onClick={() => setError(null)}
                style={{
                  alignSelf: "flex-end", background: "none",
                  border: "1px solid rgba(176,58,46,0.4)", borderRadius: 3,
                  color: "#ef9a9a", cursor: "pointer", fontSize: 10,
                  padding: "2px 10px",
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Generate button */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() => void handleGenerate()}
              disabled={stage === "generating" || !prompt.trim()}
              style={{
                padding: "7px 20px",
                background: stage === "generating" || !prompt.trim() ? "#1a2b3c" : "#1565C0",
                border: "none", borderRadius: 4,
                color: stage === "generating" || !prompt.trim() ? "#607d8b" : "#fff",
                fontSize: 12, fontWeight: 700, cursor: stage === "generating" || !prompt.trim() ? "default" : "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {stage === "generating" ? (
                <>
                  <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid #607d8b", borderTopColor: "#4fc3f7", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                  Generating…
                </>
              ) : (
                <>✦ Generate Structure</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Preview stage ── */}
      {(stage === "preview" || stage === "saving") && aiResponse && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* AI summary */}
          <div style={{
            padding: "8px 12px",
            background: "rgba(79,195,247,0.06)", border: "1px solid rgba(79,195,247,0.2)", borderRadius: 4,
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          }}>
            <span style={{ fontSize: 11, color: "#c8d0da", flex: 1, lineHeight: 1.4 }}>
              {aiResponse.description}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, color: "#4fc3f7",
              background: "rgba(79,195,247,0.12)", border: "1px solid rgba(79,195,247,0.3)",
              borderRadius: 10, padding: "2px 8px", flexShrink: 0,
            }}>
              {totalUnits} units
            </span>
          </div>

          {/* ── Deterministic post-processing toggles ────────────────────
              These sit above the tree so the user can flick them on/off and
              watch the preview change.  Both are pure functions — no network
              cost — so recomputes are instant.  See lib/aiTemplatePostProcess.ts. */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 6,
            padding: "8px 10px",
            background: "rgba(192,132,252,0.04)",
            border: "1px solid rgba(192,132,252,0.18)",
            borderRadius: 4,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#c084fc", display: "flex", alignItems: "center", gap: 6 }}>
              <span>⚙</span> Deterministic post-processing
            </div>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 11, color: "#c8d0da", lineHeight: 1.4 }}>
              <input
                type="checkbox"
                checked={extendDoctrine}
                onChange={(e) => setExtendDoctrine(e.target.checked)}
                disabled={stage === "saving"}
                style={{ marginTop: 2, accentColor: "#c084fc", flexShrink: 0 }}
              />
              <span>
                <strong style={{ color: "#e0e0e0" }}>Fill bare units with doctrine</strong>
                <span style={{ fontSize: 10, color: "#607d8b", display: "block", marginTop: 1 }}>
                  {extensionCount > 0
                    ? `Adds ${extensionCount} synthetic unit${extensionCount !== 1 ? "s" : ""} down to the doctrine leaf (squad / team) for any bare leaf in the AI output.`
                    : "No bare units to extend — the AI output already reaches its natural leaves."}
                </span>
              </span>
            </label>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 11, color: "#c8d0da", lineHeight: 1.4 }}>
              <input
                type="checkbox"
                checked={autoReparent}
                onChange={(e) => setAutoReparent(e.target.checked)}
                disabled={stage === "saving"}
                style={{ marginTop: 2, accentColor: "#c084fc", flexShrink: 0 }}
              />
              <span>
                <strong style={{ color: "#e0e0e0" }}>Score & re-parent using the doctrine engine</strong>
                <span style={{ fontSize: 10, color: "#607d8b", display: "block", marginTop: 1 }}>
                  {reparentCount > 0
                    ? `Deterministic scoring proposes ${reparentCount} re-parent move${reparentCount !== 1 ? "s" : ""} (adjacent-echelon preferred, HQ bonus, span-of-control, function compatibility).`
                    : "No moves proposed — the AI's parent choices already score highest against the doctrine rules."}
                </span>
              </span>
            </label>
          </div>

          {/* Tree preview — shows the post-processed structure that will be saved */}
          <div>
            <div style={{ fontSize: 10, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Structure preview
              {(extendDoctrine || autoReparent) && (
                <span style={{ marginLeft: 6, color: "#c084fc", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                  (post-processed)
                </span>
              )}
            </div>
            <div style={{
              background: "#071018", border: "1px solid #1e3a4a", borderRadius: 4,
              maxHeight: 240, overflowY: "auto", padding: "4px 0",
            }}>
              {processedUnits.map((u, i) => (
                <TreePreviewRow key={i} unit={u} depth={0} />
              ))}
            </div>
          </div>

          {/* Raw JSON toggle */}
          <div>
            <button
              onClick={() => setShowRaw((v) => !v)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#607d8b", fontSize: 10, padding: 0, textDecoration: "underline",
              }}
            >
              {showRaw ? "▾ Hide raw JSON" : "▸ Show raw JSON"}
            </button>
            {showRaw && (
              <pre style={{
                fontSize: 9, color: "#607d8b", fontFamily: "monospace",
                background: "#050d14", border: "1px solid #1e3a4a", borderRadius: 4,
                padding: "8px 10px", maxHeight: 200, overflowY: "auto", marginTop: 6,
                whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}>
                {rawOutput}
              </pre>
            )}
          </div>

          {/* Template metadata */}
          <div style={{
            padding: "10px 12px", background: "#0a1520",
            border: "1px solid #1e3a4a", borderRadius: 4,
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{ fontSize: 10, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Save as template
            </div>
            <div>
              <label style={label10}>Template name *</label>
              <input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. British Infantry Battalion"
                style={{ ...inp, borderColor: isDuplicateName ? "#ef9a9a" : "#1e3a4a" }}
                disabled={stage === "saving"}
              />
              {isDuplicateName && (
                <div style={{ fontSize: 10, color: "#ef9a9a", marginTop: 3 }}>
                  ⚠ A template with this name already exists.
                </div>
              )}
            </div>
            <div>
              <label style={label10}>Description (optional)</label>
              <input
                value={templateDesc}
                onChange={(e) => setTemplateDesc(e.target.value)}
                placeholder="Brief description…"
                style={inp}
                disabled={stage === "saving"}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              fontSize: 11, color: "#ef9a9a", padding: "8px 10px",
              background: "rgba(176,58,46,0.12)", border: "1px solid rgba(176,58,46,0.3)",
              borderRadius: 4,
            }}>
              <strong>Save failed:</strong> {error}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={handleReset}
              disabled={stage === "saving"}
              style={{
                padding: "6px 16px", background: "transparent",
                border: "1px solid #2a4a5a", borderRadius: 4,
                color: "#90a4ae", fontSize: 12, cursor: "pointer",
              }}
            >
              ✕ Discard
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={!templateName.trim() || isDuplicateName || stage === "saving"}
              style={{
                padding: "6px 20px",
                background: (!templateName.trim() || isDuplicateName || stage === "saving") ? "#1a2b3c" : "#1565C0",
                border: "none", borderRadius: 4,
                color: (!templateName.trim() || isDuplicateName || stage === "saving") ? "#607d8b" : "#fff",
                fontSize: 12, fontWeight: 700,
                cursor: (!templateName.trim() || isDuplicateName || stage === "saving") ? "default" : "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {stage === "saving" ? (
                <>
                  <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid #607d8b", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                  Saving…
                </>
              ) : (
                `⊕ Save template (${countNodes(
                  processedUnits.length === 1
                    ? aiUnitToCompositionNode(processedUnits[0], affiliation)
                    : { id: "tmp", unitIdentifier: "", echelon: "", sidc: "", entityType: "organisation", militaryService: "", affiliation, allegiance: "", owningSimulator: "", canonicalAssetKey: null, simulatorIdentifierCode: null, unitTypeKey: null, equipmentTypeKey: null, quantity: 1, children: processedUnits.map((u) => aiUnitToCompositionNode(u, affiliation)) }
                )} nodes)`
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Done stage ── */}
      {stage === "done" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{
            padding: "10px 14px", background: "rgba(64,160,96,0.1)",
            border: "1px solid rgba(64,160,96,0.3)", borderRadius: 4,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ color: "#5dc485", fontSize: 16 }}>✓</span>
            <span style={{ fontSize: 12, color: "#c8d0da" }}>
              Template <strong style={{ color: "#e0e0e0" }}>"{templateName}"</strong> saved successfully.
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={handleReset}
              style={{
                padding: "6px 18px", background: "#1565C0",
                border: "none", borderRadius: 4, color: "#fff",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >
              ✦ Generate another
            </button>
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  padding: "6px 16px", background: "transparent",
                  border: "1px solid #2a4a5a", borderRadius: 4,
                  color: "#90a4ae", fontSize: 12, cursor: "pointer",
                }}
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {/* Spinner keyframe — injected once as a style tag */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
