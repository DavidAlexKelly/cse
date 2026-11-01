// ============================================================
//  Asset Manager — TypeScript Data Model
// ============================================================

/** Flat representation of a NxgCanonicalAsset OSDK object */
export interface CanonicalAsset {
  primaryKey: string;
  canonicalName: string | null;
  militaryDomain: string | null;
  nationality: string | null;
  assetCategory: string | null;
  simulationClass: string | null;
  branch: string | null;
  /** New ontology field — asset sub-classification beneath assetCategory */
  subcategory: string | null;
}

/** Flat representation of a NxgVbs4AssetCatalogue OSDK object */
export interface Vbs4Asset {
  identifier: string;
  classType: string | null;
  domain: string | null;
  description: string | null;
  nationality: string | null;
  isDrone: boolean | null;
  derivedSimulator: string | null;
  derivedMilitaryDomain: string | null;
  canonicalAssetKey: string | null;
  branch: string | null;
  variant: string | null;
  simulationClass: string | null;
  disCode: string | null;
  /** DIS version 6 entity type code */
  dis6Code: string | null;
  hasCommander: boolean | null;
  gunnerSeatCount: number | null;
  gunnerSeatNames: string | null;
  gunnerSeatTurretIds: string | null;
  numCargoSeats: number | null;
  crewClass: string | null;
  previewImage: string | null;
  vbsCode: string | null;
  /** Native VBS4 simulator identifier string */
  simulator: string | null;
  /** NATO APP-6 / MIL-STD-2525 symbol identification code */
  sidc: string | null;
  /** Traceability field — where the DIS code was sourced from */
  disCodeSource: string | null;
  /** AI/synthesis notes explaining how the DIS code was derived */
  disCodeSynthesisNote: string | null;
}

/** Flat representation of a NxgSimworksAssetCatalogue OSDK object.
 *  Simworks is the second simulator, alongside VBS4 and MASA Sword. */
export interface SimworksAsset {
  identifier: string;
  simulator: string | null;
  simulationClass: string | null;
  simworksClass: string | null;
  simworksClassLabel: string | null;
  assetCategory: string | null;
  militaryDomain: string | null;
  nationality: string | null;
  description: string | null;
  disCode: string | null;
  dis6Code: string | null;
  disKind: string | null;
  disKindLabel: string | null;
  disDomain: string | null;
  disDomainLabel: string | null;
  disCategory: string | null;
  disCategoryLabel: string | null;
  disCountry: string | null;
  disCountryLabel: string | null;
  hasWeapons: boolean | null;
  hasSensors: boolean | null;
  hasIff: boolean | null;
  hasEmissions: boolean | null;
  hasCatapult: boolean | null;
  hasArrestingWires: boolean | null;
  isDeployable: boolean | null;
  maxSpeedMs: string | null;
  maxHealthPoints: string | null;
  maxSensorRangeM: number | null;
  sensorNames: string | null;
  defaultSide: string | null;
  recordTypes: string | null;
  movementTypes: string | null;
}

/** Flat representation of a NxgOSwordAssetCatalogue OSDK object.
 *  Sword is MASA's constructive simulation platform, the third simulator. */
export interface SwordAsset {
  identifier: string;
  name: string | null;
  displayName: string | null;
  country: string | null;
  domain: string | null;
  category: string | null;
  kind: string | null;
  level: string | null;
  echelonLevel: string | null;
  sidc: string | null;
  natureApp6: string | null;
  disCode: string | null;
  dis6code: string | null;
  entityType: string | null;
  isGroup: boolean | null;
  combatEfficiency: string | null;
  reconEfficiency: string | null;
  requiredCrew: string | null;
  majorEquipmentType: string | null;
  majorEquipmentCount: string | null;
  minUnits: string | null;
  maxUnits: string | null;
  constituentUnits: string | null;
  commandPostUnit: string | null;
  equipmentIndex: string | null;
  automatType: string | null;
  automatIdentity: string | null;
  dataSet: string | null;
  disSource: string | null;
}

/** Flat representation of a NxgUnitType OSDK object */
export interface UnitType {
  primaryKey: string;
  unitType: string | null;
  abbreviatedUnitType: string | null;
  definition: string | null;
}

/** Flat representation of a NxgEquipmentType OSDK object */
export interface EquipmentType {
  primaryKey: string;
  nomenclature: string | null;
  description: string | null;
}

