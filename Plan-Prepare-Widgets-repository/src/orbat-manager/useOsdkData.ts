// ============================================================
//  OSDK Data Hook — loads live Foundry NXG data into ORBAT types
//
//  Import chain (using ontology links, not global scans):
//
//  NxgOperation
//    └─ .nxgUnitHierarchies          → NxgUnitHierarchy[]  (one per snapshot)
//         └─ .nxgUnitHierachyEdges   → NxgUnitHierachyEdge[] (parent→child)
//              ├─ .nxgUnit           → NxgUnit  (the PARENT unit)
//              │    └─ .nxgVbs4assetCatalogue → NxgVbs4AssetCatalogue (asset type)
//              │         └─ .nxgCanonicalAsset (via canonicalAssetKey)
//              └─ .childNxgUnit      → NxgUnit  (the CHILD unit)
//                   └─ .nxgVbs4assetCatalogue → …
//
//  This means the import is entirely link-driven: we never load all units
//  globally.  We traverse the graph for the specific operation only.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../client.js";
import {
  NxgUnit,
  NxgUnitHierachyEdge,
  NxgTacticalGraphicSymbol,
  NxgForceStructureSnapshot,
  NxgOperation,
  NxgVbs4AssetCatalogue,
  NxgCanonicalAsset,
  NxgEquipmentType,
} from "@custom-widget/sdk";
import type { Osdk } from "@osdk/client";
import type {
  Side,
  UnitGroup,
  UnitNode,
  StandardIdentity,
  UnitIconType,
  EchelonLevel,
  UnitTemplate,
  CommandRelationshipType,
  EquipmentTypeRef,
} from "./types.js";

// ─── Raw SDK instance types ───────────────────────────────────────────────────

export type OsdkNxgUnit = Osdk.Instance<NxgUnit>;
export type OsdkHierarchyEdge = Osdk.Instance<NxgUnitHierachyEdge>;
export type OsdkTacSymbol = Osdk.Instance<NxgTacticalGraphicSymbol>;
export type OsdkSnapshot = Osdk.Instance<NxgForceStructureSnapshot>;
export type OsdkOperation = Osdk.Instance<NxgOperation>;
export type OsdkAsset = Osdk.Instance<NxgVbs4AssetCatalogue>;
export type OsdkEquipmentType = Osdk.Instance<NxgEquipmentType>;

// ─── SIDC → StandardIdentity ─────────────────────────────────────────────────

function sidcToIdentity(sidc: string | null | undefined): StandardIdentity {
  if (!sidc || sidc.length < 4) return "unknown";
  switch (sidc[3]) {
    case "0":
      return "pending";
    case "1":
      return "unknown";
    case "2":
      return "assumedFriend";
    case "3":
      return "friend";
    case "4":
      return "neutral";
    case "5":
      return "suspect";
    case "6":
      return "hostile";
    default:
      return "unknown";
  }
}

function affiliationToIdentity(
  affiliation: string | null | undefined,
  allegiance: string | null | undefined
): StandardIdentity {
  const raw = (affiliation ?? allegiance ?? "").toLowerCase();

  if (raw.includes("friend") || raw.includes("blue")) return "friend";
  if (raw.includes("hostile") || raw.includes("red")) return "hostile";
  if (raw.includes("neutral") || raw.includes("green")) return "neutral";
  if (raw.includes("unknown")) return "unknown";
  if (raw.includes("pending")) return "pending";
  if (raw.includes("suspect")) return "suspect";
  if (raw.includes("assumed")) return "assumedFriend";
  return "unknown";
}

// ─── Icon / echelon guessing ─────────────────────────────────────────────────

