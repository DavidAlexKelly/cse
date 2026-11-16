// ── bgws/components/OutcomeTrail.tsx ───────────────────────────────────────
// A command's progression as chips: queued → sent → accepted → executing →
// completed (or where it stopped). The last chip is the current state.

import type { FC } from "react";
import type { OutcomeSummary } from "../types";
import { chip, stateColour, UI } from "./styles";

const OutcomeTrail: FC<{ summary: OutcomeSummary | null; error?: string; extra?: string }> = ({
  summary,
  error,
  extra,
}) => {
  if (error) {
    return (
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <span style={chip(UI.red)}>not queued</span>
        <span style={{ fontSize: 10, color: UI.red }}>{error}</span>
      </span>
    );
  }
  if (!summary) return <span style={chip(UI.textDim)}>calling…</span>;
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
      {summary.trail.map((state) => (
        <span key={state} style={chip(stateColour(state), state === summary.state)}>
          {state}
        </span>
      ))}
      {extra && <span style={chip(UI.amber)}>{extra}</span>}
    </span>
  );
};

export default OutcomeTrail;
