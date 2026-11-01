// src/map/ScenarioPlanning/components/MapCanvas/MapCanvas.tsx
//
// Unified tactical map canvas — ported from the widgetSet MapCanvas with full
// pan / zoom / topo background, NATO milsymbol rendering, movement arrows,
// objectives, and the arrow-draft preview.

import ms from "milsymbol";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { getPhaseColourById } from "../../shared/phaseColours";
import type {
  ArrowDraft,
  DrawingTool,
  MapUnit,
  MovementArrow,
  Objective,
  Phase,
} from "../../shared/types";
import css from "./MapCanvas.module.css";

interface MapCanvasProps {
  phases: Phase[];
  units: MapUnit[];
  movementArrows: MovementArrow[];
  objectives: Objective[];
  selectedPhaseId: string | null;
  activeTool: DrawingTool;
  arrowDraft: ArrowDraft | null;
  objectiveNamePending: { lat: number; lng: number } | null;
  onUnitClick: (unitId: string) => void;
  onMapClick: (lat: number, lng: number) => void;
  onMapMouseMove: (lat: number, lng: number) => void;
  onConfirmObjective: (name: string) => void;
  onCancelObjective: () => void;
}

// ── Coordinate projection ─────────────────────────────────────────────────────
const MAP_CENTER_LAT = 54.35;
const MAP_CENTER_LNG = 18.2;
const BASE_SCALE = 6000; // px per degree at zoom 1

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

function latLngToXY(
  lat: number,
  lng: number,
  w: number,
  h: number,
  v: ViewState,
): [number, number] {
  const scale = BASE_SCALE * v.zoom;
  return [
    (lng - MAP_CENTER_LNG) * scale + w / 2 + v.panX,
    -(lat - MAP_CENTER_LAT) * scale + h / 2 + v.panY,
  ];
}

function xyToLatLng(
  x: number,
  y: number,
  w: number,
  h: number,
  v: ViewState,
): [number, number] {
  const scale = BASE_SCALE * v.zoom;
  return [
    MAP_CENTER_LAT - (y - h / 2 - v.panY) / scale,
    MAP_CENTER_LNG + (x - w / 2 - v.panX) / scale,
  ];
}

// ── NATO milsymbol as base64 data URL ─────────────────────────────────────────
function symbolDataUrl(sidc: string, size: number): string {
  try {
    return `data:image/svg+xml;base64,${btoa(new ms.Symbol(sidc, { size }).asSVG())}`;
  } catch {
    return `data:image/svg+xml;base64,${btoa(new ms.Symbol("10031000000000000000", { size }).asSVG())}`;
  }
}

