// ============================================================
//  Asset Manager — DIS Code Badge
// ============================================================
//
//  Renders a monospaced DIS entity-type code that expands into
//  a rich tooltip decoding the 7-tuple against SISO-REF-010 v35.
//
//  Used throughout the VBS4 / Sword / Simworks tables and in the
//  asset detail overlay. Click to open the DIS Reference view
//  filtered to this exact code (via an optional onOpenReference).

import React, { useState, useRef, useLayoutEffect } from "react";
import { decodeDisCode } from "./dis/disLookup.js";

interface Props {
  code: string | null | undefined;
  /** Called when the badge is clicked — typically opens the DIS Reference view. */
  onOpenReference?: (code: string) => void;
  /** Optional: force a specific badge style. Defaults to inline monospace pill. */
  variant?: "pill" | "plain";
}

export const DisCodeBadge: React.FC<Props> = ({
  code,
  onOpenReference,
  variant = "pill",
}) => {
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const decoded = React.useMemo(() => decodeDisCode(code), [code]);

  // Decide whether the tooltip should render above or below the badge
  // based on available viewport space. Only recomputed while open.
  useLayoutEffect(() => {
    if (!open || !badgeRef.current) return;
    const r = badgeRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    setFlipUp(below < 240 && r.top > 240);
  }, [open]);

  if (!code || !code.trim()) {
    return (
      <span
        style={{
          color: "var(--am-red)",
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        ⚠ Missing
      </span>
    );
  }

  const clickable = onOpenReference != null;
  const handleClick = () => {
    if (decoded && onOpenReference) onOpenReference(decoded.code);
  };

  return (
    <span
      ref={badgeRef}
      className={`am-dis-badge${variant === "plain" ? " am-dis-badge--plain" : ""}${
        decoded?.exactMatch ? " am-dis-badge--exact" : ""
      }${decoded && !decoded.exactMatch && decoded.hasCatalogueBase ? " am-dis-badge--partial" : ""}${
        decoded && !decoded.hasCatalogueBase ? " am-dis-badge--unknown" : ""
      }${clickable ? " am-dis-badge--clickable" : ""}`}
      tabIndex={0}
      role={clickable ? "button" : "note"}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={
        decoded?.summary ? `DIS code ${code}: ${decoded.summary}` : `DIS code ${code}`
      }
    >
      <code>{code}</code>
      {decoded && open && (
        <div
          className={`am-dis-tip${flipUp ? " am-dis-tip--up" : ""}`}
          role="tooltip"
        >
          <div className="am-dis-tip-header">
            <span className="am-dis-tip-code">{decoded.code}</span>
            {decoded.exactMatch ? (
              <span className="am-dis-tip-badge exact">✓ SISO match</span>
            ) : decoded.hasCatalogueBase ? (
              <span className="am-dis-tip-badge partial">~ Partial</span>
            ) : (
              <span className="am-dis-tip-badge unknown">? Unknown</span>
            )}
          </div>
          {decoded.summary && (
            <div className="am-dis-tip-summary">{decoded.summary}</div>
          )}
          <div className="am-dis-tip-grid">
            <DisRow label="Kind"        pos={0} value={decoded.parts.kind}        desc={decoded.labels.kind} />
            <DisRow label="Domain"      pos={1} value={decoded.parts.domain}      desc={decoded.labels.domain} />
            <DisRow label="Country"     pos={2} value={decoded.parts.country}     desc={decoded.labels.country} />
            <DisRow label="Category"    pos={3} value={decoded.parts.category}    desc={decoded.labels.category} />
            <DisRow label="Subcategory" pos={4} value={decoded.parts.subcategory} desc={decoded.labels.subcategory} />
            <DisRow label="Specific"    pos={5} value={decoded.parts.specific}    desc={decoded.labels.specific} />
            <DisRow label="Extra"       pos={6} value={decoded.parts.extra}       desc={decoded.labels.extra} />
          </div>
          {clickable && (
            <div className="am-dis-tip-hint">Click to view all matching entities →</div>
          )}
        </div>
      )}
    </span>
  );
};

interface RowProps {
  label: string;
  pos: number;
  value: string;
  desc: string | null;
}

const DisRow: React.FC<RowProps> = ({ label, pos, value, desc }) => {
  const isEmpty = value === "0" || value === "";
  return (
    <div className={`am-dis-tip-row${isEmpty ? " am-dis-tip-row--empty" : ""}`}>
      <span className="am-dis-tip-label">
        <span className="am-dis-tip-pos">{pos}</span>
        {label}
      </span>
      <span className="am-dis-tip-value">{value || "0"}</span>
      <span className={`am-dis-tip-desc${!desc && !isEmpty ? " unknown" : ""}`}>
        {desc || (isEmpty ? "—" : <span style={{ fontStyle: "italic" }}>unknown</span>)}
      </span>
    </div>
  );
};
