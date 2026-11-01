// ── PMESII Analysis — Type Definitions ────────────────────────────────────

export type PmesiiDomain =
  | "Political"
  | "Military"
  | "Economic"
  | "Social"
  | "Infrastructure"
  | "Information"
  | "Physical Environment"
  | "Time";

export type PmesiiStatus = "approved" | "in-review" | "pending" | "critical";

export interface PmesiiVariable {
  id: string;
  domain: PmesiiDomain;
  status: PmesiiStatus;
  summary: string;
  reviewer: string | null; // person who approves this specific domain
}

export interface PmesiiComment {
  id: string;
  author: string;
  rank: string;
  text: string;
  timestamp: string;
}