const UNIT_TYPE_TO_ICON: [RegExp, UnitIconType][] = [
  [/armou?r|tank|mbt/i, "armour"],
  [/mechanis/i, "mechanisedInfantry"],
  [/infantry|rifle|light/i, "infantry"],
  [/artiller/i, "artillery"],
  [/rocket|mlrs/i, "rocketArtillery"],
  [/mortar/i, "mortar"],
  [/aviation|helicopter|rotary/i, "aviation"],
  [/air.?force|fixed.wing|fighter/i, "airForce"],
  [/recce|reconnais/i, "reconnaissance"],
  [/cavalr/i, "cavalry"],
  [/engineer/i, "engineer"],
  [/pioneer/i, "pioneer"],
  [/signal|comms/i, "signals"],
  [/cyber/i, "cyber"],
  [/electron/i, "ew"],
  [/logistic|supply/i, "logistics"],
  [/maintenance|reme|repair/i, "maintenance"],
  [/medical|medic|doctor/i, "medical"],
  [/air.def|shorad|manpad|sam/i, "airDefence"],
  [/special|sf\b|sas|delta/i, "specialForces"],
  [/sniper/i, "sniper"],
  [/anti.tank|atgm|nlaw/i, "antiTank"],
  [/naval|ship|frigate|destroyer/i, "naval"],
  [/cbrn|nbc|chemical/i, "cbrn"],
  [/police|mp\b/i, "military_police"],
  [/hq|headquarter/i, "headquarters"],
  [/drone|uav|rpas/i, "reconnaissance"],
];

export function guessIcon(text: string): UnitIconType {
  for (const [pattern, icon] of UNIT_TYPE_TO_ICON) {
    if (pattern.test(text)) return icon;
  }
  return "generic";
}

export function guessEchelon(text: string): EchelonLevel {
  const t = (text ?? "").toLowerCase();
  if (/army.?group|theatre/.test(t)) return "armyGroup";
  if (/corps/.test(t)) return "corps";
  if (/division/.test(t)) return "division";
  if (/brigade/.test(t)) return "brigade";
  if (/regiment/.test(t)) return "regiment";
  if (/battalion|squadron/.test(t)) return "battalion";
  if (/company|battery|troop/.test(t)) return "company";
  if (/platoon/.test(t)) return "platoon";
  if (/section/.test(t)) return "section";
  if (/squad/.test(t)) return "squad";
  if (/team/.test(t)) return "team";
  return "platoon";
}

// ─── NxgUnit → UnitNode (with optional VBS4 asset enrichment) ────────────────
//
//  assetMap: simulatorIdentifierCode → AssetEntry, prebuilt before calling this.
//  When a unit's simulatorIdentifierCode matches an asset, we use the asset's
//  category / icon data to set a more accurate icon than the text heuristic alone.
//
//  equipmentMap: NxgEquipmentType.primaryKey_ → EquipmentTypeRef.  When a unit's
//  equipmentTypeKey matches an entry, we attach the label so the UI can show
//  "Warrior IFV" instead of a raw primary key.

export function nxgUnitToUnitNode(
  unit: OsdkNxgUnit,

  tacSymbol?: OsdkTacSymbol | null,
  assetMap?: Map<string, AssetEntry>,
  equipmentMap?: Map<string, EquipmentTypeRef>
): UnitNode {
  const labelText = unit.unitIdentifier ?? unit.primaryKey_ ?? "Unit";

  const sidc = unit.sidc ?? tacSymbol?.sidc ?? null;

  const identity: StandardIdentity = sidc
    ? sidcToIdentity(sidc)
    : affiliationToIdentity(unit.affiliation, unit.allegiance);

  // Use echelon directly from the unit object first
  const echelon = guessEchelon(
    `${unit.echelon ?? ""} ${unit.unitIdentifier ?? ""}`
  );

  // Icon — prefer asset catalogue data when linked
  const asset = assetMap?.get(unit.simulatorIdentifierCode ?? "");
  const iconText = `${unit.unitIdentifier ?? ""} ${unit.echelon ?? ""} ${
    unit.militaryService ?? ""
  }`;
  const icon: UnitIconType = asset?.templateIcon ?? guessIcon(iconText);

  const locationData =
    tacSymbol?.latitude != null && tacSymbol?.longitude != null
      ? { lat: tacSymbol.latitude, lng: tacSymbol.longitude }
      : unit.latitude != null && unit.longitude != null
      ? { lat: unit.latitude, lng: unit.longitude }
      : undefined;

  // Build notes that include asset type info when available
  const noteParts: string[] = [];
  if (unit.militaryService) noteParts.push(unit.militaryService);
  if (unit.echelon) noteParts.push(unit.echelon);
  if (asset?.canonicalName) noteParts.push(`Asset: ${asset.canonicalName}`);
  else if (asset?.identifier) noteParts.push(`VBS4: ${asset.identifier}`);
  if (unit.allegiance) noteParts.push(unit.allegiance);

  // Crew count from asset when available
  const personnelCount = asset?.templateCrew ?? 0;

  // ── Equipment-type resolution ───────────────────────────────────────────
  // If we have a pre-loaded lookup map, use the cached nomenclature. This
  // avoids one extra $link.equipmentType.fetchOne() per unit during the
  // hot import loop — the map is populated once from a single scan of
  // NxgEquipmentType in fetchEquipmentTypes().
  //
  // If the map lookup misses (e.g. an equipment key not in the catalogue
  // yet), we still record the key so the UI can display it and a later
  // refresh will fill in the friendly name.
  let equipmentType: EquipmentTypeRef | undefined;
  const eqKey = unit.equipmentTypeKey ?? undefined;
  if (eqKey) {
    const cached = equipmentMap?.get(eqKey);
    equipmentType = cached ?? { key: eqKey, nomenclature: eqKey };
  }
  // Add a note describing the equipment for at-a-glance UI legibility
  if (equipmentType) {
    noteParts.push(`Equipment: ${equipmentType.nomenclature}`);
  }

  return {
    id: unit.primaryKey_,
    name: labelText,
    echelon,

    personnelCount,
    notes: noteParts.join(" · "),
    symbol: {
      standardIdentity: identity,
      echelon,
      icon,
      sidc: sidc ?? undefined,
    },
    capabilities: {},
    customProperties: [],

    state: {
      status: "active",
      location: locationData,
      lastUpdated: new Date().toISOString(),
    },
    weapons: [],
    assets: [],
    equipment: [],
    children: [],
    equipmentType,
  };
}

