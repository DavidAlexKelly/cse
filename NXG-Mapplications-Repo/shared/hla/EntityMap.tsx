/* eslint-disable @typescript-eslint/no-explicit-any */
// ── shared/hla/EntityMap.tsx ───────────────────────────────────────────────
// The federation map: MapTiler basemap, APP-6 symbols, zoom-based echelon
// roll-up, hover naming and click-to-select.
//
// Extracted from hlamap/components/MapView so the live map and the analysis
// replay are literally the same map. A unit has to look the same, roll up the
// same and be named the same whether you are watching it now or scrubbing back
// through it later — if the two drifted, an analyst comparing a replay against
// what they remember seeing would be comparing two different pictures.
//
// What stays out of here: anything you can only do to a *live* federation.
// Obstacles, comms-disruption zones and patrol-waypoint previews are hlamap's,
// and are attached as extra Leaflet layers by that app through `onMapReady`
// rather than being plumbed through this component as props it would have to
// know about.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import ms from "milsymbol";
import { type FC, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { buildSidc, lookupCatalogue } from "./symbology/app6";
import { planRollup, type Renderable } from "./symbology/rollup";
import { useSwordCatalogue, type SwordCatalogue } from "./useSwordCatalogue";
import { iconSignature, type IconOptions } from "./iconSignature";
import type { HlaEntity, LatLon } from "./types";
import { forceColor, UI } from "./ui";

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY ?? "";
const TILE_URL = `https://api.maptiler.com/maps/hybrid/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`;
const SYMBOL_SIZE = 22;

/**
 * Formations are drawn slightly larger than the units under them, so that a
 * rolled-up company reads as the bigger thing it is at a glance.
 */
function symbolSize(rank: number): number {
  if (rank >= 6) return 28; // battalion and above
  if (rank >= 5) return 25; // company / battery
  return SYMBOL_SIZE;
}

// ── Symbols ─────────────────────────────────────────────────────────────────
// SIDCs come from the SWORD asset catalogue, not from the DIS entity type — see
// symbology/app6.ts for why the DIS codes this federation publishes cannot be
// used (kind 12 is not a DIS kind; one code covers both a tank platoon and an
// AEW&C aircraft). DIS is still consulted for the battle dimension when an
// entity has no catalogue entry, which is the case for the drone mockups.

// ── Symbol cache ─────────────────────────────────────────────────────────────
// milsymbol builds an SVG string from scratch on every call, and this component
// repaints every marker on every stream tick (or every playback frame) and
// again on every zoom change. The federation only uses a few dozen distinct
// SIDCs across its ~300 entities, so keying the rendered symbol on SIDC and
// size turns almost all of that work into a map lookup.
interface RenderedSymbol {
  svg: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

const symbolCache = new Map<string, RenderedSymbol | null>();

/** The rendered symbol for a SIDC, or null when milsymbol could not draw it. */
function renderSymbol(sidc: string, size: number): RenderedSymbol | null {
  const key = `${sidc}|${size}`;
  const cached = symbolCache.get(key);
  if (cached !== undefined) return cached;

  let rendered: RenderedSymbol | null = null;
  try {
    const sym = new ms.Symbol(sidc, { size, frame: true });
    // Use getSize() instead of asCanvas() — asCanvas() requires document.createElement
    // which blows up outside the browser; getSize() is pure calculation.
    const sz = sym.getSize();
    rendered = {
      // asSVG() returns a complete <svg>…</svg> string; embed it directly.
      svg: sym.asSVG().replace("<svg ", `<svg style="pointer-events:auto;" `),
      width: sz.width || size * 2,
      height: sz.height || size * 2,
      anchorX: sym.getAnchor().x,
      anchorY: sym.getAnchor().y,
    };
  } catch {
    rendered = null;
  }

  // Bounded so a pathological stream cannot grow this without limit; the working
  // set is two orders of magnitude below the cap.
  if (symbolCache.size > 512) symbolCache.clear();
  symbolCache.set(key, rendered);
  return rendered;
}

// IconOptions and iconSignature live in ./iconSignature — the rule about what
// does and does not force an icon rebuild is subtle enough to want tests, and
// this module cannot be imported outside a browser.

// ── Build a Leaflet DivIcon using milsymbol ───────────────────────────────────
function buildEntityIcon(
  entity: HlaEntity,
  catalogue: SwordCatalogue,
  { selected, targetable, headquarters, rolledUp, rank, faded }: IconOptions
): L.DivIcon {
  // The catalogue is keyed on the asset type inside the SWORD entity name; a
  // miss is expected for non-SWORD entities and yields a dimension-only frame
  // rather than a wrong icon.
  const rawName = entity.unit || entity.callsign;
  const sidc = buildSidc({
    name: rawName,
    affiliation: entity.force === "BLUE" ? "FRIEND" : "HOSTILE",
    disType: entity.sisoType,
    // An explicit nature on the entity wins over the catalogue: entities the
    // catalogue does not know would otherwise draw as an empty frame.
    catalogue: entity.natureApp6
      ? { natureApp6: entity.natureApp6 }
      : lookupCatalogue(catalogue, rawName),
    // Only ever forced on: a formation whose CP has been folded in gains the
    // staff, and one whose CP is still drawn separately keeps whatever its own
    // name implies.
    headquarters: headquarters || undefined,
  });
  const s = symbolSize(rank);

  let svgHtml: string;
  let iconW: number;
  let iconH: number;
  let anchorX: number;
  let anchorY: number;

  const rendered = renderSymbol(sidc, s);
  if (rendered) {
    svgHtml = rendered.svg;
    iconW = rendered.width;
    iconH = rendered.height;
    anchorX = rendered.anchorX;
    anchorY = rendered.anchorY;
  } else {
    // milsymbol failed entirely — render a coloured circle so the entity is
    // still visible on the map rather than invisible.
    const col = entity.force === "BLUE" ? "#3b82f6" : "#ef4444";
    svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" style="pointer-events:auto;">
      <circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 1}" fill="${col}" stroke="white" stroke-width="1.5"/>
    </svg>`;
    iconW = s;
    iconH = s;
    anchorX = s / 2;
    anchorY = s / 2;
  }

  // The ring used to hang 16px below the symbol to enclose the callsign label;
  // with the label gone it sits evenly around the icon.
  const selRing = selected
    ? `<div style="position:absolute;inset:-4px;border:2px dashed #fbbf24;border-radius:4px;pointer-events:none;"></div>`
    : "";

  const targetRing = targetable
    ? `<div style="position:absolute;inset:-5px;border:2px dashed #ef4444;border-radius:50%;pointer-events:none;"></div>`
    : "";

  // Callsigns are not drawn under the symbols. A label is about three times the
  // width of the icon it belongs to, so labels — not symbols — were what
  // actually collided: they are the widest thing on the map and unreadable at
  // any zoom where units are close together. The name is on hover instead, and
  // the selected unit's details are in the side panel.
  const tint = forceColor(entity.force);

  // Heading tick: a short spoke from the symbol centre, rotated to the
  // entity's bearing. CSS rotation is clockwise from 12 o'clock, which is
  // exactly the compass convention the bridge reports (0 = true north), so the
  // angle needs no conversion.
  const headingTick = Number.isFinite(entity.heading)
    ? `<div style="position:absolute;left:${anchorX}px;top:${anchorY}px;width:0;height:0;
         transform:rotate(${entity.heading}deg);pointer-events:none;">
         <div style="position:absolute;left:-1px;top:${-(s * 0.62)}px;width:2px;height:${s * 0.3}px;
           background:${tint};box-shadow:0 0 2px #0f172a;"></div>
       </div>`
    : "";

  // Roll-up badge: how many subordinate units this symbol is standing in for.
  // Only ever an undercount of what is really there, never a claim about
  // strength — the units it counts are the ones the map chose not to draw.
  const badge =
    rolledUp > 0
      ? `<div style="position:absolute;top:-3px;right:-6px;min-width:13px;height:13px;padding:0 2px;
           border-radius:7px;background:rgba(14,18,25,0.92);border:1px solid ${tint}99;
           color:${tint};font-family:'Courier New';font-size:9px;font-weight:700;line-height:13px;
           text-align:center;pointer-events:none;">+${rolledUp}</div>`
      : "";

  const html = `<div style="position:relative;display:inline-block;cursor:pointer;pointer-events:auto;${
    faded ? "opacity:0.45;filter:grayscale(0.6);" : ""
  }">
    ${selRing}${targetRing}${svgHtml}${headingTick}${badge}
  </div>`;

  return L.divIcon({ html, iconSize: [iconW, iconH], iconAnchor: [anchorX, anchorY], className: "" });
}

/** Escape a simulator-supplied name before it goes into tooltip HTML. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * What a marker says on hover.
 *
 * This carries the whole naming burden now that callsigns are not drawn under
 * the symbols: hover is where a unit identifies itself, and for a rolled-up
 * formation it is also the only way to see what it is standing in for.
 */
function markerTooltip(renderable: Renderable<HlaEntity>, rolledUpHint: string): string {
  const title = escapeHtml(renderable.entity.unit || renderable.entity.callsign);
  const rolledUp = renderable.rolledUp.length;
  const members = renderable.rolledUp
    .map((child) => `<div>· ${escapeHtml(child.unit || child.callsign)}</div>`)
    .join("");

  return (
    `<div style="font-family:'Courier New';font-size:10px;line-height:1.45;">` +
    `<div style="font-weight:700;">${title}</div>` +
    (renderable.headquarters ? `<div style="opacity:0.8;">includes command post</div>` : "") +
    (rolledUp > 0
      ? `<div style="opacity:0.8;">+${rolledUp} rolled up — ${rolledUpHint}</div>${members}`
      : "") +
    `</div>`
  );
}

export interface EntityMapProps {
  entities: HlaEntity[];
  selectedId: string | null;
  /**
   * A marker was clicked. The caller decides what that means — hlamap may be
   * choosing a fire target, the analysis screen just selects.
   */
  onEntityClick: (entity: HlaEntity) => void;
  /** Purely visual: ring these entities as pickable targets. */
  isTargetable?: (entity: HlaEntity) => boolean;
  /** Draw every entity individually, skipping the roll-up entirely. */
  rollupDisabled?: boolean;
  /** A click on the basemap rather than on a marker. */
  onMapClick?: (latlon: LatLon) => void;
  /** Crosshair cursor, for when a click is being awaited. */
  crosshair?: boolean;
  /** Banner across the top of the map. */
  banner?: ReactNode;
  /** Breadcrumb polyline, e.g. the selected unit's track so far. */
  trail?: LatLon[] | null;
  /** Dim these entities — the analysis replay uses it for destroyed units. */
  isFaded?: (entity: HlaEntity) => boolean;
  /** Tail of the roll-up tooltip; differs between tasking and replay. */
  rolledUpHint?: string;
  /**
   * When the *picture* changed, as opposed to when positions moved.
   *
   * The roll-up is a function of where units are relative to each other, so
   * recomputing it whenever `entities` changes is correct for a live feed that
   * only ticks when there is genuinely new data. A replay is different: it
   * interpolates between frames at 15 Hz, and re-deciding the roll-up against
   * jittering intermediate positions lets a platoon fold into its company on
   * one tick and back out on the next — units visibly popping in and out
   * several times a second.
   *
   * Callers that interpolate should set this to something that changes once per
   * real frame (the frame's timestamp). Positions still update every tick; only
   * the fold/unfold decisions are held steady. Leave it undefined to recompute
   * on every change, which is what a live feed wants.
   */
  planKey?: string | number;
  /**
   * Re-fit the camera when this value changes. hlamap leaves it undefined (fit
   * once, on the first entities); the analysis screen keys it on the run so
   * that switching runs re-frames the map.
   */
  fitKey?: string | number;
  /** Extra overlays, positioned by the caller. */
  children?: ReactNode;
  /**
   * Handed the Leaflet map on init and null on teardown, so a caller can
   * attach layers this component has no reason to know about.
   */
  onMapReady?: (map: L.Map | null) => void;
}

const EntityMap: FC<EntityMapProps> = ({
  entities,
  selectedId,
  onEntityClick,
  isTargetable,
  rollupDisabled = false,
  onMapClick,
  crosshair = false,
  banner,
  trail,
  isFaded,
  rolledUpHint = "zoom in for subunits",
  planKey,
  fitKey,
  children,
  onMapReady,
}) => {
  // 81 rows, fetched once: the APP-6 nature and echelon per SWORD asset type.
  const { catalogue } = useSwordCatalogue();

  // Which echelons are drawn depends on how far in the map is zoomed, so the
  // zoom has to be state rather than something read off the map ad hoc.
  const [zoom, setZoom] = useState(2);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  /** Last icon signature drawn per marker, so icons are rebuilt only on change. */
  const signaturesRef = useRef<Record<string, string>>({});
  const trailRef = useRef<L.Polyline | null>(null);
  const hasFitRef = useRef(false);

  // Callbacks are held in refs so the map-init effect can stay mount-only and
  // marker handlers never go stale.
  const onEntityClickRef = useRef(onEntityClick);
  onEntityClickRef.current = onEntityClick;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;

  // ── Map init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Start at a wide world view — we fly to the entities once they arrive.
    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer(TILE_URL, { maxZoom: 18, maxNativeZoom: 16, detectRetina: false }).addTo(map);

    L.control
      .attribution({ position: "bottomleft", prefix: "" })
      .addAttribution(
        '<span style="color:#334155;font-size:9px">' +
          '© <a href="https://www.maptiler.com/" style="color:#334155">MapTiler</a> ' +
          '© <a href="https://www.openstreetmap.org/copyright" style="color:#334155">OSM</a></span>'
      )
      .addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      onMapClickRef.current?.({ lat: e.latlng.lat, lon: e.latlng.lng });
    });

    // zoomend rather than zoom: level of detail only has to be right when the
    // gesture finishes, and recomputing mid-animation would rebuild every
    // marker for frames nobody reads.
    map.on("zoomend", () => setZoom(map.getZoom()));
    setZoom(map.getZoom());

    mapRef.current = map;
    onMapReadyRef.current?.(map);

    return () => {
      onMapReadyRef.current?.(null);
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
      trailRef.current = null;
      hasFitRef.current = false;
    };
  }, []);

  // ── Keep Leaflet's idea of the container size honest ─────────────────────
  // Leaflet caches the container size when the map is created and only revisits
  // it on a window resize. Both screens change the map's height after that: the
  // analysis timeline replaces a one-line placeholder once runs load, and either
  // app can push an error banner in above the map. A stale size leaves every
  // projection off by the difference, which shows up as the view sliding when
  // you zoom. A ResizeObserver covers all of it without either app having to
  // remember to tell the map it moved.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      // animate: false — this is a correction, not a camera move, and animating
      // it would slide the map under the user for no reason.
      mapRef.current?.invalidateSize({ animate: false });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── Cursor while a click is awaited ──────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.cursor = crosshair ? "crosshair" : "";
  }, [crosshair]);

  // ── Re-frame when the caller says the subject changed ────────────────────
  useEffect(() => {
    hasFitRef.current = false;
  }, [fitKey]);

  // ── What to draw at this zoom ────────────────────────────────────────────
  // SWORD publishes a formation and its subordinates as separate entities a few
  // hundred metres apart, plus a command post on the formation's exact
  // coordinates — seven markers for one company. planRollup decides which of
  // those carry their own icon and which are counted on somebody else's; see
  // symbology/rollup.ts for the thresholds and why they are where they are.
  //
  // Held steady between frames when the caller interpolates — see planKey. The
  // entities are read through a ref so that a new interpolated array does not
  // by itself re-decide the folding.
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  const planInput = planKey === undefined ? entities : planKey;
  const plan = useMemo(
    () =>
      planRollup(entitiesRef.current, (entity) => entity.unit || entity.callsign, zoom, {
        // The selected unit always keeps its marker: the side panel is showing
        // it, and it must stay clickable to be deselected.
        pinnedId: selectedId,
        disabled: rollupDisabled,
      }),
    // planInput stands in for the entities deliberately; see the planKey docs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planInput, zoom, selectedId, rollupDisabled]
  );

  // Latest position per entity. The plan is a decision about *structure* — who
  // is drawn and who is folded in — taken at frame boundaries; positions are
  // then taken from the most recent tick so movement stays smooth.
  const entityById = useMemo(() => {
    const map = new Map<string, HlaEntity>();
    for (const entity of entities) map.set(entity.id, entity);
    return map;
  }, [entities]);

  const entityByIdRef = useRef(entityById);
  entityByIdRef.current = entityById;

  // ── Entity markers + auto-fit ────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Keyed on what is *drawn*, not on what exists: a unit folded into its
    // parent by the roll-up has to lose its marker like one that left the
    // federation.
    const currentIds = new Set(plan.map((r) => r.entity.id));
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
        delete signaturesRef.current[id];
      }
    });

    plan.forEach((renderable) => {
      // Structure from the plan, position from the latest tick.
      const entity = entityById.get(renderable.entity.id) ?? renderable.entity;
      const options: IconOptions = {
        selected: selectedId === entity.id,
        targetable: isTargetable?.(entity) ?? false,
        headquarters: renderable.headquarters,
        rolledUp: renderable.rolledUp.length,
        rank: renderable.rank,
        faded: isFaded?.(entity) ?? false,
      };
      const signature = iconSignature(entity, options, catalogue.byName.size);

      const existing = markersRef.current[entity.id];
      if (existing) {
        existing.setLatLng([entity.lat, entity.lon]);

        // Only touch the icon when something about it actually changed.
        // Re-creating it on every tick tears down and rebuilds the marker's DOM
        // element, which is what makes markers stop tracking the basemap during
        // a zoom or pan.
        if (signaturesRef.current[entity.id] !== signature) {
          existing.setIcon(buildEntityIcon(entity, catalogue, options));
          const tooltip = markerTooltip(renderable, rolledUpHint);
          // setTooltipContent, not unbind/rebind: rebinding closes an open
          // tooltip, so a hovered unit's name would blink as it updates.
          if (existing.getTooltip()) existing.setTooltipContent(tooltip);
          else existing.bindTooltip(tooltip);
          signaturesRef.current[entity.id] = signature;
        }
      } else {
        const marker = L.marker([entity.lat, entity.lon], {
          icon: buildEntityIcon(entity, catalogue, options),
          bubblingMouseEvents: false,
        })
          .addTo(map)
          .on("click", (e: any) => {
            L.DomEvent.stopPropagation(e);
            // Through a ref, not the captured `entityById`: this handler
            // outlives the render that created it, and the caller should be
            // handed the unit as it is now rather than as it was then.
            onEntityClickRef.current(entityByIdRef.current.get(entity.id) ?? entity);
          });
        marker.bindTooltip(markerTooltip(renderable, rolledUpHint));
        markersRef.current[entity.id] = marker;
        signaturesRef.current[entity.id] = signature;
      }
    });

    // On the first batch that has entities, fly the camera to fit them all.
    // Fits the whole federation, not just what is drawn — the roll-up hides
    // subordinates, and the camera should still cover where they are.
    if (!hasFitRef.current && entities.length > 0) {
      hasFitRef.current = true;
      const bounds = L.latLngBounds(entities.map((e) => [e.lat, e.lon] as L.LatLngExpression));
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 12 });
    }
    // catalogue is a dependency: symbols are re-rendered once it loads, which is
    // typically a moment after the first entities arrive.
  }, [plan, entities, entityById, selectedId, catalogue, isTargetable, isFaded, rolledUpHint]);

  // ── Breadcrumb trail ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    trailRef.current?.remove();
    trailRef.current = null;

    if (trail && trail.length > 1) {
      trailRef.current = L.polyline(
        trail.map((p): L.LatLngExpression => [p.lat, p.lon]),
        { color: "#fbbf24", weight: 2, opacity: 0.85, dashArray: "4 3" }
      ).addTo(map);
    }
  }, [trail]);

  // How many entities the roll-up is currently standing in for. Shown so that a
  // map holding fewer icons than the reported entity count is explained rather
  // than looking like dropped data.
  const foldedCount = entities.length - plan.length;

  return (
    <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {foldedCount > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            right: 10,
            background: "rgba(14,18,25,0.88)",
            border: `1px solid ${UI.border}`,
            color: UI.textDim,
            fontFamily: UI.fontMono,
            fontSize: 10,
            padding: "4px 9px",
            letterSpacing: 0.5,
            zIndex: 1000,
            pointerEvents: "none",
          }}
        >
          {plan.length} of {entities.length} drawn · {foldedCount} rolled up · zoom in for subunits
        </div>
      )}

      {banner && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(14,18,25,0.92)",
            border: `1px solid ${UI.accent}55`,
            color: UI.accent,
            fontFamily: UI.fontMono,
            fontSize: 11,
            padding: "5px 12px",
            letterSpacing: 1,
            zIndex: 1000,
            pointerEvents: "none",
          }}
        >
          {banner}
        </div>
      )}

      {children}
    </div>
  );
};

export default EntityMap;
