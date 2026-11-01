// ── shared/hla/balticShieldPlan.ts ─────────────────────────────────────────
// OP-BALTIC-SHIELD-2026 Phase 1 — the PLAN, as the scenario planner wrote it.
//
// This is the intent half of plan-vs-execution. balticShield.ts is the other
// half: what the units actually did. The analysis screen measures one against
// the other (see analysisScreen/lib/compliance.ts).
//
// Where this came from
// --------------------
// Exported once from the ontology rather than fetched at runtime:
//
//   NxgPhaseMapState  cd840030-1459-4524-bde3-fc489b85a33c  (phaseId obs_phase_01)
//     .startStateMapJson  → PLANNED_UNITS / PLANNED_ORDERS / PLANNED_OBJECTIVES
//     .endStateMapJson    → PREDICTED_END_STATE
//   NxgPhase          obs_phase_01  (scenario_operation_baltic_shield, D+0 → D+2)
//     → PHASE_*
//
// Checked in, for the same reason balticShield.ts is: mock-demo mode exists so
// that after-action review is demonstrable when no simulation has ever run and
// no ontology data is reachable. A plan overlay that needed a live ontology
// read would fail in exactly the situation mock-demo is for. There is already
// precedent for checked-in scenario data in this repo (op-nexgen-2026-*.json).
//
// The shapes below deliberately mirror the planner's own
// (scenarioPlanner/phaseCreator/types.ts — MapUnitPlacement, MapArrowPlacement,
// MapObjectivePlacement) so that pointing this at a live NxgPhaseMapState later
// is a loader swap rather than a rewrite. Two fields are additions:
//
//   entityId        the HLA entity this planned unit IS. In this export the
//                   planner's ids and the federation's handles happen to be the
//                   same strings ("bs-bg-west"), which is why mock mode can do
//                   this at all. Real runs will need a resolver from unit name
//                   or callsign to NxgUnit key, and that is the genuinely hard
//                   part — keeping it an explicit field means we are not
//                   pretending to have solved it.
//   category        the planner's own movement category, used to derive how
//                   long it thought each move would take. See PLANNED_CATEGORY.
//
// Nothing here is tuned, softened or invented. The divergences between plan and
// execution that the compliance engine reports are the ones that are genuinely
// in the data — see the notes at the bottom of this file.

/** Longitude is `lng` throughout the plan, as the planner and the stored JSON spell it. */
export interface PlanPoint {
  lat: number;
  lng: number;
}

/** Movement categories, as scenarioPlanner/map/types.ts UnitTemplate["category"]. */
export type PlannedCategory =
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

export interface PlannedUnit extends PlanPoint {
  id: string;
  /** The HLA entity this planned unit is. Absent → never appeared in the federation. */
  entityId?: string;
  label: string;
  sidc: string;
  force: "blue" | "red";
  templateId?: string;
  category: PlannedCategory;
}

export interface PlannedObjective extends PlanPoint {
  id: string;
  name: string;
  colour: string;
}

export interface PlannedOrder {
  id: string;
  /** The planned unit this order is assigned to. */
  unitId: string;
  /** The HLA entity that unit is, when it is one. */
  entityId?: string;
  unitLabel: string;
  force: "blue" | "red";
  /** Doctrinal task label as drawn by the planner ("Advance to Contact", "Screen"…). */
  taskLabel: string;
  category: PlannedCategory;
  /**
   * The planned axis.
   *
   * Two points here, because none of the orders in this export were terrain
   * routed — the planner drew straight arrows. The field is a polyline rather
   * than a from/to pair so that a terrain-routed order
   * (MapArrowPlacement.routeWaypoints) drops straight in.
   */
  route: PlanPoint[];
  /**
   * Terrain-routed travel time, when the planner computed one
   * (MapArrowPlacement.routeDurationSec). None of these orders have it, so the
   * compliance engine falls back to the planner's own distance ÷ rate estimate.
   */
  routeDurationSec?: number;
  targetObjectiveId?: string;
}

/** A control measure — drawn geometry with no unit tasked against it. */
export interface PlannedControlMeasure {
  id: string;
  label?: string;
  route: PlanPoint[];
  colour: string;
}