// ─── Build hierarchy tree from flat units + edges ─────────────────────────────

// Map the ontology's relationshipTypeKey string to our CommandRelationshipType.
// The ontology description lists: ORGANIC, OPCON, TACON, ATTACHED, ASSIGNED.
const VALID_CMD_RELS = new Set<string>([
  "ORGANIC",
  "OPCON",
  "TACON",
  "ATTACHED",
  "ASSIGNED",
  "SUPPORTCON",
  "ADCON",
]);
function coerceRelType(
  raw: string | null | undefined
): CommandRelationshipType | undefined {
  if (!raw) return undefined;
  const up = raw.trim().toUpperCase();
  if (VALID_CMD_RELS.has(up)) return up as CommandRelationshipType;
  return undefined;
}

export function buildNxgUnitTree(
  units: OsdkNxgUnit[],
  edges: OsdkHierarchyEdge[],
  tacSymbols: Map<string, OsdkTacSymbol>,
  assetMap?: Map<string, AssetEntry>,
  equipmentMap?: Map<string, EquipmentTypeRef>
): UnitNode[] {
  const nodeMap = new Map<string, UnitNode>();
  for (const u of units) {
    nodeMap.set(
      u.primaryKey_,
      nxgUnitToUnitNode(
        u,
        tacSymbols.get(u.primaryKey_) ?? null,
        assetMap,
        equipmentMap
      )
    );
  }

  // child → { parentKey, relType } (the edge stores relationshipTypeKey on the child side)
  const childParentMap = new Map<
    string,
    { parentKey: string; relType: CommandRelationshipType | undefined }
  >();
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const edge of edges) {
    const parent = edge.parentUnitKey;
    const child = edge.childUnitKey;
    if (!parent || !child) continue;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(child);
    hasParent.add(child);
    childParentMap.set(child, {
      parentKey: parent,
      relType: coerceRelType(edge.relationshipTypeKey),
    });
  }

  function attachChildren(nodeId: string): UnitNode {
    const node = nodeMap.get(nodeId)!;
    const childIds = childrenOf.get(nodeId) ?? [];
    const relInfo = childParentMap.get(nodeId);

    return {
      ...node,
      // Stamp the relationship type onto the child node itself
      commandRelationshipType: relInfo?.relType ?? node.commandRelationshipType,
      children: childIds.filter((cid) => nodeMap.has(cid)).map(attachChildren),
    };
  }

  return Array.from(nodeMap.keys())
    .filter((id) => !hasParent.has(id))
    .map(attachChildren);
}

// ─── Link-driven import: walk NxgOperation → hierarchies → edges → units ─────
//

