/**
 * UnitDetail — shows properties of the selected unit.
 * Includes a "Place on map" button that activates placement mode.
 */

import React from "react";
import ms from "milsymbol";
import type { OUnit, OSimulatorConfig, OSymbol, ValidationIssue, OAsset } from "@/shared/types";

interface Props {
  unitKey: string | null;
  units: Map<string, OUnit>;
  configs: Map<string, OSimulatorConfig>;
  symbols: Map<string, OSymbol>;
  vbs4Assets: Map<string, OAsset>;
  issues: ValidationIssue[];
  placingUnitKey: string | null;
  onStartPlace: (unitKey: string) => void;
  onCancelPlace: () => void;
}

function sidcToDataUri(sidc: string, size: number): string {
  try {
    const svg = new ms.Symbol(sidc, { size, square: true }).asSVG();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return "";
  }
}

function SidcPreview({ sidc }: { sidc: string }) {
  const uri = sidcToDataUri(sidc, 48);
  if (!uri) return null;
  return <img src={uri} width={48} height={48} alt={sidc} style={{ display: "inline-block" }} />;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
      <span style={{ color: "#607d8b", fontSize: 12, minWidth: 120, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ color: "#e0e0e0", fontSize: 12 }}>{value}</span>
    </div>
  );
}

export function UnitDetail({
  unitKey,
  units,
  configs,
  symbols,
  vbs4Assets,
  issues,
  placingUnitKey,
  onStartPlace,
  onCancelPlace,
}: Props) {
  if (!unitKey) {
    return (
      <div style={{ padding: 16, color: "#607d8b", fontSize: 13 }}>
        Select a unit in the tree to see details.
      </div>
    );
  }

  const unit = units.get(unitKey);
  const config = configs.get(unitKey);
  const symbol = symbols.get(unitKey);
  const asset = unit?.simulatorIdentifierCode ? vbs4Assets.get(unit.simulatorIdentifierCode) : null;

  if (!unit) {
    return (
      <div style={{ padding: 16, color: "#ef9a9a", fontSize: 13 }}>
        Unit data not found for {unitKey}
      </div>
    );
  }

  const hasPosition =
    symbol &&
    symbol.latitude !== null &&
    symbol.longitude !== null &&
    !(symbol.latitude === 0 && symbol.longitude === 0);

  const myIssues = issues.filter((i) => i.unitKey === unitKey);
  const isPlacing = placingUnitKey === unitKey;

  return (
    <div style={{ padding: 16, overflowY: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
        {unit.sidc && <SidcPreview sidc={unit.sidc} />}
        <div>
          <div style={{ color: "#e0e0e0", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            {unit.unitIdentifier}
          </div>
          <div style={{ color: "#90a4ae", fontSize: 12 }}>
            {unit.echelon} · {unit.militaryService}
          </div>
        </div>
      </div>

      {/* Identity */}
      <Row label="Primary key" value={unit.primaryKey} />
      <Row label="SIDC" value={unit.sidc} />
      <Row label="Affiliation" value={unit.affiliation} />
      <Row label="Allegiance" value={unit.allegiance} />

      {/* Simulation identifier */}
      {unit.simulatorIdentifierCode && (
        <>
          <div style={{ borderTop: "1px solid #1e3a4a", marginTop: 12, paddingTop: 12, marginBottom: 8, color: "#607d8b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Simulation Asset
          </div>
          <Row label="Identifier" value={unit.simulatorIdentifierCode} />
          {asset && (
            <>
              <Row label="Description" value={asset.description} />
              <Row label="Domain" value={asset.domain} />
              <Row label="Class type" value={asset.classType} />
              <Row label="Simulator" value={asset.derivedSimulator} />
              <Row label="Military domain" value={asset.derivedMilitaryDomain} />
              <Row label="Is drone" value={asset.isDrone ? "Yes" : "No"} />
            </>
          )}
        </>
      )}

      {/* Config */}
      {config && (
        <>
          <div
            style={{
              borderTop: "1px solid #1e3a4a",
              marginTop: 12,
              paddingTop: 12,
              marginBottom: 8,
              color: "#607d8b",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Simulator config
          </div>
          <Row label="Entity type" value={config.entityType} />
          <Row label="Owning simulator" value={config.owningSimulator} />
          <Row label="DIS code" value={config.dis} />
          <Row label="Can control drones" value={config.canControlDrones ? "Yes" : "No"} />
          {config.vbs4 && (
            <>
              <Row label="VBS4 class" value={config.vbs4.className} />
              <Row label="VBS4 role" value={config.vbs4.role} />
              <Row label="Is drone" value={config.vbs4.isDrone ? "Yes" : "No"} />
            </>
          )}
          {config.sword && (
            <>
              <Row label="SWORD class" value={config.sword.class} />
              <Row
                label="SWORD controllable"
                value={config.sword.controllable ? "Yes" : "No"}
              />
            </>
          )}
        </>
      )}

      {/* Position */}
      <div
        style={{
          borderTop: "1px solid #1e3a4a",
          marginTop: 12,
          paddingTop: 12,
          marginBottom: 8,
          color: "#607d8b",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        Map position
      </div>

      {hasPosition ? (
        <>
          <Row label="Latitude" value={symbol!.latitude!.toFixed(6)} />
          <Row label="Longitude" value={symbol!.longitude!.toFixed(6)} />
          {config?.entityType !== "organisation" && (
            <button
              onClick={() => onStartPlace(unitKey)}
              style={buttonStyle("#1565C0")}
            >
              {isPlacing ? "Click map to reposition…" : "Reposition on map"}
            </button>
          )}
        </>
      ) : (
        <>
          <div style={{ color: "#ef9a9a", fontSize: 12, marginBottom: 10 }}>
            No position set
          </div>
          <button
            onClick={() => (isPlacing ? onCancelPlace() : onStartPlace(unitKey))}
            style={buttonStyle(isPlacing ? "#555" : "#1565C0")}
          >
            {isPlacing ? "Cancel placement" : "Place on map"}
          </button>
        </>
      )}

      {/* Validation issues */}
      {myIssues.length > 0 && (
        <>
          <div
            style={{
              borderTop: "1px solid #1e3a4a",
              marginTop: 12,
              paddingTop: 12,
              marginBottom: 8,
              color: "#607d8b",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Issues
          </div>
          {myIssues.map((issue, i) => (
            <div
              key={i}
              style={{
                padding: "6px 10px",
                marginBottom: 4,
                borderRadius: 4,
                background: issue.severity === "ERROR" ? "#C6282822" : "#E6510022",
                borderLeft: `3px solid ${issue.severity === "ERROR" ? "#C62828" : "#E65100"}`,
                fontSize: 12,
                color: "#e0e0e0",
              }}
            >
              {issue.message}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function buttonStyle(bg: string): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    padding: "8px 12px",
    background: bg,
    color: "#fff",
    border: "none",
    borderRadius: 4,
    fontSize: 13,
    cursor: "pointer",
    marginTop: 8,
    textAlign: "left",
  };
}

