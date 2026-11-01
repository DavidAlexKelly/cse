// ============================================================
//  ORBAT Manager — TypeScript Data Model
// ============================================================

export type {
  Sector1Modifier,
  Sector2Modifier,
  HqIndicator,
  SymbolStatus,
} from "./symbolSpec.js";
import type {
  Sector1Modifier,
  Sector2Modifier,
  HqIndicator,
  SymbolStatus,
} from "./symbolSpec.js";

export type StandardIdentity =
  | "friend"
  | "hostile"
  | "neutral"
  | "unknown"
  | "pending"
  | "assumedFriend"
  | "suspect";

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

export type UnitModifier =
  | "N"
  | "S"
  | "TF"
  | "FE"
  | "MT"
  | "W"
  | "G"
  | "E"
  | "A"
  | "C"
  | "D"
  | "none";

export interface NatoSymbol {
  standardIdentity: StandardIdentity;
  echelon: EchelonLevel;
  icon: UnitIconType;
  modifier?: UnitModifier;
  sector1?: Sector1Modifier;
  sector2?: Sector2Modifier;
  hqIndicator?: HqIndicator;
  reinforced?: "+" | "-" | "±";
  /** APP-6E §3.5 — SIDC digit 7: planned drives dashed frame */
  status?: SymbolStatus;
  /** APP-06(E)(2) derived 30-digit Symbol Identification Code */
  sidc?: string;
}

export interface UnitCapabilities {
  speedRoadKph?: number;
  speedOffRoadKph?: number;
  rangeKm?: number;
  primaryWeapon?: string;
  combatEffectiveness?: "FO" | "SO" | "MO" | "NO" | "UNK";
  iffCode?: string;
  callSign?: string;
  radioFreqMhz?: number;
}

export interface UnitState {
  location?: { lat: number; lng: number; mgrs?: string };
  currentStrength?: number;
  status: "active" | "reserve" | "destroyed" | "unknown";
  fuelLevel?: number;
  ammoLevel?: number;
  lastUpdated: string;
}

export interface WeaponItem {
  id: string;
  name: string;
  calibre?: string;
  quantity: number;
  roundsCarried?: number;
  notes?: string;
}

export interface AssetSection {
  id: string;
  name: string;
  personnelCount: number;
  role?: string;
  subSections: AssetSection[];
  assignedUnitIds?: string[];
}

export interface AssetNode {
  id: string;
  name: string;
  presetId: string;
  quantity: number;
  crewCount: number;
  commanderName?: string;
  commanderRank?: string;
  notes?: string;
  weapons: WeaponItem[];
  sections: AssetSection[];
  assignedUnitIds: string[];
  state: {
    status: "active" | "reserve" | "destroyed" | "unknown";
    fuelLevel?: number;
    ammoLevel?: number;
  };
}

export interface EquipmentItem {
  id: string;
  name: string;
  category?:
    | "smallArm"
    | "heavyWeapon"
    | "vehicle"
    | "aircraft"
    | "vessel"
    | "other";
  quantity: number;
  notes?: string;
}

export interface CustomProperty {
  id: string;
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "date";
  value: string;
  unit?: string;
}

// NATO command relationship types (from NxgUnitHierarchyNodeRelationshipType)
export type CommandRelationshipType =
  | "ORGANIC"    // permanent part of the formation — solid line
  | "OPCON"      // operational control — dashed blue line
  | "TACON"      // tactical control — dotted blue line
  | "ATTACHED"   // temporary placement — dashed amber line
  | "ASSIGNED"   // full authority transfer — dash-dot line
  | "SUPPORTCON" // support relationship — dotted green line
  | "ADCON";     // administrative control — dash-dot purple line

export const COMMAND_REL_LABELS: Record<CommandRelationshipType, string> = {
  ORGANIC:    "Organic",
  OPCON:      "OPCON",
  TACON:      "TACON",
  ATTACHED:   "Attached",
  ASSIGNED:   "Assigned",
  SUPPORTCON: "Support (SUPPORTCON)",
  ADCON:      "ADCON",
};

export const COMMAND_REL_DESCRIPTION: Record<CommandRelationshipType, string> = {
  ORGANIC:    "Permanently assigned to the formation — solid command line.",
  OPCON:      "Operational Control — authority to direct operations, not admin or support.",
  TACON:      "Tactical Control — local direction of movements only.",
  ATTACHED:   "Temporarily placed under the command of another unit.",
  ASSIGNED:   "Full authority transferred from parent service to the gaining commander.",
  SUPPORTCON: "Support relationship — provides support, not under command.",
  ADCON:      "Administrative Control — limited authority over admin matters only.",
};