//  Strategy:
//  1. From the operation, fetch linked NxgUnitHierarchy objects (snapshots).
//     Pick the latest by validFrom.
//  2. From that hierarchy, fetch all linked NxgUnitHierachyEdge objects.
//     Each edge gives us: parentUnitKey, childUnitKey, relationshipTypeKey.
//  3. Collect all unique unit keys from the edges.
//  4. Load those NxgUnit objects by fetching the $link.nxgUnit (parent side)
//     and $link.childNxgUnit (child side) from each edge, deduplicating.
//  5. For each unit, follow .nxgVbs4assetCatalogue to get the asset type,
//     then follow that asset's canonicalAssetKey to get canonical data.
//  6. Build the tree with full enrichment.

async function importOperationViaLinks(
  op: OsdkOperation,
  assetCatalogueMap: Map<string, AssetEntry>, // pre-built from useOsdkData
  equipmentMap: Map<string, EquipmentTypeRef> // pre-built lookup
): Promise<{
  units: OsdkNxgUnit[];
  edges: OsdkHierarchyEdge[];
  tacMap: Map<string, OsdkTacSymbol>;
  snapshotName: string;
}> {
  // ── Step 1: Fetch hierarchies (snapshots) linked to the operation ──────────
  const hierarchies: Osdk.Instance<
    import("@custom-widget/sdk").NxgUnitHierarchy
  >[] = [];
  for await (const h of op.$link.nxgUnitHierarchies.asyncIter()) {
    hierarchies.push(h);
  }

  // Pick the most recent snapshot by validFrom (fall back to first)
  hierarchies.sort((a, b) =>
    (b.validFrom?.toString() ?? "").localeCompare(a.validFrom?.toString() ?? "")
  );
  const snapshot = hierarchies[0] ?? null;
  const snapshotName = snapshot?.name ?? "";

  // ── Step 2: Fetch all edges in the chosen hierarchy ────────────────────────
  const edges: OsdkHierarchyEdge[] = [];
  if (snapshot) {
    for await (const edge of snapshot.$link.nxgUnitHierachyEdges.asyncIter()) {
      edges.push(edge);
    }
  } else {
    // Fallback: load all edges, filter by hierarchyKey matching snapshot key
    // (handled below if snapshot is null — will return empty tree)
  }

  if (edges.length === 0) {
    return { units: [], edges: [], tacMap: new Map(), snapshotName };
  }

  // ── Step 3: Collect unique unit keys from edges ────────────────────────────
  const unitKeySet = new Set<string>();
  for (const edge of edges) {
    if (edge.parentUnitKey) unitKeySet.add(edge.parentUnitKey);
    if (edge.childUnitKey) unitKeySet.add(edge.childUnitKey);
  }

  // ── Step 4: Load all units via edge links (parent + child side) ───────────
  //  We use the edge's $link to get the actual unit objects, which automatically
  //  resolves via the ontology relationship — no $where scan needed.
  const unitMap = new Map<string, OsdkNxgUnit>();

  for (const edge of edges) {
    // Parent unit (nxgUnit link on the edge)
    try {
      const parentUnit = await edge.$link.nxgUnit.fetchOne();
      if (parentUnit && parentUnit.primaryKey_) {
        unitMap.set(parentUnit.primaryKey_, parentUnit);
      }
    } catch {
      /* edge may not have a resolvable parent */
    }

    // Child unit (childNxgUnit link on the edge)
    try {
      const childUnit = await edge.$link.childNxgUnit.fetchOne();
      if (childUnit && childUnit.primaryKey_) {
        unitMap.set(childUnit.primaryKey_, childUnit);
      }
    } catch {
      /* edge may not have a resolvable child */
    }
  }

  const units = Array.from(unitMap.values());

  // ── Step 5: Tactical symbols (position data) ───────────────────────────────
  //  Follow NxgUnit.$link.nxgTacticalGraphicSymbol for each unit.
  const tacMap = new Map<string, OsdkTacSymbol>();
  for (const unit of units) {
    try {
      const sym = await unit.$link.nxgTacticalGraphicSymbol.fetchOne();
      if (sym) tacMap.set(unit.primaryKey_, sym as OsdkTacSymbol);
    } catch {
      /* not all units have a tactical symbol */
    }
  }

  // ── Step 6: Asset enrichment ───────────────────────────────────────────────
  //  NxgUnit has no direct VBS4 link. Instead:
  //    • simulatorIdentifierCode == NxgVbs4AssetCatalogue.identifier (FK)
  //      → look up in the pre-built assetCatalogueMap (keyed by identifier)
  //    • If not in the map yet, follow unit.$link.nxgCanonicalAsset to get the
  //      canonical asset definition, and synthesise an AssetEntry from it.
  for (const unit of units) {
    const simCode = unit.simulatorIdentifierCode ?? "";

    // If the pre-built catalogue already has this asset, nothing to do
    if (simCode && assetCatalogueMap.has(simCode)) continue;

    // Try the unit's direct canonical asset link for enrichment data
    try {
      const canonical = await unit.$link.nxgCanonicalAsset.fetchOne();
      if (canonical) {
        const partial: AssetEntry = {
          // Use simulatorIdentifierCode as the identifier so lookups work
          identifier: (simCode || canonical.primaryKey_) ?? "",
          classType: "",
          domain: canonical.militaryDomain ?? "",
          description: canonical.canonicalName ?? "",
          nationality: canonical.nationality ?? "",
          isDrone: false,
          simulationClass: canonical.simulationClass ?? "",
          gunnerSeatCount: null,
          numCargoSeats: null,
          hasCommander: null,
          canonicalName: canonical.canonicalName ?? "",
          assetCategory: canonical.assetCategory ?? "",
          militaryDomain: canonical.militaryDomain ?? "",
          branch: canonical.branch ?? "",
          templateIcon: "generic",
          templateEchelon: "platoon",
          templateCrew: 1,
        };
        partial.templateIcon = deriveIcon(partial);
        partial.templateEchelon = deriveEchelon(partial);
        partial.templateCrew = deriveCrew(partial);

        // Cache under simCode so the same asset isn't fetched again
        if (simCode) assetCatalogueMap.set(simCode, partial);
      }
    } catch {
      /* unit may not have a canonical asset */
    }
  }

  // ── Step 7: Equipment-type back-fill ──────────────────────────────────────
  //  Any unit whose equipmentTypeKey isn't in the pre-built map is resolved
  //  now via unit.$link.equipmentType.  We cache the friendly name so the
  //  next unit with the same key doesn't refetch.
  for (const unit of units) {
    const key = unit.equipmentTypeKey;
    if (!key || equipmentMap.has(key)) continue;

    try {
      const et = await unit.$link.equipmentType.fetchOne();
      if (et) {
        equipmentMap.set(key, {
          key: et.primaryKey_ ?? key,
          nomenclature: et.nomenclature ?? key,
          description: et.description ?? undefined,
        });
      }
    } catch {
      /* unit may not have a resolvable equipment link */
    }
  }

  return { units, edges, tacMap, snapshotName };
}

