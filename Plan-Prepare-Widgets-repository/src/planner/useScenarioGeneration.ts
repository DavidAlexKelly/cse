// ============================================================
//  Planner — AI Scenario Generation Hook
// ============================================================
//
//  Orchestrates the multi-step call to generateExerciseScenarioFromDocuments
//  and then persists the result to the ontology via the create action types.
//
//  Document pipeline:
//    1. Upload file via OSDK __EXPERIMENTAL__NOT_SUPPORTED_YET__createMediaReference
//       → uploads to the media set backing PP.mediaReference and returns a MediaReference
//    2. Poll P&P' object (PP) by mediaItemRid until extractedText is populated
//    3. Pass extractedText to generateExerciseScenarioFromDocuments
//
//  NOTE: Raw fetch() to /api/v2/mediasets/... is blocked by the custom widget
//  iframe CSP / non-Ontology API restriction. We must go through OSDK.
//
//  Generation steps (matching the function's `step` parameter):
//    "scenario"            → NxgScenario + NxgTrainingAudience
//    "phases"              → NxgPhase[]
//    "training_objectives" → NxgTrainingObjective[]
//    "pmesii"              → NxgPmesiiDomain[]
//    "tasks"               → NxgTask[]
//    "injects"             → NxgInject[]

import { useCallback, useEffect, useRef, useState } from "react";
import { __EXPERIMENTAL__NOT_SUPPORTED_YET__createMediaReference } from "@osdk/api/unstable";
import { client } from "../client.js";
import {
  generateExerciseScenarioFromDocuments,
  createNxgPScenario,
  createNxgPPhase,
  createNxgPTask,
  createNxgPInject,
  createNxgPPmesiiDomain,
  createNxgPTrainingAudience,
  createNxgPTrainingObjective,
  PP,
} from "@custom-widget/sdk";

// ─── Constants ────────────────────────────────────────────────────────────────

/** How long to wait between polls for extracted text (ms) */
const POLL_INTERVAL_MS = 3_000;
/** Maximum total wait time for text extraction (ms) — 3 minutes */
const POLL_TIMEOUT_MS = 180_000;

// ─── Parameter coercion helpers ──────────────────────────────────────────────
//
// The Foundry Actions API is strict about types — sending `null` or a wrong
// primitive (e.g. a number where a string is expected) produces a 400
// `InvalidParameterValue`. The AI can be sloppy (numbers as strings, empty
// strings, wrong casing), so we coerce every value into the exact expected
// wire type before calling `applyAction`. Any key we don't have a valid value
// for is set to `undefined` so it is dropped by the JSON serialiser.

