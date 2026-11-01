// ============================================================
//  NATO APP-6 Edition E (APP-06(E)(2), Oct 2025) Symbol Specification
//  Harmonised with MIL-STD-2525E. Version code: 16.
//  Frame canvas: W=28, H=18 logical units. Icon space: ±9 × ±6.
// ============================================================

import type { StandardIdentity, EchelonLevel, UnitIconType } from "./types.js";

// ----- Frame constants (logical units) -----
export const FW = 28;
export const FH = 18;
export type IconDrawOp =
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; sw?: number }
  | { op: "polyline"; pts: [number, number][]; sw?: number }
  | {
      op: "circle";
      cx: number;
      cy: number;
      r: number;
      filled?: boolean;
      sw?: number;
    }
  | {
      op: "ellipse";
      cx?: number;
      cy?: number;
      rx: number;
      ry: number;
      filled?: boolean;
      sw?: number;
    }
  | { op: "path"; d: string; filled?: boolean; sw?: number }
  | {
      op: "text";
      content: string;
      fontSize: number;
      fontWeight?: string;
      x?: number;
      y?: number;
    }
  | { op: "group"; ops: IconDrawOp[] }
  | {
      op: "arc";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      startDeg: number;
      endDeg: number;
      sw?: number;
    };

export type EchelonMarkSpec =
  | { type: "dots"; count: number }
  | { type: "bars"; count: number }
  | { type: "xmarks"; count: number }
  | { type: "glyph"; glyph: string }
  | { type: "command" };

export interface FrameSpec {
  shape:
    | "rectangle"
    | "diamond"
    | "square"
    | "quatrefoil"
    | "rectangle_dashed"
    | "diamond_dashed"
    | "square_dashed"
    | "quatrefoil_dotted";
}

// ----- Frame specs by standard identity (APP-6E §3.3) -----
// 0=Pending(dotted-rect), 1=Unknown(quatrefoil), 2=AssumedFriend(dashed-rect),
// 3=Friend(rect), 4=Neutral(square), 5=Suspect(dashed-diamond), 6=Hostile(diamond)
export const FRAME_SPECS: Record<StandardIdentity, FrameSpec> = {
  friend: { shape: "rectangle" },
  hostile: { shape: "diamond" },
  neutral: { shape: "square" },
  unknown: { shape: "quatrefoil" },
  pending: { shape: "quatrefoil_dotted" }, // Pending = dotted quatrefoil
  assumedFriend: { shape: "rectangle_dashed" },
  suspect: { shape: "diamond_dashed" },
};

// ----- Palettes by standard identity (APP-6E colour schema) -----
export interface Palette {
  fill: string;
  border: string;
  iconColor: string;
  borderDashed: boolean;
  borderDotted: boolean;
}

export const PALETTES: Record<StandardIdentity, Palette> = {
  friend: {
    fill: "#63a2ff",
    border: "#1d5fa8",
    iconColor: "#000000",
    borderDashed: false,
    borderDotted: false,
  },
  hostile: {
    fill: "#ef4d4d",
    border: "#8c2115",
    iconColor: "#000000",
    borderDashed: false,
    borderDotted: false,
  },
  neutral: {
    fill: "#27AE60",
    border: "#14632f",
    iconColor: "#000000",
    borderDashed: false,
    borderDotted: false,
  },
  unknown: {
    fill: "#f5b955",
    border: "#7d6200",
    iconColor: "#000000",
    borderDashed: false,
    borderDotted: false,
  },
  pending: {
    fill: "#f5b955",
    border: "#7d6200",
    iconColor: "#000000",
    borderDashed: false,
    borderDotted: true, // dotted = uncertain identity
  },
  assumedFriend: {
    fill: "#63a2ff",
    border: "#1d5fa8",
    iconColor: "#000000",
    borderDashed: true,
    borderDotted: false,
  },
  suspect: {
    fill: "#ef4d4d",
    border: "#8c2115",
    iconColor: "#000000",
    borderDashed: true,
    borderDotted: false,
  },
};

