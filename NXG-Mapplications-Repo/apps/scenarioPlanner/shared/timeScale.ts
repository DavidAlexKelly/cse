// src/apps/scenarioPlanner/shared/timeScale.ts
// Time-scale and movement/combat-power reference tables for the
// deterministic order-resolution engine (phaseCreator/resolveOrders.ts).
import type { UnitTemplate, UnitEchelon } from "../map/types";
import type { Phase, PhaseOffsetUnit } from "./types";

export interface TimeScaleConfig {
  hoursPerDayOffset: number;
}

export const DEFAULT_TIME_SCALE: TimeScaleConfig = {
  hoursPerDayOffset: 24,
};

export function dayOffsetSpanToHours(
  startOffset: number,
  endOffset: number,
  timeScale: TimeScaleConfig = DEFAULT_TIME_SCALE,
): number {
  return Math.max(0, endOffset - startOffset) * timeScale.hoursPerDayOffset;
}

export function hoursToDayOffsetSpan(
  durationHours: number,
  timeScale: TimeScaleConfig = DEFAULT_TIME_SCALE,
): number {
  return durationHours / timeScale.hoursPerDayOffset;
}

// ─── Phase offsets (D+n vs H+n) ──────────────────────────────────────────────
//
// Scenarios differ: IRON FORGE 26 is day-based, NEXGEN 2026 is hour-based.
// Everything downstream (order feasibility, reachability budgets, end-state
// resolution) needs REAL hours, and every label needs the right prefix.

/** Hours represented by one unit of a phase's offsets. */
export function hoursPerOffsetUnit(
  unit: PhaseOffsetUnit | undefined,
  timeScale: TimeScaleConfig = DEFAULT_TIME_SCALE,
): number {
  return unit === "hour" ? 1 : timeScale.hoursPerDayOffset;
}

/**
 * Duration of a phase in real hours, honouring its offset unit.
 * Returns 0 for a zero-length phase — callers decide on a floor.
 */
export function phaseDurationHours(
  phase: Pick<Phase, "startOffset" | "endOffset" | "offsetUnit">,
  timeScale: TimeScaleConfig = DEFAULT_TIME_SCALE,
): number {
  const span = Math.max(0, phase.endOffset - phase.startOffset);
  return span * hoursPerOffsetUnit(phase.offsetUnit, timeScale);
}

/** Render an offset the way its scenario expresses it — "D+2" or "H+18". */
export function formatPhaseOffset(
  value: number,
  unit: PhaseOffsetUnit | undefined,
): string {
  const prefix = unit === "hour" ? "H" : "D";
  return `${prefix}${value >= 0 ? "+" : "-"}${Math.abs(value)}`;
}

/**
 * Parse an NxgPhase offset string into a value + unit.
 *
 * Scenarios use different scales:
 *   IRON FORGE 26 → "D+0" … "D+14"   (days)
 *   NEXGEN 2026   → "H+0" … "H+42"   (hours)
 * plus the "D-Day" / "H-Hour" spellings for zero.
 *
 * The previous implementation only matched /^D([+-])(\d+)$/, so every NEXGEN
 * phase silently parsed to 0 — giving every phase a zero-length window, which
 * broke order feasibility, the reachability budget and the timeline labels.
 */
export function parsePhaseOffset(
  raw: string | null | undefined,
): { value: number; unit: PhaseOffsetUnit } | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (trimmed === "D" || trimmed === "D-DAY" || trimmed === "DDAY") {
    return { value: 0, unit: "day" };
  }
  if (trimmed === "H" || trimmed === "H-HOUR" || trimmed === "HHOUR") {
    return { value: 0, unit: "hour" };
  }
  const match = /^([DH])([+-])(\d+)$/.exec(trimmed);
  if (!match) return null;
  return {
    value: (match[2] === "-" ? -1 : 1) * Number(match[3]),
    unit: match[1] === "H" ? "hour" : "day",
  };
}

/** "D+0 → D+2" / "H+18 → H+29" */
export function formatPhaseWindow(
  phase: Pick<Phase, "startOffset" | "endOffset" | "offsetUnit">,
): string {
  return `${formatPhaseOffset(phase.startOffset, phase.offsetUnit)} → ${formatPhaseOffset(phase.endOffset, phase.offsetUnit)}`;
}

export const MOVEMENT_RATES_KMH: Record<
  UnitTemplate["category"],
  { road: number; crossCountry: number }
