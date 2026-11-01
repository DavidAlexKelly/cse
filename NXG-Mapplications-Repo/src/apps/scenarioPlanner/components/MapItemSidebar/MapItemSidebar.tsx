// src/map/ScenarioPlanning/components/MapItemSidebar/MapItemSidebar.tsx
//
// Redesigned Map Items palette for Scenario Planning.
//
// UX flow
// ───────
// 1. User types in the search box or clicks a category chip to find a
//    UNIT TYPE (archetype).
// 2. Clicking an archetype card expands an inline echelon picker beneath it.
// 3. Clicking an echelon fires onSelectUnitTemplate with the fully resolved
//    UnitTemplate (type SIDC + echelon glyph), putting the tool into
//    "placeUnit" mode exactly as before.
import ms from "milsymbol";
import { useMemo, useState } from "react";
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

export type MapTool = "select" | "placeUnit" | "drawArrow" | "placeMilx" | "placeObjective" | "eraser" | "assignOrder";

type SectionTab = "units" | "drawing";

// ── Arrow style types (kept for backward-compat) ──────────────────────────
export type LineStyle = "solid" | "dashed" | "dotted" | "double" | "zigzag" | "blocky";
export type EndpointStyle = "none" | "arrow" | "arrow-filled" | "circle" | "square" | "bar";
export interface ArrowStyle {
  line: LineStyle;
  endpoint: EndpointStyle;
  /** @tactical-graphics/app6d renderer key for the drawn graphic (e.g. "SVGOCCUPY") */
  tacticSidc?: string;
  /** Human label of the tactic (e.g. "Occupy") */
  tacticLabel?: string;
  /** Real doctrinal APP-6D SIDC for this tactic (e.g. "GFTPO---------G"),
   * resolved from tacticLabel via the doctrinal task catalog. Undefined
   * for pure control-measure graphics with no single canonical SIDC. */
  docSidc?: string;
}