// ── Topographic background ────────────────────────────────────────────────────
function TopoBackground({
  width,
  height,
  view,
}: {
  width: number;
  height: number;
  view: ViewState;
}) {
  const scale = BASE_SCALE * view.zoom;

  const terrainZones = [
    { lat1: 54.1, lng1: 17.7, lat2: 54.6, lng2: 19.0, fill: "#e8eedb" },
    { lat1: 54.3, lng1: 18.0, lat2: 54.5, lng2: 18.6, fill: "#d4e4c8" },
    { lat1: 54.35, lng1: 18.15, lat2: 54.45, lng2: 18.35, fill: "#cce0cc" },
    { lat1: 54.28, lng1: 17.9, lat2: 54.38, lng2: 18.05, fill: "#d8e8d0" },
    { lat1: 54.55, lng1: 17.5, lat2: 54.9, lng2: 19.2, fill: "#b8d4f0" },
    { lat1: 54.1, lng1: 17.5, lat2: 54.25, lng2: 17.9, fill: "#b8d4f0" },
  ];

  const rivers: [number, number][][] = [
    [
      [54.35, 18.66],
      [54.36, 18.55],
      [54.38, 18.45],
      [54.37, 18.35],
      [54.36, 18.2],
    ],
    [
      [54.28, 18.55],
      [54.3, 18.45],
      [54.32, 18.35],
      [54.34, 18.25],
    ],
  ];

  const roads: { pts: [number, number][]; w: number; color: string }[] = [
    {
      pts: [
        [54.2, 18.1],
        [54.28, 18.15],
        [54.35, 18.2],
        [54.42, 18.25],
        [54.5, 18.3],
      ],
      w: 3,
      color: "#e8c87a",
    },
    {
      pts: [
        [54.3, 17.9],
        [54.34, 18.05],
        [54.38, 18.22],
        [54.42, 18.4],
      ],
      w: 2,
      color: "#d4b86a",
    },
    {
      pts: [
        [54.25, 18.3],
        [54.3, 18.35],
        [54.36, 18.38],
        [54.42, 18.42],
      ],
      w: 1.5,
      color: "#ccc",
    },
  ];

  const towns: { lat: number; lng: number; name: string; size: number }[] = [
    { lat: 54.37, lng: 18.62, name: "Gdańsk", size: 12 },
    { lat: 54.28, lng: 18.68, name: "Gdynia", size: 10 },
    { lat: 54.35, lng: 18.2, name: "Pruszcz Gd.", size: 8 },
    { lat: 54.3, lng: 18.1, name: "Tczew", size: 8 },
    { lat: 54.42, lng: 18.45, name: "Żukowo", size: 7 },
  ];

  const step = 0.1;
  const lngStart =
    Math.floor((MAP_CENTER_LNG - width / (2 * scale)) / step) * step;
  const lngEnd =
    Math.ceil((MAP_CENTER_LNG + width / (2 * scale)) / step) * step;
  const latStart =
    Math.floor((MAP_CENTER_LAT - height / (2 * scale)) / step) * step;
  const latEnd =
    Math.ceil((MAP_CENTER_LAT + height / (2 * scale)) / step) * step;

  const gridLines: React.ReactElement[] = [];
  for (
    let lng = lngStart;
    lng <= lngEnd;
    lng = Math.round((lng + step) * 1000) / 1000
  ) {
    const [x] = latLngToXY(MAP_CENTER_LAT, lng, width, height, view);
    const major = Math.abs(Math.round(lng * 10) % 5) === 0;
    gridLines.push(
      <line
        key={`v${lng}`}
        x1={x}
        y1={0}
        x2={x}
        y2={height}
        stroke={major ? "#b0bec5" : "#cfd8dc"}
        strokeWidth={major ? 0.7 : 0.3}
      />,
    );
    if (major)
      gridLines.push(
        <text
          key={`vl${lng}`}
          x={x + 2}
          y={height - 6}
          fontSize={8}
          fill="#78909c"
          fontFamily="monospace"
        >
          {lng.toFixed(1)}°E
        </text>,
      );
  }
  for (
    let lat = latStart;
    lat <= latEnd;
    lat = Math.round((lat + step) * 1000) / 1000
  ) {
    const [, y] = latLngToXY(lat, MAP_CENTER_LNG, width, height, view);
    const major = Math.abs(Math.round(lat * 10) % 5) === 0;
    gridLines.push(
      <line
        key={`h${lat}`}
        x1={0}
        y1={y}
        x2={width}
        y2={y}
        stroke={major ? "#b0bec5" : "#cfd8dc"}
        strokeWidth={major ? 0.7 : 0.3}
      />,
    );
    if (major)
      gridLines.push(
        <text
          key={`hl${lat}`}
          x={4}
          y={y - 3}
          fontSize={8}
          fill="#78909c"
          fontFamily="monospace"
        >
          {lat.toFixed(1)}°N
        </text>,
      );
  }

  return (
    <>
      <rect width={width} height={height} fill="#eff3e8" />
      {terrainZones.map((z, i) => {
        const [x1, y1] = latLngToXY(z.lat2, z.lng1, width, height, view);
        const [x2, y2] = latLngToXY(z.lat1, z.lng2, width, height, view);
        return (
          <rect
            key={i}
            x={x1}
            y={y1}
            width={x2 - x1}
            height={y2 - y1}
            fill={z.fill}
          />
        );
      })}
      {gridLines}
      {rivers.map((pts, i) => (
        <polyline
          key={i}
          points={pts
            .map(([la, ln]) => {
              const [x, y] = latLngToXY(la, ln, width, height, view);
              return `${x},${y}`;
            })
            .join(" ")}
          fill="none"
          stroke="#88c4e8"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {roads.map((r, i) => {
        const pts = r.pts
          .map(([la, ln]) => {
            const [x, y] = latLngToXY(la, ln, width, height, view);
            return `${x},${y}`;
          })
          .join(" ");
        return (
          <g key={i}>
            <polyline
              points={pts}
              fill="none"
              stroke="#fff"
              strokeWidth={r.w + 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={pts}
              fill="none"
              stroke={r.color}
              strokeWidth={r.w}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
      {towns.map((t, i) => {
        const [x, y] = latLngToXY(t.lat, t.lng, width, height, view);
        const r = t.size / 2.5;
        return (
          <g key={i}>
            <circle
              cx={x}
              cy={y}
              r={r + 1}
              fill="white"
              stroke="#9e9e9e"
              strokeWidth={0.5}
            />
            <circle cx={x} cy={y} r={r} fill="#bdbdbd" />
            <text
              x={x + r + 2}
              y={y + 3}
              fontSize={t.size * 0.75}
              fill="#455a64"
              fontFamily="'Inter','Segoe UI',sans-serif"
              fontWeight="500"
            >
              {t.name}
            </text>
          </g>
        );
      })}
      <defs>
        <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
          <stop offset="60%" stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.07)" />
        </radialGradient>
      </defs>
      <rect
        width={width}
        height={height}
        fill="url(#vignette)"
        style={{ pointerEvents: "none" }}
      />
    </>
  );
}

// ── Objective name popup ──────────────────────────────────────────────────────
function ObjectiveNamePopup({
  x,
  y,
  onConfirm,
  onCancel,
}: {
  x: number;
  y: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      style={{ position: "absolute", left: x + 10, top: y - 20, zIndex: 40 }}
      className={css.objPopup}
    >
      <span className={css.objPopupLabel}>OBJECTIVE NAME</span>
      <input
        ref={inputRef}
        className={css.objPopupInput}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
          if (e.key === "Escape") onCancel();
        }}
        placeholder="e.g. Bridge VEGA"
        maxLength={30}
      />
      <div className={css.objPopupActions}>
        <button className={css.objPopupCancel} onClick={onCancel}>
          Cancel
        </button>
        <button
          className={css.objPopupConfirm}
          onClick={() => name.trim() && onConfirm(name.trim())}
        >
          Place
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export const MapCanvas: React.FC<MapCanvasProps> = ({
  phases,
  units,
  movementArrows,
  objectives,
  selectedPhaseId,
  activeTool,
  arrowDraft,
  objectiveNamePending,
  onUnitClick,
  onMapClick,
  onMapMouseMove,
  onConfirmObjective,
  onCancelObjective,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const didDrag = useRef(false);

  const width = containerRef.current?.clientWidth ?? 800;
  const height = containerRef.current?.clientHeight ?? 600;

  const toolCursor =
    activeTool === "select"
      ? isDragging.current
        ? "grabbing"
        : "grab"
      : "crosshair";

  const getLatLng = useCallback(
    (e: React.MouseEvent): [number, number] => {
      const rect = containerRef.current!.getBoundingClientRect();
      return xyToLatLng(
        e.clientX - rect.left,
        e.clientY - rect.top,
        width,
        height,
        view,
      );
    },
    [width, height, view],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool === "select") {
        isDragging.current = true;
        didDrag.current = false;
        dragStart.current = {
          x: e.clientX,
          y: e.clientY,
          panX: view.panX,
          panY: view.panY,
        };
      }
    },
    [activeTool, view],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging.current && dragStart.current) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag.current = true;
        setView((v) => ({
          ...v,
          panX: dragStart.current!.panX + dx,
          panY: dragStart.current!.panY + dy,
        }));
      }
      const [lat, lng] = getLatLng(e);
      onMapMouseMove(lat, lng);
    },
    [getLatLng, onMapMouseMove],
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = false;
      dragStart.current = null;
      if (!didDrag.current && activeTool !== "select") {
        const [lat, lng] = getLatLng(e);
        onMapClick(lat, lng);
      }
    },
    [activeTool, getLatLng, onMapClick],
  );

  const onSvgClick = useCallback(
    (e: React.MouseEvent) => {
      if (didDrag.current) {
        didDrag.current = false;
        return;
      }
      if (activeTool !== "select") {
        const [lat, lng] = getLatLng(e);
        onMapClick(lat, lng);
      }
    },
    [activeTool, getLatLng, onMapClick],
  );

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setView((v) => ({
      ...v,
      zoom: Math.max(0.3, Math.min(8, v.zoom * (e.deltaY < 0 ? 1.15 : 0.87))),
    }));
  }, []);

  const zoomIn = () =>
    setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.3) }));
  const zoomOut = () =>
    setView((v) => ({ ...v, zoom: Math.max(0.3, v.zoom * 0.77) }));

  // Phase filtering
  const visibleUnits = selectedPhaseId
    ? units.filter((u) => u.phaseId === selectedPhaseId || !u.phaseId)
    : units;
  const visibleArrows = selectedPhaseId
    ? movementArrows.filter(
        (a) => a.phaseId === selectedPhaseId || !a.phaseId,
      )
    : movementArrows;
  const visibleObjectives = selectedPhaseId
    ? objectives.filter((o) => o.phaseId === selectedPhaseId || !o.phaseId)
    : objectives;

  const objPopupPos = objectiveNamePending
    ? latLngToXY(
        objectiveNamePending.lat,
        objectiveNamePending.lng,
        width,
        height,
        view,
      )
    : null;

  return (
    <div className={css.mapWrapper} ref={containerRef}>
      {/* Zoom controls */}
      <div className={css.zoomControls}>
        <button className={css.zoomBtn} onClick={zoomIn} aria-label="Zoom in">
          +
        </button>
        <button
          className={css.zoomBtn}
          onClick={zoomOut}
          aria-label="Zoom out"
        >
          −
        </button>
      </div>

      {/* Scale indicator */}
      <div className={css.scaleBar}>
        <div className={css.scaleLine} />
        <span className={css.scaleLabel}>~{Math.round(50 / view.zoom)} km</span>
      </div>

      <svg
        className={css.mapSvg}
        width="100%"
        height="100%"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          isDragging.current = false;
          dragStart.current = null;
        }}
        onWheel={onWheel}
        onClick={onSvgClick}
        style={{ cursor: toolCursor }}
        aria-label="Tactical planning map"
        role="img"
      >
        <TopoBackground width={width} height={height} view={view} />

        {/* Movement arrows */}
        {visibleArrows.map((arrow) => {
          const [x1, y1] = latLngToXY(
            arrow.fromLat,
            arrow.fromLng,
            width,
            height,
            view,
          );
          const [x2, y2] = latLngToXY(
            arrow.toLat,
            arrow.toLng,
            width,
            height,
            view,
          );
          const color = getPhaseColourById(arrow.phaseId ?? "", phases);
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) return null;
          const ux = dx / len;
          const uy = dy / len;
          const s = 12;
          const ax = x2 - ux * s;
          const ay = y2 - uy * s;
          const px = -uy * (s / 2);
          const py = ux * (s / 2);
          return (
            <g key={arrow.id}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="white"
                strokeWidth={5}
                strokeOpacity={0.5}
              />
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={2.5}
                strokeDasharray="8 4"
                strokeOpacity={0.9}
              />
              <polygon
                points={`${x2},${y2} ${ax + px},${ay + py} ${ax - px},${ay - py}`}
                fill={color}
                opacity={0.9}
              />
            </g>
          );
        })}

        {/* Arrow draft preview */}
        {arrowDraft &&
          (() => {
            const [x1, y1] = latLngToXY(
              arrowDraft.fromLat,
              arrowDraft.fromLng,
              width,
              height,
              view,
            );
            const [x2, y2] = latLngToXY(
              arrowDraft.toLatCursor,
              arrowDraft.toLngCursor,
              width,
              height,
              view,
            );
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 5) return null;
            const ux = dx / len;
            const uy = dy / len;
            const s = 12;
            const ax = x2 - ux * s;
            const ay = y2 - uy * s;
            const px2 = -uy * (s / 2);
            const py2 = ux * (s / 2);
            return (
              <g>
                <circle cx={x1} cy={y1} r={5} fill="#4A90D9" opacity={0.8} />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#4A90D9"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  opacity={0.7}
                />
                <polygon
                  points={`${x2},${y2} ${ax + px2},${ay + py2} ${ax - px2},${ay - py2}`}
                  fill="#4A90D9"
                  opacity={0.7}
                />
              </g>
            );
          })()}

        {/* Objectives */}
        {visibleObjectives.map((obj) => {
          const [x, y] = latLngToXY(
            obj.latitude,
            obj.longitude,
            width,
            height,
            view,
          );
          const color = getPhaseColourById(obj.phaseId ?? "", phases);
          return (
            <g key={obj.id}>
              <circle
                cx={x}
                cy={y}
                r={14}
                fill={`${color}22`}
                stroke={color}
                strokeWidth={2}
                strokeDasharray="5 3"
              />
              <line
                x1={x - 10}
                y1={y}
                x2={x + 10}
                y2={y}
                stroke={color}
                strokeWidth={1.5}
              />
              <line
                x1={x}
                y1={y - 10}
                x2={x}
                y2={y + 10}
                stroke={color}
                strokeWidth={1.5}
              />
              <text
                x={x}
                y={y + 24}
                textAnchor="middle"
                fontSize={10}
                fontWeight="700"
                fill={color}
                fontFamily="monospace"
                letterSpacing="0.05em"
                stroke="white"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {obj.name.toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* Objective pending marker */}
        {objectiveNamePending &&
          (() => {
            const [x, y] = latLngToXY(
              objectiveNamePending.lat,
              objectiveNamePending.lng,
              width,
              height,
              view,
            );
            return (
              <circle
                cx={x}
                cy={y}
                r={10}
                fill="none"
                stroke="#4A90D9"
                strokeWidth={2}
                strokeDasharray="4 2"
              />
            );
          })()}

        {/* Unit markers */}
        {visibleUnits.map((unit) => {
          const [x, y] = latLngToXY(
            unit.latitude,
            unit.longitude,
            width,
            height,
            view,
          );
          const color = getPhaseColourById(unit.phaseId ?? "", phases);
          const size = 36;
          const href = symbolDataUrl(unit.sidc, size);
          return (
            <g
              key={unit.id}
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                onUnitClick(unit.id);
              }}
              aria-label={unit.unitIdentifier}
              role="button"
            >
              <circle
                cx={x}
                cy={y + 3}
                r={size / 2 + 3}
                fill="rgba(0,0,0,0.15)"
              />
              <image
                href={href}
                x={x - size / 2}
                y={y - size / 2}
                width={size}
                height={size}
                style={{ pointerEvents: "none" }}
              />
              <text
                x={x}
                y={y + size / 2 + 14}
                textAnchor="middle"
                fontSize={10}
                fontWeight="700"
                fill="#fff"
                fontFamily="'Inter', 'Segoe UI', sans-serif"
                letterSpacing="0.06em"
                stroke={color}
                strokeWidth={3}
                paintOrder="stroke"
              >
                {unit.unitIdentifier.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Objective name popup */}
      {objectiveNamePending && objPopupPos && (
        <ObjectiveNamePopup
          x={objPopupPos[0]}
          y={objPopupPos[1]}
          onConfirm={onConfirmObjective}
          onCancel={onCancelObjective}
        />
      )}

      <div className={css.attribution}>
        Northern Poland · Tactical Planning Canvas
      </div>
    </div>
  );
};
