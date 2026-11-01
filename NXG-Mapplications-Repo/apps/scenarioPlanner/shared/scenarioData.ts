// src/apps/scenarioPlanner/shared/scenarioData.ts
//
// Demo lay-down for NEXGEN 26 — the Narva corridor, Ida-Viru county, Estonia.
// Used as the start state for a phase that has no [NXG-P] Phase Map State row
// in the ontology yet.
//
// ─── History (read before editing coordinates) ───────────────────────────────
// This file previously held a Polish lay-down (Tczew → Gdańsk along the S7/E75)
// whose coordinates had been bulk-shifted into Estonian numbers. The names
// (PRUSZCZ JCN) and the northward axis came along for the ride, which put most
// of phases 2-4 in Narva Bay — units floating in the sea.
//
// It has been re-authored against the real geography below. If you move
// anything, keep it inside the operating box and away from the water:
//
//   Operating box   : 59.31–59.44 N, 27.40–28.23 E
//   Gulf of Finland : north of ~59.42 N (Sillamäe/Toila coast) and
//                     ~59.46 N at the Narva river mouth — stay south of it
//   Narva river     : ~28.20 E at Narva city, bending NW to 28.04 E at the
//                     mouth (Narva-Jõesuu). BLUFOR keeps to the west bank,
//                     OPFOR to the east (Ivangorod side, ≥28.21 E)
//   Narva reservoir : ~59.15–59.30 N / 27.90–28.20 E — nothing goes south of
//                     59.31 N on the eastern side
//
// Reference points used (WGS84):
//   Jõhvi 59.359,27.421 · Kohtla-Järve 59.399,27.273 · Voka 59.405,27.570
//   Sillamäe 59.396,27.764 · Vaivara 59.383,27.900 · Sinimäed 59.372,27.935
//   Olgina 59.367,28.105 · Narva 59.380,28.190 · Narva bridges 59.3775,28.2035
//   Kudruküla 59.420,28.080 · Narva-Jõesuu 59.452,28.035 · Ivangorod 59.374,28.215
//
// The scheme of manoeuvre follows the NEXGEN phase list:
//   nx_phase_01 Reception & Forward Deployment — arrive west, occupy Sinimäed
//   nx_phase_02 Defensive Operations           — hold the Sinimäed/Vaivara line
//   nx_phase_03 Counter-Attack                 — regain Olgina, close on Narva
//   nx_phase_04 Stabilisation & Transition     — secure Narva, hold river line
// The legacy IRON FORGE keys (phase_01…04) map onto the same four states.
//
// Unit identifiers / SIDCs sourced from the NxgUnit dataset:
//   UNIT-1PWRR-BTL, UNIT-BTL-HQ, UNIT-A-COY, UNIT-B-COY,
//   UNIT-C-SQN, UNIT-RECCE-TP, UNIT-MOR-PLT  (all GBR FRIEND)
//   + plausible OPFOR drawn from UTYPE-OPFOR-* catalogue entries

import type { PlacedArrow, PlacedObjective } from "../map/ScenarioMap";
import type { PlacedUnit } from "../map/types";
import type { PhaseMapEndState } from "../phaseCreator/types";
import { PHASE_COLOURS } from "./phaseColours";

const C = PHASE_COLOURS; // [blue, amber, green, purple, orange-red, teal]

// ─── Phase colours ────────────────────────────────────────────────────────────
const PH1 = C[0]; // #4A90D9 blue
const PH2 = C[1]; // #E8A838 amber
const PH3 = C[2]; // #5BAD6F green
const PH4 = C[3]; // #9B6DD1 purple

const OPFOR_RED = "#E05252";

