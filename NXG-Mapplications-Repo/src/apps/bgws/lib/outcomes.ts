// ── bgws/lib/outcomes.ts ───────────────────────────────────────────────────
// What happened to a command, from the rows commands.py writes to the Command
// Stream Output.
//
// One command produces several rows over time, keyed by command_id:
//
//   SENT / REFUSED / FAILED / EXPIRED / DEFERRED / DUPLICATE
//       the streamer's verdict: did the bridge put it on the wire?
//   ACKNOWLEDGED (zero or more, later)
//       what the federation said back, republished from the bridge's task
//       diagnostics. `detail` is "<instant> - task status: Executing" (from
//       ETR_TaskStatus) or "<instant> - SMC_Response: accepted" /
//       "rejected/failed" (from SMC_Response).
//
// BGWS answers every action with an SMC_Response and then task statuses:
// Accepted (or Refused) at once, Executing when applied, Completed when a
// move arrives, Cancelled when superseded, Error if the unit dies.
//
// Rows from different partitions can arrive out of order, so the state is
// the furthest one reached, not the last row read: a late "Accepted" must not
// pull an order that is already "Completed" back to "Accepted".

import type { CommandOutcomeRow, OrderState, OutcomeSummary } from "../types";

/** How far along each state is. Terminal states share the top rank. */
const RANK: Record<OrderState, number> = {
  queued: 0,
  deferred: 1,
  sent: 2,
  accepted: 3,
  executing: 4,
  completed: 5,
  cancelled: 5,
  refused: 5,
  error: 5,
  failed: 5,
  expired: 5,
};

export function isTerminal(state: OrderState): boolean {
  return RANK[state] >= 5;
}

/** Whether the state means the order did not (or no longer will) happen. */
export function isBad(state: OrderState): boolean {
  return state === "refused" || state === "error" || state === "failed" || state === "expired";
}

/** The state an ACKNOWLEDGED row's detail reports, or null when it says nothing usable. */
export function parseAcknowledgement(detail: string | null | undefined): OrderState | null {
  const text = String(detail ?? "").toLowerCase();
  const status = text.match(/task status:\s*([a-z/]+)/);
  if (status) {
    switch (status[1]) {
      case "accepted":
        return "accepted";
      case "refused":
        return "refused";
      case "cancelled":
      case "canceled":
        return "cancelled";
      case "executing":
        return "executing";
      case "completed":
        return "completed";
      case "error":
        return "error";
      default:
        return null;
    }
  }
  const smc = text.match(/smc_response:\s*([a-z/]+)/);
  if (smc) return smc[1] === "accepted" ? "accepted" : "refused";
  return null;
}

/** The state one outcome row reports, or null for a row that does not move it. */
export function stateOfRow(row: CommandOutcomeRow): OrderState | null {
  switch (String(row.stage ?? "").toUpperCase()) {
    case "SENT":
      return "sent";
    case "DEFERRED":
      return "deferred";
    case "REFUSED":
      return "refused";
    case "FAILED":
      return "failed";
    case "EXPIRED":
      return "expired";
    case "ACKNOWLEDGED":
      return parseAcknowledgement(row.detail);
    // DUPLICATE is the streamer seeing a command it already decided: no news.
    default:
      return null;
  }
}

/**
 * Fold the outcome rows of one command into where it has got to.
 *
 * `trail` is every distinct state in rank order — queued → sent → accepted →
 * executing → completed — for the progression chips.
 */
export function summarise(commandId: string, rows: CommandOutcomeRow[]): OutcomeSummary {
  const sorted = [...rows].sort((a, b) => String(a.observed_at ?? "").localeCompare(String(b.observed_at ?? "")));
  let state: OrderState = "queued";
  let detail: string | undefined;
  let updatedAt: string | undefined;
  let operation: string | undefined;
  const seen = new Set<OrderState>(["queued"]);
  for (const row of sorted) {
    operation = row.operation ?? operation;
    const next = stateOfRow(row);
    if (!next) continue;
    seen.add(next);
    // Equal rank replaces (a later terminal verdict wins), lower rank never does.
    if (RANK[next] >= RANK[state]) {
      state = next;
      detail = row.detail ?? undefined;
      updatedAt = row.observed_at ?? undefined;
    }
  }
  const trail = [...seen].sort((a, b) => RANK[a] - RANK[b]);
  return { commandId, state, trail, detail, operation, updatedAt };
}

/** Group outcome rows by command id. */
export function groupByCommand(rows: Iterable<CommandOutcomeRow>): Map<string, CommandOutcomeRow[]> {
  const out = new Map<string, CommandOutcomeRow[]>();
  for (const row of rows) {
    if (!row.command_id) continue;
    const list = out.get(row.command_id) ?? [];
    list.push(row);
    out.set(row.command_id, list);
  }
  return out;
}

/** Display word and colour family for a state. */
export function stateTone(state: OrderState): "neutral" | "progress" | "good" | "bad" | "muted" {
  if (isBad(state)) return "bad";
  if (state === "completed") return "good";
  if (state === "cancelled") return "muted";
  if (state === "queued" || state === "deferred") return "neutral";
  return "progress";
}
