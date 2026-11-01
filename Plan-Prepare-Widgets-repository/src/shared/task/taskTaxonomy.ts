// ============================================================
// Task taxonomy — canonical sections and statuses
//
// Single source of truth for the vocabulary used by NxgTask.
// These lists are aligned with the values actually present in
// the ontology, and with the allowed values configured on the
// "Modify [NXG-P] Task" action type.
//
// Previously the widget only recognised three sections and
// three statuses, so any ontology task outside that set was
// silently coerced to "Planning & Design" / "pending". That
// mis-filed the majority of real tasks. Keep this file and the
// action type's allowed values in step.
// ============================================================

// ── Sections ──────────────────────────────────────────────────────────────

export const TASK_SECTIONS = [
  "Planning & Design",
  "Force Design",
  "Scenario Development",
  "Scenario & Environment",
  "Execution Planning",
  "Simulation Integration",
  "Exercise Control",
  "Administration",
] as const;

export type TaskSection = (typeof TASK_SECTIONS)[number];

export const DEFAULT_TASK_SECTION: TaskSection = "Planning & Design";

const SECTION_LOOKUP = new Map<string, TaskSection>(
  TASK_SECTIONS.map((s) => [s.toLowerCase(), s]),
);

/**
 * Maps a raw ontology `taskSection` value onto a known section.
 * Matching is case-insensitive so "planning & design" and
 * "Planning & Design" both resolve. Unknown values fall back to
 * the default section.
 */
export function normaliseTaskSection(
  raw: string | null | undefined,
): TaskSection {
  if (!raw) return DEFAULT_TASK_SECTION;
  return SECTION_LOOKUP.get(raw.trim().toLowerCase()) ?? DEFAULT_TASK_SECTION;
}

/** Sort comparator placing sections in canonical order. */
export function compareTaskSections(a: TaskSection, b: TaskSection): number {
  return TASK_SECTIONS.indexOf(a) - TASK_SECTIONS.indexOf(b);
}

// ── Statuses ──────────────────────────────────────────────────────────────

export const TASK_STATUSES = [
  "pending",
  "assigned",
  "in-review",
  "approved",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const DEFAULT_TASK_STATUS: TaskStatus = "pending";

/**
 * Maps a raw ontology `taskStatus` value onto a known status.
 *
 * The ontology holds inconsistent casing and separators for
 * historical reasons ("Pending" and "pending" both occur, as do
 * "in-review" and "in_review"), so normalise aggressively rather
 * than matching exactly.
 */
export function normaliseTaskStatus(
  raw: string | null | undefined,
): TaskStatus {
  if (!raw) return DEFAULT_TASK_STATUS;
  const key = raw.trim().toLowerCase().replace(/_/g, "-");
  switch (key) {
    case "approved":
      return "approved";
    case "in-review":
    case "inreview":
    case "review":
      return "in-review";
    case "assigned":
      return "assigned";
    case "pending":
    case "not-started":
    case "":
      return "pending";
    default:
      return DEFAULT_TASK_STATUS;
  }
}

/** Human-readable label for a status. */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  assigned: "Assigned",
  "in-review": "In Review",
  approved: "Approved",
};

/** Traffic-light intent used by the shared MilLabel component. */
export const TASK_STATUS_INTENT: Record<
  TaskStatus,
  "green" | "amber" | "grey" | "blue"
> = {
  pending: "grey",
  assigned: "blue",
  "in-review": "amber",
  approved: "green",
};
