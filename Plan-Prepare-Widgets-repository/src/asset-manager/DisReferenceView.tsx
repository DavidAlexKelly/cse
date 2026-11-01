// ============================================================
//  Asset Manager — DIS Reference View
// ============================================================
//
//  A searchable browser over the SISO-REF-010 v35 DIS entity type
//  catalogue (bundled from /DISCodesInfo/dis_entity_types.json).
//
//  Features:
//    - DIS Code Decoder — type any 7-tuple and see the decoded
//      kind / domain / country / category / subcategory / specific
//      / extra with SISO labels, even for codes not in the asset
//      catalogues.
//    - Search on code or any label (browses the full 20k+ catalogue)
//    - Filter by kind / domain / country
//    - Click a row to load it into the decoder
//    - Highlight rows referenced by the current VBS4 / Sword /
//      Simworks catalogues, so users can see coverage at a glance.

import React, { useMemo, useState, useEffect } from "react";
import {
  decodeDisCode,
  searchDisEntityTypes,
  findRelatedByPrefix,
  normaliseDisCode,
  getDisEntityCount,
  getDisSummary,
  type DisDecoded,
  type DisEntityTypeRaw,
} from "./dis/disLookup.js";
import { DisCodeBadge } from "./DisCodeBadge.js";
import type { Vbs4Asset, SimworksAsset, SwordAsset } from "./types.js";

interface Props {
  vbs4: Vbs4Asset[];
  simworks: SimworksAsset[];
  sword: SwordAsset[];
  /** Optional: initial search query — used to pre-filter to a specific code. */
  initialQuery?: string;
}

/** Simulator usage badges for a given DIS code. */
interface CodeUsage {
  vbs4: number;
  simworks: number;
  sword: number;
}

function buildUsageIndex(
  vbs4: Vbs4Asset[],
  simworks: SimworksAsset[],
  sword: SwordAsset[]
): Map<string, CodeUsage> {
  const m = new Map<string, CodeUsage>();
  const bump = (code: string | null, key: keyof CodeUsage) => {
    if (!code) return;
    if (!m.has(code)) m.set(code, { vbs4: 0, simworks: 0, sword: 0 });
    m.get(code)![key]++;
  };
  for (const v of vbs4) bump(v.disCode, "vbs4");
  for (const s of simworks) bump(s.disCode, "simworks");
  for (const s of sword) bump(s.disCode, "sword");
  return m;
}

