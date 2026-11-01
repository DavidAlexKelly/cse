// scenarioPlanning/types.ts — local UI types.
//
// The `UnitTemplate` shape below is intentionally aligned with the ORBAT
// Manager's `NxgUnit` object type (see src/apps/orbatManager/lib/foundry.ts
// and the `NxgUnit` OSDK definition) so that a unit dropped from the Map
// Items palette carries the same primary attributes the ORBAT Manager
// stores: SIDC (APP-6D 15-char), echelon, entityType, militaryService,
// affiliation. This keeps the two apps semantically coherent even though
// the map placement itself is a local-only visual (not persisted as an
// NxgUnit).

/**
 * Entity type — matches `NxgUnit.entityType` in the ontology.
 * See ORBAT Manager `CompositionNode.entityType`.
 */
export type UnitEntityType = "organisation" | "vehicle" | "human" | "aircraft";

/**
 * Echelon — matches `NxgUnit.echelon` in the ontology (subset used by the
 * palette; the full ontology list is on the object type constraint).
 * Blank string is used for platform-level entities (individual vehicle /
 * dismounted soldier) that don't carry an echelon glyph.
 */
export type UnitEchelon =
  | ""
  | "Crew"
  | "Team"
  | "Squad"
  | "Section"
  | "Platoon"
  | "Detachment"
  | "Troop"
  | "Company"
  | "Battery"
  | "Battalion"
  | "Squadron"
  | "Regiment"
  | "Group"
  | "Brigade"
  | "Division"
  | "Corps"
  | "Army"
  | "Army Group"
  | "Region"
  | "Command"
  | "Component Command"
  | "Combatant Command"
  | "Flight"
  | "Wing"
  | "Air Force"
  | "Fleet"
  | "Vessel"
  | "Other";

/**
 * Military service — matches the ORBAT Manager's `militaryService`
 * property values (see NxgUnit constraint).
 */
export type MilitaryService =
  | "Army"
  | "Marines"
  | "Navy"
  | "Air Force"
  | "Air Defense Force"
  | "Special Operations Force"
  | "Airborne Force"
  | "Medical Service"
  | "Logistics Service"
  | "Military Police"
  | "Joint"
  | "Other";

/**
 * A selectable entry in the Map Items palette.
 *
 * Shape is a UI-friendly projection of `NxgUnit`: same SIDC, same category
 * vocabulary. When a template is placed on the map we spawn a `PlacedUnit`
 * (local-only), but the descriptive fields carry through so an operator
 * seeing e.g. "Armoured Troop" on the map recognises the same term used in
 * the ORBAT Manager.
 */
export interface UnitTemplate {
  id: string;
  label: string;
  description: string;
  /** 15-char APP-6D / 2525C SIDC — the same format used by NxgUnit.sidc. */
  sidc: string;
  entityType: UnitEntityType;
  echelon: UnitEchelon;
  militaryService: MilitaryService;
  /** Broad grouping used by the category chip row. */
  category:
    | "HQ"
    | "Infantry"
    | "Armour"
    | "Recce"
    | "Artillery"
    | "Aviation"
    | "Air Defence"
    | "Engineer"
    | "Signal"
    | "CBRN"
    | "Medical"
    | "Logistics"
    | "Special Forces"
    | "Military Police"
    | "Naval"
    | "UAS";
}

export interface PlacedUnit {
  id: string;          // uuid
  templateId: string;
  label: string;
  sidc: string;
  lat: number;
  lng: number;
  /**
   * Force affiliation of the placed unit. Drives the position-2 char of the
   * rendered SIDC ("F" = friend / blue, "H" = hostile / red / opponent).
   * Kept as a semantic field on the placed unit (rather than being baked
   * only into `sidc`) so the palette can flip existing units in-place
   * when the user toggles the Blue/Red mode.
   *
   * Optional so pre-existing fixtures / mock data (which encode
   * affiliation directly in the SIDC's position-2 char) continue to
   * type-check unchanged. New placements always set this explicitly;
   * downstream code that needs a canonical value should fall back to
   * inspecting `sidc[1]`.
   */
  affiliation?: "friend" | "hostile";
  /**
   * Root NxgUnit of this placement's ORBAT graph, and the NxgUnitHierarchy it
   * lives in. Mirrors MapUnitPlacement — see the note there. Undefined means
   * "no ORBAT defined yet", which the map renders as a red "!" badge.
   */
  orbatRootUnitKey?: string;
  orbatHierarchyKey?: string;
  /** True while the ORBAT is the auto-generated basic one — see
   *  MapUnitPlacement.orbatIsBasic. */
  orbatIsBasic?: boolean;
  /** Planner's chosen parent, overriding the derived one — see
   *  MapUnitPlacement.orbatParentUnitKey. */
  orbatParentUnitKey?: string;
}