// ─── Asset Catalogue (VBS4 + Canonical, merged) ───────────────────────────────

export interface AssetEntry {
  identifier: string;

  classType: string;
  domain: string;
  description: string;
  nationality: string;
  isDrone: boolean;
  simulationClass: string;
  gunnerSeatCount: number | null;
  numCargoSeats: number | null;
  hasCommander: boolean | null;

  canonicalName: string;
  assetCategory: string;
  militaryDomain: string;
  branch: string;

  templateIcon: UnitIconType;
  templateEchelon: EchelonLevel;
  templateCrew: number;
}

export function assetEntryToTemplate(a: AssetEntry): Omit<UnitTemplate, "id"> {
  const name = a.canonicalName || a.identifier || "Unknown Asset";

  const descParts: string[] = [];
  if (a.canonicalName && a.canonicalName !== a.identifier)
    descParts.push(a.canonicalName);
  if (a.assetCategory) descParts.push(a.assetCategory);
  if (a.militaryDomain) descParts.push(`Domain: ${a.militaryDomain}`);
  if (a.nationality) descParts.push(`Nationality: ${a.nationality}`);
  if (a.isDrone) descParts.push("Drone / RPAS");
  if (a.description && a.description !== a.canonicalName)
    descParts.push(a.description);
  const description = descParts.slice(0, 4).join(" · ");

  const tags = new Set<string>();
  if (a.assetCategory) tags.add(a.assetCategory.toLowerCase());
  if (a.militaryDomain) tags.add(a.militaryDomain.toLowerCase());
  if (a.nationality) tags.add(a.nationality.toLowerCase());
  if (a.branch) tags.add(a.branch.toLowerCase());
  if (a.isDrone) tags.add("drone");
  if (a.simulationClass === "soldier") tags.add("dismount");
  tags.add("foundry-asset");

  return {
    name,
    echelon: a.templateEchelon,
    defaultPersonnelCount: a.templateCrew,
    description,
    tags: Array.from(tags).filter(Boolean).slice(0, 6),
    defaultChildren: [],
    symbol: { icon: a.templateIcon },
    defaultEquipment: [],
  };
}

