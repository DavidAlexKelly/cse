// ============================================================
//  Mismatch Detail Overlay
//  Shows a single MismatchRecord with highlighted problem
//  fields and full canonical + VBS4 context side-by-side.
// ============================================================

import React, { useState } from "react";
import type {
  MismatchRecord,
  MismatchCategory,
  MismatchSeverity,
  CanonicalAsset,
  Vbs4Asset,
  UnitRef,
} from "./types.js";
import { InlineAuditButton } from "./InlineAuditButton.js";

interface Props {
  record: MismatchRecord;
  canonical: CanonicalAsset[];
  vbs4: Vbs4Asset[];
  units: UnitRef[];
  onClose: () => void;
}

// ─── Which fields are "bad" per category ─────────────────────────────────────

type FieldSide = "canonical" | "vbs4" | "unit";
interface HighlightSpec {
  side: FieldSide;
  field: string;
}

const HIGHLIGHT_FIELDS: Record<MismatchCategory, HighlightSpec[]> = {
  orphan_vbs4: [
    { side: "vbs4", field: "dis6Code" },
    { side: "vbs4", field: "canonicalAssetKey" },
  ],
  orphan_simworks: [{ side: "vbs4", field: "dis6Code" }],
  orphan_sword: [{ side: "vbs4", field: "dis6Code" }],
  unmapped_canonical: [{ side: "canonical", field: "primaryKey" }],
  single_simulator_only: [{ side: "canonical", field: "primaryKey" }],
  cross_sim_disagreement: [
    { side: "canonical", field: "militaryDomain" },
    { side: "canonical", field: "nationality" },
    { side: "vbs4", field: "disCode" },
  ],
  domain_mismatch: [
    { side: "vbs4", field: "derivedMilitaryDomain" },
    { side: "canonical", field: "militaryDomain" },
  ],
  nationality_mismatch: [
    { side: "vbs4", field: "nationality" },
    { side: "canonical", field: "nationality" },
  ],
  missing_crew_config: [
    { side: "vbs4", field: "hasCommander" },
    { side: "vbs4", field: "gunnerSeatCount" },
    { side: "vbs4", field: "numCargoSeats" },
  ],
  missing_dis_code: [{ side: "vbs4", field: "disCode" }],
  missing_dis6: [{ side: "vbs4", field: "dis6Code" }],
  duplicate_sim_class: [{ side: "vbs4", field: "simulationClass" }],
  unused_vbs4: [{ side: "vbs4", field: "identifier" }],
  unused_simworks: [{ side: "vbs4", field: "identifier" }],
  unused_sword: [{ side: "vbs4", field: "identifier" }],
  dead_unit_reference: [{ side: "unit", field: "simulatorIdentifierCode" }],
  unit_missing_sim_code: [
    { side: "unit", field: "simulatorIdentifierCode" },
    { side: "unit", field: "owningSimulator" },
  ],
  unit_sim_owner_mismatch: [
    { side: "unit", field: "owningSimulator" },
    { side: "unit", field: "simulatorIdentifierCode" },
  ],
  unit_broken_canonical: [{ side: "unit", field: "canonicalAssetKey" }],
  branch_inconsistency: [
    { side: "canonical", field: "branch" },
    { side: "vbs4", field: "derivedMilitaryDomain" },
    { side: "vbs4", field: "classType" },
  ],
  drone_flag_mismatch: [
    { side: "vbs4", field: "isDrone" },
    { side: "canonical", field: "assetCategory" },
  ],
};

// ─── Severity colours ─────────────────────────────────────────────────────────

const SEV_COLOR: Record<MismatchSeverity, string> = {
  error: "var(--am-red)",
  warning: "var(--am-amber)",
  info: "var(--am-accent)",
};
const SEV_BG: Record<MismatchSeverity, string> = {
  error: "var(--am-red-dim)",
  warning: "var(--am-amber-dim)",
  info: "rgba(76,144,240,0.12)",
};
const SEV_ICON: Record<MismatchSeverity, string> = {
  error: "●",
  warning: "▲",
  info: "◆",
};

// ─── Row helper ──────────────────────────────────────────────────────────────