// ----- Echelon marks (APP-6E §3.7) -----
// Team=Ø, Squad=1dot, Section=2dots, Platoon=3dots
// Company=I, Battalion=II, Regiment=III
// Brigade=X, Division=XX, Corps=XXX, Army=XXXX, ArmyGroup=XXXXX, Theatre=XXXXXX
// Command=++ (the regional-command level)
export const ECHELON_MARKS: Record<EchelonLevel, EchelonMarkSpec> = {
  team: { type: "glyph", glyph: "Ø" },
  squad: { type: "dots", count: 1 },
  section: { type: "dots", count: 2 },
  platoon: { type: "dots", count: 3 },
  company: { type: "bars", count: 1 },
  battalion: { type: "bars", count: 2 },
  regiment: { type: "bars", count: 3 },
  brigade: { type: "xmarks", count: 1 },
  division: { type: "xmarks", count: 2 },
  corps: { type: "xmarks", count: 3 },
  army: { type: "xmarks", count: 4 },
  armyGroup: { type: "xmarks", count: 5 },
  theatre: { type: "xmarks", count: 6 },
};

// ----- Icon draw-ops (APP-6E Chapters 2–9 / Annex A.15) -----
// All coords centred on (0,0), fitting within ±9 × ±6
// Icon colour comes from the PALETTE.iconColor; for friend/neutral/unknown that is
// black (drawn over the coloured fill), for hostile contexts also black.
export const ICON_DRAW_OPS: Record<UnitIconType, IconDrawOp[]> = {
  // APP-6E Land Unit §3 — Movement & Manoeuvre
  infantry: [
    // Standard APP-6 infantry: single diagonal line (bottom-left to top-right)
    { op: "line", x1: -8, y1: 6, x2: 8, y2: -6, sw: 1.8 },
  ],
  armour: [
    // Filled oval / ellipse — APP-6 armour icon
    { op: "ellipse", rx: 8, ry: 3.5, filled: true, sw: 1.6 },
  ],
  mechanisedInfantry: [
    // Oval + diagonal (combination of armour + infantry)
    { op: "ellipse", rx: 8, ry: 3.5, filled: true, sw: 1.6 },
    { op: "line", x1: -8, y1: 6, x2: 8, y2: -6, sw: 1.8 },
  ],
  artillery: [
    // Solid circle — APP-6 field artillery
    { op: "circle", cx: 0, cy: 0, r: 4.5, filled: true },
  ],
  rocketArtillery: [
    // Circle (lower) + upward arrow — rocket artillery
    { op: "circle", cx: 0, cy: 2.5, r: 3, filled: true },
    { op: "line", x1: 0, y1: -6, x2: 0, y2: -0.5, sw: 1.8 },
    { op: "line", x1: -2.5, y1: -3.5, x2: 0, y2: -6, sw: 1.4 },
    { op: "line", x1: 2.5, y1: -3.5, x2: 0, y2: -6, sw: 1.4 },
  ],
  mortar: [
    // Solid circle + vertical stem — mortar
    { op: "circle", cx: 0, cy: 2, r: 3, filled: true },
    { op: "line", x1: 0, y1: -6, x2: 0, y2: -1, sw: 1.8 },
  ],
  aviation: [
    // Rotary-wing rotor cross (APP-6 aviation unit)
    { op: "line", x1: -9, y1: 0, x2: 9, y2: 0, sw: 2 },
    { op: "line", x1: 0, y1: -6, x2: 0, y2: 6, sw: 2 },
    { op: "circle", cx: 0, cy: 0, r: 2.2, filled: false, sw: 1.4 },
  ],
  airForce: [
    // Fixed-wing silhouette (APP-6 air symbol set)
    { op: "path", d: "M0,-6 L7,5 L0,2 L-7,5 Z", filled: true },
  ],
  reconnaissance: [
    // Reverse diagonal (APP-6 reconnaissance / recce)
    { op: "line", x1: 8, y1: -6, x2: -8, y2: 6, sw: 1.8 },
  ],
  cavalry: [
    // Diagonal + small centre circle — cavalry / mounted recce
    { op: "line", x1: -8, y1: 6, x2: 8, y2: -6, sw: 1.8 },
    { op: "circle", cx: 0, cy: 0, r: 2.5, filled: false, sw: 1.4 },
  ],
  // APP-6E Land Unit — Combat Support
  engineer: [
    // Crenellated castle parapet (portcullis) — APP-6 engineer
    { op: "line", x1: -9, y1: 2.5, x2: 9, y2: 2.5, sw: 2.2 },
    { op: "line", x1: -7, y1: 2.5, x2: -7, y2: -4, sw: 1.8 },
    { op: "line", x1: -2.5, y1: 2.5, x2: -2.5, y2: -4, sw: 1.8 },
    { op: "line", x1: 2.5, y1: 2.5, x2: 2.5, y2: -4, sw: 1.8 },
    { op: "line", x1: 7, y1: 2.5, x2: 7, y2: -4, sw: 1.8 },
  ],
  pioneer: [
    // Portcullis + axe handle — pioneer variant
    { op: "line", x1: -9, y1: 2.5, x2: 9, y2: 2.5, sw: 2.2 },
    { op: "line", x1: -7, y1: 2.5, x2: -7, y2: -4, sw: 1.8 },
    { op: "line", x1: -1.5, y1: 2.5, x2: -1.5, y2: -4, sw: 1.8 },
    { op: "line", x1: 4, y1: 2.5, x2: 4, y2: -4, sw: 1.8 },
    { op: "line", x1: 7, y1: -4, x2: 7, y2: -6, sw: 1.8 },
  ],
  signals: [
    // Lightning bolt — APP-6 signals / communication
    { op: "path", d: "M3,-6 L-2,0 L2,0 L-3,6 L2,-1 L-2,-1 Z", filled: true },
  ],
  cyber: [
    // Circle + code tag — Cyberspace (APP-6E Ch 9, set 60)
    { op: "circle", cx: 0, cy: 0, r: 5, filled: false, sw: 1.8 },
    { op: "text", content: "</>", fontSize: 4, fontWeight: "700" },
  ],
  ew: [
    // Opposing arcs — Electronic Warfare
    { op: "arc", cx: -4.5, cy: 0, rx: 3.5, ry: 5.5, startDeg: -65, endDeg: 65 },
    { op: "arc", cx: 4.5, cy: 0, rx: 3.5, ry: 5.5, startDeg: 115, endDeg: 245 },
    { op: "line", x1: -1.5, y1: 0, x2: 1.5, y2: 0, sw: 1.6 },
  ],
  // APP-6E Land Unit — Combat Service Support
  logistics: [
    // Open circle + cross — supply/logistics
    { op: "circle", cx: 0, cy: 0, r: 4.5, filled: false, sw: 1.8 },
    { op: "line", x1: 0, y1: -4.5, x2: 0, y2: 4.5, sw: 1.4 },
    { op: "line", x1: -4.5, y1: 0, x2: 4.5, y2: 0, sw: 1.4 },
  ],
  maintenance: [
    // Wrench / spanner silhouette
    {
      op: "path",
      d: "M-4,5 L-1.5,1 L-4,-5 L-1,-5 L4,0 L-1,5 Z",
      filled: false,
      sw: 1.6,
    },
  ],
  medical: [
    // Equal-arm Geneva cross (bold) — APP-6 medical
    {
      op: "polyline",
      pts: [
        [-6, -2],
        [-2, -2],
        [-2, -6],
        [2, -6],
        [2, -2],
        [6, -2],
        [6, 2],
        [2, 2],
        [2, 6],
        [-2, 6],
        [-2, 2],
        [-6, 2],
        [-6, -2],
      ],
      sw: 2,
    },
  ],
  // APP-6E Land Unit — Air Defence
  airDefence: [
    // Upward arc + vertical with crossbar — AA/ADA
    { op: "arc", cx: 0, cy: 2.5, rx: 7, ry: 6.5, startDeg: 180, endDeg: 360 },
    { op: "line", x1: 0, y1: -4, x2: 0, y2: -8, sw: 1.8 },
    { op: "line", x1: -2.5, y1: -6, x2: 2.5, y2: -6, sw: 1.4 },
  ],
  // APP-6E Special Operations Forces
  specialForces: [
    // Crossed arrows / crossed swords — SOF
    { op: "line", x1: -8, y1: -6, x2: 8, y2: 6, sw: 1.8 },
    { op: "line", x1: 8, y1: -6, x2: -8, y2: 6, sw: 1.8 },
  ],
  sniper: [
    // Crosshair — sniper / precision fire
    { op: "circle", cx: 0, cy: 0, r: 5.5, filled: false, sw: 1.6 },
    { op: "line", x1: -8, y1: 0, x2: -6, y2: 0, sw: 1.4 },
    { op: "line", x1: 6, y1: 0, x2: 8, y2: 0, sw: 1.4 },
    { op: "line", x1: 0, y1: -8, x2: 0, y2: -6, sw: 1.4 },
    { op: "line", x1: 0, y1: 6, x2: 0, y2: 8, sw: 1.4 },
  ],
  antiTank: [
    // Left-pointing solid triangle — anti-armour
    { op: "path", d: "M7,-5 L-7,0 L7,5 Z", filled: true },
  ],
  // APP-6E Maritime (Sea Surface, set 30)
  naval: [
    // Hull silhouette — surface vessel
    { op: "path", d: "M-9,4 Q0,-8 9,4 Z", filled: true },
  ],
  // APP-6E CBRN (common modifier / Stability set)
  cbrn: [
    // Hazard triangle (APP-6 CBRN)
    { op: "path", d: "M0,-7 L8,5 L-8,5 Z", filled: false, sw: 1.8 },
    { op: "circle", cx: 0, cy: 1.5, r: 2, filled: true },
  ],
  military_police: [
    // MP text abbreviation
    { op: "text", content: "MP", fontSize: 7, fontWeight: "700" },
  ],
  headquarters: [
    // Horizontal bar — HQ / command post
    { op: "line", x1: -9, y1: 0, x2: 9, y2: 0, sw: 2.4 },
  ],
  generic: [],
};

