// ── PMESII Analysis — Mock Data (derived from task-assignment data) ───────────

import type { PmesiiVariable, PmesiiComment } from "./types.js";

// Team members re-used from the exercise (same cast as task-assignment)
export const MOCK_OWNER_WESTERGAARD = "Maj Westergaard"; // task author (wt-5 owner)
export const MOCK_OWNER_KOWALSKI = "LtCol Kowalski";
export const MOCK_OWNER_ROOS = "Maj Roos";
export const MOCK_OWNER_ANDERSSEN = "Col Anderssen";
export const MOCK_OWNER_HARTMANN = "BGen Hartmann";

// ── PMESII-PT variables ────────────────────────────────────────────────────
// wt-5: "Define all PMESII-PT variables", owner: Maj Westergaard (task author)
// reviewer = per-domain approver, separate from the task-level author
export const MOCK_PMESII_VARIABLES: PmesiiVariable[] = [
  {
    id: "pmesii-1",
    domain: "Political",
    status: "approved",
    summary:
      "Government-in-exile. Contested sovereignty. Regional hegemony debated. UN Security Council diplomacy stalled.",
    reviewer: MOCK_OWNER_ANDERSSEN,
  },
  {
    id: "pmesii-2",
    domain: "Military",
    status: "critical",
    summary:
      "Near-peer OPFOR. Agreements: threat calls friendly forces at 55% readiness. Air domain contested.",
    reviewer: MOCK_OWNER_HARTMANN,
  },
  {
    id: "pmesii-3",
    domain: "Economic",
    status: "in-review",
    summary:
      "Critical infrastructure disrupted. Port operations at 40% capacity. Fuel costs degraded by OPFOR.",
    reviewer: MOCK_OWNER_ROOS,
  },
  {
    id: "pmesii-4",
    domain: "Social",
    status: "in-review",
    summary:
      "VPN/Access: Hostile media environment. Pro-Gothamey population 35% in eastern AOR.",
    reviewer: MOCK_OWNER_ANDERSSEN,
  },
  {
    id: "pmesii-5",
    domain: "Infrastructure",
    status: "pending",
    summary: "",
    reviewer: null,
  },
  {
    id: "pmesii-6",
    domain: "Information",
    status: "in-review",
    summary:
      "Information technology CEW with support forces. Pro-active information operations ongoing.",
    reviewer: MOCK_OWNER_KOWALSKI,
  },
  {
    id: "pmesii-7",
    domain: "Physical Environment",
    status: "pending",
    summary: "",
    reviewer: null,
  },
  {
    id: "pmesii-8",
    domain: "Time",
    status: "pending",
    summary: "",
    reviewer: null,
  },
];

// ── Comments ───────────────────────────────────────────────────────────────
// Tied to wt-5 (PMESII variables task), same team as task-assignment

export const MOCK_COMMENTS: PmesiiComment[] = [
  {
    id: "c-1",
    author: "CoE Aadlmann",
    rank: "CoE",
    text: "Information domain needs revision before we can approve. Please review and confirm with Bravo authority — please complete before submitting.",
    timestamp: "2 hours ago",
  },
];
