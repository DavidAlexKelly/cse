// src/shared/lib/compositionPlan.ts
//
// Pure composition planning: no OSDK client, no ontology calls, no DOM.
//
// Split out of foundry.ts for the same reason model.ts is split out of
// scenarioOrbat.ts — foundry.ts imports "@/client", which reads configuration
// from <meta> tags at module load, so anything importing it drags a browser
// dependency in and cannot be unit tested.
//
// Expanding a CompositionNode tree into rows is where the interesting rules
// live (quantity fan-out, which nodes get a map symbol, crew moving with their
// vehicle, which relationship key edges carry). Those rules are worth testing
// directly, and they are also what has to be correct *before* anything is sent
// to Foundry, because batching assigns every primary key up front.

import { v4 as uuidv4 } from "uuid";
import type {
  createNxgUnit,
  createNxgTacticalGraphicSymbol,
  createNxgUnitHierachyEdge,
} from "@nxg-simulation-execution-testing/sdk";
import type { CompositionNode } from "../types/index";
import { ORGANIC_RELATIONSHIP_KEY, ontologyDate } from "../orbat/model";

/**
 * Determines whether a node should get a map symbol.
 *
 * Rules:
 * - vehicle / aircraft → always placeable (they ARE the platform)
 * - human → placeable only if its parent is NOT a vehicle/aircraft
 *   (i.e. dismounted crew; crew inside a vehicle move with the vehicle)
 * - organisation → never placeable directly (structural node only)
 */
export function isPlaceableUnit(
  node: CompositionNode,
  parentEntityType?: CompositionNode["entityType"],
): boolean {
  if (node.entityType === "vehicle" || node.entityType === "aircraft") return true;
  if (node.entityType === "human") {
    return parentEntityType !== "vehicle" && parentEntityType !== "aircraft";
  }
  return false;
}

/**
 * Collect all placeable leaf-level units from a composition tree,
 * in depth-first order.
 */
export function collectPlaceableNodes(
  node: CompositionNode,
  parentEntityType?: CompositionNode["entityType"],
): CompositionNode[] {
  const results: CompositionNode[] = [];
  if (isPlaceableUnit(node, parentEntityType)) {
    results.push(node);
    // Don't recurse into children of a vehicle — crew move with the vehicle
    if (node.entityType === "vehicle" || node.entityType === "aircraft") {
      return results;
    }
  }
  for (const child of node.children) {
    results.push(...collectPlaceableNodes(child, node.entityType));
  }
  return results;
}

/**
 * Everything a composition write needs, computed with no network calls.
 *
 * Splitting the plan from the write is what makes batching possible: primary
 * keys are assigned up front, so an edge can reference its parent and child
 * before either has been persisted.
 */
export interface CompositionPlan {
  rootUnitKey: string;
  units: createNxgUnit.Params[];
  symbols: createNxgTacticalGraphicSymbol.Params[];
  edges: createNxgUnitHierachyEdge.Params[];
}

export function planComposition(
  hierarchyKey: string,
  root: CompositionNode,
  rootLat: number,
  rootLng: number,
  /** Injectable for deterministic tests. */
  newKey: () => string = uuidv4,
): CompositionPlan {
  const units: createNxgUnit.Params[] = [];
  const symbols: createNxgTacticalGraphicSymbol.Params[] = [];
  const edges: createNxgUnitHierachyEdge.Params[] = [];
  const validFrom = ontologyDate();

  function walk(
    node: CompositionNode,
    parentUnitKey: string | null,
    parentEntityType: CompositionNode["entityType"] | undefined,
  ): void {
    for (let i = 0; i < Math.max(1, node.quantity); i++) {
      const unitKey = newKey();
      const identifier =
        node.quantity > 1 ? `${node.unitIdentifier} ${i + 1}` : node.unitIdentifier;

      const unitParams: createNxgUnit.Params = {
        primaryKey: unitKey,
        unitIdentifier: identifier,
        militaryService: node.militaryService,
        echelon: node.echelon,
        sidc: node.sidc,
        affiliation: node.affiliation,
        allegiance: node.allegiance,
        entityType: node.entityType,
        owningSimulator: node.owningSimulator,
        dis: "0.0.0.0.0.0.0",
        canControlDrones: false,
        canonicalAssetKey: node.canonicalAssetKey ?? null,
        latitude: null, // position set later on the map
        longitude: null,
        unitTypeKey: node.unitTypeKey ?? null,
        equipmentTypeKey: node.equipmentTypeKey ?? null,
        // The chosen simulator model — the FK the simulator export resolves.
        // The app used to write this into equipmentTypeKey, which is the FK to
        // NxgEquipmentType, so the catalogue link was never made and a
        // dangling equipment link was created in its place.
        simulatorIdentifierCode: node.simulatorIdentifierCode ?? null,
      };

      units.push(unitParams);

      // Only create a symbol for placeable units — vehicles, aircraft, and
      // dismounted humans (not crew inside a vehicle). Placeholder coords; the
      // user drags the marker on the ORBAT map.
      if (isPlaceableUnit(node, parentEntityType)) {
        symbols.push({
          primaryKey: newKey(),
          unitKey,
          sidc: node.sidc,
          latitude: rootLat,
          longitude: rootLng,
          directionOfMovement: null,
        });
      }

      if (parentUnitKey) {
        edges.push({
          primaryKey: newKey(),
          hierarchyKey,
          parentUnitKey,
          childUnitKey: unitKey,
          // FK into NxgUnitHierarchyNodeRelationshipType. See model.ts — this
          // used to be "COMMAND", which matched no row, so every edge write
          // was rejected by the ontology.
          relationshipTypeKey: ORGANIC_RELATIONSHIP_KEY,
          validFrom,
          validTo: null,
        });
      }

      // Recurse — but skip children of vehicles/aircraft (crew move with the platform)
      if (node.entityType !== "vehicle" && node.entityType !== "aircraft") {
        for (const child of node.children) {
          walk(child, unitKey, node.entityType);
        }
      }
    }
  }

  walk(root, null, undefined);

  return { rootUnitKey: units[0]?.primaryKey ?? "", units, symbols, edges };
}
