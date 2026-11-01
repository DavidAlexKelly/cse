import { useState } from "react";
import ms from "milsymbol";
import { C } from "./shared/milStyles";
import type { CompositionNode } from "../../../types";
import type { HierarchyTemplate } from "../../../types";
import type { Hierarchy, HierarchyPhaseSlot } from "../lib/hierarchyStore";

export type { Hierarchy, HierarchyPhaseSlot };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HierarchyEntry {
  hierarchy: Hierarchy;
  /** Canonical root — structural edits committed immediately into the store */
  displayRoot: CompositionNode;
  isDirty: boolean;
}

interface Props {
  entries: HierarchyEntry[];
  selectedHierarchyId: string | null;
  selectedPhaseSlotId: string | null;
  onSelectHierarchy: (id: string) => void;
  onSelectPhaseSlot: (slotId: string) => void;
  /** Building-block templates to stamp into the active hierarchy */
  templates: HierarchyTemplate[];
  onStampTemplate: (templateRoot: CompositionNode) => void;
  /** Trigger the new-hierarchy dialog in the parent */
  onCreateNew: () => void;
  /**
   * Called when the user confirms deletion of a phase hierarchy whose slots
   * are backed by ontology objects.  The callback receives the map-state id
   * (NxgOTemplateOrbatGraph primary key) for every slot that has one, so the
   * caller can delete each ontology record and then remove the hierarchy from
   * the session store.
   *
   * Only shown for "⌖ Ontology" phase hierarchies.
   */
  onDeleteOntologyPhase?: (hierarchyId: string, ontologyIds: string[]) => Promise<void>;
  /**
   * Called when the user removes a manually-imported (non-ontology) hierarchy
   * from the session store.  No ontology deletion occurs.
   */
  onDeleteHierarchy?: (hierarchyId: string) => void;
}

// ── Tiny helpers ───────────────────────────────────────────────────────────────

function MilThumb({ sidc, size = 26 }: { sidc: string; size?: number }) {
  try {
    const svg = new ms.Symbol(sidc, { size, square: true, strokeWidth: 1.5 }).asSVG();
    if (svg && svg.length > 50)
      return <img src={`data:image/svg+xml;base64,${btoa(svg)}`} width={size} height={size} alt="" style={{ display: "block", flexShrink: 0 }} />;
  } catch { /* fall through */ }
  return <div style={{ width: size, height: size, borderRadius: 2, background: C.bg3, flexShrink: 0 }} />;
}

function countNodes(n: CompositionNode): number {
  return 1 + n.children.reduce((s, c) => s + countNodes(c), 0);
}

function phaseSource(slot: HierarchyPhaseSlot): "ontology" | "manual" {
  return slot.ontologyMapStateId ? "ontology" : "manual";
}

// ── Confirm-delete dialog (inline — no portal needed) ─────────────────────────

