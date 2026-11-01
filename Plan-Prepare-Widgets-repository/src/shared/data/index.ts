// ============================================================
// Shared seed data — typed loaders.
//
// Each *.json file under /shared/data is shaped like a small
// "object set": { objectType: string, objects: [...] }.
//
// These helpers import the JSON, type it, and expose lookup
// utilities so widgets can re-use the same data without each
// re-implementing the shape.
// ============================================================

import commentsRaw from "./comments.json";
import currentUserRaw from "./currentUser.json";
import exercisesRaw from "./exercises.json";
import personsRaw from "./persons.json";
import trainingAudiencesRaw from "./trainingAudiences.json";
import trainingObjectivesRaw from "./trainingObjectives.json";
import workflowTasksRaw from "./workflowTask.json";

// ── Person ────────────────────────────────────────────────────────────────

export interface Person {
  personId: string;
  name: string;
  rank: string;
  role: string;
  initials: string;
  nation: string;
  /** Either a CSS colour (e.g. "#ef4444") or a gradient string */
  avatarBg: string;
}

interface PersonsFile {
  objectType: "Person";
  objects: Person[];
}

export const PEOPLE: Person[] = (personsRaw as PersonsFile).objects;

export const personById = (id: string | undefined): Person | undefined =>
  PEOPLE.find((p) => p.personId === id);

// ── Current user ──────────────────────────────────────────────────────────

interface CurrentUserFile {
  objectType: "CurrentUser";
  currentUserId: string;
}

export const CURRENT_USER_ID: string = (currentUserRaw as CurrentUserFile)
  .currentUserId;

// ── Comments ──────────────────────────────────────────────────────────────

export interface CommentRecord {
  commentId: string;
  body: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  __links: {
    authoredBy: string;
  };
}

interface CommentsFile {
  objectType: "Comment";
  objects: CommentRecord[];
}

export const COMMENTS: CommentRecord[] = (commentsRaw as CommentsFile).objects;

export const commentsByIds = (ids: string[]): CommentRecord[] =>
  ids
    .map((id) => COMMENTS.find((c) => c.commentId === id))
    .filter((c): c is CommentRecord => c != null);

// ── Workflow tasks ────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "in-review" | "approved" | "in-progress";

export interface SubtaskRecord {
  subtaskId: string;
  text: string;
  done: boolean;
}

export interface WorkflowTaskRecord {
  taskId: string;
  name: string;
  description: string;
  section: string;
  dueOffset: string;
  status: TaskStatus;
  aiAssisted: boolean;
  subtasks?: SubtaskRecord[];
  __links: {
    assignedTo: string;
    approvedBy: string;
    definesContent: string[];
    hasComment: string[];
  };
}

interface WorkflowTasksFile {
  objectType: "WorkflowTask";
  objects: WorkflowTaskRecord[];
}

export const WORKFLOW_TASKS: WorkflowTaskRecord[] = (
  workflowTasksRaw as WorkflowTasksFile
).objects;

export const workflowTaskById = (
  id: string,
): WorkflowTaskRecord | undefined =>
  WORKFLOW_TASKS.find((t) => t.taskId === id);

// ── Training audiences ────────────────────────────────────────────────────

export interface ParticipatingNation {
  nation: string;
  role: string;
  participantCount: number;
  directorates: string[];
}

export interface TrainingAudienceRecord {
  audienceId: string;
  name: string;
  audienceType: "primary" | "secondary";
  participantCount: number;
  description: string;
  directorates: string[];
  participatingNations?: ParticipatingNation[];
}

interface TrainingAudiencesFile {
  objectType: "TrainingAudience";
  objects: TrainingAudienceRecord[];
}

export const TRAINING_AUDIENCES: TrainingAudienceRecord[] = (
  trainingAudiencesRaw as TrainingAudiencesFile
).objects;

export const trainingAudienceById = (
  id: string,
): TrainingAudienceRecord | undefined =>
  TRAINING_AUDIENCES.find((a) => a.audienceId === id);

// ── Training objectives ───────────────────────────────────────────────────

export type TrainingObjectivePriority = "High" | "Medium" | "Low";

export interface TrainingObjectiveRecord {
  objectiveId: string;
  /** Short reference, e.g. "TO-01" */
  ref: string;
  /** The objective statement */
  objective: string;
  /** Functional area / J-cell, e.g. "C2", "Logistics", "STRATCOM" */
  functionalArea: string;
  priority: TrainingObjectivePriority;
}

interface TrainingObjectivesFile {
  objectType: "TrainingObjective";
  objects: TrainingObjectiveRecord[];
}

export const TRAINING_OBJECTIVES: TrainingObjectiveRecord[] = (
  trainingObjectivesRaw as TrainingObjectivesFile
).objects;

export const trainingObjectiveById = (
  id: string,
): TrainingObjectiveRecord | undefined =>
  TRAINING_OBJECTIVES.find((o) => o.objectiveId === id);

// ── Exercises ─────────────────────────────────────────────────────────────

export type ExercisePhase = "plan" | "prepare" | "execute" | "assess";
export type ExerciseStatus = "draft" | "active" | "complete" | "archived";

export interface ExerciseRecord {
  exerciseId: string;
  name: string;
  type: string;
  classification: string;
  phase: ExercisePhase;
  status: ExerciseStatus;
  overallProgressPct: number;
  createdDate: string;
  __links: {
    hasTeamMember: string[];
    hasWorkflowTask: string[];
  };
}

interface ExercisesFile {
  objectType: "Exercise";
  objects: ExerciseRecord[];
}

export const EXERCISES: ExerciseRecord[] = (exercisesRaw as ExercisesFile)
  .objects;

export const exerciseById = (id: string): ExerciseRecord | undefined =>
  EXERCISES.find((e) => e.exerciseId === id);