// ── Props ─────────────────────────────────────────────────────────────────
interface Props {
  activeTool: MapTool;
  placingTemplate: UnitTemplate | null;
  onSelectTool: (tool: MapTool) => void;
  onSelectUnitTemplate: (template: UnitTemplate) => void;
  onArrowStyleChange?: (style: ArrowStyle) => void;
  phaseColour?: string;
  readOnly?: boolean;
  affiliation: "friend" | "hostile";
  onToggleAffiliation: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function sidcToDataUri(sidc: string, size = 28): string {
  try {
    const sym = new ms.Symbol(sidc, { size, square: true });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sym.asSVG())}`;
  } catch { return ""; }
}

// ── Archetype card ──────────────────────────────────────────────────────
function ArchetypeCard({
  archetype, affiliation, isExpanded, activeTemplateId,
  onExpand, onSelectEchelon, readOnly,
}: {
  archetype: UnitArchetype;
  affiliation: "friend" | "hostile";
  isExpanded: boolean;
  activeTemplateId: string | null;
  onExpand: () => void;
  onSelectEchelon: (template: UnitTemplate) => void;
  readOnly?: boolean;
}) {
  const baseSidc = withAffiliation(archetypeBaseSidc(archetype), affiliation);
  const baseUri = sidcToDataUri(baseSidc, 26);
  const echelons = getEchelonsForArchetype(archetype);
  const isAnyActive = !!(activeTemplateId?.startsWith(`${archetype.id}__`));
  return (
    <div className={[
      "sp-items__archetype-card",
      isExpanded ? "sp-items__archetype-card--expanded" : "",
      isAnyActive ? "sp-items__archetype-card--placing" : "",
    ].filter(Boolean).join(" ")}>
      <button
        className={"sp-items__archetype-header"}
        onClick={onExpand}
        disabled={readOnly}
        aria-expanded={isExpanded}
        title={archetype.description}
      >
        <div className={"sp-items__archetype-icon"}>
          {baseUri && <img src={baseUri} width={26} height={26} alt="" aria-hidden="true" />}
        </div>
        <div className={"sp-items__archetype-info"}>
          <span className={"sp-items__archetype-label"}>{archetype.label}</span>
          <span className={"sp-items__archetype-desc"}>{archetype.description}</span>
        </div>
        <span className={"sp-items__archetype-chevron"} aria-hidden="true">
          {isExpanded ? "▾" : "▸"}
        </span>
      </button>
      {isExpanded && (
        <div className={"sp-items__echelon-picker"}>
          {echelons.map((echelon: EchelonOption) => {
            const tplId = `${archetype.id}__${echelon.echelonValue || "platform"}`;
            const isActive = activeTemplateId === tplId;
            const eSidc = withAffiliation(archetypeSidcForEchelon(archetype, echelon), affiliation);
            const eUri = sidcToDataUri(eSidc, 22);
            const template: UnitTemplate = {
              id: tplId,
              label: echelon.echelonValue
                ? `${archetype.label} — ${echelon.label}`
                : archetype.label,
              description: archetype.description,
              sidc: archetypeSidcForEchelon(archetype, echelon),
              entityType: archetype.entityType,
              echelon: echelon.echelonValue as UnitTemplate["echelon"],
              militaryService: archetype.militaryService,
              category: archetype.category,
            };
            return (
              <button
                key={echelon.label}
                className={`sp-items__echelon-row ${isActive ? "sp-items__echelon-row--active" : ""}`}
                onClick={() => !readOnly && onSelectEchelon(template)}
                disabled={readOnly}
                aria-pressed={isActive}
                title={`Place ${archetype.label} · ${echelon.label}\nSIDC: ${template.sidc}`}
              >
                <div className={"sp-items__echelon-icon"}>
                  {eUri && <img src={eUri} width={22} height={22} alt="" aria-hidden="true" />}
                </div>
                <span className={"sp-items__echelon-label"}>{echelon.label}</span>
                {isActive && <span className={"sp-items__echelon-active-dot"} aria-hidden="true">↓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tactic order card ─────────────────────────────────────────────────────
function TacticCard({
  order, isActive, onSelect, readOnly, phaseColour,
}: {
  order: TacticOrder;
  isActive: boolean;
  onSelect: () => void;
  readOnly?: boolean;
  phaseColour: string;
}) {
  const iconColour = isActive ? phaseColour : "#7a8fa8";
  const iconSvg = order.icon(iconColour);
  const iconDataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">${iconSvg}</svg>`
  )}`;
  return (
    <button
      className={`sp-items__tactic-card ${isActive ? "sp-items__tactic-card--active" : ""}`}
      onClick={() => !readOnly && onSelect()}
      disabled={readOnly}
      aria-pressed={isActive}
      title={`${order.label}\n${order.description}`}
    >
      <div className={"sp-items__tactic-icon"}>
        <img src={iconDataUri} width="40" height="40" aria-hidden="true" alt="" />
      </div>
      <div className={"sp-items__tactic-info"}>
        <span className={"sp-items__tactic-label"} style={isActive ? { color: phaseColour } : undefined}>
          {order.label}
        </span>
        <span className={"sp-items__tactic-desc"}>{order.description}</span>
      </div>
      {isActive && <span className={"sp-items__tactic-active-dot"} style={{ color: phaseColour }} aria-hidden="true">↓</span>}
    </button>
  );
}

// ── Main component ──────────────────────────────────────────────────────
export function MapItemSidebar({
  activeTool, placingTemplate, onSelectTool, onSelectUnitTemplate,
  onArrowStyleChange, phaseColour, readOnly, affiliation, onToggleAffiliation,
}: Props) {
  // Read the registry LIVE, at component-mount time — by then every module's
  // top-level code (including @tactical-graphics/app6d/symbols's registration
  // side effect) has finished executing, regardless of import-order timing.
  // Do NOT import the static TACTIC_ORDERS snapshot here; it can be frozen
  // before registration completes depending on bundler evaluation order.
  const TACTIC_ORDERS = useMemo(() => getTacticOrders(APP_CATALOG), []);
  const [open, setOpen]               = useState(true);
  const [section, setSection]         = useState<SectionTab>("units");
  const [search, setSearch]           = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [tacticSearch, setTacticSearch] = useState("");
  const [tacticCategory, setTacticCategory] = useState<TacticCategory | "All">("All");
  const [activeTacticId, setActiveTacticId] = useState<string | null>(null);

  const previewColour = phaseColour ?? "#4a90d9";
  const hostile = affiliation === "hostile";

  function handleSelectEchelon(template: UnitTemplate) {
    onSelectUnitTemplate(template);
    onSelectTool("placeUnit");
  }

  function handleSelectTactic(order: TacticOrder) {
    setActiveTacticId(order.id);
    onArrowStyleChange?.({
      line: "solid",
      endpoint: "arrow-filled",
      tacticSidc: order.sidc,
      tacticLabel: order.label,
      docSidc: resolveDocSidc(order.label),
    });
    // New flow: always enter assignOrder mode — the next unit click places
    // the order at that unit's position and assigns it immediately.
    // The old drawArrow / placeMilx two-click draw gesture is no longer used
    // when selecting from the tactic palette.
    onSelectTool("assignOrder");
  }

  const isArrowActive = activeTool === "assignOrder" || activeTool === "drawArrow" || activeTool === "placeMilx";

  if (!isArrowActive && activeTacticId !== null) {
    setActiveTacticId(null);
  }

  const filteredTactics = useMemo(() => {
    const q = tacticSearch.trim().toLowerCase();
    return TACTIC_ORDERS.filter((o: TacticOrder) => {
      if (tacticCategory !== "All" && o.category !== tacticCategory) return false;
      if (!q) return true;
      return (
        o.label.toLowerCase().includes(q) ||
        o.description.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q) ||
        (o.keywords ?? []).some((k: string) => k.toLowerCase().includes(q))
      );
    });
  }, [TACTIC_ORDERS, tacticCategory, tacticSearch]);

  const filteredArchetypes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return UNIT_ARCHETYPES.filter((a) => {
      if (activeCategory !== "All" && a.category !== activeCategory) return false;
      if (!q) return true;
      return (
        a.label.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        (a.keywords ?? []).some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [activeCategory, search]);

  const grouped = useMemo(() => {
    const out: { category: string; items: UnitArchetype[] }[] = [];
    for (const cat of CATEGORIES) {
      const items = filteredArchetypes.filter((a) => a.category === cat);
      if (items.length > 0) out.push({ category: cat, items });
    }
    return out;
  }, [filteredArchetypes]);

  return (
    <div className={"sp-items-sidebar"}>
      <div className={"sp-items__tab-strip"}>
        <button
          className={"sp-items__tab-btn"}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        >
          <span className={"sp-items__tab-icon"} aria-hidden="true">{open ? "◀" : "▶"}</span>
          <span className={"sp-items__tab-label"}>Map Items</span>
        </button>
      </div>

      <div className={`sp-items-panel ${open ? "sp-items-panel--open" : ""}`}>
        <div className={"sp-items-panel__inner"}>
          <div className={"sp-items__header"}>
            <span className={"sp-items__header-label"}>Map Items</span>
            {phaseColour && <span className={"sp-items__phase-dot"} style={{ backgroundColor: phaseColour }} />}
          </div>

          <div className={"sp-items__section-tabs"}>
            <button
              className={`sp-items__section-tab ${section === "units" ? "sp-items__section-tab--active" : ""}`}
              onClick={() => setSection("units")}
            >⬡ Units</button>
            <button
              className={`sp-items__section-tab ${section === "drawing" ? "sp-items__section-tab--active" : ""}`}
              onClick={() => setSection("drawing")}
            >✏ Drawing</button>
          </div>

          {section === "units" && (
            <>
              <div className={"sp-items__affil-row"}>
                <button
                  type="button"
                  className={`sp-items__affil-btn ${!hostile ? "sp-items__affil-btn--active" : ""}`}
                  data-force="blue"
                  onClick={() => { if (hostile) onToggleAffiliation(); }}
                  disabled={readOnly}
                  aria-pressed={!hostile}
                  title="Place friendly (blue) units"
                >
                  <span className={"sp-items__affil-dot"} data-force="blue" />Blue
                </button>
                <button
                  type="button"
                  className={`sp-items__affil-btn ${hostile ? "sp-items__affil-btn--active" : ""}`}
                  data-force="red"
                  onClick={() => { if (!hostile) onToggleAffiliation(); }}
                  disabled={readOnly}
                  aria-pressed={hostile}
                  title="Place opponent (red) units"
                >
                  <span className={"sp-items__affil-dot"} data-force="red" />Red
                </button>
              </div>

              <div className={"sp-items__search"}>
                <input
                  className={"sp-items__search-input"}
                  placeholder="Search types (infantry, drone, carrier…)"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setExpandedId(null); }}
                  aria-label="Search unit type catalogue"
                />
              </div>

              <div className={"sp-items__category-row"}>
                {(["All", ...CATEGORIES] as string[]).map((cat) => (
                  <button
                    key={cat}
                    className={`sp-items__cat-chip ${activeCategory === cat ? "sp-items__cat-chip--active" : ""}`}
                    onClick={() => { setActiveCategory(cat); setExpandedId(null); }}
                  >{cat}</button>
                ))}
              </div>

              <div className={"sp-items__palette-hint"}>
                Click a type ▸ choose echelon ▸ place on map
              </div>

              <div className={"sp-items__unit-list sp-scroll"} role="list">
                {grouped.map(({ category, items }) => (
                  <div key={category} className={"sp-items__cat-group"}>
                    {activeCategory === "All" && (
                      <div className={"sp-items__cat-heading"}>{category}</div>
                    )}
                    {items.map((archetype) => (
                      <ArchetypeCard
                        key={archetype.id}
                        archetype={archetype}
                        affiliation={affiliation}
                        isExpanded={expandedId === archetype.id}
                        activeTemplateId={activeTool === "placeUnit" ? (placingTemplate?.id ?? null) : null}
                        onExpand={() => setExpandedId((p) => p === archetype.id ? null : archetype.id)}
                        onSelectEchelon={handleSelectEchelon}
                        readOnly={readOnly}
                      />
                    ))}
                  </div>
                ))}
                {filteredArchetypes.length === 0 && (
                  <div style={{ padding: "16px 8px", fontSize: 11, color: "#4a5a6a", textAlign: "center" }}>
                    No unit types match — try a different search
                  </div>
                )}
              </div>
            </>
          )}

          {section === "drawing" && (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              <div className={"sp-items__drawing-list"}>
                <button
                  className={`sp-items__draw-tool ${activeTool === "select" ? "sp-items__draw-tool--active" : ""}`}
                  onClick={() => !readOnly && onSelectTool("select")}
                  disabled={readOnly} aria-pressed={activeTool === "select"}
                >
                  <span className={"sp-items__draw-tool-icon"}>⬆</span>
                  <div className={"sp-items__draw-tool-info"}>
                    <span className={"sp-items__tactic-label"}>Select</span>
                    <span className={"sp-items__tactic-desc"}>Click to select &amp; drag units</span>
                  </div>
                </button>
                <button
                  className={`sp-items__draw-tool ${activeTool === "placeObjective" ? "sp-items__draw-tool--active" : ""}`}
                  onClick={() => !readOnly && onSelectTool("placeObjective")}
                  disabled={readOnly} aria-pressed={activeTool === "placeObjective"}
                >
                  <span className={"sp-items__draw-tool-icon"}>◎</span>
                  <div className={"sp-items__draw-tool-info"}>
                    <span className={"sp-items__tactic-label"}>Objective</span>
                    <span className={"sp-items__tactic-desc"}>Click map to place &amp; name</span>
                  </div>
                </button>
                <button
                  className={`sp-items__draw-tool ${activeTool === "eraser" ? "sp-items__draw-tool--active" : ""}`}
                  onClick={() => !readOnly && onSelectTool("eraser")}
                  disabled={readOnly} aria-pressed={activeTool === "eraser"}
                >
                  <span className={"sp-items__draw-tool-icon"}>✕</span>
                  <div className={"sp-items__draw-tool-info"}>
                    <span className={"sp-items__tactic-label"}>Eraser</span>
                    <span className={"sp-items__tactic-desc"}>Hold &amp; drag to remove items</span>
                  </div>
                </button>
              </div>

              <div style={{ borderTop: "1px solid #1f2530", margin: "0 8px 0" }} />

              <div style={{ padding: "6px 10px 4px", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", flexShrink: 0 }}>
                Tactical Orders
              </div>

              <div className={"sp-items__search"} style={{ paddingTop: 0 }}>
                <input
                  className={"sp-items__search-input"}
                  placeholder="Search orders (attack, withdraw…)"
                  value={tacticSearch}
                  onChange={(e) => setTacticSearch(e.target.value)}
                  aria-label="Search tactical orders"
                />
              </div>

              <div className={"sp-items__category-row"}>
                {(["All", ...TACTIC_CATEGORIES] as (TacticCategory | "All")[]).map((cat) => (
                  <button
                    key={cat}
                    className={`sp-items__cat-chip ${tacticCategory === cat ? "sp-items__cat-chip--active" : ""}`}
                    onClick={() => setTacticCategory(cat)}
                  >{cat}</button>
                ))}
              </div>

              <div className={"sp-items__palette-hint"}>
                Click an order then click a unit to assign it
              </div>

              <div className={"sp-items__unit-list sp-scroll"} role="list" style={{ flex: 1 }}>
                {TACTIC_CATEGORIES.filter((cat: TacticCategory) => tacticCategory === "All" || cat === tacticCategory).map((cat: TacticCategory) => {
                  const items = filteredTactics.filter((o: TacticOrder) => o.category === cat);
                  if (items.length === 0) return null;
                  return (
                    <div key={cat} className={"sp-items__cat-group"}>
                      {tacticCategory === "All" && (
                        <div className={"sp-items__cat-heading"}>{cat}</div>
                      )}
                      {items.map((order: TacticOrder) => (
                        <TacticCard
                          key={order.id}
                          order={order}
                          isActive={isArrowActive && activeTacticId === order.id}
                          onSelect={() => handleSelectTactic(order)}
                          readOnly={readOnly}
                          phaseColour={previewColour}
                        />
                      ))}
                    </div>
                  );
                })}
                {filteredTactics.length === 0 && (
                  <div style={{ padding: "16px 8px", fontSize: 11, color: "#4a5a6a", textAlign: "center" }}>
                    No orders match
                  </div>
                )}
              </div>

              {(isArrowActive || activeTool === "placeObjective" || activeTool === "eraser") && (
                <div className={"sp-items__draw-hint"} aria-live="polite">
                  {activeTool === "assignOrder"
                    ? activeTacticId
                      ? `Assigning: ${TACTIC_ORDERS.find((o: TacticOrder) => o.id === activeTacticId)?.label} — click a unit on the map`
                      : "Click an order above, then click a unit on the map."
                    : activeTool === "placeMilx"
                    ? `Placing: ${TACTIC_ORDERS.find((o: TacticOrder) => o.id === activeTacticId)?.label} — click map to drop`
                    : isArrowActive
                    ? activeTacticId
                      ? `Drawing: ${TACTIC_ORDERS.find((o: TacticOrder) => o.id === activeTacticId)?.label} — click start then end`
                      : "Click the start point on the map, then the end point."
                    : activeTool === "placeObjective"
                    ? "Click on the map to drop an objective marker."
                    : "Hold left mouse button and drag over units, arrows or objectives to erase them."}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

