/**
 * foundry.ts — the single data-access layer for the ontology, via OSDK v2.
 *
 * This module used to exist twice: here and at
 * `src/apps/orbatManager/lib/foundry.ts`. The two copies were forked and then
 * edited independently, and they drifted apart in ways that silently corrupted
 * data — this copy still had `createEdgeFn` as a no-op stub and used
 * `relationshipTypeKey: "COMMAND"`, a value that matches no row in
 * NxgUnitHierarchyNodeRelationshipType, so every ORBAT written through it came
 * back as a flat list of orphaned units with no error raised anywhere.
 *
 * There is now exactly one implementation. `apps/orbatManager/lib/foundry.ts`
 * is a re-export of this file and exists only so existing relative imports keep
 * working. Do not fork it again: if an app needs different behaviour, add a
 * parameter, not a copy.
 */

import { client, auth } from "@/client";

import {
  // ── Object types ─────────────────────────────────────────────────────
  NxgOperation,
  NxgUnitHierachyEdge,
  NxgUnit,
  NxgTacticalGraphicSymbol,
  NxgVbs4AssetCatalogue,
  NxgOSwordAssetCatalogue,
  NxgSimworksAssetCatalogue,
  NxgCanonicalAsset,
  NxgUnitType,
  NxgEquipmentType,
  NxgUnitHierarchyNodeRelationshipType,
  NxgUnitHierarchy,

  // ── Actions ──────────────────────────────────────────────────────────
  createNxgUnit,
  updateNxgUnit,
  deleteNxgUnit,
  createNxgTacticalGraphicSymbol,
  updateNxgTacticalGraphicSymbolPosition,
  deleteNxgTacticalGraphicSymbol,
  createNxgUnitHierachyEdge,
  deleteNxgUnitHierachyEdge,
  createNxgUnitHierarchy,
  updateNxgUnitHierarchy,
  createNxgOtemplateOrbatGraph,
  editNxgOtemplateOrbatGraph,
  deleteNxgOtemplateOrbatGraph,

  // ── Object types (templates) ──────────────────────────────────────────
  NxgOTemplateOrbatGraph,

  // ── Functions ─────────────────────────────────────────────────────────
  cseValidateOrbat,
} from "@nxg-simulation-execution-testing/sdk";

import type {
  OUnit,
  OEdge,
  OSymbol,
  OOperation,
  OSimulatorConfig,
  OAsset,
  OCanonicalAsset,
  OUnitType,
  OEquipmentType,
  ORelationshipType,
  OHierarchy,
  CompositionNode,
  AssetAvailability,
  OSimAsset,
  SimTarget,
} from "../types/index";
import { assertCompositionEligible } from "../orbat/assetEligibility";
import {
  buildSwordFormationIndex,
  type SwordFormationIndex,
} from "../orbat/swordFormations";

import { cachedLoad, invalidatePrefix } from "./ontologyCache";
import { ORGANIC_RELATIONSHIP_KEY, ontologyDate } from "../orbat/model";

// ─── Auth token ────────────────────────────────────────────────────────────

const FOUNDRY_HOST = (import.meta.env.VITE_FOUNDRY_URL as string | undefined)
  ?? "accenture.palantirfoundry.com";

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

export async function getFoundryS3Credentials(): Promise<S3Credentials> {
  const token = await auth();
  if (!token) throw new Error("No auth token available");

  const url = `https://${FOUNDRY_HOST}/io/s3?Action=AssumeRoleWithWebIdentity&WebIdentityToken=${encodeURIComponent(token)}`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`S3 credentials exchange failed: HTTP ${response.status}`);
  }

  const xml = await response.text();

  // Extract a single XML tag value using indexOf rather than a dynamic RegExp
  // (ReDoS risk flagged by static analysis).
  function extractTag(content: string, open: string, close: string): string {
    const start = content.indexOf(open);
    if (start === -1) return "";
    const end = content.indexOf(close, start + open.length);
    if (end === -1) return "";
    return content.slice(start + open.length, end).trim();
  }

  const credentials: S3Credentials = {
    accessKeyId:     extractTag(xml, "<AccessKeyId>",     "</AccessKeyId>"),
    secretAccessKey: extractTag(xml, "<SecretAccessKey>", "</SecretAccessKey>"),
    sessionToken:    extractTag(xml, "<SessionToken>",    "</SessionToken>"),
    expiration:      new Date(extractTag(xml, "<Expiration>", "</Expiration>")),
  };

  if (!credentials.accessKeyId) {
    throw new Error(`Failed to parse S3 credentials from response: ${xml.slice(0, 500)}`);
  }

  return credentials;
}

export async function getAuthToken(): Promise<string> {
  const token = await auth();
  if (!token) throw new Error("No auth token available.");
  return token;
}

// ─── Generic paginator ─────────────────────────────────────────────────────

async function fetchAllPages<T>(
  query: {
    fetchPage: (opts: {
      $pageSize: number;
      $nextPageToken?: string;
    }) => Promise<{ data: T[]; nextPageToken?: string }>;
  },
  pageSize = 5000
): Promise<T[]> {
  const results: T[] = [];
  let nextPageToken: string | undefined;

  do {
    const page = await query.fetchPage({
      $pageSize: pageSize,
      ...(nextPageToken ? { $nextPageToken: nextPageToken } : {}),
    });
    results.push(...page.data);
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);

  return results;
}