export interface PredictedEndUnit extends PlanPoint {
  id: string;
  entityId?: string;
  label: string;
  force: "blue" | "red";
}

export interface PhasePlan {
  phaseId: string;
  scenarioId: string;
  phaseName: string;
  objectiveStatement: string;
  /** As the scenario expresses it — this one is day-based. */
  startOffset: string;
  endOffset: string;
  /** Real hours the phase is planned to span. D+0 → D+2 = 48. */
  phaseDurationHours: number;
  units: PlannedUnit[];
  orders: PlannedOrder[];
  objectives: PlannedObjective[];
  controlMeasures: PlannedControlMeasure[];
  /**
   * Where the planner expected everyone to end up.
   *
   * Positions only. The predicted end state that AIP Logic can produce carries
   * a per-unit status (operational / degraded / combat-ineffective / destroyed
   * — see GenerateEndStateOutput.EndStateUnit), but this stored end state does
   * not, so there is no predicted attrition here to compare against. That is
   * just as well: the HLA tracks feed publishes no attrition either, so a
   * status comparison would be unverifiable in both directions.
   */
  predictedEndState: PredictedEndUnit[];
}

// ── templateId → movement category ──────────────────────────────────────────
// Mirrors UNIT_ARCHETYPES in scenarioPlanner/map/unitTemplates.ts, which is
// what resolveOrders' categoryForSidc() resolves to from the SIDC. Written out
// here rather than imported so that this file — and the compliance engine that
// reads it — stay free of the planner's runtime dependencies (@acc/app6d et al)
// and remain testable in a bare node process.
export const PLANNED_CATEGORY: Record<string, PlannedCategory> = {
  amphibious: "Naval",
  destroyer: "Naval",
  "recce-ground-sensor": "Recce",
  logistics: "Logistics",
  "mech-infantry": "Infantry",
  "motor-rifle": "Infantry",
  armour: "Armour",
  "air-defence-sam": "Air Defence",
  "satellite-isr": "UAS",
  "coastal-defence-missile": "Artillery",
  "rocket-artillery": "Artillery",
  srbm: "Artillery",
  "cyber-ew": "Signal",
  "infantry-Division": "Infantry",
  "uas-recce-": "UAS",
  "special-forces-Troop": "Special Forces",
};

