// ============================================================
//  Platform Context — Assignment Discovery & Mutation Helpers
// ============================================================

import type { UnitNode, AssetNode, AssetSection } from "./types.js";

export interface PlatformAssignment {
  parentUnit: UnitNode;
  asset: AssetNode;
  section: AssetSection | null;
  sectionPath: string[];
}

/** Recursively search sections for a unit assignment, returning path. */
function findInSections(
  sections: AssetSection[],
  unitId: string,
  path: string[] = []
): { section: AssetSection; path: string[] } | null {
  for (const sec of sections) {
    if ((sec.assignedUnitIds ?? []).includes(unitId)) {
      return { section: sec, path: [...path, sec.name] };
    }
    const found = findInSections(sec.subSections, unitId, [...path, sec.name]);
    if (found) return found;
  }
  return null;
}

/**
 * Walk ALL units in the group to find every platform assignment for a given unitId.
 * Returns array of PlatformAssignment — typically 0–1, but a unit could be in multiple.
 */
export function findPlatformAssignments(
  groupUnits: UnitNode[],
  unitId: string
): PlatformAssignment[] {
  const results: PlatformAssignment[] = [];

  function walkUnits(units: UnitNode[]) {
    for (const u of units) {
      for (const asset of u.assets ?? []) {
        const assetLevelAssigned = (asset.assignedUnitIds ?? []).includes(
          unitId
        );
        const inSection = findInSections(asset.sections, unitId);
        if (assetLevelAssigned || inSection) {
          results.push({
            parentUnit: u,
            asset,
            section: inSection?.section ?? null,
            sectionPath: inSection?.path ?? [],
          });
        }
      }
      walkUnits(u.children);
    }
  }

  walkUnits(groupUnits);
  return results;
}

/**
 * Toggle a unit's assignment in an asset at either platform level or section level.
 * When assigning to a section, also ensures unit is NOT at asset-level (prevent duplication).
 * When assigning to asset-level, removes from all sections first.
 * Returns the modified assets array (new references).
 */
export function toggleUnitInAsset(
  parentUnit: UnitNode,
  assetId: string,
  unitId: string,
  sectionId: string | null,
  assign: boolean
): UnitNode["assets"] {
  return (parentUnit.assets ?? []).map((asset) => {
    if (asset.id !== assetId) return asset;

    let newAssignedUnitIds = [...(asset.assignedUnitIds ?? [])];

    if (sectionId === null) {
      // Asset-level: remove from all sections first, then set asset-level
      const cleanedSections = removeUnitFromAllSections(asset.sections, unitId);
      if (assign && !newAssignedUnitIds.includes(unitId)) {
        newAssignedUnitIds.push(unitId);
      } else if (!assign) {
        newAssignedUnitIds = newAssignedUnitIds.filter((id) => id !== unitId);
      }
      return {
        ...asset,
        assignedUnitIds: newAssignedUnitIds,
        sections: cleanedSections,
      };
    } else {
      // Section-level: remove from asset-level AND all other sections, then add to target section
      newAssignedUnitIds = newAssignedUnitIds.filter((id) => id !== unitId);
      const cleanedSections = removeUnitFromAllSections(asset.sections, unitId);
      const newSections = assign
        ? toggleInSections(cleanedSections, sectionId, unitId, true)
        : removeUnitFromAllSections(asset.sections, unitId);
      return {
        ...asset,
        assignedUnitIds: newAssignedUnitIds,
        sections: newSections,
      };
    }
  });
}

/** Remove a unit from ALL sections (recursively) in a sections tree. */
function removeUnitFromAllSections(
  sections: AssetSection[],
  unitId: string
): AssetSection[] {
  return sections.map((sec) => ({
    ...sec,
    assignedUnitIds: (sec.assignedUnitIds ?? []).filter((id) => id !== unitId),
    subSections: removeUnitFromAllSections(sec.subSections, unitId),
  }));
}

function toggleInSections(
  sections: AssetSection[],
  sectionId: string,
  unitId: string,
  assign: boolean
): AssetSection[] {
  return sections.map((sec) => {
    if (sec.id === sectionId) {
      let ids = [...(sec.assignedUnitIds ?? [])];
      if (assign && !ids.includes(unitId)) ids.push(unitId);
      else if (!assign) ids = ids.filter((id) => id !== unitId);
      return { ...sec, assignedUnitIds: ids };
    }
    return {
      ...sec,
      subSections: toggleInSections(sec.subSections, sectionId, unitId, assign),
    };
  });
}

/** Flatten a section tree into depth-annotated list. */
export interface FlatSection {
  section: AssetSection;
  path: string[];
  depth: number;
}

export function flattenSections(
  sections: AssetSection[],
  path: string[] = [],
  depth = 0
): FlatSection[] {
  return sections.flatMap((sec) => [
    { section: sec, path, depth },
    ...flattenSections(sec.subSections, [...path, sec.name], depth + 1),
  ]);
}

/** Flatten ALL descendants of a UnitNode (including all depths) */
export function flattenAllDescendants(units: UnitNode[]): UnitNode[] {
  const result: UnitNode[] = [];
  function walk(nodes: UnitNode[]) {
    for (const u of nodes) {
      result.push(u);
      walk(u.children);
    }
  }
  walk(units);
  return result;
}

/** Generate a unique id */
export function mkId(): string {
  return crypto.randomUUID();
}

