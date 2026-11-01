// ============================================================
//  DIS Reference — Lookup / Decoder
// ============================================================
//
//  Bundles the SISO-REF-010 v35 reference data (from /DISCodesInfo)
//  and exposes fast lookup helpers.
//
//  ── What's bundled ──────────────────────────────────────────
//    - dis_entity_types.json  (20 417 rows, ~12 MB)
//    - dis_enumerations.json  (436 tables,   ~1.5 MB)
//
//  The heavy JSON is imported statically but the derived Maps
//  are built lazily on first use, so start-up cost is deferred
//  until the user actually opens a DIS decoder / reference view.

import entityTypesJson from "../../../DISCodesInfo/dis_entity_types.json";
import enumerationsJson from "../../../DISCodesInfo/dis_enumerations.json";

// ─── Types matching the JSON shape ───────────────────────────

export interface DisEntityTypeRaw {
  cet_uid: string;
  cet_name: string;
  entity_uid: string;
  kind: string;
  kind_desc: string;
  domain: string;
  domain_desc: string;
  country: string;
  country_desc: string;
  category: string;
  category_desc: string;
  subcategory: string;
  subcategory_desc: string;
  specific: string;
  specific_desc: string;
  extra: string;
  extra_desc: string;
  leaf_uid: string;
  dis_code: string;
}

interface EntityTypesFile {
  meta: unknown;
  summary: DisSummary;
  entity_types_flat: DisEntityTypeRaw[];
}

interface EnumRow {
  value: string;
  description: string;
  uuid?: string;
}

interface EnumTable {
  uid: string;
  name: string;
  size_bits?: string;
  rows: EnumRow[];
}

interface EnumerationsFile {
  meta: unknown;
  summary: DisSummary;
  enumerations: EnumTable[];
}

export interface DisSummary {
  enum_tables: number;
  enum_rows: number;
  bitfield_tables: number;
  bitfield_rows: number;
  record_definitions: number;
  entity_type_rows: number;
  pdu_class_defs: number;
  pdu_count: number;
}

// ─── Decoded result ──────────────────────────────────────────

export interface DisDecoded {
  /** The original code as passed in, normalised to 7 tokens. */
  code: string;
  /** Individual parts of the 7-tuple (kind.domain.country.category.subcategory.specific.extra). */
  parts: {
    kind: string;
    domain: string;
    country: string;
    category: string;
    subcategory: string;
    specific: string;
    extra: string;
  };
  /** Human-readable label for each part (from the SISO catalogue). */
  labels: {
    kind: string | null;
    domain: string | null;
    country: string | null;
    category: string | null;
    subcategory: string | null;
    specific: string | null;
    extra: string | null;
  };
  /** Exact catalogue match if the full 7-tuple exists in SISO-REF-010. */
  exactMatch: DisEntityTypeRaw | null;
  /** True if kind.domain.country.category resolves to a known catalogue node. */
  hasCatalogueBase: boolean;
  /** A short human-readable string, e.g. "Platform · Land · UK · Tank". */
  summary: string;
}

// ─── Module-level lazy caches ────────────────────────────────

const entityRows = (entityTypesJson as unknown as EntityTypesFile)
  .entity_types_flat;
const enumTables = (enumerationsJson as unknown as EnumerationsFile)
  .enumerations;

/** dis_code (7 parts, dot-joined) → row. */
let _byExactCode: Map<string, DisEntityTypeRaw> | null = null;

/** kind.domain.country.category → any matching row (for partial resolution). */
let _byBaseCode: Map<string, DisEntityTypeRaw> | null = null;

/** enum table name → {value → description}. */
let _enumByName: Map<string, Map<string, string>> | null = null;

function ensureEntityIndex(): Map<string, DisEntityTypeRaw> {
  if (_byExactCode) return _byExactCode;
  const m = new Map<string, DisEntityTypeRaw>();
  for (const row of entityRows) {
    if (!row.dis_code) continue;
    // Duplicates in the SISO catalogue are rare (see DISCodesInfo audit);
    // keep the last occurrence — good enough for the decoder.
    m.set(row.dis_code, row);
  }
  _byExactCode = m;
  return m;
}