// ─── SIDCs (sourced from NxgUnit dataset) ─────────────────────────────────────
// Friendly
const SIDC_MECH_BN    = "SFGPUCI---MBI-"; // 1PWRR / BG HQ
const SIDC_MECH_COY   = "SFGPUCI---MCI-"; // A Coy, B Coy
const SIDC_ARM_COY    = "SFGPUCA---MCI-"; // C Sqn RTR
const SIDC_RECCE_PLT  = "SFGPUCR---MTI-"; // Recce Tp
const SIDC_MOR_PLT    = "SFGPUCF---MTI-"; // Mortar Pl
const SIDC_LOG_COY    = "SFGPUSS---MCI-"; // LOG / Engr
// Hostile
const SIDC_OPFOR_INF  = "SHGPUCI---MBI-"; // OPFOR Inf Bn
const SIDC_OPFOR_ARM  = "SHGPUCA---MBI-"; // OPFOR Armour Bn

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Reception and Forward Deployment (H+0 → H+5)
// 1PWRR BG receives at Jõhvi, moves east along the E20 and occupies the
// Sinimäed (Blue Hills) position. Recce screens forward at Olgina.
// OPFOR is east of the Narva river, in and around Ivangorod.
// ─────────────────────────────────────────────────────────────────────────────

const PH1_UNITS: PlacedUnit[] = [
  // FRIENDLY — west to east along the E20
  { id: "UNIT-BTL-HQ",     templateId: "UTYPE-MECH-INFANTRY-BN",  label: "BG HQ 1PWRR",    sidc: SIDC_MECH_BN,   lat: 59.359, lng: 27.425 }, // Jõhvi
  { id: "UNIT-1PWRR-BTL",  templateId: "UTYPE-MECH-INFANTRY-BN",  label: "1st Bn PWRR",    sidc: SIDC_MECH_BN,   lat: 59.370, lng: 27.520 }, // Kohtla / E20
  { id: "p1-c-sqn-sp",     templateId: "UTYPE-ARMOUR-COY",        label: "C Sqn (Sp)",     sidc: SIDC_ARM_COY,   lat: 59.400, lng: 27.600 }, // Voka
  { id: "p1-a-coy-fwd",    templateId: "UTYPE-MECH-INFANTRY-COY", label: "A Coy (Fwd)",    sidc: SIDC_MECH_COY,  lat: 59.392, lng: 27.768 }, // Sillamäe
  { id: "p1-b-coy-fwd",    templateId: "UTYPE-MECH-INFANTRY-COY", label: "B Coy (Fwd)",    sidc: SIDC_MECH_COY,  lat: 59.383, lng: 27.900 }, // Vaivara
  { id: "UNIT-RECCE-TP",   templateId: "UTYPE-RECCE",             label: "Recce Tp",       sidc: SIDC_RECCE_PLT, lat: 59.367, lng: 28.105 }, // Olgina
  // OPFOR — east bank of the Narva river
  { id: "p1-opfor-bn1",    templateId: "UTYPE-OPFOR-INF-BN",      label: "OPFOR 1 Bn",     sidc: SIDC_OPFOR_INF, lat: 59.374, lng: 28.218 }, // Ivangorod
  { id: "p1-opfor-bn2",    templateId: "UTYPE-OPFOR-INF-BN",      label: "OPFOR 2 Bn",     sidc: SIDC_OPFOR_INF, lat: 59.396, lng: 28.222 }, // N of Ivangorod
];