// ─── Reference-data cache keys ─────────────────────────────────────────────
//
// These used to be namespaced per-app ("ont:om:*" vs "ont:shared:*") because
// the two forks of this file each wanted their own. That meant the same
// ontology tables were fetched twice, cached twice, and — worse — a mutation
// through one fork left the other fork's snapshot stale. One implementation,
// one namespace.
const K_OPERATIONS         = "ont:operations";
const K_CANONICAL_ASSETS   = "ont:canonicalAssets";
const K_UNIT_TYPES         = "ont:unitTypes";
const K_EQUIPMENT_TYPES    = "ont:equipmentTypes";
const K_RELATIONSHIP_TYPES = "ont:relationshipTypes";
const K_TEMPLATES          = "ont:hierarchyTemplates";
const K_PHASE_MAP_STATES   = "ont:phaseMapStates";
const K_SWORD_FORMATIONS   = "ont:swordFormations";

const REFERENCE_TTL_MS = 15 * 60 * 1000;

// ─── Loaders ───────────────────────────────────────────────────────────────

export async function loadOperations(): Promise<OOperation[]> {
  return cachedLoad(K_OPERATIONS, async () => {
    const data = await fetchAllPages(client(NxgOperation).where({}), 500);
    return data.map((obj) => ({
      primaryKey: obj.$primaryKey,
      startTime: obj.startTime ?? "",
      endTime: obj.endTime ?? null,
      terrainName: obj.terrainName ?? null,
    }));
  }, { ttlMs: 5 * 60 * 1000 }); // 5 min — operations rarely change
}

export async function loadOperation(operationKey: string): Promise<OOperation> {
  const obj = await client(NxgOperation).fetchOne(operationKey);
  return {
    primaryKey: obj.$primaryKey,
    startTime: obj.startTime ?? "",
    endTime: obj.endTime ?? null,
    terrainName: obj.terrainName ?? null,
  };
}

export async function loadEdgesForOperation(operationKey: string): Promise<OEdge[]> {
  // Prefer the ontology link Operation → UnitHierarchy over the operationKey
  // property, which is not always populated even when the link exists.
  let hierarchies = await fetchAllPages(
    client(NxgOperation).where({ $primaryKey: operationKey }).pivotTo("nxgUnitHierarchies"),
    100
  );

  if (!hierarchies.length) {
    // Fall back to the property filter. This branch previously computed the
    // fallback, logged it, and then threw unconditionally — so the fallback
    // could never actually be used. Now it is.
    hierarchies = await fetchAllPages(
      client(NxgUnitHierarchy).where({ operationKey: { $eq: operationKey } }),
      100
    );
  }

  if (!hierarchies.length) {
    throw new Error(`No UnitHierarchy found for operation: ${operationKey}.`);
  }

  const hierarchyKey = hierarchies[hierarchies.length - 1].$primaryKey;

  const edgeData = await fetchAllPages(
    client(NxgUnitHierachyEdge).where({ hierarchyKey: { $eq: hierarchyKey } }),
    5000
  );

  return edgeData.map((e) => ({
    primaryKey: e.$primaryKey,
    childUnitKey: e.childUnitKey ?? "",
    parentUnitKey: e.parentUnitKey ?? "",
    relationshipType: e.relationshipTypeKey ?? "",
  }));
}

export async function loadUnits(unitKeys: string[]): Promise<OUnit[]> {
  if (!unitKeys.length) return [];
  const data = await fetchAllPages(
    client(NxgUnit).where({ $primaryKey: { $in: unitKeys } }),
    5000
  );
  return data.map((u) => ({
    primaryKey: u.$primaryKey,
    unitIdentifier: u.unitIdentifier ?? "",
    militaryService: u.militaryService ?? "",
    echelon: u.echelon ?? "",
    sidc: u.sidc ?? "",
    affiliation: u.affiliation ?? "FRIEND",
    allegiance: u.allegiance ?? "",
    entityType: u.entityType ?? "organisation",
    owningSimulator: u.owningSimulator ?? "none",
    dis: u.dis ?? "0.0.0.0.0.0.0",
    canControlDrones: u.canControlDrones ?? false,
    // NxgUnit has no canonical_asset_key property — dis6Code IS the foreign key
    // that drives the NxgCanonicalAsset link. This used to be hardcoded to
    // null, so every unit read back from the ontology looked as though it had
    // no asset, and re-saving one silently dropped the link.
    canonicalAssetKey: u.dis6Code ?? null,
    simulatorIdentifierCode: u.simulatorIdentifierCode ?? null,
    latitude: u.latitude ?? null,
    longitude: u.longitude ?? null,
    unitTypeKey: u.unitTypeKey ?? null,
    equipmentTypeKey: u.equipmentTypeKey ?? null,
  }));
}

export async function loadSymbols(unitKeys: string[]): Promise<OSymbol[]> {
  if (!unitKeys.length) return [];
  const data = await fetchAllPages(
    client(NxgTacticalGraphicSymbol).where({ unitKey: { $in: unitKeys } }),
    5000
  );
  return data.map((s) => ({
    primaryKey: s.$primaryKey,
    sidc: s.sidc ?? "",
    unitKey: s.unitKey ?? "",
    latitude: s.latitude ?? null,
    longitude: s.longitude ?? null,
    directionOfMovement: s.directionOfMovement ?? null,
  }));
}

export async function loadConfigs(_unitKeys: string[]): Promise<OSimulatorConfig[]> {
  // NxgSimulatorConfig no longer in SDK — return empty; callers handle missing configs gracefully
  return [];
}

function mapVbs4Asset(a: { identifier: string; description?: string; domain?: string; classType?: string; isDrone?: boolean; derivedMilitaryDomain?: string; derivedSimulator?: string; canonicalAssetKey?: string }): OAsset {
  return {
    identifier: a.identifier ?? "",
    description: a.description ?? "",
    domain: a.domain ?? "",
    classType: a.classType ?? "",
    isDrone: a.isDrone ?? false,
    derivedMilitaryDomain: a.derivedMilitaryDomain ?? "ground",
    derivedSimulator: a.derivedSimulator ?? "vbs4",
    canonicalAssetKey: a.canonicalAssetKey ?? null,
  };
}

