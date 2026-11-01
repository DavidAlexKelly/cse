// ============================================================
//  Formation Card View — live pointer-driven drag/reorder
// ============================================================

import React, { useCallback, useRef, useState, useMemo, useEffect } from "react";
import type { UnitNode, Side, UnitIconType } from "./types.js";
import { ECHELON_INDEX } from "./types.js";
import { NatoSymbol } from "./NatoSymbol.js";
import type { HqIndicator, Sector1Modifier, Sector2Modifier, SymbolStatus } from "./symbolSpec.js";
import { removeNode } from "./treeUtils.js";

const ECHELON_COLOURS: Record<number, { border: string; label: string; bg: string }> = {
  12: { border: "#ef4d4d", label: "#ff6666", bg: "rgba(255,68,68,0.07)"  },
  11: { border: "#ef4d4d", label: "#ff6666", bg: "rgba(255,68,68,0.07)"  },
  10: { border: "#ef4d4d", label: "#ff6666", bg: "rgba(255,68,68,0.07)"  },
   9: { border: "#e05252", label: "#e07070", bg: "rgba(224,82,82,0.07)"  },
   8: { border: "#d06020", label: "#e08040", bg: "rgba(208,96,32,0.07)"  },
   7: { border: "#c07820", label: "#d89830", bg: "rgba(192,120,32,0.07)" },
   6: { border: "#f0a83c", label: "#d8b830", bg: "rgba(192,160,32,0.07)" },
   5: { border: "#f0a83c", label: "#d8b830", bg: "rgba(192,160,32,0.07)" },
   4: { border: "#40a060", label: "#50c080", bg: "rgba(64,160,96,0.07)"  },
   3: { border: "#2888b8", label: "#40a8d8", bg: "rgba(40,136,184,0.07)" },
   2: { border: "#1a7a8a", label: "#22aaba", bg: "rgba(26,122,138,0.07)" },
   1: { border: "#1a6078", label: "#22a0c0", bg: "rgba(26,96,120,0.07)"  },
   0: { border: "#4a4a6a", label: "#8a8aaa", bg: "rgba(74,74,106,0.05)"  },
};
function echelonStyle(idx: number) { return ECHELON_COLOURS[idx] ?? ECHELON_COLOURS[0]; }

// ── Tree helpers ──────────────────────────────────────────────────────────────

function flattenIds(units: UnitNode[]): string[] {
  const ids: string[] = [];
  const walk = (u: UnitNode) => { ids.push(u.id); u.children.forEach(walk); };
  units.forEach(walk);
  return ids;
}

function findNode(units: UnitNode[], id: string): UnitNode | null {
  for (const u of units) {
    if (u.id === id) return u;
    const f = findNode(u.children, id);
    if (f) return f;
  }
  return null;
}

function insertNode(units: UnitNode[], node: UnitNode, parentId: string | null): UnitNode[] {
  if (parentId === null) return [...units, node];
  return units.map(u => {
    if (u.id === parentId) return { ...u, children: [...u.children, node] };
    return { ...u, children: insertNode(u.children, node, parentId) };
  });
}

function applyLiveMove(
  units: UnitNode[],
  dragId: string,
  overParentId: string | null,
): UnitNode[] | null {
  const dragNode = findNode(units, dragId);
  if (!dragNode) return null;
  if (overParentId !== null && flattenIds([dragNode]).includes(overParentId)) return null;
  const alreadyAtRoot    = overParentId === null && units.some(u => u.id === dragId);
  const alreadyUnderTarget = overParentId !== null &&
    (findNode(units, overParentId)?.children.some(c => c.id === dragId) ?? false);
  if (alreadyAtRoot || alreadyUnderTarget) return null;
  return insertNode(removeNode(units, dragId), dragNode, overParentId);
}

// ── Ghost ─────────────────────────────────────────────────────────────────────

const Ghost: React.FC<{ unit: UnitNode; x: number; y: number }> = ({ unit, x, y }) => {
  const c = echelonStyle(ECHELON_INDEX[unit.echelon]);
  return (
    <div style={{
      position: "fixed", left: x + 14, top: y - 18,
      pointerEvents: "none", zIndex: 9999,
      padding: "4px 12px",
      background: c.bg.replace("0.07", "0.92"),
      border: `1.5px dashed ${c.border}`,
      borderRadius: 4, color: c.label,
      fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
    }}>
      {"\u2715 "}{unit.name}
    </div>
  );
};