> = {
  HQ: { road: 25, crossCountry: 10 },
  Infantry: { road: 4, crossCountry: 2.5 },
  Armour: { road: 30, crossCountry: 15 },
  Recce: { road: 40, crossCountry: 20 },
  Artillery: { road: 20, crossCountry: 8 },
  Aviation: { road: 200, crossCountry: 200 },
  "Air Defence": { road: 25, crossCountry: 10 },
  Engineer: { road: 20, crossCountry: 8 },
  Signal: { road: 25, crossCountry: 10 },
  CBRN: { road: 25, crossCountry: 10 },
  Medical: { road: 25, crossCountry: 10 },
  Logistics: { road: 25, crossCountry: 10 },
  "Special Forces": { road: 6, crossCountry: 4 },
  "Military Police": { road: 30, crossCountry: 12 },
  Naval: { road: 37, crossCountry: 37 },
  UAS: { road: 100, crossCountry: 100 },
};

export function movementRateKmh(
  category: UnitTemplate["category"],
  mode: "road" | "crossCountry" = "road",
): number {
  const rates = MOVEMENT_RATES_KMH[category];
  if (!rates) return MOVEMENT_RATES_KMH.Infantry[mode];
  return rates[mode];
}

export const ECHELON_COMBAT_POWER: Record<UnitEchelon, number> = {
  Army: 1000,
  Corps: 400,
  Division: 120,
  "Army Group": 2000,
  Region: 3000,
  Command: 3000,
  "Component Command": 2500,
  "Combatant Command": 2500,
  Brigade: 30,
  Regiment: 24,
  Group: 24,
  Wing: 24,
  Battalion: 8,
  Squadron: 8,
  Company: 2,
  Battery: 2,
  Troop: 2,
  Platoon: 0.5,
  Flight: 0.5,
  Detachment: 0.5,
  Section: 0.2,
  Squad: 0.1,
  Team: 0.05,
  Crew: 0.05,
  Fleet: 400,
  Vessel: 2,
  "Air Force": 24,
  Other: 0.2,
  "": 0.02,
};

export function combatPowerForEchelon(echelon: UnitEchelon | undefined): number {
  if (!echelon) return ECHELON_COMBAT_POWER[""];
  return ECHELON_COMBAT_POWER[echelon] ?? ECHELON_COMBAT_POWER[""];
}

export const GLYPH_COMBAT_POWER: Record<string, number> = {
  A: 0.05,
  B: 0.1,
  C: 0.2,
  D: 0.5,
  E: 2,
  F: 8,
  G: 24,
  H: 30,
  I: 120,
  J: 400,
  K: 1000,
  L: 2000,
  M: 3000,
  "-": 0.02,
};

export function echelonGlyphFromSidc(sidc: string): string {
  if (sidc.length < 12) return "-";
  return sidc[11] || "-";
}

export function combatPowerForSidc(sidc: string): number {
  const glyph = echelonGlyphFromSidc(sidc);
  return GLYPH_COMBAT_POWER[glyph] ?? GLYPH_COMBAT_POWER["-"];
}

const EARTH_RADIUS_KM = 6371;

export function distanceKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// ─── Engagement Radius by Echelon ────────────────────────────────────────────
// Maximum distance (km) at which a unit of a given echelon can engage or be
// considered "in contact" with an opposing force. Scales with echelon size and
// weapon system reach.

export const ECHELON_ENGAGEMENT_RADIUS_KM: Record<UnitEchelon, number> = {
  Team: 0.5,
  Crew: 0.5,
  Squad: 0.8,
  Section: 1.0,
  Platoon: 1.5,
  Flight: 2.0,
  Detachment: 1.5,
  Company: 3.0,
  Battery: 5.0,
  Troop: 3.0,
  Battalion: 5.0,
  Squadron: 5.0,
  Regiment: 8.0,
  Group: 8.0,
  Wing: 10.0,
  Brigade: 15.0,
  Division: 25.0,
  Corps: 40.0,
  Army: 60.0,
  "Army Group": 80.0,
  Region: 100.0,
  Command: 100.0,
  "Component Command": 100.0,
  "Combatant Command": 100.0,
  Fleet: 80.0,
  Vessel: 15.0,
  "Air Force": 60.0,
  Other: 3.0,
  "": 1.0,
};

export function engagementRadiusForEchelon(echelon: UnitEchelon | undefined): number {
  if (!echelon) return ECHELON_ENGAGEMENT_RADIUS_KM[""];
  return ECHELON_ENGAGEMENT_RADIUS_KM[echelon] ?? ECHELON_ENGAGEMENT_RADIUS_KM[""];
}

export const GLYPH_ENGAGEMENT_RADIUS_KM: Record<string, number> = {
  A: 0.5,   // Team/Crew
  B: 0.8,   // Squad
  C: 1.0,   // Section
  D: 1.5,   // Platoon/Flight
  E: 3.0,   // Company/Battery/Troop
  F: 5.0,   // Battalion/Squadron
  G: 8.0,   // Regiment/Group/Wing
  H: 15.0,  // Brigade
  I: 25.0,  // Division
  J: 40.0,  // Corps
  K: 60.0,  // Army
  L: 80.0,  // Army Group
  M: 100.0, // Region/Command
  "-": 1.0,
};