// ----- Sector 1 modifiers (upper capability zone, APP-6E §6 / Annex A common) -----
// Includes the two new Edition E modifiers: HUMINT (24-050) and combinedCbrn (24-044)
export type Sector1Modifier =
  | "airborne"
  | "airAssault"
  | "mountain"
  | "amphibious"
  | "arctic"
  | "light"
  | "humint" // NEW in APP-06(E)(2) (24-050)
  | "combinedCbrn"; // NEW in APP-06(E)(2) (24-044)

export const SECTOR1_OPS: Record<Sector1Modifier, IconDrawOp[]> = {
  // Airborne — parachute arc (open arch above centre)
  airborne: [
    { op: "arc", cx: 0, cy: 2, rx: 5.5, ry: 5.5, startDeg: 180, endDeg: 360 },
  ],
  // Air Assault — bold upward chevron
  airAssault: [{ op: "path", d: "M-5,3 L0,-4 L5,3", sw: 1.8, filled: false }],
  // Mountain — open triangle peak
  mountain: [{ op: "path", d: "M-6,3 L0,-4 L6,3", sw: 1.6, filled: false }],
  // Amphibious — wave form
  amphibious: [
    { op: "path", d: "M-6,1 Q-3,-3 0,1 Q3,-3 6,1", sw: 1.6, filled: false },
  ],
  // Arctic — 8-pointed snowflake star
  arctic: [
    { op: "line", x1: 0, y1: -4.5, x2: 0, y2: 4.5, sw: 1.4 },
    { op: "line", x1: -4.5, y1: 0, x2: 4.5, y2: 0, sw: 1.4 },
    { op: "line", x1: -3.2, y1: -3.2, x2: 3.2, y2: 3.2, sw: 1.4 },
    { op: "line", x1: 3.2, y1: -3.2, x2: -3.2, y2: 3.2, sw: 1.4 },
  ],
  // Light — empty (no mark; presence of "light" is implied by absence of mobility mod)
  light: [],
  // HUMINT — NEW APP-06(E)(2) (24-050): eye symbol
  humint: [
    { op: "arc", cx: 0, cy: 0, rx: 5.5, ry: 3, startDeg: 180, endDeg: 360 },
    { op: "arc", cx: 0, cy: 0, rx: 5.5, ry: 3, startDeg: 0, endDeg: 180 },
    { op: "circle", cx: 0, cy: 0, r: 1.6, filled: true },
  ],
  // Combined CBRN — NEW APP-06(E)(2) (24-044): hazard triangle + small circle
  combinedCbrn: [
    { op: "path", d: "M0,-5 L5,3.5 L-5,3.5 Z", filled: false, sw: 1.4 },
    { op: "circle", cx: 0, cy: 0, r: 1.2, filled: true },
  ],
};