// ── Units (from startStateMapJson.units) ────────────────────────────────────
const PLANNED_UNITS: PlannedUnit[] = [
  { id: "bs-arg", entityId: "bs-arg", label: "Amphibious Ready Group", sidc: "SFAPMF--------", lat: 55.05, lng: 19.6, force: "blue", templateId: "amphibious", category: "Naval" },
  { id: "bs-dd-north", entityId: "bs-dd-north", label: "DD Escort (North)", sidc: "SFSPCLDD-------", lat: 55.12, lng: 19.42, force: "blue", templateId: "destroyer", category: "Naval" },
  { id: "bs-dd-port", entityId: "bs-dd-port", label: "DD Escort (Port Approaches)", sidc: "SFSPCLDD-------", lat: 54.58, lng: 19.28, force: "blue", templateId: "destroyer", category: "Naval" },
  { id: "bs-port-isr", entityId: "bs-port-isr", label: "CA / Port ISR", sidc: "SFGPU------H---", lat: 54.44, lng: 19.62, force: "blue", templateId: "recce-ground-sensor", category: "Recce" },
  { id: "bs-port-css", entityId: "bs-port-css", label: "Port of Entry - Reception", sidc: "SFGPUSS----F---", lat: 54.17, lng: 19.41, force: "blue", templateId: "logistics", category: "Logistics" },
  { id: "bs-bg-west", entityId: "bs-bg-west", label: "1 Mech Bn (West)", sidc: "SFGPUCIZ---F---", lat: 54.13182046985483, lng: 20.241791634059098, force: "blue", templateId: "mech-infantry", category: "Infantry" },
  { id: "bs-css-hub", entityId: "bs-css-hub", label: "CSS Logistics Hub", sidc: "SFGPUSS----F---", lat: 54.12, lng: 20.62, force: "blue", templateId: "logistics", category: "Logistics" },
  { id: "bs-bg-centre", entityId: "bs-bg-centre", label: "2 Mech Bn (Centre)", sidc: "SFGPUCIZ---F---", lat: 54.09, lng: 21.05, force: "blue", templateId: "mech-infantry", category: "Infantry" },
  { id: "bs-armour", entityId: "bs-armour", label: "3 Armd Bn (Reserve)", sidc: "SFGPUCA----F---", lat: 54.11, lng: 21.85, force: "blue", templateId: "armour", category: "Armour" },
  { id: "bs-css-fsa", entityId: "bs-css-fsa", label: "CSS Forward Staging Area", sidc: "SFGPUSS----F---", lat: 54.13, lng: 22.3, force: "blue", templateId: "logistics", category: "Logistics" },
  { id: "bs-gbad", entityId: "bs-gbad", label: "AD Bty (Corridor Cover)", sidc: "SFGPUCDM---E---", lat: 54.1, lng: 20.45, force: "blue", templateId: "air-defence-sam", category: "Air Defence" },
  { id: "bs-sat-isr", entityId: "bs-sat-isr", label: "Adversary ISR Satellite", sidc: "SHAPMFQ--------", lat: 55.18, lng: 20.3, force: "red", templateId: "satellite-isr", category: "UAS" },
  { id: "bs-bastion", entityId: "bs-bastion", label: "BASTION-P Coastal Defence", sidc: "SHGPU-------E-", lat: 54.92870304469554, lng: 20.045616008897525, force: "red", templateId: "coastal-defence-missile", category: "Artillery" },
  { id: "bs-lr-arty", entityId: "bs-lr-arty", label: "Long-Range Artillery", sidc: "SHGPUCFR---H---", lat: 54.79, lng: 20.74, force: "red", templateId: "rocket-artillery", category: "Artillery" },
  { id: "bs-iskander", entityId: "bs-iskander", label: "ISKANDER-M SRBM BDE", sidc: "SHGPUCFS---H---", lat: 54.58, lng: 20.58, force: "red", templateId: "srbm", category: "Artillery" },
  { id: "bs-s400", entityId: "bs-s400", label: "S-400 SAM BDE", sidc: "SHGPUCDM---H---", lat: 54.66, lng: 21.06, force: "red", templateId: "air-defence-sam", category: "Air Defence" },
  { id: "bs-ew-bn", entityId: "bs-ew-bn", label: "EW BATTALION", sidc: "SHGPUUMSE--H---", lat: 54.63652939552949, lng: 21.4626175767811, force: "red", templateId: "cyber-ew", category: "Signal" },
  { id: "bs-22ac", entityId: "bs-22ac", label: "22nd AC MRBDE", sidc: "SHGPUCIM---H---", lat: 54.873047033350616, lng: 21.298247070312726, force: "red", templateId: "motor-rifle", category: "Infantry" },
  { id: "bs-1gmrd", entityId: "bs-1gmrd", label: "1st GMRD MRBDE", sidc: "SHGPUCIM---H---", lat: 54.84, lng: 22.18, force: "red", templateId: "motor-rifle", category: "Infantry" },
  // Placed later by a planner, and never published into the federation — these
  // four are why NOT_OBSERVED exists as a compliance status. No entityId.
  { id: "2188aa7e-b383-46dd-9ec7-45c85b1f5175", label: "Infantry (Division)", sidc: "SFGPUCI----I---", lat: 54.17957030460357, lng: 20.87913399827113, force: "blue", templateId: "infantry-Division", category: "Infantry" },
  { id: "24ae3b76-0299-43aa-89a6-ff13dbab59c5", label: "Infantry (Division)", sidc: "SFGPUCI----I---", lat: 54.193458592523314, lng: 21.168681992272013, force: "blue", templateId: "infantry-Division", category: "Infantry" },
  { id: "d9d64733-87c8-44b4-bfcb-8cfeaf48717a", label: "Infantry (Division)", sidc: "SFGPUCI----I---", lat: 54.13894429625819, lng: 21.21879458694451, force: "blue", templateId: "infantry-Division", category: "Infantry" },
  { id: "c7dbc161-f188-4be7-8c8b-e5d475dac177", label: "Infantry (Division)", sidc: "SFGPUCI----I---", lat: 54.11051329809334, lng: 21.254706281968254, force: "blue", templateId: "infantry-Division", category: "Infantry" },
  { id: "14c2e789-96b2-49a5-8878-c569d70adac6", label: "UAS — Reconnaissance (Platform / Individual)", sidc: "SFAPMFQ--------", lat: 54.264284568845994, lng: 20.120803847192803, force: "blue", templateId: "uas-recce-", category: "UAS" },
  { id: "0ffac551-885b-4d3d-917f-49ddc6050d0b", label: "Special Forces (Troop)", sidc: "SFFP-------E---", lat: 54.35367000321136, lng: 20.826677170367446, force: "blue", templateId: "special-forces-Troop", category: "Special Forces" },
];

