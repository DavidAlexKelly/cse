// ============================================================
//  ORBAT AI — Structured Output Schema
//
//  The LLM is instructed to respond with a JSON object that
//  matches OrbatAiResponse.  This file defines:
//    1. The TypeScript types for that schema
//    2. A compact string representation of the schema fed
//       to the LLM as part of the system prompt (retained
//       purely for legacy tooling; the generator ontology
//       function now emits the schema server-side)
//    3. parse() — validates and converts the LLM JSON into
//       the typed structure, transparently handling BOTH
//       the current schema (nodes / designation / canonicalAssetId
//       / relationshipType / suggestedRelationships) AND the
//       legacy schema (units / name) so older cached responses
//       still work.
//    4. treeToAddOps() — converts the tree into an ordered
//       list of addUnit calls (BFS so parents always exist),
//       preserving relationshipType and canonicalAssetId in
//       the addUnit input.
// ============================================================

import type {
  EchelonLevel,
  UnitIconType,
  StandardIdentity,
  CommandRelationshipType,
} from "./types.js";
import { ECHELON_INDEX } from "./types.js";

// ─── Schema types ─────────────────────────────────────────────────────────────

export interface AiUnit {
  /** Display name — short, e.g. "1 Pl", "Alpha Coy", "1st Btn HQ" */
  name: string;
  /** One of the valid ORBAT echelon strings */
  echelon: EchelonLevel;
  /** NATO icon key */
  icon: UnitIconType;
  /** Approximate organic personnel */
  personnelCount: number;
  /** Free-text note, nationality, role, etc. */
  notes?: string;
  /**
   * NxgCanonicalAsset.primaryKey_ chosen by the generator.  May be null when
   * the generator couldn't confidently map the unit to a catalogue asset.
   */
  canonicalAssetId?: string | null;
  /**
   * NATO command relationship of this unit to its PARENT in the tree.
   * Emitted lower-case by the ontology function; we normalise to the
   * uppercase CommandRelationshipType.  Undefined for root nodes.
   */
  relationshipType?: CommandRelationshipType;
  /** Sub-units */
  children: AiUnit[];
}

/**
 * A support / cross-tree relationship the LLM has proposed in addition to the
 * organic parent-child hierarchy.  These are NOT re-parent moves — they are
 * annotations that a given unit provides support (or is attached, etc.) to
 * another unit elsewhere in the tree.
 */
export interface AiSuggestedRelationship {
  fromAssetId: string;
  fromDesignation: string;
  toAssetId: string;
  toDesignation: string;
  relationshipType: CommandRelationshipType;
  description: string;
}

export interface OrbatAiResponse {
  /** One-sentence description of the structure generated */
  description: string;
  /** Top-level units (may be multiple roots, e.g. two brigades) */
  units: AiUnit[];
  /** Optional cross-tree support / attachment annotations */
  suggestedRelationships: AiSuggestedRelationship[];
}

// ─── System prompt / schema specification ─────────────────────────────────────
//
//  Retained for reference / debugging — the Foundry ontology function embeds
//  its own system prompt server-side, so this string is no longer sent from
//  the widget.  Left here so devs can see what shape we expect back.

export const SYSTEM_PROMPT = `
You are a military ORBAT (Order of Battle) generator.
The user will describe a military unit structure in plain English.
You MUST respond with a single valid JSON object and NO other text.
The JSON must strictly match this schema:

{
  "description": "<one sentence summary>",
  "nodes": [ <AiUnit>, ... ],
  "suggestedRelationships": [ <AiSuggestedRelationship>, ... ]
}

AiUnit:
{
  "canonicalAssetId": string | null,  // NxgCanonicalAsset primary key or null
  "designation":      string,         // short designation e.g. "1st Battalion", "Alpha Coy", "1 Pl"
  "echelon":          EchelonLevel,   // team|squad|section|platoon|company|battalion|regiment|brigade|division|corps|army|armyGroup|theatre
  "icon":             UnitIconType,
  "personnelCount":   number,
  "notes":            string | null,
  "relationshipType": "organic"|"opcon"|"tacon"|"attached"|"assigned"|"supportcon"|"adcon",
  "children":         [ <AiUnit>, ... ]
}

AiSuggestedRelationship:
{
  "fromAssetId":      string,
  "fromDesignation":  string,
  "toAssetId":        string,
  "toDesignation":    string,
  "relationshipType": "organic"|"opcon"|"tacon"|"attached"|"assigned"|"supportcon"|"adcon",
  "description":      string
}
`.trim();

// ─── Parse + validate LLM output ─────────────────────────────────────────────

