// src/apps/scenarioPlanner/components/MapContextMenu/MapContextMenu.tsx
//
// Right-click context menu for the map. Shows a small dropdown at the
// click position with "Place Unit" and "Drawing" options. Each opens a
// selection popup; the chosen item is placed at the right-click coords.

import ms from "milsymbol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  UNIT_ARCHETYPES,
  CATEGORIES,
  getEchelonsForArchetype,
  archetypeBaseSidc,
  archetypeSidcForEchelon,
  withAffiliation,
  type UnitArchetype,
  type EchelonOption,
} from "../../map/unitTemplates";
import {
  getTacticOrders,
  TACTIC_CATEGORIES,
  type TacticOrder,
  type TacticCategory,
} from "@acc/app6d/core";
import { APP_CATALOG } from "../../shared/appCatalog";
import { resolveDocSidc } from "../../shared/docSidc";
import type { UnitTemplate } from "../../map/types";
import type { ArrowStyle } from "../MapItemSidebar/MapItemSidebar";
import { useSvgInnerHtml } from "@/shared/lib/sanitizeSvg";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContextMenuState {
  lat: number;
  lng: number;
  screenX: number;
  screenY: number;
}

type SubMenu = null | "unit" | "drawing";

interface Props {
  /** Current context menu state — null when closed. */
  contextMenu: ContextMenuState | null;
  onClose: () => void;
  /** Called when a unit template is selected for placement. */
  onPlaceUnit: (template: UnitTemplate, lat: number, lng: number) => void;
  /** Called when a drawing/tactic is selected for placement. */
  onPlaceDrawing: (style: ArrowStyle, lat: number, lng: number) => void;
}

// ── Milsymbol renderer helper ─────────────────────────────────────────────────

function renderSidc(sidc: string, size = 28): string {
  try {
    const sym = new ms.Symbol(sidc, { size });
    return sym.asSVG();
  } catch {
    return "";
  }
}

// ── Small sub-components to avoid hooks-in-loops violations ──────────────────

