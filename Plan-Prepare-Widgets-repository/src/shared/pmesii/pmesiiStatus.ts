// ============================================================
// PMESII status mapping
//
// The ontology and the widget use different vocabularies for a
// PMESII-PT domain's completion state:
//
//   ontology : empty | draft | in_review | complete
//   widget   : pending | in-review | approved | critical
//
// Previously the mapper only recognised the widget vocabulary,
// so every "Draft" (88 rows) and "complete" (13 rows) domain in
// the ontology was displayed as "pending". These helpers convert
// in both directions so reads are accurate and edits round-trip.
//
// "critical" has no ontology equivalent. The Modify action is
// configured to allow values outside its dropdown, so the term
// is written through verbatim and read back unchanged.
// ============================================================

import type { PmesiiStatus } from "../../pmesii-analysis/types.js";

/** Maps a raw ontology `domainStatus` onto the widget's status. */
export function pmesiiStatusToDisplay(
  raw: string | null | undefined,
): PmesiiStatus {
  if (!raw) return "pending";
  const key = raw.trim().toLowerCase().replace(/-/g, "_");
  switch (key) {
    case "complete":
    case "completed":
    case "approved":
      return "approved";
    case "in_review":
    case "review":
      return "in-review";
    case "critical":
      return "critical";
    case "draft":
    case "empty":
    case "pending":
      return "pending";
    default:
      return "pending";
  }
}

/** Maps the widget's status back onto the ontology vocabulary. */
export function pmesiiStatusToOntology(status: PmesiiStatus): string {
  switch (status) {
    case "approved":
      return "complete";
    case "in-review":
      return "in_review";
    case "critical":
      return "critical";
    case "pending":
    default:
      return "draft";
  }
}
