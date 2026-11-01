import { Client } from "@osdk/client";
import { createEditBatch, Edits, Double } from "@osdk/functions";

import {
  NxgUnit,
  NxgTacticalGraphicSymbol,
  NxgUnitHierachyEdge,
  NxgCanonicalAsset,
  NxgUnitType,
  NxgEquipmentType,
} from "@ontology/sdk";

import {
  assertValidEntityType,
  assertValidAffiliation,
  assertValidMilitaryService,
  assertValidEchelon,
  assertValidLatitude,
  assertValidLongitude,
  deriveDis6Code,
  present,
} from "../helpers.js";

type NxgUnitEdit =
  | Edits.Object<NxgUnit>
  | Edits.Object<NxgTacticalGraphicSymbol>
  | Edits.Object<NxgUnitHierachyEdge>;

/**
 * Creates a new NxgUnit object.
 *
 * Called by the Composition Builder during placement to stamp out
 * each node in the composition tree as a real ontology object.
 *
 * Property notes (from ontology):
 *   - canonicalAssetKey links via NxgUnit.dis6Code → NxgCanonicalAsset.primaryKey_
 *   - unitTypeKey links via NxgUnit.unitTypeKey → NxgUnitType.primaryKey_
 *   - equipmentTypeKey links via NxgUnit.equipmentTypeKey → NxgEquipmentType.primaryKey_
 *   - affiliation must match the ontology oneOf values (e.g. "Friend", not "FRIEND")
 *   - militaryService and echelon also have ontology oneOf constraints
 *
 * The last six parameters are declared `T?`, not `T | undefined`. The union
 * form is a REQUIRED parameter that merely accepts the value undefined, so
 * Foundry registered all six as required and a caller could not create a unit
 * without supplying a canonical asset, a position, a unit type, an equipment
 * type and a simulator model — none of which a unit necessarily has.
 */
async function createNxgUnit(
  client: Client,
  primaryKey: string,
  unitIdentifier: string,
  militaryService: string,
  echelon: string,
  sidc: string,
  affiliation: string,
  allegiance: string,
  entityType: string,
  owningSimulator: string,
  dis: string,
  canControlDrones: boolean,
  canonicalAssetKey?: string,
  latitude?: Double,
  longitude?: Double,
  unitTypeKey?: string,
  equipmentTypeKey?: string,
  simulatorIdentifierCode?: string
): Promise<NxgUnitEdit[]> {
  assertValidEntityType(entityType);
  assertValidAffiliation(affiliation);
  assertValidMilitaryService(militaryService);
  assertValidEchelon(echelon);

  if (allegiance && allegiance.length > 3) {
    throw new Error(
      `Allegiance must be a 3-letter nation code (e.g. GBR). Got: "${allegiance}"`
    );
  }

  // present(), not `!== undefined` — the Actions API prefills unset optionals
  // with explicit null, and a strict-undefined check would hand null to these
  // validators. present() is a null/undefined test rather than a truthiness
  // test precisely so that latitude 0 and longitude 0 still count as supplied.
  if (present(latitude)) assertValidLatitude(latitude);
  if (present(longitude)) assertValidLongitude(longitude);

  const existing = await client(NxgUnit)
    .fetchOne(primaryKey)
    .catch(() => undefined);
  if (existing !== undefined) {
    throw new Error(`NxgUnit with primaryKey "${primaryKey}" already exists`);
  }

  // canonicalAssetKey is the PK of NxgCanonicalAsset;
  // it links to NxgUnit via the dis6Code property.
  if (present(canonicalAssetKey)) {
    const asset = await client(NxgCanonicalAsset)
      .fetchOne(canonicalAssetKey)
      .catch(() => undefined);
    if (asset === undefined) {
      throw new Error(
        `canonicalAssetKey "${canonicalAssetKey}" does not exist in NxgCanonicalAsset`
      );
    }
  }

  if (present(unitTypeKey)) {
    const unitType = await client(NxgUnitType)
      .fetchOne(unitTypeKey)
      .catch(() => undefined);
    if (unitType === undefined) {
      throw new Error(
        `unitTypeKey "${unitTypeKey}" does not exist in NxgUnitType`
      );
    }
  }

  if (present(equipmentTypeKey)) {
    const equipmentType = await client(NxgEquipmentType)
      .fetchOne(equipmentTypeKey)
      .catch(() => undefined);
    if (equipmentType === undefined) {
      throw new Error(
        `equipmentTypeKey "${equipmentTypeKey}" does not exist in NxgEquipmentType`
      );
    }
  }

  // ── Derive the canonical asset link from the chosen model ───────────────
  //
  // When a caller gives a simulator model but no asset, work the asset out
  // from the catalogue rather than creating a unit that carries a model and
  // resolves to nothing. See deriveDis6Code; the same derivation runs in
  // updateNxgUnit, so every path into the ontology behaves the same way.
  let resolvedAssetKey = canonicalAssetKey;
  if (!present(resolvedAssetKey) && present(simulatorIdentifierCode)) {
    const derived = await deriveDis6Code(client, simulatorIdentifierCode);
    if (derived !== undefined) {
      // Only if it is really in the catalogue — a dangling FK is worse than
      // an absent one, and preflight reports the absence.
      const derivedAsset = await client(NxgCanonicalAsset)
        .fetchOne(derived)
        .catch(() => undefined);
      if (derivedAsset !== undefined) resolvedAssetKey = derived;
    }
  }

  const batch = createEditBatch<NxgUnitEdit>(client);

  batch.create(NxgUnit, {
    primaryKey_: primaryKey,
    unitIdentifier,
    militaryService,
    echelon,
    sidc,
    affiliation,
    allegiance,
    entityType,
    owningSimulator,
    dis,
    canControlDrones,
    // dis6Code is the FK column that drives the NxgCanonicalAsset link —
    // either as given, or derived from the simulator model above.
    ...(present(resolvedAssetKey) && { dis6Code: resolvedAssetKey }),
    ...(present(latitude) && { latitude }),
    ...(present(longitude) && { longitude }),
    ...(present(unitTypeKey) && { unitTypeKey }),
    ...(present(equipmentTypeKey) && { equipmentTypeKey }),
    ...(present(simulatorIdentifierCode) && { simulatorIdentifierCode }),
  });

  return batch.getEdits();
}

export default createNxgUnit;