export async function loadAssets(classNames: string[]): Promise<OAsset[]> {
  if (!classNames.length) return [];
  const data = await fetchAllPages(
    client(NxgVbs4AssetCatalogue).where({ identifier: { $in: classNames } }),
    5000
  );
  return data.map(mapVbs4Asset);
}

/**
 * Load VBS4 assets for a specific canonical asset.
 *
 * The join is: NxgVbs4AssetCatalogue.dis6Code === NxgCanonicalAsset.primaryKey_
 * (i.e. the canonical asset's primary key is the DIS 6 code shared by all
 * VBS4 assets that map to it).
 *
 * @deprecated Use loadSimAssetsForCanonical(key, "vbs4"). Kept so existing
 * callers keep compiling; VBS4 is no longer the only simulator in the picture.
 */
export async function loadVbs4AssetsForCanonical(canonicalAssetKey: string): Promise<OAsset[]> {
  try {
    const data = await fetchAllPages(
      client(NxgVbs4AssetCatalogue).where({ dis6Code: { $eq: canonicalAssetKey } }),
      500
    );
    return data.map(mapVbs4Asset);
  } catch (err) {
    console.warn("[loadVbs4AssetsForCanonical] failed:", err);
    return [];
  }
}

// ── Simulator catalogues ──────────────────────────────────────────────────
//
// Each simulator joins to the canonical asset on its own key. They are NOT
// interchangeable, and getting this wrong is silent:
//
//   VBS4     dis6Code  (6-field DIS code)
//   SIMWORKS dis6Code  (6-field DIS code)
//   SWORD    disCode   (7-field — automats key on the full code; joining on
//                       SWORD's dis6Code resolves 1 row in 81)
//
// The same mapping is implemented in the Master Asset Catalogue transform,
// which is where the availability counts come from. Change one, change both.

/**
 * Load the concrete catalogue entries a canonical asset has in one simulator.
 *
 * These are the values that go in NxgUnit.simulatorIdentifierCode.
 */
export async function loadSimAssetsForCanonical(
  canonicalAssetKey: string,
  target: SimTarget,
): Promise<OSimAsset[]> {
  if (!canonicalAssetKey) return [];
  try {
    if (target === "vbs4") {
      const data = await fetchAllPages(
        client(NxgVbs4AssetCatalogue).where({ dis6Code: { $eq: canonicalAssetKey } }),
        500,
      );
      return data.map((a) => ({
        identifier: a.identifier ?? "",
        simulator: "vbs4" as const,
        canonicalAssetKey,
        displayName: a.identifier ?? "",
        description: a.description ?? "",
      }));
    }

    if (target === "simworks") {
      const data = await fetchAllPages(
        client(NxgSimworksAssetCatalogue).where({ dis6Code: { $eq: canonicalAssetKey } }),
        500,
      );
      return data.map((a) => ({
        identifier: a.identifier ?? "",
        simulator: "simworks" as const,
        canonicalAssetKey,
        displayName: a.identifier ?? "",
        description: a.description ?? "",
      }));
    }

    const data = await fetchAllPages(
      client(NxgOSwordAssetCatalogue).where({ disCode: { $eq: canonicalAssetKey } }),
      500,
    );
    return data.map((a) => ({
      identifier: a.identifier ?? "",
      simulator: "sword" as const,
      canonicalAssetKey,
      displayName: a.displayName ?? a.name ?? a.identifier ?? "",
      description: a.natureApp6 ?? "",
    }));
  } catch (err) {
    console.warn(`[loadSimAssetsForCanonical] ${target} lookup failed:`, err);
    return [];
  }
}

/** Load the entries for every target at once, preserving target order. */
export async function loadSimAssetsForTargets(
  canonicalAssetKey: string,
  targets: readonly SimTarget[],
): Promise<OSimAsset[]> {
  const results = await Promise.all(
    targets.map((t) => loadSimAssetsForCanonical(canonicalAssetKey, t)),
  );
  return results.flat();
}

// ── Reference-data loaders ────────────────────────────────────────────────
// These four tables are effectively static over a user session (canonical
// asset catalogue, unit / equipment / relationship taxonomy). They can be
// several thousand rows, and every code path that needs any of them tends
// to want ALL of them. Each loader is wrapped in a 15-minute TTL cache with
// single-flight dedupe so:
//   • Concurrent mounts of useCompositionData → ONE network call.
//   • Remounting a component within 15 min → ZERO network calls.
//   • sessionStorage backing → fresh page load in the same tab is instant.

/**
 * How many catalogue rows each simulator has for this canonical asset.
 *
 * The three counts are computed in the Master Asset Catalogue transform and
 * carried on NxgCanonicalAsset, so the asset gate costs nothing at read time.
 *
 * This used to read the properties dynamically and, when they were absent,
 * fall back to counting ~10,300 catalogue rows in the browser — because the
 * generated SDK predated them. The SDK now carries all three, so both the
 * dynamic read and the fallback are gone.
 *
 * A null count means the transform found no rows for that simulator, which is
 * the same thing as zero.
 */
function readAvailability(asset: {
  vbs4AssetCount?: number;
  swordAssetCount?: number;
  simworksAssetCount?: number;
}): AssetAvailability {
  return {
    vbs4: asset.vbs4AssetCount ?? 0,
    sword: asset.swordAssetCount ?? 0,
    simworks: asset.simworksAssetCount ?? 0,
  };
}

