// ── shared/hla/balticShield.ts ───────────────────────────────────────────────
// OP-BALTIC-SHIELD-2026 Phase 1 laydown, shared by the live map's mock-demo
// federation and the analysis screen's mock-demo replay.
//
// Positions come from the scenario planner's own start state for obs_phase_01
// (NxgPhaseMapState.startStateMapJson), so the apps agree on where the
// operation is: the Kaliningrad approaches. `legs` are the movement axes from
// the same start state, extended into a multi-stage advance so a replay shows
// real development rather than one straight slide.

import type { HlaEntity } from "./types";

/** Wall-clock length of the whole scripted advance, in seconds. */
export const ADVANCE_DURATION_S = 3600;

export const BALTIC_SHIELD_FEDERATION_NAME = "OP-BALTIC-SHIELD-2026";

/**
 * A mock entity plus, optionally, the waypoints it works through.
 *
 * Movement is a polyline rather than a heading and speed: the planner's start
 * state gives explicit axes, and following them keeps the mock consistent with
 * the plan instead of wandering off the operational area. Legs are walked in
 * equal time, so a unit with three legs changes direction twice during a run.
 */
export interface MockSeed extends HlaEntity {
  legs?: [number, number][];
}

/** Land platform. Only the DIS domain matters here — the icon comes from natureApp6. */
const LAND = "1.1.276.3.1.1.2";
/** Surface platform: DIS kind 1, domain 3. Gives the symbol a naval frame. */
const SEA = "1.3.225.1.1.1";
/** Space platform: DIS kind 1, domain 5. */
const SPACE = "1.5.222.1.1.1";

const NATURE = {
  infantry: "ground track/unit/combat/infantry",
  armor: "ground track/unit/combat/armor",
  recon: "ground track/unit/combat/reconnaissance",
  artillery: "ground track/unit/combat/field artillery",
  airDefence: "ground track/unit/combat/air defense",
  signal: "ground track/unit/combat support/signal unit",
  intelligence: "ground track/unit/combat support/military intelligence",
  css: "ground track/unit/combat service support",
  // Naval. A hull needs one of these as much as a battalion does: the DIS
  // domain only supplies the frame shape, and a frame with no function ID is
  // an empty outline, which is what these three used to draw.
  destroyer: "sea surface track/combatant/line/destroyer",
  navalCombatant: "sea surface track/combatant/line",
} as const;

interface SeedInput {
  id: string;
  callsign: string;
  unit: string;
  force: "BLUE" | "RED";
  lat: number;
  lon: number;
  /**
   * APP-6 nature path. Supply one for everything the SWORD catalogue will not
   * know — which is every entity in this laydown, since these are operational
   * unit names ("1 Mech Bn (West)") rather than catalogue asset types ("Rifle
   * platoon").
   *
   * Without it the symbol is a frame with no icon: the DIS domain gives the
   * frame its shape and nothing gives it a glyph. The only entity here that
   * legitimately goes without is the satellite — symbology/app6.ts has no
   * space-dimension entry to point at, and inventing a function ID would draw
   * a confidently wrong icon, which is worse than an honest empty frame.
   */
  nature?: string;
  siso?: string;
  legs?: [number, number][];
}

function seed(input: SeedInput): MockSeed {
  return {
    id: input.id,
    // Commands address entities by NETN UniqueId and deliberately never fall
    // back to the HLA handle, so a mock entity without one would be refused as
    // "not taskable". The id is stable and unique here, so it serves as both.
    uniqueId: input.id,
    callsign: input.callsign,
    unit: input.unit,
    force: input.force,
    sisoType: input.siso ?? LAND,
    ...(input.nature ? { natureApp6: input.nature } : {}),
    lat: input.lat,
    lon: input.lon,
    heading: 0,
    speed: 0,
    damageState: "NoDamage",
    aggregateState: "aggregated",
    roe: input.force === "BLUE" ? "return_fire" : "fire_at_will",
    simulator: "mock",
    ...(input.legs ? { legs: input.legs } : {}),
  };
}

