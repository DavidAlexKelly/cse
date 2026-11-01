import { Client } from "@osdk/client";
import { createEditBatch, Edits, Double } from "@osdk/functions";

import {
  NxgUnit,
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

/**
 * Updates mutable properties of an existing NxgUnit.
 *
 * All parameters except primaryKey are optional — only supplied values are
 * written, so an argument left out leaves the stored property untouched.
 *
 * That was always the intent, and the body always implemented it, but every
 * parameter used to be declared `T | undefined` rather than `T?`. Those are not
 * the same thing: in TypeScript the union form is a REQUIRED parameter that
 * merely accepts the value undefined, so Foundry registered all sixteen as
 * required and the action could not be invoked without supplying every one.
 * That is why callers routed around this function through
 * reconcile_scenario_orbat instead.
 *
 * Note what this does NOT offer: there is no way to CLEAR a property here,
 * because "absent" and "set to nothing" are the same input. That is not a
 * regression — it has always been true — but it is the reason a caller that
 * needs to null a field still has to go through the reconcile path.
 *
 * Property notes (from ontology):
 *   - canonicalAssetKey is stored as dis6Code (the FK that drives the
 *     NxgUnit → NxgCanonicalAsset link)
 *   - affiliation must match the ontology oneOf values (e.g. "Friend", not "FRIEND")
 *   - militaryService and echelon also have ontology oneOf constraints
 */
async function updateNxgUnit(
  client: Client,
  primaryKey: string,
  unitIdentifier?: string,
  militaryService?: string,
  echelon?: string,
  sidc?: string,
  affiliation?: string,
  allegiance?: string,
  entityType?: string,
  owningSimulator?: string,
  dis?: string,
  canControlDrones?: boolean,
  canonicalAssetKey?: string,
  latitude?: Double,
  longitude?: Double,
  unitTypeKey?: string,
  equipmentTypeKey?: string,
  simulatorIdentifierCode?: string
): Promise<Edits.Object<NxgUnit>[]> {
  const unit = await client(NxgUnit)
    .fetchOne(primaryKey)
    .catch(() => undefined);
  if (unit === undefined) {
    throw new Error(`NxgUnit "${primaryKey}" does not exist`);
  }

  // present(), not `!== undefined`. The Actions API prefills every unset
  // optional with explicit null, so once these parameters became genuinely
  // optional a null-blind check would hand null to each validator and then
  // write it over a live value.
  if (present(affiliation)) assertValidAffiliation(affiliation);
  if (present(entityType)) assertValidEntityType(entityType);
  if (present(militaryService)) assertValidMilitaryService(militaryService);
  if (present(echelon)) assertValidEchelon(echelon);
  if (present(latitude)) assertValidLatitude(latitude);
  if (present(longitude)) assertValidLongitude(longitude);

  if (present(allegiance) && allegiance.length > 3) {
    throw new Error(
      `Allegiance must be a 3-letter nation code (e.g. GBR). Got: "${allegiance}"`
    );
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
  // dis6Code is the FK to NxgCanonicalAsset and the ontology describes it as
  // derived from the catalogue via simulatorIdentifierCode — but nothing
  // derived it, so units ended up carrying a real simulator asset and still
  // resolving to no canonical asset. Doing it here covers every caller, not
  // just the ORBAT Manager.
  //
  // Only when the caller has not set the asset explicitly, and only when the
  // unit has no link yet or the model is actually changing — so an operator
  // who deliberately set a different canonical asset keeps it, while changing
  // the model keeps the asset honest rather than letting the two disagree.
  let derivedDis6Code: string | undefined;
  if (!present(canonicalAssetKey) && present(simulatorIdentifierCode)) {
    const currentDis6Code = unit.dis6Code ?? "";
    const modelChanged = simulatorIdentifierCode !== (unit.simulatorIdentifierCode ?? "");
    if (!currentDis6Code || modelChanged) {
      derivedDis6Code = await deriveDis6Code(client, simulatorIdentifierCode);
      if (derivedDis6Code !== undefined) {
        // Never write a key that is not in the catalogue; leaving it unset is
        // better than a dangling link, and the gap is reported by preflight.
        const derivedAsset = await client(NxgCanonicalAsset)
          .fetchOne(derivedDis6Code)
          .catch(() => undefined);
        if (derivedAsset === undefined) derivedDis6Code = undefined;
      }
    }
  }

  const batch = createEditBatch<Edits.Object<NxgUnit>>(client);

  batch.update(unit, {
    ...(present(derivedDis6Code) && { dis6Code: derivedDis6Code }),
    ...(present(unitIdentifier) && { unitIdentifier }),
    ...(present(militaryService) && { militaryService }),
    ...(present(echelon) && { echelon }),
    ...(present(sidc) && { sidc }),
    ...(present(affiliation) && { affiliation }),
    ...(present(allegiance) && { allegiance }),
    ...(present(entityType) && { entityType }),
    ...(present(owningSimulator) && { owningSimulator }),
    ...(present(dis) && { dis }),
    ...(present(canControlDrones) && { canControlDrones }),
    // dis6Code is the FK column that drives the NxgCanonicalAsset link
    ...(present(canonicalAssetKey) && { dis6Code: canonicalAssetKey }),
    ...(present(latitude) && { latitude }),
    ...(present(longitude) && { longitude }),
    ...(present(unitTypeKey) && { unitTypeKey }),
    ...(present(equipmentTypeKey) && { equipmentTypeKey }),
    ...(present(simulatorIdentifierCode) && { simulatorIdentifierCode }),
  });

  return batch.getEdits();
}

export default updateNxgUnit;
