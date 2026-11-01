// src/map/ScenarioPlanning/components/UnitPicker/UnitPicker.tsx
// Full asset-catalogue unit picker (ported from widgetSet UnitPicker).

import ms from "milsymbol";
import React, { useState } from "react";
import type { AssetCatalogueItem, UnitAffiliation } from "../../shared/types";
import css from "./UnitPicker.module.css";

interface UnitPickerProps {
  /** Asset catalogue to display. Pass the Ontology-sourced list; falls back to empty. */
  catalogue?: AssetCatalogueItem[];
  onConfirm: (
    sidc: string,
    identifier: string,
    affiliation: UnitAffiliation,
    echelon: string,
  ) => void;
  onCancel: () => void;
}

function symbolDataUrl(sidc: string): string {
  try {
    return `data:image/svg+xml;base64,${btoa(new ms.Symbol(sidc, { size: 28 }).asSVG())}`;
  } catch {
    return `data:image/svg+xml;base64,${btoa(new ms.Symbol("10031000000000000000", { size: 28 }).asSVG())}`;
  }
}

const NATIONS = ["All", "GBR", "DEU", "POL", "NOR", "OPP"];
const BRANCHES = ["All", "Army", "Navy", "Air Force"];

export const UnitPicker: React.FC<UnitPickerProps> = ({
  catalogue = [],
  onConfirm,
  onCancel,
}) => {
  const [filterNation, setFilterNation] = useState("All");
  const [filterBranch, setFilterBranch] = useState("All");
  const [filterSide, setFilterSide] = useState<
    "All" | "FRIENDLY" | "HOSTILE"
  >("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AssetCatalogueItem | null>(null);
  const [identifier, setIdentifier] = useState("");

  const filtered = catalogue.filter((item) => {
    if (filterNation !== "All" && item.nation !== filterNation) return false;
    if (filterBranch !== "All" && item.branch !== filterBranch) return false;
    if (filterSide !== "All" && item.affiliation !== filterSide) return false;
    if (
      search &&
      !item.name.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });

  const handleConfirm = () => {
    if (!selected) return;
    onConfirm(
      selected.sidc,
      identifier || selected.name,
      selected.affiliation,
      selected.echelon,
    );
  };

  return (
    <div className={css.overlay}>
      <div
        className={css.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Place unit"
      >
        {/* Header */}
        <div className={css.header}>
          <span className={css.title}>PLACE UNIT</span>
          <button
            className={css.closeBtn}
            onClick={onCancel}
            aria-label="Close unit picker"
          >
            ×
          </button>
        </div>

        {/* Filters */}
        <div className={css.filters}>
          <input
            className={css.search}
            placeholder="Search units..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search units"
          />
          <div className={css.filterRow}>
            <span className={css.filterLabel}>SIDE</span>
            {(["All", "FRIENDLY", "HOSTILE"] as const).map((s) => (
              <button
                key={s}
                className={`${css.filterChip} ${filterSide === s ? css.filterChipActive : ""}`}
                onClick={() => setFilterSide(s)}
              >
                {s === "All" ? "All" : s === "FRIENDLY" ? "Friendly" : "Hostile"}
              </button>
            ))}
          </div>
          <div className={css.filterRow}>
            <span className={css.filterLabel}>NATION</span>
            {NATIONS.map((n) => (
              <button
                key={n}
                className={`${css.filterChip} ${filterNation === n ? css.filterChipActive : ""}`}
                onClick={() => setFilterNation(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <div className={css.filterRow}>
            <span className={css.filterLabel}>BRANCH</span>
            {BRANCHES.map((b) => (
              <button
                key={b}
                className={`${css.filterChip} ${filterBranch === b ? css.filterChipActive : ""}`}
                onClick={() => setFilterBranch(b)}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        {/* Unit list */}
        <div className={css.list} role="listbox" aria-label="Unit catalogue">
          {filtered.map((item) => (
            <div
              key={item.id}
              role="option"
              aria-selected={selected?.id === item.id}
              tabIndex={0}
              className={`${css.listItem} ${selected?.id === item.id ? css.listItemSelected : ""}`}
              onClick={() => {
                setSelected(item);
                setIdentifier(item.name);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSelected(item);
                  setIdentifier(item.name);
                }
              }}
            >
              <img
                src={symbolDataUrl(item.sidc)}
                className={css.symbol}
                alt={item.name}
              />
              <div className={css.itemInfo}>
                <span className={css.itemName}>{item.name}</span>
                <span className={css.itemMeta}>
                  {item.nation} · {item.echelon} · {item.branch}
                </span>
              </div>
              <span
                className={css.sideBadge}
                style={{
                  color:
                    item.affiliation === "FRIENDLY" ? "#4A90D9" : "#E05252",
                }}
              >
                {item.affiliation === "FRIENDLY" ? "FRI" : "HOS"}
              </span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className={css.empty}>No units match filters</div>
          )}
        </div>

        {/* Footer — shown once a unit is selected */}
        {selected && (
          <div className={css.footer}>
            <div className={css.selectedPreview}>
              <img
                src={symbolDataUrl(selected.sidc)}
                className={css.previewSymbol}
                alt={selected.name}
              />
              <div className={css.previewInfo}>
                <span className={css.previewName}>{selected.name}</span>
                <span className={css.previewDesc}>{selected.description}</span>
              </div>
            </div>
            <div className={css.identifierRow}>
              <label
                className={css.identifierLabel}
                htmlFor="unit-identifier"
              >
                UNIT IDENTIFIER
              </label>
              <input
                id="unit-identifier"
                className={css.identifierInput}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="e.g. 1 PARA, 2 RTR…"
                maxLength={30}
                aria-label="Unit identifier"
              />
            </div>
            <div className={css.footerActions}>
              <button className={css.cancelBtn} onClick={onCancel}>
                Cancel
              </button>
              <button className={css.confirmBtn} onClick={handleConfirm}>
                Place on Map
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

