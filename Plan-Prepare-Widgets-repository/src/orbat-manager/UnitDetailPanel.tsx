// ============================================================
//  Unit Detail Slide-In Panel
//  Uses shared MilButton — no Blueprint Button
// ============================================================

import React from "react";
import type { UnitNode, Side, CommandRelationshipType } from "./types.js";
import { ECHELON_LABELS, IDENTITY_LABELS, COMMAND_REL_LABELS, COMMAND_REL_DESCRIPTION, COMMAND_REL_COLOUR } from "./types.js";
import { NatoSymbol } from "./NatoSymbol.js";
import { countPersonnel, countUnits, aggregateWeapons } from "./treeUtils.js";
import { AssetEditor } from "./AssetEditor.js";
import { UnitPlatformPanel } from "./UnitPlatformPanel.js";
import { MilButton } from "../shared/components/Button.js";

interface UnitDetailPanelProps {
  node: UnitNode | null;
  side: Side | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (node: UnitNode) => void;
  onAddChild: (parentId: string) => void;
  /** Insert a new unit as the parent of this one */
  onAddParent?: (node: UnitNode) => void;
  onDelete: (nodeId: string) => void;
  groupUnits?: UnitNode[];
  onUpdateUnit?: (unitId: string, input: Record<string, unknown>) => Promise<void>;
  onUpdateParentAssets?: (parentUnitId: string, newAssets: UnitNode["assets"]) => void;
  onSelectUnit?: (unit: UnitNode) => void;
  /** Parent unit node, so we can show the relationship to it */
  parentNode?: UnitNode | null;
}

const CE_COLOURS: Record<string, { bg: string; fg: string; border: string }> = {
  FO:  { bg: "rgba(36, 180, 126,0.25)",  fg: "#4ade80", border: "rgba(36, 180, 126,0.5)" },
  SO:  { bg: "rgba(36, 180, 126,0.15)",  fg: "#4ade80", border: "rgba(36, 180, 126,0.3)" },
  MO:  { bg: "rgba(240, 168, 60,0.22)", fg: "#f5b955", border: "rgba(240, 168, 60,0.4)" },
  NO:  { bg: "rgba(239, 77, 77,0.22)",  fg: "#f2726b", border: "rgba(239, 77, 77,0.4)" },
  UNK: { bg: "rgba(106, 114, 146,0.2)",   fg: "#98a1c0", border: "rgba(106, 114, 146,0.35)" },
};