const VALID_ECHELONS = new Set<string>([
  "team",
  "squad",
  "section",
  "platoon",
  "company",
  "battalion",
  "regiment",
  "brigade",
  "division",
  "corps",
  "army",
  "armyGroup",
  "theatre",
]);

const VALID_ICONS = new Set<string>([
  "infantry",
  "armour",
  "mechanisedInfantry",
  "artillery",
  "rocketArtillery",
  "mortar",
  "aviation",
  "airForce",
  "reconnaissance",
  "cavalry",
  "engineer",
  "pioneer",
  "signals",
  "cyber",
  "ew",
  "logistics",
  "maintenance",
  "medical",
  "airDefence",
  "specialForces",
  "sniper",
  "antiTank",
  "naval",
  "cbrn",
  "military_police",
  "headquarters",
  "generic",
]);

const VALID_CMD_RELS = new Set<CommandRelationshipType>([
  "ORGANIC",
  "OPCON",
  "TACON",
  "ATTACHED",
  "ASSIGNED",
  "SUPPORTCON",
  "ADCON",
]);

function coerceEchelon(v: unknown): EchelonLevel {
  if (typeof v === "string" && VALID_ECHELONS.has(v)) return v as EchelonLevel;
  return "platoon";
}

function coerceIcon(v: unknown): UnitIconType {
  if (typeof v === "string" && VALID_ICONS.has(v)) return v as UnitIconType;
  return "generic";
}

function coerceRelType(v: unknown): CommandRelationshipType | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const up = v.trim().toUpperCase();
  if (VALID_CMD_RELS.has(up as CommandRelationshipType)) {
    return up as CommandRelationshipType;
  }
  return undefined;
}

function parseUnit(raw: unknown, parentEchelonIdx: number): AiUnit {
  const r = (raw ?? {}) as Record<string, unknown>;
  const echelon = coerceEchelon(r.echelon);
  const echelonIdx = ECHELON_INDEX[echelon];

  // Hard rule: child must be strictly below parent
  const effectiveEchelon: EchelonLevel =
    parentEchelonIdx === Infinity || echelonIdx < parentEchelonIdx
      ? echelon
      : (Object.entries(ECHELON_INDEX)
          .filter(([, idx]) => idx < parentEchelonIdx)
          .sort(([, a], [, b]) => b - a)[0]?.[0] as EchelonLevel | undefined) ??
        "platoon";

  const effectiveIdx = ECHELON_INDEX[effectiveEchelon];

  const children: AiUnit[] = Array.isArray(r.children)
    ? r.children.map((c: unknown) => parseUnit(c, effectiveIdx))
    : [];

  // Name may come as either `designation` (new schema) or `name` (legacy).
  const rawName =
    (typeof r.designation === "string" &&
      r.designation.trim() &&
      r.designation) ||
    (typeof r.name === "string" && r.name.trim() && r.name) ||
    "Unit";

  // canonicalAssetId — new schema field.  Treat empty string / null as missing.
  const rawCanonical = r.canonicalAssetId;
  const canonicalAssetId =
    typeof rawCanonical === "string" && rawCanonical.trim()
      ? rawCanonical.trim()
      : null;

  return {
    name: (rawName as string).trim(),
    echelon: effectiveEchelon,
    icon: coerceIcon(r.icon),
    personnelCount:
      typeof r.personnelCount === "number" && r.personnelCount >= 0
        ? Math.round(r.personnelCount)
        : 0,
    notes: typeof r.notes === "string" ? r.notes : undefined,
    canonicalAssetId,
    relationshipType: coerceRelType(r.relationshipType),
    children,
  };
}

function parseSuggestedRelationship(
  raw: unknown
): AiSuggestedRelationship | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const relType = coerceRelType(r.relationshipType);
  if (!relType) return null;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const fromAssetId = s(r.fromAssetId);
  const toAssetId = s(r.toAssetId);
  const fromDesignation = s(r.fromDesignation);
  const toDesignation = s(r.toDesignation);
  if (!fromDesignation || !toDesignation) return null;
  return {
    fromAssetId,
    fromDesignation,
    toAssetId,
    toDesignation,
    relationshipType: relType,
    description: s(r.description),
  };
}

/**
 * Extract and parse the LLM's text response into a typed OrbatAiResponse.
 * Handles common issues like the model wrapping JSON in markdown fences, and
 * transparently accepts both the current (`nodes`) and legacy (`units`)
 * top-level array names.
 */
