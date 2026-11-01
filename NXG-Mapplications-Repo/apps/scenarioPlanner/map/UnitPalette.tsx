// scenarioPlanning/components/UnitPalette.tsx
// Sidebar listing of unit templates grouped by category + tactic orders tab.

import { useState, useMemo, useRef } from "react";
import ms from "milsymbol";
import {
  UNIT_TEMPLATES,
  CATEGORIES,
  HIERARCHY_LEVELS,
  hierarchyOf,
  withAffiliation,
} from "./unitTemplates";
import type { UnitTemplate } from "./types";
import { getTacticOrders, TACTIC_CATEGORIES, type TacticOrder, type TacticCategory } from "@acc/app6d/core";
import { APP_CATALOG } from "../shared/appCatalog";
import { useSvgInnerHtml } from "../../../lib/sanitizeSvg";

interface Props {
  placingTemplateId: string | null;
  placedCount: number;
  /**
   * Current placement affiliation. Drives both the toggle button UI and
   * the SIDC used to render palette previews so operators see exactly the
   * symbol they'll drop on the map (friendly = blue, hostile = red).
   */
  affiliation: "friend" | "hostile";
  onSelect: (template: UnitTemplate) => void;
  onClearAll: () => void;
  onToggleAffiliation: () => void;
  /** Called when an order row is clicked — places the order immediately at the map centre. */
  onPlaceOrder?: (order: TacticOrder) => void;
}

// square:true gives equal width/height and a 0,0-anchored viewBox so the
// SVG scales correctly when used as an <img> src.
function sidcToDataUri(sidc: string, size = 36): string {
  try {
    const sym = new ms.Symbol(sidc, { size, square: true });
    const svg = sym.asSVG();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return "";
  }
}

// Category colour palette. Kept aligned with the expanded ORBAT-coherent
// categories exported from ../unitTemplates.ts. Any missing key falls back
// to the neutral slate colour in the lookup below.
const CATEGORY_COLOURS: Record<string, string> = {
  HQ: "#7b1fa2",
  Infantry: "#1565c0",
  Armour: "#2e7d32",
  Recce: "#00695c",
  Artillery: "#e65100",
  "Air Defence": "#b71c1c",
  Aviation: "#00838f",
  UAS: "#0277bd",
  Engineer: "#5d4037",
  Signal: "#4527a0",
  CBRN: "#558b2f",
  Medical: "#c62828",
  Logistics: "#4e342e",
  "Special Forces": "#212121",
  "Military Police": "#455a64",
  Naval: "#1a237e",
};

const HIERARCHY_ALL = "__all__";

type SidebarTab = "units" | "orders";