export async function loadCanonicalAssets(): Promise<OCanonicalAsset[]> {
  return cachedLoad(K_CANONICAL_ASSETS, async () => {
    const data = await fetchAllPages(client(NxgCanonicalAsset).where({}), 5000);

    return data.map((a) => ({
      primaryKey: a.$primaryKey,
      canonicalName: a.canonicalName ?? "",
      nationality: a.nationality ?? "",
      militaryDomain: a.militaryDomain ?? "",
      simulationClass: a.simulationClass ?? "",
      assetCategory: a.assetCategory ?? "",
      subcategory: a.subcategory ?? "",
      branch: a.branch ?? "",
      availability: readAvailability(a),
    }));
  }, { ttlMs: REFERENCE_TTL_MS });
}

/**
 * The SWORD catalogue, indexed for formation matching.
 *
 * 244 rows and static for the life of a session, so this is cached like the
 * other reference data. Used by the ORBAT skeleton generator to give each
 * generated organisation a real SWORD formation instead of leaving it blank.
 */
export async function loadSwordFormations(): Promise<SwordFormationIndex> {
  return cachedLoad(K_SWORD_FORMATIONS, async () => {
    const data = await fetchAllPages(client(NxgOSwordAssetCatalogue).where({}), 1000);
    return buildSwordFormationIndex(
      data.map((row) => ({
        identifier: row.identifier ?? "",
        displayName: row.displayName ?? row.name ?? "",
        disCode: row.disCode ?? "",
        echelonLevel: row.echelonLevel ?? "",
        // What an automat is made of, and what a unit is filled with — read
        // here so swordComposition can expand an automat without a second
        // round trip. Every numeric field on this object type is typed
        // string; the parser handles that.
        constituentUnits: row.constituentUnits ?? "",
        commandPostUnit: row.commandPostUnit ?? "",
        majorEquipmentType: row.majorEquipmentType ?? "",
        majorEquipmentCount: row.majorEquipmentCount ?? "",
        requiredCrew: row.requiredCrew ?? "",
      })),
    );
  }, { ttlMs: REFERENCE_TTL_MS });
}

/** Canonical assets indexed by primary key — the shape the eligibility checks want. */
export async function loadCanonicalAssetIndex(): Promise<Map<string, OCanonicalAsset>> {
  const assets = await loadCanonicalAssets();
  return new Map(assets.map((a) => [a.primaryKey, a]));
}

export async function loadUnitTypes(): Promise<OUnitType[]> {
  return cachedLoad(K_UNIT_TYPES, async () => {
    const data = await fetchAllPages(client(NxgUnitType).where({}), 5000);
    return data.map((t) => ({
      primaryKey: t.$primaryKey,
      unitType: t.unitType ?? "",
      abbreviatedUnitType: t.abbreviatedUnitType ?? "",
      definition: t.definition ?? "",
    }));
  }, { ttlMs: REFERENCE_TTL_MS });
}

export async function loadEquipmentTypes(): Promise<OEquipmentType[]> {
  return cachedLoad(K_EQUIPMENT_TYPES, async () => {
    const data = await fetchAllPages(client(NxgEquipmentType).where({}), 5000);
    return data.map((e) => ({
      primaryKey: e.$primaryKey,
      nomenclature: e.nomenclature ?? "",
      description: e.description ?? "",
    }));
  }, { ttlMs: REFERENCE_TTL_MS });
}

export async function loadRelationshipTypes(): Promise<ORelationshipType[]> {
  return cachedLoad(K_RELATIONSHIP_TYPES, async () => {
    const data = await fetchAllPages(client(NxgUnitHierarchyNodeRelationshipType).where({}), 5000);
    return data.map((r) => ({
      primaryKey: r.$primaryKey,
      relationshipType: r.relationshipType ?? "",
      definition: r.definition ?? "",
    }));
  }, { ttlMs: REFERENCE_TTL_MS });
}

export async function loadHierarchiesForOperation(operationKey: string): Promise<OHierarchy[]> {
  const data = await fetchAllPages(
    client(NxgUnitHierarchy).where({ operationKey: { $eq: operationKey } }),
    100
  );
  return data.map((h) => ({
    primaryKey: h.$primaryKey,
    name: h.name ?? "",
    operationKey: h.operationKey ?? null,
    validFrom: h.validFrom?.toString() ?? "",
    validTo: h.validTo ?? null,
  }));
}

// ─── Action: update symbol position ────────────────────────────────────────

export async function updateSymbolPositionFn(
  symbolPrimaryKey: string,
  latitude: number,
  longitude: number
): Promise<void> {
  await client(updateNxgTacticalGraphicSymbolPosition).applyAction({
    primaryKey: symbolPrimaryKey,
    latitude,
    longitude,
  });
}

// ─── Action: create unit ────────────────────────────────────────────────────

export async function createUnitFn(params: {
  primaryKey: string;
  unitIdentifier: string;
  militaryService: string;
  echelon: string;
  sidc: string;
  affiliation: string;
  allegiance: string;
  entityType: string;
  owningSimulator: string;
  dis: string;
  canControlDrones: boolean;
  canonicalAssetKey: string | null;
  latitude: number | null;
  longitude: number | null;
  unitTypeKey: string | null;
  equipmentTypeKey: string | null;
}): Promise<string> {
  await client(createNxgUnit).applyAction({
    primaryKey: params.primaryKey,
    unitIdentifier: params.unitIdentifier,
    militaryService: params.militaryService,
    echelon: params.echelon,
    sidc: params.sidc,
    affiliation: params.affiliation,
    allegiance: params.allegiance,
    entityType: params.entityType,
    owningSimulator: params.owningSimulator,
    dis: params.dis,
    canControlDrones: params.canControlDrones,
    canonicalAssetKey: params.canonicalAssetKey ?? null,
    latitude: params.latitude ?? null,
    longitude: params.longitude ?? null,
    unitTypeKey: params.unitTypeKey ?? null,
    equipmentTypeKey: params.equipmentTypeKey ?? null,
  });
  return params.primaryKey;
}