interface RowProps {
  label: string;
  value: string | null | undefined;
  highlight?: boolean;
  missing?: boolean;
}
function Row({ label, value, highlight, missing }: RowProps) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div
      className={`am-mmd-row${highlight ? " highlight" : ""}${
        missing ? " missing" : ""
      }`}
    >
      <span className="am-mmd-row-key">{label}</span>
      <span className={`am-mmd-row-val${empty ? " null" : ""}`}>
        {empty ? "—" : value}
      </span>
      {(highlight || missing) && (
        <span className="am-mmd-row-flag">
          {missing ? "Missing" : "Conflict"}
        </span>
      )}
    </div>
  );
}

// ─── Card helper ─────────────────────────────────────────────────────────────

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="am-detail-card">
      <div className="am-detail-card-title">{title}</div>
      <div>{children}</div>
    </div>
  );
}

// ─── Collapsible inline notice ────────────────────────────────────────────────

interface CollapsibleNoticeProps {
  summary: string;
  detail: string;
  color: string;
  bg: string;
  icon: string;
}
function CollapsibleNotice({
  summary,
  detail,
  color,
  bg,
  icon,
}: CollapsibleNoticeProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="am-mmd-notice"
      style={{ borderColor: color, background: bg }}
    >
      <button
        className="am-mmd-notice-row"
        onClick={() => setExpanded((e) => !e)}
      >
        <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
        <span className="am-mmd-notice-summary" style={{ color }}>
          {summary}
        </span>
        <span className="am-mmd-notice-chevron" style={{ color }}>
          {expanded ? "▲" : "▼"}
        </span>
      </button>
      {expanded && <div className="am-mmd-notice-detail">{detail}</div>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const MismatchDetailOverlay: React.FC<Props> = ({
  record,
  canonical,
  vbs4,
  units,
  onClose,
}) => {
  const highlights = HIGHLIGHT_FIELDS[record.category] ?? [];
  const isHL = (side: FieldSide, field: string) =>
    highlights.some((h) => h.side === side && h.field === field);

  // Resolve related objects
  const vbs4Asset = vbs4.find((v) => v.identifier === record.affectedKey);
  const canonAsset = canonical.find(
    (c) =>
      c.primaryKey === record.affectedKey ||
      c.primaryKey === vbs4Asset?.canonicalAssetKey
  );
  const unitRef = units.find((u) => u.primaryKey === record.affectedKey);

  // For duplicate_sim_class the affectedKey is the FIRST of the duplicates
  const dupGroup =
    record.category === "duplicate_sim_class"
      ? vbs4.filter((v) => {
          const simClass = vbs4Asset?.simulationClass ?? "";
          return (
            simClass &&
            v.simulationClass?.trim().toLowerCase() ===
              simClass.trim().toLowerCase()
          );
        })
      : [];

  const fixText = FIX_TEXT[record.category]?.(vbs4Asset, canonAsset);

  return (
    <>
      <button
        className="am-overlay-backdrop"
        onClick={onClose}
        aria-label="Close mismatch detail"
        style={{ border: "none", padding: 0 }}
      />

      <div className="am-overlay-panel">
        {/* ── Header ── */}
        <div className="am-overlay-header">
          <div className="am-overlay-header-text">
            <div className="am-overlay-title" style={{ fontSize: 14 }}>
              {record.title}
            </div>
            <div className="am-overlay-subtitle">
              <span
                style={{
                  padding: "1px 8px",
                  borderRadius: 10,
                  background: SEV_BG[record.severity],
                  color: SEV_COLOR[record.severity],
                  fontSize: 10,
                  fontWeight: 700,
                  marginRight: 6,
                }}
              >
                {SEV_ICON[record.severity]} {record.severity.toUpperCase()}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                {record.affectedKey}
              </span>
            </div>
          </div>
          <button className="am-overlay-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="am-overlay-body">
          {/* Issue summary — collapsible */}
          <CollapsibleNotice
            summary={
              record.detail.length > 90
                ? record.detail.slice(0, 87) + "…"
                : record.detail
            }
            detail={record.detail}
            color={SEV_COLOR[record.severity]}
            bg={SEV_BG[record.severity]}
            icon={SEV_ICON[record.severity]}
          />

          {/* ── Canonical asset card ── */}
          {canonAsset && (
            <Card title="Canonical Asset">
              <Row
                label="Asset ID"
                value={canonAsset.primaryKey}
                highlight={isHL("canonical", "primaryKey")}
              />
              <Row label="Name" value={canonAsset.canonicalName} />
              <Row
                label="Military domain"
                value={canonAsset.militaryDomain}
                highlight={isHL("canonical", "militaryDomain")}
                missing={
                  isHL("canonical", "militaryDomain") &&
                  !canonAsset.militaryDomain
                }
              />
              <Row
                label="Asset category"
                value={canonAsset.assetCategory}
                highlight={isHL("canonical", "assetCategory")}
              />
              <Row
                label="Nationality"
                value={canonAsset.nationality}
                highlight={isHL("canonical", "nationality")}
                missing={
                  isHL("canonical", "nationality") && !canonAsset.nationality
                }
              />
              <Row
                label="Branch"
                value={canonAsset.branch}
                highlight={isHL("canonical", "branch")}
                missing={isHL("canonical", "branch") && !canonAsset.branch}
              />
              <Row label="Sim class" value={canonAsset.simulationClass} />
              {canonAsset.subcategory && (
                <Row label="Subcategory" value={canonAsset.subcategory} />
              )}
            </Card>
          )}

          {/* ── VBS4 entry card ── */}
          {vbs4Asset && (
            <Card title="VBS4 Catalogue Entry">
              <Row
                label="Identifier"
                value={vbs4Asset.identifier}
                highlight={isHL("vbs4", "identifier")}
              />
              <Row
                label="Canonical asset key"
                value={vbs4Asset.canonicalAssetKey}
                highlight={isHL("vbs4", "canonicalAssetKey")}
                missing={
                  isHL("vbs4", "canonicalAssetKey") &&
                  !vbs4Asset.canonicalAssetKey
                }
              />
              <Row
                label="Derived domain"
                value={vbs4Asset.derivedMilitaryDomain ?? vbs4Asset.domain}
                highlight={isHL("vbs4", "derivedMilitaryDomain")}
              />
              <Row
                label="Nationality"
                value={vbs4Asset.nationality}
                highlight={isHL("vbs4", "nationality")}
                missing={isHL("vbs4", "nationality") && !vbs4Asset.nationality}
              />
              <Row
                label="Class type"
                value={vbs4Asset.classType}
                highlight={isHL("vbs4", "classType")}
              />
              <Row
                label="Is drone"
                value={
                  vbs4Asset.isDrone === null
                    ? null
                    : vbs4Asset.isDrone
                    ? "Yes"
                    : "No"
                }
                highlight={isHL("vbs4", "isDrone")}
              />
              <Row
                label="DIS code"
                value={vbs4Asset.disCode}
                highlight={isHL("vbs4", "disCode")}
                missing={isHL("vbs4", "disCode") && !vbs4Asset.disCode}
              />
              <Row
                label="Simulation class"
                value={vbs4Asset.simulationClass}
                highlight={isHL("vbs4", "simulationClass")}
              />
              <Row
                label="Commander seat"
                value={
                  vbs4Asset.hasCommander === null
                    ? null
                    : vbs4Asset.hasCommander
                    ? "Yes"
                    : "No"
                }
                highlight={isHL("vbs4", "hasCommander")}
                missing={
                  isHL("vbs4", "hasCommander") &&
                  vbs4Asset.hasCommander !== true
                }
              />
              <Row
                label="Gunner seats"
                value={vbs4Asset.gunnerSeatCount?.toString() ?? null}
                highlight={isHL("vbs4", "gunnerSeatCount")}
                missing={
                  isHL("vbs4", "gunnerSeatCount") && !vbs4Asset.gunnerSeatCount
                }
              />
              <Row
                label="Cargo seats"
                value={vbs4Asset.numCargoSeats?.toString() ?? null}
                highlight={isHL("vbs4", "numCargoSeats")}
                missing={
                  isHL("vbs4", "numCargoSeats") && !vbs4Asset.numCargoSeats
                }
              />
              <Row label="DIS 6 code" value={vbs4Asset.dis6Code} />
              {vbs4Asset.sidc && <Row label="SIDC" value={vbs4Asset.sidc} />}
              {vbs4Asset.simulator && (
                <Row label="Simulator" value={vbs4Asset.simulator} />
              )}
              {vbs4Asset.disCodeSource && (
                <Row label="DIS code source" value={vbs4Asset.disCodeSource} />
              )}
              {vbs4Asset.disCodeSynthesisNote && (
                <Row
                  label="DIS synthesis note"
                  value={vbs4Asset.disCodeSynthesisNote}
                />
              )}
              {vbs4Asset.description && (
                <Row label="Description" value={vbs4Asset.description} />
              )}
            </Card>
          )}

          {/* ── Unmapped canonical notice — collapsible ── */}
          {record.category === "unmapped_canonical" &&
            canonAsset &&
            !vbs4Asset && (
              <CollapsibleNotice
                summary="No VBS4 entry — platform cannot be spawned in simulation."
                detail={`No VBS4 catalogue entry references this canonical asset. A VBS4 entry must be created with its canonicalAssetKey set to "${canonAsset.primaryKey}" before this platform can be used in simulation.`}
                color="var(--am-red)"
                bg="var(--am-red-dim)"
                icon="⛔"
              />
            )}

          {/* ── Unit card (for dead_unit_reference) ── */}
          {unitRef && (
            <Card title="Unit">
              <Row label="Unit ID" value={unitRef.primaryKey} />
              <Row label="Identifier" value={unitRef.unitIdentifier} />
              <Row
                label="Simulator ID code"
                value={unitRef.simulatorIdentifierCode}
                highlight={isHL("unit", "simulatorIdentifierCode")}
                missing={
                  isHL("unit", "simulatorIdentifierCode") &&
                  !unitRef.simulatorIdentifierCode
                }
              />
              <Row
                label="Canonical asset (DIS 6 code FK)"
                value={unitRef.canonicalAssetKey}
              />
              {unitRef.owningSimulator && (
                <Row label="Owning simulator" value={unitRef.owningSimulator} />
              )}
              {unitRef.militaryService && (
                <Row label="Military service" value={unitRef.militaryService} />
              )}
              {unitRef.echelon && (
                <Row label="Echelon" value={unitRef.echelon} />
              )}
              {unitRef.affiliation && (
                <Row label="Affiliation" value={unitRef.affiliation} />
              )}
              {unitRef.allegiance && (
                <Row label="Allegiance" value={unitRef.allegiance} />
              )}
            </Card>
          )}

          {/* ── Duplicate group (for duplicate_sim_class) ── */}
          {dupGroup.length > 1 && (
            <Card
              title={`All entries with this simulation class (${dupGroup.length})`}
            >
              {dupGroup.map((v) => (
                <div key={v.identifier} className="am-mmd-row">
                  <span
                    className="am-mmd-row-key"
                    style={{ fontFamily: "monospace", fontSize: 11 }}
                  >
                    {v.identifier}
                  </span>
                  <span
                    className="am-mmd-row-val"
                    style={{ fontSize: 11, color: "var(--am-text-muted)" }}
                  >
                    {[
                      v.domain ?? v.derivedMilitaryDomain,
                      v.nationality,
                      v.disCode,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              ))}
            </Card>
          )}

          {/* ── How to fix — collapsible ── */}
          {fixText && (
            <CollapsibleNotice
              summary="How to resolve"
              detail={fixText}
              color="var(--am-text-muted)"
              bg="var(--am-surface-2)"
              icon="🔧"
            />
          )}

          {/* ── Inline AI Audit ── */}
          <InlineAuditButton auditId={record.auditId} />
        </div>
      </div>
    </>
  );
};

// ─── "How to fix" section ────────────────────────────────────────────────────

const FIX_TEXT: Record<
  MismatchCategory,
  (v?: Vbs4Asset | null, c?: CanonicalAsset | null) => string
> = {
  orphan_vbs4: (v) =>
    v?.dis6Code || v?.canonicalAssetKey
      ? `The VBS4 entry has dis6Code "${
          v?.dis6Code ?? "—"
        }" / canonicalAssetKey "${
          v?.canonicalAssetKey ?? "—"
        }" but no NxgCanonicalAsset with that primaryKey exists. Either create the canonical asset or fix the FK to point at an existing one. Note: the ontology link uses dis6Code.`
      : `Set dis6Code on VBS4 entry "${v?.identifier}" to the primaryKey of the matching NxgCanonicalAsset — that is the field the ontology link resolves through.`,
  orphan_simworks: (v) =>
    `Set dis6Code on the Simworks entry "${v?.identifier}" to the primaryKey of the matching NxgCanonicalAsset (or fix the existing dis6Code so it points to a real canonical asset).`,
  orphan_sword: (v) =>
    `Set dis6Code on the Sword entry "${v?.identifier}" to the primaryKey of the matching NxgCanonicalAsset (or fix the existing dis6Code so it points to a real canonical asset).`,
  unmapped_canonical: (_, c) =>
    `Create a simulator catalogue entry (VBS4, Simworks or Sword) for this platform and set its dis6Code to "${
      c?.primaryKey ?? "this asset's primaryKey"
    }". Ideally add entries in ALL three simulators so federated exercises can use it.`,
  single_simulator_only: (_, c) =>
    `Consider adding "${
      c?.canonicalName ?? c?.primaryKey
    }" to the other two simulator catalogues so it can be spawned in federated exercises regardless of which simulator each participant is running.`,
  cross_sim_disagreement: (_, c) =>
    `Reconcile the disagreeing values across simulators. All three catalogues should broadcast the same DIS entity type and describe "${
      c?.canonicalName ?? c?.primaryKey
    }" with the same domain and nationality — otherwise DIS-based interop will fail.`,
  domain_mismatch: (v, c) =>
    `Either update the simulator entry's domain (currently "${
      v?.derivedMilitaryDomain ?? v?.domain
    }") to match the canonical "${
      c?.militaryDomain
    }", or correct the canonical asset's militaryDomain.`,
  nationality_mismatch: (v, c) =>
    `Align the nationality: sim entry says "${v?.nationality}", canonical says "${c?.nationality}". Update whichever is incorrect.`,
  missing_crew_config: () =>
    `Set hasCommander, gunnerSeatCount, and/or numCargoSeats on the VBS4 entry so crew roles can be assigned during exercise planning.`,
  missing_dis_code: () =>
    `Set the disCode field to the correct DIS entity type code (format: Kind.Domain.Country.Category.Subcategory.Specific.Extra, e.g. 1.2.225.1.1.1).`,
  missing_dis6: () =>
    `Set dis6Code to the primaryKey of the matching NxgCanonicalAsset. Without dis6Code, the ontology link from the simulator entry to the canonical asset will not resolve.`,
  duplicate_sim_class: () =>
    `Review the entries that share this simulationClass within the simulator. If they represent the same platform, remove the duplicate. If they are different variants, ensure identifiers and descriptions clearly distinguish them.`,
  unused_vbs4: () =>
    `Informational — no NxgUnit references this VBS4 entry via simulatorIdentifierCode. If unused long-term, consider removing it.`,
  unused_simworks: () =>
    `Informational — no NxgUnit references this Simworks entry via simulatorIdentifierCode.`,
  unused_sword: () =>
    `Informational — no NxgUnit references this Sword entry via simulatorIdentifierCode.`,
  dead_unit_reference: () =>
    `Either create a catalogue entry (VBS4, Simworks or Sword) with that identifier, or update the unit's simulatorIdentifierCode to point to an existing entry in one of the three simulator catalogues.`,
  unit_missing_sim_code: () =>
    `Set simulatorIdentifierCode on the unit to a valid entry from the catalogue that matches its owningSimulator.`,
  unit_sim_owner_mismatch: () =>
    `Either change the unit's owningSimulator to match where its simulatorIdentifierCode actually lives, or update simulatorIdentifierCode to point to an entry in the current owningSimulator's catalogue.`,
  unit_broken_canonical: () =>
    `The unit's dis6Code points to a non-existent NxgCanonicalAsset. Fix dis6Code so it matches an existing canonical asset primaryKey.`,
  branch_inconsistency: (v, c) =>
    `Verify the classification. Canonical branch is "${
      c?.branch
    }" but VBS4 domain is "${
      v?.derivedMilitaryDomain ?? v?.domain
    }" with classType "${v?.classType}". Update the field that is incorrect.`,
  drone_flag_mismatch: (v, c) =>
    `Review isDrone on the VBS4 entry (currently ${
      v?.isDrone === null ? "unset" : v?.isDrone ? "true" : "false"
    }) and assetCategory on the canonical asset (currently "${
      c?.assetCategory
    }"). Set isDrone: true only for UAV/UAS platforms.`,
};
