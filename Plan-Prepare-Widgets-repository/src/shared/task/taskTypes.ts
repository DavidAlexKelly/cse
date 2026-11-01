// ============================================================
// Shared types & helpers for task-status banners.
//
// `ApprovalState` is the local UI state (drives the banner /
// action buttons). It is broader than the raw `TaskStatus`
// field on the WorkflowTask object, because the UI also
// represents "Returned, in progress with assignee" which the
// data model doesn't model explicitly.
// ============================================================

import type { TaskStatus } from "../data/index.js";

export type ApprovalState =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "approved";

export const STATUS_LABEL: Record<ApprovalState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "In review",
  approved: "Approved",
};

export const STATUS_CLASS: Record<ApprovalState, string> = {
  not_started: "scn-banner__status--not_started",
  in_progress: "scn-banner__status--in_progress",
  submitted: "scn-banner__status--submitted",
  approved: "scn-banner__status--approved",
};

/**
 * Convert the raw TaskStatus from the seed data into the broader
 * ApprovalState used by the widget banner.
 */
export function taskStatusToApprovalState(s: TaskStatus): ApprovalState {
  switch (s) {
    case "approved":
      return "approved";
    case "in-review":
      return "submitted";
    case "in-progress":
      return "in_progress";
    case "pending":
    default:
      return "not_started";
  }
}

/**
 * Default approval-note text for a given state. The widget may
 * override this when the user takes an action.
 */
export function defaultApprovalNote(
  state: ApprovalState,
  reviewerName?: string,
): string {
  switch (state) {
    case "approved":
      return reviewerName ? `Approved by ${reviewerName}` : "Approved";
    case "submitted":
      return reviewerName
        ? `Submitted for approval · Awaiting ${reviewerName}`
        : "Submitted for approval";
    case "in_progress":
      return "Returned for changes · with assignee";
    case "not_started":
    default:
      return "";
  }
}