// ─── Asset derivation helpers ─────────────────────────────────────────────────

const SIM_CLASS_ECHELON: Record<string, EchelonLevel> = {
  soldier: "team",
  car: "section",
  tank: "platoon",
  ship: "platoon",
  structural: "section",
};

function deriveIcon(a: AssetEntry): UnitIconType {
  if (a.isDrone) return "reconnaissance";
  const text = [
    a.assetCategory,
    a.classType,
    a.domain,
    a.description,
    a.militaryDomain,
  ]
    .filter(Boolean)
    .join(" ");
  return guessIcon(text);
}

function deriveEchelon(a: AssetEntry): EchelonLevel {
  const simClass = (a.simulationClass || a.classType || "").toLowerCase();
  if (simClass in SIM_CLASS_ECHELON) return SIM_CLASS_ECHELON[simClass];
  return guessEchelon(`${a.assetCategory} ${a.classType} ${a.domain}`);
}

function deriveCrew(a: AssetEntry): number {
  const gunners = a.gunnerSeatCount ?? 0;
  const cargo = a.numCargoSeats ?? 0;
  const commander = a.hasCommander ?? false ? 1 : 0;
  const driver = a.simulationClass === "soldier" ? 0 : 1;
  const total = gunners + cargo + commander + driver;
  return total > 0 ? total : 1;
}

// ─── Operation → Side ────────────────────────────────────────────────────────

