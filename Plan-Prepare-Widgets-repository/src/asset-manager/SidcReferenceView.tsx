// ============================================================
//  Asset Manager — SIDC Reference View
// ============================================================
//
//  NATO APP-6D / MIL-STD-2525C letter-based Symbol Identification
//  Code (SIDC) decoder + catalogue browser.
//
//  All symbol rendering is delegated to the `milsymbol` library
//  via the shared MilSymbol component. Symbols are drawn against
//  the APP-6 standard using the 15-character letter format.
//
//  Features:
//    - SIDC Decoder — type any letter-based SIDC (15 characters,
//      shorter inputs are padded with '-') and see every field
//      decoded (coding scheme, affiliation, dimension, status,
//      function id, echelon/mobility, etc.). Renders a live
//      symbol via milsymbol.
//    - Catalogue browser — unique SIDCs from the current MASA
//      Sword templates, filterable by affiliation and dimension.
//      Click a row to load it into the decoder.

import React, { useEffect, useMemo, useState } from "react";
import type { SwordAsset } from "./types.js";
import { MilSymbol } from "./MilSymbol.js";
import {
  decodeSidc,
  normaliseSidc,
  BATTLE_DIMENSION,
  STANDARD_IDENTITY,
  type SidcDecoded,
} from "./sidcDecode.js";

interface Props {
  sword: SwordAsset[];
  /** Optional: initial SIDC to pre-load into the decoder. */
  initialQuery?: string;
}

// ─── Example letter-based SIDCs (APP-6D / 2525C) ──────────────
const DECODER_EXAMPLES: { code: string; label: string }[] = [
  { code: "SFGPUCI---E---", label: "Friend · Infantry · Company" },
  { code: "SFGPUCA---F---", label: "Friend · Armour · Battalion" },
  { code: "SHGPUCI---E---", label: "Hostile · Infantry · Company" },
  { code: "SFGPUCF---F---", label: "Friend · Field Artillery · Battalion" },
  { code: "SFGPUCR---D---", label: "Friend · Reconnaissance · Platoon" },
  { code: "SFGPUUS---F---", label: "Friend · Signal · Battalion" },
  { code: "SNGPUCI---E---", label: "Neutral · Infantry · Company" },
  { code: "SFAPMFF-------", label: "Friend · Air · Fighter" },
];