// ── Orders (startStateMapJson.arrows with an assignedUnitId) ────────────────
//
// Faithful to the export, including its warts: bs-bg-west carries two
// conflicting orders, and one "Defend" order is zero-length (the planner
// dropped it on the unit's own position). Both are real planning artefacts and
// both are things an after-action review should surface, so neither is cleaned
// up here.
const PLANNED_ORDERS: PlannedOrder[] = [
  {
    id: "bs-p1-22ac", unitId: "bs-22ac", entityId: "bs-22ac", unitLabel: "22nd AC MRBDE",
    force: "red", taskLabel: "Advance to Contact", category: "Infantry",
    route: [{ lat: 54.88, lng: 21.32 }, { lat: 54.45, lng: 21.05 }],
  },
  {
    id: "bs-p1-1gmrd", unitId: "bs-1gmrd", entityId: "bs-1gmrd", unitLabel: "1st GMRD MRBDE",
    force: "red", taskLabel: "Advance to Contact", category: "Infantry",
    route: [{ lat: 54.84, lng: 22.18 }, { lat: 54.48, lng: 21.95 }],
  },
  {
    id: "bs-p1-lr-arty", unitId: "bs-lr-arty", entityId: "bs-lr-arty", unitLabel: "Long-Range Artillery",
    force: "red", taskLabel: "Support by Fire", category: "Artillery",
    route: [{ lat: 54.79, lng: 20.74 }, { lat: 54.68, lng: 20.8 }],
  },
  {
    id: "bs-p1-s400", unitId: "bs-s400", entityId: "bs-s400", unitLabel: "S-400 SAM BDE",
    force: "red", taskLabel: "Cover", category: "Air Defence",
    route: [{ lat: 54.66, lng: 21.06 }, { lat: 54.6, lng: 21.1 }],
  },
  {
    id: "bs-p1-ew-bn", unitId: "bs-ew-bn", entityId: "bs-ew-bn", unitLabel: "EW BATTALION",
    force: "red", taskLabel: "Suppress", category: "Signal",
    route: [{ lat: 54.73, lng: 21.54 }, { lat: 54.62, lng: 21.45 }],
  },
  {
    id: "bs-p1-iskander", unitId: "bs-iskander", entityId: "bs-iskander", unitLabel: "ISKANDER-M SRBM BDE",
    force: "red", taskLabel: "Interdict", category: "Artillery",
    route: [{ lat: 54.58, lng: 20.58 }, { lat: 54.56, lng: 20.66 }],
  },
  {
    id: "bs-p1-bastion", unitId: "bs-bastion", entityId: "bs-bastion", unitLabel: "BASTION-P Coastal Defence",
    force: "red", taskLabel: "Interdict", category: "Artillery",
    route: [{ lat: 54.96, lng: 20.08 }, { lat: 54.92, lng: 20.15 }],
  },
  {
    id: "bs-p1-sat", unitId: "bs-sat-isr", entityId: "bs-sat-isr", unitLabel: "Adversary ISR Satellite",
    force: "red", taskLabel: "Screen", category: "UAS",
    route: [{ lat: 55.18, lng: 20.3 }, { lat: 55.2, lng: 20.9 }],
  },
  {
    id: "bs-p1-bg-west", unitId: "bs-bg-west", entityId: "bs-bg-west", unitLabel: "1 Mech Bn (West)",
    force: "blue", taskLabel: "Screen", category: "Infantry",
    route: [{ lat: 54.14, lng: 20.28 }, { lat: 54.26, lng: 20.35 }],
  },
  {
    id: "bs-p1-bg-centre", unitId: "bs-bg-centre", entityId: "bs-bg-centre", unitLabel: "2 Mech Bn (Centre)",
    force: "blue", taskLabel: "Screen", category: "Infantry",
    route: [{ lat: 54.09, lng: 21.05 }, { lat: 54.22, lng: 21.1 }],
  },
  {
    id: "bs-p1-armour", unitId: "bs-armour", entityId: "bs-armour", unitLabel: "3 Armd Bn (Reserve)",
    force: "blue", taskLabel: "Move to Assembly Area", category: "Armour",
    route: [{ lat: 54.11, lng: 21.85 }, { lat: 54.14, lng: 21.6 }],
  },
  {
    id: "bs-p1-gbad", unitId: "bs-gbad", entityId: "bs-gbad", unitLabel: "AD Bty (Corridor Cover)",
    force: "blue", taskLabel: "Cover", category: "Air Defence",
    route: [{ lat: 54.1, lng: 20.45 }, { lat: 54.14, lng: 20.7 }],
  },
  {
    id: "bs-p1-dd-north", unitId: "bs-dd-north", entityId: "bs-dd-north", unitLabel: "DD Escort (North)",
    force: "blue", taskLabel: "Screen", category: "Naval",
    route: [{ lat: 55.12, lng: 19.42 }, { lat: 54.95, lng: 19.45 }],
  },
  {
    id: "bs-p1-port-isr", unitId: "bs-port-isr", entityId: "bs-port-isr", unitLabel: "CA / Port ISR",
    force: "blue", taskLabel: "Screen", category: "Recce",
    route: [{ lat: 54.44, lng: 19.62 }, { lat: 54.5, lng: 19.75 }],
  },
  {
    // Zero-length: dropped on the unit's own position. Carries no measurable axis.
    id: "2c2bf489-c29d-4498-a6f7-21ec84c79fe4", unitId: "bs-bg-centre", entityId: "bs-bg-centre",
    unitLabel: "2 Mech Bn (Centre)", force: "blue", taskLabel: "Defend", category: "Infantry",
    route: [{ lat: 54.09, lng: 21.05 }, { lat: 54.09, lng: 21.05 }],
  },
  {
    // Second, conflicting order for 1 Mech Bn (West) — Screen above, Attack here.
    id: "2f8dbbc6-0037-426b-a7bb-336a8e042251", unitId: "bs-bg-west", entityId: "bs-bg-west",
    unitLabel: "1 Mech Bn (West)", force: "blue", taskLabel: "Attack", category: "Infantry",
    route: [
      { lat: 54.123123613019544, lng: 20.26936576503053 },
      { lat: 54.35138718027608, lng: 20.401674473766263 },
    ],
  },
  {
    id: "e310d1ad-778f-4b1d-a976-eff2e3d835f0", unitId: "2188aa7e-b383-46dd-9ec7-45c85b1f5175",
    unitLabel: "Infantry (Division)", force: "blue", taskLabel: "Main Attack", category: "Infantry",
    route: [
      { lat: 54.17957030460357, lng: 20.87913399827113 },
      { lat: 54.29092066722103, lng: 20.871268463305853 },
    ],
  },
  {
    id: "d7115d7a-c24a-40e5-9dc7-eb8bff7bcfce", unitId: "24ae3b76-0299-43aa-89a6-ff13dbab59c5",
    unitLabel: "Infantry (Division)", force: "blue", taskLabel: "Main Attack", category: "Infantry",
    route: [
      { lat: 54.193458592523314, lng: 21.168681992272013 },
      { lat: 54.28638953567412, lng: 21.2145482075386 },
    ],
  },
  {
    id: "1e9db857-2cd4-4f2a-ab41-11aba429b2d9", unitId: "d9d64733-87c8-44b4-bfcb-8cfeaf48717a",
    unitLabel: "Infantry (Division)", force: "blue", taskLabel: "Main Attack", category: "Infantry",
    route: [
      { lat: 54.13894429625819, lng: 21.21879458694451 },
      { lat: 54.24043636599157, lng: 21.303465973463886 },
    ],
  },
  {
    id: "34cf984c-e2fb-41f4-85df-ad784a26c404", unitId: "c7dbc161-f188-4be7-8c8b-e5d475dac177",
    unitLabel: "Infantry (Division)", force: "blue", taskLabel: "Attack", category: "Infantry",
    route: [
      { lat: 54.11051329809334, lng: 21.254706281968254 },
      { lat: 54.23517380162275, lng: 21.31747538595897 },
    ],
  },
];