/** Coerce anything into a non-empty trimmed string, or undefined */
function toStr(v: unknown): string | undefined {
  if (typeof v === "string") {
    const s = v.trim();
    return s.length > 0 ? s : undefined;
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  return undefined;
}

/** Coerce into an integer (long on the wire), or undefined */
function toInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

/**
 * Coerce a value into an ISO date string ("YYYY-MM-DD") accepted by the
 * `date` parameter type. Full timestamps ("2025-05-28T00:00:00Z") are
 * rejected by the backend, so we truncate to the date component.
 */
function toDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  if (trimmed.length === 0) return undefined;
  // Already a date-only string
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // Try to parse and reformat
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD in UTC */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Best-effort extraction of the extra diagnostic fields Foundry attaches to
 * action / API errors ({errorCode, errorDescription, parameters, ...}).
 * Uses `unknown` + guarded reads so we don't need `any`.
 */
function readErrorFields(err: unknown): Record<string, unknown> {
  if (err == null || typeof err !== "object") return {};
  const rec = err as Record<string, unknown>;
  return {
    errorName: rec.errorName,
    errorCode: rec.errorCode,
    errorDescription: rec.errorDescription,
    statusCode: rec.statusCode,
    errorInstanceId: rec.errorInstanceId,
    parameters: rec.parameters,
    validation: rec.validation,
  };
}

/**
 * Return a shallow copy of `obj` with every key whose value is `undefined`
 * removed. Prevents keys like `strategicContextTitle: undefined` from being
 * serialised, which some fetch layers turn into `"strategicContextTitle":null`
 * and the backend then rejects with `InvalidParameterValue`.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type GenerationStep =
  | "idle"
  | "uploading"
  | "extracting"
  | "scenario"
  | "phases"
  | "training_objectives"
  | "pmesii"
  | "tasks"
  | "injects"
  | "persisting"
  | "done"
  | "error"
  | "cancelled";

/**
 * Which of the ontology-write substeps the user has to approve individually.
 * The AI step generates a proposal → we pause on "awaitingApproval" → user
 * accepts (we write & continue) or declines (we cancel the whole run).
 */
export type ApprovalStep =
  | "scenario"
  | "phases"
  | "training_objectives"
  | "pmesii"
  | "tasks"
  | "injects";

export interface PendingApproval {
  /** Which pipeline step's proposal is waiting for the user */
  step: ApprovalStep;
  /** Friendly human label ("Scenario", "Phases", …) */
  label: string;
  /**
   * Proposal payload as returned by the AI, already parsed. UI renders this
   * as a preview so the user can see exactly what will be written to the
   * ontology if they accept.
   */
  proposal: unknown;
  /** How many times the user has asked for a re-generation for this step */
  regenerationAttempt: number;
  /** The accumulated feedback the user has provided across previous retries */
  previousFeedback: string[];
  /** When true the widget is currently re-generating this step's proposal */
  isRegenerating: boolean;
}

/**
 * A single trace entry captured during generation. Represents either an
 * "input" event (what we sent to the AIP function or an action), or an
 * "output" event (raw response / error). Used by the UI to render a live
 * timeline of what happened, so users can inspect and debug failures.
 */
export interface TraceEntry {
  id: string;
  timestamp: number;
  /** Which pipeline step this belongs to (e.g. "scenario", "phases") */
  step: string;
  /** input = sent to backend; output = received; error = thrown */
  kind: "input" | "output" | "error" | "info";
  /** Short label for the entry (e.g. "Function call", "Raw response") */
  label: string;
  /** The payload (object, string, or error message) */
  payload: unknown;
}

export interface GenerationState {
  currentStep: GenerationStep;
  stepLabel: string;
  scenarioId: string | null;
  /** Human-friendly error message (never raw JSON parse errors) */
  error: string | null;
  /** Which step was active when the error occurred */
  errorStep: string | null;
  /** How many objects have been written to the ontology so far */
  objectsCreated: number;
  /** Which pipeline steps have completed (for the progress stepper UI) */
  completedSteps: GenerationStep[];
  /** Chronological log of inputs / outputs for the debug panel */
  trace: TraceEntry[];
  /**
   * When the AI has proposed data for a step and we're waiting for the user
   * to Accept (write to ontology + continue) or Decline (stop everything).
   * `null` means no approval is currently pending.
   */
  pendingApproval: PendingApproval | null;
}

const STEP_LABELS: Record<GenerationStep, string> = {
  idle: "Ready",
  uploading: "Uploading documents to media set…",
  extracting: "Waiting for text extraction pipeline…",
  scenario: "Generating scenario & strategic context…",
  phases: "Building exercise phases…",
  training_objectives: "Defining training objectives…",
  pmesii: "Analysing PMESII variables…",
  tasks: "Creating workflow tasks…",
  injects: "Generating MEL / MIL injects…",
  persisting: "Writing objects to ontology…",
  done: "Generation complete",
  error: "Error",
  cancelled: "Cancelled by user",
};

const APPROVAL_STEP_LABEL: Record<ApprovalStep, string> = {
  scenario: "Scenario",
  phases: "Phases",
  training_objectives: "Training objectives",
  pmesii: "PMESII-PT variables",
  tasks: "Workflow tasks",
  injects: "MEL / MIL injects",
};

// ApprovalDeclinedError has been removed — decline now resolves with null
// (skip the section) rather than throwing.

// ─── Media upload via OSDK ────────────────────────────────────────────────────

/**
 * Upload a file via the OSDK createMediaReference experimental API.
 * This uploads to the media set backing PP.mediaReference, which is an
 * Ontology API call — allowed inside the custom widget iframe.
 * Returns the mediaItemRid extracted from the resulting MediaReference.
 */
async function uploadViaOsdk(file: File): Promise<string> {
  const mediaRef = await client(
    __EXPERIMENTAL__NOT_SUPPORTED_YET__createMediaReference
  ).createMediaReference({
    data: file,
    fileName: file.name,
    objectType: PP,
    propertyType: "mediaReference",
  });

  // Extract the mediaItemRid from the returned MediaReference
  const mediaItemRid = mediaRef.reference?.mediaSetViewItem?.mediaItemRid;

  if (!mediaItemRid) {
    throw new Error(
      "Upload succeeded but no mediaItemRid in response: " +
        JSON.stringify(mediaRef)
    );
  }

  return mediaItemRid;
}

// ─── Poll for extracted text ──────────────────────────────────────────────────

/**
 * Poll the PP (P&P') object by mediaItemRid until extractedText is populated,
 * then return it joined as a single string.
 * Throws if the timeout is exceeded.
 */
async function pollForExtractedText(mediaItemRid: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const obj = await client(PP).fetchOne(mediaItemRid);
      const lines = obj.extractedText;
      if (lines && lines.length > 0) {
        return lines.join("\n");
      }
    } catch {
      // Object may not exist yet — keep polling
    }

    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Text extraction timed out after ${
      POLL_TIMEOUT_MS / 1000
    }s for media item ${mediaItemRid}. ` +
      "The pipeline may still be running — please try again shortly."
  );
}

// ─── JSON parse helper — tolerant of LLM output quirks ───────────────────────

/**
 * Fix invalid JSON escape sequences **inside string literals only**.
 *
 * JSON only allows these escapes inside strings:
 *   \"  \\  \/  \b  \f  \n  \r  \t  \uXXXX
 *
 * LLMs frequently emit things like:
 *   "Ranger's rifle"     (unescaped apostrophe — actually fine)
 *   "C:\\Users\\foo"     (fine)
 *   "Cost is $5\-USD"    (INVALID — \- is not a valid escape)
 *   "e.g.\ 3-day"        (INVALID — \space)
 *   "line1\nline2"       (fine)
 *   "raw newline
 *    here"               (INVALID — literal newline inside string)
 *
 * This walks the string state-aware, only rewriting the parts that break JSON,
 * so a stray `\-` inside a string value doesn't take down the whole payload.
 */
function fixInvalidEscapesInStrings(s: string): string {
  const out: string[] = [];
  let inString = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (!inString) {
      if (ch === '"') {
        inString = true;
        out.push(ch);
        i++;
        continue;
      }
      out.push(ch);
      i++;
      continue;
    }
    // Inside a string literal
    if (ch === '"') {
      inString = false;
      out.push(ch);
      i++;
      continue;
    }
    if (ch === "\\") {
      const next = s[i + 1];
      if (next === undefined) {
        // Trailing lone backslash — drop it
        i++;
        continue;
      }
      // Valid JSON escape? keep as-is
      if ('"\\/bfnrt'.includes(next)) {
        out.push(ch, next);
        i += 2;
        continue;
      }
      // Unicode escape: \uXXXX
      if (next === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) {
        out.push(s.slice(i, i + 6));
        i += 6;
        continue;
      }
      // Backslash + real newline / carriage return.
      // Convention: LLMs use `\` followed by a real linebreak to represent
      // an intended newline inside a string. Convert to a proper `\n` escape.
      if (next === "\n") {
        out.push("\\n");
        i += 2;
        continue;
      }
      if (next === "\r") {
        // Handle \r\n as well
        if (s[i + 2] === "\n") {
          out.push("\\n");
          i += 3;
          continue;
        }
        out.push("\\n");
        i += 2;
        continue;
      }
      // Invalid escape (e.g. `\-` `\(` `\'`) — drop the backslash, keep char
      out.push(next);
      i += 2;
      continue;
    }
    // Raw control character inside a string (newline, tab, etc.) — escape it
    if (ch === "\n") {
      out.push("\\n");
      i++;
      continue;
    }
    if (ch === "\r") {
      out.push("\\r");
      i++;
      continue;
    }
    if (ch === "\t") {
      out.push("\\t");
      i++;
      continue;
    }
    if (ch.charCodeAt(0) < 0x20) {
      // Other control char — hex-escape it
      out.push("\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
      i++;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

/**
 * Sanitise a raw LLM JSON string before parsing.
 * Handles markdown fences, curly quotes, invalid escapes and trailing commas.
 */
function sanitiseJsonString(raw: string): string {
  let s = raw.trim();

  // Strip leading/trailing markdown code fences
  s = s.replace(/^```(?:json|JSON)?\s*/i, "").replace(/\s*```\s*$/, "");

  // Replace curly/smart quotes with straight quotes
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

  // Fix escapes inside string literals only
  s = fixInvalidEscapesInStrings(s);

  // Remove trailing commas before ] or } (common LLM mistake)
  s = s.replace(/,(\s*[}\]])/g, "$1");

  return s;
}

/**
 * Try to slice out the first complete top-level JSON value ([...] or {...})
 * ignoring text before/after. Uses a state-aware bracket matcher.
 */
function extractFirstJson(s: string): string | null {
  const startBracket = s.search(/[[{]/);
  if (startBracket === -1) return null;
  const opener = s[startBracket];
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startBracket; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return s.slice(startBracket, i + 1);
    }
  }
  return null;
}

/**
 * Try to "unwrap" a doubly-encoded JSON payload.
 *
 * When the function returns a `string` return type, the value the AI produced
 * ends up JSON-encoded a second time by the platform. So a response like:
 *
 *   {"scenarioName": "IRON FORGE 26", "body": "line1\nline2"}
 *
 * arrives as an OUTER string containing:
 *
 *   {\"scenarioName\": \"IRON FORGE 26\", \"body\": \"line1\nline2\"}
 *
 * i.e. the same characters but with every `"` escaped as `\"`. Detect this
 * and undo it by unescaping so the caller ends up with real JSON to parse.
 */
function tryUnwrapDoubleEncoded(s: string): string {
  const trimmed = s.trim();
  // A doubly-encoded payload contains escaped quotes but does NOT actually
  // start with a JSON structural character.
  const startsStructural = /^[[{]/.test(trimmed);
  const hasEscapedQuotes = trimmed.includes('\\"');
  if (!startsStructural && hasEscapedQuotes) {
    // Try to parse as a JSON string first (handles the case where the whole
    // thing is wrapped in a literal "..." pair).
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        const inner = JSON.parse(trimmed);
        if (typeof inner === "string") return inner;
      } catch {
        // fall through to manual unescape
      }
    }
    // Manual unescape: turn \" into ", \\ into \, \n into newline, etc.
    return trimmed
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }
  return s;
}

/**
 * Custom error that carries the full raw payload and every parse attempt.
 * Used to surface parse failures in the UI debug panel with real context.
 */
export class JsonParseFailure extends Error {
  raw: string;
  preSanitised: string;
  unwrapped: string;
  attempts: Array<{ name: string; error?: string }>;
  step: string;

  constructor(args: {
    step: string;
    raw: string;
    preSanitised: string;
    unwrapped: string;
    attempts: Array<{ name: string; error?: string }>;
  }) {
    super(
      `AI returned malformed JSON for step "${args.step}". ` +
        `Tried ${args.attempts.length} parse strategies. See the ` +
        `debug panel for the raw response and every attempt's error.`
    );
    this.name = "JsonParseFailure";
    this.raw = args.raw;
    this.preSanitised = args.preSanitised;
    this.unwrapped = args.unwrapped;
    this.attempts = args.attempts;
    this.step = args.step;
  }
}

function parseJsonResponse(raw: string, step: string): unknown {
  const attempts: Array<{ name: string; error?: string }> = [];
  const preSanitised = sanitiseJsonString(raw);

  try {
    const first = JSON.parse(preSanitised);
    if (typeof first === "string") {
      const innerSanitised = sanitiseJsonString(first);
      try {
        return JSON.parse(innerSanitised);
      } catch (e) {
        attempts.push({
          name: "inner-parse-after-outer",
          error: (e as Error).message,
        });
      }
    } else {
      return first;
    }
  } catch (e) {
    attempts.push({ name: "direct-parse", error: (e as Error).message });
  }

  const unwrapped = tryUnwrapDoubleEncoded(preSanitised);
  if (unwrapped !== preSanitised) {
    try {
      return JSON.parse(sanitiseJsonString(unwrapped));
    } catch (e) {
      attempts.push({
        name: "manual-unwrap-parse",
        error: (e as Error).message,
      });
    }
  }

  const sliced = extractFirstJson(sanitiseJsonString(unwrapped));
  if (sliced) {
    try {
      return JSON.parse(sliced);
    } catch (e) {
      attempts.push({
        name: "extract-first-json",
        error: (e as Error).message,
      });
    }
  }

  try {
    return JSON.parse(preSanitised.replace(/\\/g, ""));
  } catch (e) {
    attempts.push({
      name: "strip-backslashes",
      error: (e as Error).message,
    });
  }

  throw new JsonParseFailure({
    step,
    raw,
    preSanitised,
    unwrapped,
    attempts,
  });
}

// ─── Main hook ────────────────────────────────────────────────────────────────

/**
 * A pre-processed P&P document already stored in the ontology. Selecting one
 * of these skips the upload + extraction pipeline and reuses the existing
 * extractedText array directly.
 */
export interface ExistingDocument {
  mediaItemRid: string;
  fileName: string;
  extractedText: string[];
}

export interface UseScenarioGenerationResult {
  state: GenerationState;
  generate: (params: {
    exerciseName: string;
    /** New file to upload — mutually exclusive with `scenarioExisting` */
    scenarioFile: File | null;
    /** Previously-processed PP object to reuse */
    scenarioExisting?: ExistingDocument | null;
    /** New file to upload — mutually exclusive with `exdirExisting` */
    exdirFile: File | null;
    /** Previously-processed PP object to reuse */
    exdirExisting?: ExistingDocument | null;
    aiPrompt: string;
  }) => Promise<void>;
  /**
   * User accepts the AI-proposed data for the currently pending step. The
   * pipeline continues, writes the objects to the ontology, and moves on.
   */
  approve: () => void;
  /**
   * User rejects the AI-proposed data. The whole run is stopped and marked
   * cancelled — no further writes will happen. Nothing already written is
   * rolled back (approvals so far are considered committed).
   */
  decline: () => void;
  /**
   * User asks the AI to regenerate the current step's proposal, optionally
   * providing extra feedback / instructions (like an ad-hoc AI prompt) so
   * the AI can produce a better result. The pipeline stays paused — a new
   * proposal will replace the current one, and the user can then accept /
   * decline / regenerate again.
   */
  regenerate: (feedback: string) => void;
  reset: () => void;
}

const INITIAL_STATE: GenerationState = {
  currentStep: "idle",
  stepLabel: STEP_LABELS["idle"],
  scenarioId: null,
  error: null,
  errorStep: null,
  objectsCreated: 0,
  completedSteps: [],
  trace: [],
  pendingApproval: null,
};

let traceIdCounter = 0;
const nextTraceId = (): string =>
  `${Date.now().toString(36)}-${(traceIdCounter++).toString(36)}`;

/**
 * The ordered pipeline steps shown in the UI stepper
 * (excludes transient internal states like "persisting")
 */
export const PIPELINE_STEPS: GenerationStep[] = [
  "uploading",
  "extracting",
  "scenario",
  "phases",
  "training_objectives",
  "pmesii",
  "tasks",
  "injects",
];

export const PIPELINE_STEP_ICONS: Record<string, string> = {
  uploading: "upload",
  extracting: "data-lineage",
  scenario: "document",
  phases: "timeline-events",
  training_objectives: "th-list",
  pmesii: "globe",
  tasks: "flow-branch",
  injects: "lightning",
};

/** Friendly short labels for the stepper (not the verbose spinner label) */
export const PIPELINE_STEP_SHORT: Record<string, string> = {
  uploading: "Upload",
  extracting: "Extract",
  scenario: "Scenario",
  phases: "Phases",
  training_objectives: "Objectives",
  pmesii: "PMESII",
  tasks: "Tasks",
  injects: "Injects",
};

// ─── Hook: list existing P&P documents ───────────────────────────────────────

export interface UsePPDocumentsResult {
  documents: ExistingDocument[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads existing P&P documents (that have been processed by the pipeline —
 * i.e. have extractedText populated) so users can reuse them instead of
 * re-uploading the same file.
 */
export function usePPDocuments(): UsePPDocumentsResult {
  const [documents, setDocuments] = useState<ExistingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const results: ExistingDocument[] = [];
        for await (const obj of client(PP).asyncIter()) {
          const lines = obj.extractedText;
          // Only surface docs that finished text extraction
          if (lines && lines.length > 0) {
            results.push({
              mediaItemRid: obj.mediaItemRid,
              fileName: obj.path ?? obj.mediaItemRid,
              extractedText: lines as string[],
            });
          }
          // Reasonable cap so we don't blow up the dropdown
          if (results.length >= 200) break;
        }
        if (!cancelled) {
          // newest first — path is not sortable so we keep insertion order
          setDocuments(results.reverse());
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load documents"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return {
    documents,
    loading,
    error,
    reload: () => setReloadKey((k) => k + 1),
  };
}

export function useScenarioGeneration(): UseScenarioGenerationResult {
  const [state, setState] = useState<GenerationState>(INITIAL_STATE);

  /**
   * When the pipeline is paused waiting for user approval, this holds the
   * `resolve`/`reject` of the pending promise. The UI calls approve/decline
   * which resolves the promise and the pipeline continues (or aborts).
   *
   * Stored in a ref so we can call it from stable callbacks that don't
   * re-render when state changes.
   */
  const pendingApprovalRef = useRef<{
    /** Called by approve() — resolves the promise with the accepted proposal */
    accept: () => void;
    /** Called by decline() — resolves the promise with null (skip this section) */
    skip: () => void;
    step: ApprovalStep;
    /** Called by regenerate() — re-runs the AI and updates the proposal */
    regenerate: (feedback: string) => Promise<void>;
  } | null>(null);

  const setStep = (step: GenerationStep, extra?: Partial<GenerationState>) => {
    setState((prev) => {
      // Mark the previous step as complete when advancing
      const prevStep = prev.currentStep;
      const shouldMark =
        prevStep !== "idle" &&
        prevStep !== "error" &&
        prevStep !== "done" &&
        prevStep !== step &&
        PIPELINE_STEPS.includes(prevStep) &&
        !prev.completedSteps.includes(prevStep);
      return {
        ...prev,
        currentStep: step,
        stepLabel: STEP_LABELS[step],
        completedSteps: shouldMark
          ? [...prev.completedSteps, prevStep]
          : prev.completedSteps,
        ...extra,
      };
    });
  };

  const bumpObjects = (n: number) => {
    setState((prev) => ({ ...prev, objectsCreated: prev.objectsCreated + n }));
  };

  /** Append a trace entry to the debug panel timeline */
  const pushTrace = (entry: Omit<TraceEntry, "id" | "timestamp">) => {
    setState((prev) => ({
      ...prev,
      trace: [
        ...prev.trace,
        { ...entry, id: nextTraceId(), timestamp: Date.now() },
      ],
    }));
  };

  /** Normalise any thrown value into a clean user-facing error string */
  const friendlyError = (err: unknown): string => {
    if (!(err instanceof Error))
      return "An unexpected error occurred — please try again.";
    const msg = err.message;

    // Input validation — surface these directly, they're actionable
    if (msg.startsWith("Exercise name is required")) return msg;
    if (msg.startsWith("No document text available")) return msg;
    if (msg.startsWith("AI returned an empty response")) return msg;

    // AI function itself signalled an error via `{ "error": "..." }` payload
    if (msg.startsWith("AI function returned an error")) {
      // Try to pull out the inner error message for a cleaner banner
      const m = /: ([^]+)$/.exec(msg);
      const inner = m?.[1] ?? msg;
      return `The AI function rejected the request: ${inner}`;
    }

    // JSON parse noise
    if (
      msg.includes("Bad escaped character") ||
      msg.includes("Bad control character") ||
      msg.includes("Unexpected token") ||
      msg.includes("Unexpected end of JSON") ||
      msg.includes("malformed JSON")
    ) {
      return "The AI returned an unexpected response. Please retry — the model may have included unsupported characters. (See the browser console for details.)";
    }
    // Upload / media errors
    if (
      msg.includes("Upload") ||
      msg.includes("mediaItemRid") ||
      msg.includes("createMediaReference")
    ) {
      return "Document upload failed. Check that the file format is supported (PDF, DOCX, TXT).";
    }
    // Text extraction timeout
    if (msg.includes("timed out") || msg.includes("extraction")) {
      return "Text extraction is taking longer than expected. Please retry in a moment.";
    }
    // Ontology action errors
    if (msg.includes("VALIDATION") || msg.includes("validation")) {
      return "An action validation error occurred. Some fields may have been left empty by the AI — you can continue and fill them in manually.";
    }
    // Generic fallback — cap length so it doesn't overflow the UI
    return msg.length > 160 ? msg.slice(0, 160) + "…" : msg;
  };

  const reset = useCallback(() => {
    // If a pending approval is still open, skip it so the promise resolves
    // cleanly with null rather than leaking (reset() aborts the run anyway).
    if (pendingApprovalRef.current) {
      pendingApprovalRef.current.skip();
      pendingApprovalRef.current = null;
    }
    setState(INITIAL_STATE);
  }, []);

  /**
   * Pause the pipeline and wait for the user to approve / decline / regenerate
   * the given proposal. Resolves with the *accepted* proposal (which may be
   * a different one than what was first shown, if the user asked for
   * regenerations). Throws `ApprovalDeclinedError` when the user declines.
   *
   * @param step         Which pipeline step is asking for approval
   * @param initialProposal The AI's first proposal for this step
   * @param regenerate   Called when the user asks for a re-run — takes the
   *                     accumulated feedback and returns a new proposal
   */
  /**
   * Pause the pipeline and wait for the user to approve / decline / regenerate
   * the given proposal.
   *
   * - **Accept** → resolves with the (possibly re-generated) proposal so the
   *   pipeline writes objects and continues.
   * - **Decline** → resolves with **`null`** so the pipeline skips this section
   *   and moves on to the next step without creating any objects for it.
   * - **Regenerate** → re-calls the AI and updates the preview; user then
   *   chooses Accept or Decline again.
   *
   * Returns `T` (accepted proposal) or `null` (declined / skipped).
   */
  const askForApproval = <T>(
    step: ApprovalStep,
    initialProposal: T,
    regenerate: (feedback: string) => Promise<T>
  ): Promise<T | null> => {
    return new Promise<T | null>((resolve) => {
      // Local mutable state for this approval — updated when the user
      // regenerates so the eventual `resolve()` returns the accepted value.
      let currentProposal: T = initialProposal;
      const feedbackHistory: string[] = [];

      const doRegenerate = async (feedback: string) => {
        // Mark UI as regenerating (buttons disabled, spinner shown)
        setState((prev) =>
          prev.pendingApproval
            ? {
                ...prev,
                pendingApproval: {
                  ...prev.pendingApproval,
                  isRegenerating: true,
                },
              }
            : prev
        );
        pushTrace({
          step,
          kind: "info",
          label: `Regenerating ${APPROVAL_STEP_LABEL[step]} with user feedback`,
          payload: {
            attempt: feedbackHistory.length + 1,
            feedback,
          },
        });
        try {
          const next = await regenerate(feedback);
          currentProposal = next;
          feedbackHistory.push(feedback);
          setState((prev) => ({
            ...prev,
            pendingApproval: {
              step,
              label: APPROVAL_STEP_LABEL[step],
              proposal: next,
              regenerationAttempt: feedbackHistory.length,
              previousFeedback: [...feedbackHistory],
              isRegenerating: false,
            },
          }));
          pushTrace({
            step,
            kind: "info",
            label: `New proposal ready — ${
              APPROVAL_STEP_LABEL[step]
            } (attempt ${feedbackHistory.length + 1})`,
            payload: next,
          });
        } catch (err) {
          // Regeneration failed — surface the error but keep the previous
          // proposal on-screen so the user can still accept / decline it.
          pushTrace({
            step,
            kind: "error",
            label: `Regeneration failed — ${APPROVAL_STEP_LABEL[step]}`,
            payload: {
              message: err instanceof Error ? err.message : String(err),
            },
          });
          setState((prev) =>
            prev.pendingApproval
              ? {
                  ...prev,
                  pendingApproval: {
                    ...prev.pendingApproval,
                    isRegenerating: false,
                  },
                }
              : prev
          );
        }
      };

      pendingApprovalRef.current = {
        accept: () => resolve(currentProposal),
        skip: () => resolve(null),
        step,
        regenerate: doRegenerate,
      };
      setState((prev) => ({
        ...prev,
        pendingApproval: {
          step,
          label: APPROVAL_STEP_LABEL[step],
          proposal: initialProposal,
          regenerationAttempt: 0,
          previousFeedback: [],
          isRegenerating: false,
        },
      }));
      pushTrace({
        step,
        kind: "info",
        label: `Waiting for user approval — ${APPROVAL_STEP_LABEL[step]}`,
        payload: initialProposal,
      });
    });
  };

  const approve = useCallback(() => {
    const pending = pendingApprovalRef.current;
    if (!pending) return;
    pushTrace({
      step: pending.step,
      kind: "info",
      label: `User approved — ${APPROVAL_STEP_LABEL[pending.step]}`,
      payload: { decision: "accepted" },
    });
    pendingApprovalRef.current = null;
    setState((prev) => ({ ...prev, pendingApproval: null }));
    pending.accept();
  }, []);

  const decline = useCallback(() => {
    const pending = pendingApprovalRef.current;
    if (!pending) return;
    pushTrace({
      step: pending.step,
      kind: "info",
      label: `User skipped — ${
        APPROVAL_STEP_LABEL[pending.step]
      }. No objects will be created for this section; pipeline continues.`,
      payload: { decision: "skipped" },
    });
    pendingApprovalRef.current = null;
    setState((prev) => ({ ...prev, pendingApproval: null }));
    // Resolves the awaiting promise with null → pipeline skips writes for this step
    pending.skip();
  }, []);

  const regenerate = useCallback((feedback: string) => {
    const pending = pendingApprovalRef.current;
    if (!pending) return;
    void pending.regenerate(feedback);
  }, []);

  const generate = useCallback(
    async ({
      exerciseName,
      scenarioFile,
      scenarioExisting,
      exdirFile,
      exdirExisting,
      aiPrompt,
    }: {
      exerciseName: string;
      scenarioFile: File | null;
      scenarioExisting?: ExistingDocument | null;
      exdirFile: File | null;
      exdirExisting?: ExistingDocument | null;
      aiPrompt: string;
    }) => {
      setState({
        ...INITIAL_STATE,
        currentStep: "uploading",
        stepLabel: STEP_LABELS["uploading"],
      });

      try {
        // ── 1. Obtain document text ──────────────────────────────────────────
        // For each slot: either reuse existing PP object's extractedText,
        // upload a new file, or leave empty.
        const resolveDoc = async (
          file: File | null,
          existing: ExistingDocument | null | undefined,
          isScenario: boolean
        ): Promise<string> => {
          if (existing) {
            return (existing.extractedText ?? []).join("\n");
          }
          if (!file) return "";
          const rid = await uploadViaOsdk(file);
          if (isScenario) setStep("extracting");
          return pollForExtractedText(rid);
        };

        // If both slots are already reused (no upload), skip the "uploading"
        // and "extracting" visual stages entirely.
        const skipUpload =
          !scenarioFile &&
          !exdirFile &&
          (!!scenarioExisting || !!exdirExisting);
        if (skipUpload) {
          setState((prev) => ({
            ...prev,
            currentStep: "scenario",
            stepLabel: STEP_LABELS["scenario"],
            completedSteps: ["uploading", "extracting"],
          }));
        }

        const [scenarioDocText, exdirText] = await Promise.all([
          resolveDoc(scenarioFile, scenarioExisting ?? null, true),
          resolveDoc(exdirFile, exdirExisting ?? null, false),
        ]);

        // ── VALIDATE INPUTS ────────────────────────────────────────────────
        // Fail fast with a clear error if we have no text to work with.
        const trimmedName = exerciseName.trim();
        if (!trimmedName) {
          throw new Error(
            "Exercise name is required — please enter one before generating."
          );
        }
        if (!scenarioDocText.trim() && !exdirText.trim()) {
          throw new Error(
            "No document text available — please upload a document or select an existing one."
          );
        }

        // Record the resolved input state
        pushTrace({
          step: "inputs",
          kind: "input",
          label: "Resolved generation inputs",
          payload: {
            exerciseName: trimmedName,
            scenarioDocText: {
              length: scenarioDocText.length,
              source: scenarioExisting
                ? `existing:${scenarioExisting.fileName}`
                : scenarioFile
                ? `upload:${scenarioFile.name}`
                : "empty",
              preview: scenarioDocText.slice(0, 800),
            },
            exdirText: {
              length: exdirText.length,
              source: exdirExisting
                ? `existing:${exdirExisting.fileName}`
                : exdirFile
                ? `upload:${exdirFile.name}`
                : "empty",
              preview: exdirText.slice(0, 800),
            },
            aiPrompt: {
              length: aiPrompt.length,
              preview: aiPrompt.slice(0, 500),
            },
          },
        });
        console.log(
          "[useScenarioGeneration] Starting generation with inputs:",
          {
            exerciseName: trimmedName,
            scenarioDocTextLength: scenarioDocText.length,
            exdirTextLength: exdirText.length,
            aiPromptLength: aiPrompt.length,
          }
        );

        // Helper to call the function for a given step.
        //
        // Optionally accepts extra `feedback` — additional instructions the
        // user typed after the first proposal (used when they hit the
        // "Regenerate" button on the approval bar). The feedback is appended
        // to the ad-hoc AI prompt so the model has both the original prompt
        // and the user's clarifications.
        // The AI function accepts a limited set of step keys — different from
        // the internal pipeline step names we use for UI state / tracing.
        // Map the internal names to the wire values the function expects.
        // (Validated against the function's own error message which lists the
        // allowed values as: scenario, phases, objectives, pmesii, audiences,
        // injects, tasks.)
        const FUNCTION_STEP_MAP: Record<string, string> = {
          scenario: "scenario",
          phases: "phases",
          training_objectives: "objectives",
          pmesii: "pmesii",
          tasks: "tasks",
          injects: "injects",
        };

        const callStep = async (
          step: string,
          feedback?: string
        ): Promise<unknown> => {
          const combinedPrompt = [aiPrompt, feedback]
            .filter((s) => (s ?? "").trim().length > 0)
            .join("\n\nAdditional feedback from the user:\n");
          const wireStep = FUNCTION_STEP_MAP[step] ?? step;
          const args = {
            exerciseName: trimmedName,
            scenarioDocText,
            exdirText,
            aiPrompt: combinedPrompt || undefined,
            step: wireStep,
          };
          pushTrace({
            step,
            kind: "input",
            label: feedback
              ? "Function call → generateExerciseScenarioFromDocuments (regenerating with user feedback)"
              : "Function call → generateExerciseScenarioFromDocuments",
            payload: {
              exerciseName: args.exerciseName,
              step: args.step,
              wireStep,
              scenarioDocTextChars: scenarioDocText.length,
              exdirTextChars: exdirText.length,
              aiPrompt: combinedPrompt || "(none)",
              userFeedback: feedback || undefined,
            },
          });
          console.log(
            `[useScenarioGeneration] Calling function step="${step}" (wire=${wireStep})${
              feedback ? " (with regeneration feedback)" : ""
            }`
          );
          const raw = await client(
            generateExerciseScenarioFromDocuments
          ).executeFunction(args);

          pushTrace({
            step,
            kind: "output",
            label: "Raw AIP function response",
            payload:
              typeof raw === "string"
                ? { type: "string", length: raw.length, value: raw }
                : { type: typeof raw, value: raw },
          });

          if (typeof raw !== "string") {
            return raw;
          }
          if (!raw.trim()) {
            throw new Error(
              `AI returned an empty response for step "${step}".`
            );
          }
          const parsed = parseJsonResponse(raw, step);
          // If the function itself returned an error object, surface it
          // clearly instead of letting downstream code treat it as data.
          if (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed) &&
            typeof (parsed as { error?: unknown }).error === "string"
          ) {
            const fnError = (parsed as { error: string }).error;
            throw new Error(
              `AI function returned an error for step "${step}" (wire="${wireStep}"): ${fnError}`
            );
          }

          // ── Extract & strip reasoning ──────────────────────────────────────
          // The AI may return a `reasoning` field (either top-level on an
          // object response, or on each item in an array response) that
          // explains how it chose each value and which part of the source
          // text it drew from. We:
          //   1. Record the reasoning in its own trace entry so it's
          //      prominently visible in the UI.
          //   2. Strip it from the payload before it is shown to the user
          //      for approval / passed to the ontology actions, so it never
          //      accidentally ends up as a property value.
          let cleanedParsed: unknown = parsed;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const rec = parsed as Record<string, unknown>;
            if (typeof rec.reasoning === "string" && rec.reasoning.trim()) {
              pushTrace({
                step,
                kind: "info",
                label: "AI reasoning",
                payload: { reasoning: rec.reasoning },
              });
              const { reasoning: _r, ...rest } = rec;
              void _r;
              cleanedParsed = rest;
            }
          } else if (Array.isArray(parsed)) {
            const reasoningItems: Array<{ index: number; reasoning: string }> =
              [];
            cleanedParsed = parsed.map((item: unknown, idx: number) => {
              if (item && typeof item === "object" && !Array.isArray(item)) {
                const rec = item as Record<string, unknown>;
                if (typeof rec.reasoning === "string" && rec.reasoning.trim()) {
                  reasoningItems.push({ index: idx, reasoning: rec.reasoning });
                  const { reasoning: _r, ...rest } = rec;
                  void _r;
                  return rest;
                }
              }
              return item;
            });
            if (reasoningItems.length > 0) {
              pushTrace({
                step,
                kind: "info",
                label: "AI reasoning",
                payload: { items: reasoningItems },
              });
            }
          }

          pushTrace({
            step,
            kind: "info",
            label: "Parsed JSON payload",
            payload: cleanedParsed,
          });
          return cleanedParsed;
        };

        // ── 2. Generate scenario shell ───────────────────────────────────────
        setStep("scenario");
        type ScenarioProposal = {
          scenarioName?: string;
          scenarioType?: string;
          strategicContextTitle?: string;
          strategicContextBody?: string;
          classification?: string;
          sourceDocuments?: string;
          scenarioStatus?: string;
          currentPhase?: string;
          overallProgressPct?: number;
          aiGenerated?: boolean;
          createdDate?: string; // ISO date "YYYY-MM-DD"
          trainingAudience?: {
            audienceName?: string;
            audienceType?: string;
            audienceDescription?: string;
            directorates?: string;
            participantCount?: number;
          };
          /** Stripped before ontology write — surfaced in trace panel only */
          reasoning?: string;
        };
        const initialScenarioProposal = (await callStep(
          "scenario"
        )) as ScenarioProposal;

        // Gate: user must accept, decline (skip), or regenerate the scenario proposal
        const scenarioData = await askForApproval<ScenarioProposal>(
          "scenario",
          initialScenarioProposal,
          async (feedback) =>
            (await callStep("scenario", feedback)) as ScenarioProposal
        );

        if (!scenarioData) {
          // User declined — skip scenario creation, continue with phases
          pushTrace({
            step: "scenario",
            kind: "info",
            label:
              "Scenario skipped — no ontology objects created for this section",
            payload: { skipped: true },
          });
        }

        setStep("persisting");
        // Note on parameter types (validated against the live action definition):
        //   scenarioName, scenarioType, strategicContextTitle,
        //   strategicContextBody, classification, sourceDocuments,
        //   scenarioStatus, currentPhase   → string
        //   overallProgressPct              → long   (integer number)
        //   aiGenerated                     → boolean
        //   createdDate                     → date   (ISO "YYYY-MM-DD", NOT a full timestamp)
        //
        // Any null or wrong-typed value produces a 400 InvalidParameterValue,
        // so we omit keys with `undefined` when the AI didn't return them.
        // scenarioData may be null if the user clicked "Skip" — guard before
        // building args so TypeScript is happy.
        let scenarioId: string | null = null;

        if (scenarioData) {
          const scenarioArgs = {
            scenarioName: toStr(scenarioData.scenarioName) ?? exerciseName,
            scenarioType: toStr(scenarioData.scenarioType) ?? "CAX",
            strategicContextTitle: toStr(scenarioData.strategicContextTitle),
            strategicContextBody: toStr(scenarioData.strategicContextBody),
            classification:
              toStr(scenarioData.classification) ?? "NATO UNCLASSIFIED",
            sourceDocuments: toStr(scenarioData.sourceDocuments),
            scenarioStatus: toStr(scenarioData.scenarioStatus) ?? "Draft",
            currentPhase: toStr(scenarioData.currentPhase),
            aiGenerated:
              typeof scenarioData.aiGenerated === "boolean"
                ? scenarioData.aiGenerated
                : true,
            createdDate: toDate(scenarioData.createdDate) ?? todayIsoDate(),
            overallProgressPct: toInt(scenarioData.overallProgressPct) ?? 0,
          };
          const scenarioArgsClean = stripUndefined(scenarioArgs);
          pushTrace({
            step: "scenario",
            kind: "input",
            label: "Ontology action → createNxgPScenario",
            payload: scenarioArgsClean,
          });
          const runScenarioAction = () =>
            client(createNxgPScenario).applyAction(scenarioArgsClean, {
              $returnEdits: true,
            });
          let scenarioResult: Awaited<ReturnType<typeof runScenarioAction>>;
          try {
            scenarioResult = await runScenarioAction();
          } catch (e) {
            pushTrace({
              step: "scenario",
              kind: "error",
              label: "Ontology action FAILED — createNxgPScenario",
              payload: {
                args: scenarioArgsClean,
                error: e instanceof Error ? e.message : String(e),
                ...readErrorFields(e),
              },
            });
            throw e;
          }
          pushTrace({
            step: "scenario",
            kind: "output",
            label: "Action result — createNxgPScenario",
            payload: scenarioResult,
          });
          bumpObjects(1);

          if (scenarioResult.type === "edits") {
            const created = scenarioResult.addedObjects;
            if (created && created.length > 0) {
              scenarioId = String(created[0].primaryKey);
            }
          }
          setState((prev) => ({ ...prev, scenarioId }));

          if (scenarioData.trainingAudience) {
            const ta = scenarioData.trainingAudience;
            const taArgs = stripUndefined({
              scenarioId: toStr(scenarioId),
              audienceName: toStr(ta.audienceName),
              audienceType: toStr(ta.audienceType),
              audienceDescription: toStr(ta.audienceDescription),
              directorates: toStr(ta.directorates),
              participantCount: toInt(ta.participantCount),
            });
            pushTrace({
              step: "scenario",
              kind: "input",
              label: "Ontology action → createNxgPTrainingAudience",
              payload: taArgs,
            });
            try {
              await client(createNxgPTrainingAudience).applyAction(taArgs);
              bumpObjects(1);
            } catch (e) {
              pushTrace({
                step: "scenario",
                kind: "error",
                label: "Ontology action FAILED — createNxgPTrainingAudience",
                payload: {
                  args: taArgs,
                  error: e instanceof Error ? e.message : String(e),
                  ...readErrorFields(e),
                },
              });
              // Non-fatal — continue with the rest of the pipeline
            }
          }
        }

        // ── 3. Phases ────────────────────────────────────────────────────────
        setStep("phases");
        type PhasesProposal = Array<{
          phaseName?: string;
          phaseDescription?: string;
          objectiveStatement?: string;
          startOffset?: string;
          endOffset?: string;
          sequenceNumber?: number;
        }>;
        const initialPhases = (await callStep("phases")) as PhasesProposal;

        // Gate: user must accept, decline (skip), or regenerate the phases proposal
        const phasesData = await askForApproval<PhasesProposal>(
          "phases",
          initialPhases,
          async (feedback) =>
            (await callStep("phases", feedback)) as PhasesProposal
        );

        if (!phasesData) {
          pushTrace({
            step: "phases",
            kind: "info",
            label:
              "Phases skipped — no ontology objects created for this section",
            payload: { skipped: true },
          });
        }

        const phaseIds: Record<number, string | null> = {};
        setStep("persisting");
        if (phasesData && Array.isArray(phasesData)) {
          for (let i = 0; i < phasesData.length; i++) {
            const p = phasesData[i];
            const phaseArgs = stripUndefined({
              scenarioId: toStr(scenarioId),
              phaseName: toStr(p.phaseName) ?? `Phase ${i + 1}`,
              phaseDescription: toStr(p.phaseDescription),
              objectiveStatement: toStr(p.objectiveStatement),
              startOffset: toStr(p.startOffset),
              endOffset: toStr(p.endOffset),
              sequenceNumber: toInt(p.sequenceNumber) ?? i + 1,
              phaseStatus: "Planned",
            });
            pushTrace({
              step: "phases",
              kind: "input",
              label: `Ontology action → createNxgPPhase (${i + 1}/${
                phasesData.length
              })`,
              payload: phaseArgs,
            });
            try {
              const phaseResult = await client(createNxgPPhase).applyAction(
                phaseArgs,
                { $returnEdits: true }
              );
              if (
                phaseResult.type === "edits" &&
                phaseResult.addedObjects?.length
              ) {
                phaseIds[i] = String(phaseResult.addedObjects[0].primaryKey);
              } else {
                phaseIds[i] = null;
              }
              bumpObjects(1);
            } catch (e) {
              pushTrace({
                step: "phases",
                kind: "error",
                label: `Ontology action FAILED — createNxgPPhase (phase ${
                  i + 1
                })`,
                payload: {
                  args: phaseArgs,
                  error: e instanceof Error ? e.message : String(e),
                  ...readErrorFields(e),
                },
              });
              phaseIds[i] = null;
              // Continue with remaining phases rather than aborting the whole run
            }
          }
        }

        // ── 4. Training objectives ───────────────────────────────────────────
        setStep("training_objectives");
        type ObjectivesProposal = Array<{
          objective?: string;
          functionalArea?: string;
          priority?: string;
          ref?: string;
          phaseIndex?: number;
        }>;
        const initialObjectives = (await callStep(
          "training_objectives"
        )) as ObjectivesProposal;

        // Gate: user must accept, decline (skip), or regenerate the objectives
        const toData = await askForApproval<ObjectivesProposal>(
          "training_objectives",
          initialObjectives,
          async (feedback) =>
            (await callStep(
              "training_objectives",
              feedback
            )) as ObjectivesProposal
        );

        if (!toData) {
          pushTrace({
            step: "training_objectives",
            kind: "info",
            label:
              "Training objectives skipped — no ontology objects created for this section",
            payload: { skipped: true },
          });
        }

        // Helper: apply a batch of action params one-at-a-time so that a
        // single bad row doesn't reject the entire batch. Each attempt is
        // traced (both request args and any error) so users can pinpoint
        // exactly which item was rejected and why.
        // Minimal shape describing the parts of an action client we call.
        // Avoids `any` while still working across the different action defs.
        type ActionClient = {
          batchApplyAction: (
            batch: Array<Record<string, unknown>>
          ) => Promise<unknown>;
          applyAction: (args: Record<string, unknown>) => Promise<unknown>;
        };

        // The typed action definitions in `@custom-widget/sdk` are opaque
        // to us here; we call them uniformly through the `ActionClient`
        // interface (batchApplyAction / applyAction), so `unknown` is enough.
        const applyBatchWithTrace = async (
          stepName: string,
          actionDef: unknown,
          actionName: string,
          batch: Array<Record<string, unknown>>
        ) => {
          if (batch.length === 0) return;
          pushTrace({
            step: stepName,
            kind: "input",
            label: `Ontology action → ${actionName} (batch of ${batch.length})`,
            payload: batch,
          });
          const actionClient = client(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            actionDef as any
          ) as unknown as ActionClient;
          // Try the batch first (fast path). If it fails, fall back to
          // per-item calls so we can surface the exact offending row.
          try {
            await actionClient.batchApplyAction(batch);
            bumpObjects(batch.length);
            return;
          } catch (batchErr) {
            pushTrace({
              step: stepName,
              kind: "error",
              label: `Batch action FAILED — ${actionName}. Retrying items individually…`,
              payload: {
                error:
                  batchErr instanceof Error
                    ? batchErr.message
                    : String(batchErr),
                ...readErrorFields(batchErr),
              },
            });
          }
          // Retry each item individually
          for (let i = 0; i < batch.length; i++) {
            const item = batch[i];
            try {
              await actionClient.applyAction(item);
              bumpObjects(1);
            } catch (e) {
              pushTrace({
                step: stepName,
                kind: "error",
                label: `${actionName} rejected item ${i + 1}/${batch.length}`,
                payload: {
                  args: item,
                  error: e instanceof Error ? e.message : String(e),
                  ...readErrorFields(e),
                },
              });
            }
          }
        };

        setStep("persisting");
        if (toData && Array.isArray(toData)) {
          const batch = toData.map((to) =>
            stripUndefined({
              scenarioId: toStr(scenarioId),
              phaseId:
                to.phaseIndex != null && phaseIds[to.phaseIndex] != null
                  ? toStr(phaseIds[to.phaseIndex])
                  : undefined,
              objective: toStr(to.objective),
              functionalArea: toStr(to.functionalArea),
              priority: toStr(to.priority),
              ref: toStr(to.ref),
            })
          );
          await applyBatchWithTrace(
            "training_objectives",
            createNxgPTrainingObjective,
            "createNxgPTrainingObjective",
            batch
          );
        }

        // ── 5. PMESII domains ────────────────────────────────────────────────
        setStep("pmesii");
        type PmesiiProposal = Array<{
          domainKey?: string;
          domainValue?: string;
          domainStatus?: string;
          aiGenerated?: boolean;
        }>;
        const initialPmesii = (await callStep("pmesii")) as PmesiiProposal;

        // Gate: user must accept, decline (skip), or regenerate the PMESII variables
        const pmesiiData = await askForApproval<PmesiiProposal>(
          "pmesii",
          initialPmesii,
          async (feedback) =>
            (await callStep("pmesii", feedback)) as PmesiiProposal
        );

        if (!pmesiiData) {
          pushTrace({
            step: "pmesii",
            kind: "info",
            label:
              "PMESII variables skipped — no ontology objects created for this section",
            payload: { skipped: true },
          });
        }

        setStep("persisting");
        if (pmesiiData && Array.isArray(pmesiiData)) {
          const batch = pmesiiData.map((d) =>
            stripUndefined({
              scenarioId: toStr(scenarioId),
              domainKey: toStr(d.domainKey),
              domainValue: toStr(d.domainValue),
              domainStatus: toStr(d.domainStatus) ?? "Draft",
              aiGenerated:
                typeof d.aiGenerated === "boolean" ? d.aiGenerated : true,
            })
          );
          await applyBatchWithTrace(
            "pmesii",
            createNxgPPmesiiDomain,
            "createNxgPPmesiiDomain",
            batch
          );
        }

        // ── 6. Tasks ─────────────────────────────────────────────────────────
        setStep("tasks");
        type TasksProposal = Array<{
          taskName?: string;
          taskDescription?: string;
          taskSection?: string;
          dueOffset?: string;
          phaseIndex?: number;
          taskStatus?: string;
          aiAssisted?: boolean;
        }>;
        const initialTasks = (await callStep("tasks")) as TasksProposal;

        // Gate: user must accept, decline (skip), or regenerate the tasks
        const tasksData = await askForApproval<TasksProposal>(
          "tasks",
          initialTasks,
          async (feedback) =>
            (await callStep("tasks", feedback)) as TasksProposal
        );

        if (!tasksData) {
          pushTrace({
            step: "tasks",
            kind: "info",
            label:
              "Tasks skipped — no ontology objects created for this section",
            payload: { skipped: true },
          });
        }

        setStep("persisting");
        if (tasksData && Array.isArray(tasksData)) {
          const batch = tasksData.map((t) =>
            stripUndefined({
              scenarioId: toStr(scenarioId),
              phaseId:
                t.phaseIndex != null && phaseIds[t.phaseIndex] != null
                  ? toStr(phaseIds[t.phaseIndex])
                  : undefined,
              taskName: toStr(t.taskName),
              taskDescription: toStr(t.taskDescription),
              taskSection: toStr(t.taskSection),
              dueOffset: toStr(t.dueOffset),
              taskStatus: toStr(t.taskStatus) ?? "Pending",
              aiAssisted:
                typeof t.aiAssisted === "boolean" ? t.aiAssisted : true,
            })
          );
          await applyBatchWithTrace(
            "tasks",
            createNxgPTask,
            "createNxgPTask",
            batch
          );
        }

        // ── 7. Injects (MEL / MIL) ───────────────────────────────────────────
        setStep("injects");
        type InjectsProposal = Array<{
          injectTitle?: string;
          injectBody?: string;
          injectCategory?: string;
          expectedResponse?: string;
          dayOffset?: string;
          phaseIndex?: number;
        }>;
        const initialInjects = (await callStep("injects")) as InjectsProposal;

        // Gate: user must accept, decline (skip), or regenerate the injects
        const injectsData = await askForApproval<InjectsProposal>(
          "injects",
          initialInjects,
          async (feedback) =>
            (await callStep("injects", feedback)) as InjectsProposal
        );

        if (!injectsData) {
          pushTrace({
            step: "injects",
            kind: "info",
            label:
              "Injects skipped — no ontology objects created for this section",
            payload: { skipped: true },
          });
        }

        setStep("persisting");
        if (injectsData && Array.isArray(injectsData)) {
          const batch = injectsData.map((inj) =>
            stripUndefined({
              scenarioId: toStr(scenarioId),
              phaseId:
                inj.phaseIndex != null && phaseIds[inj.phaseIndex] != null
                  ? toStr(phaseIds[inj.phaseIndex])
                  : undefined,
              injectTitle: toStr(inj.injectTitle),
              injectBody: toStr(inj.injectBody),
              injectCategory: toStr(inj.injectCategory),
              expectedResponse: toStr(inj.expectedResponse),
              dayOffset: toStr(inj.dayOffset),
            })
          );
          await applyBatchWithTrace(
            "injects",
            createNxgPInject,
            "createNxgPInject",
            batch
          );
        }

        // ── Done ─────────────────────────────────────────────────────────────
        setStep("done");
        // Mark the final step done before setting "done"
        setState((prev) => ({
          ...prev,
          completedSteps: PIPELINE_STEPS.every(
            (s) => prev.completedSteps.includes(s) || s === "injects"
          )
            ? [...prev.completedSteps, "injects"]
            : prev.completedSteps,
        }));
        setStep("done");
      } catch (err) {
        // Capture the full error context in the trace
        if (err instanceof JsonParseFailure) {
          pushTrace({
            step: err.step,
            kind: "error",
            label: "JSON parse failure — raw AIP response",
            payload: {
              step: err.step,
              rawLength: err.raw.length,
              raw: err.raw,
              preSanitised: err.preSanitised,
              unwrapped: err.unwrapped,
              attempts: err.attempts,
            },
          });
        } else {
          pushTrace({
            step: "error",
            kind: "error",
            label: "Generation failed",
            payload: {
              name: err instanceof Error ? err.name : "Unknown",
              message: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            },
          });
        }
        setState((prev) => ({
          ...prev,
          currentStep: "error",
          stepLabel: STEP_LABELS.error,
          error: friendlyError(err),
          errorStep: prev.currentStep,
          pendingApproval: null,
        }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return { state, generate, reset, approve, decline, regenerate };
}