export function operationToSide(
  operation: OsdkOperation,
  units: OsdkNxgUnit[],
  edges: OsdkHierarchyEdge[],
  tacSymbols: Map<string, OsdkTacSymbol>,
  assetMap?: Map<string, AssetEntry>,
  snapshotName?: string,
  equipmentMap?: Map<string, EquipmentTypeRef>
): Side {
  const tree = buildNxgUnitTree(
    units,
    edges,
    tacSymbols,
    assetMap,
    equipmentMap
  );
  const firstId = tree[0]?.symbol.standardIdentity ?? "friend";
  const colour =
    firstId === "friend"
      ? "#63a2ff"
      : firstId === "hostile"
      ? "#ef4d4d"
      : "#f5b955";

  const label = snapshotName
    ? `${operation.terrainName ?? "Operation"} · ${snapshotName}`
    : operation.terrainName ?? `Operation ${operation.primaryKey_}`;
  const group: UnitGroup = {
    id: `nxg-op-${operation.primaryKey_}`,
    name: "Force Structure",
    branch: "army",
    description: "Imported from NXG operation snapshot",

    units: tree,
  };
  return {
    id: `osdk-nxg-op-${operation.primaryKey_}`,
    name: label,
    standardIdentity: firstId,
    colour,

    description: `NXG Operation — terrain: ${
      operation.terrainName ?? "unknown"
    }`,
    groups: [group],
    createdAt: operation.startTime?.toString() ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Public summary types ─────────────────────────────────────────────────────

export interface NxgOperation_Summary {
  primaryKey: string;
  terrainName: string;
  startTime: string | null;
  endTime: string | null;
}

export interface NxgSnapshot_Summary {
  primaryKey: string;
  operationKey: string;
  validFrom: string | null;
  validTo: string | null;
}

// ─── Hook state ───────────────────────────────────────────────────────────────

export interface OsdkDataState {
  operations: NxgOperation_Summary[];
  snapshots: NxgSnapshot_Summary[];
  assetEntries: AssetEntry[];
  /** All equipment types loaded from the ontology, sorted by nomenclature */
  equipmentTypes: EquipmentTypeRef[];

  loadingOperations: boolean;
  loadingSnapshots: boolean;
  loadingAssets: boolean;
  loadingEquipmentTypes: boolean;

  errorOperations: string | null;
  errorSnapshots: string | null;
  errorAssets: string | null;
  errorEquipmentTypes: string | null;

  importOperation: (
    opKey: string,
    opName: string,
    onImport: (side: Side) => Promise<void>
  ) => Promise<void>;

  refresh: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useOsdkData(): OsdkDataState {
  const [operations, setOperations] = useState<NxgOperation_Summary[]>([]);
  const [snapshots, setSnapshots] = useState<NxgSnapshot_Summary[]>([]);
  const [assetEntries, setAssetEntries] = useState<AssetEntry[]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<EquipmentTypeRef[]>([]);

  const [loadingOperations, setLoadingOperations] = useState(false);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingEquipmentTypes, setLoadingEquipmentTypes] = useState(false);

  const [errorOperations, setErrorOperations] = useState<string | null>(null);
  const [errorSnapshots, setErrorSnapshots] = useState<string | null>(null);
  const [errorAssets, setErrorAssets] = useState<string | null>(null);
  const [errorEquipmentTypes, setErrorEquipmentTypes] = useState<string | null>(
    null
  );

  const rawOperationsRef = useRef<OsdkOperation[]>([]);

  // Shared asset cache — keyed by simulatorIdentifierCode.
  // Populated at startup from the full catalogue fetch, and augmented on-demand
  // during operation imports when a unit references an unseen asset.
  const assetCacheRef = useRef<Map<string, AssetEntry>>(new Map());

  // Equipment-type cache — keyed by NxgEquipmentType.primaryKey_.
  // Populated by fetchEquipmentTypes() and back-filled by import.
  const equipmentCacheRef = useRef<Map<string, EquipmentTypeRef>>(new Map());

  const fetchOperations = useCallback(async () => {
    setLoadingOperations(true);
    setErrorOperations(null);
    try {
      const ops: OsdkOperation[] = [];
      for await (const op of client(NxgOperation).asyncIter()) ops.push(op);
      rawOperationsRef.current = ops;
      setOperations(
        ops.map((op) => ({
          primaryKey: op.primaryKey_,
          terrainName: op.terrainName ?? "",
          startTime: op.startTime?.toString() ?? null,
          endTime: op.endTime?.toString() ?? null,
        }))
      );
    } catch (e) {
      setErrorOperations(String(e));
    } finally {
      setLoadingOperations(false);
    }
  }, []);

  // Snapshots are kept for the summary bar count only — the actual import now
  // uses links rather than snapshot key filtering.
  const fetchSnapshots = useCallback(async () => {
    setLoadingSnapshots(true);
    setErrorSnapshots(null);
    try {
      const snaps: Osdk.Instance<NxgForceStructureSnapshot>[] = [];
      for await (const s of client(NxgForceStructureSnapshot).asyncIter())
        snaps.push(s);

      setSnapshots(
        snaps.map((s) => ({
          primaryKey: s.primaryKey_,
          operationKey: s.operationKey ?? "",
          validFrom: s.validFrom?.toString() ?? null,
          validTo: s.validTo?.toString() ?? null,
        }))
      );
    } catch (e) {
      setErrorSnapshots(String(e));
    } finally {
      setLoadingSnapshots(false);
    }
  }, []);

  // Load the full VBS4 + Canonical catalogue up-front for the Asset tab
  // and to seed the asset cache for operation imports.
  const fetchAssets = useCallback(async () => {
    setLoadingAssets(true);
    setErrorAssets(null);
    try {
      const canonicalMap = new Map<
        string,
        {
          canonicalName: string;
          assetCategory: string;
          militaryDomain: string;
          branch: string;
        }
      >();
      for await (const c of client(NxgCanonicalAsset).asyncIter()) {
        const pk = c.primaryKey_ ?? "";

        if (pk)
          canonicalMap.set(pk, {
            canonicalName: c.canonicalName ?? "",
            assetCategory: c.assetCategory ?? "",
            militaryDomain: c.militaryDomain ?? "",
            branch: c.branch ?? "",
          });
      }

      const entries: AssetEntry[] = [];
      for await (const a of client(NxgVbs4AssetCatalogue).asyncIter()) {
        const canonical = a.canonicalAssetKey
          ? canonicalMap.get(a.canonicalAssetKey)
          : undefined;
        const partial: AssetEntry = {
          identifier: a.identifier ?? a.$primaryKey ?? "",
          classType: a.classType ?? "",
          domain: a.domain ?? "",
          description: a.description ?? "",
          nationality: a.nationality ?? "",
          isDrone: a.isDrone ?? false,
          simulationClass: a.simulationClass ?? "",
          gunnerSeatCount: a.gunnerSeatCount ?? null,
          numCargoSeats: a.numCargoSeats ?? null,
          hasCommander: a.hasCommander ?? null,
          canonicalName: canonical?.canonicalName ?? "",
          assetCategory: canonical?.assetCategory ?? "",
          militaryDomain: canonical?.militaryDomain ?? "",
          branch: canonical?.branch ?? "",

          templateIcon: "generic",
          templateEchelon: "platoon",
          templateCrew: 1,
        };

        partial.templateIcon = deriveIcon(partial);
        partial.templateEchelon = deriveEchelon(partial);
        partial.templateCrew = deriveCrew(partial);

        entries.push(partial);

        // Also seed the import-time cache by identifier (simulatorIdentifierCode)
        if (partial.identifier) {
          assetCacheRef.current.set(partial.identifier, partial);
        }
      }

      entries.sort((a, b) => {
        const aHas = a.canonicalName ? 1 : 0;
        const bHas = b.canonicalName ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return (a.canonicalName || a.identifier).localeCompare(
          b.canonicalName || b.identifier
        );
      });

      setAssetEntries(entries);
    } catch (e) {
      setErrorAssets(String(e));
    } finally {
      setLoadingAssets(false);
    }
  }, []);

  // Load the ontology's equipment-type catalogue once so we can label units
  // during import without a per-unit .$link.equipmentType fetch.
  const fetchEquipmentTypes = useCallback(async () => {
    setLoadingEquipmentTypes(true);
    setErrorEquipmentTypes(null);
    try {
      const entries: EquipmentTypeRef[] = [];
      for await (const et of client(NxgEquipmentType).asyncIter()) {
        const key = et.primaryKey_;
        if (!key) continue;
        const ref: EquipmentTypeRef = {
          key,
          nomenclature: et.nomenclature ?? key,
          description: et.description ?? undefined,
        };
        entries.push(ref);
        equipmentCacheRef.current.set(key, ref);
      }
      entries.sort((a, b) =>
        (a.nomenclature ?? a.key).localeCompare(b.nomenclature ?? b.key)
      );
      setEquipmentTypes(entries);
    } catch (e) {
      setErrorEquipmentTypes(String(e));
    } finally {
      setLoadingEquipmentTypes(false);
    }
  }, []);

  // ── Import operation via ontology links ────────────────────────────────────
  const importOperation = useCallback(
    async (
      opKey: string,
      opName: string,
      onImport: (side: Side) => Promise<void>
    ) => {
      const op = rawOperationsRef.current.find((o) => o.primaryKey_ === opKey);
      if (!op) throw new Error(`Operation "${opKey}" not found in cache`);

      const { units, edges, tacMap, snapshotName } =
        await importOperationViaLinks(
          op,
          assetCacheRef.current,
          equipmentCacheRef.current
        );

      const side = operationToSide(
        op,
        units,
        edges,
        tacMap,
        assetCacheRef.current,
        snapshotName || undefined,
        equipmentCacheRef.current
      );
      // Update visible equipment-types list if new keys were back-filled
      if (equipmentCacheRef.current.size !== equipmentTypes.length) {
        const merged = Array.from(equipmentCacheRef.current.values());
        merged.sort((a, b) =>
          (a.nomenclature ?? a.key).localeCompare(b.nomenclature ?? b.key)
        );
        setEquipmentTypes(merged);
      }
      await onImport({ ...side, name: opName || side.name });
    },
    [equipmentTypes.length]
  );

  const refresh = useCallback(() => {
    void fetchOperations();
    void fetchSnapshots();
    void fetchAssets();
    void fetchEquipmentTypes();
  }, [fetchOperations, fetchSnapshots, fetchAssets, fetchEquipmentTypes]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    operations,
    snapshots,
    assetEntries,
    equipmentTypes,
    loadingOperations,
    loadingSnapshots,
    loadingAssets,
    loadingEquipmentTypes,
    errorOperations,
    errorSnapshots,
    errorAssets,
    errorEquipmentTypes,
    importOperation,
    refresh,
  };
}
