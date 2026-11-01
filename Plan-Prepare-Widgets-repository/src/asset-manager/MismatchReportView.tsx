import React, { useMemo, useState, useEffect } from "react";
import type {
  MismatchRecord,
  MismatchSeverity,
  MismatchCategory,
  CanonicalAsset,
  Vbs4Asset,
  UnitRef,
} from "./types.js";
import { MismatchDetailOverlay } from "./MismatchDetailOverlay.js";
import { MISMATCH_EMOJI } from "./icons.js";
import { OrbatAuditTab } from "./OrbatAuditTab.js";
import { UnitAuditPanel } from "./UnitAuditPanel.js";

interface Props {
  mismatches: MismatchRecord[];
  canonical: CanonicalAsset[];
  vbs4: Vbs4Asset[];
  units: UnitRef[];
  isLoading: boolean;
  /** If provided, auto-expand this category when the view mounts */
  initialCategory?: MismatchCategory;
}

// ─── Category metadata ────────────────────────────────────────────────────────

interface CatMeta {
  label: string;
  description: string;
  icon: string;
  severity: MismatchSeverity;
}

const CAT_META: Record<MismatchCategory, CatMeta> = {
  // ── Simulator ↔ canonical mapping ─────────────────────────────────────
  orphan_vbs4: {
    label: "VBS4 · broken canonical link",
    description:
      "VBS4 entry has no dis6Code (or the older canonicalAssetKey), or the key points to a canonical asset that doesn't exist. The ontology link from VBS4 → NxgCanonicalAsset uses dis6Code and cannot resolve.",
    icon: MISMATCH_EMOJI.orphan_vbs4,
    severity: "error",
  },
  orphan_simworks: {
    label: "Simworks · broken canonical link",
    description:
      "Simworks entry has no dis6Code, or dis6Code points to a canonical asset that doesn't exist. The Simworks → NxgCanonicalAsset link cannot resolve.",
    icon: MISMATCH_EMOJI.orphan_simworks,
    severity: "error",
  },
  orphan_sword: {
    label: "Sword · broken canonical link",
    description:
      "Sword entry has no dis6Code, or dis6Code points to a canonical asset that doesn't exist. The Sword → NxgCanonicalAsset link cannot resolve.",
    icon: MISMATCH_EMOJI.orphan_sword,
    severity: "error",
  },
  unmapped_canonical: {
    label: "No simulator model at all",
    description:
      "Canonical asset exists in the doctrine catalogue but no VBS4, Simworks or Sword entry references it — the platform cannot be spawned in any simulator.",
    icon: MISMATCH_EMOJI.unmapped_canonical,
    severity: "error",
  },
  single_simulator_only: {
    label: "Only one simulator covers this asset",
    description:
      "Canonical asset is modelled in only 1 of the 3 simulators (VBS4 / Simworks / Sword). Federated exercises using the other simulators cannot spawn an equivalent entity.",
    icon: MISMATCH_EMOJI.single_simulator_only,
    severity: "info",
  },
  // ── Cross-simulator agreement ──────────────────────────────────────────
  cross_sim_disagreement: {
    label: "Simulators disagree",
    description:
      "The same canonical asset is modelled in multiple simulators but they disagree on the DIS code, domain, or nationality. All simulators must broadcast the same DIS entity type on the federation.",
    icon: MISMATCH_EMOJI.cross_sim_disagreement,
    severity: "warning",
  },
  // ── Simulator internal quality ─────────────────────────────────────────
  domain_mismatch: {
    label: "Domain mismatch",
    description:
      "A simulator entry's military domain disagrees with its linked canonical asset's militaryDomain. One record is incorrect.",
    icon: MISMATCH_EMOJI.domain_mismatch,
    severity: "warning",
  },
  nationality_mismatch: {
    label: "Nationality mismatch",
    description:
      "A simulator entry's nationality doesn't match the nationality of its linked canonical asset.",
    icon: MISMATCH_EMOJI.nationality_mismatch,
    severity: "warning",
  },
  missing_crew_config: {
    label: "VBS4 · missing crew configuration",
    description:
      "VBS4 entry has no commander flag, zero gunner seats and zero cargo seats — crew cannot be assigned to this entity.",
    icon: MISMATCH_EMOJI.missing_crew_config,
    severity: "warning",
  },
  missing_dis_code: {
    label: "Missing DIS code",
    description:
      "A simulator entry has no disCode. The DIS federation cannot identify this entity type on the network.",
    icon: MISMATCH_EMOJI.missing_dis_code,
    severity: "warning",
  },
  missing_dis6: {
    label: "Missing DIS 6 code (breaks canonical link)",
    description:
      "A simulator entry has no dis6Code. The ontology link from that entry to NxgCanonicalAsset (via dis6Code = canonical.primaryKey) will not resolve.",
    icon: MISMATCH_EMOJI.missing_dis6,
    severity: "warning",
  },
  duplicate_sim_class: {
    label: "Duplicate simulation classes",
    description:
      "Multiple entries within the same simulator share the same simulationClass — they may represent the same platform.",
    icon: MISMATCH_EMOJI.duplicate_sim_class,
    severity: "warning",
  },
  branch_inconsistency: {
    label: "Branch / domain inconsistency",
    description:
      "The canonical asset's service branch conflicts with the VBS4 entry's domain or classType (e.g. ARMY branch with Naval Vessel classType).",
    icon: MISMATCH_EMOJI.branch_inconsistency,
    severity: "warning",
  },
  drone_flag_mismatch: {
    label: "VBS4 · drone flag mismatch",
    description:
      "VBS4 entry isDrone flag disagrees with the canonical asset's assetCategory (e.g. isDrone: true but category is 'vehicle').",
    icon: MISMATCH_EMOJI.drone_flag_mismatch,
    severity: "warning",
  },
  // ── Unit ↔ simulator wiring ────────────────────────────────────────────
  dead_unit_reference: {
    label: "Unit · dead simulator reference",
    description:
      "A unit's simulatorIdentifierCode points to an identifier that doesn't exist in ANY simulator catalogue (VBS4, Simworks or Sword).",
    icon: MISMATCH_EMOJI.dead_unit_reference,
    severity: "error",
  },
  unit_missing_sim_code: {
    label: "Unit · missing simulator code",
    description:
      "A unit is assigned to an owningSimulator but has no simulatorIdentifierCode — it cannot be spawned.",
    icon: MISMATCH_EMOJI.unit_missing_sim_code,
    severity: "warning",
  },
  unit_sim_owner_mismatch: {
    label: "Unit · owner ≠ sim source",
    description:
      "A unit's owningSimulator disagrees with which simulator catalogue actually contains its simulatorIdentifierCode.",
    icon: MISMATCH_EMOJI.unit_sim_owner_mismatch,
    severity: "warning",
  },
  unit_broken_canonical: {
    label: "Unit · broken canonical FK",
    description:
      "Unit dis6Code (the FK to NxgCanonicalAsset) points to a canonical asset that doesn't exist.",
    icon: MISMATCH_EMOJI.unit_broken_canonical,
    severity: "error",
  },
  // ── Catalogue usage ────────────────────────────────────────────────────
  unused_vbs4: {
    label: "VBS4 · unused",
    description:
      "VBS4 entries available in the catalogue but not referenced by any NxgUnit via simulatorIdentifierCode.",
    icon: MISMATCH_EMOJI.unused_vbs4,
    severity: "info",
  },
  unused_simworks: {
    label: "Simworks · unused",
    description:
      "Simworks entries available in the catalogue but not referenced by any NxgUnit via simulatorIdentifierCode.",
    icon: MISMATCH_EMOJI.unused_simworks,
    severity: "info",
  },
  unused_sword: {
    label: "Sword · unused",
    description:
      "Sword entries available in the catalogue but not referenced by any NxgUnit via simulatorIdentifierCode.",
    icon: MISMATCH_EMOJI.unused_sword,
    severity: "info",
  },
};

