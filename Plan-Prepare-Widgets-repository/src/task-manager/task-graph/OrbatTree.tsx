import React, { useState } from "react";

// ── ORBAT tree data ─────────────────────────────────────────────────────

interface OrbatUnit {
  id: string;
  name: string;
  echelon: "corps" | "division" | "brigade" | "battalion" | "company";
  type: "infantry" | "armour" | "artillery" | "signals" | "logistics" | "engineer" | "hq" | "aviation" | "recce";
  nation: string;
  children?: OrbatUnit[];
}

const ORBAT_DATA: OrbatUnit = {
  id: "mn-div",
  name: "MN DIV",
  echelon: "division",
  type: "hq",
  nation: "NATO",
  children: [
    {
      id: "2-bde",
      name: "2/282 BDE (DEU)",
      echelon: "brigade",
      type: "armour",
      nation: "DEU",
      children: [
        { id: "2-bn-inf", name: "2 BN INF", echelon: "battalion", type: "infantry", nation: "DEU" },
        { id: "2-bn-arm", name: "2 BN ARM", echelon: "battalion", type: "armour", nation: "DEU" },
        { id: "2-bty-arty", name: "2 BTY ARTY", echelon: "company", type: "artillery", nation: "DEU" },
      ],
    },
    {
      id: "14-bde",
      name: "14 BDE (POL)",
      echelon: "brigade",
      type: "infantry",
      nation: "POL",
      children: [
        { id: "14-bn-inf-1", name: "14/1 BN INF", echelon: "battalion", type: "infantry", nation: "POL" },
        { id: "14-bn-inf-2", name: "14/2 BN INF", echelon: "battalion", type: "infantry", nation: "POL" },
        { id: "14-recce", name: "14 RECCE SQN", echelon: "company", type: "recce", nation: "POL" },
      ],
    },
    {
      id: "div-troops",
      name: "DIV TROOPS",
      echelon: "brigade",
      type: "logistics",
      nation: "NATO",
      children: [
        { id: "233-sig", name: "233 SIG BN", echelon: "battalion", type: "signals", nation: "NOR" },
        { id: "css-bn", name: "CSS BN", echelon: "battalion", type: "logistics", nation: "NLD" },
        { id: "eng-coy", name: "ENG COY", echelon: "company", type: "engineer", nation: "GBR" },
        { id: "hkp-stab", name: "HKP STAB (AVN)", echelon: "battalion", type: "aviation", nation: "NOR" },
      ],
    },
  ],
};

// ── NATO APP-6 symbol rendering (simplified) ────────────────────────────

const ECHELON_MARKS: Record<string, string> = {
  corps: "✕✕✕",
  division: "✕✕",
  brigade: "✕",
  battalion: "II",
  company: "I",
};

const TYPE_SYMBOL: Record<string, React.ReactNode> = {
  infantry: (
    <svg width="20" height="14" viewBox="0 0 20 14">
      <line x1="2" y1="12" x2="18" y2="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="2" y1="2" x2="18" y2="12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  armour: (
    <svg width="20" height="14" viewBox="0 0 20 14">
      <ellipse cx="10" cy="7" rx="8" ry="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  artillery: (
    <svg width="20" height="14" viewBox="0 0 20 14">
      <circle cx="10" cy="7" r="4" fill="currentColor" />
    </svg>
  ),
  signals: (
    <svg width="20" height="14" viewBox="0 0 20 14">
      <path d="M2 10 L6 4 L10 10 L14 4 L18 10" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  logistics: (
    <svg width="20" height="14" viewBox="0 0 20 14">
      <circle cx="10" cy="7" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="6" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  engineer: (
    <svg width="20" height="14" viewBox="0 0 20 14">
      <rect x="3" y="3" width="14" height="8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <text x="10" y="10" textAnchor="middle" fontSize="7" fill="currentColor" fontWeight="700">E</text>
    </svg>
  ),
  hq: (
    <svg width="20" height="14" viewBox="0 0 20 14">
      <rect x="3" y="3" width="14" height="8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <line x1="3" y1="11" x2="10" y2="3" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  aviation: (
    <svg width="20" height="14" viewBox="0 0 20 14">
      <path d="M3 11 L10 3 L17 11" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  recce: (
    <svg width="20" height="14" viewBox="0 0 20 14">
      <line x1="2" y1="7" x2="18" y2="7" stroke="currentColor" strokeWidth="1.5" />
      <line x1="10" y1="2" x2="10" y2="12" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
    </svg>
  ),
};

const NATION_FLAG: Record<string, string> = {
  DEU: "🇩🇪",
  POL: "🇵🇱",
  NOR: "🇳🇴",
  GBR: "🇬🇧",
  NLD: "🇳🇱",
  NATO: "⊕",
};

// ── Tree node component ─────────────────────────────────────────────────

const OrbatNode: React.FC<{ unit: OrbatUnit; depth: number }> = ({ unit, depth }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = unit.children && unit.children.length > 0;

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      {/* Node row */}
      <div
        role={hasChildren ? "button" : undefined}
        tabIndex={hasChildren ? 0 : undefined}
        onClick={() => hasChildren && setExpanded(!expanded)}
        onKeyDown={(e) => hasChildren && (e.key === "Enter" || e.key === " ") && setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 8px",
          borderRadius: 2,
          cursor: hasChildren ? "pointer" : "default",
          background: depth === 0 ? "rgba(108, 92, 231,0.08)" : "transparent",
          border: depth === 0 ? "1px solid rgba(108, 92, 231,0.2)" : "1px solid transparent",
          marginBottom: 2,
          transition: "background 0.1s",
        }}
      >
        {/* Expand/collapse */}
        {hasChildren ? (
          <span style={{ fontSize: 10, color: "#6a7292", width: 12, textAlign: "center" }}>
            {expanded ? "▾" : "▸"}
          </span>
        ) : (
          <span style={{ width: 12 }} />
        )}

        {/* APP-6 symbol box */}
        <div
          style={{
            width: 28,
            height: 20,
            border: "1.5px solid #63a2ff",
            borderRadius: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#63a2ff",
            background: "rgba(76, 126, 243,0.08)",
            flexShrink: 0,
            position: "relative",
          }}
        >
          {TYPE_SYMBOL[unit.type]}
          {/* Echelon mark above */}
          <span
            style={{
              position: "absolute",
              top: -9,
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: 7,
              color: "#63a2ff",
              fontWeight: 700,
            }}
          >
            {ECHELON_MARKS[unit.echelon]}
          </span>
        </div>

        {/* Name */}
        <span style={{ fontSize: 11, fontWeight: 600, color: "#e6eaf8", flex: 1 }}>
          {unit.name}
        </span>

        {/* Nation */}
        <span style={{ fontSize: 11 }}>
          {NATION_FLAG[unit.nation] ?? ""}
        </span>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div style={{ borderLeft: "1px solid #232a45", marginLeft: 14, paddingLeft: 4 }}>
          {unit.children!.map((child) => (
            <OrbatNode key={child.id} unit={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main ORBAT Tree component ───────────────────────────────────────────

export const OrbatTree: React.FC = () => {
  return (
    <div
      style={{
        width: "100%",
        background: "#141828",
        border: "1px solid #232a45",
        borderRadius: 3,
        padding: 12,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: "1px solid #232a45",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#98a1c0",
          }}
        >
          Force Structure — 6 units
        </span>
        <span style={{ fontSize: 9, color: "#6a7292", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          NATO APP-6
        </span>
      </div>

      {/* Tree */}
      <OrbatNode unit={ORBAT_DATA} depth={0} />
    </div>
  );
};
