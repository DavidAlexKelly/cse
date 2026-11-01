import React, { useMemo, useState } from "react";
import type { CanonicalAsset, Vbs4Asset } from "./types.js";
import { InlineAuditButton } from "./InlineAuditButton.js";
import { DisCodeBadge } from "./DisCodeBadge.js";

interface Props {
  selectedKey: string | null;
  selectedType: "canonical" | "vbs4";
  canonical: CanonicalAsset[];
  vbs4: Vbs4Asset[];
  onClose: () => void;
}

function Row({ label, value }: { label: string; value?: string | null | React.ReactNode }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="am-detail-prop-row">
      <span className="am-detail-prop-key">{label}</span>
      <span className={`am-detail-prop-val${empty ? " null" : ""}`}>
        {empty ? "—" : value}
      </span>
    </div>
  );
}

/** A text value that is capped to 2 lines with an expand toggle */
function LongTextRow({ label, value }: { label: string; value?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const empty = !value;
  return (
    <div className="am-detail-prop-row am-detail-prop-row--long">
      <span className="am-detail-prop-key">{label}</span>
      <span className={`am-detail-prop-val${empty ? " null" : ""}${!expanded ? " am-detail-prop-val--clamped" : ""}`}>
        {empty ? "—" : value}
      </span>
      {!empty && (
        <button className="am-detail-expand-btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Less ▲" : "More ▼"}
        </button>
      )}
    </div>
  );
}

function mappingStatus(linkedVbs4: Vbs4Asset[]): string {
  if (linkedVbs4.length === 0) return "Unmapped";
  return "Fully mapped";
}