export const DisReferenceView: React.FC<Props> = ({
  vbs4,
  simworks,
  sword,
  initialQuery,
}) => {
  const [query, setQuery] = useState(initialQuery ?? "");
  // Keep filters as "" to mean "All" — avoids the label-vs-value mismatch
  // that occurred when options were built from the label string ("Kind: All").
  const [filterKind, setFilterKind] = useState("");
  const [filterDomain, setFilterDomain] = useState("");
  const [filterCountry, setFilterCountry] = useState("");

  // ── Decoder state ─────────────────────────────────────────
  // The decoder input is separate from the table search so users
  // can freely type a code without immediately altering the table.
  const [decoderInput, setDecoderInput] = useState(initialQuery ?? "");

  useEffect(() => {
    if (initialQuery !== undefined) {
      setQuery(initialQuery);
      setDecoderInput(initialQuery);
    }
  }, [initialQuery]);

  const decoded: DisDecoded | null = useMemo(
    () => decodeDisCode(decoderInput),
    [decoderInput]
  );

  const usage = useMemo(
    () => buildUsageIndex(vbs4, simworks, sword),
    [vbs4, simworks, sword]
  );

  // Perform search, then apply dropdown filters client-side
  const results = useMemo(() => {
    // No query → show only entries that appear in one of the simulators, so
    // the view is useful without typing (and stays fast on 20k rows).
    if (!query.trim()) {
      const seen = new Set<string>();
      const usedRows: DisEntityTypeRaw[] = [];
      for (const [code] of usage) {
        const row = decodeDisCode(code)?.exactMatch;
        if (row && !seen.has(row.dis_code)) {
          usedRows.push(row);
          seen.add(row.dis_code);
        }
      }
      return usedRows;
    }
    return searchDisEntityTypes(query, 500);
  }, [query, usage]);

  const filtered = useMemo(() => {
    return results.filter((r) => {
      if (filterKind && r.kind_desc !== filterKind) return false;
      if (filterDomain && r.domain_desc !== filterDomain) return false;
      if (filterCountry && r.country_desc !== filterCountry) return false;
      return true;
    });
  }, [results, filterKind, filterDomain, filterCountry]);

  // Options for the dropdowns — always derived from the FULL result set
  // (not the already-filtered set) so that when a filter is cleared the
  // other dropdowns still show all available values.
  const kinds = useMemo(() => {
    const s = new Set(results.map((r) => r.kind_desc));
    return Array.from(s).sort();
  }, [results]);
  const domains = useMemo(() => {
    const s = new Set(results.map((r) => r.domain_desc));
    return Array.from(s).sort();
  }, [results]);
  const countries = useMemo(() => {
    const s = new Set(results.map((r) => r.country_desc));
    return Array.from(s).sort();
  }, [results]);

  const summary = getDisSummary();
  const totalRows = getDisEntityCount();

  const loadIntoDecoder = (code: string) => {
    setDecoderInput(code);
  };

  return (
    <div className="am-view">
      <div className="am-content-header">
        <span className="am-content-header-icon">§</span>
        <span className="am-content-header-title">DIS Reference</span>
        <span className="am-content-header-badge">SISO-REF-010 v35</span>
        <span className="am-content-header-spacer" />
        <span className="am-content-header-meta">
          {totalRows.toLocaleString()} entity types · {summary.enum_tables} enum
          tables
        </span>
      </div>

      {/* ── DIS Code Decoder ─────────────────────────────── */}
      <DisDecoderCard
        input={decoderInput}
        onInputChange={setDecoderInput}
        decoded={decoded}
        usage={decoded ? usage.get(decoded.code) : undefined}
        onLoadRelated={loadIntoDecoder}
      />

      {/* ── Full catalogue search ────────────────────────── */}
      <div className="am-content-subheader">
        <span className="am-content-subheader-title">Catalogue browser</span>
        <span className="am-content-subheader-meta">
          Search {totalRows.toLocaleString()} SISO-REF-010 entity type rows
        </span>
      </div>

      <div className="am-filter-bar">
        <input
          className="am-search-input"
          placeholder="Search code, kind, domain, country or entity name (e.g. '1.1.225.1' or 'Challenger')…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="am-filter-select"
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value)}
        >
          <option value="">Kind: All</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          className="am-filter-select"
          value={filterDomain}
          onChange={(e) => setFilterDomain(e.target.value)}
        >
          <option value="">Domain: All</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          className="am-filter-select"
          value={filterCountry}
          onChange={(e) => setFilterCountry(e.target.value)}
        >
          <option value="">Country: All</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="am-filter-count">
          {filtered.length}
          {query.trim() ? ` of ${results.length}` : " in use"}
        </span>
      </div>

      {!query.trim() && (
        <div className="am-dis-hint">
          <span
            style={{ fontFamily: "var(--am-mono)", color: "var(--am-accent)" }}
          >
            i
          </span>
          <span>
            Showing {results.length} DIS codes that are referenced by your VBS4,
            Sword or Simworks catalogues. Type in the search box above to browse
            the full {totalRows.toLocaleString()}-row SISO reference.
          </span>
        </div>
      )}

      <div className="am-table-wrap">
        <table className="am-table">
          <thead>
            <tr>
              <th style={{ width: 150 }}>DIS Code</th>
              <th>Kind</th>
              <th>Domain</th>
              <th>Country</th>
              <th>Category</th>
              <th>Subcategory</th>
              <th>Specific</th>
              <th style={{ width: 120 }}>In use</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--am-text-muted)",
                  }}
                >
                  {query.trim()
                    ? "No SISO catalogue entries match this search."
                    : "No DIS codes in any simulator catalogue yet."}
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const u = usage.get(r.dis_code);
                const isSelected = decoded?.code === r.dis_code;
                return (
                  <tr
                    key={r.entity_uid + "_" + r.dis_code}
                    onClick={() => loadIntoDecoder(r.dis_code)}
                    style={{
                      cursor: "pointer",
                      background: isSelected
                        ? "var(--am-accent-dim)"
                        : undefined,
                    }}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <DisCodeBadge code={r.dis_code} />
                    </td>
                    <td style={{ fontSize: 12 }}>{r.kind_desc}</td>
                    <td style={{ fontSize: 12 }}>{r.domain_desc}</td>
                    <td style={{ fontSize: 12 }}>{r.country_desc}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.category_desc || (
                        <span style={{ color: "var(--am-text-dim)" }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {r.subcategory_desc || (
                        <span style={{ color: "var(--am-text-dim)" }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {r.specific_desc || (
                        <span style={{ color: "var(--am-text-dim)" }}>—</span>
                      )}
                    </td>
                    <td>
                      {u ? (
                        <span
                          style={{ display: "flex", gap: 4, flexWrap: "wrap" }}
                        >
                          {u.vbs4 > 0 && (
                            <span className="am-tag mapped" title="VBS4">
                              🗃️ {u.vbs4}
                            </span>
                          )}
                          {u.sword > 0 && (
                            <span
                              className="am-tag mapped"
                              title="MASA Sword"
                              style={{
                                background: "rgba(157,112,196,0.15)",
                                color: "var(--am-purple)",
                              }}
                            >
                              ⚔️ {u.sword}
                            </span>
                          )}
                          {u.simworks > 0 && (
                            <span
                              className="am-tag mapped"
                              title="Simworks"
                              style={{
                                background: "rgba(19,201,186,0.15)",
                                color: "var(--am-teal)",
                              }}
                            >
                              🛰️ {u.simworks}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span
                          style={{ color: "var(--am-text-dim)", fontSize: 11 }}
                        >
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ============================================================
//  Sub-component: DIS Code Decoder card
// ============================================================
//
//  A stand-alone decoder that accepts ANY DIS entity-type code
//  (dot- or colon-separated, 1–7 tokens) and shows the decoded
//  labels for kind, domain, country, category, subcategory,
//  specific and extra using the SISO-REF-010 catalogue.
//
//  Works even for codes not present in the asset inventories.
//  Also lists sibling codes that share the (kind.domain.country
//  .category) prefix so users can explore the taxonomy.

interface DisDecoderCardProps {
  input: string;
  onInputChange: (v: string) => void;
  decoded: DisDecoded | null;
  usage: CodeUsage | undefined;
  onLoadRelated: (code: string) => void;
}

const DECODER_EXAMPLES: { code: string; label: string }[] = [
  { code: "1.1.225.1.1.3.0", label: "UK · Challenger 2 (Platform · Land)" },
  { code: "1.2.222.1.1.0.0", label: "USA · F-15 (Platform · Air)" },
  { code: "1.3.225.1.4.0.0", label: "UK · Type 45 (Platform · Surface)" },
  { code: "3.1.222.1.0.0.0", label: "USA · Life Form (Platform · Land)" },
  { code: "2.9.222.2.1.0.0", label: "USA · Anti-air Missile" },
];

const DisDecoderCard: React.FC<DisDecoderCardProps> = ({
  input,
  onInputChange,
  decoded,
  usage,
  onLoadRelated,
}) => {
  const normalised = normaliseDisCode(input);
  const invalid = input.trim().length > 0 && normalised === null;

  const related = useMemo(() => {
    if (!decoded) return [];
    // Show sibling codes sharing kind.domain.country.category (4 tokens),
    // but never include the code itself.
    return findRelatedByPrefix(decoded.code, 4, 8);
  }, [decoded]);

  return (
    <div className="am-dis-decoder">
      <div className="am-dis-decoder-header">
        <span className="am-dis-decoder-icon">⌕</span>
        <div className="am-dis-decoder-title-block">
          <div className="am-dis-decoder-title">DIS Code Decoder</div>
          <div className="am-dis-decoder-sub">
            Enter any DIS entity-type code to decode it against SISO-REF-010.
            Works even for codes not in your asset catalogues.
          </div>
        </div>
      </div>

      <div className="am-dis-decoder-input-row">
        <input
          className="am-dis-decoder-input"
          placeholder="e.g. 1.1.225.1.1.3.0"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
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

      {invalid && (
        <div className="am-dis-decoder-error">
          ⚠ Not a valid DIS code. Expected 1–7 numeric tokens separated by dots,
          colons or slashes — e.g. <code>1.1.225.1.1.3.0</code>.
        </div>
      )}

      {decoded && (
        <div className="am-dis-decoder-result">
          <div className="am-dis-decoder-result-header">
            <span className="am-dis-decoder-result-code">
              <DisCodeBadge code={decoded.code} variant="plain" />
            </span>
            {decoded.exactMatch ? (
              <span className="am-tag mapped">✓ SISO exact match</span>
            ) : decoded.hasCatalogueBase ? (
              <span className="am-tag partial">~ Partial match</span>
            ) : (
              <span className="am-tag unmapped">? Unknown code</span>
            )}
            {usage && (
              <span style={{ display: "inline-flex", gap: 4 }}>
                {usage.vbs4 > 0 && (
                  <span className="am-tag mapped" title="Used by VBS4 assets">
                    🗃️ {usage.vbs4} VBS4
                  </span>
                )}
                {usage.sword > 0 && (
                  <span
                    className="am-tag mapped"
                    title="Used by Sword unit templates"
                    style={{
                      background: "rgba(157,112,196,0.15)",
                      color: "var(--am-purple)",
                    }}
                  >
                    ⚔️ {usage.sword} Sword
                  </span>
                )}
                {usage.simworks > 0 && (
                  <span
                    className="am-tag mapped"
                    title="Used by Simworks entities"
                    style={{
                      background: "rgba(19,201,186,0.15)",
                      color: "var(--am-teal)",
                    }}
                  >
                    🛰️ {usage.simworks} Simworks
                  </span>
                )}
              </span>
            )}
          </div>

          {decoded.summary && (
            <div className="am-dis-decoder-summary">{decoded.summary}</div>
          )}

          <div className="am-dis-decoder-grid">
            <DecoderField
              pos={0}
              label="Kind"
              value={decoded.parts.kind}
              desc={decoded.labels.kind}
            />
            <DecoderField
              pos={1}
              label="Domain"
              value={decoded.parts.domain}
              desc={decoded.labels.domain}
            />
            <DecoderField
              pos={2}
              label="Country"
              value={decoded.parts.country}
              desc={decoded.labels.country}
            />
            <DecoderField
              pos={3}
              label="Category"
              value={decoded.parts.category}
              desc={decoded.labels.category}
            />
            <DecoderField
              pos={4}
              label="Subcategory"
              value={decoded.parts.subcategory}
              desc={decoded.labels.subcategory}
            />
            <DecoderField
              pos={5}
              label="Specific"
              value={decoded.parts.specific}
              desc={decoded.labels.specific}
            />
            <DecoderField
              pos={6}
              label="Extra"
              value={decoded.parts.extra}
              desc={decoded.labels.extra}
            />
          </div>

          {decoded.exactMatch && (
            <div className="am-dis-decoder-meta">
              <span className="am-dis-decoder-meta-label">
                SISO catalogue name:
              </span>
              <span className="am-dis-decoder-meta-value">
                {decoded.exactMatch.cet_name}
              </span>
              <span className="am-dis-decoder-meta-label">Entity UID:</span>
              <span className="am-dis-decoder-meta-value">
                <code>{decoded.exactMatch.entity_uid}</code>
              </span>
            </div>
          )}

          {related.length > 0 && (
            <div className="am-dis-decoder-related">
              <div className="am-dis-decoder-related-title">
                Related codes sharing kind · domain · country · category
              </div>
              <div className="am-dis-decoder-related-list">
                {related.map((r) => (
                  <button
                    key={r.entity_uid + "_" + r.dis_code}
                    className="am-dis-decoder-related-btn"
                    onClick={() => onLoadRelated(r.dis_code)}
                    title={r.cet_name}
                  >
                    <code>{r.dis_code}</code>
                    <span className="am-dis-decoder-related-label">
                      {r.specific_desc ||
                        r.subcategory_desc ||
                        r.category_desc ||
                        r.cet_name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface DecoderFieldProps {
  pos: number;
  label: string;
  value: string;
  desc: string | null;
}

const DecoderField: React.FC<DecoderFieldProps> = ({
  pos,
  label,
  value,
  desc,
}) => {
  const isEmpty = value === "0" || value === "";
  return (
    <div
      className={`am-dis-decoder-field${
        isEmpty ? " am-dis-decoder-field--empty" : ""
      }`}
    >
      <div className="am-dis-decoder-field-pos">{pos}</div>
      <div className="am-dis-decoder-field-body">
        <div className="am-dis-decoder-field-label">{label}</div>
        <div className="am-dis-decoder-field-value">
          <code>{value || "0"}</code>
        </div>
        <div className="am-dis-decoder-field-desc">
          {desc ||
            (isEmpty ? (
              <span style={{ color: "var(--am-text-dim)" }}>—</span>
            ) : (
              <span style={{ color: "var(--am-amber)", fontStyle: "italic" }}>
                unknown
              </span>
            ))}
        </div>
      </div>
    </div>
  );
};
