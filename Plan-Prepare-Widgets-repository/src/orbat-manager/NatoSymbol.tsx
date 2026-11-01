// ============================================================
//  NATO APP-6 Edition E SVG Symbol Renderer
//  Aligned with APP-06(E)(2) / MIL-STD-2525E (version code 16)
//  Frame canvas: FW×FH (28×18) centred on (0,0)
//  SVG is sized to `size` pixels wide; height scales proportionally
//  plus echelon-mark room above and HQ stave room below.
// ============================================================

import React from "react";
import { buildSymbol, type SymbolInput } from "./symbolBuilder.js";
import { FW, FH, type IconDrawOp } from "./symbolSpec.js";

interface NatoSymbolProps extends SymbolInput {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Show a tooltip with the derived SIDC on hover */
  showSidc?: boolean;
}

// Render a single draw-op; `ic` = icon/border colour, `fill` = frame fill
function renderOp(
  op: IconDrawOp,
  ic: string,
  frameFill: string,
  key: number,
): React.ReactNode {
  const sw = "sw" in op && op.sw ? op.sw : 1.8;
  const noFill = "none";
  switch (op.op) {
    case "line":
      return (
        <line key={key} x1={op.x1} y1={op.y1} x2={op.x2} y2={op.y2}
          stroke={ic} strokeWidth={sw} fill={noFill} strokeLinecap="round" />
      );
    case "polyline":
      return (
        <polyline key={key}
          points={op.pts.map(([x, y]) => `${x},${y}`).join(" ")}
          stroke={ic} strokeWidth={sw} fill={noFill} strokeLinejoin="round" />
      );
    case "circle":
      return (
        <circle key={key} cx={op.cx} cy={op.cy} r={op.r}
          stroke={op.filled ? "none" : ic} strokeWidth={sw}
          fill={op.filled ? ic : noFill} />
      );
    case "ellipse":
      return (
        <ellipse key={key} cx={op.cx ?? 0} cy={op.cy ?? 0} rx={op.rx} ry={op.ry}
          stroke={op.filled ? "none" : ic} strokeWidth={sw}
          fill={op.filled ? ic : noFill} />
      );
    case "path":
      return (
        <path key={key} d={op.d}
          stroke={op.filled ? "none" : ic} strokeWidth={sw}
          fill={op.filled ? ic : noFill} strokeLinejoin="round" />
      );
    case "text":
      return (
        <text key={key} x={op.x ?? 0} y={op.y ?? 0}
          textAnchor="middle" dominantBaseline="middle"
          fill={ic} fontSize={op.fontSize}
          fontWeight={op.fontWeight ?? "bold"} fontFamily="monospace">
          {op.content}
        </text>
      );
    case "arc": {
      const { cx, cy, rx, ry, startDeg, endDeg } = op;
      const toR = (d: number) => (d * Math.PI) / 180;
      const x1 = cx + rx * Math.cos(toR(startDeg));
      const y1 = cy + ry * Math.sin(toR(startDeg));
      const x2 = cx + rx * Math.cos(toR(endDeg));
      const y2 = cy + ry * Math.sin(toR(endDeg));
      const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
      return (
        <path key={key}
          d={`M${x1},${y1} A${rx},${ry} 0 ${large},1 ${x2},${y2}`}
          stroke={ic} strokeWidth={sw} fill={noFill} strokeLinecap="round" />
      );
    }
    case "group":
      return (
        <g key={key}>
          {op.ops.map((o, i) => renderOp(o, ic, frameFill, i))}
        </g>
      );
    default:
      return null;
  }
}

// Render echelon mark above frame at (0, -(FH/2) - offset)
function EchelonMark({
  spec,
  color,
}: {
  spec: ReturnType<typeof buildSymbol>["echelonMark"]["spec"];
  color: string;
}) {
  const Y = -FH / 2 - 5; // centred above frame top edge

  if (spec.type === "glyph") {
    return (
      <text x={0} y={Y} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={5.5} fontWeight="bold" fontFamily="monospace">
        {spec.glyph}
      </text>
    );
  }
  if (spec.type === "dots") {
    // APP-6E: squad=1dot, section=2dots, platoon=3dots
    const spacing = 4;
    const total = (spec.count - 1) * spacing;
    const startX = -total / 2;
  return (
      <g>
        {Array.from({ length: spec.count }, (_, i) => (
          <circle key={i} cx={startX + i * spacing} cy={Y} r={1.5} fill={color} />
        ))}
      </g>
  );
  }
  if (spec.type === "bars") {
    // APP-6E: company=I, battalion=II, regiment=III (vertical bars)
    const spacing = 3.5;
    const total = (spec.count - 1) * spacing;
    const startX = -total / 2;
    return (
      <g>
        {Array.from({ length: spec.count }, (_, i) => (
          <line key={i}
            x1={startX + i * spacing} y1={Y - 4}
            x2={startX + i * spacing} y2={Y + 4}
            stroke={color} strokeWidth={1.8} strokeLinecap="round" />
        ))}
      </g>
    );
  }
  if (spec.type === "xmarks") {
    // APP-6E: brigade=X, division=XX, corps=XXX, etc.
    const spacing = 8;
    const total = (spec.count - 1) * spacing;
    const startX = -total / 2;
    return (
      <g>
        {Array.from({ length: spec.count }, (_, i) => {
          const x = startX + i * spacing;
          return (
            <g key={i}>
              <line x1={x - 3.5} y1={Y - 3.5} x2={x + 3.5} y2={Y + 3.5}
                stroke={color} strokeWidth={1.8} strokeLinecap="round" />
              <line x1={x + 3.5} y1={Y - 3.5} x2={x - 3.5} y2={Y + 3.5}
                stroke={color} strokeWidth={1.8} strokeLinecap="round" />
            </g>
          );
        })}
      </g>
    );
  }
  // "command" type — APP-6E Theatre/Command = ++ (two plus signs)
  if (spec.type === "command") {
    return (
      <text x={0} y={Y} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={6} fontWeight="bold" fontFamily="monospace">
        {"++"}
      </text>
    );
  }
  return null;
}