/** Flat representation of a NxgUnit OSDK object (fields needed for mismatch checks) */
export interface UnitRef {
  primaryKey: string;
  unitIdentifier: string | null;
  simulatorIdentifierCode: string | null;
  /**
   * dis6Code on the unit is the FK to NxgCanonicalAsset (via the
   * NxgCanonicalAsset → NxgUnit link: canonicalAsset.primaryKey → unit.dis6Code).
   * Previously read as canonicalAssetKey but that property does not exist on
   * NxgUnit in the current ontology.
   */
  canonicalAssetKey: string | null; // populated from obj.dis6Code
  /** Which simulator owns/spawns this unit */
  owningSimulator: string | null;
  /** NATO affiliation (Friend, Hostile, Neutral, …) */
  affiliation: string | null;
  /** Allegiance country */
  allegiance: string | null;
  /** Military service branch */
  militaryService: string | null;
  /** Echelon (Platoon, Company, Battalion, …) */
  echelon: string | null;
}

// ─── Mismatch / quality issue types ──────────────────────────────────────────

export type MismatchSeverity = "error" | "warning" | "info";

export type MismatchCategory =
  // ── Simulator ↔ canonical mapping ───────────────────────────────────────
  | "orphan_vbs4" // VBS4 entry has no dis6Code / broken canonical link
  | "orphan_simworks" // Simworks entry has no dis6Code / broken canonical link
  | "orphan_sword" // Sword entry has no dis6Code / broken canonical link
  | "unmapped_canonical" // Canonical asset with NO simulator model in any simulator
  | "single_simulator_only" // Canonical mapped in only 1 of 3 simulators (info)
  // ── Cross-simulator agreement ───────────────────────────────────────────
  | "cross_sim_disagreement" // Same canonical → different DIS/domain/nationality across simulators
  // ── Simulator internal quality ──────────────────────────────────────────
  | "domain_mismatch" // sim entry domain ≠ canonical militaryDomain
  | "nationality_mismatch" // sim entry nationality ≠ canonical nationality
  | "missing_crew_config" // VBS4 has no commander / gunner / cargo seats
  | "missing_dis_code" // Any sim entry has no disCode
  | "missing_dis6" // Any sim entry has no dis6Code (breaks canonical link)
  | "duplicate_sim_class" // Multiple entries in a simulator share simulationClass
  | "branch_inconsistency" // canonical branch vs sim domain/classType clash
  | "drone_flag_mismatch" // VBS4 isDrone ≠ canonical assetCategory
  // ── Unit ↔ simulator wiring ─────────────────────────────────────────────
  | "dead_unit_reference" // unit.simulatorIdentifierCode → no matching sim entry
  | "unit_missing_sim_code" // unit has owningSimulator but no simulatorIdentifierCode
  | "unit_sim_owner_mismatch" // owningSimulator says X but simulatorIdentifierCode belongs to Y
  | "unit_broken_canonical" // unit.dis6Code (FK) → non-existent canonical asset
  // ── Catalogue usage ─────────────────────────────────────────────────────
  | "unused_vbs4" // VBS4 entry never referenced by a unit
  | "unused_simworks" // Simworks entry never referenced by a unit
  | "unused_sword"; // Sword entry never referenced by a unit

export interface MismatchRecord {
  id: string;
  category: MismatchCategory;
  severity: MismatchSeverity;
  /** Short headline shown in the list */
  title: string;
  /** One or two sentences explaining the specific issue */
  detail: string;
  /** Primary key of the affected object */
  affectedKey: string;
  affectedType: "canonical" | "vbs4" | "simworks" | "sword" | "unit";
  /**
   * Which simulator (if any) this issue relates to. Used by the UI to
   * badge cross-simulator vs simulator-internal issues.
   */
  simulator?: "vbs4" | "simworks" | "sword" | "cross" | "none";
  /**
   * The best identifier to pass to orbatAuditSingle.
   * For units: unitIdentifier. For vbs4/canonical: the entity identifier/primaryKey.
   * Populated at mismatch-derivation time so every record has one.
   */
  auditId: string;
}

// ─── Inventory counts for the overview panel ─────────────────────────────────

export interface InventoryCounts {
  totalCanonical: number;
  totalVbs4: number;
  totalSimworks: number;
  totalSword: number;
  totalUnitTypes: number;
  totalEquipmentTypes: number;
  mappedCanonical: number;
  unmappedCanonical: number;
  orphanVbs4: number;
  byDomain: Record<string, { mapped: number; unmapped: number }>;
  byNationality: Record<
    string,
    { canonical: number; mapped: number; unmapped: number }
  >;
  droneCount: number;
  mismatchCount: number;
}

// ─── Nav view identifiers ─────────────────────────────────────────────────────

export type ActiveView =
  | "inventory"
  | "categoryBrowser"
  | "vbs4"
  | "simworks"
  | "sword"
  | "disReference"
  | "sidcReference"
  | "mismatches";

/** Carries a navigation destination and an optional mismatch category to pre-expand */
export interface NavTarget {
  view: ActiveView;
  /** If set, the Mismatch Report will auto-expand this category on arrival */
  mismatchCategory?: MismatchCategory;
}
