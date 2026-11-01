// src/map/ScenarioPlanning/shared/types.ts
// Extended domain types that unify the widgetSet and map implementations.

export type PhaseStatus = "APPROVED" | "REVIEW" | "DRAFT";

// ── NxgTask ───────────────────────────────────────────────────────────────────
// Mirrors the [NXG] Task ontology object (NxgTask)
export type NxgTaskStatus = "approved" | "in-review" | "pending";

export interface NxgTask {
  taskId: string;
  taskName: string;
  taskDescription: string;
  taskStatus: NxgTaskStatus;
  taskSection: string;
  dueOffset: string;        // e.g. "D-55"
  aiAssisted: boolean;
  assignedTo?: string;      // person display name / ID
  /** Optional FK linking to the associated phase (mirrors NxgTask.phaseId
   *  in the ontology). Used as a fallback when phase.taskIds is empty. */
  phaseId?: string;
  scenarioId?: string;
}

// ── NxgTrainingAudience ──────────────────────────────────────────────────────
// Mirrors the [NXG] Training Audience ontology object (NxgTrainingAudience)
export type NxgAudienceType = "primary" | "secondary";
export interface NxgTrainingAudience {
  audienceId: string;
  audienceName: string;
  audienceDescription: string;
  audienceType: NxgAudienceType;
  participantCount: number;
  /** Pipe-delimited in the source dataset (e.g. "J1|J2|J3") — normalised to array here. */
  directorates: string[];
  scenarioId?: string;
}

// ── NxgPmesiiDomain ──────────────────────────────────────────────────────────
// Mirrors the [NXG] PMESII Domain ontology object (NxgPmesiiDomain).
// PMESII-PT: Political, Military, Economic, Social, Infrastructure,
// Information, Physical Environment, Time. domainStatus values in the source
// dataset are "complete", "in_review" and "empty".
export type NxgPmesiiStatus = "complete" | "in_review" | "empty";
export interface NxgPmesiiDomain {
  domainId: string;
  /** PMESII-PT domain name — e.g. "Political", "Military", "Physical Environment" */
  domainKey: string;
  /** Narrative description for this PMESII-PT domain */
  domainValue: string;
  domainStatus: NxgPmesiiStatus;
  aiGenerated: boolean;
  scenarioId?: string;
}

// ── NxgTrainingObjective ─────────────────────────────────────────────────────
// Mirrors the [NXG] Training Objective ontology object (NxgTrainingObjective).
// A training objective is tied to a functional area (e.g. C2, Fires, Logistics)
// and a phase, with a priority level ("High" | "Medium" | "Low").
export type NxgObjectivePriority = "High" | "Medium" | "Low";
export interface NxgTrainingObjective {
  objectiveId: string;
  /** Short reference code (e.g. "TO-01") */
  ref: string;
  /** Full text of the training objective */
  objective: string;
  /** Functional area the objective addresses (e.g. C2, Fires, Logistics) */
  functionalArea: string;
  priority: NxgObjectivePriority;
  scenarioId?: string;
  phaseId?: string;
}

// ── NxgInject (MEL/MIL) ──────────────────────────────────────────────────────
// Mirrors the [NXG] Inject ontology object (NxgInject) — a scripted MEL/MIL
// event introduced during an exercise phase to drive training audience
// responses. Category values in the source dataset include INTEL, CYBER, LOG,
// CIMIC, METOC, POLMIL, INFO OPS, etc. The pink accent (#F5498B) matches the
// ontology icon colour.
export interface NxgInject {
  injectId: string;
  /** Short title describing the inject event */
  injectTitle: string;
  /** Full narrative description of the inject event and required actions */
  injectBody: string;
  /** Expected response actions from the training audience */
  expectedResponse: string;
  /** Functional category (e.g. INTEL, CYBER, LOG, CIMIC, METOC, POLMIL, INFO OPS) */
  injectCategory: string;
  /** D-Day relative offset when the inject fires (e.g. "D+0", "D+5") */
  dayOffset: string;
  /** Optional reference to a terrain feature id relevant to this inject */
  referencesTerrainFeatureId?: string;
  scenarioId?: string;
  phaseId?: string;
}

/**
 * Unit that `Phase.startOffset` / `Phase.endOffset` are expressed in.
 *
 * NxgPhase stores offsets as strings and different scenarios use different
 * scales: IRON FORGE 26 is day-based ("D+0" … "D+14") while NEXGEN 2026 is
 * hour-based ("H+0" … "H+42"). The numeric offsets on Phase are unitless, so
 * this field says how to read them — without it every NEXGEN phase parsed to
 * 0 → 0 (zero-length) and was labelled in days.
 */
export type PhaseOffsetUnit = "day" | "hour";

export interface Phase {
  id: string;
  name: string;
  status: PhaseStatus;
  objective: string;
  startOffset: number;
  endOffset: number;
  /** Scale of startOffset/endOffset. Defaults to "day" when absent. */
  offsetUnit?: PhaseOffsetUnit;
  unitIds: string[];
  passCriteria: string[];
  failCriteria: string[];
  tasks: string[];       // legacy string list — taskIds now preferred
  taskIds?: string[];    // NxgTask.taskId references
  audienceIds?: string[]; // NxgTrainingAudience.audienceId references
  /** NxgPmesiiDomain.domainId references — the PMESII domains linked to this phase */
  pmesiiDomainIds?: string[];
  /** NxgTrainingObjective.objectiveId references — training objectives linked to this phase */
  objectiveIds?: string[];
  /** NxgInject.injectId references — MEL/MIL injects linked to this phase */
  injectIds?: string[];
  dependencies: string[];
  owner?: string;
  /**
   * If set, this phase was forked from another phase.
   * When two phases share the same basedOnPhaseId, they are alternative
   * branches (COAs) from the same decision point. The forked phase inherits
   * the source phase's end-state map as its starting position.
   */
  basedOnPhaseId?: string;
}

export type UnitAffiliation = "FRIENDLY" | "HOSTILE" | "NEUTRAL" | "UNKNOWN";
export interface MapUnit {
  id: string;
  unitIdentifier: string;
  sidc: string;
  affiliation: UnitAffiliation;
  latitude: number;
  longitude: number;
  directionOfMovement?: number;
  echelon?: string;
  phaseId?: string;
  allegiance?: string;
}

export interface MovementArrow {
  id: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  phaseId?: string;
}

export interface Objective {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  phaseId?: string;
}

export interface Operation {
  id: string;
  name: string;
  exerciseName: string;
  currentPhaseLabel: string;
  dDayOffset: number;
  nations: string[];
  terrainName: string;
  startTime: string;
  endTime: string;
  classification: string;
}

export interface ExerciseMeta {
  exerciseName: string;
  currentPhaseLabel: string;
  dDayOffset: string;
  nations: string[];
}

// ── Map Interaction Types ─────────────────────────────────────────────────────

export type DrawingTool =
  | "select"
  | "place-unit"
  | "draw-arrow"
  | "place-objective";

export interface ArrowDraft {
  fromLat: number;
  fromLng: number;
  toLatCursor: number;
  toLngCursor: number;
}

// ── Asset Catalogue ───────────────────────────────────────────────────────────

export interface AssetCatalogueItem {
  id: string;
  name: string;
  sidc: string;
  affiliation: UnitAffiliation;
  echelon: string;
  branch: string; // Army | Navy | Air Force
  nation: string;
  description: string;
}