// ── Leaf card ─────────────────────────────────────────────────────────────────

interface LeafCardProps {
  unit: UnitNode; side: Side; selected: boolean; isDragging: boolean;
  onSelect: (unit: UnitNode) => void;
  onPointerDown: (e: React.PointerEvent, unitId: string) => void;
}

const LeafCard: React.FC<LeafCardProps> = ({ unit, side, selected, isDragging, onSelect, onPointerDown }) => {
  const affiliation = unit.symbol?.standardIdentity ?? side.standardIdentity;
  const icon        = (unit.symbol?.icon ?? "generic") as UnitIconType;
  const echelon     = unit.symbol?.echelon ?? unit.echelon;
  const hq          = unit.symbol?.hqIndicator as HqIndicator | undefined;
  const sector1     = unit.symbol?.sector1     as Sector1Modifier | undefined;
  const sector2     = unit.symbol?.sector2     as Sector2Modifier | undefined;
  const reinforced  = unit.symbol?.reinforced;
  const status      = unit.symbol?.status      as SymbolStatus | undefined;

  return (
    <button
      className={`fcv-leaf${selected ? " fcv-leaf--selected" : ""}${isDragging ? " fcv-leaf--dragging" : ""}`}
      style={{ cursor: isDragging ? "grabbing" : "grab", opacity: isDragging ? 0.35 : 1, transition: "opacity 0.1s" }}
      onPointerDown={e => onPointerDown(e, unit.id)}
      // Selection dispatched by parent's pointerup (click-vs-drag threshold).
      // Keyboard-only fallback: detail === 0 means non-mouse activation.
      onClick={e => {
        if (e.detail === 0 && !isDragging) onSelect(unit);
      }}
      title={unit.notes || unit.name}
    >
      <NatoSymbol
        standardIdentity={affiliation} echelon={echelon} icon={icon}
        hq={hq} sector1={sector1} sector2={sector2} reinforced={reinforced} status={status}
        size={40}
      />
      <span className="fcv-leaf-name">{unit.name}</span>
    </button>
  );
};

// ── Formation box ─────────────────────────────────────────────────────────────

interface FormationProps {
  unit: UnitNode; side: Side; depth: number; selectedId: string | null;
  draggingId: string | null; overParentId: string | null;
  onSelect: (unit: UnitNode) => void;
  onPointerDown: (e: React.PointerEvent, unitId: string) => void;
  onPointerEnter: (unitId: string) => void;
}

