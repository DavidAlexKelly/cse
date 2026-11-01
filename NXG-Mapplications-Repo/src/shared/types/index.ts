// src/shared/types/index.ts
//
// Canonical domain model for ORBAT / ontology data. Import it as
// `@/shared/types`; do not add a second copy or a re-export alias.

// ─── Ontology types ────────────────────────────────────────────────────────
export interface OUnit {
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
  simulatorIdentifierCode: string | null;
  latitude: number | null;
  longitude: number | null;
  unitTypeKey: string | null;
  equipmentTypeKey: string | null;
}

export interface OEdge {
  primaryKey: string;
  childUnitKey: string;
  parentUnitKey: string;
  relationshipType: string;
}

export interface OSymbol {
  primaryKey: string;
  sidc: string;
  unitKey: string;
  latitude: number | null;
  longitude: number | null;
  directionOfMovement: number | null;
}

export interface OOperation {
  primaryKey: string;
  startTime: string;
  endTime: string | null;
  terrainName: string | null;
}

// ─── Simulator targets & asset availability ────────────────────────────────
//
// A canonical asset is an abstraction; it can only be put into an exercise if
// some simulator has a concrete entry for it. `AssetAvailability` is how many
// entries each simulator has, and it is the basis of every "can this unit be
// added?" decision in the app — see shared/orbat/assetEligibility.ts.

/** The simulators the platform federates. Values match NxgUnit.owningSimulator (normalised). */
export type SimTarget = "vbs4" | "sword" | "simworks";

export const SIM_TARGETS: readonly SimTarget[] = ["vbs4", "sword", "simworks"] as const;

export const SIM_TARGET_LABELS: Record<SimTarget, string> = {
  vbs4: "VBS4",
  sword: "SWORD",
  simworks: "SIMWORKS",
};

/** Count of catalogue entries per simulator that resolve to a canonical asset. */
export type AssetAvailability = Record<SimTarget, number>;

export const NO_AVAILABILITY: AssetAvailability = { vbs4: 0, sword: 0, simworks: 0 };

export interface OCanonicalAsset {
  primaryKey: string;
  canonicalName: string;
  nationality: string;
  militaryDomain: string;
  simulationClass: string;
  assetCategory: string;
  /** Narrower classification within assetCategory — the second cascading filter. */
  subcategory: string;
  branch: string;
  /**
   * How many entries each simulator has for this asset.
   *
   * Sourced from the vbs4AssetCount / swordAssetCount / simworksAssetCount
   * columns on the Master Asset Catalogue, which are computed on exactly the
   * keys the ontology catalogue links use — so a non-zero count means the link
   * resolves. Defaults to NO_AVAILABILITY when the generated SDK predates
   * those properties; loadCanonicalAssets() backfills in that case.
   */
  availability: AssetAvailability;
}

/**
 * One concrete entry in a simulator's asset catalogue (VBS4 / SWORD / SIMWORKS).
 *
 * `identifier` is the value written to NxgUnit.simulatorIdentifierCode, which
 * is the FK the simulator export resolves. Do NOT put it in equipmentTypeKey:
 * that is the FK to NxgEquipmentType (real-world nomenclature), and pointing it
 * at a catalogue identifier produces a dangling link.
 */
export interface OSimAsset {
  identifier: string;
  simulator: SimTarget;
  canonicalAssetKey: string | null;
  displayName: string;
  description: string;
}

export interface OUnitType {
  primaryKey: string;
  unitType: string;
  abbreviatedUnitType: string;
  definition: string;
}

export interface OEquipmentType {
  primaryKey: string;
  nomenclature: string;
  description: string;
}

export interface OHierarchy {
  primaryKey: string;
  name: string;
  operationKey: string | null;
  validFrom: string;
  validTo: string | null;
}

export interface ORelationshipType {
  primaryKey: string;
  relationshipType: string;
  definition: string;
}