export const NatoSymbol: React.FC<NatoSymbolProps> = ({
  size = 48,
  className,
  style,
  showSidc,
  ...input
}) => {
  const resolved = buildSymbol(input);
  const {
    palette, layers, echelonMark, amplifierText,
    borderDashed, borderDotted, sidc,
  } = resolved;

  // Scale: `size` px maps to FW logical units wide
  const scale       = (size * 0.8) / FW;
  const echelonRoom = 14 * scale;
  // Extra vertical room: echelon marks above + HQ stave below
  const hqExtra     = (input.hq === "hq" || input.hq === "hqTaskForce") ? 10 * scale : 0;
  const totalH      = (FH + 14) * scale + hqExtra;

  // SVG centre point (echelon mark lives above, HQ stave below)
  const cx = size / 2;
  const cy = echelonRoom + (FH / 2) * scale;

  // Dash/dot patterns for frame border (scaled inverse so they appear consistent)
  const dashArray = borderDotted ? `${1.5 / scale} ${2 / scale}` : `${3 / scale} ${2 / scale}`;

  return (
    <svg
      width={size}
      height={totalH}
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size} ${totalH}`}
      aria-label={showSidc ? `NATO symbol SIDC: ${sidc}` : undefined}
    >
      {showSidc && <title>SIDC: {sidc}</title>}
      <g transform={`translate(${cx},${cy}) scale(${scale})`}>
        {/* Layers */}
        {layers.map((layer) => {
          const isFrame = layer.id === "frame";
          const ic      = isFrame ? palette.border : palette.iconColor;
          const needsDash = isFrame && (borderDashed || borderDotted);

          // Determine fill for frame shape
          const frameFill = palette.fill;

          if (isFrame) {
            // Frame: filled + border
            return (
              <g key={layer.id}>
                {/* Fill pass — colour fill */}
                {layer.ops.map((op, i) => {
                  if (op.op === "path") {
                    return <path key={`ff${i}`} d={op.d} fill={frameFill} stroke="none" />;
                  }
                  if (op.op === "circle") {
                    return (
                      <circle key={`ff${i}`} cx={op.cx} cy={op.cy} r={op.r}
                        fill={frameFill} stroke="none" />
                    );
                  }
                  return null;
                })}
                {/* Border pass — solid base (thicker) */}
                {layer.ops.map((op, i) =>
                  renderOp(
                    { ...(op as IconDrawOp), ...(op.op === "path" || op.op === "circle" ? { filled: false } : {}) },
                    ic,
                    frameFill,
                    i + 100,
                  )
                )}
                {/* Dashed/dotted overlay if needed */}
                {needsDash && layer.ops.map((op, i) => {
                  if (op.op === "path") {
                    return (
                      <path key={`fd${i}`} d={op.d} fill="none"
                        stroke={ic} strokeWidth={2.2}
                        strokeDasharray={dashArray} />
                    );
                  }
                  return null;
                })}
              </g>
            );
          }

          return (
            <g key={layer.id}
              transform={layer.ty ? `translate(0,${layer.ty})` : undefined}>
              {layer.ops.map((op, i) => renderOp(op, ic, palette.fill, i))}
            </g>
          );
        })}

        {/* Echelon mark — centred above frame (APP-6E §3.7) */}
        <EchelonMark spec={echelonMark.spec} color={palette.border} />

        {/* Field F — Reinforced (+) / Reduced (−) / Both (±) */}
        {amplifierText.reinforced && (
          <text
            x={FW / 2 + 4} y={-FH / 2 + 3}
            fill={palette.border} fontSize={6} fontWeight="bold" fontFamily="monospace"
            dominantBaseline="hanging">
            ({amplifierText.reinforced})
          </text>
        )}

        {/* HQ / TF label below the stave (when stave is rendered) */}
        {amplifierText.hqLabel && (
          <text
            x={0} y={FH / 2 + 11}
            textAnchor="middle" fill={palette.border}
            fontSize={4.5} fontWeight="bold" fontFamily="monospace">
            {amplifierText.hqLabel}
          </text>
        )}
      </g>
    </svg>
  );
};

