import React, { useState, useCallback } from "react";
import { useAssetData } from "./useAssetData.js";
import { InventoryView } from "./InventoryView.js";
import { CategoryBrowserView } from "./CategoryBrowserView.js";
import { Vbs4CatalogueView } from "./Vbs4CatalogueView.js";
import { SimworksCatalogueView } from "./SimworksCatalogueView.js";
import { SwordCatalogueView } from "./SwordCatalogueView.js";
import { DisReferenceView } from "./DisReferenceView.js";
import { SidcReferenceView } from "./SidcReferenceView.js";
import { MismatchReportView } from "./MismatchReportView.js";
import { AssetDetailView } from "./AssetDetailView.js";
import { NAV_ICONS } from "./icons.js";
import type { ActiveView, MismatchCategory, NavTarget } from "./types.js";
import "../shared/styling/index.css";
import "./assetManager.css";

type NavView = Exclude<ActiveView, "assetDetail">;

export const AssetManagerWidget: React.FC = () => {
  const data = useAssetData();
  const [activeView, setActiveView] = useState<NavView>("inventory");
  const [disInitialQuery, setDisInitialQuery] = useState<string | undefined>(
    undefined
  );
  const [sidcInitialQuery, setSidcInitialQuery] = useState<string | undefined>(
    undefined
  );
  // Tracks which mismatch category to pre-expand when navigating to the mismatch report
  const [mismatchCategory, setMismatchCategory] = useState<
    MismatchCategory | undefined
  >(undefined);

  // Overlay state — null means closed
  const [overlayKey, setOverlayKey] = useState<string | null>(null);
  const [overlayType, setOverlayType] = useState<"canonical" | "vbs4">(
    "canonical"
  );

  const openOverlay = useCallback((key: string, type: "canonical" | "vbs4") => {
    setOverlayKey(key);
    setOverlayType(type);
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlayKey(null);
  }, []);

  // Jump into the DIS Reference view pre-filtered to a specific code.
  const openDisReference = useCallback((code: string) => {
    setDisInitialQuery(code);
    setActiveView("disReference");
  }, []);

  // Jump into the SIDC Reference view pre-loaded with a specific code.
  // Called from Sword catalogue rows when a SIDC badge is clicked.
  const openSidcReference = useCallback((sidc: string) => {
    setSidcInitialQuery(sidc);
    setActiveView("sidcReference");
  }, []);
  void openSidcReference; // referenced via SIDC badge clicks in catalogue rows

  // Navigate with an optional mismatch category to pre-expand
  const handleNavigate = useCallback((target: NavTarget) => {
    setMismatchCategory(target.mismatchCategory);
    setActiveView(target.view as NavView);
  }, []);

  const errorCount = [
    data.errorCanonical,
    data.errorVbs4,
    data.errorUnitTypes,
    data.errorEquipmentTypes,
  ].filter(Boolean).length;

  const errorBadge = data.mismatches.filter(
    (m) => m.severity === "error"
  ).length;

  return (
    <div className="am-root">
      {/* ── Top bar ── */}
      <div className="am-toolbar">
        <span className="am-toolbar-title">NATO CAX · Asset Manager</span>
        {data.isLoading && (
          <>
            <div className="am-spinner" />
            <span className="am-toolbar-subtitle">Syncing ontology…</span>
          </>
        )}
        {!data.isLoading && (
          <span className="am-toolbar-subtitle">
            Last sync{" "}
            {new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
        {errorCount > 0 && (
          <span
            style={{
              fontSize: 10,
              color: "#f2726b",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {errorCount} load error{errorCount > 1 ? "s" : ""}
          </span>
        )}
        <button className="am-btn" onClick={data.refresh}>
          Refresh
        </button>
      </div>

      <div className="am-app">
        {/* ── Left sidebar nav ── */}
        <nav className="am-nav">
          <div className="am-nav-header">
            <div className="am-nav-brand">NATO CAX</div>
            <div className="am-nav-title">Asset Manager</div>
          </div>

          <div className="am-nav-section">
            <div className="am-nav-section-label">Overview</div>
            <button
              className={`am-nav-item${
                activeView === "inventory" ? " active" : ""
              }`}
              onClick={() => setActiveView("inventory")}
            >
              <span className="am-nav-item-icon">{NAV_ICONS.inventory}</span>
              Inventory
            </button>
            <button
              className={`am-nav-item${
                activeView === "categoryBrowser" ? " active" : ""
              }`}
              onClick={() => setActiveView("categoryBrowser")}
            >
              <span className="am-nav-item-icon">
                {NAV_ICONS.categoryBrowser}
              </span>
              Category browser
            </button>
          </div>

          <div className="am-nav-section">
            <div className="am-nav-section-label">Simulators</div>
            <button
              className={`am-nav-item${activeView === "vbs4" ? " active" : ""}`}
              onClick={() => setActiveView("vbs4")}
            >
              <span className="am-nav-item-icon">{NAV_ICONS.vbs4}</span>VBS4
              {data.counts.totalVbs4 > 0 && (
                <span className="am-nav-badge">{data.counts.totalVbs4}</span>
              )}
            </button>
            <button
              className={`am-nav-item${
                activeView === "sword" ? " active" : ""
              }`}
              onClick={() => setActiveView("sword")}
            >
              <span className="am-nav-item-icon">{NAV_ICONS.sword}</span>MASA
              Sword
              {data.counts.totalSword > 0 && (
                <span className="am-nav-badge">{data.counts.totalSword}</span>
              )}
            </button>
            <button
              className={`am-nav-item${
                activeView === "simworks" ? " active" : ""
              }`}
              onClick={() => setActiveView("simworks")}
            >
              <span className="am-nav-item-icon">{NAV_ICONS.simworks}</span>
              Simworks
              {data.counts.totalSimworks > 0 && (
                <span className="am-nav-badge">
                  {data.counts.totalSimworks}
                </span>
              )}
            </button>
          </div>

          <div className="am-nav-section">
            <div className="am-nav-section-label">Reference</div>
            <button
              className={`am-nav-item${
                activeView === "disReference" ? " active" : ""
              }`}
              onClick={() => {
                setDisInitialQuery(undefined);
                setActiveView("disReference");
              }}
            >
              <span className="am-nav-item-icon">{NAV_ICONS.disReference}</span>
              DIS Reference
            </button>
            <button
              className={`am-nav-item${
                activeView === "sidcReference" ? " active" : ""
              }`}
              onClick={() => {
                setSidcInitialQuery(undefined);
                setActiveView("sidcReference");
              }}
            >
              <span className="am-nav-item-icon">
                {NAV_ICONS.sidcReference}
              </span>
              SIDC Reference
            </button>
          </div>

          <div className="am-nav-section">
            <div className="am-nav-section-label">Quality</div>
            <button
              className={`am-nav-item${
                activeView === "mismatches" ? " active" : ""
              }`}
              onClick={() => {
                setMismatchCategory(undefined);
                setActiveView("mismatches");
              }}
            >
              <span className="am-nav-item-icon">{NAV_ICONS.mismatches}</span>
              Mismatch report
              {errorBadge > 0 && (
                <span className="am-nav-badge error">{errorBadge}</span>
              )}
            </button>
          </div>

          <div className="am-nav-footer">
            <div
              style={{
                fontSize: 10,
                color: "var(--am-text-dim)",
                lineHeight: 1.5,
              }}
            >
              {data.counts.totalCanonical} canonical
              <br />
              {data.counts.totalVbs4} VBS4 · {data.counts.totalSword} Sword ·{" "}
              {data.counts.totalSimworks} Simworks
            </div>
          </div>
        </nav>

        {/* ── Main content (position:relative for overlay) ── */}
        <main className="am-main">
          {activeView === "inventory" && (
            <InventoryView
              counts={data.counts}
              isLoading={data.isLoading}
              onNavigate={handleNavigate}
            />
          )}
          {activeView === "categoryBrowser" && (
            <CategoryBrowserView
              canonical={data.canonical}
              vbs4={data.vbs4}
              onSelectAsset={(key) => openOverlay(key, "canonical")}
            />
          )}
          {activeView === "vbs4" && (
            <Vbs4CatalogueView
              vbs4={data.vbs4}
              canonical={data.canonical}
              isLoading={data.isLoading}
              onSelectAsset={(key) => openOverlay(key, "vbs4")}
              onOpenDisReference={openDisReference}
            />
          )}
          {activeView === "sword" && (
            <SwordCatalogueView
              sword={data.sword}
              isLoading={data.loadingSword}
              onOpenDisReference={openDisReference}
            />
          )}
          {activeView === "simworks" && (
            <SimworksCatalogueView
              simworks={data.simworks}
              isLoading={data.loadingSimworks}
              onOpenDisReference={openDisReference}
            />
          )}
          {activeView === "disReference" && (
            <DisReferenceView
              vbs4={data.vbs4}
              simworks={data.simworks}
              sword={data.sword}
              initialQuery={disInitialQuery}
            />
          )}
          {activeView === "sidcReference" && (
            <SidcReferenceView
              sword={data.sword}
              initialQuery={sidcInitialQuery}
            />
          )}
          {activeView === "mismatches" && (
            <MismatchReportView
              mismatches={data.mismatches}
              canonical={data.canonical}
              vbs4={data.vbs4}
              units={data.units}
              isLoading={data.isLoading}
              initialCategory={mismatchCategory}
            />
          )}

          {/* Asset detail overlay */}
          {overlayKey !== null && (
            <AssetDetailView
              selectedKey={overlayKey}
              selectedType={overlayType}
              canonical={data.canonical}
              vbs4={data.vbs4}
              onClose={closeOverlay}
            />
          )}
        </main>
      </div>
    </div>
  );
};