export const SidcReferenceView: React.FC<Props> = ({ sword, initialQuery }) => {
  const [input, setInput] = useState(initialQuery ?? "");
  const [filterAffil, setFilterAffil] = useState("");
  const [filterDim, setFilterDim] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (initialQuery !== undefined) setInput(initialQuery);
  }, [initialQuery]);

  const decoded: SidcDecoded | null = useMemo(() => decodeSidc(input), [input]);

  // Build catalogue of unique SIDCs from Sword templates.
  const catalogue = useMemo(() => {
    interface Row {
      sidc: string;
      normalised: string;
      count: number;
      samples: SwordAsset[];
      decoded: SidcDecoded | null;
    }
    const byCode = new Map<string, Row>();
    for (const s of sword) {
      const raw = s.sidc?.trim();
      if (!raw) continue;
      const norm = normaliseSidc(raw);
      if (!norm) continue;
      let row = byCode.get(norm);
      if (!row) {
        row = {
          sidc: raw,
          normalised: norm,
          count: 0,
          samples: [],
          decoded: decodeSidc(norm),
        };
        byCode.set(norm, row);
      }
      row.count++;
      if (row.samples.length < 3) row.samples.push(s);
    }
    return Array.from(byCode.values()).sort((a, b) => b.count - a.count);
  }, [sword]);

  const affiliations = useMemo(() => {
    const s = new Set<string>();
    for (const r of catalogue)
      if (r.decoded) s.add(r.decoded.parts.standardIdentity);
    return Array.from(s).sort();
  }, [catalogue]);

  const dimensions = useMemo(() => {
    const s = new Set<string>();
    for (const r of catalogue)
      if (r.decoded) s.add(r.decoded.parts.battleDimension);
    return Array.from(s).sort();
  }, [catalogue]);

  const filteredCatalogue = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalogue.filter((r) => {
      if (!r.decoded)
        return q === "" ? true : r.normalised.toLowerCase().includes(q);
      if (filterAffil && r.decoded.parts.standardIdentity !== filterAffil)
        return false;
      if (filterDim && r.decoded.parts.battleDimension !== filterDim)
        return false;
      if (q) {
        const hay = [
          r.normalised,
          r.decoded.summary,
          r.samples.map((s) => s.displayName ?? s.name ?? "").join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [catalogue, filterAffil, filterDim, search]);

  const loadIntoDecoder = (code: string) => setInput(code);

  return (
    <div className="am-view">
      <div className="am-content-header">
        <span className="am-content-header-icon">▧</span>
        <span className="am-content-header-title">SIDC Reference</span>
        <span className="am-content-header-badge">APP-6D · Letter</span>
        <span className="am-content-header-spacer" />
        <span className="am-content-header-meta">
          {catalogue.length.toLocaleString()} unique SIDCs in Sword catalogue
        </span>
      </div>

      {/* ── Decoder ── */}
      <SidcDecoderCard
        input={input}
        onInputChange={setInput}
        decoded={decoded}
      />

      {/* ── Catalogue ── */}
      <div className="am-content-subheader">
        <span className="am-content-subheader-title">Catalogue browser</span>
        <span className="am-content-subheader-meta">
          SIDCs referenced by MASA Sword unit templates
        </span>
      </div>

      <div className="am-filter-bar">
        <input
          className="am-search-input"
          placeholder="Search SIDC or unit label (e.g. 'SFGP', 'Infantry')…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="am-filter-select"
          value={filterAffil}
          onChange={(e) => setFilterAffil(e.target.value)}
        >
          <option value="">Affiliation: All</option>
          {affiliations.map((s) => (
            <option key={s} value={s}>
              {s} · {STANDARD_IDENTITY[s] ?? "Unknown"}
            </option>
          ))}
        </select>
        <select
          className="am-filter-select"
          value={filterDim}
          onChange={(e) => setFilterDim(e.target.value)}
        >
          <option value="">Dimension: All</option>
          {dimensions.map((s) => (
            <option key={s} value={s}>
              {s} · {BATTLE_DIMENSION[s] ?? "Unknown"}
            </option>
          ))}
        </select>
        <span className="am-filter-count">
          {filteredCatalogue.length} of {catalogue.length}
        </span>
      </div>

      <div className="am-table-wrap">
        <table className="am-table">
          <thead>
            <tr>
              <th style={{ width: 55 }}>Symbol</th>
              <th style={{ width: 170 }}>SIDC</th>
              <th>Affiliation</th>
              <th>Dimension</th>
              <th>Echelon / Amp</th>
              <th>Sample Sword Units</th>
              <th style={{ width: 70 }}>Uses</th>
            </tr>
          </thead>
          <tbody>
            {filteredCatalogue.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--am-text-muted)",
                  }}
                >
                  {catalogue.length === 0
                    ? "No SIDCs found in the current MASA Sword catalogue."
                    : "No SIDCs match the current filters."}
                </td>
              </tr>
            ) : (
              filteredCatalogue.map((r) => (
                <tr
                  key={r.normalised}
                  onClick={() => loadIntoDecoder(r.normalised)}
                  style={{ cursor: "pointer" }}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <MilSymbol sidc={r.normalised} size={32} />
                  </td>
                  <td>
                    <code
                      style={{
                        fontFamily: "var(--am-mono)",
                        fontSize: 11,
                        color: "var(--am-text)",
                        fontWeight: 600,
                      }}
                    >
                      {r.normalised}
                    </code>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {r.decoded?.labels.standardIdentity ?? (
                      <span style={{ color: "var(--am-text-dim)" }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {r.decoded?.labels.battleDimension ?? (
                      <span style={{ color: "var(--am-text-dim)" }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {r.decoded?.labels.echelonMobility ?? (
                      <span style={{ color: "var(--am-text-dim)" }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: "var(--am-text-muted)" }}>
                    {r.samples
                      .map((s) => s.displayName ?? s.name ?? s.identifier)
                      .join(", ")}
                    {r.count > r.samples.length && (
                      <span style={{ color: "var(--am-text-dim)" }}>
                        {" "}
                        … +{r.count - r.samples.length}
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      fontFamily: "var(--am-mono)",
                      fontSize: 11,
                      textAlign: "right",
                      color: "var(--am-text)",
                    }}
                  >
                    {r.count}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ============================================================
//  Sub-component — SIDC Decoder Card
// ============================================================

interface DecoderCardProps {
  input: string;
  onInputChange: (v: string) => void;
  decoded: SidcDecoded | null;
}

const SidcDecoderCard: React.FC<DecoderCardProps> = ({
  input,
  onInputChange,
  decoded,
}) => {
  return (
    <div className="am-dis-decoder">
      <div className="am-dis-decoder-header">
        <span className="am-dis-decoder-icon">▧</span>
        <div className="am-dis-decoder-title-block">
          <div className="am-dis-decoder-title">SIDC Decoder</div>
          <div className="am-dis-decoder-sub">
            Enter any 15-character letter-based NATO APP-6D / MIL-STD-2525C
            Symbol Identification Code. Symbols are rendered via the{" "}
            <a
              href="https://github.com/spatialillusions/milsymbol"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--am-accent)" }}
            >
              milsymbol
            </a>{" "}
            library.
          </div>
        </div>
      </div>

      <div className="am-dis-decoder-input-row">
        <input
          className="am-dis-decoder-input"
          placeholder="e.g. SFGPUCI---E---"
          value={input}
          onChange={(e) => onInputChange(e.target.value.toUpperCase())}
          spellCheck={false}
          autoComplete="off"
        />
        {input && (
          <button
            className="am-btn am-dis-decoder-clear"
            onClick={() => onInputChange("")}
            title="Clear"
          >
            ✕
          </button>
        )}
      </div>

      {!input.trim() && (
        <div className="am-dis-decoder-examples">
          <span className="am-dis-decoder-examples-label">Try:</span>
          {DECODER_EXAMPLES.map((ex) => (
            <button
              key={ex.code}
              className="am-dis-decoder-example-btn"
              onClick={() => onInputChange(ex.code)}
              title={ex.label}
            >
              <code>{ex.code}</code>
              <span className="am-dis-decoder-example-label">{ex.label}</span>
            </button>
          ))}
        </div>
      )}

      {decoded && (
        <div className="am-dis-decoder-result">
          {decoded.warning && (
            <div
              style={{
                padding: "6px 10px",
                background: "var(--am-amber-dim)",
                border: "1px solid rgba(240, 168, 60,0.35)",
                borderRadius: "var(--am-radius-sm)",
                color: "#f5b955",
                fontSize: 11,
              }}
            >
              ⚠ {decoded.warning}
            </div>
          )}

          {/* Preview + summary */}
          <div className="am-sidc-preview">
            <div className="am-sidc-preview-symbol">
              <MilSymbol sidc={decoded.code} size={90} />
              {!decoded.milsymbolValid && (
                <div className="am-sidc-preview-fallback">
                  milsymbol reports this SIDC as not fully valid — the icon may
                  fall back to an unspecified variant.
                </div>
              )}
            </div>
            <div className="am-sidc-preview-summary">
              <div className="am-dis-decoder-result-header">
                <span className="am-dis-decoder-result-code">
                  <code>{decoded.code}</code>
                </span>
                {decoded.isValid ? (
                  <span className="am-tag mapped">✓ Valid</span>
                ) : (
                  <span className="am-tag partial">~ Padded</span>
                )}
              </div>
              {decoded.summary && (
                <div className="am-dis-decoder-summary">{decoded.summary}</div>
              )}
            </div>
          </div>

          {/* Field grid */}
          <div className="am-dis-decoder-grid">
            <DecoderField
              range="1"
              label="Coding Scheme"
              value={decoded.parts.codingScheme}
              desc={decoded.labels.codingScheme}
            />
            <DecoderField
              range="2"
              label="Standard Identity"
              value={decoded.parts.standardIdentity}
              desc={decoded.labels.standardIdentity}
            />
            <DecoderField
              range="3"
              label="Battle Dimension"
              value={decoded.parts.battleDimension}
              desc={decoded.labels.battleDimension}
            />
            <DecoderField
              range="4"
              label="Status"
              value={decoded.parts.status}
              desc={decoded.labels.status}
            />
            <DecoderField
              range="5-10"
              label="Function ID"
              value={decoded.parts.functionId}
              desc={decoded.labels.functionId}
            />
            <DecoderField
              range="11"
              label="HQ / TF / Feint-Dummy"
              value={decoded.parts.hqTfDummy}
              desc={decoded.labels.hqTfDummy}
            />
            <DecoderField
              range="12"
              label="Echelon / Mobility"
              value={decoded.parts.echelonMobility}
              desc={decoded.labels.echelonMobility}
            />
            <DecoderField
              range="13-14"
              label="Country"
              value={decoded.parts.countryCode}
              desc={
                decoded.parts.countryCode === "--"
                  ? "Not specified"
                  : `ISO 3166: ${decoded.parts.countryCode}`
              }
            />
            <DecoderField
              range="15"
              label="Order of Battle"
              value={decoded.parts.orderOfBattle}
              desc={decoded.labels.orderOfBattle}
            />
          </div>

          <div className="am-dis-hint" style={{ margin: 0 }}>
            <span
              style={{ fontFamily: "var(--am-mono)", color: "var(--am-accent)" }}
            >
              i
            </span>
            <span>
              Letter-based SIDCs are 15 characters. Positions 5–10 encode the
              symbol&apos;s function ID (the icon), which milsymbol maps against
              APP-6D / MIL-STD-2525C dictionaries at render time.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Field cell ──────────────────────────────────────────────

interface DecoderFieldProps {
  range: string;
  label: string;
  value: string;
  desc: string | null;
}

const DecoderField: React.FC<DecoderFieldProps> = ({
  range,
  label,
  value,
  desc,
}) => {
  const isEmpty = /^-+$/.test(value) || value === "";
  return (
    <div
      className={`am-dis-decoder-field${
        isEmpty ? " am-dis-decoder-field--empty" : ""
      }`}
    >
      <div className="am-dis-decoder-field-pos" style={{ width: 40 }}>
        {range}
      </div>
      <div className="am-dis-decoder-field-body">
        <div className="am-dis-decoder-field-label">{label}</div>
        <div className="am-dis-decoder-field-value">
          <code>{value || "—"}</code>
        </div>
        <div className="am-dis-decoder-field-desc">
          {desc ?? (
            <span style={{ color: "var(--am-amber)", fontStyle: "italic" }}>
              {isEmpty ? "—" : "unknown"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