// ----- Sector 2 modifiers (lower mobility zone, APP-6E §6 / common modifier table) -----
// "High Mobility/Off-Road" is the common-modifier-code 106 in Edition E.
export type Sector2Modifier =
  | "wheeled"
  | "tracked"
  | "towed"
  | "selfPropelled"
  | "motorised"
  | "highMobility"; // Common modifier 106 — High Mobility/Off-Road (Edition E)

export const SECTOR2_OPS: Record<Sector2Modifier, IconDrawOp[]> = {
  // Wheeled — single open circle
  wheeled: [{ op: "circle", cx: 0, cy: 0, r: 3, filled: false, sw: 1.4 }],
  // Tracked — segmented rectangle representing track links
  tracked: [
    {
      op: "polyline",
      pts: [
        [-5.5, 1.2],
        [5.5, 1.2],
        [5.5, -1.2],
        [-5.5, -1.2],
        [-5.5, 1.2],
      ],
      sw: 1.4,
    },
    { op: "line", x1: -2.7, y1: 1.2, x2: -2.7, y2: -1.2, sw: 1.2 },
    { op: "line", x1: 0, y1: 1.2, x2: 0, y2: -1.2, sw: 1.2 },
    { op: "line", x1: 2.7, y1: 1.2, x2: 2.7, y2: -1.2, sw: 1.2 },
  ],
  // Towed — horizontal bar with left arrowhead
  towed: [
    { op: "line", x1: -5.5, y1: 0, x2: 5.5, y2: 0, sw: 1.6 },
    { op: "path", d: "M-5.5,-1.2 L-7.5,0 L-5.5,1.2", sw: 1.2, filled: false },
  ],
  // Self-Propelled — SP abbreviation
  selfPropelled: [
    { op: "text", content: "SP", fontSize: 4, fontWeight: "700" },
  ],
  // Motorised — horizontal dash (wheeled + powered, no tracks)
  motorised: [{ op: "line", x1: -5.5, y1: 0, x2: 5.5, y2: 0, sw: 1.6 }],
  // High Mobility / Off-Road — two small filled circles (common modifier 106, Edition E)
  highMobility: [
    { op: "circle", cx: -2.5, cy: 0, r: 1.8, filled: true },
    { op: "circle", cx: 2.5, cy: 0, r: 1.8, filled: true },
  ],
};

