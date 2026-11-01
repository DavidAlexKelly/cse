// ============================================================
//  NATO Symbol Builder — resolves inputs → ResolvedSymbol
//  Aligned with APP-06(E)(2) / MIL-STD-2525E (version code 16)
//  Frame: 28×18 logical units, centred on (0,0)
// ============================================================

import {
  FW,
  FH,
  FRAME_SPECS,
  PALETTES,
  ECHELON_MARKS,
  ICON_DRAW_OPS,
  SECTOR1_OPS,
  SECTOR2_OPS,
  SIDC_VERSION,
  SIDC_SI_CODES,
  SIDC_SYMBOL_SETS,
  SIDC_ECHELON_CODES,
  SIDC_STATUS_CODES,
  SIDC_HQ_CODES,
  type IconDrawOp,
  type EchelonMarkSpec,
  type Palette,
  type Sector1Modifier,
  type Sector2Modifier,
  type HqIndicator,
  type SymbolStatus,
} from "./symbolSpec.js";
import type { StandardIdentity, EchelonLevel, UnitIconType } from "./types.js";

export interface SymbolInput {
  standardIdentity: StandardIdentity;
  echelon: EchelonLevel;
  icon: UnitIconType;
  sector1?: Sector1Modifier;
  sector2?: Sector2Modifier;
  hq?: HqIndicator;
  /** APP-6E §3.5 — drives dashed frame when "planned" */
  status?: SymbolStatus;
  designation?: string;
  reinforced?: "+" | "-" | "±" | null;
}

export interface SymbolLayer {
  id: string;
  ops: IconDrawOp[];
  // translate relative to frame centre (0,0)
  tx?: number;
  ty?: number;
}

export interface ResolvedSymbol {
  palette: Palette;
  layers: SymbolLayer[];
  echelonMark: { spec: EchelonMarkSpec; color: string };
  amplifierText: {
    designation?: string;
    reinforced?: string;
    hqLabel?: string;
  };
  frameW: number;
  frameH: number;
  shape: string;
  /** True when the frame border should be drawn dashed (planned/assumed/suspect) */
  borderDashed: boolean;
  /** True when the frame border should be drawn dotted (pending = uncertain identity) */
  borderDotted: boolean;
  /** Derived 30-digit SIDC (APP-06(E)(2)) */
  sidc: string;
}

// Build frame path ops for a given shape
function buildFrameOps(shape: string): IconDrawOp[] {
  const hw = FW / 2; // 14
  const hh = FH / 2; // 9
  switch (shape) {
    case "rectangle":
    case "rectangle_dashed":
      return [{ op: "path", d: `M${-hw},${-hh} H${hw} V${hh} H${-hw} Z` }];
    case "diamond":
    case "diamond_dashed": {
      const dx = hw * 1.2;
      const dy = hh * 1.4;
      return [{ op: "path", d: `M0,${-dy} L${dx},0 L0,${dy} L${-dx},0 Z` }];
    }
    case "square":
    case "square_dashed": {
      const s = Math.min(hw, hh) * 1.1;
      return [{ op: "path", d: `M${-s},${-s} H${s} V${s} H${-s} Z` }];
    }
    case "quatrefoil":
    case "quatrefoil_dotted": {
      // 4 interlocking circles at N/E/S/W — APP-6 unknown/pending frame
      const r = 7.56;
      const o = 5.44;
      return [
        { op: "circle", cx: 0, cy: -o, r, filled: false },
        { op: "circle", cx: o, cy: 0, r, filled: false },
        { op: "circle", cx: 0, cy: o, r, filled: false },
        { op: "circle", cx: -o, cy: 0, r, filled: false },
      ];
    }
    default:
      return [
        {
          op: "path",
          d: `M${-FW / 2},${-FH / 2} H${FW / 2} V${FH / 2} H${-FW / 2} Z`,
        },
      ];
  }
}

// ---- SIDC derivation (APP-06(E)(2), Annex A) ----
// Produces a 30-digit code. Entity/type/subtype and modifier digit-pairs are
// left as "00" (unknown/unspecified) — a complete icon catalogue mapping is
// needed to fill digits 11-20; that mapping is stored separately per unit.
function deriveSidc(input: SymbolInput): string {
  const ver = SIDC_VERSION; // [1-2]  "16"
  const context = "0"; // [3]    Reality
  const si = SIDC_SI_CODES[input.standardIdentity] ?? "1"; // [4]
  const symSet = SIDC_SYMBOL_SETS["landUnit"]; // [5-6]  default Land Unit
  const status = SIDC_STATUS_CODES[input.status ?? "present"]; // [7]
  const hqCode = SIDC_HQ_CODES[input.hq ?? "none"]; // [8]
  const echelon = SIDC_ECHELON_CODES[input.echelon] ?? "00"; // [9-10]

  // Digits 11-20: entity/type/subtype + sector modifiers — stored on the unit
  // as part of the full SIDC; here we emit "00" placeholders so the builder
  // always produces a valid-length code.
  const entity = "000000"; // [11-16] entity / type / subtype
  const sec1 = "00"; // [17-18] sector 1 modifier
  const sec2 = "00"; // [19-20] sector 2 modifier

  // Common modifier digits (21-22): 0 = use own symbol set
  const cm1 = "0";
  const cm2 = "0";

  const reserved = "00000"; // [23-27]
  const geo = "000"; // [28-30]

  return `${ver}${context}${si}${symSet}${status}${hqCode}${echelon}${entity}${sec1}${sec2}${cm1}${cm2}${reserved}${geo}`;
}