// ─── Composition Builder types ─────────────────────────────────────────────
// A node in the composition being built — lives only in local state
export interface CompositionNode {
  id: string;                        // local uuid
  unitIdentifier: string;
  echelon: string;
  sidc: string;
  entityType: "organisation" | "vehicle" | "human" | "aircraft";
  militaryService: string;
  affiliation: string;
  allegiance: string;
  owningSimulator: string;
  canonicalAssetKey: string | null;
  /**
   * The chosen simulator catalogue entry (VBS4 / SWORD / SIMWORKS identifier).
   *
   * Persisted to NxgUnit.simulatorIdentifierCode. Until this is set the unit
   * is not instantiable: canonicalAssetKey says *what* it is, this says which
   * concrete model the simulator should spawn.
   */
  simulatorIdentifierCode: string | null;
  unitTypeKey: string | null;
  equipmentTypeKey: string | null;
  quantity: number;                  // how many of this node to stamp out
  children: CompositionNode[];
}

// A saved composition template
export interface CompositionTemplate {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  root: CompositionNode;
}

// ─── Simulator config types ────────────────────────────────────────────────
export interface OVbs4Config {
  className: string;
  role: string;
  isDrone: boolean;
  gunnerSeat: { turretIdentifier: string; name: string };
  sensorStreamingSettings: { enabled: boolean; host: string; port: number };
  streamingSettings: {
    host: string; port: number; framerate: number;
    bitrate: number; width: number; height: number; fieldOfView: number;
  };
}

export interface OSwordConfig {
  controllable: boolean;
  class: string | null;
}

export interface OSimulatorConfig {
  unitKey: string;
  entityType: "organisation" | "vehicle" | "human" | "aircraft";
  owningSimulator: string;
  dis: string;
  canControlDrones: boolean;
  vbs4: OVbs4Config | null;
  sword: OSwordConfig | null;
}

export interface OAsset {
  identifier: string;
  description: string;
  domain: string;
  classType: string;
  isDrone: boolean;
  derivedMilitaryDomain: string;
  derivedSimulator: string;
  canonicalAssetKey: string | null;
}

// ─── UI state types ────────────────────────────────────────────────────────
export type ValidationSeverity = "ERROR" | "WARNING";

export interface ValidationIssue {
  unitKey: string;
  severity: ValidationSeverity;
  code: string;
  message: string;
}

export interface TreeNode {
  unitKey: string;
  children: TreeNode[];
}

export interface WorkshopState {
  operationKey: string;
  positionOverrides: Record<string, { lat: number; lng: number }>;
}

// ─── ORBAT Builder — echelon & symbol types ────────────────────────────────

export type EchelonLevel =
  | "team"
  | "squad"
  | "section"
  | "platoon"
  | "company"
  | "battalion"
  | "regiment"
  | "brigade"
  | "division"
  | "corps"
  | "army"
  | "armyGroup"
  | "theatre";

export type UnitIconType =
  | "infantry"
  | "armour"
  | "mechanisedInfantry"
  | "artillery"
  | "rocketArtillery"
  | "mortar"
  | "aviation"
  | "airForce"
  | "reconnaissance"
  | "cavalry"
  | "engineer"
  | "pioneer"
  | "signals"
  | "cyber"
  | "ew"
  | "logistics"
  | "maintenance"
  | "medical"
  | "airDefence"
  | "specialForces"
  | "sniper"
  | "antiTank"
  | "naval"
  | "cbrn"
  | "military_police"
  | "headquarters"
  | "generic";

export const ECHELON_ORDER: EchelonLevel[] = [
  "team", "squad", "section", "platoon", "company",
  "battalion", "regiment", "brigade", "division", "corps",
  "army", "armyGroup", "theatre",
];

export const ECHELON_LABELS: Record<EchelonLevel, string> = {
  team:      "Team",
  squad:     "Squad",
  section:   "Section",
  platoon:   "Platoon",
  company:   "Company/Battery/Troop",
  battalion: "Battalion/Squadron",
  regiment:  "Regiment",
  brigade:   "Brigade",
  division:  "Division",
  corps:     "Corps",
  army:      "Army",
  armyGroup: "Army Group",
  theatre:   "Theatre",
};

export const ECHELON_SHORT: Record<EchelonLevel, string> = {
  team:      "Team",
  squad:     "Squad",
  section:   "Section",
  platoon:   "Platoon",
  company:   "Company",
  battalion: "Battalion",
  regiment:  "Regiment",
  brigade:   "Brigade",
  division:  "Division",
  corps:     "Corps",
  army:      "Army",
  armyGroup: "Army Group",
  theatre:   "Theatre",
};