// ----- HQ / Task Force / Dummy / Feint (SIDC digit 8) -----
// APP-6E §3.6: 0=none, 1=Feint/Dummy, 2=HQ, 3=TF, 4=HQ+TF, 5=Feint+Dummy+HQ, ...
// In our UI we expose the four common combinations:
export type HqIndicator =
  | "hq"
  | "taskForce"
  | "hqTaskForce"
  | "feint"
  | "dummy";

// ----- Symbol Status (SIDC digit 7) -----
// "planned" drives dashed frame. "damaged" / "destroyed" drive amplifier marks.
export type SymbolStatus =
  | "present"
  | "planned"
  | "damaged"
  | "destroyed"
  | "fullCapacity";

// ----- SIDC Version / Standard -----
// APP-06(E)(2) = version code 16.
export const SIDC_VERSION = "16";

// SIDC Standard Identity codes (digit 4) per APP-6E §3.3
export const SIDC_SI_CODES: Record<StandardIdentity, string> = {
  pending: "0",
  unknown: "1",
  assumedFriend: "2",
  friend: "3",
  neutral: "4",
  suspect: "5",
  hostile: "6",
};

// SIDC Symbol Set codes (digits 5-6) per APP-6E §3.4
export const SIDC_SYMBOL_SETS: Record<string, string> = {
  landUnit: "10",
  landCivilianUnit: "11",
  landEquipment: "15",
  landInstallation: "20",
  controlMeasures: "25",
  dismountedIndividual: "27",
  air: "01",
  airMissile: "02",
  space: "05",
  seaSurface: "30",
  seaSubsurface: "35",
  mineWarfare: "36",
  stability: "40",
  cyberUnit: "60",
  cyberNonUnit: "64",
  unknown: "00",
};

// SIDC Echelon codes (digits 9-10 for units) per APP-6E §3.7
export const SIDC_ECHELON_CODES: Record<EchelonLevel, string> = {
  team: "11",
  squad: "12",
  section: "13",
  platoon: "14",
  company: "15",
  battalion: "16",
  regiment: "17",
  brigade: "18",
  division: "21",
  corps: "22",
  army: "23",
  armyGroup: "24",
  theatre: "25",
};

// SIDC Status codes (digit 7) per APP-6E §3.5
export const SIDC_STATUS_CODES: Record<SymbolStatus, string> = {
  present: "0",
  planned: "1",
  damaged: "3",
  destroyed: "4",
  fullCapacity: "5",
};

// SIDC HQ/TF/Dummy codes (digit 8) per APP-6E §3.6
export const SIDC_HQ_CODES: Record<"none" | HqIndicator, string> = {
  none: "0",
  dummy: "1",
  hq: "2",
  taskForce: "3",
  hqTaskForce: "4",
  feint: "5",
};