// ─── Action: update unit ────────────────────────────────────────────────────

export async function updateUnitFn(params: {
  primaryKey: string;
  unitIdentifier?: string;
  militaryService?: string;
  echelon?: string;
  sidc?: string;
  affiliation?: string;
  allegiance?: string;
  entityType?: string;
  owningSimulator?: string;
  dis?: string;
  canControlDrones?: boolean;
  /** @deprecated canonicalAssetKey was removed from updateNxgUnit in SDK — use dis6Code instead */
  canonicalAssetKey?: string | null;
  dis6Code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  unitTypeKey?: string | null;
  equipmentTypeKey?: string | null;
}): Promise<void> {
  await client(updateNxgUnit).applyAction({
    primaryKey: params.primaryKey,
    unitIdentifier: params.unitIdentifier,
    militaryService: params.militaryService,
    echelon: params.echelon,
    sidc: params.sidc,
    affiliation: params.affiliation,
    allegiance: params.allegiance,
    entityType: params.entityType,
    owningSimulator: params.owningSimulator,
    dis: params.dis,
    canControlDrones: params.canControlDrones,
    // canonicalAssetKey was removed from updateNxgUnit in the SDK (sdk@0.19+); use dis6Code.
    dis6Code: params.dis6Code ?? params.canonicalAssetKey ?? null,
    latitude: params.latitude,
    longitude: params.longitude,
    unitTypeKey: params.unitTypeKey,
    equipmentTypeKey: params.equipmentTypeKey,
  });
}

// ─── Action: delete unit ────────────────────────────────────────────────────

export async function deleteUnitFn(
  primaryKey: string,
  cascadeSymbol = true,
  cascadeEdges = true
): Promise<void> {
  await client(deleteNxgUnit).applyAction({ primaryKey, cascadeSymbol, cascadeEdges });
}

// ─── Action: create symbol ──────────────────────────────────────────────────

export async function createSymbolFn(params: {
  primaryKey: string;
  unitKey: string;
  sidc: string;
  latitude: number;
  longitude: number;
  directionOfMovement: number | null;
}): Promise<void> {
  await client(createNxgTacticalGraphicSymbol).applyAction({
    primaryKey: params.primaryKey,
    unitKey: params.unitKey,
    sidc: params.sidc,
    latitude: params.latitude,
    longitude: params.longitude,
    directionOfMovement: params.directionOfMovement ?? null,
  });
}

// ─── Action: delete symbol ──────────────────────────────────────────────────

export async function deleteSymbolFn(primaryKey: string): Promise<void> {
  await client(deleteNxgTacticalGraphicSymbol).applyAction({ primaryKey });
}

// ─── Action: delete edge ────────────────────────────────────────────────────

export async function deleteEdgeFn(primaryKey: string): Promise<void> {
  await client(deleteNxgUnitHierachyEdge).applyAction({ primaryKey });
}

/**
 * Create a parent → child edge in a unit hierarchy.
 *
 * Exported so the Scenario Planner can attach a placed unit's ORBAT root
 * beneath its force-level root in the scenario hierarchy. Bulk creation should
 * go through `createCompositionInOntology`, which batches.
 */
export async function createEdgeFn(params: {
  primaryKey: string;
  hierarchyKey: string;
  parentUnitKey: string;
  childUnitKey: string;
  relationshipTypeKey: string;
  validFrom: string;
  validTo?: string;
}): Promise<void> {
  await client(createNxgUnitHierachyEdge).applyAction({
    primaryKey: params.primaryKey,
    hierarchyKey: params.hierarchyKey,
    parentUnitKey: params.parentUnitKey,
    childUnitKey: params.childUnitKey,
    relationshipTypeKey: params.relationshipTypeKey,
    validFrom: params.validFrom,
    validTo: params.validTo ?? null,
  });
}

// ─── Action: create hierarchy ───────────────────────────────────────────────

export async function createHierarchyFn(params: {
  primaryKey: string;
  name: string;
  operationKey: string;
  validFrom: string;
  validTo?: string;
}): Promise<void> {
  await client(createNxgUnitHierarchy).applyAction({
    primaryKey: params.primaryKey,
    name: params.name,
    operationKey: params.operationKey,
    validFrom: params.validFrom,
    validTo: params.validTo ?? null,
  });
}

// ─── Action: update hierarchy ───────────────────────────────────────────────

export async function updateHierarchyFn(params: {
  primaryKey: string;
  name?: string;
  validFrom?: string;
  validTo?: string;
}): Promise<void> {
  await client(updateNxgUnitHierarchy).applyAction({
    primaryKey: params.primaryKey,
    name: params.name,
    validFrom: params.validFrom,
    validTo: params.validTo,
  });
}

// ─── Composition: create units, symbols, and edges in bulk ─────────────────
//
// The pure half — expanding a CompositionNode tree into rows and assigning
// primary keys — lives in ./compositionPlan so it can be unit tested without
// pulling in "@/client". Re-exported here so callers of this module are
// unaffected by the split.
export {
  isPlaceableUnit,
  collectPlaceableNodes,
  planComposition,
  type CompositionPlan,
} from "./compositionPlan";

import { planComposition } from "./compositionPlan";

export interface CompositionResult {
  rootUnitKey: string;
  createdUnitKeys: string[];
  createdSymbolKeys: string[];
  createdEdgeKeys: string[];
}

/**
 * Maximum action calls sent in one `batchApplyAction`.
 *
 * Foundry allows up to 10,000 calls per batch for a standard (non
 * function-backed) action, and treats a batch as a single group for the
 * 10,000-objects-per-submission edit limit. 500 keeps request bodies small
 * enough to stay well inside both, and bounds how much has to be rolled back
 * if a chunk fails.
 */