export const AssetDetailView: React.FC<Props> = ({
  selectedKey,
  selectedType,
  canonical,
  vbs4,
  onClose,
}) => {
  const canonicalAsset = useMemo(
    () => (selectedType === "canonical"
      ? canonical.find((c) => c.primaryKey === selectedKey)
      : canonical.find((c) => c.primaryKey === vbs4.find((v) => v.identifier === selectedKey)?.canonicalAssetKey)),
    [selectedKey, selectedType, canonical, vbs4]
  );

  const vbs4Asset = useMemo(
    () => selectedType === "vbs4"
      ? vbs4.find((v) => v.identifier === selectedKey)
      : undefined,
    [selectedKey, selectedType, vbs4]
  );

  const linkedVbs4 = useMemo(
    () => canonicalAsset ? vbs4.filter((v) => v.canonicalAssetKey === canonicalAsset.primaryKey) : [],
    [canonicalAsset, vbs4]
  );

  // Duplicate DIS code detection
  const duplicateDis = useMemo(() => {
    if (!vbs4Asset?.disCode) return [];
    return vbs4.filter((v) => v.disCode === vbs4Asset.disCode && v.identifier !== vbs4Asset.identifier);
  }, [vbs4Asset, vbs4]);

  if (!selectedKey) return null;
  const displayName = canonicalAsset?.canonicalName ?? vbs4Asset?.identifier ?? selectedKey;
  const subtitle = [
    canonicalAsset?.militaryDomain,
    canonicalAsset?.nationality,
    canonicalAsset?.assetCategory,
  ]
    .filter(Boolean)
    .join(" · ");
  const mappedStatus = canonicalAsset ? mappingStatus(linkedVbs4) : "";
  const primaryVbs4 = vbs4Asset ?? linkedVbs4[0];

  // Best audit id: for a vbs4 entry use its identifier; for canonical use primaryKey
  const auditId = primaryVbs4?.identifier ?? canonicalAsset?.primaryKey ?? selectedKey;

  return (
    <>
      {/* Dim backdrop — click to dismiss */}
      <button
        className="am-overlay-backdrop"
        onClick={onClose}
        aria-label="Close asset detail"
        style={{ border: "none", padding: 0 }}
      />

      {/* Slide-in panel */}
      <div className="am-overlay-panel">
        {/* Header */}
        <div className="am-overlay-header">
          <div className="am-overlay-header-text">
            <div className="am-overlay-title">{displayName}</div>
            <div className="am-overlay-subtitle">
              {subtitle}
              {mappedStatus && (
                <span
                  style={{
                    marginLeft: 8,
                    padding: "1px 8px",
                    borderRadius: 10,
                    background: "var(--am-green-dim)",
                    color: "var(--am-green)",
                    border: "1px solid rgba(50,164,103,0.3)",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {mappedStatus}
                </span>
              )}
            </div>
          </div>
          <button className="am-overlay-close" onClick={onClose}>✕</button>
        </div>

        {/* Scrollable body */}
        <div className="am-overlay-body">
          {/* ── Two-column cards ── */}

          {/* Canonical Asset card */}
          <div className="am-detail-card">
            <div className="am-detail-card-title">Canonical Asset</div>
            <div className="am-detail-card-body">
              {!canonicalAsset ? (
                <div style={{ padding: "14px", fontSize: 12, color: "var(--am-text-muted)", fontStyle: "italic" }}>
                  No canonical asset linked
                </div>
              ) : (
                <>
                  <Row label="Asset ID" value={<code style={{ fontSize: 11 }}>{canonicalAsset.primaryKey}</code>} />
                  <Row
                    label="Platform name"
                    value={<strong>{canonicalAsset.canonicalName}</strong>}
                  />
                  <Row label="Military domain" value={canonicalAsset.militaryDomain} />
                  <Row label="Class type" value={canonicalAsset.assetCategory} />
                  <Row label="Nationality" value={canonicalAsset.nationality} />
                  <Row label="Service branch" value={canonicalAsset.branch} />
                  <Row label="Simulation class" value={canonicalAsset.simulationClass} />
                </>
              )}
            </div>
          </div>

          {/* VBS4 Catalogue Entry card */}
          <div className="am-detail-card">
            <div className="am-detail-card-title">VBS4 Catalogue Entry</div>
            <div className="am-detail-card-body">
              {!primaryVbs4 ? (
                <div style={{ padding: "14px", fontSize: 12, color: "var(--am-red)", fontStyle: "italic" }}>
                  No VBS4 entry — this asset cannot be spawned in simulation
                </div>
              ) : (
                <>
                  <Row label="Entity class" value={<code style={{ fontSize: 11 }}>{primaryVbs4.identifier}</code>} />

                  <Row
                    label="DIS entity type"
                    value={<DisCodeBadge code={primaryVbs4.disCode} variant="plain" />}
                  />
                  <Row label="Domain" value={primaryVbs4.domain ?? primaryVbs4.derivedMilitaryDomain} />
                  <Row
                    label="Commander seat"
                    value={primaryVbs4.hasCommander === null ? "—" : primaryVbs4.hasCommander ? "Yes (rear)" : "No"}
                  />
                  <Row
                    label="Gunner seat"
                    value={
                      primaryVbs4.gunnerSeatCount
                        ? `Yes (${primaryVbs4.gunnerSeatNames ?? "front"})`
                        : primaryVbs4.gunnerSeatCount === 0
                        ? "No"
                        : "—"
                    }
                  />
                  <Row label="Cargo seats" value={primaryVbs4.numCargoSeats?.toString() ?? "—"} />
                  <Row label="Drone capable" value={primaryVbs4.isDrone === null ? "—" : primaryVbs4.isDrone ? "Yes" : "No"} />
                  {primaryVbs4.description && (
                    <LongTextRow label="Description" value={primaryVbs4.description} />
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Additional VBS4 entries for this canonical ── */}
          {linkedVbs4.length > 1 && (
            <div className="am-detail-card">
              <div className="am-detail-card-title">All VBS4 entries ({linkedVbs4.length})</div>
              <div className="am-detail-card-body">
                {linkedVbs4.map((v) => (
                  <div key={v.identifier} className="am-detail-prop-row">
                    <code className="am-detail-prop-key" style={{ fontSize: 11 }}>{v.identifier}</code>
                    <span className="am-detail-prop-val" style={{ fontSize: 11, color: "var(--am-text-muted)" }}>
                      {[v.domain, v.nationality, v.disCode].filter(Boolean).join(" · ")}
                      {v.isDrone ? " · Drone" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
        )}

          {/* ── Duplicate DIS code warning ── */}
          {duplicateDis.length > 0 && (
            <div className="am-warn-banner">
              <span className="am-warn-banner-icon">⚠</span>
              <span>
                A second VBS4 entr{duplicateDis.length > 1 ? "ies" : "y"} (
                {duplicateDis.map((d) => d.identifier).join(", ")}) share
                {duplicateDis.length === 1 ? "s" : ""} the same DIS code.
                This may indicate a duplicate — review before assigning to ORBAT units.
              </span>
            </div>
          )}

          {/* ── Linked units placeholder ── */}
          {canonicalAsset && (
            <div className="am-linked-units-section">
              <div className="am-linked-units-title">Linked units in current operations</div>
              <div className="am-chip-list">
                <div className="am-chip">
                  <span className="am-chip-icon">⎇</span>
                  <span style={{ color: "var(--am-text-muted)", fontStyle: "italic", fontSize: 11 }}>
                    No unit linkage data in current SDK version
                  </span>
                </div>
              </div>
            </div>
        )}

          {/* ── AI Audit ── */}
          <InlineAuditButton auditId={auditId} />
        </div>
      </div>
    </>
  );
};