function ensureBaseIndex(): Map<string, DisEntityTypeRaw> {
  if (_byBaseCode) return _byBaseCode;
  const m = new Map<string, DisEntityTypeRaw>();
  for (const row of entityRows) {
    const base = `${row.kind}.${row.domain}.${row.country}.${row.category}`;
    if (!m.has(base)) m.set(base, row);
  }
  _byBaseCode = m;
  return m;
}

function ensureEnumIndex(): Map<string, Map<string, string>> {
  if (_enumByName) return _enumByName;
  const m = new Map<string, Map<string, string>>();
  for (const t of enumTables) {
    const inner = new Map<string, string>();
    for (const row of t.rows) inner.set(row.value, row.description);
    m.set(t.name, inner);
  }
  _enumByName = m;
  return m;
}

// ─── Public API ──────────────────────────────────────────────

/** Return the SISO summary bundle for the "About" section. */
export function getDisSummary(): DisSummary {
  return (entityTypesJson as unknown as EntityTypesFile).summary;
}

/** Total number of entity rows bundled. */
export function getDisEntityCount(): number {
  return entityRows.length;
}

/** Get an entire enum table by SISO name (e.g. "Entity Kind"). */
export function getEnumTable(name: string): Map<string, string> | undefined {
  return ensureEnumIndex().get(name);
}

/** Get the human-readable label for a value in an enum table. */
export function getEnumLabel(
  tableName: string,
  value: string | null | undefined
): string | null {
  if (value == null || value === "") return null;
  const table = ensureEnumIndex().get(tableName);
  if (!table) return null;
  return table.get(value) ?? null;
}

/**
 * Normalise a raw DIS code string to a 7-part dot-joined form.
 * Accepts inputs like "1.1.225.1.0", "1.1.225.1.0.0.0", "1:1:225",
 * or "1.1.225.1.0.0.0" and pads trailing tokens with "0".
 * Returns null if the input is unusable.
 */
export function normaliseDisCode(
  input: string | null | undefined
): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  // Split on any of ., :, /, ; or whitespace
  const parts = raw.split(/[.:/;\s]+/).filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  if (parts.length > 7) return null;
  // Validate every part is an unsigned integer (SISO codes are numeric)
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
  }
  // Pad trailing tokens with "0" to reach exactly 7 parts
  while (parts.length < 7) parts.push("0");
  return parts.join(".");
}

const KIND_TABLE = "Entity Kind";
// The country table in SISO is simply named "Country".
const COUNTRY_TABLE = "Country";

// Domain enum in SISO is a single table shared across kinds ("Platform Domain")
// for platforms, with kind-specific tables for munitions, supply, etc.
const DOMAIN_TABLES_BY_KIND: Record<string, string[]> = {
  "1": ["Platform Domain"], // Platform
  "2": ["Munition Domain", "Platform Domain"],
  "3": ["Platform Domain"], // Life form
  "6": ["Supply Domain"],
  "7": ["Radio Category"],
};

function resolveDomainLabel(kind: string, domain: string): string | null {
  if (!kind || !domain) return null;
  const candidates = DOMAIN_TABLES_BY_KIND[kind] ?? ["Platform Domain"];
  for (const tbl of candidates) {
    const v = getEnumLabel(tbl, domain);
    if (v) return v;
  }
  return null;
}

// Category enum tables are split by (kind, domain). "Platform-Land Category",
// "Platform-Air Category", etc. Return the appropriate table name.
const PLATFORM_DOMAIN_TO_CAT: Record<string, string> = {
  "1": "Platform-Land Category",
  "2": "Platform-Air Category",
  "3": "Platform-Surface Category",
  "4": "Platform-Subsurface Category",
  "5": "Platform-Space Category",
};

function resolveCategoryLabel(
  kind: string,
  domain: string,
  category: string
): string | null {
  if (!kind || !domain || !category) return null;
  if (kind === "1") {
    const tbl = PLATFORM_DOMAIN_TO_CAT[domain];
    if (tbl) return getEnumLabel(tbl, category);
  }
  if (kind === "2") return getEnumLabel("Munition Category", category);
  if (kind === "7") return getEnumLabel("Radio Category", category);
  return null;
}