const FormationBox: React.FC<FormationProps> = ({
  unit, side, depth, selectedId, draggingId, overParentId,
  onSelect, onPointerDown, onPointerEnter,
}) => {
  const idx          = ECHELON_INDEX[unit.echelon];
  const c            = echelonStyle(idx);
  const isSelected   = selectedId === unit.id;
  const isDragging   = draggingId === unit.id;
  const isDropTarget = overParentId === unit.id && !!draggingId && draggingId !== unit.id;

  const subs   = unit.children.filter(ch => ch.children.length > 0);
  const leaves = unit.children.filter(ch => ch.children.length === 0);

  return (
    <div
      data-fcv-drop-target={unit.id}
      onPointerEnter={() => onPointerEnter(unit.id)}
      className={`fcv-box fcv-depth-${Math.min(depth, 6)}${isSelected ? " fcv-box--selected" : ""}${isDropTarget ? " fcv-box--drag-target" : ""}`}
      style={{
        borderColor:         c.border,
        backgroundColor:     c.bg,
        "--fcv-label-color": c.label,
        opacity:             isDragging ? 0.35 : 1,
        outline:             isDropTarget ? `2px dashed ${c.border}` : undefined,
        transition:          "opacity 0.12s, outline 0.08s, box-shadow 0.1s",
        position:            "relative",
      } as React.CSSProperties}
    >
      <button
        className="fcv-box-label"
        style={{ color: c.label, cursor: isDragging ? "grabbing" : "grab" }}
        onPointerDown={e => onPointerDown(e, unit.id)}
        // Selection is dispatched by the global pointerup handler in the
        // parent (which distinguishes click vs drag by movement threshold).
        // We keep a fallback onClick for keyboard/AT users only.
        onClick={e => {
          e.stopPropagation();
          // Only fire if this wasn't a pointer-initiated action already
          // handled by the global pointerup — i.e. a genuine keyboard
          // activation. detail === 0 → non-mouse (keyboard) invocation.
          if (e.detail === 0 && !draggingId) onSelect(unit);
        }}
      >
        {unit.name}
      </button>

      {isDropTarget && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 6, pointerEvents: "none",
          background: "rgba(64,160,96,0.07)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, color: c.label, fontWeight: 700, opacity: 0.75, paddingTop: 22,
        }}>
          {"\u21B3"} drop here
        </div>
      )}

      <div className="fcv-box-content">
        {subs.length > 0 && (
          <div className="fcv-sub-formations">
            {subs.map(ch => (
              <FormationBox
                key={ch.id}
                unit={ch} side={side} depth={depth + 1}
                selectedId={selectedId} draggingId={draggingId} overParentId={overParentId}
                onSelect={onSelect} onPointerDown={onPointerDown} onPointerEnter={onPointerEnter}
              />
            ))}
          </div>
        )}
        {leaves.length > 0 && (
          <div className="fcv-leaf-row">
            {leaves.map(lf => (
              <LeafCard
                key={lf.id} unit={lf} side={side}
                selected={selectedId === lf.id}
                isDragging={draggingId === lf.id}
                onSelect={onSelect} onPointerDown={onPointerDown}
              />
            ))}
          </div>
        )}
        {unit.children.length === 0 && (
          <div className="fcv-empty-formation">
            <NatoSymbol
              standardIdentity={unit.symbol?.standardIdentity ?? side.standardIdentity}
              echelon={unit.echelon}
              icon={(unit.symbol?.icon ?? "generic") as UnitIconType}
              size={36}
            />
            <span className="fcv-leaf-name">{unit.name}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Root drop zone ────────────────────────────────────────────────────────────

const RootDropZone: React.FC<{ active: boolean; onPointerEnter: () => void }> = ({ active, onPointerEnter }) => (
  <div
    data-fcv-drop-target="__root__"
    onPointerEnter={onPointerEnter}
    style={{
      margin: "4px 0 8px", padding: "12px 12px", borderRadius: 4,
      border: `1.5px dashed ${active ? "var(--mil-olive)" : "var(--mil-border)"}`,
      background: active ? "rgba(108, 92, 231,0.12)" : "transparent",
      fontSize: 11, color: active ? "var(--mil-olive-lt)" : "var(--mil-text-3)",
      fontWeight: active ? 700 : 400, textAlign: "center", transition: "all 0.1s",
    }}
  >
    {active ? "\u21B3 Release to promote to top-level" : "\u2191 Drag here to make root"}
  </div>
);

// ── Top-level ─────────────────────────────────────────────────────────────────

interface Props {
  units: UnitNode[];
  side: Side;
  selectedId: string | null;
  onSelect: (unit: UnitNode) => void;
  onReorderUnit?: (unitId: string, newParentId: string | null, position: number) => Promise<void>;
}

export const FormationCardView: React.FC<Props> = ({
  units, side, selectedId, onSelect, onReorderUnit,
}) => {
  const canDrag = !!onReorderUnit;

  const [draggingId,   setDraggingId]   = useState<string | null>(null);
  const [overParentId, setOverParentId] = useState<string | null>(null);
  const [overRoot,     setOverRoot]     = useState(false);
  const [ghostPos,     setGhostPos]     = useState<{ x: number; y: number } | null>(null);

  // Refs so pointer-up closure always sees the latest values
  const draggingIdRef = useRef<string | null>(null);
  const overParentRef = useRef<string | null>(null);
  const overRootRef   = useRef(false);
  const captureRef    = useRef<HTMLElement | null>(null);
  const pointerIdRef  = useRef<number | null>(null);

  // ── Click-vs-drag disambiguation ───────────────────────────────────────
  //   pointerDown captures the pending unit id and pointer position.
  //   A movement beyond DRAG_THRESHOLD_PX promotes it to a "real" drag.
  //   pointerUp before that threshold is treated as a click → onSelect.
  //   This lets us keep preventDefault() on pointerdown (necessary to
  //   suppress text selection during drag) without losing click semantics.
  const DRAG_THRESHOLD_PX = 5;
  const pendingUnitIdRef = useRef<string | null>(null);
  const pointerStartRef  = useRef<{ x: number; y: number } | null>(null);
  const hasDraggedRef    = useRef(false);

  // Live preview: reflow boxes as cursor moves over targets
  const liveUnits = useMemo<UnitNode[]>(() => {
    if (!draggingId) return units;
    const targetParent = overRoot ? null : overParentId;
    if (targetParent === null && !overRoot) return units; // nothing targeted yet
    const preview = applyLiveMove(units, draggingId, targetParent);
    return preview ?? units;
  }, [units, draggingId, overParentId, overRoot]);

  // Global move/up while a pointer is down.
  //
  // A pointerdown ARMS a potential drag but doesn't commit to one until
  // the cursor moves past DRAG_THRESHOLD_PX. Before that threshold:
  //   • pointerup → treated as a click → onSelect
  //   • pointermove → check distance
  //
  // Once the threshold is crossed, dragging state activates and the
  // ghost + drop targets appear.
  const handlePointerMove = useCallback((e: PointerEvent) => {
    // Not armed at all → ignore
    if (!pendingUnitIdRef.current && !draggingIdRef.current) return;

    // Armed but not yet dragging: check threshold
    if (!draggingIdRef.current && pendingUnitIdRef.current) {
      const start = pointerStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

      // Threshold crossed. Always mark as a drag attempt (so pointerup
      // doesn't treat it as a click), but only activate the drag VISUAL
      // state and drop-target logic when the parent has provided a
      // reorder handler (canDrag).
      hasDraggedRef.current = true;
      if (!canDrag) return;

      // Promote pending → active drag
      const unitId          = pendingUnitIdRef.current;
      draggingIdRef.current = unitId;
      overParentRef.current = null;
      overRootRef.current   = false;
      setDraggingId(unitId);
      setOverParentId(null);
      setOverRoot(false);
    }

    setGhostPos({ x: e.clientX, y: e.clientY });

    const dragId = draggingIdRef.current;
    if (!dragId) return;

    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    if (!el) return;

    // Look for the closest ancestor with data-fcv-drop-target set
    const target = el.closest("[data-fcv-drop-target]") as HTMLElement | null;
    if (!target) return;

    const targetId = target.getAttribute("data-fcv-drop-target");
    if (targetId === "__root__") {
      if (!overRootRef.current) {
        overParentRef.current = null;
        overRootRef.current   = true;
        setOverParentId(null);
        setOverRoot(true);
      }
      return;
    }
    if (!targetId || targetId === dragId) return;

    // Cycle guard
    const dn = findNode(units, dragId);
    if (!dn) return;
    if (flattenIds([dn]).includes(targetId)) return;

    if (overParentRef.current !== targetId || overRootRef.current) {
      overParentRef.current = targetId;
      overRootRef.current   = false;
      setOverParentId(targetId);
      setOverRoot(false);
    }
  }, [units, canDrag]);

  const handlePointerUp = useCallback(() => {
    // Read from refs — closure captured at listener attach time.
    const dragId    = draggingIdRef.current;
    const pendingId = pendingUnitIdRef.current;
    const wasClick  = !hasDraggedRef.current && pendingId !== null;
    const hasTarget = overRootRef.current || overParentRef.current !== null;
    const target    = overRootRef.current ? null : overParentRef.current;

    if (captureRef.current !== null && pointerIdRef.current !== null) {
      try { captureRef.current.releasePointerCapture(pointerIdRef.current); } catch { /* */ }
    }
    captureRef.current     = null;
    pointerIdRef.current   = null;
    draggingIdRef.current  = null;
    overParentRef.current  = null;
    overRootRef.current    = false;
    pendingUnitIdRef.current = null;
    pointerStartRef.current  = null;
    hasDraggedRef.current    = false;

    setDraggingId(null);
    setOverParentId(null);
    setOverRoot(false);
    setGhostPos(null);

    // ── Click path: no drag threshold crossed → forward to onSelect
    // We can't rely on the button's native onClick because pointerdown
    // called preventDefault() (needed to suppress text-selection while
    // dragging). Dispatch the select manually here instead.
    if (wasClick && pendingId) {
      const clickedNode = findNode(units, pendingId);
      if (clickedNode) onSelect(clickedNode);
      return;
    }

    // ── Drag path: fire re-parent mutation if we ended over a valid target
    if (dragId && hasTarget && onReorderUnit) {
      void onReorderUnit(dragId, target, 0);
    }
  }, [onReorderUnit, onSelect, units]);

  // Keep the drag-listeners effect for the "already dragging" branch:
  // once threshold has been crossed and setDraggingId has fired, this
  // effect re-attaches listeners for subsequent re-renders. (In practice
  // the same listeners are already attached by pointerdown below — this
  // is defence in depth for React strict-mode double-invocation.)
  useEffect(() => {
    if (!draggingId) return;
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup",   handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup",   handlePointerUp);
    };
  }, [draggingId, handlePointerMove, handlePointerUp]);

  // Stable refs so the pointerdown handler always dispatches to the latest
  // move/up implementations even without being in the dep array.
  const moveRef = useRef(handlePointerMove);
  const upRef   = useRef(handlePointerUp);
  useEffect(() => { moveRef.current = handlePointerMove; }, [handlePointerMove]);
  useEffect(() => { upRef.current   = handlePointerUp;   }, [handlePointerUp]);

  const handlePointerDown = useCallback((e: React.PointerEvent, unitId: string) => {
    if (e.button !== 0) return; // only left click
    e.preventDefault();
    e.stopPropagation();

    // Arm the pending click/drag. Actual drag activation happens in
    // handlePointerMove once the pointer travels past DRAG_THRESHOLD_PX.
    pendingUnitIdRef.current = unitId;
    pointerStartRef.current  = { x: e.clientX, y: e.clientY };
    hasDraggedRef.current    = false;

    captureRef.current    = null;
    pointerIdRef.current  = e.pointerId;
    draggingIdRef.current = null;
    overParentRef.current = null;
    overRootRef.current   = false;

    // Attach ephemeral listeners for this pointer cycle. They forward to
    // the ref-wrapped handlers so we always call the freshest closures
    // (e.g. `onSelect` may have changed since the last render).
    // On teardown they self-detach.
    const onMove = (ev: PointerEvent) => moveRef.current(ev);
    const onUp   = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup",   onUp);
      upRef.current();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup",   onUp);

    // If the widget doesn't support dragging, keep the pending click state
    // so the pointerup handler can still forward the selection. No visual
    // drag state is triggered because handlePointerMove will only promote
    // to draggingId when canDrag is true; add that guard below.
    if (!canDrag) {
      // Suppress drag activation in the move handler by wiping the pending
      // id ONLY on threshold cross so click still fires if pointer barely
      // moves. See threshold-cross branch in handlePointerMove for logic.
      // Nothing else to do here — the ephemeral listeners handle the rest.
    }
  }, [canDrag]);

  const handlePointerEnter = useCallback((targetId: string) => {
    if (!draggingId || targetId === draggingId) return;
    const dn = findNode(units, draggingId);
    if (!dn) return;
    if (flattenIds([dn]).includes(targetId)) return;
    overParentRef.current = targetId;
    overRootRef.current   = false;
    setOverParentId(targetId);
    setOverRoot(false);
  }, [draggingId, units]);

  const handleRootEnter = useCallback(() => {
    if (!draggingId) return;
    overParentRef.current = null;
    overRootRef.current   = true;
    setOverParentId(null);
    setOverRoot(true);
  }, [draggingId]);

  const draggingNode = draggingId ? findNode(units, draggingId) : null;

  if (units.length === 0) {
    return (
      <div className="fcv-empty">
        <span style={{ fontSize: 28, opacity: 0.25 }}>&#8853;</span>
        <span>No units — add a root formation to begin.</span>
      </div>
    );
  }

  return (
    <>
      {draggingNode && ghostPos && <Ghost unit={draggingNode} x={ghostPos.x} y={ghostPos.y} />}

      <div className="fcv-root" style={{ touchAction: "none", userSelect: "none" }}>

        {canDrag && (
          <div style={{
            fontSize: 10, color: "var(--mil-text-3)", fontStyle: "italic",
            textAlign: "center", padding: "0 0 4px",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <span>&#10022;</span> Drag any label or card to re-parent &middot; boxes resize live
          </div>
        )}

        {canDrag && draggingId && (
          <RootDropZone active={overRoot} onPointerEnter={handleRootEnter} />
        )}

        {liveUnits.map(unit => (
          <FormationBox
            key={unit.id}
            unit={unit} side={side} depth={0}
            selectedId={selectedId}
            draggingId={draggingId}
            overParentId={overRoot ? null : overParentId}
            onSelect={onSelect}
            onPointerDown={handlePointerDown}
            onPointerEnter={handlePointerEnter}
          />
        ))}
      </div>
    </>
  );
};
