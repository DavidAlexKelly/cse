// ============================================================
// Scenario → work card mapping
//
// The Planner home screen lists "ongoing work" as cards. Those
// cards used to come from a hard-coded ONGOING_WORK array, so the
// Planner advertised exercises that did not exist and its Resume
// button just removed the card from local state.
//
// The cards are now built from real NxgScenario objects supplied
// through the widget's Scenarios parameter.
// ============================================================

import type { ScenarioSummary } from "../shared/hooks/useNxgScenarioList.js";

export type WorkCategory = "all" | "cax" | "wargame" | "planning" | "analysis";

export interface OngoingWork {
  id: string;
  category: Exclude<WorkCategory, "all">;
  categoryLabel: string;
  categoryColor: string;
  statusLabel: string;
  statusColor: string;
  title: string;
  subtitle: string;
  progressLabel: string;
  progress: number;
  progressColor: string;
  lastActivity: string;
  avatars: { initials: string; color: string }[];
  extraAvatars: number;
  attention?: boolean;
}

// ── Exercise type → card category ─────────────────────────────────────────
// NxgScenario.scenarioType is free text with a guided dropdown, so match
// loosely and fall back to the generic planning bucket.

const CATEGORY_BY_TYPE: Record<string, Exclude<WorkCategory, "all">> = {
  cax: "cax",
  cpx: "cax",
  ftx: "cax",
  livex: "cax",
  ttx: "wargame",
  wargame: "wargame",
  oplan: "planning",
  analysis: "analysis",
};

const CATEGORY_COLOURS: Record<Exclude<WorkCategory, "all">, string> = {
  cax: "#4c7ef3",
  wargame: "#8b5cf6",
  planning: "#24b47e",
  analysis: "#f0a83c",
};

function categoryFor(scenarioType: string): Exclude<WorkCategory, "all"> {
  return CATEGORY_BY_TYPE[scenarioType.trim().toLowerCase()] ?? "planning";
}

// ── Status → colour ───────────────────────────────────────────────────────

const STATUS_COLOURS: Record<string, string> = {
  active: "#24b47e",
  draft: "#f0a83c",
  complete: "#4c7ef3",
  archived: "#6a7292",
};

function statusColourFor(status: string): string {
  return STATUS_COLOURS[status.trim().toLowerCase()] ?? "#6a7292";
}

function titleCase(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Renders a created date as a short relative age ("3 days ago").
 * NxgScenario has no modified timestamp, so this is explicitly the
 * creation date rather than last activity.
 */
export function formatCreatedAge(
  createdDate: string | null,
  now: Date = new Date(),
): string {
  if (!createdDate) return "No created date";
  const created = new Date(`${createdDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(created.getTime())) return "No created date";
  const days = Math.floor(
    (now.getTime() - created.getTime()) / 86_400_000,
  );
  if (days < 0) return "Created in the future";
  if (days === 0) return "Created today";
  if (days === 1) return "Created yesterday";
  if (days < 30) return `Created ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12)
    return `Created ${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `Created ${years} year${years === 1 ? "" : "s"} ago`;
}

/** Maps a scenario onto the home screen's card shape. */
export function scenarioToWork(
  scenario: ScenarioSummary,
  now: Date = new Date(),
): OngoingWork {
  const category = categoryFor(scenario.scenarioType);
  const colour = CATEGORY_COLOURS[category];
  const statusLabel = [
    titleCase(scenario.scenarioStatus) || "Unknown status",
    scenario.currentPhase,
  ]
    .filter(Boolean)
    .join(" · ");

  const subtitle = [scenario.scenarioType, scenario.classification]
    .filter(Boolean)
    .join(" · ");

  return {
    id: scenario.scenarioId,
    category,
    categoryLabel: scenario.scenarioType || "Exercise",
    categoryColor: colour,
    statusLabel,
    statusColor: statusColourFor(scenario.scenarioStatus),
    title: scenario.scenarioName || "Untitled scenario",
    subtitle: subtitle || "No type or classification set",
    progressLabel: "Overall progress",
    progress: Math.max(0, Math.min(100, scenario.overallProgressPct)),
    progressColor: colour,
    lastActivity: formatCreatedAge(scenario.createdDate, now),
    // NxgScenario carries no team, and people are not in the ontology,
    // so the cards show no avatars rather than inventing them.
    avatars: [],
    extraAvatars: 0,
    // Flag drafts so an unfinished exercise stands out in the list.
    attention: scenario.scenarioStatus.trim().toLowerCase() === "draft",
  };
}