/**
 * Phase 1 — Enemy Advance to Contact.
 *
 * Echelon is inferred from the unit name by the symbology layer, so names keep
 * their "Bn"/"BDE"/"Bty" suffixes rather than carrying an echelon field.
 */
export const BALTIC_SHIELD_ENTITIES: MockSeed[] = [
  // ── BLUE — NATO covering force, corridor and maritime flank ──────────────
  seed({
    id: "bs-arg", callsign: "ARG-01", unit: "Amphibious Ready Group", force: "BLUE",
    lat: 55.05, lon: 19.6, siso: SEA, nature: NATURE.navalCombatant,
    legs: [[54.92, 19.68], [54.78, 19.82]],
  }),
  seed({
    id: "bs-dd-north", callsign: "ESCORT-N", unit: "DD Escort (North)", force: "BLUE",
    lat: 55.12, lon: 19.42, siso: SEA, nature: NATURE.destroyer,
    legs: [[54.95, 19.45], [54.82, 19.6]],
  }),
  seed({
    id: "bs-dd-port", callsign: "ESCORT-P", unit: "DD Escort (Port Approaches)", force: "BLUE",
    lat: 54.58, lon: 19.28, siso: SEA, nature: NATURE.destroyer,
    legs: [[54.5, 19.34], [54.42, 19.4]],
  }),
  seed({
    id: "bs-port-isr", callsign: "ISR-01", unit: "CA / Port ISR Sqn", force: "BLUE",
    lat: 54.44, lon: 19.62, nature: NATURE.recon,
    legs: [[54.5, 19.75], [54.58, 19.95]],
  }),
  seed({
    id: "bs-port-css", callsign: "RECEPTION", unit: "Port of Entry Reception Bn", force: "BLUE",
    lat: 54.17, lon: 19.41, nature: NATURE.css,
    legs: [[54.16, 19.6]],
  }),
  seed({
    id: "bs-bg-west", callsign: "WEST-01", unit: "1 Mech Bn (West)", force: "BLUE",
    lat: 54.13182, lon: 20.24179, nature: NATURE.infantry,
    legs: [[54.26, 20.35], [54.32, 20.42], [54.28, 20.5]],
  }),
  seed({
    id: "bs-css-hub", callsign: "LOGHUB", unit: "CSS Logistics Hub Bn", force: "BLUE",
    lat: 54.12, lon: 20.62, nature: NATURE.css,
  }),
  seed({
    id: "bs-bg-centre", callsign: "CENTRE-01", unit: "2 Mech Bn (Centre)", force: "BLUE",
    lat: 54.09, lon: 21.05, nature: NATURE.infantry,
    legs: [[54.22, 21.1], [54.3, 21.14], [54.24, 21.2]],
  }),
  seed({
    id: "bs-armour", callsign: "ANVIL-01", unit: "3 Armd Bn (Reserve)", force: "BLUE",
    lat: 54.11, lon: 21.85, nature: NATURE.armor,
    legs: [[54.14, 21.6], [54.18, 21.35], [54.26, 21.22]],
  }),
  seed({
    id: "bs-css-fsa", callsign: "FSA-01", unit: "CSS Forward Staging Bn", force: "BLUE",
    lat: 54.13, lon: 22.3, nature: NATURE.css,
    legs: [[54.13, 22.0]],
  }),
  seed({
    id: "bs-gbad", callsign: "SHIELD-01", unit: "AD Bty (Corridor Cover)", force: "BLUE",
    lat: 54.1, lon: 20.45, nature: NATURE.airDefence,
    legs: [[54.14, 20.7], [54.2, 20.88]],
  }),

  // ── RED — adversary advancing south-west out of Kaliningrad ──────────────
  seed({
    // Frame-only by necessity: app6.ts maps no space-dimension nature, so there
    // is no function ID to give this. A red space frame still reads correctly
    // as "hostile, space"; it simply has no glyph inside it.
    id: "bs-sat-isr", callsign: "OKO-01", unit: "Adversary ISR Satellite", force: "RED",
    lat: 55.18, lon: 20.3, siso: SPACE,
    legs: [[55.2, 20.9], [55.22, 21.6]],
  }),
  seed({
    id: "bs-bastion", callsign: "BASTION", unit: "BASTION-P Coastal Defence Bty", force: "RED",
    lat: 54.96, lon: 20.08, nature: NATURE.artillery,
    legs: [[54.92, 20.15]],
  }),
  seed({
    id: "bs-lr-arty", callsign: "HAMMER", unit: "Long-Range Artillery Bde", force: "RED",
    lat: 54.79, lon: 20.74, nature: NATURE.artillery,
    legs: [[54.68, 20.8], [54.58, 20.86]],
  }),
  seed({
    id: "bs-iskander", callsign: "LANCE", unit: "ISKANDER-M SRBM Bde", force: "RED",
    lat: 54.58, lon: 20.58, nature: NATURE.artillery,
    legs: [[54.56, 20.66]],
  }),
  seed({
    id: "bs-s400", callsign: "GROWLER", unit: "S-400 SAM Bde", force: "RED",
    lat: 54.66, lon: 21.06, nature: NATURE.airDefence,
    legs: [[54.6, 21.1], [54.54, 21.12]],
  }),
  seed({
    id: "bs-ew-bn", callsign: "STATIC", unit: "EW Bn", force: "RED",
    lat: 54.73, lon: 21.54, nature: NATURE.signal,
    legs: [[54.62, 21.45], [54.54, 21.38]],
  }),
  seed({
    id: "bs-22ac", callsign: "22AC", unit: "22nd AC MR Bde", force: "RED",
    lat: 54.87305, lon: 21.29825, nature: NATURE.armor,
    legs: [[54.68, 21.18], [54.52, 21.1], [54.45, 21.05]],
  }),
  seed({
    id: "bs-1gmrd", callsign: "1GMRD", unit: "1st GMRD MR Bde", force: "RED",
    lat: 54.84, lon: 22.18, nature: NATURE.armor,
    legs: [[54.7, 22.08], [54.56, 22.0], [54.48, 21.95]],
  }),
  seed({
    id: "bs-recon-det", callsign: "SCOUT-1", unit: "Adversary Recce Det", force: "RED",
    lat: 54.9, lon: 21.7, nature: NATURE.recon,
    legs: [[54.7, 21.5], [54.5, 21.3], [54.36, 21.16]],
  }),
  seed({
    id: "bs-mi-det", callsign: "PROBE", unit: "Adversary MI Coy", force: "RED",
    lat: 54.95, lon: 20.9, nature: NATURE.intelligence,
    legs: [[54.86, 20.95]],
  }),
];