const PH1_ARROWS: PlacedArrow[] = [
  // A Coy — forward from Sillamäe to occupy the Sinimäed position
  { id: "p1-a01", fromLat: 59.392, fromLng: 27.768, toLat: 59.372, toLng: 27.935, colour: PH1, lineStyle: "solid",  endpointStyle: "arrow-filled",
    tacticLabel: "Occupy", tacticSidc: "SVGOCCUPY", assignedUnitId: "p1-a-coy-fwd", targetObjectiveId: "p1-o01", milxScale: 0.3 },
  // B Coy — secure Vaivara, the northern shoulder of the position
  { id: "p1-a02", fromLat: 59.383, fromLng: 27.900, toLat: 59.379, toLng: 27.955, colour: PH1, lineStyle: "solid",  endpointStyle: "arrow-filled",
    tacticLabel: "Secure", tacticSidc: "SVGSECURE", assignedUnitId: "p1-b-coy-fwd", targetObjectiveId: "p1-o01", milxScale: 0.3 },
  // Recce Tp — screen forward along the E20 towards Narva
  { id: "p1-a03", fromLat: 59.367, fromLng: 28.105, toLat: 59.375, toLng: 28.165, colour: PH1, lineStyle: "dashed", endpointStyle: "arrow",
    tacticLabel: "Screen", tacticSidc: "SVGSCREENSS", assignedUnitId: "UNIT-RECCE-TP" },
  // C Sqn — follow and support the move east
  { id: "p1-a04", fromLat: 59.400, fromLng: 27.600, toLat: 59.378, toLng: 27.880, colour: PH1, lineStyle: "solid",  endpointStyle: "arrow-filled",
    tacticLabel: "Follow And Support", tacticSidc: "SVGFOLLOWANDSUPPORT", assignedUnitId: "p1-c-sqn-sp", milxScale: 0.28 },
];