/** Check if a unit (by id) has any platform assignment in the group tree */
export function hasPlatformAssignment(
  groupUnits: UnitNode[],
  unitId: string
): boolean {
  return findPlatformAssignments(groupUnits, unitId).length > 0;
}

/** Default crew sections by platform category/preset. */
export function defaultCrewSections(
  presetId: string,
  crewCount: number
): AssetSection[] {
  const mk = (
    name: string,
    count: number,
    role?: string,
    subs: AssetSection[] = []
  ): AssetSection => ({
    id: mkId(),
    name,
    personnelCount: count,
    role,
    subSections: subs,
    assignedUnitIds: [],
  });

  const cat = presetId.toLowerCase();

  if (cat.includes("submarine") || cat.includes("sub")) {
    const co = Math.ceil(crewCount * 0.05);
    const wep = Math.ceil(crewCount * 0.18);
    const eng = Math.ceil(crewCount * 0.38);
    const ops = Math.ceil(crewCount * 0.22);
    const sup = crewCount - co - wep - eng - ops;
    return [
      mk("Command Section", co, "CO, XO, COB, navigation", [
        mk("Command", 2, "CO/XO"),
        mk("Navigation", Math.max(1, co - 2), "Nav team"),
      ]),
      mk("Weapons Department", wep, "Torpedoes, missiles, sonar", [
        mk("Torpedo Room", Math.ceil(wep * 0.5), "role"),
        mk("Fire Control", Math.ceil(wep * 0.25), "role"),
        mk("Sonar", Math.floor(wep * 0.25), "role"),
      ]),
      mk(
        "Engineering Department",
        eng,
        "Propulsion, nuclear plant, electrical",
        [
          mk("Nuclear Plant", Math.ceil(eng * 0.45), "role"),
          mk("Propulsion", Math.ceil(eng * 0.35), "role"),
          mk("Electrical", Math.floor(eng * 0.2), "role"),
        ]
      ),
      mk("Operations Department", ops, "Radio, signals, intelligence"),
      mk("Supply Department", Math.max(1, sup), "Logistics, medical, galley"),
    ];
  }

  if (
    cat.includes("frigate") ||
    cat.includes("destroyer") ||
    cat.includes("ship") ||
    cat.includes("corvette")
  ) {
    const half = Math.ceil(crewCount / 2);
    return [
      mk("Bridge / Navigation", Math.ceil(crewCount * 0.08)),
      mk("Weapons Department", Math.ceil(crewCount * 0.22)),
      mk("Operations Department", Math.ceil(crewCount * 0.18)),
      mk("Engineering Department", Math.ceil(crewCount * 0.28)),
      ...(crewCount > 150
        ? [mk("Air Department", Math.ceil(crewCount * 0.08))]
        : []),
      mk("Supply Department", crewCount - half),
    ];
  }

  if (cat.includes("carrier")) {
    return [
      mk("Command", Math.ceil(crewCount * 0.03)),
      mk("Air Wing", Math.ceil(crewCount * 0.35)),
      mk("Deck Department", Math.ceil(crewCount * 0.15)),
      mk("Engineering Department", Math.ceil(crewCount * 0.2)),
      mk("Operations Department", Math.ceil(crewCount * 0.12)),
      mk("Supply Department", Math.floor(crewCount * 0.15)),
    ];
  }

  if (
    cat.includes("mbt") ||
    cat.includes("tank") ||
    cat.includes("challenger") ||
    cat.includes("abrams") ||
    cat.includes("leopard") ||
    cat.includes("t-90")
  ) {
    return [
      mk("Commander", 1, "Commands the vehicle"),
      mk("Gunner", 1, "Operates main armament"),
      mk("Loader", 1, "Loads main gun"),
      mk("Driver", 1, "Drives the vehicle"),
    ];
  }

  if (
    cat.includes("ifv") ||
    cat.includes("warrior") ||
    cat.includes("bradley") ||
    cat.includes("apc") ||
    cat.includes("boxer") ||
    cat.includes("bmp") ||
    cat.includes("cv-90")
  ) {
    return [
      mk("Commander", 1, "Vehicle commander"),
      mk("Gunner", 1, "Operates weapon station"),
      mk("Driver", 1, "Drives the vehicle"),
      mk(
        "Dismounts",
        Math.max(1, crewCount - 3),
        "Dismounted infantry section"
      ),
    ];
  }

  if (
    cat.includes("helicopter") ||
    cat.includes("apache") ||
    cat.includes("chinook") ||
    cat.includes("merlin") ||
    cat.includes("wildcat") ||
    cat.includes("puma") ||
    cat.includes("blackhawk")
  ) {
    return [
      mk("Flight Crew", Math.min(3, crewCount), "Pilots and crew"),
      mk("Ground Crew", Math.max(1, crewCount - 3), "Maintenance and support"),
    ];
  }

  if (
    cat.includes("fixed") ||
    cat.includes("typhoon") ||
    cat.includes("f-35") ||
    cat.includes("tornado") ||
    cat.includes("f-16") ||
    cat.includes("a-10")
  ) {
    return [
      mk("Pilot", 1, "Aircraft commander / pilot"),
      ...(crewCount > 1 ? [mk("Weapons System Officer", crewCount - 1)] : []),
    ];
  }

  // Generic fallback: crew only
  return [mk("Crew", crewCount, "Vehicle crew")];
}
