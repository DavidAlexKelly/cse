/**
 * Shared validation helpers for NXG ontology edit functions.
 */

import { Client } from "@osdk/client";
import { Double } from "@osdk/functions";
import {
  NxgOSwordAssetCatalogue,
  NxgSimworksAssetCatalogue,
  NxgVbs4AssetCatalogue,
} from "@ontology/sdk";

export const VALID_ENTITY_TYPES = [
  "organisation",
  "vehicle",
  "human",
  "aircraft",
] as const;

// Matches the ontology oneOf constraint on NxgUnit.affiliation
export const VALID_AFFILIATIONS = [
  "Friend",
  "Hostile",
  "Neutral",
  "Unknown",
  "Suspect",
  "Assumed Friend",
  "Pending",
  "Faker",
  "Joker",
  "Exercise Friend",
  "Exercise Neutral",
  "Exercise Unknown",
  "Exercise Assumed Friend",
  "Exercise Pending",
] as const;

// Matches the ontology oneOf constraint on NxgUnit.militaryService
export const VALID_MILITARY_SERVICES = [
  "Army",
  "Navy",
  "Air Force",
  "Marines",
  "Coast Guard",
  "Joint",
  "Space Force",
  "Airborne Force",
  "Special Operations Force",
  "Air Defense Force",
  "Rocket Force",
  "Logistics Service",
  "Medical Service",
  "Military Police",
  "Border Guard",
  "Cyber Force",
  "Other",
] as const;

// Matches the ontology oneOf constraint on NxgUnit.echelon
export const VALID_ECHELONS = [
  "Squad",
  "Section",
  "Team",
  "Crew",
  "Detachment",
  "Platoon",
  "Troop",
  "Battery",
  "Company",
  "Flight",
  "Vessel",
  "Battalion",
  "Squadron",
  "Regiment",
  "Brigade",
  "Group",
  "Wing",
  "Division",
  "Corps",
  "Army",
  "Army Group",
  "Fleet",
  "Air Force",
  "Command",
  "Component Command",
  "Combatant Command",
  "Region",
  "Other",
] as const;

export const VALID_SIMULATORS = ["Vbs4", "Simworks", "sword", "none"] as const;

/**
 * True when an optional argument was actually supplied.
 *
 * Absence reaches these functions in two spellings. A caller that omits an
 * argument gives `undefined`; the Actions API gives explicit `null`, because it
 * prefills every unset optional parameter rather than leaving it off. Both mean
 * "not provided", and the distinction matters more here than it usually would:
 * these functions decide whether to WRITE a property by testing whether its
 * argument is present, so treating null as a supplied value would overwrite
 * live data with null and run the validators against it.
 *
 * Deliberately a strict null/undefined test and NOT a truthiness test. Several
 * of these parameters have falsy values that are entirely meaningful —
 * canControlDrones: false, latitude: 0, longitude: 0, directionOfMovement: 0 —
 * and truthiness would silently discard every one of them.
 *
 * Written as a type guard so the narrowed value can go straight into the
 * assertValid* helpers and into an edit.
 */
export function present<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

/**
 * True when an optional date argument was supplied and is not blank.
 *
 * Dates get a third spelling of "absent" that the others don't: the empty
 * string, from a form field that was rendered but never filled in. "" is not a
 * date and must not reach assertValidIsoDate, which would reject it as
 * malformed rather than read it as "no date given".
 */
export function presentDate(value: string | null | undefined): value is string {
  return present(value) && value !== "";
}

export function assertValidEntityType(value: string): void {
  if (!VALID_ENTITY_TYPES.includes(value as never)) {
    throw new Error(
      `Invalid entityType "${value}". ` +
        `Must be one of: ${VALID_ENTITY_TYPES.join(", ")}`
    );
  }
}

export function assertValidAffiliation(value: string): void {
  if (!VALID_AFFILIATIONS.includes(value as never)) {
    throw new Error(
      `Invalid affiliation "${value}". ` +
        `Must be one of: ${VALID_AFFILIATIONS.join(", ")}`
    );
  }
}