export const COMMAND_REL_COLOUR: Record<CommandRelationshipType, { line: string; badge: string; bg: string }> = {
  ORGANIC:    { line: "#60a5fa", badge: "#60a5fa", bg: "rgba(96,165,250,0.12)"  },
  OPCON:      { line: "#34d399", badge: "#34d399", bg: "rgba(52,211,153,0.12)"  },
  TACON:      { line: "#fbbf24", badge: "#fbbf24", bg: "rgba(251,191,36,0.12)"  },
  ATTACHED:   { line: "#f87171", badge: "#f87171", bg: "rgba(248,113,113,0.12)" },
  ASSIGNED:   { line: "#c084fc", badge: "#c084fc", bg: "rgba(192,132,252,0.12)" },
  SUPPORTCON: { line: "#4ade80", badge: "#4ade80", bg: "rgba(74,222,128,0.12)"  },
  ADCON:      { line: "#e879f9", badge: "#e879f9", bg: "rgba(232,121,249,0.12)" },
};

/**
 * A reference to a real-world military equipment nomenclature drawn from
 * the ontology's NxgEquipmentType object.  We store the primary key plus a
 * cached name/description so the ORBAT UI can display equipment info even
 * when offline (e.g. a saved template exported to a workshop app).
 */
export interface EquipmentTypeRef {
  /** NxgEquipmentType.primaryKey_ */
  key: string;
  /** NxgEquipmentType.nomenclature (title property) */
  nomenclature: string;
  /** NxgEquipmentType.description — free-text description */
  description?: string;
}

export interface UnitNode {
  id: string;
  name: string;
  echelon: EchelonLevel;
  personnelCount: number;
  notes: string;
  symbol: NatoSymbol;
  capabilities: UnitCapabilities;
  customProperties: CustomProperty[];
  state: UnitState;
  weapons: WeaponItem[];
  assets: AssetNode[];
  equipment: EquipmentItem[];
  children: UnitNode[];
  /** NATO command relationship to the parent unit (default: ORGANIC) */
  commandRelationshipType?: CommandRelationshipType;
  /**
   * Ontology-backed equipment type this unit is composed of (e.g. FV510
   * Warrior, Challenger 2).  Sourced from NxgUnit.equipmentTypeKey ↔
   * NxgEquipmentType.primaryKey_.  Nullable — organisational nodes
   * (companies, battalions) usually have no equipment type.
   */
  equipmentType?: EquipmentTypeRef;
}

export interface UnitGroup {
  id: string;
  name: string;
  branch:
    | "army"
    | "navy"
    | "airForce"
    | "marines"
    | "specialForces"
    | "joint"
    | "other";
  description: string;
  units: UnitNode[];
}

export interface Side {
  id: string;
  name: string;
  standardIdentity: StandardIdentity;
  colour: string;
  description: string;
  groups: UnitGroup[];
  createdAt: string;
  updatedAt: string;
}

export interface TemplateChild {
  templateId: string;
  quantity: number;
}

export interface UnitTemplate {
  id: string;
  name: string;
  echelon: EchelonLevel;
  defaultPersonnelCount: number;
  description: string;
  tags: string[];
  defaultChildren: TemplateChild[];
  symbol: Partial<NatoSymbol>;
  defaultEquipment: EquipmentItem[];
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
  branch: UnitGroup["branch"];
  rootNodes: GroupTemplateNode[];
  createdAt: string;
}

export interface StoreState {
  sides: Side[];
  templates: UnitTemplate[];
  groupTemplates: GroupTemplate[];
}

export const ECHELON_ORDER: EchelonLevel[] = [
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
];

export const ECHELON_LABELS: Record<EchelonLevel, string> = {
  team: "Team",
  squad: "Squad",
  section: "Section",
  platoon: "Platoon",
  company: "Company/Battery/Troop",
  battalion: "Battalion/Squadron",
  regiment: "Regiment",
  brigade: "Brigade",
  division: "Division",
  corps: "Corps",
  army: "Army",
  armyGroup: "Army Group",
  theatre: "Theatre",
};

export const ECHELON_SHORT: Record<EchelonLevel, string> = {
  team: "Team",
  squad: "Squad",
  section: "Section",
  platoon: "Platoon",
  company: "Company",
  battalion: "Battalion",
  regiment: "Regiment",
  brigade: "Brigade",
  division: "Division",
  corps: "Corps",
  army: "Army",
  armyGroup: "Army Group",
  theatre: "Theatre",
};

export const BRANCH_LABELS: Record<UnitGroup["branch"], string> = {
  army: "Army",
  navy: "Navy",
  airForce: "Air Force",
  marines: "Marines",
  specialForces: "Special Forces",
  joint: "Joint",
  other: "Other",
};

export const IDENTITY_LABELS: Record<StandardIdentity, string> = {
  friend: "Friend",
  hostile: "Hostile",
  neutral: "Neutral",
  unknown: "Unknown",
  pending: "Pending",
  assumedFriend: "Assumed Friend",
  suspect: "Suspect",
};

// Echelon index for hierarchy comparison
export const ECHELON_INDEX: Record<EchelonLevel, number> = {
  team: 0,
  squad: 1,
  section: 2,
  platoon: 3,
  company: 4,
  battalion: 5,
  regiment: 6,
  brigade: 7,
  division: 8,
  corps: 9,
  army: 10,
  armyGroup: 11,
  theatre: 12,
};

export function canContain(parent: EchelonLevel, child: EchelonLevel): boolean {
  return ECHELON_INDEX[parent] > ECHELON_INDEX[child];
}