export function engagementRadiusForSidc(sidc: string): number {
  const glyph = echelonGlyphFromSidc(sidc);
  return GLYPH_ENGAGEMENT_RADIUS_KM[glyph] ?? GLYPH_ENGAGEMENT_RADIUS_KM["-"];
}

// ─── Lanchester Attrition Model ──────────────────────────────────────────────
// Continuous force-ratio attrition model based on Lanchester's laws.
// Returns estimated attrition percentages for both sides given a force ratio.

export interface AttritionResult {
  friendlyAttritionPct: number;
  hostileAttritionPct: number;
  outcome: "friendly-favoured" | "even" | "hostile-favoured";
}

/**
 * Compute attrition using a continuous Lanchester-style model.
 * 
 * The model uses the force ratio (friendly / hostile combat power) to
 * determine casualties on a smooth curve rather than fixed tiers:
 * 
 * - The losing side's attrition scales with how outnumbered they are
 * - The winning side still takes losses, but reduced by the ratio advantage
 * - A base attrition rate is applied to both sides, modified by the ratio
 * 
 * Parameters:
 * - friendlyPower: total combat power index of attacking/friendly force
 * - hostilePower: total combat power index of defending/hostile force
 * - defenseModifier: multiplier applied to hostile power (terrain, prepared positions, etc.)
 *   Defaults to 1.0 (no modifier). Use 1.3 for light cover, 1.5 for urban, 2.0 for prepared defenses.
 * - intensityModifier: scales overall attrition up/down. 1.0 = standard engagement,
 *   0.5 = skirmish/delaying, 1.5 = intense/decisive engagement.
 */
export function lanchesterAttrition(
  friendlyPower: number,
  hostilePower: number,
  defenseModifier: number = 1.0,
  intensityModifier: number = 1.0,
): AttritionResult {
  const BASE_ATTRITION = 10; // baseline attrition percentage for an even fight
  const MAX_ATTRITION = 45;  // cap: even a totally outmatched unit won't lose >45% in one phase
  const MIN_WINNER_ATTRITION = 2; // minimum attrition for the winning side

  const effectiveHostilePower = hostilePower * defenseModifier;
  
  // Avoid division by zero
  if (effectiveHostilePower <= 0 && friendlyPower <= 0) {
    return { friendlyAttritionPct: 0, hostileAttritionPct: 0, outcome: "even" };
  }
  if (effectiveHostilePower <= 0) {
    return { friendlyAttritionPct: MIN_WINNER_ATTRITION, hostileAttritionPct: MAX_ATTRITION, outcome: "friendly-favoured" };
  }
  if (friendlyPower <= 0) {
    return { friendlyAttritionPct: MAX_ATTRITION, hostileAttritionPct: MIN_WINNER_ATTRITION, outcome: "hostile-favoured" };
  }

  const ratio = friendlyPower / effectiveHostilePower;
  
  // Determine outcome
  let outcome: AttritionResult["outcome"];
  if (ratio >= 1.3) outcome = "friendly-favoured";
  else if (ratio <= 1 / 1.3) outcome = "hostile-favoured";
  else outcome = "even";

  // Lanchester attrition curves:
  // - Loser attrition: BASE * (winner_power / loser_power)^0.5 * intensity
  // - Winner attrition: BASE * (loser_power / winner_power)^0.5 * intensity * 0.6
  // The 0.6 factor represents the advantage of initiative/fire superiority
  
  const friendlyAttritionRaw = BASE_ATTRITION * Math.pow(1 / ratio, 0.5) * intensityModifier;
  const hostileAttritionRaw = BASE_ATTRITION * Math.pow(ratio, 0.5) * intensityModifier;

  // Apply the 0.6 winner discount
  let friendlyAttritionPct: number;
  let hostileAttritionPct: number;
  if (ratio >= 1) {
    // Friendly is winning
    friendlyAttritionPct = friendlyAttritionRaw * 0.6;
    hostileAttritionPct = hostileAttritionRaw;
  } else {
    // Hostile is winning
    friendlyAttritionPct = friendlyAttritionRaw;
    hostileAttritionPct = hostileAttritionRaw * 0.6;
  }

  // Clamp
  friendlyAttritionPct = Math.max(MIN_WINNER_ATTRITION, Math.min(MAX_ATTRITION, Math.round(friendlyAttritionPct)));
  hostileAttritionPct = Math.max(MIN_WINNER_ATTRITION, Math.min(MAX_ATTRITION, Math.round(hostileAttritionPct)));

  return { friendlyAttritionPct, hostileAttritionPct, outcome };
}