export function assertValidMilitaryService(value: string): void {
  if (!VALID_MILITARY_SERVICES.includes(value as never)) {
    throw new Error(
      `Invalid militaryService "${value}". ` +
        `Must be one of: ${VALID_MILITARY_SERVICES.join(", ")}`
    );
  }
}

export function assertValidEchelon(value: string): void {
  if (!VALID_ECHELONS.includes(value as never)) {
    throw new Error(
      `Invalid echelon "${value}". ` +
        `Must be one of: ${VALID_ECHELONS.join(", ")}`
    );
  }
}

export function assertValidLatitude(value: Double): void {
  if (value < -90 || value > 90) {
    throw new Error(`Latitude must be between -90 and 90. Got: ${value}`);
  }
}

export function assertValidLongitude(value: Double): void {
  if (value < -180 || value > 180) {
    throw new Error(`Longitude must be between -180 and 180. Got: ${value}`);
  }
}

/**
 * Work out a unit's canonical asset key from the simulator model chosen for it.
 *
 * NxgUnit.dis6Code is the foreign key to NxgCanonicalAsset, and its own
 * description says it is "derived from the VBS4 Asset Catalogue via the
 * simulatorIdentifierCode link" — but nothing derived it. The result was 31
 * units that carried a perfectly good simulator asset and still showed as
 * having none, because every consumer resolves the asset through the canonical
 * link rather than through the identifier.
 *
 * Deriving it here rather than in the app means every caller gets it: the ORBAT
 * Manager, Workshop, the OSDK, and any import that writes units directly. The
 * app-side fix only covered units the app itself created.
 *
 * Each catalogue joins on its own key — VBS4 and SIMWORKS on dis6Code, SWORD
 * automats on the 7-field disCode. Returns undefined when the identifier
 * matches nothing, in which case the caller should leave dis6Code alone: a
 * guessed link is worse than no link, and createNxgUnit/updateNxgUnit validate
 * the value against NxgCanonicalAsset anyway.
 */
export async function deriveDis6Code(
  client: Client,
  simulatorIdentifierCode: string | undefined
): Promise<string | undefined> {
  const identifier = (simulatorIdentifierCode ?? "").trim();
  if (!identifier) return undefined;

  const vbs4 = await client(NxgVbs4AssetCatalogue)
    .where({ identifier: { $eq: identifier } })
    .fetchPage({ $pageSize: 1 })
    .catch(() => undefined);
  const vbs4Code = vbs4?.data?.[0]?.dis6Code;
  if (vbs4Code) return vbs4Code;

  const simworks = await client(NxgSimworksAssetCatalogue)
    .where({ identifier: { $eq: identifier } })
    .fetchPage({ $pageSize: 1 })
    .catch(() => undefined);
  const simworksCode = simworks?.data?.[0]?.dis6Code;
  if (simworksCode) return simworksCode;

  // SWORD automats key on the full 7-field code; dis6code on that object holds
  // something else entirely, so disCode is the only correct field here.
  const sword = await client(NxgOSwordAssetCatalogue)
    .where({ identifier: { $eq: identifier } })
    .fetchPage({ $pageSize: 1 })
    .catch(() => undefined);
  const swordCode = sword?.data?.[0]?.disCode;
  if (swordCode) return swordCode;

  return undefined;
}

export function assertValidIsoDate(value: string, fieldName: string): void {
  const isValid =
    value.length === 10 &&
    value[4] === "-" &&
    value[7] === "-" &&
    !isNaN(Number(value.slice(0, 4))) &&
    !isNaN(Number(value.slice(5, 7))) &&
    !isNaN(Number(value.slice(8, 10)));

  if (!isValid) {
    throw new Error(
      `${fieldName} must be a valid ISO date (YYYY-MM-DD). Got: "${value}"`
    );
  }
}