// ─── ORBAT Builder — UnitNode (GroupBuilder state model) ──────────────────
//
// Distinct from CompositionNode (which is the React-Flow / HierarchyMap model).
// UnitNode is the richer military-structure format used by GroupBuilderPanel.
// Catalogue linkage (canonicalAssetKey etc.) bridges to the HierarchyMap export.
// A converter in lib/unitNodeToCompositionNode.ts converts between the two.

export interface UnitNodeSymbol {
  standardIdentity?: string;
  echelon?: EchelonLevel;
  icon: UnitIconType;
  sector1?: string;
  sector2?: string;
  hqIndicator?: string;
  reinforced?: "+" | "-" | "±";
  status?: string;
  /** Explicit 15-char APP-6D SIDC — overrides derived value if set */
  sidc?: string;
}

export interface UnitNodeCapabilities {
  speedRoadKph?: number;
  speedOffRoadKph?: number;
  rangeKm?: number;
  primaryWeapon?: string;
  combatEffectiveness?: "FO" | "SO" | "MO" | "NO" | "UNK";
  iffCode?: string;
  callSign?: string;
  radioFreqMhz?: number;
}

export interface UnitNodeState {
  status: "active" | "reserve" | "destroyed" | "unknown";
  lastUpdated: string;
}

export interface UnitNode {
  id: string;
  name: string;
  echelon: EchelonLevel;
  personnelCount: number;
  notes: string;
  symbol: UnitNodeSymbol;
  capabilities: UnitNodeCapabilities;
  state: UnitNodeState;
  children: UnitNode[];
  /** Links to Foundry canonical asset catalogue — same field as CompositionNode */
  canonicalAssetKey?: string | null;
  /** Chosen simulator catalogue entry — same field as CompositionNode */
  simulatorIdentifierCode?: string | null;
  unitTypeKey?: string | null;
  equipmentTypeKey?: string | null;
}

// ─── ORBAT Builder — Template types ───────────────────────────────────────

export interface UnitTemplate {
  id: string;
  name: string;
  echelon: EchelonLevel;
  defaultPersonnelCount: number;
  description: string;
  tags: string[];
  defaultChildren: Array<{ templateId: string; quantity: number }>;
  symbol: Partial<UnitNodeSymbol>;
}

export interface GroupTemplateNode {
  name: string;
  echelon: EchelonLevel;
  personnelCount: number;
  notes: string;
  icon: string;
  children: GroupTemplateNode[];
}

export interface GroupTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  branch: "army" | "navy" | "airForce" | "marines" | "specialForces" | "joint" | "other";
  rootNodes: GroupTemplateNode[];
  createdAt: string;
}

// ─── ORBAT Builder — Store state ──────────────────────────────────────────

/** A named group of units tied to an affiliation (Friend / Hostile / Neutral etc.) */
export interface UnitGroup {
  id: string;
  name: string;
  /** e.g. "Friend" | "Hostile" | "Neutral" — mirrors CompositionNode.affiliation */
  affiliation: string;
  description: string;
  units: UnitNode[];
}

export interface OrbatStoreState {
  groups: UnitGroup[];
  templates: UnitTemplate[];
  groupTemplates: GroupTemplate[];
  /** Full CompositionNode hierarchy templates — built & saved in the Build Hierarchy tab */
  hierarchyTemplates: HierarchyTemplate[];
  /**
   * User's actual forces — CompositionNode trees they are actively working on.
   * Distinct from hierarchyTemplates (which are reusable starting points).
   * Each force appears in the sidebar under "My Forces".
   */
  forces: Force[];
}

/** A live force that the user is building — a named CompositionNode tree */
export interface Force {
  id: string;
  name: string;
  affiliation: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  root: CompositionNode;
}

/**
 * A saved hierarchy template — stores the complete CompositionNode tree
 * exactly as produced by the Build Hierarchy React Flow builder.
 * All SIDC, entity types, catalogue asset keys, and simulator settings
 * are preserved so the template loads back as a fully-configured graph.
 */
export interface HierarchyTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  /** The complete root CompositionNode tree */
  root: CompositionNode;
}