const METRES_PER_DEG = 111_320;

function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = bLat - aLat;
  const dLon = (bLon - aLon) * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) * METRES_PER_DEG;
}

function bearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = bLat - aLat;
  const dLon = (bLon - aLon) * Math.cos((aLat * Math.PI) / 180);
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
}

/**
 * The laydown at `progress` (0 = start of Phase 1, 1 = end of every axis).
 *
 * Shared by the live mock federation, which advances progress against the wall
 * clock, and the replay, which derives it from the playhead — so both show the
 * same operation at the same point.
 */
export function laydownAt(progress: number): HlaEntity[] {
  const t = Math.min(1, Math.max(0, progress));

  return BALTIC_SHIELD_ENTITIES.map((s) => {
    const { legs, ...entity } = s;
    if (!legs || legs.length === 0) return { ...entity };

    // Legs take equal time, so a unit changes direction at predictable points.
    const legDurationS = ADVANCE_DURATION_S / legs.length;
    const scaled = t * legs.length;
    const index = Math.min(legs.length - 1, Math.floor(scaled));
    const within = scaled - index;

    const from = index === 0 ? [s.lat, s.lon] : legs[index - 1];
    const to = legs[index];

    const lat = from[0] + (to[0] - from[0]) * within;
    const lon = from[1] + (to[1] - from[1]) * within;
    const metres = metresBetween(from[0], from[1], to[0], to[1]);

    return {
      ...entity,
      lat,
      lon,
      heading: Math.round(bearing(from[0], from[1], to[0], to[1])),
      // HlaEntity.speed is km/h, not m/s.
      speed: t < 1 ? Math.round((metres / legDurationS) * 3.6) : 0,
    };
  });
}
