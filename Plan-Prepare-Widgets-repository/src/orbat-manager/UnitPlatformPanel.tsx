// ============================================================
//  Unit Platform Panel — child unit's view of parent platforms
// ============================================================

import React, { useState } from "react";
import type { UnitNode } from "./types.js";
import { findPlatformAssignments, toggleUnitInAsset, flattenSections } from "./platformContext.js";
import type { PlatformAssignment } from "./platformContext.js";

function platformIcon(presetId: string): string {
  const cat = presetId.toLowerCase();
  if (cat.includes("sub"))      return "🤿";
  if (cat.includes("carrier"))  return "⛴";
  if (cat.includes("destroyer") || cat.includes("frigate") || cat.includes("corvette")) return "⚓";
  if (cat.includes("helicopter") || cat.includes("chinook") || cat.includes("apache") ||
      cat.includes("merlin")    || cat.includes("wildcat")  || cat.includes("puma")    ||
      cat.includes("blackhawk")) return "🚁";
  if (cat.includes("fixed")     || cat.includes("typhoon") || cat.includes("f-35")  ||
      cat.includes("f-16")      || cat.includes("a-10"))    return "✈";
  if (cat.includes("mbt")       || cat.includes("challenger") || cat.includes("abrams") ||
      cat.includes("leopard")   || cat.includes("t-90"))    return "🛡";
  if (cat.includes("ifv")       || cat.includes("warrior")  || cat.includes("bradley") ||
      cat.includes("bmp")       || cat.includes("cv-90"))   return "🚖";
  if (cat.includes("apc")       || cat.includes("boxer")    || cat.includes("m113"))   return "🚌";
  return "🔲";
}

interface AssignmentCardProps {
  assignment: PlatformAssignment;
  unit: UnitNode;
  onUpdateParentAssets: (parentUnitId: string, newAssets: UnitNode["assets"]) => void;
  onSelectUnit?: (u: UnitNode) => void;
}