const PH1_OBJECTIVES: PlacedObjective[] = [
  { id: "p1-o01", lat: 59.372, lng: 27.935, name: "PL ODIN (SINIMÄED)", colour: PH1 },
  { id: "p1-o02", lat: 59.359, lng: 27.425, name: "BG C2 NODE (JÕHVI)", colour: PH1 },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Defensive Operations (H+6 → H+17)
// The BG defends the Sinimäed / Vaivara line. OPFOR has crossed at Narva and
// attacks west along the E20 through Olgina.
// ─────────────────────────────────────────────────────────────────────────────

const PH2_UNITS: PlacedUnit[] = [
  // FRIENDLY — defensive positions on and behind the ridge
  { id: "UNIT-A-COY",    templateId: "UTYPE-MECH-INFANTRY-COY", label: "A Coy 1PWRR",     sidc: SIDC_MECH_COY,  lat: 59.373, lng: 27.940 }, // Tornimägi
  { id: "p2-b-coy",      templateId: "UTYPE-MECH-INFANTRY-COY", label: "B Coy (Flank)",   sidc: SIDC_MECH_COY,  lat: 59.390, lng: 27.965 }, // N shoulder
  { id: "UNIT-C-SQN",    templateId: "UTYPE-ARMOUR-COY",        label: "C Sqn RTR",       sidc: SIDC_ARM_COY,   lat: 59.362, lng: 27.958 }, // reserve, S of ridge
  { id: "p2-engr",       templateId: "UTYPE-LOG",               label: "Engr Sqn",        sidc: SIDC_LOG_COY,   lat: 59.380, lng: 27.885 }, // Vaivara obstacle belt
  { id: "p2-mor",        templateId: "UTYPE-MORTAR",            label: "Mor Pl (FS)",     sidc: SIDC_MOR_PLT,   lat: 59.360, lng: 27.820 }, // depth fire base
  // OPFOR — attacking west out of Narva
  { id: "p2-opfor-rdg",  templateId: "UTYPE-OPFOR-INF-BN",      label: "OPFOR MAIN",      sidc: SIDC_OPFOR_INF, lat: 59.373, lng: 28.100 }, // Olgina
  { id: "p2-opfor-brdg", templateId: "UTYPE-OPFOR-ARM-BN",      label: "OPFOR ARMD",      sidc: SIDC_OPFOR_ARM, lat: 59.379, lng: 28.155 }, // Narva west outskirts
];

const PH2_ARROWS: PlacedArrow[] = [
  // A Coy — hold the ridge
  { id: "p2-a01", fromLat: 59.373, fromLng: 27.940, toLat: 59.373, toLng: 27.940, colour: PH2, lineStyle: "solid",  endpointStyle: "none",
    tacticLabel: "Retain", tacticSidc: "SVGRETAIN", assignedUnitId: "UNIT-A-COY", targetObjectiveId: "p2-o01", milxScale: 0.3 },
  // B Coy — block the coastal road approach on the northern shoulder
  { id: "p2-a02", fromLat: 59.390, fromLng: 27.965, toLat: 59.392, toLng: 28.010, colour: PH2, lineStyle: "solid",  endpointStyle: "arrow-filled",
    tacticLabel: "Block", tacticSidc: "SVGBLOCK", assignedUnitId: "p2-b-coy", targetObjectiveId: "p2-o01", milxScale: 0.28 },
  // C Sqn — counter-moves from depth
  { id: "p2-a03", fromLat: 59.362, fromLng: 27.958, toLat: 59.372, toLng: 28.000, colour: PH2, lineStyle: "dashed", endpointStyle: "arrow-filled",
    tacticLabel: "Follow And Support", tacticSidc: "SVGFOLLOWANDSUPPORT", assignedUnitId: "UNIT-C-SQN", milxScale: 0.28 },
  // Mor Pl — neutralise the OPFOR main body forming up at Olgina
  { id: "p2-a04", fromLat: 59.360, fromLng: 27.820, toLat: 59.373, toLng: 28.100, colour: PH2, lineStyle: "dotted", endpointStyle: "none",
    tacticLabel: "Neutralize", tacticSidc: "SVGNEUTRALIZE", assignedUnitId: "p2-mor", targetObjectiveId: "p2-o03", milxScale: 0.25 },
];

const PH2_OBJECTIVES: PlacedObjective[] = [
  { id: "p2-o01", lat: 59.372, lng: 27.935, name: "SINIMÄED RIDGE", colour: PH2 },
  { id: "p2-o02", lat: 59.3775, lng: 28.2035, name: "NARVA BRIDGES", colour: PH2 },
  { id: "p2-o03", lat: 59.367, lng: 28.105, name: "OLGINA X-ROADS", colour: PH2 },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — Counter-Attack (H+18 → H+29)
// Having blunted the attack, the BG counter-attacks east along the E20 to
// retake Olgina and close on the western edge of Narva. Sillamäe is the
// logistic base.
// ─────────────────────────────────────────────────────────────────────────────

const PH3_UNITS: PlacedUnit[] = [
  { id: "UNIT-B-COY",   templateId: "UTYPE-MECH-INFANTRY-COY", label: "B Coy (FLOT N)",  sidc: SIDC_MECH_COY,  lat: 59.386, lng: 27.995 },
  { id: "p3-a-coy",     templateId: "UTYPE-MECH-INFANTRY-COY", label: "A Coy (FLOT C)",  sidc: SIDC_MECH_COY,  lat: 59.374, lng: 28.020 },
  { id: "p3-c-sqn",     templateId: "UTYPE-ARMOUR-COY",        label: "C Sqn (Lead)",    sidc: SIDC_ARM_COY,   lat: 59.370, lng: 27.990 },
  { id: "UNIT-MOR-PLT", templateId: "UTYPE-MORTAR",            label: "Mor Pl",          sidc: SIDC_MOR_PLT,   lat: 59.366, lng: 27.955 },
  { id: "p3-log",       templateId: "UTYPE-LOG",               label: "LOG Coy (RSP)",   sidc: SIDC_LOG_COY,   lat: 59.396, lng: 27.772 }, // Sillamäe
  { id: "p3-bg-hq",     templateId: "UTYPE-MECH-INFANTRY-BN",  label: "BG HQ",           sidc: SIDC_MECH_BN,   lat: 59.383, lng: 27.905 }, // Vaivara
  // OPFOR — giving ground back towards Narva
  { id: "p3-opfor-ctr", templateId: "UTYPE-OPFOR-INF-BN",      label: "OPFOR CTRATTK",   sidc: SIDC_OPFOR_INF, lat: 59.378, lng: 28.120 },
  { id: "p3-opfor-arm", templateId: "UTYPE-OPFOR-ARM-BN",      label: "OPFOR ARMD",      sidc: SIDC_OPFOR_ARM, lat: 59.385, lng: 28.170 },
];

const PH3_ARROWS: PlacedArrow[] = [
  // A Coy — main effort east along the E20 onto Olgina
  { id: "p3-a01", fromLat: 59.374, fromLng: 28.020, toLat: 59.367, toLng: 28.105, colour: PH3, lineStyle: "solid",  endpointStyle: "arrow-filled",
    tacticLabel: "Seize", tacticSidc: "TASK_SEIZE", assignedUnitId: "p3-a-coy", targetObjectiveId: "p3-o01", milxScale: 0.3 },
  // C Sqn — lead the armoured thrust
  { id: "p3-a02", fromLat: 59.370, fromLng: 27.990, toLat: 59.364, toLng: 28.085, colour: PH3, lineStyle: "solid",  endpointStyle: "arrow-filled",
    tacticLabel: "Clear", tacticSidc: "SVGCLEAR", assignedUnitId: "p3-c-sqn", targetObjectiveId: "p3-o01", milxScale: 0.28 },
  // B Coy — northern flank guard along the Kudruküla road
  { id: "p3-a03", fromLat: 59.386, fromLng: 27.995, toLat: 59.398, toLng: 28.075, colour: PH3, lineStyle: "dashed", endpointStyle: "arrow-filled",
    tacticLabel: "Guard", tacticSidc: "SVGGUARD", assignedUnitId: "UNIT-B-COY", targetObjectiveId: "p3-o03", milxScale: 0.3 },
  // LOG Coy — push the resupply route forward from Sillamäe
  { id: "p3-a04", fromLat: 59.396, fromLng: 27.772, toLat: 59.381, toLng: 27.960, colour: PH3, lineStyle: "dotted", endpointStyle: "none",
    tacticLabel: "Follow And Support", tacticSidc: "SVGFOLLOWANDSUPPORT", assignedUnitId: "p3-log", targetObjectiveId: "p3-o02", milxScale: 0.22 },
  // OPFOR counter-attack back down the E20 (red)
  { id: "p3-a05", fromLat: 59.385, fromLng: 28.170, toLat: 59.372, toLng: 28.090, colour: OPFOR_RED, lineStyle: "solid", endpointStyle: "arrow-filled",
    tacticLabel: "Counterattack", tacticSidc: "SVGCOUNTERATTACK", assignedUnitId: "p3-opfor-ctr", targetObjectiveId: "p3-o01", milxScale: 0.32 },
];

const PH3_OBJECTIVES: PlacedObjective[] = [
  { id: "p3-o01", lat: 59.367, lng: 28.105, name: "OLGINA X-ROADS", colour: PH3 },
  { id: "p3-o02", lat: 59.398, lng: 27.762, name: "SILLAMÄE RSP",   colour: PH3 },
  { id: "p3-o03", lat: 59.405, lng: 28.070, name: "PL BRONZE",      colour: PH3 },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — Stabilisation and Transition (H+30 → H+42)
// The BG secures Narva up to the river, screens north towards Kudruküla and
// Narva-Jõesuu, and hands over. OPFOR withdraws across the bridges to the
// east bank (Ivangorod).
// ─────────────────────────────────────────────────────────────────────────────

const PH4_UNITS: PlacedUnit[] = [
  { id: "p4-bg-hq",      templateId: "UTYPE-MECH-INFANTRY-BN",  label: "BG HQ 1PWRR",     sidc: SIDC_MECH_BN,   lat: 59.369, lng: 28.100 }, // Olgina
  { id: "p4-a-coy",      templateId: "UTYPE-MECH-INFANTRY-COY", label: "A Coy (ME)",      sidc: SIDC_MECH_COY,  lat: 59.378, lng: 28.150 }, // Narva west
  { id: "p4-c-sqn",      templateId: "UTYPE-ARMOUR-COY",        label: "C Sqn (Lead)",    sidc: SIDC_ARM_COY,   lat: 59.380, lng: 28.172 }, // Narva centre
  { id: "p4-b-coy",      templateId: "UTYPE-MECH-INFANTRY-COY", label: "B Coy (N Flank)", sidc: SIDC_MECH_COY,  lat: 59.398, lng: 28.125 }, // Riigiküla
  { id: "UNIT-RECCE-P4", templateId: "UTYPE-RECCE",             label: "Recce Tp (Scr)",  sidc: SIDC_RECCE_PLT, lat: 59.420, lng: 28.078 }, // Kudruküla
  { id: "p4-mor",        templateId: "UTYPE-MORTAR",            label: "Mor Pl (GS)",     sidc: SIDC_MOR_PLT,   lat: 59.365, lng: 28.060 },
  // OPFOR — withdrawing to the east bank
  { id: "p4-opfor-w1",   templateId: "UTYPE-OPFOR-INF-BN",      label: "OPFOR WDRL-1",    sidc: SIDC_OPFOR_INF, lat: 59.376, lng: 28.225 }, // Ivangorod
  { id: "p4-opfor-w2",   templateId: "UTYPE-OPFOR-ARM-BN",      label: "OPFOR WDRL-2",    sidc: SIDC_OPFOR_ARM, lat: 59.394, lng: 28.228 },
];

const PH4_ARROWS: PlacedArrow[] = [
  // A Coy — secure the city up to the river line
  { id: "p4-a01", fromLat: 59.378, fromLng: 28.150, toLat: 59.379, toLng: 28.185, colour: PH4, lineStyle: "solid",  endpointStyle: "arrow-filled",
    tacticLabel: "Secure", tacticSidc: "SVGSECURE", assignedUnitId: "p4-a-coy", targetObjectiveId: "p4-o01", milxScale: 0.3 },
  // C Sqn — clear the approaches to the bridges
  { id: "p4-a02", fromLat: 59.380, fromLng: 28.172, toLat: 59.3775, toLng: 28.198, colour: PH4, lineStyle: "solid",  endpointStyle: "arrow-filled",
    tacticLabel: "Clear", tacticSidc: "SVGCLEAR", assignedUnitId: "p4-c-sqn", targetObjectiveId: "p4-o01", milxScale: 0.28 },
  // B Coy — hold the northern flank along the river
  { id: "p4-a03", fromLat: 59.398, fromLng: 28.125, toLat: 59.404, toLng: 28.100, colour: PH4, lineStyle: "solid",  endpointStyle: "arrow-filled",
    tacticLabel: "Retain", tacticSidc: "SVGRETAIN", assignedUnitId: "p4-b-coy", targetObjectiveId: "p4-o03", milxScale: 0.28 },
  // Recce Tp — screen north towards the river mouth, staying on the west bank
  // (the Narva river is at roughly 28.05 E by 59.44 N).
  { id: "p4-a04", fromLat: 59.420, fromLng: 28.078, toLat: 59.437, toLng: 28.020, colour: PH4, lineStyle: "dashed", endpointStyle: "arrow",
    tacticLabel: "Screen", tacticSidc: "TASK_SCREEN", assignedUnitId: "UNIT-RECCE-P4", targetObjectiveId: "p4-o02" },
  // OPFOR retirement across the bridges (red)
  { id: "p4-a05", fromLat: 59.394, fromLng: 28.228, toLat: 59.376, toLng: 28.235, colour: OPFOR_RED, lineStyle: "dashed", endpointStyle: "arrow",
    tacticLabel: "Retirement", tacticSidc: "SVGRETIREMENT", assignedUnitId: "p4-opfor-w2", milxScale: 0.28 },
  // Mor Pl — general support onto the crossing sites
  { id: "p4-a06", fromLat: 59.365, fromLng: 28.060, toLat: 59.3775, toLng: 28.2035, colour: PH4, lineStyle: "dotted", endpointStyle: "none",
    tacticLabel: "Neutralize", tacticSidc: "SVGNEUTRALIZE", assignedUnitId: "p4-mor", milxScale: 0.25 },
];

const PH4_OBJECTIVES: PlacedObjective[] = [
  { id: "p4-o01", lat: 59.3775, lng: 28.196, name: "NARVA CROSSINGS", colour: PH4 },
  { id: "p4-o02", lat: 59.437, lng: 28.020, name: "PL CAESAR",        colour: PH4 },
  { id: "p4-o03", lat: 59.410, lng: 28.090, name: "OBJ SILVER",       colour: PH4 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Exported scenario — keyed by NxgPhase phaseId
// ─────────────────────────────────────────────────────────────────────────────

export interface PhaseScenario {
  startState: {
    units: PlacedUnit[];
    arrows: PlacedArrow[];
    objectives: PlacedObjective[];
  };
  endState: PhaseMapEndState | null;
}

export const SCENARIO_BY_PHASE: Record<string, PhaseScenario> = {
  // IRON FORGE (legacy) keys
  phase_01: { startState: { units: PH1_UNITS, arrows: PH1_ARROWS, objectives: PH1_OBJECTIVES }, endState: null },
  phase_02: { startState: { units: PH2_UNITS, arrows: PH2_ARROWS, objectives: PH2_OBJECTIVES }, endState: null },
  phase_03: { startState: { units: PH3_UNITS, arrows: PH3_ARROWS, objectives: PH3_OBJECTIVES }, endState: null },
  phase_04: { startState: { units: PH4_UNITS, arrows: PH4_ARROWS, objectives: PH4_OBJECTIVES }, endState: null },
  // NEXGEN 2026 (Estonia / Narva) keys — same four states
  nx_phase_01: { startState: { units: PH1_UNITS, arrows: PH1_ARROWS, objectives: PH1_OBJECTIVES }, endState: null },
  nx_phase_02: { startState: { units: PH2_UNITS, arrows: PH2_ARROWS, objectives: PH2_OBJECTIVES }, endState: null },
  nx_phase_03: { startState: { units: PH3_UNITS, arrows: PH3_ARROWS, objectives: PH3_OBJECTIVES }, endState: null },
  nx_phase_04: { startState: { units: PH4_UNITS, arrows: PH4_ARROWS, objectives: PH4_OBJECTIVES }, endState: null },
};

/** Flatten all phases into a single pre-loaded dataset for the map */
export function buildInitialScenario(): {
  units: (PlacedUnit & { phaseId: string; phaseColour: string })[];
  arrows: PlacedArrow[];
  objectives: PlacedObjective[];
} {
  const units: (PlacedUnit & { phaseId: string; phaseColour: string })[] = [];
  const arrows: PlacedArrow[] = [];
  const objectives: PlacedObjective[] = [];

  const phaseColourMap: Record<string, string> = {
    phase_01: PH1,
    phase_02: PH2,
    phase_03: PH3,
    phase_04: PH4,
    phase_03a: "#5BAD6F",
    phase_03b: "#9B6DD1",
    nx_phase_01: PH1,
    nx_phase_02: PH2,
    nx_phase_03: PH3,
    nx_phase_04: PH4,
  };

  for (const [phaseId, scenario] of Object.entries(SCENARIO_BY_PHASE)) {
    const phaseColour = phaseColourMap[phaseId] ?? "#888";
    for (const u of scenario.startState.units) {
      units.push({ ...u, templateId: u.templateId ?? "UTYPE-MECH-INFANTRY-PLT", phaseId, phaseColour });
    }
    for (const a of scenario.startState.arrows) {
      arrows.push({ ...a, phaseId });
    }
    for (const o of scenario.startState.objectives) {
      objectives.push({ ...o, phaseId });
    }
  }

  return { units, arrows, objectives };
}
