// scripts/expandAutomatsOnce.ts
//
// One-off: print the reconcile payload that expands the three SWORD automats
// in OP-NORDIC-2026 into their real composition.
//
// Run through the real expandAutomat rather than hand-writing the units, so
// the rows written to the ontology are exactly what the app would generate for
// the same automats. Catalogue rows and parent units below are copied verbatim
// from the ontology (SWORD Asset Catalogue, NxgUnit) as at 2026-09-20.
//
//   npx tsx scripts/expandAutomatsOnce.ts

import { expandAutomat } from "../src/shared/orbat/swordComposition";
import { buildSwordFormationIndex, type OSwordFormationRow } from "../src/shared/orbat/swordFormations";
import type { CompositionNode } from "../src/shared/types/index";

const ROWS: OSwordFormationRow[] = [
  // ── automats ────────────────────────────────────────────────────────────
  {
    identifier: "ART.Guns firing battery|automat",
    displayName: "Artillery firing battery",
    disCode: "12.1.225.4.2.1.0",
    constituentUnits: "ART.Battery CP#1#1|ART.Guns firing platoon#2#2",
    commandPostUnit: "ART.Battery CP",
  },
  {
    identifier: "AAA.Surface to air battery|automat",
    displayName: "Artillery surface to air battery",
    disCode: "12.1.225.28.1.1.0",
    constituentUnits: "AAA.Surface to air battery CP#1#1|AAA.Surface to air defense platoon#4#4",
    commandPostUnit: "AAA.Surface to air battery CP",
  },
  {
    identifier: "INF.Mechanised company|automat",
    displayName: "Infantry company",
    disCode: "1.1.225.3.11.2.11",
    constituentUnits:
      "INF.Company CP#1#1|INF.Mortar section#1#1|INF.Mechanised platoon#3#3|INF.Anti-tank section#1#1",
    commandPostUnit: "INF.Company CP",
  },
  // ── units ───────────────────────────────────────────────────────────────
  { identifier: "ART.Battery CP|unit", displayName: "Artillery battery CP", disCode: "1.1.225.3.11.2.10", majorEquipmentType: "CP.Armored vehicle", majorEquipmentCount: "2", requiredCrew: "2" },
  { identifier: "ART.Guns firing platoon|unit", displayName: "Artillery firing platoon", disCode: "1.1.225.4.2.1.0", majorEquipmentType: "ART.Self Propelled Gun 155-mm", majorEquipmentCount: "4", requiredCrew: "4" },
  { identifier: "AAA.Surface to air battery CP|unit", displayName: "Artillery surface to air battery CP", disCode: "1.1.225.28.1.1.0", majorEquipmentType: "CP.Armored vehicle", majorEquipmentCount: "2", requiredCrew: "2" },
  { identifier: "AAA.Surface to air defense platoon|unit", displayName: "Artillery surface to air defence troop", disCode: "1.1.225.5.12.0.10", majorEquipmentType: "AAA.Anti-aircraft Tank", majorEquipmentCount: "3", requiredCrew: "3" },
  { identifier: "INF.Company CP|unit", displayName: "Infantry company CP", disCode: "1.1.225.3.11.2.11", majorEquipmentType: "CP.Armored vehicle", majorEquipmentCount: "1", requiredCrew: "3" },
  { identifier: "INF.Mortar section|unit", displayName: "Infantry mortar troop", disCode: "1.1.225.2.11.1.0", majorEquipmentType: "INF.Mortar Team", majorEquipmentCount: "2", requiredCrew: "2" },
  { identifier: "INF.Mechanised platoon|unit", displayName: "Infantry platoon", disCode: "", majorEquipmentType: "INF.Rifleman", majorEquipmentCount: "21", requiredCrew: "1" },
  { identifier: "INF.Anti-tank section|unit", displayName: "Infantry anti-tank platoon", disCode: "", majorEquipmentType: "INF.Armoured Personnel Carrier Antitank", majorEquipmentCount: "2", requiredCrew: "4" },
];

const INDEX = buildSwordFormationIndex(ROWS);