const AssignmentCard: React.FC<AssignmentCardProps> = ({
  assignment, unit, onUpdateParentAssets, onSelectUnit,
}) => {
  const { parentUnit, asset, section, sectionPath } = assignment;
  const [reassignOpen, setReassignOpen] = useState(false);

  const allFlat  = flattenSections(asset.sections);
  const icon     = platformIcon(asset.presetId);
  const qtyLabel = asset.quantity > 1 ? `${asset.quantity}× ` : "";
  const currentLabel = section ? sectionPath.join(" › ") : "Platform level";

  const handleReassign = (newSectionId: string | null) => {
    // Remove from everywhere first
    let wa = toggleUnitInAsset(parentUnit, asset.id, unit.id, null, false);
    for (const { section: fs } of flattenSections(asset.sections)) {
      if ((fs.assignedUnitIds ?? []).includes(unit.id)) {
        wa = toggleUnitInAsset({ ...parentUnit, assets: wa }, asset.id, unit.id, fs.id, false);
      }
    }
    // Then assign to new location
    wa = toggleUnitInAsset({ ...parentUnit, assets: wa }, asset.id, unit.id, newSectionId, true);
    onUpdateParentAssets(parentUnit.id, wa);
    setReassignOpen(false);
  };

  return (
    <div style={{
      border: "1px solid #2f3860", borderLeft: "3px solid #f0a83c",
      borderRadius: 2, marginBottom: 10, background: "#0b0e18", overflow: "hidden",
    }}>
      {/* Platform header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
        background: "#0e1120", borderBottom: "1px solid #232a45",
      }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#e6eaf8", fontFamily: "monospace" }}>
            {qtyLabel}{asset.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            <span style={{ fontSize: 10, color: "#6a7292" }}>Owned by:</span>
            <button
              onClick={() => onSelectUnit?.(parentUnit)}
              style={{
                background: "none", border: "none", cursor: onSelectUnit ? "pointer" : "default",
                fontSize: 10, color: "#22a8c0", padding: 0,
                textDecoration: onSelectUnit ? "underline" : "none",
              }}>
              {parentUnit.name}
            </button>
          </div>
        </div>
        <span style={{
          fontSize: 10, color: "#f0a83c", padding: "1px 6px",
          background: "rgba(240, 168, 60,0.12)", border: "1px solid rgba(240, 168, 60,0.3)", borderRadius: 2,
        }}>
          {asset.crewCount} crew
        </span>
      </div>

      <div style={{ padding: "8px 10px" }}>
        {/* Current assignment */}
        <div style={{ fontSize: 9, color: "#6a7292", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
          Current Assignment
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 2,
          background: section ? "rgba(34,168,192,0.08)" : "rgba(90,112,96,0.08)",
          border: `1px solid ${section ? "rgba(34,168,192,0.3)" : "#2f3860"}`,
        }}>
          <span style={{ fontSize: 13 }}>📍</span>
          <span style={{ fontSize: 11, color: section ? "#22a8c0" : "#98a1c0", flex: 1 }}>
            {currentLabel}
          </span>
          {section && <span style={{ fontSize: 10, color: "#6a7292" }}>{section.personnelCount} pax</span>}
        </div>

        {/* Change section button */}
        <button
          onClick={() => setReassignOpen(r => !r)}
          style={{
            marginTop: 6, display: "flex", alignItems: "center", gap: 4,
            background: "none", border: "1px solid #2f3860", cursor: "pointer",
            borderRadius: 2, padding: "3px 8px",
            fontSize: 10, fontWeight: 700, color: "#22a8c0", letterSpacing: "0.06em",
          }}>
          {reassignOpen ? "▲" : "▼"} CHANGE SECTION
        </button>

        {/* Section picker */}
        {reassignOpen && (
          <div style={{
            marginTop: 6, padding: "6px 8px",
            background: "#0e1120", border: "1px solid #232a45", borderRadius: 2,
          }}>
            <div style={{ fontSize: 9, color: "#6a7292", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Select section:
            </div>
            <label style={{
              display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", cursor: "pointer",
              background: !section ? "rgba(34,168,192,0.08)" : "transparent",
              borderRadius: 2, marginBottom: 2,
            }}>
              <input type="radio" name={`rs-${asset.id}`} checked={!section}
                onChange={() => handleReassign(null)} />
              <span style={{ fontSize: 11, color: "#98a1c0" }}>Platform level (no section)</span>
            </label>
            {allFlat.map(({ section: sec, depth }) => (
              <label key={sec.id} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                cursor: "pointer", marginLeft: depth * 12,
                background: section?.id === sec.id ? "rgba(34,168,192,0.08)" : "transparent",
                borderRadius: 2, marginBottom: 2,
              }}>
                <input type="radio" name={`rs-${asset.id}`} checked={section?.id === sec.id}
                  onChange={() => handleReassign(sec.id)} />
                <span style={{ fontSize: 11, color: "#e6eaf8" }}>{sec.name}</span>
                <span style={{ fontSize: 10, color: "#6a7292" }}>{sec.personnelCount} pax</span>
                {(sec.assignedUnitIds ?? []).length > 0 && (
                  <span style={{
                    fontSize: 9, padding: "0 4px", borderRadius: 8,
                    background: "rgba(34,168,192,0.15)", color: "#22a8c0",
                  }}>
                    {sec.assignedUnitIds!.length}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}

        {/* Assign own children to sub-sections */}
        {unit.children.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{
              fontSize: 9, color: "#6a7292", textTransform: "uppercase",
              letterSpacing: "0.08em", marginBottom: 5,
              borderTop: "1px solid #232a45", paddingTop: 6,
            }}>
              Assign sub-units to sections in this platform:
            </div>
            {unit.children.map(child => {
              // Find where this child is currently assigned
              const childInSection = flattenSections(asset.sections).find(
                ({ section: fs }) => (fs.assignedUnitIds ?? []).includes(child.id)
              );
              const childAtAssetLevel = (asset.assignedUnitIds ?? []).includes(child.id);
              const isAssigned = childAtAssetLevel || !!childInSection;

              return (
                <div key={child.id} style={{
                  marginBottom: 4, padding: "5px 8px",
                  background: isAssigned ? "rgba(240, 168, 60,0.06)" : "#0e1120",
                  border: `1px solid ${isAssigned ? "rgba(240, 168, 60,0.25)" : "#232a45"}`,
                  borderRadius: 2,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: isAssigned ? 4 : 0 }}>
                    <span style={{ flex: 1, fontSize: 11, color: "#e6eaf8", fontWeight: 600 }}>{child.name}</span>
                    <span style={{ fontSize: 10, color: "#98a1c0" }}>{child.echelon}</span>
                    {childInSection && (
                      <span style={{
                        fontSize: 9, padding: "0 5px", borderRadius: 2,
                        background: "rgba(34,168,192,0.15)", color: "#22a8c0",
                      }}>
                        → {childInSection.section.name}
                      </span>
                    )}
                    {childAtAssetLevel && !childInSection && (
                      <span style={{ fontSize: 9, color: "#98a1c0" }}>Platform level</span>
                    )}
                  </div>
                  {/* Section selector for this child */}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {/* Remove / platform level */}
                    {!childAtAssetLevel && !childInSection ? (
                      <button onClick={() => {
                        const na = toggleUnitInAsset(parentUnit, asset.id, child.id, null, true);
                        onUpdateParentAssets(parentUnit.id, na);
                      }}
                        style={{ fontSize: 9, padding: "1px 7px", borderRadius: 2, cursor: "pointer", background: "#1a1f36", border: "1px solid #2f3860", color: "#98a1c0" }}>
                        + Assign
                      </button>
                    ) : (
                      <>
                        <button onClick={() => {
                          // Remove from everywhere
                          let wa = toggleUnitInAsset(parentUnit, asset.id, child.id, null, false);
                          for (const { section: fs } of flattenSections(asset.sections)) {
                            if ((fs.assignedUnitIds ?? []).includes(child.id)) {
                              wa = toggleUnitInAsset({ ...parentUnit, assets: wa }, asset.id, child.id, fs.id, false);
                            }
                          }
                          onUpdateParentAssets(parentUnit.id, wa);
                        }}
                          style={{ fontSize: 9, padding: "1px 7px", borderRadius: 2, cursor: "pointer", background: "rgba(239, 77, 77,0.15)", border: "1px solid rgba(239, 77, 77,0.35)", color: "#f87171" }}>
                          Remove
                        </button>
                        {allFlat.map(({ section: sec, depth }) => (
                          <button key={sec.id}
                            onClick={() => {
                              let wa = toggleUnitInAsset(parentUnit, asset.id, child.id, null, false);
                              for (const { section: fs } of flattenSections(asset.sections)) {
                                if ((fs.assignedUnitIds ?? []).includes(child.id)) {
                                  wa = toggleUnitInAsset({ ...parentUnit, assets: wa }, asset.id, child.id, fs.id, false);
                                }
                              }
                              wa = toggleUnitInAsset({ ...parentUnit, assets: wa }, asset.id, child.id, sec.id, true);
                              onUpdateParentAssets(parentUnit.id, wa);
                            }}
                            style={{
                              fontSize: 9, padding: "1px 7px", borderRadius: 2, cursor: "pointer",
                              marginLeft: depth * 4,
                              background: childInSection?.section.id === sec.id
                                ? "rgba(34,168,192,0.2)" : "#1a1f36",
                              border: `1px solid ${childInSection?.section.id === sec.id ? "#22a8c0" : "#2f3860"}`,
                              color: childInSection?.section.id === sec.id ? "#22a8c0" : "#98a1c0",
                            }}>
                            {sec.name}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────
interface UnitPlatformPanelProps {
  unit: UnitNode;
  groupUnits: UnitNode[];
  onUpdateParentAssets: (parentUnitId: string, newAssets: UnitNode["assets"]) => void;
  onSelectUnit?: (u: UnitNode) => void;
}

export const UnitPlatformPanel: React.FC<UnitPlatformPanelProps> = ({
  unit, groupUnits, onUpdateParentAssets, onSelectUnit,
}) => {
  const assignments = findPlatformAssignments(groupUnits, unit.id);

  if (assignments.length === 0) {
    return (
      <div style={{
        padding: "10px 12px", background: "#0e1120",
        border: "1px solid #232a45", borderRadius: 2,
        fontSize: 11, color: "#6a7292", fontStyle: "italic", lineHeight: 1.5,
      }}>
        Not assigned to any platform. Parent units can assign this unit via their Platforms tab.
      </div>
    );
  }

  return (
    <div>
      <div style={{
        fontSize: 9, color: "#f0a83c", fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", marginBottom: 6,
      }}>
        {assignments.length} platform assignment{assignments.length > 1 ? "s" : ""}
      </div>
      {assignments.map((asgn, i) => (
        <AssignmentCard
          key={`${asgn.parentUnit.id}-${asgn.asset.id}-${i}`}
          assignment={asgn}
          unit={unit}
          onUpdateParentAssets={onUpdateParentAssets}
          onSelectUnit={onSelectUnit}
        />
      ))}
    </div>
  );
};
