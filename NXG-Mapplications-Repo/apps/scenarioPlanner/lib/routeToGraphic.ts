import { rdpSimplify } from '@/shared/routing/waypointSimplify';
import type { OSRMRoute } from '@/shared/routing/types';

interface GraphicResult {
  milxSymbolName: string;
  milxParams: Record<string, unknown>;
  milxScale: number;
  milxUnitAnchors: Record<string, string>;
}

interface RouteToGraphicInput {
  route: OSRMRoute;
  orderKey: string;
  unitId: string;
  unitLat: number;
  unitLng: number;
  destLat: number;
  destLng: number;
  mapProject: (lngLat: [number, number]) => { x: number; y: number };
  echelonChar?: string; // sidc[11]
}

/* ── order-key → MilX symbol name ──────────────────────────────── */

const ORDER_TO_SYMBOL: Record<string, string> = {
  counterattack: 'svg-counterattack',
  'main-attack': 'svg-main-attack',
  'supporting-attack': 'svg-supporting-attack',
  attack: 'svg-axis-notched',
  exploit: 'svg-axis-notched',
  pursue: 'svg-axis-notched',
  advance: 'svg-axis-notched',
  infiltrate: 'svg-axis-notched',
  envelop: 'svg-axis-notched',
  penetrate: 'svg-axis-notched',
  turn: 'svg-axis-notched',
  withdraw: 'svg-withdraw-arc',
  retirement: 'svg-retirement-arc',
  delay: 'svg-delay-arc',
  breach: 'svg-breach',
  bypass: 'svg-bypass',
  seize: 'svg-seize',
  secure: 'svg-secure',
  block: 'svg-block',
  screen: 'svg-screen-ss',
  guard: 'svg-guard-gg',
  cover: 'svg-cover-cc',
  hold: 'svg-retain',
  retain: 'svg-retain',
  defend: 'svg-retain',
  occupy: 'svg-retain',
  destroy: 'svg-destroy',
  neutralize: 'svg-neutralize',
  contain: 'svg-contain',
  fix: 'svg-fix',
  suppress: 'svg-interdict',
  interdict: 'svg-interdict',
};

const DEFAULT_SYMBOL = 'svg-axis-notched';

/* ── echelon character → scale factor ──────────────────────────── */

const ECHELON_SCALE: Record<string, number> = {
  A: 0.5,
  B: 0.6,
  C: 0.7,
  D: 0.8,
  E: 1.0,
  F: 1.3,
  G: 1.6,
  H: 2.0,
  I: 2.5,
  J: 3.0,
};

function getEchelonScale(char?: string): number {
  if (!char) return 1.0;
  return ECHELON_SCALE[char.toUpperCase()] ?? 1.0;
}

/* ── helpers ───────────────────────────────────────────────────── */

function distance(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/* ── symbol family detectors ───────────────────────────────────── */

const AXIS_FAMILY_RE = /attack|axis|counterattack/;

const RETROGRADE_KEYS = new Set(['withdraw', 'retirement', 'delay']);

const POINT_GLYPH_KEYS = new Set([
  'destroy',
  'neutralize',
  'suppress',
  'interdict',
  'fix',
]);

const CIRCLE_KEYS = new Set([
  'seize',
  'retain',
  'contain',
  'occupy',
  'secure',
  'hold',
  'defend',
]);

const LINEAR_KEYS = new Set([
  'block',
  'breach',
  'bypass',
  'screen',
  'guard',
  'cover',
]);

/* ── main export ───────────────────────────────────────────────── */

export function routeToGraphic(input: RouteToGraphicInput): GraphicResult {
  const {
    route,
    orderKey,
    unitId,
    unitLat,
    unitLng,
    mapProject,
    echelonChar,
  } = input;

  const echelonScale = getEchelonScale(echelonChar);

  // 1. Simplify waypoints – reduce to ~5-10 spine points
  // OSRMRoute.waypoints are already [lat, lon] pairs
  const simplified = rdpSimplify(route.waypoints, 0.0003);

  // 2. Project simplified waypoints to screen coords
  const screenCoords: [number, number][] = simplified.map(([lat, lng]) => {
    const pt = mapProject([lng, lat]);
    return [pt.x, pt.y];
  });

  // 3. Resolve symbol name
  const milxSymbolName = ORDER_TO_SYMBOL[orderKey] ?? DEFAULT_SYMBOL;

  // 4. Determine symbol family and build params

  // Axis-of-advance family
  if (AXIS_FAMILY_RE.test(milxSymbolName)) {
    return {
      milxSymbolName,
      milxParams: {
        spine: screenCoords,
        halfWidth: 25 * echelonScale,
        headLen: 40 * echelonScale,
        headHalf: 35 * echelonScale,
        dashed: orderKey === 'supporting-attack',
        label: orderKey,
      },
      milxScale: echelonScale,
      milxUnitAnchors: { start: unitId },
    };
  }

  // Retrograde-arc family
  if (RETROGRADE_KEYS.has(orderKey)) {
    const startPx = screenCoords[0];
    const endPx = screenCoords[screenCoords.length - 1];
    const r = distance(startPx, endPx) * 0.6;
    return {
      milxSymbolName,
      milxParams: { A: startPx, B: endPx, r },
      milxScale: echelonScale,
      milxUnitAnchors: { start: unitId },
    };
  }

  // Point-glyph family
  if (POINT_GLYPH_KEYS.has(orderKey)) {
    const unitPx = mapProject([unitLng, unitLat]);
    return {
      milxSymbolName,
      milxParams: { center: [unitPx.x, unitPx.y], scale: 1.5, rotation: 0 },
      milxScale: echelonScale,
      milxUnitAnchors: {},
    };
  }

  // Circle family
  if (CIRCLE_KEYS.has(orderKey)) {
    const unitPx = mapProject([unitLng, unitLat]);
    return {
      milxSymbolName,
      milxParams: {
        center: [unitPx.x, unitPx.y],
        radius: 40,
        gapAngle: 0,
      },
      milxScale: echelonScale,
      milxUnitAnchors: {},
    };
  }

  // Linear family
  if (LINEAR_KEYS.has(orderKey)) {
    const startPx = screenCoords[0];
    const endPx = screenCoords[screenCoords.length - 1];
    return {
      milxSymbolName,
      milxParams: { P1: startPx, P2: endPx },
      milxScale: echelonScale,
      milxUnitAnchors: {},
    };
  }

  // Fallback – treat as axis-of-advance
  return {
    milxSymbolName,
    milxParams: {
      spine: screenCoords,
      halfWidth: 25 * echelonScale,
      headLen: 40 * echelonScale,
      headHalf: 35 * echelonScale,
      dashed: false,
      label: orderKey,
    },
    milxScale: echelonScale,
    milxUnitAnchors: { start: unitId },
  };
}