const ACTION_BATCH_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}


interface WrittenKeys {
  units: string[];
  symbols: string[];
  edges: string[];
}

/**
 * Best-effort compensation for a partially-written composition.
 *
 * Foundry applies a batch as one transaction, but a composition spans three
 * action types and therefore at least three transactions. There is no
 * cross-action-type transaction available from the client, so if a later phase
 * fails we undo the earlier ones in reverse dependency order. This never
 * throws: the caller is already handling a failure and a rollback error must
 * not mask it.
 */
async function rollbackComposition(written: WrittenKeys): Promise<void> {
  const orphaned: string[] = [];

  async function deleteAll(
    label: string,
    keys: string[],
    applyChunk: (keys: string[]) => Promise<unknown>,
  ): Promise<void> {
    for (const batch of chunk(keys, ACTION_BATCH_SIZE)) {
      try {
        await applyChunk(batch);
      } catch (err) {
        orphaned.push(`${batch.length} ${label}`);
        console.error(`[composition] rollback of ${batch.length} ${label} failed:`, err);
      }
    }
  }

  // Reverse dependency order: edges and symbols both reference units.
  await deleteAll("edge(s)", written.edges, (keys) =>
    client(deleteNxgUnitHierachyEdge).batchApplyAction(
      keys.map((primaryKey) => ({ primaryKey })),
    ),
  );
  await deleteAll("symbol(s)", written.symbols, (keys) =>
    client(deleteNxgTacticalGraphicSymbol).batchApplyAction(
      keys.map((primaryKey) => ({ primaryKey })),
    ),
  );
  await deleteAll("unit(s)", written.units, (keys) =>
    client(deleteNxgUnit).batchApplyAction(
      keys.map((primaryKey) => ({ primaryKey, cascadeSymbol: true, cascadeEdges: true })),
    ),
  );

  if (orphaned.length) {
    console.error(
      `[composition] rollback incomplete — possibly orphaned in the ontology: ${orphaned.join(", ")}`,
    );
  }
}

/**
 * Write a composition tree to the ontology.
 *
 * Previously this issued one `applyAction` per unit, per symbol and per edge,
 * sequentially awaited inside a recursive walk — a battalion was hundreds of
 * serial round-trips, and a failure part-way left an unrecoverable mess of
 * half-created units with no compensation path.
 *
 * Now the tree is planned in memory first, then written as three batched
 * phases (units → symbols → edges, in dependency order). That is O(nodes/500)
 * round-trips instead of O(nodes), and each phase is atomic. If a later phase
 * fails, earlier phases are rolled back before the error propagates, so the
 * caller either gets a complete ORBAT or none of one.
 */