/**
 * Decode a DIS entity-type code into human-readable labels.
 *
 * Attempts an exact 7-tuple lookup first. If no match is found,
 * it falls back to (a) finding any row that shares the first 4
 * tokens (kind.domain.country.category) so we can still label
 * the higher-level classification, and (b) enum tables for the
 * top-level tokens (kind / domain / country).
 */
export function decodeDisCode(
  input: string | null | undefined
): DisDecoded | null {
  const code = normaliseDisCode(input);
  if (!code) return null;

  const [kind, domain, country, category, subcategory, specific, extra] =
    code.split(".");

  const exact = ensureEntityIndex().get(code) ?? null;
  const baseKey = `${kind}.${domain}.${country}.${category}`;
  const base = ensureBaseIndex().get(baseKey) ?? null;

  const labels = {
    kind: exact?.kind_desc || base?.kind_desc || getEnumLabel(KIND_TABLE, kind),
    domain:
      exact?.domain_desc ||
      base?.domain_desc ||
      resolveDomainLabel(kind, domain),
    country:
      exact?.country_desc ||
      base?.country_desc ||
      getEnumLabel(COUNTRY_TABLE, country),
    category:
      exact?.category_desc ||
      base?.category_desc ||
      resolveCategoryLabel(kind, domain, category),
    subcategory: exact?.subcategory_desc || null,
    specific: exact?.specific_desc || null,
    extra: exact?.extra_desc || null,
  };

  const summaryParts: string[] = [];
  if (labels.kind) summaryParts.push(labels.kind);
  if (labels.domain) summaryParts.push(labels.domain);
  if (labels.country) {
    // Country descriptions in SISO include an ISO abbreviation in parens,
    // e.g. "United Kingdom (GBR)". Keep the full description for now.
    summaryParts.push(labels.country);
  }
  if (labels.category) summaryParts.push(labels.category);
  if (labels.subcategory) summaryParts.push(labels.subcategory);
  if (labels.specific) summaryParts.push(labels.specific);

  return {
    code,
    parts: { kind, domain, country, category, subcategory, specific, extra },
    labels,
    exactMatch: exact,
    hasCatalogueBase: base != null,
    summary: summaryParts.join(" · "),
  };
}

/**
 * Return raw entity-type rows matching a free-text query on any of the
 * kind/domain/country/category/subcategory/specific descriptions or the
 * DIS code itself.  Bounded so it never returns more than `limit` rows
 * (default 200) to keep the UI responsive.
 */
export function searchDisEntityTypes(
  query: string,
  limit = 200
): DisEntityTypeRaw[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: DisEntityTypeRaw[] = [];
  for (const r of entityRows) {
    if (
      r.dis_code.includes(q) ||
      r.kind_desc.toLowerCase().includes(q) ||
      r.domain_desc.toLowerCase().includes(q) ||
      r.country_desc.toLowerCase().includes(q) ||
      r.category_desc.toLowerCase().includes(q) ||
      r.subcategory_desc.toLowerCase().includes(q) ||
      r.specific_desc.toLowerCase().includes(q)
    ) {
      results.push(r);
      if (results.length >= limit) break;
    }
  }
  return results;
}

/**
 * Return every entity-type row that matches the first N tokens of a code.
 * Useful for "what other codes share this kind/domain/country/category?".
 */
export function findRelatedByPrefix(
  code: string,
  tokens: number,
  limit = 100
): DisEntityTypeRaw[] {
  const norm = normaliseDisCode(code);
  if (!norm) return [];
  const prefix = norm.split(".").slice(0, tokens).join(".") + ".";
  const results: DisEntityTypeRaw[] = [];
  for (const r of entityRows) {
    if (r.dis_code.startsWith(prefix) && r.dis_code !== norm) {
      results.push(r);
      if (results.length >= limit) break;
    }
  }
  return results;
}