// ── Objectives (startStateMapJson.objectives) ──────────────────────────────
const PLANNED_OBJECTIVES: PlannedObjective[] = [
  { id: "bs-obj-harbour", name: "OBJ HARBOUR", lat: 54.17, lng: 19.41, colour: "#4A90D9" },
  { id: "bs-obj-gate", name: "OBJ GATE", lat: 54.15, lng: 20.62, colour: "#4A90D9" },
  { id: "bs-obj-anvil", name: "OBJ ANVIL", lat: 54.14, lng: 21.6, colour: "#4A90D9" },
];

// ── Control measures — ROUTE BLUE, plus one unassigned Seize graphic ────────
const PLANNED_CONTROL_MEASURES: PlannedControlMeasure[] = [
  {
    id: "bs-route-blue",
    label: "ROUTE BLUE",
    colour: "#4A90D9",
    // Five consecutive arrows in the export, joined here into the one corridor
    // they describe: port of entry → logistics hub → forward staging area.
    route: [
      { lat: 54.17, lng: 19.41 },
      { lat: 54.15, lng: 19.95 },
      { lat: 54.12, lng: 20.62 },
      { lat: 54.09, lng: 21.3 },
      { lat: 54.11, lng: 21.85 },
      { lat: 54.13, lng: 22.3 },
    ],
  },
  {
    id: "35ade460-272d-4b74-b6eb-ac8199ff27c0",
    label: "Seize",
    colour: "#4A90D9",
    route: [
      { lat: 54.25614958784348, lng: 21.259303078806283 },
      { lat: 54.25614958784348, lng: 21.259303078806283 },
    ],
  },
];

