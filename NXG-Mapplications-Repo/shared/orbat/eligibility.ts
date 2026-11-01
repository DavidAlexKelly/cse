// src/shared/orbat/eligibility.ts
//
// Which placed units take part in the scenario ORBAT.
//
// LAND UNITS ONLY for now.
//
// The Scenario Planner map carries more than land formations — Operation
// BALTIC SHIELD alone places an Amphibious Ready Group, two destroyer escorts
// and an adversary ISR satellite. None of those has a land ORBAT: the echelon
// ladder in skeleton.ts (Army Group → … → Team) has no naval or space
// equivalent, so generating a "3 Bde / 2 Bn / A Coy" skeleton beneath a
// destroyer would invent structure that does not exist.
//
// Ineligible placements are skipped completely rather than treated as units
// that are missing something: no ORBAT is generated on placement, no badge is
// drawn on the marker, and the Define ORBAT menu item is hidden. The ORBAT tab
// says why instead of showing an error.
//
// Air is excluded along with them for now. An aviation ORBAT (wing → squadron
// → flight) is meaningful and the ladder half-supports it, but it is out of
// scope until asked for: add "A" to ORBAT_DIMENSIONS to turn it on, and give
// SUBORDINATE_COUNT / ECHELON_ABBREV in skeleton.ts the air echelons first.

import {
  UNIT_ARCHETYPES,
  UNIT_TEMPLATES,
} from "../../apps/scenarioPlanner/map/unitTemplates";

/** APP-6 battle dimension: Ground, Air, Sea surface, sUbsurface, sPace. */
export type BattleDimension = "G" | "A" | "S" | "U" | "P";

/** Battle dimensions that carry an ORBAT. */
const ORBAT_DIMENSIONS: ReadonlySet<BattleDimension> = new Set<BattleDimension>(["G"]);

/** Human-readable reason, per excluded dimension. */
const EXCLUDED_LABEL: Record<string, string> = {
  S: "a surface vessel",
  U: "a subsurface vessel",
  P: "a space platform",
  A: "an air platform",
};

interface UnitLike {
  templateId?: string;
  sidc?: string;
}

/**
 * Resolve a placement's battle dimension.
 *
 * The archetype/template it was created from is authoritative — that is what
 * built the SIDC in the first place (see unitTemplates.buildTemplateSidc) — and
 * it survives a SIDC that has been hand-edited or truncated. SIDC position 3
 * is the fallback.
 *
 * Placements carry either a bare archetype id ("destroyer") or the flat
 * template id ("destroyer__Vessel"), so both are matched.
 */
export function battleDimension(unit: UnitLike): BattleDimension | null {
  const templateId = unit.templateId;
  if (templateId) {
    const archetype =
      UNIT_ARCHETYPES.find((a) => a.id === templateId) ??
      UNIT_ARCHETYPES.find((a) => templateId.startsWith(`${a.id}__`));
    if (archetype) return archetype.dim;

    const template = UNIT_TEMPLATES.find((t) => t.id === templateId);
    const fromTemplate = template?.sidc?.[2]?.toUpperCase();
    if (fromTemplate && isBattleDimension(fromTemplate)) return fromTemplate;
  }

  const fromSidc = unit.sidc?.[2]?.toUpperCase();
  if (fromSidc && isBattleDimension(fromSidc)) return fromSidc;
  return null;
}

function isBattleDimension(char: string): char is BattleDimension {
  return char === "G" || char === "A" || char === "S" || char === "U" || char === "P";
}

/**
 * True when this placement should have an ORBAT.
 *
 * An unresolvable dimension counts as eligible: ground is the dominant case by
 * a wide margin (a malformed SIDC on a mech battalion is far more likely than
 * one on a frigate), and the cost of being wrong that way is a spurious ORBAT
 * rather than a land unit silently losing its force structure.
 */
export function isOrbatEligible(unit: UnitLike): boolean {
  const dim = battleDimension(unit);
  if (dim === null) return true;
  return ORBAT_DIMENSIONS.has(dim);
}

/**
 * Sentence for the ORBAT tab explaining why there is nothing to show, or null
 * when the unit is eligible.
 */
export function orbatIneligibleReason(unit: UnitLike & { label?: string }): string | null {
  if (isOrbatEligible(unit)) return null;
  const dim = battleDimension(unit);
  const what = (dim && EXCLUDED_LABEL[dim]) ?? "not a land unit";
  const who = unit.label ? `${unit.label} is` : "This unit is";
  return (
    `${who} ${what}. ORBATs are generated for land units only at this stage, ` +
    `so no force structure is created for it.`
  );
}