interface DeleteConfirmProps {
  hierarchyName: string;
  isOntology: boolean;
  ontologyCount: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirm({ hierarchyName, isOntology, ontologyCount, busy, onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div style={{ background: "var(--bg-surface-flat)", border: "1px solid rgba(176,58,46,0.5)",
        borderRadius: 5, padding: "18px 20px", width: 320, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "#ef9a9a", marginBottom: 10 }}>✕ Delete phase ORBAT?</div>
        <p style={{ fontSize: 12, color: "var(--text-primary)", margin: "0 0 10px", lineHeight: 1.5 }}>
          <strong>"{hierarchyName}"</strong> will be removed from this session.
        </p>
        {isOntology && ontologyCount > 0 && (
          <p style={{ fontSize: 11, color: "#ef9a9a", margin: "0 0 12px", lineHeight: 1.5,
            padding: "7px 9px", background: "rgba(176,58,46,0.1)", borderRadius: 3, border: "1px solid rgba(176,58,46,0.3)" }}>
            ⚠ This will also permanently delete{" "}
            <strong>{ontologyCount} ontology record{ontologyCount !== 1 ? "s" : ""}</strong> from [NXG-O] Template Orbat Graph. This cannot be undone.
          </p>
        )}
        {!isOntology && (
          <p style={{ fontSize: 11, color: "#8a92a8", margin: "0 0 12px" }}>
            Session-only hierarchy — no ontology records will be changed.
          </p>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} disabled={busy}
            style={{ padding: "5px 14px", background: "transparent", border: `1px solid ${C.border}`,
              borderRadius: 3, color: C.text2, fontSize: 11, cursor: busy ? "default" : "pointer" }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}
            style={{ padding: "5px 14px",
              background: busy ? "rgba(176,58,46,0.4)" : "rgba(176,58,46,0.8)",
              border: "1px solid rgba(176,58,46,0.6)",
              borderRadius: 3, color: "#fff", fontSize: 11, cursor: busy ? "default" : "pointer", fontWeight: 700 }}>
            {busy ? "Deleting…" : (isOntology && ontologyCount > 0 ? "Delete from ontology" : "Remove")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Side helpers (shared by both view modes) ───────────────────────────────────

type Side = "allied" | "hostile" | "unknown";

const SIDE_LABEL: Record<Side, string> = {
            allied:  "🔵 Friendly Forces",
            hostile: "🔴 Enemy Forces",
            unknown: "Unknown Forces",
          };
const SIDE_COLOUR: Record<Side, string> = {
            allied:  "#5B9BD5",
            hostile: "#E74C3C",
            unknown: "#F1C40F",
          };

function affiliationSide(aff: string): Side {
  const a = (aff || "").trim();
  if (a === "Hostile" || a === "Suspect") return "hostile";
  if (a === "Friend" || a === "Assumed Friend" || a === "Neutral") return "allied";
  return "unknown";
}

function hierarchySide(root: CompositionNode): Side {
  const own = affiliationSide(root.affiliation);
  if (own !== "unknown") return own;
  let allied = 0, hostile = 0;
  const walk = (n: CompositionNode) => {
    const s = affiliationSide(n.affiliation);
    if (s === "allied") allied++;
    else if (s === "hostile") hostile++;
    n.children.forEach(walk);
  };
  root.children.forEach(walk);
  if (hostile > allied) return "hostile";
  if (allied > 0) return "allied";
  return "unknown";
}

// ── Component ──────────────────────────────────────────────────────────────────

export function HierarchySelector({
  entries, selectedHierarchyId, selectedPhaseSlotId,
  onSelectHierarchy, onSelectPhaseSlot,
  templates, onStampTemplate,
  onCreateNew,
  onDeleteOntologyPhase,
  onDeleteHierarchy,
}: Props) {
  const [search, setSearch]                 = useState("");
  const [showTemplates, setShowTemplates]   = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");

  // Delete-confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletebusy, setDeleteBusy]           = useState(false);

  // The selector always shows EVERY hierarchy, grouped by side. There used to
  // be a "Forces" / "All phases" toggle, where Forces collapsed the list to one
  // friendly + one hostile row — which hid most of the scenario's ORBATs behind
  // a mode switch. With unit ORBATs composing into one Blue and one Red graph,
  // the full grouped list is the only useful view.

  // ── Filtering ─────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) =>
        e.hierarchy.name.toLowerCase().includes(q) ||
        e.hierarchy.kind.toLowerCase().includes(q),
      )
    : entries;

  const kindRank = (k: string) => k === "force" ? 0 : k === "operation" ? 1 : 2;

  const allSorted = [...filtered].sort((a, b) => {
    const kr = kindRank(a.hierarchy.kind) - kindRank(b.hierarchy.kind);
    if (kr !== 0) return kr;
    // Do NOT pin the selected hierarchy first — that would jump the list
    // position every time the user clicks a row. Sort purely by name within
    // each kind so positions stay stable across selections.
    return a.hierarchy.name.localeCompare(b.hierarchy.name);
  });

  // ── Group building ────────────────────────────────────────────────────────
  type GroupedEntry = HierarchyEntry & { side: Side };

  /**
   * Every hierarchy, grouped by side with a sticky header per group.
   * Within each side, kindRank + name order is preserved.
   */
  const allGroups = (): Array<{ side: Side; items: GroupedEntry[] }> => {
    const map = new Map<Side, GroupedEntry[]>([
      ["allied",  []],
      ["hostile", []],
      ["unknown", []],
    ]);
    for (const e of allSorted) {
      const side = hierarchySide(e.displayRoot);
      map.get(side)!.push({ ...e, side });
    }
    return (["allied", "hostile", "unknown"] as Side[])
      .map((side) => ({ side, items: map.get(side)! }))
      .filter((g) => g.items.length > 0);
  };

  const groups = allGroups();

  // ── Templates filter ──────────────────────────────────────────────────────
  const tq = templateSearch.trim().toLowerCase();
  const filteredTpls = tq
    ? templates.filter((t) =>
        t.name.toLowerCase().includes(tq) ||
        (t.root.echelon ?? "").toLowerCase().includes(tq),
      )
    : templates;

  // ── Delete confirm helpers ────────────────────────────────────────────────
  // Resolve the hierarchy being confirmed for deletion (if any)
  const confirmEntry = confirmDeleteId
    ? entries.find((e) => e.hierarchy.id === confirmDeleteId) ?? null
    : null;
  const confirmOntologyIds = confirmEntry
    ? confirmEntry.hierarchy.phases
        .map((p) => p.ontologyMapStateId)
        .filter((id): id is string => !!id)
    : [];
  const confirmIsOntology = confirmOntologyIds.length > 0;

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId || !confirmEntry) return;
    setDeleteBusy(true);
    try {
      if (confirmIsOntology && onDeleteOntologyPhase) {
        await onDeleteOntologyPhase(confirmDeleteId, confirmOntologyIds);
      } else if (onDeleteHierarchy) {
        onDeleteHierarchy(confirmDeleteId);
      }
    } finally {
      setDeleteBusy(false);
      setConfirmDeleteId(null);
    }
  };

  // ── Row renderer (shared between both modes) ──────────────────────────────
  const renderEntry = (entry: GroupedEntry) => {
            const sideColour = SIDE_COLOUR[entry.side] ?? C.muted;
            const { hierarchy, displayRoot } = entry;
    const selected    = hierarchy.id === selectedHierarchyId;
    const kc          = sideColour;
    const entryPhases = [...hierarchy.phases].sort((a, b) => a.phaseIndex - b.phaseIndex);
    const firstSlot   = entryPhases[0];
    const source      = hierarchy.kind === "phase" && firstSlot ? phaseSource(firstSlot) : null;
    const hasError    = hierarchy.kind === "phase" && entryPhases.some((p) => !!p.parseError);
    const isPhase     = hierarchy.kind === "phase";
            // Show a delete button only when the row is selected and the
            // parent has provided the relevant handler.
    const canDelete   = selected && isPhase && (onDeleteOntologyPhase || onDeleteHierarchy);

            return (
      <div key={hierarchy.id}>
                  <div
                    onClick={() => onSelectHierarchy(hierarchy.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 7,
                      padding: "9px 10px", cursor: "pointer",
                      background: selected ? `${kc}20` : "transparent",
            borderLeft: selected ? `3px solid ${hasError ? "#ef9a9a" : kc}` : "3px solid transparent",
                      borderBottom: `1px solid ${C.bg}`,
                    }}
                    onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = C.surface; }}
                    onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                  >
                    <MilThumb sidc={displayRoot.sidc} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: selected ? C.text : C.text2, fontWeight: selected ? 700 : 400,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {hierarchy.name}
                      </div>
                      <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 2, flexWrap: "wrap" }}>
                        {source === "ontology" && !hasError && (
                          <span
                            title={`Auto-ingested from [NXG-O] Template Orbat Graph (ID: ${firstSlot?.ontologyMapStateId ?? "?"})`}
                  style={{ fontSize: 8, padding: "0 4px", background: "rgba(245,73,139,0.18)", color: "#F5498B",
                    borderRadius: 2, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap", cursor: "help" }}>
                  ⌖ Ontology
                          </span>
                        )}
                        {source === "ontology" && hasError && (
                          <span
                            title={entryPhases.find((p) => p.parseError)?.parseError ?? "Invalid ORBAT JSON"}
                  style={{ fontSize: 8, padding: "0 4px", background: "rgba(239,154,154,0.18)", color: "#ef9a9a",
                    borderRadius: 2, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap", cursor: "help" }}>
                  ⚠ Invalid ORBAT
                          </span>
                        )}
                        {source === "manual" && (
                          <span
                            title="Manually imported or generated via the Import panel"
                  style={{ fontSize: 8, padding: "0 4px", background: "rgba(90,97,120,0.18)", color: "#8a92a8",
                    borderRadius: 2, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap", cursor: "help" }}>
                  ✎ Manual
                          </span>
                        )}
                        <span style={{ fontSize: 9, color: C.muted }}>{displayRoot.echelon || ""}</span>
                        <span style={{ fontSize: 9, color: C.border, marginLeft: "auto" }}>
                          {hierarchy.phases.length > 1 ? `${hierarchy.phases.length}ph · ` : ""}
                          {countNodes(displayRoot)}u
                        </span>
                      </div>
                    </div>

                    {/* Delete button — visible only when row is selected and it's a phase hierarchy */}
                    {canDelete && (
                      <button
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(hierarchy.id); }}
                        title={source === "ontology"
                          ? "Delete this phase ORBAT and its ontology records"
                          : "Remove this phase ORBAT from the session"}
              style={{ flexShrink: 0, padding: "3px 6px", background: "rgba(176,58,46,0.15)",
                border: "1px solid rgba(176,58,46,0.4)", borderRadius: 3, color: "#ef9a9a",
                fontSize: 11, cursor: "pointer", lineHeight: 1 }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(176,58,46,0.35)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(176,58,46,0.15)"; }}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Inline phase chips (if selected and multi-phase) */}
                  {selected && entryPhases.length > 1 && (
          <div style={{ padding: "4px 10px 5px 14px", display: "flex", flexWrap: "wrap", gap: 4,
            borderBottom: `1px solid ${C.border}`, background: `${kc}08` }}>
                      {entryPhases.map((slot, i) => {
                        const isSel      = slot.id === selectedPhaseSlotId;
                        const slotError  = !!slot.parseError;
                        const slotSource = phaseSource(slot);
                        return (
                          <button
                            key={slot.id}
                            onClick={() => onSelectPhaseSlot(slot.id)}
                            title={slotError ? `⚠ ${slot.parseError}` : slotSource === "ontology" ? `From [NXG-O] Template Orbat Graph (${slot.ontologyMapStateId})` : "Manually imported"}
                            style={{
                              padding: "2px 7px",
                              background: isSel ? (slotError ? "#ef9a9a" : kc) : "transparent",
                              border: `1px solid ${isSel ? (slotError ? "#ef9a9a" : kc) : (slotError ? "rgba(239,154,154,0.4)" : C.border)}`,
                    borderRadius: 3, color: isSel ? "#fff" : (slotError ? "#ef9a9a" : C.text2),
                    fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
                            }}
                          >
                            {slotSource === "ontology" && !slotError && <span style={{ opacity: 0.7, fontSize: 7 }}>⌖</span>}
                            {slotError                               && <span style={{ fontSize: 7 }}>⚠</span>}
                  {slotSource === "manual"  && !slotError  && <span style={{ opacity: 0.5, fontSize: 7 }}>✎</span>}
                            <span style={{ opacity: 0.6, marginRight: 1 }}>{i + 1}</span>
                            {slot.phaseName}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
            );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: 230, flexShrink: 0,
      borderRight: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column",
      overflow: "hidden", background: C.bg2,
    }}>

      {/* Confirm-delete overlay */}
      {confirmEntry && (
        <DeleteConfirm
          hierarchyName={confirmEntry.hierarchy.name}
          isOntology={confirmIsOntology}
          ontologyCount={confirmOntologyIds.length}
          busy={deletebusy}
          onConfirm={() => { void handleConfirmDelete(); }}
          onCancel={() => { if (!deletebusy) setConfirmDeleteId(null); }}
        />
      )}

      {/* Search + new button */}
      <div style={{ padding: "7px 8px 6px", borderBottom: `1px solid ${C.border}`,
        flexShrink: 0, display: "flex", gap: 5 }}>
              <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter hierarchies…"
          style={{ flex: 1, padding: "4px 8px", background: C.bg3, border: `1px solid ${C.border}`,
            borderRadius: 3, color: C.text, fontSize: 11, outline: "none", boxSizing: "border-box" as const }}
              />
        <button
          onClick={onCreateNew}
          title="New hierarchy"
          style={{ padding: "4px 10px", background: C.cyan, border: "none", borderRadius: 3,
            color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}
        >+</button>
            </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {entries.length === 0 && (
          <div style={{ padding: "20px 12px", color: C.muted, fontSize: 11, textAlign: "center", lineHeight: 1.6 }}>
            No hierarchies yet.<br />
            <span style={{ color: C.text2, fontSize: 10 }}>Import a phase ORBAT or press + to create one.</span>
    </div>
        )}

        {groups.length === 0 && entries.length > 0 && (
          <div style={{ padding: "12px 12px", color: C.muted, fontSize: 11, textAlign: "center", lineHeight: 1.6 }}>
            No hierarchies match the filter.
          </div>
        )}

        {groups.flatMap((group) => {
          const sideColour = SIDE_COLOUR[group.side] ?? C.muted;
          const sideLabel  = SIDE_LABEL[group.side]  ?? group.side;
          return [
            // Sticky side header — one per group
            <div
              key={`header-${group.side}`}
              style={{
                padding: "6px 10px 4px", fontSize: 10, fontWeight: 700,
                color: sideColour, textTransform: "uppercase", letterSpacing: "0.08em",
                borderBottom: `1px solid ${C.border}`, background: `${sideColour}12`,
                borderLeft: `3px solid ${sideColour}`, position: "sticky", top: 0, zIndex: 1,
              }}
            >
              {sideLabel}
              {group.items.length > 1 && (
                <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 400,
                  color: sideColour, opacity: 0.7 }}>
                  ({group.items.length})
                </span>
              )}
            </div>,
            // All entries in this group
            ...group.items.map((entry) => renderEntry(entry)),
          ];
        })}
      </div>

      {/* Template stamp panel */}
      <div style={{ borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
        <button
          onClick={() => setShowTemplates((v) => !v)}
          style={{ width: "100%", padding: "6px 10px", background: "transparent", border: "none", color: C.text2, fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, textAlign: "left" as const }}
        >
          <span style={{ fontSize: 9 }}>{showTemplates ? "▼" : "▶"}</span>
          <span style={{ fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", fontSize: 9 }}>
            Templates
          </span>
          <span style={{ color: C.border, fontSize: 9 }}>({templates.length})</span>
          <span style={{ flex: 1 }} />
          {selectedHierarchyId && <span style={{ fontSize: 9, color: C.muted }}>click to stamp</span>}
        </button>

        {showTemplates && (
          <div style={{ maxHeight: 260, display: "flex", flexDirection: "column", borderTop: `1px solid ${C.border}` }}>
            <div style={{ padding: "5px 8px", flexShrink: 0 }}>
              <input
                value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder="Filter templates…"
                style={{ width: "100%", padding: "3px 7px", background: C.bg3,
                  border: `1px solid ${C.border}`, borderRadius: 2, color: C.text,
                  fontSize: 10, outline: "none", boxSizing: "border-box" as const }}
              />
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {filteredTpls.length === 0 && (
                <div style={{ padding: "8px 12px", color: C.muted, fontSize: 10, fontStyle: "italic" }}>
                  {templates.length === 0 ? "No templates." : "No results."}
                </div>
              )}
              {filteredTpls.map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => selectedHierarchyId && onStampTemplate(tpl.root)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
                    borderBottom: `1px solid ${C.bg}`,
                    cursor: selectedHierarchyId ? "pointer" : "default",
                    opacity: selectedHierarchyId ? 1 : 0.45,
                  }}
                  onMouseEnter={(e) => { if (selectedHierarchyId) (e.currentTarget as HTMLDivElement).style.background = C.surface; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                  title={selectedHierarchyId ? `Stamp "${tpl.name}" into current hierarchy` : "Select a hierarchy first"}
                >
                  <MilThumb sidc={tpl.root.sidc} size={22} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: C.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tpl.name}</div>
                    <div style={{ fontSize: 9, color: C.muted }}>{tpl.root.echelon}</div>
                  </div>
                  <span style={{ fontSize: 9, color: C.border }}>{countNodes(tpl.root)}u</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