// ── Predicted end state (endStateMapJson.units) ─────────────────────────────
const PREDICTED_END_STATE: PredictedEndUnit[] = [
  { id: "bs-arg", entityId: "bs-arg", label: "Amphibious Ready Group", lat: 55.05, lng: 19.6, force: "blue" },
  { id: "bs-dd-north", entityId: "bs-dd-north", label: "DD Escort (North)", lat: 54.95, lng: 19.45, force: "blue" },
  { id: "bs-dd-port", entityId: "bs-dd-port", label: "DD Escort (Port Approaches)", lat: 54.58, lng: 19.28, force: "blue" },
  { id: "bs-port-isr", entityId: "bs-port-isr", label: "CA / Port ISR", lat: 54.5, lng: 19.75, force: "blue" },
  { id: "bs-port-css", entityId: "bs-port-css", label: "Port of Entry - Reception", lat: 54.17, lng: 19.41, force: "blue" },
  { id: "bs-bg-west", entityId: "bs-bg-west", label: "1 Mech Bn (West)", lat: 54.26, lng: 20.35, force: "blue" },
  { id: "bs-css-hub", entityId: "bs-css-hub", label: "CSS Logistics Hub", lat: 54.12, lng: 20.62, force: "blue" },
  { id: "bs-bg-centre", entityId: "bs-bg-centre", label: "2 Mech Bn (Centre)", lat: 54.22, lng: 21.1, force: "blue" },
  { id: "bs-armour", entityId: "bs-armour", label: "3 Armd Bn (Reserve)", lat: 54.14, lng: 21.6, force: "blue" },
  { id: "bs-css-fsa", entityId: "bs-css-fsa", label: "CSS Forward Staging Area", lat: 54.13, lng: 22.3, force: "blue" },
  { id: "bs-gbad", entityId: "bs-gbad", label: "AD Bty (Corridor Cover)", lat: 54.14, lng: 20.7, force: "blue" },
  { id: "bs-sat-isr", entityId: "bs-sat-isr", label: "Adversary ISR Satellite", lat: 55.2, lng: 20.9, force: "red" },
  { id: "bs-bastion", entityId: "bs-bastion", label: "BASTION-P Coastal Defence", lat: 54.92, lng: 20.15, force: "red" },
  { id: "bs-lr-arty", entityId: "bs-lr-arty", label: "Long-Range Artillery", lat: 54.68, lng: 20.8, force: "red" },
  { id: "bs-iskander", entityId: "bs-iskander", label: "ISKANDER-M SRBM BDE", lat: 54.56, lng: 20.66, force: "red" },
  { id: "bs-s400", entityId: "bs-s400", label: "S-400 SAM BDE", lat: 54.6, lng: 21.1, force: "red" },
  { id: "bs-ew-bn", entityId: "bs-ew-bn", label: "EW BATTALION", lat: 54.62, lng: 21.45, force: "red" },
  { id: "bs-22ac", entityId: "bs-22ac", label: "22nd AC MRBDE", lat: 54.45, lng: 21.05, force: "red" },
  { id: "bs-1gmrd", entityId: "bs-1gmrd", label: "1st GMRD MRBDE", lat: 54.48, lng: 21.95, force: "red" },
  { id: "2188aa7e-b383-46dd-9ec7-45c85b1f5175", label: "Infantry (Division)", lat: 54.17957, lng: 20.879134, force: "blue" },
  { id: "24ae3b76-0299-43aa-89a6-ff13dbab59c5", label: "Infantry (Division)", lat: 54.193459, lng: 21.168682, force: "blue" },
  { id: "d9d64733-87c8-44b4-bfcb-8cfeaf48717a", label: "Infantry (Division)", lat: 54.138944, lng: 21.218795, force: "blue" },
  { id: "c7dbc161-f188-4be7-8c8b-e5d475dac177", label: "Infantry (Division)", lat: 54.235174, lng: 21.317475, force: "blue" },
];