/** The three automat parents, as they stand in the ontology. */
const PARENTS: Array<CompositionNode & { keyPrefix: string; lat: number; lng: number }> = [
  {
    id: "UNIT-ART-BTY", keyPrefix: "UNIT-ARTBTY", lat: 59.24, lng: 25.93,
    unitIdentifier: "Close Support Artillery Battery", echelon: "Battery", sidc: "SFGPUCFH---D---",
    entityType: "organisation", militaryService: "Army", affiliation: "Friend", allegiance: "GBR",
    owningSimulator: "sword", canonicalAssetKey: null,
    simulatorIdentifierCode: "ART.Guns firing battery|automat",
    unitTypeKey: null, equipmentTypeKey: null, quantity: 1, children: [],
  },
  {
    id: "UNIT-AD-BTY", keyPrefix: "UNIT-ADBTY", lat: 59.265, lng: 25.97,
    unitIdentifier: "Air Defence Battery", echelon: "Battery", sidc: "SFGPUCDM---D---",
    entityType: "organisation", militaryService: "Army", affiliation: "Friend", allegiance: "GBR",
    owningSimulator: "sword", canonicalAssetKey: null,
    simulatorIdentifierCode: "AAA.Surface to air battery|automat",
    unitTypeKey: null, equipmentTypeKey: null, quantity: 1, children: [],
  },
  {
    id: "UNIT-D-COY", keyPrefix: "UNIT-DCOY", lat: 59.27, lng: 25.935,
    unitIdentifier: "D Company (Mechanised Infantry)", echelon: "Company", sidc: "SFGPUCII---E---",
    entityType: "organisation", militaryService: "Army", affiliation: "Friend", allegiance: "GBR",
    owningSimulator: "sword", canonicalAssetKey: null,
    simulatorIdentifierCode: "INF.Mechanised company|automat",
    unitTypeKey: null, equipmentTypeKey: null, quantity: 1, children: [],
  },
];

/**
 * Readable, stable primary keys — these rows are hand-seeded demo data.
 *
 * Built from the SWORD identifier rather than the display name: two of the
 * catalogue's display names ("Artillery surface to air battery CP" and
 * "Artillery surface to air defence troop") share their first 22 characters,
 * so keys derived from them are indistinguishable.
 */
function slug(swordIdentifier: string | null, fallback: string): string {
  const source = (swordIdentifier ?? "").replace(/\|unit$/, "") || fallback;
  return source.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
}

const units: Record<string, unknown>[] = [];
const edges: Record<string, unknown>[] = [];

for (const parent of PARENTS) {
  const expanded = expandAutomat(parent, INDEX, { newKey: () => "PLACEHOLDER" });
  if (!expanded) throw new Error(`no composition for ${parent.unitIdentifier}`);

  // The parent, demoted to structure exactly as expandAutomat left it.
  units.push({
    primaryKey: parent.id,
    unitIdentifier: expanded.unitIdentifier,
    entityType: expanded.entityType,
    owningSimulator: expanded.owningSimulator,
    dis: parent.id === "UNIT-ART-BTY" ? "12.1.225.4.2.1" : parent.id === "UNIT-AD-BTY" ? "12.1.225.28.1.1" : "1.1.225.3.11.2",
    canControlDrones: false,
    latitude: parent.lat, longitude: parent.lng,
    militaryService: expanded.militaryService, echelon: expanded.echelon, sidc: expanded.sidc,
    affiliation: expanded.affiliation, allegiance: expanded.allegiance,
  });

  // Quantity fans out into one row per formation, the same as planComposition.
  for (const child of expanded.children) {
    const base = slug(child.simulatorIdentifierCode, child.unitIdentifier.split(",")[0]);
    for (let i = 0; i < child.quantity; i++) {
      const pk = `${parent.keyPrefix}-${base}${child.quantity > 1 ? `-${i + 1}` : ""}`;
      const name = child.quantity > 1
        ? `${child.unitIdentifier.split(",")[0]} ${i + 1}, ${child.unitIdentifier.split(",").slice(1).join(",").trim()}`
        : child.unitIdentifier;
      units.push({
        primaryKey: pk,
        unitIdentifier: name,
        entityType: child.entityType,
        owningSimulator: child.owningSimulator,
        dis: child.canonicalAssetKey ?? "0.0.0.0.0.0.0",
        canControlDrones: false,
        latitude: parent.lat, longitude: parent.lng,
        militaryService: child.militaryService, echelon: child.echelon, sidc: child.sidc,
        affiliation: child.affiliation, allegiance: child.allegiance,
        simulatorIdentifierCode: child.simulatorIdentifierCode,
        // Needs reconcile_scenario_orbat >= 0.4.1. Before that it mapped
        // dis6Code to the property name "dis_6_code", which does not exist —
        // the Python OSDK calls it "dis6_code" — so create() raised TypeError
        // and the edit path dropped it through setattr. The first run of this
        // script had to omit it, leaving the sub-formations without their
        // canonical asset link until the fix shipped.
        ...(child.canonicalAssetKey ? { dis6Code: child.canonicalAssetKey } : {}),
      });
      edges.push({
        parentUnitKey: parent.id,
        childUnitKey: pk,
        relationshipTypeKey: "RELTYPE-ORGANIC",
        validFrom: "2026-09-15",
      });
    }
  }
}

console.log(JSON.stringify({
  operation: { primaryKey: "OP-NORDIC-2026" },
  unitHierarchy: {
    primaryKey: "OP-NORDIC-2026-HIERARCHY",
    name: "OP-NORDIC-2026 Hierarchy",
    validFrom: "2026-09-15",
    validTo: "2026-09-30",
  },
  units,
  unitHierarchyEdges: edges,
  managedChildUnitKeys: edges.map((e) => e.childUnitKey),
}));