/** Renders a milsymbol SVG safely via useSvgInnerHtml (no dangerouslySetInnerHTML). */
function MilSymbolIcon({ svg, size }: { svg: string; size: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useSvgInnerHtml(ref, svg);
  return (
    <span
      ref={ref}
      style={{ width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MapContextMenu({ contextMenu, onClose, onPlaceUnit, onPlaceDrawing }: Props) {
  const [subMenu, setSubMenu] = useState<SubMenu>(null);
  const [search, setSearch] = useState("");
  const [selectedArchetype, setSelectedArchetype] = useState<UnitArchetype | null>(null);
  const [activeCat, setActiveCat] = useState<string>("All");
  const [tacticCat, setTacticCat] = useState<TacticCategory | "All">("All");
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu, onClose]);

  // Reset state when menu opens
  useEffect(() => {
    if (contextMenu) {
      setSubMenu(null);
      setSearch("");
      setSelectedArchetype(null);
      setActiveCat("All");
    }
  }, [contextMenu]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const filteredArchetypes = useMemo(() => {
    let list = UNIT_ARCHETYPES;
    if (activeCat !== "All") list = list.filter((a) => a.category === activeCat);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.label.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
    }
    return list;
  }, [activeCat, search]);

  const allTacticOrders = useMemo(() => getTacticOrders(APP_CATALOG), []);
  const tacticOrders = useMemo(
    () => tacticCat === "All" ? allTacticOrders : allTacticOrders.filter((o: TacticOrder) => o.category === tacticCat),
    [allTacticOrders, tacticCat],
  );

  const handleSelectEchelon = useCallback(
    (arch: UnitArchetype, ech: EchelonOption) => {
      if (!contextMenu) return;
      const sidc = archetypeSidcForEchelon(arch, ech);
      const template: UnitTemplate = {
        id: `${arch.id}-${ech.echelonValue}`,
        label: `${arch.label} (${ech.label})`,
        description: arch.description,
        sidc,
        entityType: arch.entityType,
        echelon: ech.echelonValue as any,
        militaryService: arch.militaryService,
        category: arch.category as any,
      };
      onPlaceUnit(template, contextMenu.lat, contextMenu.lng);
      onClose();
    },
    [contextMenu, onPlaceUnit, onClose],
  );

  const handleSelectTactic = useCallback(
    (order: TacticOrder) => {
      if (!contextMenu) return;
      const style: ArrowStyle = {
        line: "solid",
        endpoint: "arrow-filled",
        tacticSidc: order.sidc,
        tacticLabel: order.label,
        docSidc: resolveDocSidc(order.label),
      };
      onPlaceDrawing(style, contextMenu.lat, contextMenu.lng);
      onClose();
    },
    [contextMenu, onPlaceDrawing, onClose],
  );

  if (!contextMenu) return null;

  // Position the menu near the click, clamped to viewport
  const menuStyle: React.CSSProperties = {
    position: "fixed",
    left: contextMenu.screenX,
    top: contextMenu.screenY,
    zIndex: 9999,
  };

  // ── Initial dropdown ──────────────────────────────────────────────────────
  if (!subMenu) {
    return (
      <div ref={menuRef} style={menuStyle}>
        <div style={{
          background: "rgba(17,19,24,0.95)", border: "1px solid var(--border-default)",
          borderRadius: 6, padding: 4, minWidth: 160,
          backdropFilter: "blur(8px)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          <button type="button" onClick={() => setSubMenu("unit")} style={dropdownItemStyle}>
            <span style={{ fontSize: 14 }}>⬡</span> Place Unit
          </button>
          <button type="button" onClick={() => setSubMenu("drawing")} style={dropdownItemStyle}>
            <span style={{ fontSize: 14 }}>↗</span> Drawing
          </button>
          <div style={{ height: 1, background: "var(--border-default)", margin: "4px 0" }} />
          <button type="button" onClick={() => { onClose(); }} style={{ ...dropdownItemStyle, color: "var(--text-muted)" }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Unit selection popup ──────────────────────────────────────────────────
  if (subMenu === "unit") {
    return (
      <div ref={menuRef} style={{ ...menuStyle, left: Math.min(contextMenu.screenX, window.innerWidth - 380) }}>
        <div style={{
          background: "rgba(17,19,24,0.97)", border: "1px solid var(--border-default)",
          borderRadius: 8, width: 360, maxHeight: 440,
          backdropFilter: "blur(8px)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ padding: "10px 12px 6px", borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#e0e4ec", letterSpacing: "0.05em" }}>
                SELECT UNIT
              </span>
              <button type="button" onClick={() => setSubMenu(null)} style={{ ...pillBtnStyle, fontSize: 10 }}>← Back</button>
            </div>
            <input
              type="text"
              placeholder="Search units…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              style={searchInputStyle}
            />
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
              {["All", ...CATEGORIES].map((cat) => (
                <button key={cat} type="button" onClick={() => setActiveCat(cat)}
                  style={{ ...chipStyle, ...(activeCat === cat ? chipActiveStyle : {}) }}>
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Archetype list */}
          <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
            {filteredArchetypes.map((arch) => {
              const baseSidc = archetypeBaseSidc(arch);
              const svg = renderSidc(withAffiliation(baseSidc, "friend"), 24);
              const isExpanded = selectedArchetype?.id === arch.id;
              const echelons = isExpanded ? getEchelonsForArchetype(arch) : [];

              return (
                <div key={arch.id} style={{ marginBottom: 2 }}>
                  <button type="button" onClick={() => setSelectedArchetype(isExpanded ? null : arch)}
                    style={{
                      ...archetypeRowStyle,
                      background: isExpanded ? "rgba(74,144,217,0.1)" : "transparent",
                      borderColor: isExpanded ? "#4A90D966" : "transparent",
                    }}>
                    <MilSymbolIcon svg={svg} size={28} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#e0e4ec" }}>{arch.label}</div>
                      <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{arch.description}</div>
                    </div>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{isExpanded ? "▼" : "▶"}</span>
                  </button>

                  {isExpanded && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "4px 4px 4px 36px" }}>
                      {echelons.map((ech) => {
                        const echSidc = archetypeSidcForEchelon(arch, ech);
                        const echSvg = renderSidc(withAffiliation(echSidc, "friend"), 20);
                        return (
                          <button key={ech.echelonValue} type="button" onClick={() => handleSelectEchelon(arch, ech)}
                            style={echelonBtnStyle}>
                            <MilSymbolIcon svg={echSvg} size={22} />
                            <span style={{ fontSize: 9, color: "#c8cdd8" }}>{ech.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Drawing / tactic selection popup ──────────────────────────────────────
  if (subMenu === "drawing") {
    return (
      <div ref={menuRef} style={{ ...menuStyle, left: Math.min(contextMenu.screenX, window.innerWidth - 340) }}>
        <div style={{
          background: "rgba(17,19,24,0.97)", border: "1px solid var(--border-default)",
          borderRadius: 8, width: 320, maxHeight: 400,
          backdropFilter: "blur(8px)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ padding: "10px 12px 6px", borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#e0e4ec", letterSpacing: "0.05em" }}>
                SELECT TACTIC / DRAWING
              </span>
              <button type="button" onClick={() => setSubMenu(null)} style={{ ...pillBtnStyle, fontSize: 10 }}>← Back</button>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {TACTIC_CATEGORIES.map((cat) => (
                <button key={cat} type="button" onClick={() => setTacticCat(cat)}
                  style={{ ...chipStyle, ...(tacticCat === cat ? chipActiveStyle : {}) }}>
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Tactic list */}
          <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
            {tacticOrders.map((order) => (
              <button key={order.sidc} type="button" onClick={() => handleSelectTactic(order)}
                style={archetypeRowStyle}>
                <span style={{ fontSize: 16, width: 28, textAlign: "center" }}>↗</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#e0e4ec" }}>{order.label}</div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{order.sidc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const dropdownItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, width: "100%",
  padding: "7px 12px", background: "transparent", border: "none",
  borderRadius: 4, color: "#c8cdd8", fontSize: 12, fontWeight: 500,
  cursor: "pointer", textAlign: "left", transition: "background 0.1s",
};

const searchInputStyle: React.CSSProperties = {
  width: "100%", padding: "6px 10px", background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--border-default)", borderRadius: 4, color: "#e0e4ec",
  fontSize: 11, outline: "none", boxSizing: "border-box",
};

const chipStyle: React.CSSProperties = {
  padding: "2px 8px", fontSize: 9, fontWeight: 600, borderRadius: 10,
  border: "1px solid var(--border-default)", background: "transparent", color: "#8b95a8",
  cursor: "pointer", transition: "all 0.1s",
};

const chipActiveStyle: React.CSSProperties = {
  background: "rgba(74,144,217,0.15)", borderColor: "#4A90D966", color: "#4A90D9",
};

const pillBtnStyle: React.CSSProperties = {
  padding: "3px 8px", background: "rgba(255,255,255,0.06)",
  border: "1px solid var(--border-default)", borderRadius: 4, color: "#8b95a8",
  cursor: "pointer", fontSize: 10, fontWeight: 600,
};

const archetypeRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, width: "100%",
  padding: "6px 8px", background: "transparent", border: "1px solid transparent",
  borderRadius: 5, cursor: "pointer", textAlign: "left", transition: "background 0.1s",
};

const echelonBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, padding: "4px 8px",
  background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-default)",
  borderRadius: 4, cursor: "pointer", transition: "background 0.1s",
};

