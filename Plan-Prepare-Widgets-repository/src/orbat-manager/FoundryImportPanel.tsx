// ============================================================
//  Foundry Import Panel
//
//  Tab 1 — NXG Operations : import full force-structure as a Side
//  Tab 2 — Asset Catalogue : browse VBS4 assets (enriched with
//           their linked Canonical Asset) and import as unit templates
// ============================================================

import React, { useCallback, useMemo, useState } from "react";
import {
  useOsdkData,
  assetEntryToTemplate,
  type AssetEntry,
} from "./useOsdkData.js";
import type { Side, UnitTemplate, UnitIconType } from "./types.js";
import { MilButton } from "../shared/components/Button.js";
import { NatoSymbol } from "./NatoSymbol.js";

interface Props {
  onImportSide: (side: Side) => Promise<void>;
  /**
   * Fires immediately after a successful operation import.  The parent uses
   * this to expose the operation's primary key back out to Workshop so the
   * workshop-side helper can build a validation payload for CSE.
   */
  onOperationSelected?: (operationKey: string) => void;
  onImportTemplate: (t: Omit<UnitTemplate, "id">) => Promise<void>;
}

type Tab = "operations" | "assets";

export const FoundryImportPanel: React.FC<Props> = ({
  onImportSide,
  onOperationSelected,
  onImportTemplate,
}) => {
  const osdkData = useOsdkData();
  const [tab, setTab] = useState<Tab>("operations");

  // ── Operation import state ──────────────────────────────────────────────
  const [importingId, setImportingId] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  // ── Asset template import state (keyed by identifier) ──────────────────
  const [tmplBusy, setTmplBusy] = useState<Set<string>>(new Set());
  const [tmplDone, setTmplDone] = useState<Set<string>>(new Set());

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "drone" | "vehicle">(
    "all"
  );

  // ── Derived asset list ────────────────────────────────────────────────────
  const filteredAssets = useMemo<AssetEntry[]>(() => {
    const q = search.toLowerCase();
    return osdkData.assetEntries.filter((a) => {
      if (q) {
        const haystack = [
          a.canonicalName,
          a.identifier,
          a.assetCategory,
          a.classType,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (domainFilter !== "all") {
        const dom = (a.militaryDomain || a.domain).toLowerCase();
        if (dom !== domainFilter) return false;
      }
      if (typeFilter === "drone" && !a.isDrone) return false;
      if (typeFilter === "vehicle" && a.isDrone) return false;
      return true;
    });
  }, [osdkData.assetEntries, search, domainFilter, typeFilter]);

  const uniqueDomains = useMemo(() => {
    const s = new Set<string>();
    osdkData.assetEntries.forEach((a) => {
      const d = (a.militaryDomain || a.domain).toLowerCase();
      if (d) s.add(d);
    });
    return Array.from(s).sort();
  }, [osdkData.assetEntries]);

  // ── Snapshot counts ───────────────────────────────────────────────────────
  const snapshotCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of osdkData.snapshots) {
      const k = s.operationKey || "";
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [osdkData.snapshots]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleImportOp = useCallback(
    async (opKey: string, opName: string) => {
      setImportingId(opKey);
      setErrorId(null);
      try {
        await osdkData.importOperation(opKey, opName, onImportSide);
        // Notify parent (and by extension Workshop) which operation is now
        // active — used to trigger the workshop-side helper that builds the
        // CSE validation payload.
        onOperationSelected?.(opKey);
        setSuccessId(opKey);
        setTimeout(() => setSuccessId(null), 2500);
      } catch (e) {
        console.error(e);
        setErrorId(opKey);
      } finally {
        setImportingId(null);
      }
    },
    [osdkData, onImportSide, onOperationSelected]
  );

  const handleImportAsset = useCallback(
    async (id: string) => {
      const entry = osdkData.assetEntries.find((a) => a.identifier === id);
      if (!entry) return;
      setTmplBusy((prev) => new Set(prev).add(id));
      try {
        await onImportTemplate(assetEntryToTemplate(entry));
        setTmplDone((prev) => new Set(prev).add(id));
      } finally {
        setTmplBusy((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      }
    },
    [osdkData.assetEntries, onImportTemplate]
  );

  const handleImportAllVisible = useCallback(async () => {
    for (const a of filteredAssets) {
      if (!tmplDone.has(a.identifier)) {
        await handleImportAsset(a.identifier);
      }
    }
  }, [filteredAssets, tmplDone, handleImportAsset]);

  const anyLoading =
    osdkData.loadingOperations ||
    osdkData.loadingSnapshots ||
    osdkData.loadingAssets;

  return (
    <div className="orbat-panel">
      {/* ── Header ── */}
      <div className="orbat-panel__header">
        <span className="orbat-panel__title">Foundry Data</span>
        <MilButton
          variant="ghost"
          icon="refresh"
          iconOnly
          onClick={osdkData.refresh}
          title="Reload"
          disabled={anyLoading}
        />
      </div>

      {/* ── Summary bar ── */}
      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "6px 10px",
          background: "var(--mil-surface)",
          borderBottom: "1px solid var(--mil-border)",
          fontSize: 10,
          color: "var(--mil-text-2)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          <span>Operations:</span>
          {osdkData.loadingOperations ? (
            <span style={{ color: "var(--mil-cyan-lt)" }}>…</span>
          ) : (
            <span style={{ color: "var(--mil-cyan-lt)", fontWeight: 700 }}>
              {osdkData.operations.length}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <span>Assets:</span>
          {osdkData.loadingAssets ? (
            <span style={{ color: "var(--mil-cyan-lt)" }}>…</span>
          ) : (
            <span style={{ color: "var(--mil-cyan-lt)", fontWeight: 700 }}>
              {osdkData.assetEntries.length}
            </span>
          )}
        </div>
      </div>

      {/* ── Error banners ── */}
      {[osdkData.errorOperations, osdkData.errorSnapshots, osdkData.errorAssets]
        .filter(Boolean)
        .map((err, i) => (
          <div
            key={i}
            style={{
              margin: "4px 8px 0",
              padding: "5px 10px",
              background: "rgba(231,76,60,0.15)",
              border: "1px solid rgba(231,76,60,0.4)",
              borderRadius: 2,
              fontSize: 10,
              color: "#ef4d4d",
            }}
          >
            {err}
          </div>
        ))}

      {/* ── Tabs ── */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--mil-border)",
          background: "var(--mil-bg-2)",
          flexShrink: 0,
        }}
      >
        {[
          {
            id: "operations" as Tab,
            label: "NXG Operations",
            count: osdkData.operations.length,
          },
          {
            id: "assets" as Tab,
            label: "Asset Catalogue",
            count: osdkData.assetEntries.length,
          },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setSearch("");
              setDomainFilter("all");
            }}
            style={{
              flex: 1,
              padding: "9px 8px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: tab === t.id ? "var(--mil-text)" : "var(--mil-muted)",
              borderBottom:
                tab === t.id
                  ? "2px solid var(--mil-olive)"
                  : "2px solid transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {t.label}
            {t.count > 0 && (
              <span
                style={{
                  fontSize: 9,
                  padding: "0 5px",
                  borderRadius: 8,
                  background:
                    tab === t.id
                      ? "var(--mil-olive-mut)"
                      : "var(--mil-surface)",
                  color: tab === t.id ? "#4ade80" : "var(--mil-muted)",
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══ OPERATIONS TAB ══ */}
      {tab === "operations" && (
        <div className="orbat-panel__content">
          <div
            style={{
              padding: "8px 10px",
              marginBottom: 8,
              background: "var(--mil-surface)",
              border: "1px solid var(--mil-border-lt)",
              borderLeft: "3px solid var(--mil-olive)",
              borderRadius: 2,
              fontSize: 11,
              color: "var(--mil-text-2)",
              lineHeight: 1.5,
            }}
          >
            Each{" "}
            <strong style={{ color: "var(--mil-text)" }}>NXG Operation</strong>{" "}
            contains a force-structure snapshot. Importing builds a fully nested
            unit tree inside a new Side.
          </div>

          {osdkData.loadingOperations ? (
            <div className="mil-empty">
              <div style={{ color: "var(--mil-cyan-lt)", fontSize: 12 }}>
                Loading…
              </div>
            </div>
          ) : osdkData.operations.length === 0 ? (
            <div className="mil-empty">
              <div className="mil-empty__text">No NXG operations found</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {osdkData.operations.map((op) => {
                const isImporting = importingId === op.primaryKey;
                const isSuccess = successId === op.primaryKey;
                const isError = errorId === op.primaryKey;
                const snapCount = snapshotCounts.get(op.primaryKey) ?? 0;
                const displayName = op.terrainName || op.primaryKey;
                return (
                  <div
                    key={op.primaryKey}
                    style={{
                      background: "var(--mil-bg-3)",
                      borderRadius: 2,
                      padding: "10px 12px",
                      border: `1px solid ${
                        isSuccess
                          ? "var(--mil-olive)"
                          : isError
                          ? "#ef4d4d44"
                          : "var(--mil-border)"
                      }`,
                      borderLeft: `3px solid ${
                        isSuccess
                          ? "var(--mil-olive)"
                          : isError
                          ? "#ef4d4d"
                          : "var(--mil-cyan)"
                      }`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                      }}
                    >
                      <NatoSymbol
                        standardIdentity="friend"
                        echelon="division"
                        icon="headquarters"
                        size={26}
                        style={{ flexShrink: 0, marginTop: 2 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "var(--mil-text)",
                            marginBottom: 2,
                          }}
                        >
                          {displayName}
                        </div>
                        <div
                          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                        >
                          {op.startTime && (
                            <span
                              style={{
                                fontSize: 9,
                                color: "var(--mil-text-2)",
                              }}
                            >
                              Start:{" "}
                              {new Date(op.startTime).toLocaleDateString()}
                            </span>
                          )}
                          {snapCount > 0 && (
                            <span
                              style={{
                                fontSize: 9,
                                color: "var(--mil-cyan-lt)",
                              }}
                            >
                              {snapCount} snapshot{snapCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      <MilButton
                        variant={isSuccess ? "primary" : "default"}
                        icon={isSuccess ? "tick" : isError ? "cross" : "import"}
                        onClick={() =>
                          void handleImportOp(op.primaryKey, displayName)
                        }
                        disabled={isImporting || anyLoading}
                      >
                        {isImporting
                          ? "Loading…"
                          : isSuccess
                          ? "Imported"
                          : isError
                          ? "Error"
                          : "Import"}
                      </MilButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ ASSET CATALOGUE TAB ══ */}
      {tab === "assets" && (
        <>
          {/* Filter bar */}
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "6px 8px",
              borderBottom: "1px solid var(--mil-border)",
              flexShrink: 0,
              flexWrap: "wrap",
            }}
          >
            <input
              className="mel-input"
              placeholder="Search by name, class, category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 120, fontSize: 11 }}
            />
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              style={{
                background: "var(--mil-bg-2)",
                border: "1px solid var(--mil-border-lt)",
                borderRadius: 2,
                color: "var(--mil-text)",
                fontSize: 10,
                padding: "4px 6px",
              }}
            >
              <option value="all">All domains</option>
              {uniqueDomains.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) =>
                setTypeFilter(e.target.value as typeof typeFilter)
              }
              style={{
                background: "var(--mil-bg-2)",
                border: "1px solid var(--mil-border-lt)",
                borderRadius: 2,
                color: "var(--mil-text)",
                fontSize: 10,
                padding: "4px 6px",
              }}
            >
              <option value="all">All types</option>
              <option value="vehicle">Crewed vehicles</option>
              <option value="drone">Drones / RPAS</option>
            </select>
          </div>

          <div className="orbat-panel__content">
            {/* Info + bulk action */}
            <div
              style={{
                padding: "8px 10px",
                marginBottom: 8,
                background: "var(--mil-surface)",
                border: "1px solid var(--mil-border-lt)",
                borderLeft: "3px solid var(--mil-cyan)",
                borderRadius: 2,
                fontSize: 11,
                color: "var(--mil-text-2)",
                lineHeight: 1.5,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{ flex: 1 }}>
                Import any{" "}
                <strong style={{ color: "var(--mil-text)" }}>VBS4 asset</strong>{" "}
                as a unit template. Crew count, NATO icon, echelon and tags are
                derived automatically from the asset and its linked{" "}
                <em>Canonical Asset</em> record. Templates appear in the{" "}
                <strong style={{ color: "var(--mil-text)" }}>Templates</strong>{" "}
                panel.
              </span>
              {filteredAssets.length > 0 && (
                <MilButton
                  variant="default"
                  icon="import"
                  onClick={() => void handleImportAllVisible()}
                  disabled={tmplBusy.size > 0}
                >
                  Import all {filteredAssets.length}
                </MilButton>
              )}
            </div>

            {osdkData.loadingAssets ? (
              <div className="mil-empty">
                <div style={{ color: "var(--mil-cyan-lt)", fontSize: 12 }}>
                  Loading asset catalogue…
                </div>
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="mil-empty">
                <div className="mil-empty__text">
                  No assets match the current filters
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {filteredAssets.slice(0, 300).map((asset) => (
                  <AssetRow
                    key={asset.identifier}
                    asset={asset}
                    isBusy={tmplBusy.has(asset.identifier)}
                    isDone={tmplDone.has(asset.identifier)}
                    onImport={() => void handleImportAsset(asset.identifier)}
                  />
                ))}
                {filteredAssets.length > 300 && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--mil-muted)",
                      textAlign: "center",
                      padding: "6px 0",
                    }}
                  >
                    Showing 300 of {filteredAssets.length} — refine the search
                    to see more
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Asset row ────────────────────────────────────────────────────────────────

interface AssetRowProps {
  asset: AssetEntry;
  isBusy: boolean;
  isDone: boolean;
  onImport: () => void;
}

const AssetRow: React.FC<AssetRowProps> = ({
  asset,
  isBusy,
  isDone,
  onImport,
}) => {
  // Primary display name: canonical name if available, otherwise VBS4 identifier
  const displayName = asset.canonicalName || asset.identifier;
  // Secondary: VBS4 identifier (only if different from display name)
  const vbs4Label =
    asset.canonicalName && asset.canonicalName !== asset.identifier
      ? asset.identifier
      : null;

  const subtitleParts = [
    asset.assetCategory,
    asset.militaryDomain || asset.domain,
    asset.nationality,
    asset.classType && asset.classType !== asset.assetCategory
      ? asset.classType
      : null,
  ].filter(Boolean);

  return (
    <div
      style={{
        background: "var(--mil-bg-3)",
        borderRadius: 2,
        padding: "7px 10px",
        border: `1px solid ${
          isDone ? "rgba(36, 180, 126,0.4)" : "var(--mil-border)"
        }`,
        borderLeft: `3px solid ${isDone ? "#4ade80" : "var(--mil-border-lt)"}`,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {/* NATO symbol preview */}
      <NatoSymbol
        standardIdentity="friend"
        echelon={asset.templateEchelon}
        icon={asset.templateIcon as UnitIconType}
        size={28}
        style={{ flexShrink: 0 }}
      />

      {/* Info block */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--mil-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayName}
        </div>
        <div
          style={{
            display: "flex",
            gap: 5,
            flexWrap: "wrap",
            marginTop: 2,
            alignItems: "center",
          }}
        >
          {subtitleParts.length > 0 && (
            <span style={{ fontSize: 9, color: "var(--mil-text-2)" }}>
              {subtitleParts.join(" · ")}
            </span>
          )}
          <span style={{ fontSize: 9, color: "var(--mil-cyan-lt)" }}>
            {asset.templateEchelon} · {asset.templateCrew} crew
          </span>
          {asset.isDrone && (
            <span
              style={{
                fontSize: 9,
                padding: "0 4px",
                borderRadius: 2,
                background: "rgba(192,132,252,0.2)",
                color: "#c084fc",
              }}
            >
              DRONE
            </span>
          )}
          {vbs4Label && (
            <span
              style={{
                fontSize: 8,
                color: "var(--mil-muted)",
                fontFamily: "monospace",
              }}
            >
              {vbs4Label}
            </span>
          )}
        </div>
      </div>

      {/* Import button */}
      <MilButton
        variant={isDone ? "primary" : "default"}
        icon={isDone ? "tick" : "import"}
        onClick={onImport}
        disabled={isBusy || isDone}
      >
        {isBusy ? "…" : isDone ? "Added" : "Import"}
      </MilButton>
    </div>
  );
};