/**
 * OP-BALTIC-SHIELD-2026, Phase 1 — Secure the Reinforcement Corridor.
 *
 * What the compliance engine finds in this plan, and why none of it is staged
 * -------------------------------------------------------------------------
 * The scripted advance in balticShield.ts was built from this same start state,
 * so it would be reasonable to expect every order to score a perfect pass. It
 * does not, because a plan and a script are not the same artefact:
 *
 *  · 3 Armd Bn is ordered to an assembly area at OBJ ANVIL. The advance takes
 *    it there — and then straight back out again on its later legs. It reaches
 *    the objective and does not hold it.
 *  · Four "Infantry (Division)" placements carry Main Attack / Attack orders
 *    and were never published into the federation at all. Nothing observed.
 *  · 1 Mech Bn (West) holds two contradictory orders — Screen north-east to
 *    54.26/20.35, and Attack north to 54.35/20.40. The advance follows the
 *    first; the second is never begun.
 *  · 2 Mech Bn (Centre) holds a zero-length Defend order with no axis to
 *    measure against.
 *  · Every unit's planned timing comes from the planner's own cross-country
 *    rate table, and the scripted advance walks its legs in equal time
 *    regardless — so the two disagree about *when*, everywhere.
 *
 * A note on time
 * --------------
 * This phase is planned across 48 real hours (D+0 → D+2); the replay compresses
 * it into ADVANCE_DURATION_S. Absolute time comparisons between the two are
 * therefore meaningless, and the compliance engine never makes one — it
 * compares *fractions of the phase*, and reports the planner's estimate in real
 * hours alongside the observed equivalent. See compliance.ts.
 */
export const BALTIC_SHIELD_PLAN: PhasePlan = {
  phaseId: "obs_phase_01",
  scenarioId: "scenario_operation_baltic_shield",
  phaseName: "Phase 1 — Secure the Reinforcement Corridor",
  objectiveStatement:
    "Maintain freedom of movement for NATO reinforcements along ROUTE BLUE",
  startOffset: "D+0",
  endOffset: "D+2",
  phaseDurationHours: 48,
  units: PLANNED_UNITS,
  orders: PLANNED_ORDERS,
  objectives: PLANNED_OBJECTIVES,
  controlMeasures: PLANNED_CONTROL_MEASURES,
  predictedEndState: PREDICTED_END_STATE,
};

export default BALTIC_SHIELD_PLAN;