const SEV_ORDER: MismatchSeverity[] = ["error", "warning", "info"];
type SevFilter = "all" | MismatchSeverity;
type MismatchTab = "issues" | "ai-audit";

// ─── Per-record row with expandable inline AI audit ───────────────────────────

interface RecordRowProps {
  record: MismatchRecord;
  severity: MismatchSeverity;
  onDetails: () => void;
}

const MismatchRecordRow: React.FC<RecordRowProps> = ({
  record,
  severity,
  onDetails,
}) => {
  const [auditOpen, setAuditOpen] = useState(false);

  return (
    <div className="am-mm-record-wrap">
      {/* ── Main row ── */}
      <div className="am-mm-record-row">
        <span className={`am-mm-record-dot am-mm-record-dot--${severity}`} />
        <div className="am-mm-record-body">
          <div className="am-mm-record-key">{record.affectedKey}</div>
          <div className="am-mm-record-detail">{record.detail}</div>
        </div>
        {/* Details button */}
        <button
          className="am-mm-record-action am-mm-record-action--detail"
          onClick={onDetails}
          title="View full details"
        >
          Details ›
        </button>
        {/* AI Audit toggle button */}
        <button
          className={`am-mm-record-action am-mm-record-action--audit${
            auditOpen ? " active" : ""
          }`}
          onClick={() => setAuditOpen((o) => !o)}
          title="Run AI audit for this entity"
        >
          ◈ AI Audit
        </button>
      </div>

      {/* ── Inline AI audit — expands below the row ── */}
      {auditOpen && (
        <div className="am-mm-record-audit">
          <UnitAuditPanel
            unitIdentifier={record.auditId}
            unitLabel={record.affectedKey}
          />
        </div>
      )}
    </div>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────

export const MismatchReportView: React.FC<Props> = ({
  mismatches,
  canonical,
  vbs4,
  units,
  isLoading,
  initialCategory,
}) => {
  const [activeTab, setActiveTab] = useState<MismatchTab>("issues");
  const [sevFilter, setSevFilter] = useState<SevFilter>("all");
  const [expandedCat, setExpandedCat] = useState<MismatchCategory | null>(
    initialCategory ?? null
  );
  const [selectedRecord, setSelectedRecord] = useState<MismatchRecord | null>(
    null
  );

  // When navigated to with a specific category, open it and scroll it into view
  useEffect(() => {
    if (initialCategory) {
      setActiveTab("issues");
      setSevFilter("all");
      setExpandedCat(initialCategory);
    }
  }, [initialCategory]);

  const errorCount = mismatches.filter((m) => m.severity === "error").length;
  const warningCount = mismatches.filter(
    (m) => m.severity === "warning"
  ).length;
  const infoCount = mismatches.filter((m) => m.severity === "info").length;

  const grouped = useMemo(() => {
    const map = new Map<MismatchCategory, MismatchRecord[]>();
    for (const m of mismatches) {
      if (sevFilter !== "all" && m.severity !== sevFilter) continue;
      if (!map.has(m.category)) map.set(m.category, []);
      map.get(m.category)!.push(m);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const sA = SEV_ORDER.indexOf(CAT_META[a[0]].severity);
      const sB = SEV_ORDER.indexOf(CAT_META[b[0]].severity);
      return sA !== sB ? sA - sB : a[0].localeCompare(b[0]);
    });
  }, [mismatches, sevFilter]);

  if (isLoading) {
    return (
      <div className="am-view">
        <div className="am-content-header">
          <span className="am-content-header-icon">!</span>
          <span className="am-content-header-title">Mismatch report</span>
        </div>
        <div className="am-state-center">
          <div className="am-spinner" />
          <div className="am-state-sub">Analysing ontology…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="am-view">
      {/* ── Header ── */}
      <div className="am-content-header">
        <span className="am-content-header-icon">!</span>
        <span className="am-content-header-title">Mismatch report</span>
        {mismatches.length > 0 && (
          <span
            className={`am-content-header-badge${
              errorCount > 0 ? " error" : ""
            }`}
          >
            {mismatches.length} issue{mismatches.length !== 1 ? "s" : ""}
          </span>
        )}
        <span className="am-content-header-spacer" />
        {/* Only show severity filter on the issues tab */}
        {activeTab === "issues" && (
          <div className="am-severity-toggle">
            <button
              className={`am-sev-btn${
                sevFilter === "all" ? " active-all" : ""
              }`}
              onClick={() => setSevFilter("all")}
            >
              All
            </button>
            <button
              className={`am-sev-btn${
                sevFilter === "error" ? " active-error" : ""
              }`}
              onClick={() => setSevFilter("error")}
            >
              Errors
            </button>
            <button
              className={`am-sev-btn${
                sevFilter === "warning" ? " active-warning" : ""
              }`}
              onClick={() => setSevFilter("warning")}
            >
              Warnings
            </button>
            <button
              className={`am-sev-btn${
                sevFilter === "info" ? " active-info" : ""
              }`}
              onClick={() => setSevFilter("info")}
            >
              Info
            </button>
          </div>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div className="am-mm-tab-bar">
        <button
          className={`am-mm-tab${activeTab === "issues" ? " active" : ""}`}
          onClick={() => setActiveTab("issues")}
        >
          <span className="am-mm-tab-icon">!</span>
          Issues
          {errorCount > 0 && (
            <span className="am-mm-tab-badge error">{errorCount}</span>
          )}
        </button>
        <button
          className={`am-mm-tab${activeTab === "ai-audit" ? " active" : ""}`}
          onClick={() => setActiveTab("ai-audit")}
        >
          <span className="am-mm-tab-icon">◈</span>
          AI Audit
        </button>
      </div>

      {/* ── Tab content ── */}
      {activeTab === "issues" && (
        <div className="am-mismatch-view">
          {/* ── Summary tiles ── */}
          <div className="am-mm-tiles">
            <div className="am-mm-tile error">
              <div className="am-mm-tile-value">{errorCount}</div>
              <div className="am-mm-tile-label">Errors</div>
              <div className="am-mm-tile-sub">blocking issues</div>
            </div>
            <div className="am-mm-tile warning">
              <div className="am-mm-tile-value">{warningCount}</div>
              <div className="am-mm-tile-label">Warnings</div>
              <div className="am-mm-tile-sub">data quality</div>
            </div>
            <div className="am-mm-tile info">
              <div className="am-mm-tile-value">{infoCount}</div>
              <div className="am-mm-tile-label">Info</div>
              <div className="am-mm-tile-sub">low priority</div>
            </div>
            <div className="am-mm-tile neutral">
              <div className="am-mm-tile-value">{grouped.length}</div>
              <div className="am-mm-tile-label">Categories</div>
              <div className="am-mm-tile-sub">affected</div>
            </div>
          </div>

          {/* ── Grouped issue list ── */}
          <div className="am-mismatch-list">
            {grouped.length === 0 ? (
              <div className="am-state-center">
                <div className="am-state-icon">✓</div>
                <div className="am-state-title">
                  {mismatches.length === 0
                    ? "No issues detected"
                    : "No issues in this category"}
                </div>
                <div className="am-state-sub">
                  {mismatches.length === 0
                    ? "The ontology is consistent — all canonical assets are mapped, VBS4 entries are linked, and units have valid simulator references."
                    : "Try selecting a different severity filter."}
                </div>
              </div>
            ) : (
              grouped.map(([category, records]) => {
                const meta = CAT_META[category];
                const isExpanded = expandedCat === category;
                const previewCount = 6;
                return (
                  <div
                    key={category}
                    className={`am-mm-group am-mm-group--${meta.severity}`}
                  >
                    {/* Group header — expand/collapse */}
                    <button
                      className="am-mm-group-header"
                      onClick={() =>
                        setExpandedCat(isExpanded ? null : category)
                      }
                    >
                      <span className="am-mm-group-icon">{meta.icon}</span>
                      <div className="am-mm-group-text">
                        <div className="am-mm-group-title">{meta.label}</div>
                        <div className="am-mm-group-desc">
                          {meta.description}
                        </div>
                      </div>
                      <div className="am-mm-group-right">
                        <span
                          className={`am-mm-group-count am-mm-count--${meta.severity}`}
                        >
                          {records.length}
                        </span>
                        <span className="am-mm-group-chevron">
                          {isExpanded ? "▲" : "▼"}
                        </span>
                      </div>
                    </button>

                    {/* Collapsed: preview chips (non-interactive) */}
                    {!isExpanded && (
                      <div className="am-mm-group-chips">
                        {records.slice(0, previewCount).map((r) => (
                          <span key={r.id} className="am-mm-chip">
                            {r.affectedKey}
                          </span>
                        ))}
                        {records.length > previewCount && (
                          <span className="am-mm-chip am-mm-chip--more">
                            +{records.length - previewCount} more
                          </span>
                        )}
                      </div>
                    )}

                    {/* Expanded: individual records with inline audit */}
                    {isExpanded && (
                      <div className="am-mm-group-records">
                        {records.map((r) => (
                          <MismatchRecordRow
                            key={r.id}
                            record={r}
                            severity={meta.severity}
                            onDetails={() => setSelectedRecord(r)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === "ai-audit" && <OrbatAuditTab />}

      {/* ── Mismatch detail overlay ── */}
      {selectedRecord && (
        <MismatchDetailOverlay
          record={selectedRecord}
          canonical={canonical}
          vbs4={vbs4}
          units={units}
          onClose={() => setSelectedRecord(null)}
        />
      )}
    </div>
  );
};
