// apps/readiness/lib/report.ts — the readiness check as plain text, to paste
// into a rehearsal checklist, an email or a support conversation.
import { type PhaseFacts, phaseVerdict } from "./dataChecks";
import { type CheckResult, type CheckState, STAGES } from "./requirements";

const MARK: Record<CheckState, string> = {
  ok: "OK  ",
  warn: "WARN",
  fail: "FAIL",
  pending: "....",
};

export function countStates(results: readonly CheckResult[]): Record<CheckState, number> {
  const out: Record<CheckState, number> = { ok: 0, warn: 0, fail: 0, pending: 0 };
  for (const r of results) out[r.state] += 1;
  return out;
}

/** One sentence for the top of the screen. */
export function headline(results: readonly CheckResult[]): { state: CheckState; text: string } {
  const c = countStates(results);
  if (c.pending > 0) return { state: "pending", text: `Checking… ${c.pending} still to answer.` };
  if (c.fail > 0)
    return {
      state: "fail",
      text:
        `${c.fail} problem${c.fail === 1 ? "" : "s"} will stop part of the demo` +
        (c.warn > 0 ? `, and ${c.warn} thing${c.warn === 1 ? "" : "s"} to look at.` : "."),
    };
  if (c.warn > 0)
    return {
      state: "warn",
      text: `Nothing blocks the demo; ${c.warn} thing${c.warn === 1 ? "" : "s"} to look at.`,
    };
  return { state: "ok", text: "Everything the demo path needs is in place." };
}

export function readinessReport(input: {
  scenarioName: string;
  generatedAt: Date;
  results: readonly CheckResult[];
  phases: readonly PhaseFacts[];
}): string {
  const lines: string[] = [
    `Demo readiness — ${input.scenarioName}`,
    `Checked ${input.generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`,
    headline(input.results).text,
    "",
  ];
  for (const stage of STAGES) {
    const rows = input.results.filter((r) => r.stage === stage.id);
    if (rows.length === 0) continue;
    lines.push(`${stage.title} (${stage.screen})`);
    for (const r of rows) {
      lines.push(`  [${MARK[r.state]}] ${r.label} — ${r.message}`);
      if (r.fix && r.state !== "ok") lines.push(`         Fix: ${r.fix}`);
    }
    lines.push("");
  }
  if (input.phases.length > 0) {
    lines.push("Phases");
    for (const p of input.phases) {
      const v = phaseVerdict(p);
      const orbat = p.orbat ? `${p.orbat.blue} blue / ${p.orbat.red} red` : "unreadable";
      lines.push(
        `  [${MARK[v.state]}] ${p.phaseName} — map ${p.mapUnits ?? "none"}, orders ${p.orders}, ` +
          `ORBAT ${orbat}, objectives ${p.phaseObjectives || `${p.scenarioObjectives} (scenario-wide)`}`,
      );
      for (const f of v.findings) lines.push(`         ${f}`);
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}
