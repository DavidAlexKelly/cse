import React from "react";


// ── Static SVG map of the Baltic / Sorvian Peninsula exercise area ──────
// Simplified representation inspired by the screenshot showing the
// Baltic Sea region (Sweden, Poland, Lithuania, Latvia, Estonia area)

interface TerrainFeature {
  name: string;
  type: string;
  x: number;
  y: number;
}

const TERRAIN_FEATURES: TerrainFeature[] = [
  { name: "PORT SOVA", type: "LOC hub", x: 220, y: 280 },
  { name: "RIDGELINE AMBER", type: "Dominant ground", x: 350, y: 180 },
  { name: "BRIDGE CLUSTER DELTA", type: "Crossing sites", x: 300, y: 340 },
];

export const ExerciseAreaMap: React.FC = () => {
  return (
    <div
      style={{
        width: "100%",
        background: "#1a2030",
        borderRadius: 3,
        border: "1px solid #232a45",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Header label */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: "50%",
          transform: "translateX(-50%)",
          background: "#080a12",
          border: "1px solid #232a45",
          borderRadius: 2,
          padding: "2px 10px",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#98a1c0",
          zIndex: 2,
          whiteSpace: "nowrap",
        }}
      >
        Exercise Area — Iron Forge 26
      </div>

      <svg
        viewBox="0 0 480 360"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* Water background */}
        <rect width="480" height="360" fill="#1a2535" />

        {/* Grid lines */}
        {[80, 160, 240, 320, 400].map((x) => (
          <line key={`vg${x}`} x1={x} y1="0" x2={x} y2="360" stroke="#1e2838" strokeWidth="0.5" />
        ))}
        {[72, 144, 216, 288].map((y) => (
          <line key={`hg${y}`} x1="0" y1={y} x2="480" y2={y} stroke="#1e2838" strokeWidth="0.5" />
        ))}

        {/* Landmasses (simplified Scandinavia / Baltic region) */}
        {/* Sweden mainland (left) */}
        <path
          d="M 0 0 L 120 0 L 130 40 L 140 80 L 135 120 L 125 160 L 110 200 L 100 240 L 80 280 L 60 310 L 40 330 L 0 360 Z"
          fill="#2a3a28"
          stroke="#3a5a38"
          strokeWidth="1"
        />

        {/* Finland / Eastern land (top right) */}
        <path
          d="M 380 0 L 480 0 L 480 140 L 450 160 L 420 150 L 400 120 L 380 80 L 370 40 Z"
          fill="#2a3a28"
          stroke="#3a5a38"
          strokeWidth="1"
        />

        {/* Baltic states / Poland (bottom) */}
        <path
          d="M 150 320 L 200 300 L 260 290 L 320 295 L 380 300 L 440 310 L 480 320 L 480 360 L 0 360 L 40 340 L 80 330 L 120 325 Z"
          fill="#2a3a28"
          stroke="#3a5a38"
          strokeWidth="1"
        />

        {/* Gotland island */}
        <ellipse cx="200" cy="210" rx="15" ry="25" fill="#2a3a28" stroke="#3a5a38" strokeWidth="0.8" />

        {/* AOR polygon (exercise area overlay) */}
        <path
          d="M 130 100 L 260 80 L 380 90 L 420 170 L 400 270 L 300 300 L 180 290 L 120 220 Z"
          fill="rgba(108, 92, 231,0.12)"
          stroke="#6c5ce7"
          strokeWidth="1.5"
          strokeDasharray="6 3"
        />

        {/* Phase lines */}
        <line x1="200" y1="90" x2="200" y2="280" stroke="#f0a83c" strokeWidth="0.8" strokeDasharray="4 3" opacity="0.6" />
        <text x="203" y="100" fill="#f0a83c" fontSize="7" opacity="0.7">PL ODIN</text>

        <line x1="310" y1="85" x2="310" y2="290" stroke="#f0a83c" strokeWidth="0.8" strokeDasharray="4 3" opacity="0.6" />
        <text x="313" y="95" fill="#f0a83c" fontSize="7" opacity="0.7">PL THOR</text>

        {/* Terrain feature markers */}
        {TERRAIN_FEATURES.map((f) => (
          <g key={f.name}>
            {/* Marker circle */}
            <circle cx={f.x} cy={f.y} r="6" fill="rgba(76, 126, 243,0.3)" stroke="#4c7ef3" strokeWidth="1.5" />
            <circle cx={f.x} cy={f.y} r="2.5" fill="#63a2ff" />
            {/* Label */}
            <rect
              x={f.x + 10}
              y={f.y - 8}
              width={f.name.length * 5.5 + 8}
              height="14"
              rx="1"
              fill="rgba(10,12,15,0.85)"
              stroke="#2f3860"
              strokeWidth="0.5"
            />
            <text x={f.x + 14} y={f.y + 2} fill="#e6eaf8" fontSize="8" fontWeight="600">
              {f.name}
            </text>
            {/* Type label below */}
            <text x={f.x + 14} y={f.y + 14} fill="#6a7292" fontSize="6.5">
              {f.type}
            </text>
          </g>
        ))}

        {/* Compass rose */}
        <g transform="translate(440, 30)">
          <circle cx="0" cy="0" r="12" fill="rgba(10,12,15,0.7)" stroke="#2f3860" strokeWidth="0.5" />
          <text x="0" y="-3" textAnchor="middle" fill="#98a1c0" fontSize="6" fontWeight="700">N</text>
          <line x1="0" y1="2" x2="0" y2="9" stroke="#98a1c0" strokeWidth="1" />
        </g>

        {/* Coordinate labels */}
        <text x="10" y="355" fill="#6a7292" fontSize="7">N 54.0° E 015.0°</text>
        <text x="400" y="355" fill="#6a7292" fontSize="7">N 54.0° E 021.0°</text>
      </svg>

      {/* Legend overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
          background: "rgba(10,12,15,0.85)",
          border: "1px solid #232a45",
          borderRadius: 2,
          padding: "4px 8px",
          fontSize: 8,
          color: "#98a1c0",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 12, height: 2, background: "#6c5ce7", borderRadius: 1 }} />
          AOR boundary
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 12, height: 2, background: "#f0a83c", opacity: 0.7, borderRadius: 1 }} />
          Phase lines
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#63a2ff" }} />
          Key terrain
        </div>
      </div>
    </div>
  );
};