export function UnitPalette({
  placingTemplateId,
  placedCount,
  affiliation,
  onSelect,
  onClearAll,
  onToggleAffiliation,
  onPlaceOrder,
}: Props) {
  // Read the registry LIVE, at component-mount time — by then every module's
  // top-level code (including @tactical-graphics/app6d/symbols's registration
  // side effect) has finished executing, regardless of import-order timing.
  // Do NOT import the static TACTIC_ORDERS snapshot here; it can be frozen
  // before registration completes depending on bundler evaluation order.
  const TACTIC_ORDERS = useMemo(() => getTacticOrders(APP_CATALOG), []);
  const [tab, setTab] = useState<SidebarTab>("units");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [hierarchyFilter, setHierarchyFilter] = useState<string>(HIERARCHY_ALL);
  const [activeTacticCategory, setActiveTacticCategory] = useState<TacticCategory | null>(null);

  const visibleCategories = activeCategory ? [activeCategory] : [...CATEGORIES];

  // Pre-compute which hierarchy levels actually exist across the palette
  // so the dropdown only lists doctrinal echelons we can actually filter
  // on. Keeps the doctrinal order defined in HIERARCHY_LEVELS.
  const availableHierarchies = useMemo(() => {
    const present = new Set(UNIT_TEMPLATES.map((u) => hierarchyOf(u.echelon)));
    return HIERARCHY_LEVELS.filter((h) => present.has(h));
  }, []);

  const hostile = affiliation === "hostile";

  return (
    <div
      style={{
        width: 260,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "#0a1520",
        borderLeft: "1px solid #1e3a4a",
        overflow: "hidden",
      }}
    >
      {/* Tab switcher */}
      <div style={{ display: "flex", flexShrink: 0, borderBottom: "1px solid #1e3a4a" }}>
        {(["units", "orders"] as SidebarTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "8px 0",
              background: tab === t ? "#0d1b2a" : "#070f18",
              color: tab === t ? "#90caf9" : "#607d8b",
              border: "none",
              borderBottom: tab === t ? "2px solid #4fc3f7" : "2px solid transparent",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: tab === t ? 600 : 400,
              letterSpacing: "0.04em",
              textTransform: "capitalize",
              transition: "all 0.12s",
            }}
          >
            {t === "units" ? "Units" : "Orders"}
          </button>
        ))}
      </div>

      {/* Header */}
      <div
        style={{
          padding: "10px 14px 8px",
          borderBottom: "1px solid #1e3a4a",
          flexShrink: 0,
          display: tab === "units" ? undefined : "none",
        }}
      >

        {/* Blue vs Red force toggle. Uses the same red as the existing
            hostile milsymbol swatch so it visually maps to the map colour. */}
        <button
          onClick={onToggleAffiliation}
          style={{
            width: "100%",
            padding: "6px 10px",
            marginBottom: 8,
            background: hostile ? "#b71c1c" : "#1565c0",
            color: "#fff",
            border: `1px solid ${hostile ? "#7f0000" : "#0d47a1"}`,
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            transition: "background 0.15s",
          }}
          title={`Currently placing ${hostile ? "opponent (red)" : "friendly (blue)"} forces — click to switch`}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#fff",
                opacity: 0.9,
              }}
            />
            {hostile ? "Opponent Forces (Red)" : "Friendly Forces (Blue)"}
          </span>
          <span style={{ fontSize: 10, opacity: 0.85, fontWeight: 400 }}>
            ⇄ switch
          </span>
        </button>

        {/* Hierarchy (echelon) dropdown filter. Complements the category
            chips: chips slice by function (Infantry / Armour / …), the
            dropdown slices by size / echelon (Brigade / Battalion / …). */}
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: "#607d8b",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Hierarchy
          </span>
          <select
            value={hierarchyFilter}
            onChange={(e) => setHierarchyFilter(e.target.value)}
            style={{
              background: "#0d1b2a",
              color: "#e0e0e0",
              border: "1px solid #2a4a5a",
              borderRadius: 4,
              padding: "4px 6px",
              fontSize: 12,
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value={HIERARCHY_ALL}>All echelons</option>
            {availableHierarchies.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>

        {/* Category filter chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <CategoryChip
            label="All"
            colour="#37474f"
            active={activeCategory === null}
            onClick={() => setActiveCategory(null)}
          />
          {CATEGORIES.map((cat) => (
            <CategoryChip
              key={cat}
              label={cat}
              colour={CATEGORY_COLOURS[cat] ?? "#37474f"}
              active={activeCategory === cat}
              onClick={() =>
                setActiveCategory((prev) => (prev === cat ? null : cat))
              }
            />
          ))}
        </div>
      </div>

      {/* Orders list */}
      {tab === "orders" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Category chips */}
          <div style={{ padding: "8px 14px", borderBottom: "1px solid #1e3a4a", flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 4 }}>
            <CategoryChip label="All" colour="#37474f" active={activeTacticCategory === null} onClick={() => setActiveTacticCategory(null)} />
            {TACTIC_CATEGORIES.map((cat: TacticCategory) => (
              <CategoryChip key={cat} label={cat} colour="#37474f" active={activeTacticCategory === cat} onClick={() => setActiveTacticCategory((prev: TacticCategory | null) => prev === cat ? null : cat)} />
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {(activeTacticCategory ? [activeTacticCategory] : TACTIC_CATEGORIES).map((cat: TacticCategory) => {
              const orders = TACTIC_ORDERS.filter((o: TacticOrder) => o.category === cat);
              if (orders.length === 0) return null;
              return (
                <div key={cat}>
                  <div style={{ padding: "6px 14px 4px", fontSize: 10, color: "#607d8b", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, borderBottom: "1px solid #1a2b3c" }}>
                    {cat}
                  </div>
                  {orders.map((order: TacticOrder) => (
                    <OrderRow key={order.id} order={order} onClick={() => onPlaceOrder?.(order)} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Unit list */}
      <div style={{ flex: 1, overflowY: "auto", display: tab === "units" ? undefined : "none" }}>
        {visibleCategories.map((cat) => {
          const units = UNIT_TEMPLATES.filter(
            (u) =>
              u.category === cat &&
              (hierarchyFilter === HIERARCHY_ALL ||
                hierarchyOf(u.echelon) === hierarchyFilter),
          );
          if (units.length === 0) return null;
          return (
            <div key={cat}>
              <div
                style={{
                  padding: "6px 14px 4px",
                  fontSize: 10,
                  color: CATEGORY_COLOURS[cat] ?? "#607d8b",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  fontWeight: 600,
                  borderBottom: "1px solid #1a2b3c",
                }}
              >
                {cat}
              </div>
              {units.map((unit) => (
                <UnitRow
                  key={unit.id}
                  unit={unit}
                  affiliation={affiliation}
                  isActive={placingTemplateId === unit.id}
                  onClick={() => onSelect(unit)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid #1e3a4a",
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 12, color: "#607d8b" }}>
          {placedCount} unit{placedCount !== 1 ? "s" : ""} placed
        </span>
        {placedCount > 0 && (
          <button
            onClick={onClearAll}
            style={{
              background: "none",
              border: "1px solid #3a2a2a",
              borderRadius: 4,
              color: "#ef9a9a",
              cursor: "pointer",
              fontSize: 11,
              padding: "3px 10px",
            }}
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  colour,
  active,
  onClick,
}: {
  label: string;
  colour: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "2px 8px",
        fontSize: 10,
        background: active ? colour : "transparent",
        color: active ? "#fff" : "#90a4ae",
        border: `1px solid ${active ? colour : "#2a4a5a"}`,
        borderRadius: 10,
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        transition: "all 0.12s",
      }}
    >
      {label}
    </button>
  );
}

function UnitRow({
  unit,
  affiliation,
  isActive,
  onClick,
}: {
  unit: UnitTemplate;
  affiliation: "friend" | "hostile";
  isActive: boolean;
  onClick: () => void;
}) {
  // Preview reflects the *active* affiliation so switching to Red instantly
  // repaints the palette in hostile red — matches what will land on the map.
  const previewSidc = withAffiliation(unit.sidc, affiliation);
  const dataUri = sidcToDataUri(previewSidc);

  return (
    <div
      onClick={onClick}
      title={unit.description}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 14px",
        cursor: "pointer",
        background: isActive ? "#1a3a5c" : "transparent",
        borderLeft: isActive ? "3px solid #4fc3f7" : "3px solid transparent",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLDivElement).style.background = "#0f2030";
      }}
      onMouseLeave={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      {/* Milsymbol icon */}
      <div style={{ width: 32, height: 32, flexShrink: 0 }}>
        {dataUri && (
          <img
            src={dataUri}
            width={32}
            height={32}
            alt={unit.label}
            style={{ display: "block" }}
          />
        )}
      </div>

      {/* Label + description */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: isActive ? "#e0f7fa" : "#e0e0e0",
            fontWeight: isActive ? 600 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {unit.label}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#607d8b",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {unit.description}
        </div>
      </div>

      {/* "Place" indicator */}
      {isActive && (
        <span
          style={{
            fontSize: 10,
            color: "#4fc3f7",
            flexShrink: 0,
            fontFamily: "monospace",
          }}
        >
          ↓
        </span>
      )}
    </div>
  );
}

// ── Order row ─────────────────────────────────────────────────────────────────

function OrderRow({ order, onClick }: { order: TacticOrder; onClick: () => void }) {
  const iconSvg = order.icon("#2fbf71");
  const iconRef = useRef<SVGGElement | null>(null);
  useSvgInnerHtml(iconRef, iconSvg);

  return (
    <div
      onClick={onClick}
      title={order.description || order.label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 14px",
        cursor: "pointer",
        borderLeft: "3px solid transparent",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#0f2030"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      {/* Tactic icon — uses useSvgInnerHtml to avoid dangerouslySetInnerHTML */}
      <div style={{ width: 36, height: 36, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="36" height="36" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
          <g ref={iconRef} />
        </svg>
      </div>

      {/* Label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "#e0e0e0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {order.label}
        </div>
        {order.description && (
          <div style={{ fontSize: 10, color: "#607d8b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {order.description}
          </div>
        )}
      </div>

      {/* Place hint */}
      <span style={{ fontSize: 10, color: "#4fc3f7", flexShrink: 0, opacity: 0.6 }}>+</span>
    </div>
  );
}
