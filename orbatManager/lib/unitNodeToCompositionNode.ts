/**
 * unitNodeToCompositionNode.ts
 *
 * Bridge between the GroupBuilder's UnitNode model and the HierarchyMap's
 * CompositionNode model.  Zero changes needed to HierarchyMap.tsx — it always
 * receives CompositionNode[].
 *
 * SIDC derivation:
 *   Uses the same 15-character APP-6D letter format already used in
 *   CompositionNodeEditor.tsx (S[aff][battleDim]P[funcId][echelon]---).
 */

import type { UnitNode, CompositionNode, UnitIconType, EchelonLevel } from "../../../types";
import { v4 as uuidv4 } from "uuid";

// ── Affiliation code (position 2) ──────────────────────────────────────────
const AFF_CODES: Record<string, string> = {
  "Friend":         "F",
  "Hostile":        "H",
  "Neutral":        "N",
  "Unknown":        "U",
  "Assumed Friend": "A",
  "Suspect":        "S",
  "Pending":        "P",
};



// ── Icon → SIDC function ID (positions 6-10) ──────────────────────────────
// Covers the most common icons; falls back to generic infantry (UCI--)
// 3-char function code (positions 5-7), matching real ontology SIDC format
const ICON_FUNC3: Record<UnitIconType, string> = {
  infantry:           "UCI",
  armour:             "UCA",
  mechanisedInfantry: "UCZ",
  artillery:          "UCF",
  rocketArtillery:    "UCF",
  mortar:             "UCF",
  aviation:           "UCA",
  airForce:           "MFF",
  reconnaissance:     "UCR",
  cavalry:            "UCA",
  engineer:           "UCE",
  pioneer:            "UCE",
  signals:            "USS",
  cyber:              "USC",
  ew:                 "USE",
  logistics:          "USM",
  maintenance:        "USM",
  medical:            "UMC",
  airDefence:         "UAA",
  specialForces:      "UUS",
  sniper:             "UUI",
  antiTank:           "UCA",
  naval:              "SS-",
  cbrn:               "UXC",
  military_police:    "UMP",
  headquarters:       "UH-",
  generic:            "UCI",
};

// Echelon at position 8 (1 char)
const ECH_POS8: Record<EchelonLevel, string> = {
  team:      "A",
  squad:     "B",
  section:   "C",
  platoon:   "D",
  company:   "E",
  battalion: "F",
  regiment:  "G",
  brigade:   "H",
  division:  "I",
  corps:     "J",
  army:      "K",
  armyGroup: "K",
  theatre:   "L",
};

function buildSidc(
  affiliation: string,
  icon: UnitIconType,
  echelon: EchelonLevel,
): string {
  const aff  = AFF_CODES[affiliation] ?? "F";
  const func = ICON_FUNC3[icon] ?? "UCI";
  const ech  = ECH_POS8[echelon] ?? "-";
  // Format: S[aff]GP[func3]-[ech]------ = 15 chars
  // matches real ontology format e.g. SFGPUCI-E------
  return `S${aff}GP${func}-${ech}------`;
}

// ── Converter ─────────────────────────────────────────────────────────────

/**
 * Convert a UnitNode (from GroupBuilderPanel) into a CompositionNode
 * (for HierarchyMap).  Preserves catalogue asset linkage.
 *
 * @param unit        The UnitNode to convert.
 * @param affiliation The affiliation string from the parent UnitGroup
 *                    (e.g. "Friend", "Hostile"). Used to derive SIDC.
 */
export function unitNodeToCompositionNode(
  unit: UnitNode,
  affiliation: string,
): CompositionNode {
  // Prefer an explicitly set SIDC on the symbol; otherwise derive one
  const sidc =
    unit.symbol.sidc ??
    buildSidc(affiliation, unit.symbol.icon, unit.echelon);

  return {
    id: unit.id,
    unitIdentifier: unit.name,
    echelon: unit.echelon,
    sidc,
    entityType: "organisation",
    militaryService: "Army",
    // Carried across from the UnitNode so the Group Builder's catalogue choice
    // survives conversion into the graph model.
    simulatorIdentifierCode: unit.simulatorIdentifierCode ?? null,
    affiliation,
    allegiance: "GBR",
    owningSimulator: "vbs4",
    canonicalAssetKey: unit.canonicalAssetKey ?? null,
    unitTypeKey: unit.unitTypeKey ?? null,
    equipmentTypeKey: unit.equipmentTypeKey ?? null,
    quantity: 1,
    children: unit.children.map((c) => unitNodeToCompositionNode(c, affiliation)),
  };
}

/**
 * Convert all UnitGroups from the store into CompositionNode roots for the map.
 * Each group becomes one root node whose children are its top-level units.
 * If a group has only one root unit, that unit itself becomes the root.
 */
export function groupsToCompositionNodes(
  groups: Array<{ id: string; name: string; affiliation: string; units: UnitNode[] }>,
): CompositionNode[] {
  const result: CompositionNode[] = [];
  for (const group of groups) {
    if (group.units.length === 0) continue;
    if (group.units.length === 1) {
      // Single root unit — use it directly
      result.push(unitNodeToCompositionNode(group.units[0], group.affiliation));
    } else {
      // Multiple root units — wrap in a synthetic group node
      const groupNode: CompositionNode = {
        id: group.id,
        unitIdentifier: group.name,
        echelon: "brigade",
        sidc: buildSidc(group.affiliation, "headquarters", "brigade"),
        entityType: "organisation",
        militaryService: "Army",
        affiliation: group.affiliation,
        allegiance: "GBR",
        owningSimulator: "vbs4",
        canonicalAssetKey: null,
        simulatorIdentifierCode: null,
        unitTypeKey: null,
        equipmentTypeKey: null,
        quantity: 1,
        children: group.units.map((u) =>
          unitNodeToCompositionNode(u, group.affiliation),
        ),
      };
      result.push(groupNode);
    }
  }
  return result;
}

/** Generate a stable placeholder id (used for synthetic group wrappers) */
export function stableId(prefix: string): string {
  return `${prefix}-${uuidv4()}`;
}