const ECHELON_MARK: Record<string, string> = {
  team: "Ø", squad: "•", section: "••", platoon: "•••",
  company: "|", battalion: "||", regiment: "|||",
  brigade: "X", division: "XX", corps: "XXX",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em",
      color: "var(--mil-olive)", marginBottom: 6, marginTop: 14,
      borderBottom: "1px solid var(--mil-border)", paddingBottom: 3,
    }}>
      {children}
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "4px 0", borderBottom: "1px solid var(--mil-border)",
    }}>
      <span style={{ fontSize: 10, color: "var(--mil-muted)", textTransform: "uppercase", letterSpacing: "0.08em", minWidth: 110 }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: "var(--mil-text)", fontWeight: 500, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

export const UnitDetailPanel: React.FC<UnitDetailPanelProps> = ({
  node, side, isOpen, onClose, onEdit, onAddChild, onAddParent, onDelete,
  groupUnits, onUpdateUnit, onUpdateParentAssets, onSelectUnit, parentNode,
}) => {
  if (!node || !side) return null;

  // Command relationship badge
  const relType = node.commandRelationshipType as CommandRelationshipType | undefined;
  const relColour = relType ? COMMAND_REL_COLOUR[relType] : null;

  const totalPax  = countPersonnel([node]);
  const directPax = node.personnelCount;
  const totalSubs = countUnits([node]) - 1;
  const ce        = node.capabilities.combatEffectiveness;
  const ceCol     = ce ? (CE_COLOURS[ce] ?? null) : null;
  // Aggregate weapons across this node and all its descendants + platforms
  const aggregatedWeapons = aggregateWeapons(node);

  const handleAssetsChange = async (newAssets: UnitNode["assets"]) => {
    if (onUpdateUnit) await onUpdateUnit(node.id, { assetsJson: JSON.stringify(newAssets) });
  };

  const handleUpdateParentAssets = (parentUnitId: string, newAssets: UnitNode["assets"]) => {
    if (onUpdateParentAssets) onUpdateParentAssets(parentUnitId, newAssets);
  };

  return (
    <>
      {isOpen && (
        <div
          className="orbat-backdrop"
          role="button" tabIndex={-1}
          aria-label="Close detail panel"
          onClick={onClose}
          onKeyDown={e => { if (e.key === "Escape") onClose(); }}
        />
      )}

      <div className={`orbat-detail-overlay ${isOpen ? "open" : ""}`}>
        {/* ── Header ── */}
        <div style={{
          background: "var(--mil-bg-2)",
          borderBottom: "1px solid var(--mil-border)",
          flexShrink: 0,
        }}>
          {/* Top row */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px 4px" }}>
            <NatoSymbol
              standardIdentity={side.standardIdentity}
              echelon={node.echelon}
              icon={node.symbol.icon}
              hq={node.symbol.hqIndicator}
              sector1={node.symbol.sector1}
              sector2={node.symbol.sector2}
              status={node.symbol.status}
              reinforced={node.symbol.reinforced}
              size={48}
              showSidc
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--mil-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {node.name}
              </div>
              <div style={{ display: "flex", gap: 5, marginTop: 3, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 9, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.08em",
                  padding: "1px 5px", borderRadius: 2,
                  background: "var(--mil-surface)", border: "1px solid var(--mil-border-lt)", color: "var(--mil-text-2)",
                }}>
                  {ECHELON_MARK[node.echelon] ?? ""} {ECHELON_LABELS[node.echelon].toUpperCase()}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2,
                  background: "rgba(36, 180, 126,0.2)", color: "#4ade80",
                  border: "1px solid rgba(36, 180, 126,0.4)",
                }}>
                  {node.state.status.toUpperCase()}
                </span>
                {ceCol && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2,
                    background: ceCol.bg, color: ceCol.fg, border: `1px solid ${ceCol.border}`,
                  }}>
                    {ce}
                  </span>
                )}
                {/* Quick platform count badge */}
                {node.assets.length > 0 && (
                  <span style={{
                    fontSize: 9, padding: "1px 5px", borderRadius: 2,
                    background: "var(--mil-amber-mut)", color: "var(--mil-amber)",
                    border: "1px solid rgba(240, 168, 60,0.35)",
                  }}>
                    🚁 {node.assets.length} platform{node.assets.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            <MilButton variant="ghost" icon="cross" iconOnly onClick={onClose} title="Close" />
          </div>

          {/* CE bar */}
          {ceCol && (
            <div style={{ padding: "0 12px 6px" }}>
              <div style={{ fontSize: 9, color: "var(--mil-muted)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Combat Effectiveness
              </div>
              <div style={{ height: 3, borderRadius: 2, background: "var(--mil-border)" }}>
              <div style={{
                  height: "100%", borderRadius: 2,
                  width: ce === "FO" ? "100%" : ce === "SO" ? "75%" : ce === "MO" ? "50%" : ce === "NO" ? "10%" : "50%",
                  background: ceCol.fg,
                  transition: "width 0.3s",
                }} />
              </div>
            </div>
          )}

          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: "1px solid var(--mil-border)" }}>
            {[
              { val: directPax, label: "PAX" },
              { val: totalSubs, label: "SUB-UNITS" },
              { val: totalPax,  label: "TOTAL PAX" },
            ].map(({ val, label }) => (
              <div key={label} style={{
                textAlign: "center", padding: "8px 0",
                borderRight: "1px solid var(--mil-border)",
              }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--mil-cyan)", lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 9, color: "var(--mil-muted)", letterSpacing: "0.1em", marginTop: 2, textTransform: "uppercase" }}>
                  {label}
          </div>
        </div>
            ))}
      </div>

          {/* Command relationship to parent */}
          {(relType || parentNode) && (
            <div style={{
              margin: "0 10px 6px",
              padding: "7px 10px",
              borderRadius: 3,
              background: relColour?.bg ?? "rgba(96,165,250,0.08)",
              border: `1px solid ${relColour?.line ?? "rgba(96,165,250,0.25)"}`,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              {/* Line style preview */}
              <div style={{
                width: 22, height: 0, flexShrink: 0,
                borderBottom: relType === "TACON"
                  ? `2px dotted ${relColour?.line ?? "#60a5fa"}`
                  : relType === "OPCON" || relType === "ATTACHED"
                    ? `2px dashed ${relColour?.line ?? "#60a5fa"}`
                    : relType === "ASSIGNED" || relType === "ADCON"
                      ? `2px dashed ${relColour?.line ?? "#c084fc"}`
                      : `2px solid ${relColour?.line ?? "#60a5fa"}`,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: relColour?.badge ?? "var(--mil-text-2)" }}>
                  {relType ? COMMAND_REL_LABELS[relType] : "Organic"}
                  {parentNode && (
                    <span style={{ fontWeight: 400, color: "var(--mil-text-3)", marginLeft: 5 }}>
                      → {parentNode.name}
                    </span>
                  )}
                </div>
                {relType && (
                  <div style={{ fontSize: 9, color: "var(--mil-text-3)", marginTop: 1, lineHeight: 1.4 }}>
                    {COMMAND_REL_DESCRIPTION[relType]}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 6, padding: "8px 10px" }}>
            <MilButton variant="default" icon="edit" fill onClick={() => onEdit(node)}>Edit</MilButton>
            <MilButton variant="primary" icon="add" fill onClick={() => onAddChild(node.id)}>Add Child</MilButton>
            {onAddParent && (
              <MilButton variant="default" icon="add" fill onClick={() => onAddParent(node)}>Add Parent</MilButton>
            )}
            <MilButton variant="danger" icon="trash" iconOnly
              onClick={() => { onDelete(node.id); onClose(); }}
              title="Delete unit"
            />
          </div>
        </div>

        {/* ── Body ── */}
        <div className="detail-body">

          {relType && (
            <>
              <SectionLabel>Command Relationship</SectionLabel>
              <FieldRow label="Relationship Type" value={
                <span style={{
                  padding: "1px 8px", borderRadius: 3, fontSize: 11, fontWeight: 700,
                  background: relColour?.bg, color: relColour?.badge,
                  border: `1px solid ${relColour?.line}`,
                }}>
                  {COMMAND_REL_LABELS[relType]}
                </span>
              } />
              {parentNode && <FieldRow label="Parent Unit" value={parentNode.name} />}
              <div style={{
                fontSize: 10, color: "var(--mil-text-2)", lineHeight: 1.55,
                padding: "6px 0", borderBottom: "1px solid var(--mil-border)",
              }}>
                {COMMAND_REL_DESCRIPTION[relType]}
              </div>
            </>
          )}

          <SectionLabel>Symbology — APP-06(E)(2)</SectionLabel>
          <FieldRow label="Standard Identity" value={IDENTITY_LABELS[side.standardIdentity]} />
          <FieldRow label="Icon / Role" value={node.symbol.icon} />
          {node.symbol.sector1 && <FieldRow label="Sector 1 (Capability)" value={node.symbol.sector1} />}
          {node.symbol.sector2 && <FieldRow label="Sector 2 (Mobility)" value={node.symbol.sector2} />}
          {node.symbol.hqIndicator && <FieldRow label="HQ / TF (digit 8)" value={node.symbol.hqIndicator} />}
          {node.symbol.status && node.symbol.status !== "present" && (
            <FieldRow label="Status (digit 7)" value={node.symbol.status} />
          )}
          {node.symbol.reinforced && <FieldRow label="Reinforced/Reduced (F)" value={`(${node.symbol.reinforced})`} />}
          {node.symbol.sidc && (
            <FieldRow label="SIDC" value={
              <span style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: "0.08em", color: "var(--mil-muted)" }}>
                {node.symbol.sidc}
              </span>
            } />
          )}

          {(node.capabilities.combatEffectiveness || node.capabilities.callSign || node.capabilities.primaryWeapon ||
            node.capabilities.speedRoadKph || node.capabilities.rangeKm || node.capabilities.iffCode || node.capabilities.radioFreqMhz) && (
            <>
              <SectionLabel>Capabilities</SectionLabel>
              {node.capabilities.callSign && (
                <FieldRow label="Call-Sign" value={
                  <span style={{ fontFamily: "monospace", fontSize: 11, padding: "1px 6px", background: "var(--mil-cyan-dim)", border: "1px solid rgba(34,168,192,0.3)", borderRadius: 2 }}>
                    {node.capabilities.callSign}
                  </span>
                } />
              )}
              {node.capabilities.primaryWeapon && <FieldRow label="Primary Weapon" value={node.capabilities.primaryWeapon} />}
              {node.capabilities.speedRoadKph !== undefined && <FieldRow label="Speed (Road)" value={`${node.capabilities.speedRoadKph} km/h`} />}
              {node.capabilities.speedOffRoadKph !== undefined && <FieldRow label="Speed (Off-Road)" value={`${node.capabilities.speedOffRoadKph} km/h`} />}
              {node.capabilities.rangeKm !== undefined && <FieldRow label="Operational Range" value={`${node.capabilities.rangeKm} km`} />}
              {node.capabilities.iffCode && <FieldRow label="IFF / SIF" value={<span style={{ fontFamily: "monospace" }}>{node.capabilities.iffCode}</span>} />}
              {node.capabilities.radioFreqMhz !== undefined && <FieldRow label="Radio (Primary)" value={`${node.capabilities.radioFreqMhz} MHz`} />}
            </>
          )}

          {/* ── Equipment type (ontology-linked) ── */}
          {node.equipmentType && (
            <>
              <SectionLabel>Equipment Type</SectionLabel>
              <div style={{
                padding: "8px 10px",
                borderRadius: 3,
                background: "var(--mil-surface)",
                border: "1px solid var(--mil-border-lt)",
                borderLeft: "3px solid var(--mil-cyan)",
                marginBottom: 4,
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mil-text)" }}>
                    {node.equipmentType.nomenclature || node.equipmentType.key}
                  </span>
                  <span style={{
                    fontSize: 9, fontFamily: "monospace",
                    padding: "1px 5px", borderRadius: 2,
                    background: "var(--mil-cyan-dim)",
                    border: "1px solid rgba(34,168,192,0.3)",
                    color: "var(--mil-cyan-lt)",
                  }}>
                    {node.equipmentType.key}
                  </span>
                </div>
                {node.equipmentType.description && (
                  <div style={{ fontSize: 10, color: "var(--mil-text-2)", marginTop: 4, lineHeight: 1.5 }}>
                    {node.equipmentType.description}
                  </div>
                )}
                <div style={{ fontSize: 9, color: "var(--mil-muted)", marginTop: 4, fontStyle: "italic" }}>
                  NxgEquipmentType — real-world equipment nomenclature
                </div>
              </div>
            </>
          )}

          {/* ── Platforms — fully editable; changes persist via onUpdateUnit ── */}
          <SectionLabel>Platforms &amp; Vehicles</SectionLabel>
          <AssetEditor assets={node.assets} siblingUnits={node.children} onChange={handleAssetsChange} />

          {/* ── Platform assignments from parent units ── */}
          {groupUnits && groupUnits.length > 0 && (
            <>
              <SectionLabel>Platform Assignments (from parent units)</SectionLabel>
              <UnitPlatformPanel
                unit={node}
                groupUnits={groupUnits}
                onUpdateParentAssets={handleUpdateParentAssets}
                onSelectUnit={onSelectUnit}
              />
            </>
          )}

          {/* ── Own carried weapons ── */}
          {node.weapons.length > 0 && (
            <>
              <SectionLabel>Weapons Loadout (Carried by this unit)</SectionLabel>
              {node.weapons.map(w => (
                <div key={w.id} className="weapon-row">
                  <span className="weapon-row__name">{w.name}</span>
                  {w.calibre && <span className="weapon-row__cal">{w.calibre}</span>}
                  <span className="weapon-row__qty">×{w.quantity}</span>
                  {w.roundsCarried && (
                    <span style={{ fontSize: 10, color: "var(--mil-muted)", marginLeft: 4 }}>
                      {w.roundsCarried} rnds/wpn
                    </span>
                  )}
                </div>
              ))}
            </>
          )}

          {/* ── Aggregated total weapons (shown when children or armed platforms exist) ── */}
          {aggregatedWeapons.length > 0 && (node.children.length > 0 || node.assets.some(a => a.weapons.length > 0)) && (
            <>
              <SectionLabel>Total Weapons (This Unit + All Sub-units)</SectionLabel>
              <div style={{ fontSize: 10, color: "var(--mil-text-2)", marginBottom: 6, fontStyle: "italic" }}>
                Aggregated across all subordinate units and platform armaments.
              </div>
              {aggregatedWeapons.map(w => (
                <div key={w.key} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 8px", borderRadius: 2,
                  border: "1px solid rgba(248,113,113,0.2)",
                  background: "rgba(248,113,113,0.06)", marginBottom: 3,
                }}>
                  <span style={{ fontSize: 12, color: "#f87171", flexShrink: 0 }}>⚔</span>
                  <span style={{ flex: 1, fontSize: 12, color: "var(--mil-text)", fontWeight: 500 }}>{w.name}</span>
                  {w.calibre && <span style={{ fontSize: 10, color: "var(--mil-muted)", flexShrink: 0 }}>{w.calibre}</span>}
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#f87171", fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "right" }}>
                    ×{w.totalQuantity.toLocaleString()}
                  </span>
                  {w.totalRounds > 0 && (
                    <span style={{ fontSize: 10, color: "var(--mil-muted)", minWidth: 70, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {w.totalRounds.toLocaleString()} rnds
                    </span>
                  )}
                </div>
              ))}
            </>
          )}

          {node.customProperties.length > 0 && (
            <>
              <SectionLabel>Custom Properties</SectionLabel>
              {node.customProperties.map(prop => (
                <FieldRow
                  key={prop.id}
                  label={prop.label || prop.key}
                  value={
                    prop.type === "boolean"
                      ? (prop.value === "true" ? "✓ Yes" : prop.value === "false" ? "✗ No" : "—")
                      : prop.unit
                      ? `${prop.value} ${prop.unit}`
                      : prop.value || "—"
                  }
                />
              ))}
            </>
          )}

          {node.notes && (
            <>
              <SectionLabel>Notes</SectionLabel>
              <div style={{
                fontFamily: "monospace", fontSize: 11, color: "var(--mil-text-2)",
                padding: "8px 10px", background: "var(--mil-bg-2)",
                border: "1px solid var(--mil-border)", borderRadius: 2, lineHeight: 1.6,
              }}>
                {node.notes}
            </div>
            </>
          )}

          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--mil-muted)" }}>
            <span>ID: {node.id.slice(0, 14)}…</span>
            <span>{node.state.lastUpdated ? new Date(node.state.lastUpdated).toLocaleString() : ""}</span>
          </div>
        </div>
      </div>
    </>
  );
};