export function buildSymbol(input: SymbolInput): ResolvedSymbol {
  const palette = PALETTES[input.standardIdentity];
  const frame = FRAME_SPECS[input.standardIdentity];
  const echelon = ECHELON_MARKS[input.echelon];
  const iconOps = ICON_DRAW_OPS[input.icon] ?? [];

  // APP-6E §3.5: planned status drives a dashed frame regardless of identity
  const statusPlanned = input.status === "planned";

  const layers: SymbolLayer[] = [];

  // 1. Frame (bottom-most layer)
  layers.push({ id: "frame", ops: buildFrameOps(frame.shape) });

  // 2. Sector 2 modifier (lower zone, ty = +FH×0.25)
  if (input.sector2 && SECTOR2_OPS[input.sector2]) {
    layers.push({
      id: "sector2",
      ops: SECTOR2_OPS[input.sector2],
      ty: FH * 0.25,
    });
  }

  // 3. Main icon (centre)
  layers.push({ id: "icon", ops: iconOps });

  // 4. Sector 1 modifier (upper zone, ty = -FH×0.25)
  if (input.sector1 && SECTOR1_OPS[input.sector1]) {
    layers.push({
      id: "sector1",
      ops: SECTOR1_OPS[input.sector1],
      ty: -FH * 0.25,
    });
  }

  // 5. HQ staff flag — APP-6E §3.6
  //    "hq", "hqTaskForce" → vertical stave below frame
  //    "taskForce" → bracket around the frame (drawn in NatoSymbol renderer)
  const isHq = input.hq === "hq" || input.hq === "hqTaskForce";
  if (isHq) {
    layers.push({
      id: "hqFlag",
      ops: [
        {
          op: "line",
          x1: 0,
          y1: FH / 2,
          x2: 0,
          y2: FH / 2 + 9,
          sw: 2,
        },
      ],
    });
  }

  // 6. Task-force bracket — drawn as two vertical ticks flanking the frame
  const isTf = input.hq === "taskForce" || input.hq === "hqTaskForce";
  if (isTf) {
    const bx = FW / 2 + 2;
    const by = FH / 2 + 1;
    layers.push({
      id: "tfBracket",
      ops: [
        // Left bracket
        { op: "line", x1: -bx, y1: -FH / 2 - 1, x2: -bx, y2: by, sw: 1.8 },
        { op: "line", x1: -bx, y1: by, x2: -bx + 3, y2: by, sw: 1.6 },
        {
          op: "line",
          x1: -bx,
          y1: -FH / 2 - 1,
          x2: -bx + 3,
          y2: -FH / 2 - 1,
          sw: 1.6,
        },
        // Right bracket
        { op: "line", x1: bx, y1: -FH / 2 - 1, x2: bx, y2: by, sw: 1.8 },
        { op: "line", x1: bx, y1: by, x2: bx - 3, y2: by, sw: 1.6 },
        {
          op: "line",
          x1: bx,
          y1: -FH / 2 - 1,
          x2: bx - 3,
          y2: -FH / 2 - 1,
          sw: 1.6,
        },
      ],
    });
  }

  // 7. Feint/Dummy tick marks (APP-6E §3.6 digit 8 = 1)
  if (input.hq === "feint" || input.hq === "dummy") {
    layers.push({
      id: "feint",
      ops: [
        {
          op: "line",
          x1: -4,
          y1: -FH / 2 - 2,
          x2: 4,
          y2: -FH / 2 - 2,
          sw: 1.6,
        },
      ],
    });
  }

  const sidc = deriveSidc(input);

  return {
    palette,
    layers,
    echelonMark: { spec: echelon, color: palette.border },
    amplifierText: {
      designation: input.designation,
      reinforced: input.reinforced ?? undefined,
      hqLabel:
        input.hq === "hq"
          ? "HQ"
          : input.hq === "taskForce"
          ? "TF"
          : input.hq === "hqTaskForce"
          ? "HQ TF"
          : undefined,
    },
    frameW: FW,
    frameH: FH,
    shape: frame.shape,
    borderDashed: palette.borderDashed || statusPlanned,
    borderDotted: palette.borderDotted,
    sidc,
  };
}