export async function createCompositionInOntology(
  _operationKey: string,
  hierarchyKey: string,
  root: CompositionNode,
  rootLat: number,
  rootLng: number
): Promise<CompositionResult> {
  // Refuse to persist units no simulator can spawn. The UI stops most of these
  // at the point of adding, but templates, the AI generator and the Scenario
  // Planner all reach this function too, so the guard belongs here — it is the
  // one place every composition passes through. loadCanonicalAssetIndex is
  // TTL-cached, so in practice this costs nothing.
  assertCompositionEligible(root, await loadCanonicalAssetIndex());

  const plan = planComposition(hierarchyKey, root, rootLat, rootLng);

  if (!plan.units.length) {
    return { rootUnitKey: "", createdUnitKeys: [], createdSymbolKeys: [], createdEdgeKeys: [] };
  }

  const written: WrittenKeys = { units: [], symbols: [], edges: [] };

  try {
    for (const batch of chunk(plan.units, ACTION_BATCH_SIZE)) {
      await client(createNxgUnit).batchApplyAction(batch);
      written.units.push(...batch.map((p) => p.primaryKey));
    }
    for (const batch of chunk(plan.symbols, ACTION_BATCH_SIZE)) {
      await client(createNxgTacticalGraphicSymbol).batchApplyAction(batch);
      written.symbols.push(...batch.map((p) => p.primaryKey));
    }
    for (const batch of chunk(plan.edges, ACTION_BATCH_SIZE)) {
      await client(createNxgUnitHierachyEdge).batchApplyAction(batch);
      written.edges.push(...batch.map((p) => p.primaryKey));
    }
  } catch (err) {
    await rollbackComposition(written);
    // `cause` is deliberately interpolated rather than passed as ErrorOptions:
    // that overload is ES2022 and this project targets ES2020.
    throw new Error(
      `Failed to write composition "${root.unitIdentifier}" (${plan.units.length} units, ` +
        `${plan.symbols.length} symbols, ${plan.edges.length} edges) to hierarchy ${hierarchyKey}. ` +
        `Partial writes were rolled back. Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    rootUnitKey: plan.rootUnitKey,
    createdUnitKeys: written.units,
    createdSymbolKeys: written.symbols,
    createdEdgeKeys: written.edges,
  };
}

// ─── Template Orbat Graph CRUD ────────────────────────────────────────────────

export interface OHierarchyTemplate {
  primaryKey: string;
  name: string;
  echelon: string;
  description: string;
  tags: string;       // comma-separated string as stored
  createdAt: string;
  templateJson: string;
}

export async function loadHierarchyTemplates(): Promise<OHierarchyTemplate[]> {
  // Templates change more often than reference data (users can create /
  // edit them from within the app), so we use a shorter TTL and skip
  // sessionStorage — the payload is large (all template JSON) and would
  // regularly blow the 1 MB per-key soft cap in ontologyCache anyway.
  return cachedLoad(K_TEMPLATES, async () => {
    const data = await fetchAllPages(client(NxgOTemplateOrbatGraph).where({}), 500);
    return data.map((t) => ({
      primaryKey: t.$primaryKey,
      name:         t.name         ?? "",
      echelon:      t.echelon      ?? "",
      description:  t.description  ?? "",
      tags:         t.tags         ?? "",
      createdAt:    t.createdAt?.toString() ?? new Date().toISOString(),
      templateJson: t.templateJson ?? "{}",
    }));
  }, { ttlMs: 60 * 1000, skipSessionStorage: true });
}

// ─── Phase Map State ──────────────────────────────────────────────────────────
//
// Phase data is now stored in [NXG-O] Template Orbat Graph objects whose name
// follows the convention:  "{operation} - {phase} - ORBAT Template"
// and whose tags include "phase-orbat".
//
// For backwards compatibility the OPhaseMapState shape is preserved so the
// rest of the ORBAT Manager codebase requires minimal changes.  The fields map
// as follows:
//   mapStateId          → primaryKey of the NxgOTemplateOrbatGraph object
//   phaseId             → extracted from the "phase:<id>" tag, or null
//   startStateMapJson   → the templateJson (ORBAT JSON from llmPhaseToOrbat)
//   endStateMapJson     → null (no separate end-state in the new model)
//
// NOTE: this loader reads phase data from NxgOTemplateOrbatGraph records
// tagged "phase-orbat". An earlier version of this comment claimed the
// NxgPhaseMapState object type "has been removed" — that is NOT true. It is
// live, and the Scenario Planner reads and writes it through
// scenarioPlanner/hooks/usePhaseMapState.
//
// So there are two stores for a phase's map picture: NxgPhaseMapState (the
// planner's own start/end state) and these tagged Template Orbat Graph records
// (the feed this app's phase auto-ingest consumes). They overlap in content but
// have different consumers, so neither is dead code — do not delete one on the
// strength of the other existing. Consolidating them needs an owner.

export interface OPhaseMapState {
  mapStateId: string;
  phaseId: string | null;
  startStateMapJson: string | null;
  endStateMapJson: string | null;
}

/**
 * Determine whether a template record is a "phase" template by inspecting
 * its tags and name.
 *
 * A record qualifies when ANY of these are true:
 *   1. Its `tags` field contains "phase-orbat"
 *   2. Its `echelon` field equals "Phase" (sentinel value set by the service)
 *   3. Its `name` ends with " - ORBAT Template" (canonical naming convention)
 */
export function isPhaseOrbatTemplate(t: { tags: string; echelon: string; name: string }): boolean {
  if (t.tags.split(",").map((s) => s.trim()).includes("phase-orbat")) return true;
  if (t.echelon === "Phase") return true;
  if (t.name.endsWith(" - ORBAT Template")) return true;
  return false;
}

/**
 * Extract the phaseId from the tags string.
 * The Scenario Planner writes "phase:<phaseId>" into the tags when it creates
 * the template.  Returns null when not present.
 */
function phaseIdFromTags(tags: string): string | null {
  for (const tag of tags.split(",")) {
    const t = tag.trim();
    if (t.startsWith("phase:")) return t.slice("phase:".length) || null;
  }
  return null;
}

/**
 * Load phase ORBAT templates from [NXG-O] Template Orbat Graph.
 *
 * Derived from loadHierarchyTemplates() rather than a parallel fetch, which
 * would be a SECOND full-table scan of the same table. Deriving from the shared
 * cached list means zero extra network calls, and invalidating the template key
 * refreshes both views in one shot.
 */
export async function loadPhaseMapStates(): Promise<OPhaseMapState[]> {
  return cachedLoad(K_PHASE_MAP_STATES, async () => {
    const templates = await loadHierarchyTemplates();
    const results: OPhaseMapState[] = [];
    for (const t of templates) {
      if (!isPhaseOrbatTemplate({ tags: t.tags, echelon: t.echelon, name: t.name })) continue;
      results.push({
        mapStateId:        t.primaryKey,
        phaseId:           phaseIdFromTags(t.tags),
        startStateMapJson: t.templateJson ?? null,
        endStateMapJson:   null,
      });
    }
    return results;
  }, { ttlMs: 60 * 1000, skipSessionStorage: true });
}

// ── Mutation-aware cache busters ──────────────────────────────────────────
// Called from the template action wrappers so subsequent readers see fresh
// data without waiting for the TTL. Both the template list and the derived
// phase-map-state view are invalidated, because the latter is built from the
// former.
export function invalidateHierarchyTemplateCache(): void {
  invalidatePrefix(K_TEMPLATES);
  invalidatePrefix(K_PHASE_MAP_STATES);
}

/**
 * Normalise any stored createdAt value to a plain "YYYY-MM-DD" date string.
 * Strips the time portion if it was accidentally stored as a full ISO datetime.
 */
function toDateString(raw: string | undefined): string {
  if (!raw) return ontologyDate();
  return raw.slice(0, 10);
}

export async function createHierarchyTemplateFn(params: {
  name: string;
  echelon: string;
  description: string;
  tags: string;
  templateJson: string;
}): Promise<void> {
  // createdAt is a `date` property → "YYYY-MM-DD"
  await client(createNxgOtemplateOrbatGraph).applyAction({
    name:         params.name,
    echelon:      params.echelon,
    description:  params.description,
    tags:         params.tags,
    templateJson: params.templateJson,
    createdAt:    ontologyDate(),
  });
  // Bust caches so the next loadHierarchyTemplates / loadPhaseMapStates
  // call sees the row we just created instead of a stale snapshot.
  invalidateHierarchyTemplateCache();
}

export async function editHierarchyTemplateFn(params: {
  primaryKey: string;
  name: string;
  echelon: string;
  description: string;
  tags: string;
  templateJson: string;
  createdAt: string;
}): Promise<void> {
  // `NxgOTemplateOrbatGraph` param is ActionParam.ObjectType → must be passed as the object
  // fetched from the ontology (or as { $apiName, $primaryKey } specifier per OSDK docs).
  // `createdAt` is a `date` property → "YYYY-MM-DD"
  const obj = await client(NxgOTemplateOrbatGraph).fetchOne(params.primaryKey);
  await client(editNxgOtemplateOrbatGraph).applyAction({
    NxgOTemplateOrbatGraph: obj,
    name:         params.name,
    echelon:      params.echelon,
    description:  params.description,
    tags:         params.tags,
    templateJson: params.templateJson,
    createdAt:    toDateString(params.createdAt),
  });
  invalidateHierarchyTemplateCache();
}

export async function deleteHierarchyTemplateFn(primaryKey: string): Promise<void> {
  // Try fetchOne first; if that fails (e.g. 500 on certain objects), fall back to
  // querying by primaryKey_ so we always get a live object reference.
  let obj;
  try {
    obj = await client(NxgOTemplateOrbatGraph).fetchOne(primaryKey);
  } catch {
    const results = await fetchAllPages(
      client(NxgOTemplateOrbatGraph).where({ primaryKey_: { $eq: primaryKey } }),
      1,
    );
    if (!results.length) throw new Error(`Template not found: ${primaryKey}`);
    obj = results[0];
  }
  await client(deleteNxgOtemplateOrbatGraph).applyAction({
    NxgOTemplateOrbatGraph: obj,
  });
  invalidateHierarchyTemplateCache();
}

// ─── Function: generate ORBAT ───────────────────────────────────────────────

export async function callGenerateOrbat(
  operationKey: string,
  target: "vbs4" | "sword"
): Promise<string> {
  void operationKey;
  throw new Error(`generate${target === "vbs4" ? "Vbs4" : "Sword"}Orbat not yet exported by SDK.`);
}

// ─── Function: CSE validate ORBAT ──────────────────────────────────────────

export interface CseValidationError {
  type?: string;
  message?: string;
  description?: string;
  isWarning?: boolean;
  path?: string;
}

export interface CseValidationResult {
  errors: CseValidationError[];
  valid: boolean;
}

/**
 * Translates the ontology ORBAT data into the JSON payload expected by
 * cseValidateOrbat (VBS4 target) and returns the validation result.
 *
 * The payload shape mirrors what csePrep uses for its textarea-based flow:
 *   { units: [...], hierarchy: [...] }
 */
export async function callCseValidateOrbat(
  projectName: string,
  units: Map<string, OUnit>,
  edges: OEdge[],
  symbols: Map<string, OSymbol>,
): Promise<CseValidationResult> {
  // Build the orbat JSON payload
  const orbatPayload = buildVbs4OrbatPayload(units, edges, symbols);
  const orbatContent = JSON.stringify(orbatPayload);

  const raw = await (client(cseValidateOrbat as any) as any).executeFunction({
    projectName,
    orbatContent,
  });

  const result = typeof raw === "string" ? JSON.parse(raw) : raw;
  const errors: CseValidationError[] = result?.errors ?? [];
  return {
    errors,
    valid: errors.filter((e) => !e.isWarning).length === 0,
  };
}

/**
 * Builds the VBS4 ORBAT JSON payload from ontology data.
 */
export function buildVbs4OrbatPayload(
  units: Map<string, OUnit>,
  edges: OEdge[],
  symbols: Map<string, OSymbol>,
) {
  const unitList = [...units.values()].map((u) => {
    const symbol = symbols.get(u.primaryKey);
    return {
      id: u.primaryKey,
      identifier: u.unitIdentifier,
      sidc: u.sidc,
      entityType: u.entityType,
      simulatorIdentifierCode: u.simulatorIdentifierCode ?? null,
      owningSimulator: u.owningSimulator,
      dis: u.dis,
      echelon: u.echelon,
      militaryService: u.militaryService,
      affiliation: u.affiliation,
      latitude: symbol?.latitude ?? u.latitude ?? null,
      longitude: symbol?.longitude ?? u.longitude ?? null,
    };
  });

  const hierarchy = edges.map((e) => ({
    parentId: e.parentUnitKey,
    childId: e.childUnitKey,
    relationshipType: e.relationshipType,
  }));

  return { units: unitList, hierarchy };
}

/**
 * Translates a CompositionNode tree (used in the Composition Builder) into
 * the same VBS4 ORBAT payload shape, so the builder can also call
 * cseValidateOrbat without first persisting to the ontology.
 */
export function buildVbs4OrbatPayloadFromComposition(
  root: CompositionNode,
): { units: object[]; hierarchy: object[] } {
  const unitList: object[] = [];
  const hierarchy: object[] = [];

  function walk(node: CompositionNode, parentId: string | null) {
    for (let i = 0; i < Math.max(1, node.quantity); i++) {
      const id = `${node.id}${node.quantity > 1 ? `-${i}` : ""}`;
      unitList.push({
        id,
        identifier: node.quantity > 1 ? `${node.unitIdentifier} ${i + 1}` : node.unitIdentifier,
        sidc: node.sidc,
        entityType: node.entityType,
        simulatorIdentifierCode: null, // not yet persisted
        owningSimulator: node.owningSimulator,
        dis: "0.0.0.0.0.0.0",
        echelon: node.echelon,
        militaryService: node.militaryService,
        affiliation: node.affiliation,
        latitude: null,
        longitude: null,
      });
      if (parentId !== null) {
        // Matches what planComposition writes to the ontology.
        hierarchy.push({ parentId, childId: id, relationshipType: ORGANIC_RELATIONSHIP_KEY });
      }
      for (const child of node.children) {
        walk(child, id);
      }
    }
  }

  walk(root, null);
  return { units: unitList, hierarchy };
}