export function parseAiResponse(text: string): OrbatAiResponse {
  // Strip markdown fences if present
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Find the first `{` to skip any leading prose
  const start = cleaned.indexOf("{");
  if (start > 0) cleaned = cleaned.slice(start);

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Could not parse LLM response as JSON.\n\nRaw output:\n${text.slice(
        0,
        400
      )}`
    );
  }

  // New schema uses `nodes`; legacy schema used `units`.
  const rawUnits = Array.isArray(raw.nodes)
    ? raw.nodes
    : Array.isArray(raw.units)
    ? raw.units
    : [];
  const units: AiUnit[] = rawUnits.map((u: unknown) => parseUnit(u, Infinity));

  const rawRels = Array.isArray(raw.suggestedRelationships)
    ? raw.suggestedRelationships
    : [];
  const suggestedRelationships = rawRels
    .map(parseSuggestedRelationship)
    .filter((r): r is AiSuggestedRelationship => r !== null);

  return {
    description:
      typeof raw.description === "string"
        ? raw.description
        : "AI-generated structure",
    units,
    suggestedRelationships,
  };
}

// ─── Convert AI tree → ordered addUnit operations ────────────────────────────

export interface AddUnitOp {
  /** Temporary stable key for parent resolution (generated ID, not real DB id) */
  tempId: string;
  /** tempId of parent, or null for root units */
  parentTempId: string | null;
  /** Input record for onAddUnit() */
  input: Record<string, unknown>;
  /** The AiUnit for reference (e.g. for preview) */
  unit: AiUnit;
}

let _seq = 0;
function nextTempId() {
  return `ai_${Date.now()}_${++_seq}`;
}

/**
 * Flatten an AiUnit tree into BFS-ordered addUnit operations.
 * Parents always appear before their children in the returned list.
 *
 * The generated `input` records include:
 *   • commandRelationshipType — the LLM-chosen NATO relationship to parent
 *   • notes — free-text plus a "Canonical: <id>" tag when the LLM provided one
 *     so the id is at least visible in the UI even before we resolve the name.
 */
export function treeToAddOps(
  units: AiUnit[],
  affiliation: StandardIdentity = "friend"
): AddUnitOp[] {
  const ops: AddUnitOp[] = [];
  const queue: Array<{ unit: AiUnit; parentTempId: string | null }> = units.map(
    (u) => ({ unit: u, parentTempId: null })
  );

  while (queue.length > 0) {
    const { unit, parentTempId } = queue.shift()!;
    const tempId = nextTempId();

    // Combine LLM notes with the canonical-asset id for at-a-glance display.
    // The graphqlSchema resolver still receives the raw fields (relType +
    // notes) — we just enrich notes here rather than plumbing a whole new
    // "canonicalAssetId" column through the schema.
    const noteParts: string[] = [];
    if (unit.notes && unit.notes.trim()) noteParts.push(unit.notes.trim());
    if (unit.canonicalAssetId)
      noteParts.push(`Canonical: ${unit.canonicalAssetId}`);
    const combinedNotes = noteParts.join(" · ");

    ops.push({
      tempId,
      parentTempId,
      input: {
        name: unit.name,
        echelon: unit.echelon,
        symbolIcon: unit.icon,
        personnelCount: unit.personnelCount,
        notes: combinedNotes,
        standardIdentity: affiliation,
        // Only send a relationship for non-root nodes; a root defaults to
        // ORGANIC (or is simply left undefined at the schema layer).
        commandRelationshipType:
          parentTempId !== null ? unit.relationshipType : undefined,
      },
      unit,
    });

    unit.children.forEach((child) =>
      queue.push({ unit: child, parentTempId: tempId })
    );
  }

  return ops;
}

// ─── Preview helpers ──────────────────────────────────────────────────────────

/** Count total units in an AiUnit tree */
export function countAiUnits(units: AiUnit[]): number {
  let n = 0;
  const walk = (u: AiUnit) => {
    n++;
    u.children.forEach(walk);
  };
  units.forEach(walk);
  return n;
}

/** Total personnel across the whole tree */
export function totalAiPax(units: AiUnit[]): number {
  let p = 0;
  const walk = (u: AiUnit) => {
    p += u.personnelCount;
    u.children.forEach(walk);
  };
  units.forEach(walk);
  return p;
}

/** ASCII tree preview string */
export function aiTreePreview(units: AiUnit[], prefix = ""): string {
  const lines: string[] = [];
  units.forEach((u, i) => {
    const isLast = i === units.length - 1;
    lines.push(
      `${prefix}${isLast ? "└─ " : "├─ "}${u.name} [${u.echelon}]${
        u.personnelCount > 0 ? ` (${u.personnelCount} pax)` : ""
      }`
    );
    if (u.children.length > 0) {
      lines.push(aiTreePreview(u.children, prefix + (isLast ? "   " : "│  ")));
    }
  });
  return lines.join("\n");
}
